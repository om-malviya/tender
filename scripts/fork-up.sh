#!/usr/bin/env bash
# Sets up a LOCAL copy of Unichain Sepolia with Tender deployed, and writes the settings to .env.fork.
# Nothing here touches the real testnet. Used by e2e-fork.sh (automated test) and dev-fork.sh (click around).
#   - starts anvil forked from Unichain Sepolia (unless something already listens on :8545)
#   - gives test accounts USDC (by writing the token's storage, only possible on a local fork)
#   - deploys DemoToken + UniswapCheckout and seeds the demo pools (the same scripts as the real testnet)
#   - gives the payer "wrong" tokens to pay with: 3 DEMO, 0.0003 WETH, 0.40 USDC
set -euo pipefail
cd "$(dirname "$0")/.."

FORK_URL=${FORK_URL:-https://sepolia.unichain.org}
RPC=http://127.0.0.1:8545
USDC=0x31d0220469e10c4E71834a79b1f276d740d3768F
WETH=0x4200000000000000000000000000000000000006
# anvil's well-known PUBLIC test keys (never use these anywhere real)
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
MERCHANT_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
PAYER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
MERCHANT=$(cast wallet address $MERCHANT_PK)
PAYER=$(cast wallet address $PAYER_PK)

mkdir -p .fork
if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  anvil --fork-url "$FORK_URL" --chain-id 31337 --port 8545 --silent >/dev/null 2>&1 &
  echo $! > .fork/anvil.pid
  for _ in $(seq 1 60); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
fi
echo "local fork of Unichain Sepolia on $RPC (block $(cast block-number --rpc-url $RPC))"

# Circle's USDC keeps balances in storage slot 9 (FiatTokenV2_2 balanceAndBlacklistStates).
set_usdc() { # address amount
  local slot; slot=$(cast index address "$1" 9)
  cast rpc anvil_setStorageAt $USDC "$slot" "$(cast to-uint256 "$2")" --rpc-url $RPC >/dev/null
  [ "$(cast call $USDC 'balanceOf(address)(uint256)' "$1" --rpc-url $RPC | awk '{print $1}')" = "$2" ] || { echo "USDC slot guess wrong"; exit 1; }
}
set_usdc "$(cast wallet address $DEPLOYER_PK)" 1000000000 # 1,000 USDC to seed pools
set_usdc "$MERCHANT" 50000000                             # 50 USDC so the merchant can refund
set_usdc "$PAYER" 400000                                  # 0.40 USDC of "leftover" for basket payments

cd contracts
forge script script/DeployUnichain.s.sol --rpc-url $RPC --private-key $DEPLOYER_PK --broadcast --slow -q >/dev/null
RUN=broadcast/DeployUnichain.s.sol/31337/run-latest.json
DEMO=$(jq -r '.transactions[] | select(.contractName=="DemoToken") | .contractAddress' $RUN)
CHECKOUT=$(jq -r '.transactions[] | select(.contractName=="UniswapCheckout") | .contractAddress' $RUN)
HOOK=$(jq -r '.transactions[] | select(.contractName=="CheckoutHook") | .contractAddress' $RUN)
[ -n "$HOOK" ] && [ "$HOOK" != "null" ] || { echo "hook address not found in broadcast"; exit 1; }
DEPLOY_BLOCK=$(($(jq -r '.receipts[0].blockNumber' $RUN)))
DEMO=$DEMO HOOK=$HOOK forge script script/SeedPools.s.sol --rpc-url $RPC --private-key $DEPLOYER_PK --broadcast --slow 2>&1 | grep -E "created pool|already existed" || true
cd ..

# the payer's wallet: tokens the store doesn't take directly
cast send $DEMO "mint(address,uint256)" $PAYER 3000000000000000000 --private-key $PAYER_PK --rpc-url $RPC >/dev/null
cast send $WETH "deposit()" --value 0.0003ether --private-key $PAYER_PK --rpc-url $RPC >/dev/null

# ===================== Whitechain Sepolia (local copy on :8546) =====================
# Keeps the real chain id (1874) so the USDT permit signature domain matches the real token's.
WC_FORK_URL=${WC_FORK_URL:-https://rpc.testnet.whitechain.io/}
WC_RPC=http://127.0.0.1:8546
USDT=0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7
if ! cast chain-id --rpc-url $WC_RPC >/dev/null 2>&1; then
  anvil --fork-url "$WC_FORK_URL" --port 8546 --silent >/dev/null 2>&1 &
  echo $! > .fork/anvil-wc.pid
  for _ in $(seq 1 60); do cast chain-id --rpc-url $WC_RPC >/dev/null 2>&1 && break; sleep 0.5; done
fi
echo "local fork of Whitechain Sepolia on $WC_RPC (block $(cast block-number --rpc-url $WC_RPC))"

# Whitechain's USDT is a proxy whose storage layout isn't published, so find each balance slot first.
set_usdt() { # address amount
  local slot
  slot=$(cd contracts && forge script script/FindBalanceSlot.s.sol --rpc-url $WC_RPC --sig "run(address,address)" $USDT "$1" 2>&1 | grep -A1 BALANCE_SLOT | tail -1 | xargs)
  cast rpc anvil_setStorageAt $USDT "$slot" "$(cast to-uint256 "$2")" --rpc-url $WC_RPC >/dev/null
  [ "$(cast call $USDT 'balanceOf(address)(uint256)' "$1" --rpc-url $WC_RPC | awk '{print $1}')" = "$2" ] || { echo "USDT balance write failed"; exit 1; }
}
set_usdt "$PAYER" 5000000      # 5 USDT
set_usdt "$MERCHANT" 50000000  # 50 USDT for refunds

# CheckoutCore with Whitechain's required compiler settings (solc 0.8.30, prague). `forge create` doesn't
# write broadcast files, so a local run never mixes with records of a real Whitechain deployment.
cd contracts
WC_OUT=$(FOUNDRY_PROFILE=whitechain forge create src/CheckoutCore.sol:CheckoutCore --skip test --skip TenderFixture \
  --rpc-url $WC_RPC --private-key $DEPLOYER_PK --broadcast --constructor-args "[$USDT]" 0x0000000000000000000000000000000000000000 2>&1)
cd ..
WC_CHECKOUT=$(echo "$WC_OUT" | awk '/Deployed to:/{print $3}')
WC_TX=$(echo "$WC_OUT" | awk '/Transaction hash:/{print $3}')
[ -n "$WC_CHECKOUT" ] || { echo "$WC_OUT"; exit 1; }
WC_DEPLOY_BLOCK=$(cast receipt "$WC_TX" blockNumber --rpc-url $WC_RPC)
echo "deployed CheckoutCore on Whitechain fork: $WC_CHECKOUT"

cat > .env.fork <<EOF
WHITECHAIN_SEPOLIA_RPC=$WC_RPC
WHITECHAIN_CHECKOUT=$WC_CHECKOUT
WHITECHAIN_DEPLOY_BLOCK=$WC_DEPLOY_BLOCK
UNICHAIN_SEPOLIA_RPC=$RPC
UNICHAIN_CHAIN_ID=31337
UNICHAIN_CHECKOUT=$CHECKOUT
UNICHAIN_HOOK=$HOOK
UNICHAIN_SWAP_ROUTER=0x9140a78c1a137c7ff1c151ec8231272af78a99a4
UNICHAIN_DEPLOY_BLOCK=$DEPLOY_BLOCK
DEMO=$DEMO
MERCHANT_PK=$MERCHANT_PK
PAYER_PK=$PAYER_PK
DEMO_MERCHANT=$MERCHANT
DEV_WALLET_ACCOUNTS=$PAYER,$MERCHANT
SHOP_URL=http://localhost:8788
TENDER_APP_URL=http://localhost:5173
EOF
echo "deployed UniswapCheckout $CHECKOUT, CheckoutHook $HOOK, DemoToken $DEMO -> settings in .env.fork"
