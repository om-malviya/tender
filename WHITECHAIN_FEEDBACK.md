# Whitechain feedback (Tender, ETHGlobal Mumbai 2026)

Honest notes from building a USDT checkout on Whitechain Sepolia.

## What worked
- **Plain EVM, no surprises.** Foundry deploy and the same `CheckoutCore` contract we use on Unichain ran unchanged. Multicall3 is at the standard address.
- **The explorer verification instructions are precise** (solc 0.8.30, `evm_version = prague`, `--verifier blockscout --verifier-url .../api/`). A separate Foundry profile was enough.
- **Your USDT supports EIP-2612 permit.** We pay an invoice in one transaction with a signature. The signing domain is name `"Tether USD"`, version `"1"`, chain 1874: we had to derive this by matching `DOMAIN_SEPARATOR()`.
- The public RPC accepted 5,000-block `getLogs` ranges, which made event-based history easy.

## Where we got stuck
1. **Getting test USDT.** The prize requires payments in `0xcedf…55a7`, but neither the prize page nor the faucet page says how to obtain it. The faucet only mentions a GitHub login and one drip per account. We tested the whole flow on a local anvil fork by writing the token's storage slot (found with Foundry's `stdStorage`, because the token is a proxy without a published layout). _[Update after we find the real source.]_
2. **USDT permit details aren't documented.** `version()` and `eip712Domain()` revert on the token, so we had to brute-force the domain (name/version) against `DOMAIN_SEPARATOR()`. A line in the docs ("USDT supports permit; domain name X, version Y") would save every team an hour.
3. **The faucet page doesn't say what it dispenses** (WBT? USDT? how much?).

## What the docs were missing
- A "testnet assets" page: USDT address (it is on the prize page, not the docs), how to get it, permit support, decimals.
- The chain ID and RPC on the deploy pages themselves (they live on a separate network-reference page).

## The one improvement with the greatest impact
A one-click faucet that gives **both WBT and test USDT**, with the token's permit domain printed next to it.

## Time to first success
About 1.5 hours from "fork Whitechain" to a passing end-to-end run (invoice → approve + pay → permit pay → refund → CSV), most of it on the USDT storage slot and the permit domain.
