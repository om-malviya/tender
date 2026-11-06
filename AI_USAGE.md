# How AI was used (ETHGlobal rule: "clearly document where and how AI tools were used")

**Tool:** Claude Code (Anthropic), used as a pair programmer throughout. The team member who led Tender is new to Solidity and web3; every contract and function was explained line by line and is documented in `docs/study_B.md` so the team can defend it at the booth.

## What AI drafted
- First drafts of all Solidity (`CheckoutCore`, `UniswapCheckout`, `CheckoutHook`, scripts) and their tests.
- The TypeScript core (ranker, basket builder, event history, CSV, Hedera, routers), the API server, the demo shop, the agent, the frontend, and the end-to-end test scripts.
- Research summaries of the sponsor prize pages, Uniswap v4 / Whitechain / Hedera x402 docs, and the comparison with Universal Router, 0x Swap-and-Send and Coinbase Commerce OPP.
- The documents in this repo, including this one.

## What the team decided (not the AI)
- The product itself: exact-output any-token checkout, the three rails, "the merchant gets the exact amount" as the guarantee.
- Choosing option B2 (route-ranked checkout) over a v4 hook-only project; later adding the **CheckoutHook** specifically to differ from the three existing products, after reviewing that comparison.
- Solidity as the core, and building before kickoff because of a conference clash (organisers informed).
- Design direction: Linear + MetaMask, dark theme, one accent chosen by comparing renders, fewer colours, neon "tickets" on the landing page, stepped review checkout.
- Scope and cut order (Uniswap first, Whitechain, then Hedera), and which backlog items to build.
- No login system (wallet signatures and on-chain checks are the authorization), with a token + rate limit on the one gas-spending endpoint.

## Verification that is not AI
- 41 Foundry tests, including swaps against a real Uniswap v4 PoolManager deployed in the test, fuzz and invariant suites.
- 35 Vitest tests.
- End-to-end runs on local anvil forks of Unichain Sepolia and Whitechain Sepolia with the real Uniswap, USDC and USDT contracts, which caught five real bugs (broken testnet pool prices, a 1,000-block `getLogs` cap, Multicall3 missing from the Whitechain chain definition, a block-number cache hiding refunds, hooked-pool quotes leaking into basket legs).
- A headless-browser test that clicks through shop → checkout → pay → refund.
- Live checks against the real Hedera facilitator (402 price tag) and the real testnet RPCs.

## Planning artifacts (in the repo, as the rule asks)
- `docs/PLAN_B.md`: the plan, with verified/unverified labels and the decisions log.
- `docs/ARCHITECTURE.md`: infrastructure, trade-offs, backlog.
- `docs/study_B.md`: the human's study guide and build log with line-by-line links.
- `FEEDBACK.md`, `WHITECHAIN_FEEDBACK.md`: sponsor feedback written while building.
