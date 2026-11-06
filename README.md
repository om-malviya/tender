# Tender

**Pay with any token. The merchant gets the exact amount.**

A merchant creates an invoice for an exact stablecoin amount. The customer pays with any token they hold: Tender ranks every Uniswap v4 route by true cost, runs an exact-output swap, sends the merchant exactly the invoice amount, and returns the unused input to the payer in the same transaction. A Uniswap v4 **hook** lets *any* router pay an invoice just by swapping through the pool. The same merchant takes USDT on **Whitechain** (invoices, partial refunds, CSV export) and sells to AI agents per request over **x402 on Hedera**, all in one ledger.

ETHGlobal Mumbai 2026 · solo submission · tracks: Uniswap Foundation (Build with Uniswap), Whitechain (Operate), Hedera (AI Agents That Pay: x402).

- Demo video: _[link after recording]_
- Live app: _[link after deployment]_ · Demo shop: _[link]_
- Build timeline: see [Build timeline](#build-timeline) (the team had a conference clash and informed the organisers; work started before kickoff and is documented commit by commit).

## Deployed contracts and proof

| Network | Contract | Address | Proof |
|---|---|---|---|
| Unichain Sepolia (1301) | `UniswapCheckout` | _TBD_ | any-token payment tx: _TBD_ |
| Unichain Sepolia (1301) | `CheckoutHook` (v4 hook) | _TBD_ | payment via a generic router through the hooked pool: _TBD_ |
| Unichain Sepolia (1301) | `DemoToken` | _TBD_ | |
| Whitechain Sepolia (1874) | `CheckoutCore` (verified) | _TBD_ | USDT payment: _TBD_ · partial refund: _TBD_ |
| Hedera testnet | x402 endpoint `GET /api/agent/dataset` | facilitator: Blocky402 | settled payment: _TBD_ (HashScan: _TBD_) |

Uniswap contracts used (not ours): v4 PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`, v4 Quoter `0x56DCD40A3F2d466F48e7F48bDBE5Cc9B92Ae4472`, PoolSwapTest router `0x9140a78c1a137c7ff1c151ec8231272af78a99a4`, Circle USDC `0x31d0220469e10c4E71834a79b1f276d740d3768F`. Whitechain USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`.

## Where we use each sponsor (for reviewers)

**Uniswap v4**
- Exact-output multi-hop swap directly on the PoolManager (unlock → swap backwards per hop → settle → take to the merchant): [`contracts/src/UniswapCheckout.sol`](contracts/src/UniswapCheckout.sol) `_exactOutCallback` (L237–254), `_swapExactOut` (L280), `_settle` (L300), `_poolKey` (L309).
- Basket payments (several tokens, one invoice, exact-input legs in one unlock): `payWithBasket` (L140), `_basketCallback` (L257).
- **CheckoutHook**, a v4 hook (`afterSwap` + `afterSwapReturnDelta`) that settles an invoice from inside any router's swap: [`contracts/src/CheckoutHook.sol`](contracts/src/CheckoutHook.sol) `afterSwap` (L63–88). Address mining for the hook: [`contracts/script/DeployUnichain.s.sol`](contracts/script/DeployUnichain.s.sol) `_mineSalt` (L60).
- v4 Quoter for route ranking: [`packages/core/src/quoter.ts`](packages/core/src/quoter.ts) `onchainQuoter` (L69). Trading API: [`packages/core/src/tradingApi.ts`](packages/core/src/tradingApi.ts).
- Ranking, impact-sized slippage, split routing, hook routes: [`packages/core/src/rank.ts`](packages/core/src/rank.ts) (`bufferForImpact` L70, hook routes L157, split L190).
- Pools seeded on Unichain Sepolia (plain + hooked): [`contracts/script/SeedPools.s.sol`](contracts/script/SeedPools.s.sol).
- Feedback: [`FEEDBACK.md`](FEEDBACK.md).

**Whitechain**
- `CheckoutCore` (invoices, `payInvoice`, `payInvoiceWithPermit`, partial `refund`, `cancel`): [`contracts/src/CheckoutCore.sol`](contracts/src/CheckoutCore.sol). Compiled with solc 0.8.30 / prague for explorer verification (`[profile.whitechain]` in [`contracts/foundry.toml`](contracts/foundry.toml)).
- Drop-in widget (one `<script>` + one call): [`app/public/tender.js`](app/public/tender.js). The demo shop's whole integration is 23 lines: [`demo-shop/public/index.html`](demo-shop/public/index.html) (from the "Tender integration" comment).
- Merchant view (invoices on both chains, refund, cancel, CSV): [`app/src/pages/MerchantPage.tsx`](app/src/pages/MerchantPage.tsx); CSV: [`packages/core/src/csv.ts`](packages/core/src/csv.ts).
- **Why on-chain stablecoin settlement on Whitechain:** the merchant is paid in USDT with finality in seconds, straight into their own wallet, with a public receipt the customer can verify and refunds that leave an on-chain record. A card or bank rail can't give a small merchant final settlement, no chargeback reversals, a verifiable receipt and an exportable ledger from the same payment.
- Feedback: [`WHITECHAIN_FEEDBACK.md`](WHITECHAIN_FEEDBACK.md).

**Hedera x402**
- Paywalled endpoint (`@x402/hono` + Hedera exact scheme, facilitator Blocky402): [`demo-shop/server/app.ts`](demo-shop/server/app.ts) (the `paymentMiddleware` block). Discovery manifest: `/.well-known/tender.json`.
- Autonomous agent with spending controls (allowlist, per-merchant cap, total budget, human approval above a threshold): [`agent/src/run.ts`](agent/src/run.ts), policy in [`agent/src/policy.ts`](agent/src/policy.ts), limits in [`agent/policy.json`](agent/policy.json).
- Settles in HTS USDC (`0.0.429274`). Sales appear in the merchant dashboard from the mirror node: [`packages/core/src/hedera.ts`](packages/core/src/hedera.ts).

## Architecture

```
demo-shop (:8788)  ── invoice via merchant key ──►  CheckoutCore / UniswapCheckout (Unichain, Whitechain)
   │ widget popup                                        ▲ payWithToken / payWithBasket / payInvoice
   ▼                                                     │
app (:5173) ──/api/rank──► server (:8787, read-only) ──► v4 Quoter [+ Trading API]
   │                                                     ▲ events (getLogs) → dashboard, CSV
   └── hook route: generic v4 router ── swap(hookData) ──► hooked pool ── CheckoutHook ── merchant
agent/ ── 402 ──► demo-shop x402 paywall ──► Blocky402 facilitator ──► Hedera testnet (USDC)
```

Full walkthrough, design trade-offs and backlog: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Guarantees enforced on-chain** (every one tested): the merchant receives exactly the invoice amount; the contract holds zero tokens after every call; the payer never spends more than `maxAmountIn`; refunds never exceed the amount and only go to the original payer; no owner, no admin, no upgrade.

## Run it locally (no keys, no faucets)

```bash
npm install
cd contracts && forge install && forge test && cd ..     # 41 Solidity tests, incl. a real v4 PoolManager
npx vitest run                                            # 37 TypeScript tests
bash scripts/e2e-fork.sh                                  # end-to-end on local copies of Unichain + Whitechain
bash scripts/dev-fork.sh                                  # the whole product: http://localhost:5173 and :8788
```

`dev-fork.sh` starts anvil forks of both testnets (real Uniswap, real USDC/USDT), deploys with the same scripts used for the real testnets, funds two dev wallets, and runs the API, the shop and the app. In the app, "Connect wallet" offers *Dev wallet (payer)* and *Dev wallet (merchant)*.

Deploy for real: `.env.example` lists every variable; scripts are `contracts/script/DeployUnichain.s.sol`, `SeedPools.s.sol`, `DeployWhitechain.s.sol`.

## Tests

- **Foundry (41):** unit tests for every revert path, fuzz (1,000 runs), invariants (256 runs × 64 calls), swap tests against a real v4 PoolManager deployed in the test, hook tests through Uniswap's own router.
- **Vitest (35):** ranker, basket, Trading API parser, CSV, Hedera parsing, API, shop guards, agent policy.
- **End-to-end:** `e2e/fork.e2e.ts` (Unichain: invoice → ranking → swap payment → hook payment → basket → refund → CSV), `e2e/whitechain.e2e.ts` (USDT: approve+pay, permit pay, refund, CSV), `e2e/ui.e2e.ts` (headless browser: landing → shop → checkout → pay → shop confirms → Whitechain → merchant refund).

Gas (from `forge test --gas-report`): `payWithToken` ~200k (1 hop) / ~250k (2 hops); basket ~130k per leg; hook swap ~180k; `createInvoice` ~147k.

## Threat model and what we don't solve

Handled: reentrancy (CEI + `nonReentrant`), fee-on-transfer tokens (balance checks), sandwich/price moves (`maxAmountIn` + deadline, whole tx reverts), malicious hooks (only hook-free pools in `payWithToken`; our own hook is the only hooked route), double payment, refund abuse, stuck funds, leftover approvals (exact amounts), broken pools (vetted allowlist), fake "paid" messages (origin check + on-chain confirmation by the shop), gas-burning invoice spam (token + rate limit).

Not solved, said plainly: testnet liquidity is our own seeded pools; the hook settles exact-input swaps only (v4 lets a hook adjust only the unspecified currency); the hook's `payer` field is unverified (it only decides where refunds go); the agent's spending policy is enforced in its own code, not on-chain; the demo shop holds a merchant testnet key to create invoices (off-chain signed invoices are the next step); Whitechain customers still pay WBT gas; no subscriptions.

## Built with AI

See [`AI_USAGE.md`](AI_USAGE.md): which tools, which parts, and which decisions were made by the team. Planning artifacts are in `docs/`.

## Build timeline

- Nov 4: plan and research; contracts (`CheckoutCore`, `UniswapCheckout`), 31 Foundry tests; core ranker, API, shop server, agent; local-fork end-to-end.
- Nov 5: frontend; Whitechain tested on a local fork (permit confirmed); hardcoded values removed.
- Nov 6: `CheckoutHook` + address mining; impact-sized slippage and split routing; frontend second pass (Linear + MetaMask direction), landing page; docs.
- Nov 6–7: testnet deployments, real payments, submission.

Commit history is the detailed record.

## License

MIT, see [`LICENSE`](LICENSE).
