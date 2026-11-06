#!/usr/bin/env bash
# The real app against the LIVE testnets (Unichain Sepolia, Whitechain Sepolia, Hedera testnet), on this laptop:
# API :8787, demo shop :8788 (x402 in HBAR), app :5173. Reads .env + deployments/*.env. Nothing is deployed.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; for f in deployments/*.env; do source "$f"; done; set +a
export HCS_TOPIC_ID=${HEDERA_AUDIT_TOPIC:-} SHOP_URL=http://localhost:8788 TENDER_APP_URL=http://localhost:5173 X402_ASSET=${X402_ASSET:-hbar}
mkdir -p .fork
npx tsx server/src/index.ts > .fork/live-api.log 2>&1 &
SHOP_PORT=8788 npx tsx demo-shop/server/index.ts > .fork/live-shop.log 2>&1 &
(cd app && npx vite --port 5173 --strictPort) > .fork/live-app.log 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null' EXIT
wait
