#!/usr/bin/env bash
# Backend on AWS App Runner: build the image, push to ECR, create/update two services (api, shop).
# Needs: aws CLI logged in (an IAM user with ECR + App Runner + IAM PassRole rights), docker running,
# and the runtime env in .env.deploy (chain addresses from deployments/*.env, keys, Hedera ids).
#   bash scripts/deploy-aws.sh            -> prints the two https URLs
set -euo pipefail
cd "$(dirname "$0")/.."
REGION=${AWS_REGION:-ap-south-1}           # Mumbai
REPO=${ECR_REPO:-tender}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
TAG=$(git rev-parse --short HEAD)
[ -f .env.deploy ] || { echo "create .env.deploy (see .env.deploy.example)"; exit 1; }

# 1. image
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 || aws ecr create-repository --repository-name "$REPO" --region "$REGION" >/dev/null
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR" >/dev/null
# App Runner runs linux/amd64; buildx builds that on an ARM Mac and pushes it straight to ECR
docker buildx build --platform linux/amd64 -t "$ECR/$REPO:$TAG" --push .
echo "== pushed $ECR/$REPO:$TAG"

# 2. App Runner needs a role that may pull from ECR
ROLE_ARN=$(aws iam get-role --role-name TenderAppRunnerEcrAccess --query Role.Arn --output text 2>/dev/null || true)
if [ -z "$ROLE_ARN" ]; then
  ROLE_ARN=$(aws iam create-role --role-name TenderAppRunnerEcrAccess --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' --query Role.Arn --output text)
  aws iam attach-role-policy --role-name TenderAppRunnerEcrAccess --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
  sleep 10
fi

# env vars for the containers, from .env.deploy (KEY=VALUE lines) as App Runner JSON
ENV_JSON=$(grep -vE '^\s*(#|$)' .env.deploy | jq -Rn '[inputs | capture("^(?<k>[^=]+)=(?<v>.*)$")] | map({(.k): .v}) | add')

# COST CAP: at most 2 instances per service, 1 always warm. Even a burst of judges can't scale spend past
# 2 x (0.25 vCPU, 0.5 GB). Roughly $4-8/month per service at rest.
SCALING_ARN=$(aws apprunner create-auto-scaling-configuration --region "$REGION" --auto-scaling-configuration-name tender-capped \
  --max-concurrency 100 --min-size 1 --max-size 2 --query AutoScalingConfiguration.AutoScalingConfigurationArn --output text 2>/dev/null \
  || aws apprunner list-auto-scaling-configurations --region "$REGION" --auto-scaling-configuration-name tender-capped --query 'AutoScalingConfigurationSummaryList[0].AutoScalingConfigurationArn' --output text)

deploy_service() { # name port command
  local name=$1 port=$2 cmd=$3
  local cfg
  cfg=$(jq -n --arg img "$ECR/$REPO:$TAG" --arg port "$port" --arg cmd "$cmd" --argjson env "$ENV_JSON" --arg role "$ROLE_ARN" '{
    ImageRepository: { ImageIdentifier: $img, ImageRepositoryType: "ECR", ImageConfiguration: { Port: $port, StartCommand: $cmd, RuntimeEnvironmentVariables: $env } },
    AutoDeploymentsEnabled: false, AuthenticationConfiguration: { AccessRoleArn: $role } }')
  local arn
  arn=$(aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='$name'].ServiceArn" --output text)
  if [ -z "$arn" ]; then
    arn=$(aws apprunner create-service --region "$REGION" --service-name "$name" --source-configuration "$cfg" \
      --instance-configuration '{"Cpu":"0.25 vCPU","Memory":"0.5 GB"}' --auto-scaling-configuration-arn "$SCALING_ARN" --query Service.ServiceArn --output text)
  else
    aws apprunner update-service --region "$REGION" --service-arn "$arn" --source-configuration "$cfg" --auto-scaling-configuration-arn "$SCALING_ARN" >/dev/null
  fi
  aws apprunner wait service-running --region "$REGION" --service-arn "$arn" 2>/dev/null || sleep 60
  echo "== $name: https://$(aws apprunner describe-service --region "$REGION" --service-arn "$arn" --query Service.ServiceUrl --output text)"
}

deploy_service tender-api 8787 "npm run server"
deploy_service tender-shop 8788 "npm run shop"
echo "Set SHOP_URL / TENDER_APP_URL in .env.deploy to the final URLs and re-run once if they changed."
