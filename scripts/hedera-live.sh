#!/usr/bin/env bash
# The live Hedera proof: the shop's x402 paywall on hedera:testnet (Blocky402 facilitator, HTS USDC), and the
# agent buying with no human involved, three times. Spending policy (agent/policy.json): 0.10 USDC cap per
# merchant at 0.05 a purchase, so purchases 1 and 2 settle and purchase 3 is REFUSED before anything is
# signed. Every decision goes to the HCS audit topic. Prints HashScan links for the README.
# Needs in .env: HEDERA_AGENT_ID/KEY (holding test USDC), HEDERA_MERCHANT_ID.
#   bash scripts/hedera-live.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${HEDERA_AGENT_ID:?}" "${HEDERA_MERCHANT_ID:?}"
PORT=8788 # the agent's allowlist names localhost:8788
mkdir -p .fork deployments

usdc() { curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/$1/tokens?token.id=0.0.429274" | python3 -c "import sys,json; t=json.load(sys.stdin).get('tokens',[]); print(t[0]['balance']/1e6 if t else 0)"; }
echo "== agent $HEDERA_AGENT_ID holds $(usdc "$HEDERA_AGENT_ID") USDC; merchant $HEDERA_MERCHANT_ID holds $(usdc "$HEDERA_MERCHANT_ID") USDC"

# the shop with the live paywall (stop whatever else serves :8788 first, e.g. the fork demo's shop)
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
SHOP_PORT=$PORT AGENT_PRICE_USD=${AGENT_PRICE_USD:-0.05} npx tsx demo-shop/server/index.ts > .fork/shop-hedera.log 2>&1 &
SHOP=$!
trap 'kill $SHOP 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s "http://localhost:$PORT/.well-known/tender.json" | grep -q dataset && break; sleep 1; done
echo "== shop manifest: $(curl -s "http://localhost:$PORT/.well-known/tender.json")"

# a fresh spending ledger so the run shows the policy from zero (the old one is kept)
[ -f agent/ledger.json ] && mv agent/ledger.json "agent/ledger.$(date +%s).json"

for n in 1 2 3; do
  echo "== purchase $n"
  npx tsx agent/src/run.ts "http://localhost:$PORT" 2>&1 | grep -E "^agent:" | grep -vE "^agent: \{" || true
done

python3 - <<'EOF'
import json
d = json.load(open("agent/ledger.json"))
print("== ledger:", d["totalUsd"], "USDC spent in", len(d["entries"]), "purchases; audit topic", d.get("topicId"))
lines = [f"HEDERA_AUDIT_TOPIC={d.get('topicId','')}"] + [f"HEDERA_PROOF_TX_{i+1}={e['txId']}" for i, e in enumerate(d["entries"])]
open("deployments/hedera-testnet.env", "w").write("# Live x402 run on Hedera testnet: settled purchases + HCS audit topic. Ids only, no keys.\n" + "\n".join(lines) + "\n")
EOF
echo "== merchant $HEDERA_MERCHANT_ID now holds $(usdc "$HEDERA_MERCHANT_ID") USDC"
