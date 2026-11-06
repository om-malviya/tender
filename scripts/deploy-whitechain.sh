#!/usr/bin/env bash
# Deploy CheckoutCore to Whitechain Sepolia, verify it on the explorer, and make the proof payments
# in Whitechain's official USDT: one approve+pay, one partial refund.
# Needs in .env: DEPLOYER_PK (funded with WBT for gas AND at least 2 test USDT).
# Usage: bash scripts/deploy-whitechain.sh
#        RPC=http://127.0.0.1:8546 SKIP_VERIFY=1 bash scripts/deploy-whitechain.sh   (dry run on a local fork)
set -euo pipefail
cd "$(dirname "$0")/.."
# .env fills in what isn't set, but never overrides a key/RPC passed on the command line (fork rehearsals)
ARG_PK=${DEPLOYER_PK:-}
[ -f .env ] && { set -a; source .env; set +a; }
[ -n "$ARG_PK" ] && DEPLOYER_PK=$ARG_PK
RPC=${RPC:-https://rpc.testnet.whitechain.io/}
EXPLORER=https://explorer.testnet.whitechain.io
USDT=0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7
: "${DEPLOYER_PK:?set DEPLOYER_PK in .env}"
DEPLOYER=$(cast wallet address "$DEPLOYER_PK")
mkdir -p deployments

echo "== deployer $DEPLOYER on chain $(cast chain-id --rpc-url "$RPC")"
echo "   WBT  $(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether) · USDT $(cast call $USDT 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC" | awk '{printf "%.2f", $1/1e6}')"

cd contracts
OUT=$(FOUNDRY_PROFILE=whitechain forge create src/CheckoutCore.sol:CheckoutCore --skip test --skip TenderFixture \
  --rpc-url "$RPC" --private-key "$DEPLOYER_PK" --broadcast --constructor-args "[$USDT]" 0x0000000000000000000000000000000000000000 2>&1)
CORE=$(echo "$OUT" | awk '/Deployed to:/{print $3}')
TX=$(echo "$OUT" | awk '/Transaction hash:/{print $3}')
[ -n "$CORE" ] || { echo "$OUT"; exit 1; }
BLOCK=$(cast receipt "$TX" blockNumber --rpc-url "$RPC")
echo "== deployed CheckoutCore $CORE  $EXPLORER/address/$CORE"

if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  echo "== verifying on the Whitechain explorer (blockscout)"
  FOUNDRY_PROFILE=whitechain forge verify-contract "$CORE" src/CheckoutCore.sol:CheckoutCore \
    --rpc-url "$RPC" --verifier blockscout --verifier-url "$EXPLORER/api/" \
    --constructor-args "$(cast abi-encode 'constructor(address[],address)' "[$USDT]" 0x0000000000000000000000000000000000000000)" 2>&1 | tail -3 | sed 's/^/   /'
fi
cd ..

# proof: invoice -> approve + pay -> partial refund (deployer plays merchant and payer)
# Public RPCs can time out on receipts and serve stale reads from a lagging node, so: wait long for every
# receipt, fail loudly on a reverted one, and take each new invoice id from its own InvoiceCreated event.
tx() { # cast send args... -> prints the tx hash; exits if the tx reverted
  local r; r=$(cast send "$@" --private-key "$DEPLOYER_PK" --rpc-url "$RPC" --timeout 300 --json)
  [ "$(echo "$r" | jq -r .status)" = "0x1" ] || { echo "transaction failed: $*" >&2; echo "$r" >&2; exit 1; }
  echo "$r" | jq -r .transactionHash
}
new_invoice() { # checkout settleToken amount orderRefText -> prints the invoice id
  local r; r=$(cast send "$1" "createInvoice(address,uint256,uint64,bytes32)" "$2" "$3" $(( $(date +%s) + 3600 )) "$(cast keccak "$4")" \
    --private-key "$DEPLOYER_PK" --rpc-url "$RPC" --timeout 300 --json)
  [ "$(echo "$r" | jq -r .status)" = "0x1" ] || { echo "createInvoice failed" >&2; exit 1; }
  local c; c=$(echo "$1" | tr A-Z a-z)
  cast to-dec "$(echo "$r" | jq -r --arg c "$c" '[.logs[] | select((.address | ascii_downcase) == $c)][0].topics[1]')"
}
ID=$(new_invoice "$CORE" "$USDT" 1000000 proof-usdt)
tx "$USDT" "approve(address,uint256)" "$CORE" 1000000 >/dev/null
PAY=$(tx "$CORE" "payInvoice(uint256)" "$ID")
echo "== USDT payment  invoice #$ID  $EXPLORER/tx/$PAY"
tx "$USDT" "approve(address,uint256)" "$CORE" 400000 >/dev/null
REFUND=$(tx "$CORE" "refund(uint256,uint256)" "$ID" 400000)
echo "== refund 0.40   invoice #$ID  $EXPLORER/tx/$REFUND"

cat > deployments/whitechain-sepolia.env <<EOF
WHITECHAIN_CHECKOUT=$CORE
WHITECHAIN_DEPLOY_BLOCK=$BLOCK
WHITECHAIN_PROOF_PAY_TX=$PAY
WHITECHAIN_PROOF_REFUND_TX=$REFUND
EOF
echo "== written deployments/whitechain-sepolia.env"
