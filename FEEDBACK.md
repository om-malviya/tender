# Uniswap developer feedback (Tender, ETHGlobal Mumbai 2026)

Notes written while building, not reconstructed at the end. Tender pays merchant invoices with any token via
exact-output swaps on the v4 PoolManager (Unichain Sepolia), and ranks routes with the v4 Quoter and the Trading API.

## What worked well
- **v4-core's `Deployers` test helper** is excellent. One call gives a real PoolManager plus helper routers, so all
  of our swap logic (single-hop, two-hop exact output, exact-input baskets) is tested locally in milliseconds. 31 Foundry tests.
- **Flash accounting** made our contract simpler than expected: swap each hop, `sync` + transfer + `settle` the
  input, then `take` the output straight to the merchant. Intermediate tokens net to zero without ever being transferred.
- **The Quoter on Unichain Sepolia** answered exactly as documented once we had the struct right, and failing quotes
  for missing pools are cheap to detect.
- Deployment addresses for every testnet on one page saved time.

## Where we got stuck
1. **Testnet pools with absurd prices.** On Unichain Sepolia, the existing 0.30% WETH/USDC pool prices WETH at
   trillions of dollars, and the 0.05% pool at ~$1,000–1,200. A naive "search every fee tier" router happily routes
   through the broken pool, and any USD valuation derived from it explodes. We only found this by running our ranker
   against a fork, and ended up adding a vetted-pool allowlist. A note in the docs that testnet pools are unvetted,
   or a list of "known-good" testnet pools, would help hackathon teams.
2. **`PathKey.intermediateCurrency` means different things for exact input and exact output.** For exact output the
   path is walked backwards and `intermediateCurrency` is each hop's *input*; for exact input it's each hop's *output*.
   It's correct, but easy to get wrong, and the docs only show single-hop examples. A worked multi-hop example for each
   direction would have saved us an hour.
3. **PoolManager size in local tests.** Compiling v4-core without via-IR makes PoolManager larger than EIP-170 allows,
   so test contracts that deploy it fail with `CreateContractSizeLimit` until you raise Foundry's `code_size_limit`.
   A one-line note in the v4 testing guide would help.
4. **Docs URLs redirect to `llms.mdx` pages** (HTTP 303), which broke some of our tooling's fetches.
5. **Trading API on testnets:** the docs list Unichain Sepolia as supported, but don't say whether `EXACT_OUTPUT`
   is supported there or what the classic quote's `route` field looks like for v4 pools (hooks, tickSpacing).
   [To fill in after testing with our API key.]

## One concrete improvement
Publish, per testnet, a short list of pools that Uniswap keeps at sane prices with real liquidity (e.g. WETH/USDC
0.05% on Unichain Sepolia), so routers and demos have something trustworthy to point at.

## Time to first successful swap
About an hour from `forge install` to a passing two-hop exact-output test against a local PoolManager; most of
it went on the `PathKey` direction question above.
