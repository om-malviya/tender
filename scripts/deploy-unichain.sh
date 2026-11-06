#!/usr/bin/env bash
# Deploy Tender to Unichain Sepolia and produce the proof links for the README.
#   1. DemoToken + UniswapCheckout + CheckoutHook (mined address)
#   2. seed the demo pools (plain + hooked)
#   3. a real any-token payment (payWithToken) and a real hook payment (generic router)
# Needs in .env: DEPLOYER_PK, UNICHAIN_SEPOLIA_RPC (optional). Funding: LITE=1 (default) fits one day of
# faucets, ~0.01 ETH + ~15 USDC, with 0.10 USDC proof invoices; LITE=0 is the full profile (~0.12 ETH, ~50 USDC).
# Usage: bash scripts/deploy-unichain.sh            (writes deployments/unichain-sepolia.env + proof links)
#        RPC=http://127.0.0.1:8545 CHAIN_ID=31337 bash scripts/deploy-unichain.sh   (dry run on a local fork)
set -euo pipefail
cd "$(dirname "$0")/.."
# .env fills in what isn't set, but never overrides a key/RPC passed on the command line (fork rehearsals)
ARG_PK=${DEPLOYER_PK:-}
[ -f .env ] && { set -a; source .env; set +a; }
[ -n "$ARG_PK" ] && DEPLOYER_PK=$ARG_PK
RPC=${RPC:-${UNICHAIN_SEPOLIA_RPC:-https://sepolia.unichain.org}}
CHAIN_ID=${CHAIN_ID:-1301}
EXPLORER=${UNICHAIN_EXPLORER:-https://sepolia.uniscan.xyz}
USDC=${UNICHAIN_USDC:-0x31d0220469e10c4E71834a79b1f276d740d3768F}
WETH=0x4200000000000000000000000000000000000006
ROUTER=0x9140a78c1a137c7ff1c151ec8231272af78a99a4
LITE=${LITE:-1}
if [ "$LITE" = "1" ]; then INVOICE=100000; HOOK_IN=100000000000000000; else INVOICE=1000000; HOOK_IN=2000000000000000000; fi  # 0.10 / 1.00 USDC; DEMO in for the hook swap
: "${DEPLOYER_PK:?set DEPLOYER_PK in .env}"
DEPLOYER=$(cast wallet address "$DEPLOYER_PK")
mkdir -p deployments

echo "== deployer $DEPLOYER on chain $(cast chain-id --rpc-url "$RPC")"
echo "   ETH  $(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether) · USDC $(cast call $USDC 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC" | awk '{printf "%.2f", $1/1e6}')"

# 1. contracts
cd contracts
forge script script/DeployUnichain.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_PK" --broadcast --slow --timeout 300 -q >/dev/null
RUN="broadcast/DeployUnichain.s.sol/$CHAIN_ID/run-latest.json"
DEMO=$(jq -r '.transactions[] | select(.contractName=="DemoToken") | .contractAddress' "$RUN")
CHECKOUT=$(jq -r '.transactions[] | select(.contractName=="UniswapCheckout") | .contractAddress' "$RUN")
HOOK=$(jq -r '.transactions[] | select(.contractName=="CheckoutHook") | .contractAddress' "$RUN")
DEPLOY_BLOCK=$(jq -r '.receipts[0].blockNumber' "$RUN")
echo "== deployed  UniswapCheckout $CHECKOUT · CheckoutHook $HOOK · DemoToken $DEMO (block $((DEPLOY_BLOCK)))"

# 2. pools
LITE=$([ "$LITE" = "1" ] && echo true || echo false) DEMO=$DEMO HOOK=$HOOK forge script script/SeedPools.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_PK" --broadcast --slow 2>&1 | grep -E "created pool|already existed" | sed 's/^/   /'
cd ..

# 3. proof payments, made by the deployer acting as both merchant and payer (testnet demo)
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
tx "$DEMO" "mint(address,uint256)" "$DEPLOYER" 5000000000000000000 >/dev/null
ID1=$(new_invoice "$CHECKOUT" "$USDC" "$INVOICE" proof-any-token)
tx "$DEMO" "approve(address,uint256)" "$CHECKOUT" 2000000000000000000 >/dev/null
TX1=$(tx "$CHECKOUT" "payWithToken(uint256,address,uint256,(address,uint24,int24)[],uint256)" "$ID1" "$DEMO" 2000000000000000000 "[($DEMO,3000,60),($WETH,500,10)]" $(( $(date +%s) + 3600 )))
echo "== any-token payment  invoice #$ID1  $EXPLORER/tx/$TX1"

ID2=$(new_invoice "$CHECKOUT" "$USDC" "$INVOICE" proof-hook)
tx "$DEMO" "approve(address,uint256)" "$ROUTER" 2000000000000000000 >/dev/null
# token order decides the pool key (currency0 < currency1) and the swap direction; lower-cased for comparison (bash 3 has no ${var,,})
if [[ "$(echo "$DEMO" | tr A-Z a-z)" < "$(echo "$USDC" | tr A-Z a-z)" ]]; then C0=$DEMO; C1=$USDC; Z4O=true; LIMIT=4295128740; else C0=$USDC; C1=$DEMO; Z4O=false; LIMIT=1461446703485210103287273052203988822378723970341; fi
HOOKDATA=$(cast abi-encode "f(uint256,address)" "$ID2" "$DEPLOYER")
TX2=$(tx "$ROUTER" "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)" "($C0,$C1,3000,60,$HOOK)" "($Z4O,-$HOOK_IN,$LIMIT)" "(false,false)" "$HOOKDATA")
echo "== hook payment       invoice #$ID2  $EXPLORER/tx/$TX2  (paid through Uniswap's PoolSwapTest router, not our contract)"
# getInvoice returns (merchant, settleToken, amount, expiry, status, payer, refunded, orderRef): status is field 5
STATUS=$(cast call "$CHECKOUT" "getInvoice(uint256)((address,address,uint256,uint64,uint8,address,uint256,bytes32))" "$ID2" --rpc-url "$RPC" | tr -d '()' | awk -F', ' '{print $5}')
[ "$STATUS" = "2" ] && echo "   invoice #$ID2 is Paid (settled by the hook)" || { echo "   invoice #$ID2 status=$STATUS (expected Paid)"; exit 1; }

cat > "deployments/unichain-sepolia.env" <<EOF
UNICHAIN_SEPOLIA_RPC=$RPC
UNICHAIN_CHECKOUT=$CHECKOUT
UNICHAIN_HOOK=$HOOK
UNICHAIN_DEPLOY_BLOCK=$((DEPLOY_BLOCK))
DEMO=$DEMO
DEMO_MERCHANT=$DEPLOYER
# proof
UNICHAIN_PROOF_ANY_TOKEN_TX=$TX1
UNICHAIN_PROOF_HOOK_TX=$TX2
EOF
echo "== written deployments/unichain-sepolia.env"
