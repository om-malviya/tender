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
docker build --platform linux/amd64 -t "$ECR/$REPO:$TAG" .
docker push "$ECR/$REPO:$TAG" >/dev/null
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
      --instance-configuration '{"Cpu":"0.25 vCPU","Memory":"0.5 GB"}' --query Service.ServiceArn --output text)
  else
    aws apprunner update-service --region "$REGION" --service-arn "$arn" --source-configuration "$cfg" >/dev/null
  fi
  aws apprunner wait service-running --region "$REGION" --service-arn "$arn" 2>/dev/null || sleep 60
  echo "== $name: https://$(aws apprunner describe-service --region "$REGION" --service-arn "$arn" --query Service.ServiceUrl --output text)"
}

deploy_service tender-api 8787 "npm run server"
deploy_service tender-shop 8788 "npm run shop"
echo "Set SHOP_URL / TENDER_APP_URL in .env.deploy to the final URLs and re-run once if they changed."
