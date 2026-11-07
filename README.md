# Tender

**Pay with any token. The merchant gets the exact amount.**

A merchant creates an invoice for an exact stablecoin amount. The customer pays with any token they hold: Tender ranks every Uniswap v4 route by true cost, runs an exact-output swap, sends the merchant exactly the invoice amount, and returns the unused input to the payer in the same transaction. A Uniswap v4 **hook** lets *any* router pay an invoice just by swapping through the pool. The same merchant takes USDT on **Whitechain** (invoices, partial refunds, CSV export) and sells to AI agents per request over **x402 on Hedera**, all in one ledger.

ETHGlobal Mumbai 2026 · solo project · built by [om-malviya](https://github.com/om-malviya) · tracks: Uniswap Foundation (Build with Uniswap), Whitechain (Operate), Hedera (AI Agents That Pay: x402).

- Demo video: _[link]_ (script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md))
- Website: [tender.tender-app.workers.dev](https://tender.tender-app.workers.dev) (the landing page; the app pages need the API, which isn't hosted: run the full app with `bash scripts/dev-fork.sh`, or against the live testnets with `bash scripts/live-local.sh`)
- Build timeline: see [Build timeline](#build-timeline) (the author had a conference clash and informed the organisers; work started before kickoff and is documented commit by commit).

## Deployed contracts and proof

| Network | Contract | Address | Proof |
|---|---|---|---|
| Unichain Sepolia (1301) | `UniswapCheckout` (verified) | [`0x013a…5795`](https://unichain-sepolia.blockscout.com/address/0x013afebd608074993d87c299952116b5c3135795) | any-token payment, invoice #1 paid in DEMO via DEMO→WETH→USDC, merchant got exactly 0.10 USDC: [`0x7dc679a8…`](https://unichain-sepolia.blockscout.com/tx/0x7dc679a80d3a49daa3f96a6d2e80f96af9efc23df5592d6a671af78da9f52fe9) |
| Unichain Sepolia (1301) | `CheckoutHook` (v4 hook, verified) | [`0x40a7…8044`](https://unichain-sepolia.blockscout.com/address/0x40a7409c828e62e4278ff8e4a9f30bc6ecf88044) | invoice #2 paid through Uniswap's `PoolSwapTest` router; the hook settled it: [`0x5445265c…`](https://unichain-sepolia.blockscout.com/tx/0x5445265c0fdbb79c5afc4f745dd9d1b3df5418584ad471f6389fb424cec857a8) |
| Unichain Sepolia (1301) | `DemoToken` (verified) | [`0x29ad…339c`](https://unichain-sepolia.blockscout.com/address/0x29adcdf890ad23c7877f51a4005555a93cea339c) | the "wrong token" payers hold; demo pools: DEMO/WETH, DEMO/USDC (thin), WETH/USDC, plus two hooked pools |
| Whitechain Sepolia (1874) | `CheckoutCore` (verified) | [`0x013a…5795`](https://explorer.testnet.whitechain.io/address/0x013aFEBD608074993D87C299952116b5c3135795) | USDT payment (1.00): [`0x41485818…`](https://explorer.testnet.whitechain.io/tx/0x41485818a21c88008ffbdee188c142278a0d2686068e65e707a25e53a655de64) · partial refund (0.40): [`0x798631d4…`](https://explorer.testnet.whitechain.io/tx/0x798631d466d2c2c43662b1ba7eade7f36ca9404b32ce5204b95a234f7d8dd710) · one-signature permit payment (0.50): [`0x9620ce57…`](https://explorer.testnet.whitechain.io/tx/0x9620ce57304e80ec33ca18143560688409e5f4793a121ad7b62aa791c576ccf1) |
| Hedera testnet | x402 endpoint `GET /api/agent/dataset` (merchant `0.0.11344182`) | facilitator: Blocky402 (`0.0.7162784` pays the fees) | agent purchases settled with no human: [`0.0.7162784@1793996113.115144711`](https://hashscan.io/testnet/transaction/0.0.7162784@1793996113.115144711), [`0.0.7162784@1793996119.194396627`](https://hashscan.io/testnet/transaction/0.0.7162784@1793996119.194396627); third purchase **refused** by the spending policy; every decision in HCS audit topic [`0.0.11345065`](https://hashscan.io/testnet/topic/0.0.11345065) |

Uniswap contracts used (not ours): v4 PoolManager `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`, v4 Quoter `0x56DCD40A3F2d466F48e7F48bDBE5Cc9B92Ae4472`, PoolSwapTest router `0x9140a78c1a137c7ff1c151ec8231272af78a99a4`, Circle USDC `0x31d0220469e10c4E71834a79b1f276d740d3768F`. Whitechain USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`.

## Where we use each sponsor (for reviewers)

Every link opens the exact lines on GitHub.

**Uniswap v4**
- **Exact-output payment straight on the PoolManager**, in [`contracts/src/UniswapCheckout.sol`](contracts/src/UniswapCheckout.sol): [`payWithToken` L80–96](contracts/src/UniswapCheckout.sol#L80-L96) (entry, the payer's price cap), [`unlockCallback` L229–234](contracts/src/UniswapCheckout.sol#L229-L234) (only the PoolManager may call it), [`_exactOutCallback` L239–256](contracts/src/UniswapCheckout.sol#L239-L256) (unlock → swap each hop backwards with exact output → `settle` the input → `take` the USDC straight to the merchant), [`_payExactOut` L106–133](contracts/src/UniswapCheckout.sol#L106-L133) (asserts the merchant got exactly the amount and the contract kept nothing), helpers [`_swapExactOut` L282–289](contracts/src/UniswapCheckout.sol#L282-L289), [`_settle` L302–307](contracts/src/UniswapCheckout.sol#L302-L307), [`_poolKey` L311–322](contracts/src/UniswapCheckout.sol#L311-L322).
- **Basket payments** (several tokens, one invoice, one unlock): [`payWithBasket` L142–156](contracts/src/UniswapCheckout.sol#L142-L156), [`_basketCallback` L259–279](contracts/src/UniswapCheckout.sol#L259-L279), [`_payMerchantAndReturnExcess` L200–208](contracts/src/UniswapCheckout.sol#L200-L208); planner [`buildBasket` L33–90](packages/core/src/basket.ts#L33-L90) in [`basket.ts`](packages/core/src/basket.ts).
- **CheckoutHook**, a v4 hook (`afterSwap` + `afterSwapReturnDelta`) that settles an invoice from inside any router's swap, in [`contracts/src/CheckoutHook.sol`](contracts/src/CheckoutHook.sol): [`afterSwap` L63–89](contracts/src/CheckoutHook.sol#L63-L89), permissions checked at deploy [`constructor` L36–58](contracts/src/CheckoutHook.sol#L36-L58); the invoice side [`settleFromHook` L158–166](contracts/src/CheckoutCore.sol#L158-L166) in `CheckoutCore.sol`; hook address mining [`_mineSalt` L60–68](contracts/script/DeployUnichain.s.sol#L60-L68) in `DeployUnichain.s.sol`.
- **v4 Quoter** for ranking, batched through Multicall3: [`onchainQuoter` L74–121](packages/core/src/quoter.ts#L74-L121) in [`quoter.ts`](packages/core/src/quoter.ts). Trading API: [`tradingApi.ts`](packages/core/src/tradingApi.ts).
- **Ranking**: [`rankRoutes` L86–278](packages/core/src/rank.ts#L86-L278) in [`rank.ts`](packages/core/src/rank.ts); impact-sized buffer [`bufferForImpact` L70](packages/core/src/rank.ts#L70); hook routes [`hooked pools` L157](packages/core/src/rank.ts#L157); split routes [`split` L212](packages/core/src/rank.ts#L212); vetted pools only [`candidatePaths` L29–41](packages/core/src/paths.ts#L29-L41) in [`paths.ts`](packages/core/src/paths.ts).
- Pools seeded on Unichain Sepolia (plain + hooked): [`contracts/script/SeedPools.s.sol`](contracts/script/SeedPools.s.sol). Feedback: [`FEEDBACK.md`](FEEDBACK.md).

**Whitechain**
- **`CheckoutCore`** (deployed and verified on Whitechain Sepolia), in [`contracts/src/CheckoutCore.sol`](contracts/src/CheckoutCore.sol): [`createInvoice` L87–107](contracts/src/CheckoutCore.sol#L87-L107), [`payInvoice` L138–140](contracts/src/CheckoutCore.sol#L138-L140), [`payInvoiceWithPermit` L145–149](contracts/src/CheckoutCore.sol#L145-L149) (one signature, one transaction), [`refund` L111–121](contracts/src/CheckoutCore.sol#L111-L121) (partial, pulled from the merchant to the original payer, never more than paid), [`cancel` L124–131](contracts/src/CheckoutCore.sol#L124-L131). Compiled with solc 0.8.30 / prague for explorer verification (`[profile.whitechain]` in [`contracts/foundry.toml`](contracts/foundry.toml)).
- **Drop-in widget** (one `<script>` + one call): [`app/public/tender.js`](app/public/tender.js). The demo shop's whole integration is 23 lines: [`demo-shop/public/index.html` from L55](demo-shop/public/index.html#L55); the shop shows it on its own page.
- **Merchant view** (invoices on both chains, refund, cancel, CSV): [`app/src/pages/MerchantPage.tsx`](app/src/pages/MerchantPage.tsx); CSV [`toCsv` L29–31](packages/core/src/csv.ts#L29-L31), [`invoiceRows` L35–63](packages/core/src/csv.ts#L35-L63) in [`csv.ts`](packages/core/src/csv.ts).
- **Why on-chain stablecoin settlement on Whitechain:** the merchant is paid in USDT with finality in seconds, straight into their own wallet, with a public receipt the customer can verify and refunds that leave an on-chain record. A card or bank rail can't give a small merchant final settlement, no chargeback reversals, a verifiable receipt and an exportable ledger from the same payment.
- Feedback: [`WHITECHAIN_FEEDBACK.md`](WHITECHAIN_FEEDBACK.md).

**Hedera x402**
- **Paywalled endpoint** (`@x402/hono` + Hedera exact scheme, facilitator Blocky402): [`paymentMiddleware block` L46–66](demo-shop/server/app.ts#L46-L66) in [`demo-shop/server/app.ts`](demo-shop/server/app.ts). Discovery manifest: `/.well-known/tender.json`.
- **Autonomous agent with spending controls** (allowlist, per-merchant cap, total budget, human approval above a threshold): the policy [`decide` L34–45](agent/src/policy.ts#L34-L45) in [`agent/src/policy.ts`](agent/src/policy.ts), checked on the real 402 price right before signing [`onBeforePaymentCreation` L66–84](agent/src/run.ts#L66-L84) in [`agent/src/run.ts`](agent/src/run.ts); limits in [`agent/policy.json`](agent/policy.json).
- **HCS audit log** of every decision: [`audit` L30–41](agent/src/run.ts#L30-L41) in `run.ts`.
- Priced in HTS USDC (`0.0.429274`) by default; `X402_ASSET=hbar` prices the same endpoint in native HBAR at a set rate ([`requirementToUsd` L52–61](agent/src/policy.ts#L52-L61) on the agent side). **The live proof settled in HBAR**: Circle's Hedera testnet faucet wasn't delivering USDC to anyone on Nov 7 (we checked 2,500 recent transfers). The agent only accepts HBAR because its policy names a rate, and the x402 library's own spend controls cap each HBAR payment at the same limit.
- Agent sales (USDC and HBAR) appear in the merchant dashboard from the public mirror node: [`parseMirrorSales` L48–77](packages/core/src/hedera.ts#L48-L77) in [`hedera.ts`](packages/core/src/hedera.ts).

## Architecture

```
demo-shop (:8788)  ── invoice via merchant key ──►  CheckoutCore / UniswapCheckout (Unichain, Whitechain)
   │ widget popup                                        ▲ payWithToken / payWithBasket / payInvoice
   ▼                                                     │
app (:5173) ──/api/rank──► server (:8787, read-only) ──► v4 Quoter [+ Trading API]
   │                                                     ▲ events (getLogs) → dashboard, CSV
   └── hook route: generic v4 router ── swap(hookData) ──► hooked pool ── CheckoutHook ── merchant
agent/ ── 402 ──► demo-shop x402 paywall ──► Blocky402 facilitator ──► Hedera testnet (USDC or HBAR)
```

Full walkthrough, design trade-offs and backlog: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Guarantees enforced on-chain** (every one tested): the merchant receives exactly the invoice amount; the contract holds zero tokens after every call; the payer never spends more than `maxAmountIn`; refunds never exceed the amount and only go to the original payer; no owner, no admin, no upgrade.

## Run it locally (no keys, no faucets)

```bash
npm install
cd contracts && forge install && forge test && cd ..     # 44 Solidity checks (forge prints 41: 4 invariants run as one campaign)
npx vitest run                                            # 56 TypeScript tests
bash scripts/e2e-fork.sh                                  # end-to-end on local copies of Unichain + Whitechain
bash scripts/dev-fork.sh                                  # the whole product: http://localhost:5173 and :8788
```

`dev-fork.sh` starts anvil forks of both testnets (real Uniswap, real USDC/USDT), deploys with the same scripts used for the real testnets, funds two dev wallets, and runs the API, the shop and the app. In the app, "Connect wallet" offers *Dev wallet (payer)* and *Dev wallet (merchant)*.

Deploy for real: `.env.example` lists every variable; scripts are `contracts/script/DeployUnichain.s.sol`, `SeedPools.s.sol`, `DeployWhitechain.s.sol`.

## Hedera x402: setup and payment flow

**Setup** (Hedera testnet; nothing else needs to run):
1. Create a testnet account at [portal.hedera.com](https://portal.hedera.com) (ECDSA) for the **agent**, and put it in `.env`: `HEDERA_AGENT_ID=0.0.…`, `HEDERA_AGENT_KEY=…` (HEX or DER). Give it test USDC from [faucet.circle.com](https://faucet.circle.com) (Hedera Testnet), or use HBAR (see below).
2. A second account receives the payments: `HEDERA_MERCHANT_ID=0.0.…` (it only needs to exist and auto-associate tokens).
3. Run the whole live proof: `bash scripts/hedera-live.sh` (settles in USDC) or `X402_ASSET=hbar bash scripts/hedera-live.sh` (settles in native HBAR). It starts the shop with the paywall, runs the agent three times, and writes the HashScan ids to `deployments/hedera-testnet.env`.

**Payment flow** (one purchase, no human anywhere):
1. **Discover.** The agent reads the shop's `/.well-known/tender.json`: what's for sale, the price, the network.
2. **402.** It calls `GET /api/agent/dataset`. The paywall answers **HTTP 402** with the terms: amount, asset (USDC `0.0.429274` or HBAR `0.0.0`), the merchant's account, and the facilitator's fee-payer account (Blocky402, `0.0.7162784`).
3. **Policy, then sign.** Before signing, the agent converts the price to dollars and checks its spending policy: allowlist, per-merchant cap, total budget, human approval above a threshold. The x402 library's own spend controls cap the payment again. If anything fails, it stops and **nothing is signed**.
4. **Settle.** The agent signs a transfer to the merchant; the facilitator verifies it, submits it to Hedera and pays the network fee; the shop returns the data with the settled transaction id.
5. **Audit.** The agent writes the decision (`purchase` with the transaction id, or `refused` with the reason) to its HCS topic.
6. **Ledger.** The merchant dashboard reads the sale back from the public mirror node.

Live proof: two purchases settled, the third refused by the per-merchant cap, all in topic [`0.0.11345065`](https://hashscan.io/testnet/topic/0.0.11345065) (links in the table at the top).

## Tests

Every category has at least three independent checks, so a pass isn't a coincidence. **100 automated checks** (44 Foundry + 56 Vitest; `forge test` prints 41 because it runs the 4 invariants as one campaign), plus end-to-end runs and the live testnet proofs above.

| Category | Sponsor | Checks | What they prove | File |
|---|---|---|---|---|
| Invoice lifecycle | Whitechain | 15 | create / pay / permit-pay / refund / cancel, every revert path (expired, paid twice, not merchant, over-refund, wrong token) | `contracts/test/CheckoutCore.t.sol` |
| Any-token payment | Uniswap | 15 | exact-output swaps on a real v4 PoolManager: merchant gets exactly the amount for any invoice (fuzz, 1,000 runs), payer keeps the rest; 1- and 2-hop; baskets; a too-low max leaves the invoice open and the payer's funds untouched; deadline, expiry, bad path, missing pool, paying twice and non-PoolManager callbacks all refused; the 2-hop route beats a thin direct pool | `contracts/test/UniswapCheckout.t.sol` |
| CheckoutHook | Uniswap | 10 | invoices settled from inside Uniswap's own router (merchant gets exact, payer the rest); swaps without hook data stay ordinary; wrong token, underpay, exact-output, already-paid, and callers other than the PoolManager / hook all refused; hook sits at a valid v4 permission address | `contracts/test/CheckoutHook.t.sol` |
| Invariants | all | 4 | over 256 random runs × 64 calls: the contract holds nothing, merchant balances match the books, a refund implies a payment, refunds never exceed the amount | `contracts/test/Invariants.t.sol` |
| Route ranking | Uniswap | 9 | direct / quoter / hooked / split routes ranked by true cost; impact-sized buffers; split shown only when it wins | `packages/core/test/core.test.ts` |
| Route paths | Uniswap | 4 | candidate paths and v4 PathKey encoding for exact-in and exact-out | `packages/core/test/core.test.ts` |
| Vetted pools | Uniswap | 4 | only allowlisted pools are routed (wrong fee tier or tick spacing refused, like the broken WETH/USDC 0.30% testnet pool); hooked and plain pools never mix; the ranker never even quotes an unvetted pool | `packages/core/test/core.test.ts` |
| Basket builder | Uniswap | 4 | greedy legs always cover the invoice with guaranteed minimum outputs; legs that share a pool are quoted against each other's price impact (replayed on a stateful AMM) | `packages/core/test/core.test.ts` |
| Quoter batching | Uniswap | 3 | same-tick quotes → one Multicall3 call; separate ticks → separate batches; per-quote fallback when Multicall3 fails | `packages/core/test/core.test.ts` |
| Trading API parser | Uniswap | 4 | executable v4 routes vs v3 / hooked / split (shown, not executed); multi-hop order; malformed quotes rejected | `packages/core/test/core.test.ts` |
| Mirror node + CSV | Hedera, Whitechain | 4 | Hedera sales parsed from the mirror node, USDC and native-HBAR x402 payments (valued at the configured rate; fee transfers ignored); CSV export escapes and labels correctly | `packages/core/test/core.test.ts` |
| HCS audit log | Hedera | 4 | topic messages decoded newest-first; right mirror URL; errors surfaced; empty topics | `packages/core/test/core.test.ts` |
| Agent spending policy | Hedera | 9 | allowlist, per-merchant cap, total budget, human approval threshold, applied to the real 402 price; HBAR understood only at the rate the policy names; the audit topic survives every purchase (one log) | `agent/test/policy.test.ts` |
| Tender API | all | 5 | ranking endpoint, input validation, invoice reads, chains without a deployment refused | `server/test/app.test.ts` |
| Audit log API | Hedera | 3 | malformed topic ids → 400; entries returned; empty when not configured | `server/test/app.test.ts` |
| Demo shop | Whitechain, Hedera | 4 | x402 paywall manifest, price in USDC or HBAR (the exact amount the 402 demands), invoice-creation token and rate limit | `server/test/app.test.ts` |

**Are the tests real?** We checked the newest ones by breaking the code on purpose: wrong mirror-node ordering, a quoter that never clears its queue, no Multicall3 fallback, swallowed mirror errors, unvalidated topic ids, a lost split-route label, basket legs quoted without each other's price impact, the pool allowlist switched off, an HBAR price off by 100×, a policy ignoring its HBAR rate, a ledger that forgets its audit topic. Every one of those bugs made a test fail.

**End-to-end** (local forks of the real testnets): `e2e/fork.e2e.ts` (Unichain: invoice → ranking → swap payment → hook payment → basket → refund → CSV), `e2e/whitechain.e2e.ts` (USDT: approve+pay, permit pay, refund, CSV), `e2e/ui.e2e.ts` (headless browser: landing → shop → checkout → pay → shop confirms → Whitechain → merchant refund), `e2e/ui.flows.e2e.ts` (the flows the demo video shows beyond the main checkout: hook payment through any router, split payment, basket payment, CSV export, ticket hover; merchant and payer in separate browser sessions). The deploy runbooks (`scripts/deploy-*.sh`) are rehearsed on forks before every real run.

**Live** (Unichain Sepolia, Nov 6): both proof payments checked on-chain after sending: merchant received exactly 0.10 USDC, invoices marked Paid, checkout and hook hold 0 tokens. See the table at the top.

**Browser QA against the live testnets** (`scripts/live-local.sh` + `npx tsx e2e/live.visual.ts <dir>`): every page at desktop (1440 px) and phone (390 px) width checked for the values the chains hold, console errors, failed requests and sideways scrolling; then every visible button and link on every page clicked (178 checks, all passing on Nov 7). Read-only: no wallet is connected.

Gas (from `forge test --gas-report`): `payWithToken` ~200k (1 hop) / ~250k (2 hops); basket ~130k per leg; hook swap ~180k; `createInvoice` ~147k.

## Threat model and what we don't solve

Handled: reentrancy (CEI + `nonReentrant`), fee-on-transfer tokens (balance checks), sandwich/price moves (`maxAmountIn` + deadline, whole tx reverts), malicious hooks (only hook-free pools in `payWithToken`; our own hook is the only hooked route), double payment, refund abuse, stuck funds, leftover approvals (exact amounts), broken pools (vetted allowlist), fake "paid" messages (origin check + on-chain confirmation by the shop), gas-burning invoice spam (token + rate limit).

Not solved, said plainly: testnet liquidity is our own seeded pools; the hook settles exact-input swaps only (v4 lets a hook adjust only the unspecified currency); the hook's `payer` field is unverified (it only decides where refunds go); the agent's spending policy is enforced in its own code, not on-chain; the demo shop holds a merchant testnet key to create invoices (off-chain signed invoices are the next step); Whitechain customers still pay WBT gas; no subscriptions.

## Built with AI

See [`AI_USAGE.md`](AI_USAGE.md): which tools, which parts, and which decisions were made by the author. Planning artifacts are in `docs/`.

## Build timeline

- Nov 4: plan and research; contracts (`CheckoutCore`, `UniswapCheckout`), 31 Foundry tests; core ranker, API, shop server, agent; local-fork end-to-end.
- Nov 5: frontend; Whitechain tested on a local fork (permit confirmed); hardcoded values removed.
- Nov 6: `CheckoutHook` + address mining; impact-sized slippage and split routing; frontend second pass (Linear + MetaMask direction), landing page; docs.
- Nov 6–7: live deployments on Unichain Sepolia, Whitechain Sepolia and Hedera testnet with real payments; browser QA against the live testnets; fixes from it.

**About the commit history:** the first commit (Nov 6, 15:39, 78 files) holds the work of Nov 4–6 above, built before we started committing. Everything after it, about 60 commits, is the record of the deployments, the bugs found on the live chains, their fixes and tests, and the docs. We didn't rewrite timestamps to make it look more gradual.

## License

MIT, see [`LICENSE`](LICENSE).
