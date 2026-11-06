#!/usr/bin/env bash
# The live Hedera proof: the shop's x402 paywall on hedera:testnet (Blocky402 facilitator, HTS USDC), and the
# agent buying with no human involved, three times. Spending policy (agent/policy.json): 0.10 USDC cap per
# merchant at 0.05 a purchase, so purchases 1 and 2 settle and purchase 3 is REFUSED before anything is
# signed. Every decision goes to the HCS audit topic. Prints HashScan links for the README.
# Needs in .env: HEDERA_AGENT_ID/KEY (holding test USDC), HEDERA_MERCHANT_ID.
#   bash scripts/hedera-live.sh                   (settles in Hedera testnet USDC)
#   X402_ASSET=hbar bash scripts/hedera-live.sh   (settles in native HBAR, if the USDC faucet is down)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${HEDERA_AGENT_ID:?}" "${HEDERA_MERCHANT_ID:?}"
PORT=8788 # the agent's allowlist names localhost:8788
mkdir -p .fork deployments

usdc() { curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/$1/tokens?token.id=0.0.429274" | python3 -c "import sys,json; t=json.load(sys.stdin).get('tokens',[]); print(t[0]['balance']/1e6 if t else 0)"; }
hbar() { curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/$1" | python3 -c "import sys,json; print(json.load(sys.stdin)['balance']['balance']/1e8)"; }
ASSET=${X402_ASSET:-usdc}; export X402_ASSET=$ASSET
echo "== settling in $ASSET"
echo "== agent $HEDERA_AGENT_ID: $(usdc "$HEDERA_AGENT_ID") USDC, $(hbar "$HEDERA_AGENT_ID") HBAR; merchant $HEDERA_MERCHANT_ID: $(usdc "$HEDERA_MERCHANT_ID") USDC, $(hbar "$HEDERA_MERCHANT_ID") HBAR"

# the shop with the live paywall (stop whatever else serves :8788 first, e.g. the fork demo's shop)
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
SHOP_PORT=$PORT AGENT_PRICE_USD=${AGENT_PRICE_USD:-0.05} npx tsx demo-shop/server/index.ts > .fork/shop-hedera.log 2>&1 &
SHOP=$!
trap 'kill $SHOP 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s "http://localhost:$PORT/.well-known/tender.json" | grep -q dataset && break; sleep 1; done
echo "== shop manifest: $(curl -s "http://localhost:$PORT/.well-known/tender.json")"

# a fresh spending ledger so the run shows the policy from zero (the old one is kept), writing to the same
# audit topic as earlier runs so the README's topic link shows every run (NEW_TOPIC=1 starts a new topic)
[ -f agent/ledger.json ] && mv agent/ledger.json "agent/ledger.$(date +%s).json"
if [ -z "${NEW_TOPIC:-}" ] && [ -f deployments/hedera-testnet.env ]; then
  HCS_TOPIC_ID=$(grep -E '^HEDERA_AUDIT_TOPIC=' deployments/hedera-testnet.env | cut -d= -f2)
  [ -n "$HCS_TOPIC_ID" ] && export HCS_TOPIC_ID && echo "== audit topic $HCS_TOPIC_ID (kept from earlier runs)"
fi

for n in 1 2 3; do
  echo "== purchase $n"
  npx tsx agent/src/run.ts "http://localhost:$PORT" 2>&1 | grep -E "^agent:" | grep -vE "^agent: \{" || true
done

python3 - <<'EOF'
import json, os
d = json.load(open("agent/ledger.json"))
topic = os.environ.get("HCS_TOPIC_ID") or d.get("topicId", "")
print("== ledger: $", d["totalUsd"], "spent in", len(d["entries"]), "purchases; audit topic", topic)
# keep the proof txs of earlier runs on the same topic and add this run's
path = "deployments/hedera-testnet.env"
old = dict(l.split("=", 1) for l in open(path).read().splitlines() if "=" in l and not l.startswith("#")) if os.path.exists(path) else {}
txs = [v for k, v in sorted(old.items(), key=lambda kv: int(kv[0].rsplit("_", 1)[1]) if kv[0].startswith("HEDERA_PROOF_TX_") else 0) if k.startswith("HEDERA_PROOF_TX_")] if old.get("HEDERA_AUDIT_TOPIC") == topic else []
txs += [e["txId"] for e in d["entries"] if e["txId"] not in txs]
lines = [f"HEDERA_SETTLEMENT_ASSET={os.environ.get('X402_ASSET','usdc')}", f"HEDERA_AUDIT_TOPIC={topic}"] + [f"HEDERA_PROOF_TX_{i+1}={t}" for i, t in enumerate(txs)]
open(path, "w").write("# Live x402 run on Hedera testnet: settled purchases + HCS audit topic. Ids only, no keys.\n" + "\n".join(lines) + "\n")
for t in txs[-len(d["entries"]):]: print("== settled:", "https://hashscan.io/testnet/transaction/" + t)
EOF
sleep 6 # mirror node lag
echo "== after: agent $(usdc "$HEDERA_AGENT_ID") USDC, $(hbar "$HEDERA_AGENT_ID") HBAR; merchant $(usdc "$HEDERA_MERCHANT_ID") USDC, $(hbar "$HEDERA_MERCHANT_ID") HBAR"
