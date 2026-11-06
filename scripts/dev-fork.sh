#!/usr/bin/env bash
# The whole product running on your laptop against LOCAL copies of Unichain Sepolia and Whitechain Sepolia.
# No keys, no faucets.
#   bash scripts/dev-fork.sh
# then open http://localhost:5173 (Tender) and http://localhost:8788 (the demo shop).
# In the app, "Connect wallet" offers two dev wallets: the payer (holds DEMO/WETH) and the merchant.
# Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
pids=()
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
  for f in .fork/anvil.pid .fork/anvil-wc.pid; do [ -f $f ] && kill "$(cat $f)" 2>/dev/null; rm -f $f; done
}
trap cleanup EXIT

bash scripts/fork-up.sh
set -a; source .env.fork; set +a
# Hedera isn't forked: the Agents page reads the REAL merchant account and audit topic from the live testnet,
# if a live run has recorded them (deployments/hedera-testnet.env + HEDERA_MERCHANT_ID in .env).
if [ -f deployments/hedera-testnet.env ] && grep -q "^HEDERA_MERCHANT_ID=" .env 2>/dev/null; then
  export HEDERA_MERCHANT_ID=$(grep "^HEDERA_MERCHANT_ID=" .env | cut -d= -f2)
  export HCS_TOPIC_ID=$(grep "^HEDERA_AUDIT_TOPIC=" deployments/hedera-testnet.env | cut -d= -f2)
fi

npx tsx server/src/index.ts & pids+=($!)
npx tsx demo-shop/server/index.ts & pids+=($!)
npm run dev -w @tender/app -- --strictPort & pids+=($!)
echo
echo "Tender app   http://localhost:5173"
echo "Demo shop    http://localhost:8788"
wait
