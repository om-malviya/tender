# Tender: architecture, trade-offs and backlog

The one file to open before a judge conversation. Everything here is as built on Nov 6, 2026.

## 1. Infrastructure, layer by layer (▲ = where Tender differs from Universal Router / 0x Swap-and-Send / Coinbase Commerce OPP)

```
                 ┌──────────────── demo-shop (:8788, Hono) ─────────────────┐
                 │ GET /              shop page, 23-line Tender integration │
                 │ POST /api/create-invoice   merchant key → createInvoice   │
                 │ GET /api/orders/:chain/:id confirms "paid" ON-CHAIN      │
                 │ GET /api/agent/dataset     x402 paywall (Hedera, $0.05)   │
                 │ GET /.well-known/tender.json  what agents can buy         │
                 └───────┬──────────────────────────────┬────────────────────┘
       popup (tender.js) │                              │ 402 → signed Hedera transfer
                         ▼                              ▼
  app (:5173, Vite+React+wagmi)                agent/ (Node): x402 client + spending policy
   /  dashboard · /pay/:chain/:id · /merchant · /agents          │
         │ /api/*  (Vite proxy)                                   ▼
         ▼                                       Hedera testnet ← facilitator (Blocky402) settles,
  server (:8787, Hono)  ── reads only, no keys ──               pays the network fee
   POST /api/rank     quotes every route (v4 Quoter [+ Trading API]), ranks by true cost
   POST /api/basket   builds a multi-token payment
   GET  /api/invoices history from contract EVENTS (chunked, cached getLogs)
   GET  /api/export.csv  all rails, one CSV      GET /api/hedera/sales  mirror node
   GET  /api/config   chains, addresses, tokens → the frontend hardcodes nothing
         │
         ▼ JSON-RPC
  Unichain Sepolia (1301)                      Whitechain Sepolia (1874)
   UniswapCheckout is CheckoutCore              CheckoutCore (USDT, permit)
   CheckoutHook (v4 hook, mined address)        solc 0.8.30 / prague (explorer verification)
   Uniswap v4 PoolManager + Quoter (Uniswap's)  Multicall3 (batch reads)
   PoolSwapTest = "any router" for hook demos
   pools: WETH/USDC, DEMO/WETH, DEMO/USDC (thin), WETH/USDC+hook, DEMO/USDC+hook
```

### Layer 1: Settlement contracts (Solidity, Foundry)
**`CheckoutCore`** (both chains): invoice state machine `Open → Paid → (refunded…) / Cancelled`, with `createInvoice`, `payInvoice`, `payInvoiceWithPermit` (EIP-2612, one transaction), `refund` (partial, only to the recorded payer, only by the merchant), `cancel`. Tokens move payer → merchant inside the same call; the contract never holds a balance. No owner, no upgrade: the settle-token allowlist and the hook address are fixed at deploy.
- ▲ **vs all three:** none of them has an invoice lifecycle on-chain. Universal Router and 0x are swap executors; Coinbase OPP has one-shot "transfer intents" signed by an **operator**. Tender has **no operator or admin**, and refunds are part of the same contract and tied to the original payer.

**`UniswapCheckout is CheckoutCore`** (Unichain): `payWithToken(id, tokenIn, maxAmountIn, Hop[] path, deadline)` and `payWithBasket(id, Leg[] legs, deadline)`. It calls the v4 **PoolManager directly**: `unlock` → `unlockCallback` swaps each hop backwards with exact output → `settle` the input → `take` the USDC **straight to the merchant** → return the leftover → assert `merchant delta == amount` and `contract balance == 0`. Only hook-free pools (`hooks = address(0)` is hard-coded).
- ▲ **vs Universal Router:** no router in the middle, no Permit2 allowance from our contract; the merchant guarantee is an on-chain assertion, not a convention.
- ▲ **vs 0x Swap-and-Send:** 0x delivers "whatever the swap produced" to `recipient`; Tender delivers **exactly** the invoice and refunds the input difference in the same transaction.
- ▲ **vs Coinbase OPP:** same intent as `swapAndTransferUniswapV3Token`, but v4 (flash accounting, one `take` to the merchant instead of swap-to-contract-then-transfer), **no operator signature**, and the **basket**: one invoice from several tokens in one transaction, which none of the three can do.

**`CheckoutHook`** (Unichain, v4 hook at a mined address): `afterSwap` + `afterSwapReturnDelta`. A swap through a hooked pool carrying `hookData = (invoiceId, payer)` makes the hook `take` exactly the invoice amount to the merchant, charge it to the swapper, keep the rest as change, and mark the invoice paid via `settleFromHook` (hook-only). Output short → whole swap reverts.
- ▲ **vs all three (the biggest difference):** their payment logic lives in a router or a transfers contract that the payer's software must call. Tender's lives **in the pool**: any router, wallet or aggregator that forwards hookData pays the invoice. Proven with Uniswap's own `PoolSwapTest` router; Tender's contract is never called.

### Layer 2: Routing and pricing (`packages/core`, TypeScript)
`rankRoutes`: read the invoice → one multicall for balances → enumerate direct and via-WETH paths over a **vetted pool allowlist** → quote all with the on-chain v4 **Quoter** (and the Trading API when a key is set) → price each token from a tiny probe quote with fees removed → compute **price impact** per route → size the **slippage buffer from impact** (0.25–3%) → add gas (measured constants) → sort by total USD cost → recommend the cheapest affordable, executable route. Also builds **split routes** (two pools, one transaction) and **basket** payments. Hook pools appear as "any router" routes with ready-made swap arguments.
- ▲ **vs 0x:** 0x's routing is server-side and opaque; the payer sees one quote. Tender shows **every route with input, fees+impact, gas and total**, and lets the payer pick.
- ▲ **vs Universal Router / OPP:** neither routes at all; the caller supplies a path/pool. OPP needs the caller to choose a v3 fee tier. Tender's buffer adapts to the pool's measured impact instead of a flat percentage.
- ▲ **vetted pools:** the ranker refuses pools with broken prices (found on the real testnet). The others trust whatever pool the caller or server picks.

### Layer 3: API (`server`, Hono, read-only, no keys)
`/api/rank`, `/api/basket`, `/api/invoices` (history rebuilt from contract **events**, scanned in RPC-safe chunks and cached), `/api/export.csv` (all rails), `/api/hedera/sales` (mirror node), `/api/config` (chains, addresses, tokens: the frontend hardcodes nothing). Holds no private keys and no database; the chain is the database.
- ▲ The three platforms don't ship a merchant back office. OPP has a Transferred event you can index yourself; Tender gives the merchant history, refunds and an accountant CSV out of the box, across three rails.

### Layer 4: Frontend and widget (`app`, Vite + React + wagmi; `app/public/tender.js`)
Dashboard, pay page (ranked routes panel, pay, receipt), merchant page (create, refund, cancel, CSV), agent sales. Approvals are always for the exact amount, never unlimited; USDT-style tokens get the approve-to-zero dance. The widget is one `<script>` + `Tender.checkout({...})`: opens the pay page in a **popup** (wallets don't inject into cross-origin iframes), accepts "paid" only from Tender's origin, and the shop still confirms on-chain.
- ▲ **vs Coinbase Commerce:** Coinbase's checkout is hosted by Coinbase and operator-gated; Tender's widget is self-hostable and talks only to public contracts.

### Layer 5: Second rail, Whitechain (USDT)
Same `CheckoutCore`, compiled with Whitechain's required solc 0.8.30 / prague, settle token = their official USDT (permit confirmed working: domain "Tether USD" / "1"). Same widget, same dashboard, same CSV.
- ▲ None of the three is a multi-chain merchant product; OPP is per-chain swaps, 0x and Universal Router are swap tools.

### Layer 6: Third rail, Hedera x402 (AI agents)
The shop's `GET /api/agent/dataset` is behind an x402 paywall (`@x402/hono` + Hedera "exact" scheme). The agent discovers the endpoint from `/.well-known/tender.json`, gets a 402 price tag, runs its **spending policy** (allowlist, per-merchant cap, total budget, human approval above a threshold) on the real price tag, signs a Hedera USDC transfer; the facilitator verifies, pays the network fee and settles; the sale shows up in the merchant dashboard from the mirror node.
- ▲ None of the three sells to agents at all. Tender treats an agent as another customer of the same merchant.

### Layer 7: Deployment and local infrastructure
`DeployUnichain.s.sol` predicts the checkout address from the deployer nonce, **mines a CREATE2 salt** so the hook's address carries its permission bits, deploys through the deterministic deployer. `SeedPools.s.sol` creates plain and hooked pools priced off the live WETH/USDC pool. `DeployWhitechain.s.sol` + blockscout verification. `scripts/dev-fork.sh` runs the whole product against local anvil copies of both testnets (real Uniswap, real USDC/USDT, storage-funded test accounts, dev wallets); `e2e-fork.sh` and `ui.e2e.ts` drive it automatically.
- ▲ The three are deployed by their vendors; Tender is deployable by any merchant, and its full stack is reproducible on a laptop in one command.

### One payment, end to end (any-token, Unichain)
1. Shop server calls `createInvoice(USDC, 1.00, expiry, orderRef)` → event `InvoiceCreated`.
2. Widget opens `/pay/unichain-sepolia/<id>?embed=1`; the page asks `/api/rank`.
3. Ranker quotes and ranks (Layer 2).
4. Payer approves `maxAmountIn`, then one of `payWithToken`, `payWithBasket`/split, or a generic-router swap through the hooked pool.
5. Page posts `tender:paid` to the shop; the shop confirms with `getInvoice` on-chain, never from the message.
6. Dashboard/CSV rebuild everything from events; Hedera sales from the mirror node.

## 2. Design trade-offs (what we chose, what it costs)

| Decision | Chosen | Alternative | Why, and the cost |
|---|---|---|---|
| Where swaps run | Direct `PoolManager` calls (unlock/swap/settle/take) | Universal Router | Fewer contracts to trust, no Permit2 allowances, fully testable locally. Cost: v4-only, no v2/v3 liquidity; we re-implement route walking. |
| Custody | Non-custodial, contract holds 0 between calls | Escrow (authorize/capture like Base Commerce) | Nothing to steal, simple invariants. Cost: no holds, no delayed capture, refunds need the merchant's wallet to hold funds. |
| Admin | None; allowlist + hook fixed at deploy | Owner/upgradeable | No privileged party, strong booth answer. Cost: a bug means redeploy and new address. |
| Hooks in routes | Banned in `payWithToken`; our own hook only via the hook route | Allowlist of audited hooks | Simple security story. Cost: can't use hooked liquidity from others. |
| Hook payment mode | Exact-input only | Exact-output | v4 lets a hook touch only the unspecified currency. Cost: payer sends "enough", gets change in USDC instead of in their token. |
| Hook `payer` field | Unverified, from hookData | Signature from payer | Zero friction for any router. Cost: whoever pays chooses where refunds go (they paid, so harmless). |
| Price protection | `maxAmountIn` + deadline, no sqrtPrice limit | Pool price limits | Simple, matches what the payer sees. Cost: a partial fill is impossible; the whole tx reverts instead. |
| Slippage buffer | 0.25% + impact/2, cap 3% | Flat 0.5% | Thin pools get room, deep pools don't overpay. Cost: a heuristic, not a guarantee; unusual pools may still revert. |
| Routing | Enumerate direct + via-WETH over vetted pools, quote all | Aggregator API only | Transparent, works offline, resists broken pools. Cost: O(paths) quote calls (~12 per token), only 1–2 hops, only WETH as intermediate. |
| Pool allowlist | On by default | Any pool | Found a testnet pool pricing WETH at trillions. Cost: new pools need a config change (`TENDER_ANY_POOL=1` lifts it). |
| Token prices | From a tiny probe quote, fees removed | External oracle | No dependency, consistent with execution. Cost: a manipulated pool skews USD columns (not the on-chain guarantee). |
| Gas estimate | Constants from `forge --gas-report` | `estimateGas` per route | No extra RPC calls. Cost: approximate; shown as such. |
| History | Rebuilt from events, chunked + cached in memory | Indexer / database | No infra, zero trust. Cost: first load scans from deploy block; cache is per process. |
| Invoice creation | A merchant transaction per invoice | Off-chain signed invoices (like OPP intents) | Simplest to verify. Cost: merchant pays gas per invoice; the demo shop holds a merchant key server-side. |
| Refunds | Pulled from the merchant's wallet, to the original payer only | Escrowed refunds | Non-custodial. Cost: merchant must approve first; can't refund to a different address. |
| Whitechain compiler | solc 0.8.30 / prague, separate profile | One profile | Their explorer verification demands it. Cost: two build profiles. |
| Agent policy | Enforced in the agent's code | On-chain spending contract | Fits x402 (a native Hedera transfer, no contract). Cost: a stolen agent key bypasses it; keep balances small. Disclosed. |
| x402 facilitator | Hosted (Blocky402) | Run our own | Zero infra. Cost: trust in a third party to verify/settle; they pay the fee. |
| Widget | Popup + origin-checked postMessage | iframe | Wallets don't inject into cross-origin iframes. Cost: popup blockers (fallback: same tab). |
| Frontend data | Everything from `/api/config` and chain reads | Hardcoded addresses | One source of truth. Cost: the API must be up for the page to load. |

## 3. Backlog: what to work on next, ranked by value ÷ effort

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | ~~HCS audit log for agent spending~~ **done Nov 6** | Purchases and refusals written to an HCS topic; Agents page reads it from the mirror node | done |
| 2 | **Off-chain signed invoices** (EIP-712), paid by `payWithToken` without a prior `createInvoice` tx | Removes the merchant's per-invoice gas and the server-side key for creation | 3 h |
| 3 | **Batch quoting** via Multicall for the Quoter calls | ~12 quotes per token become 1 RPC round-trip; faster panel | 1.5 h |
| 4 | **Dynamic gas estimate** (`estimateGas` on the recommended route only) | Accurate gas column where it matters | 1 h |
| 5 | **Hook route: pay in exact-output via two-step** (quote exact-out, send that input + buffer) | Already what we do; expose "expected change" in the panel | 0.5 h |
| 6 | **Webhook to the shop on `InvoicePaid`** (HMAC-signed) | Whitechain "order webhooks" idea starter | 1.5 h |
| 7 | **Second intermediate token (USDC-paired stable)** in route enumeration | More routes on mainnet-like liquidity | 0.5 h |
| 8 | **Native ETH payments** (v4 currency 0) | Pay with ETH, not WETH | 2 h |
| 9 | **Per-pool liquidity check before quoting** (StateView) | Skip dead pools, fewer failed quotes | 1 h |
| 10 | **Subscription pulls with permit** (Whitechain idea starter) | Recurring billing | 4 h |
| 11 | Popup-width polish: pill clipping in the checkout popup | Cosmetic | 0.3 h |

Not worth doing before the deadline: on-chain agent spending limits, UniswapX intents, cross-chain settlement, v3 routes.

## 4. Numbers to quote
- Tests: 41 Solidity (incl. 16k-call invariants, 1k-run fuzz), 34 TypeScript, 2 local e2e flows, 1 browser flow.
- Gas: `payWithToken` ~200k (1 hop) / ~250k (2 hops); basket ~130k per leg; hook swap ~180k; `createInvoice` ~147k.
- Ranking: ~12 candidate paths per token, quotes refreshed every 20 s, buffer 0.25–3%.
- Hook address mining: 1 in 16,384 salts; dry-run found one on a fork.
- Real bugs found by fork testing: broken testnet pool prices, 1,000-block `getLogs` cap, Multicall3 missing on Whitechain, block-number cache hiding refunds, hooked-pool quotes leaking into basket legs.

## Appendix A: deep dives

Where to go when a conversation goes deeper than the layer summary above. The study guide entries have line-by-line links, worked examples with real numbers, and judge Q&A.

| Layer | Deep dive |
|---|---|
| Invoices, refunds, permit (`CheckoutCore`) | study_B.md **B2**, Module 1 (tokens/permit), Module 2 (CEI, reentrancy) |
| Exact-output swaps on the PoolManager (`UniswapCheckout`) | study_B.md **B3** (nine steps, flash-accounting table, call trace), Module 3 |
| Basket payments | study_B.md **B3** (basket), **B9** (how legs are chosen) |
| The CheckoutHook and address mining | study_B.md **B21**, FEEDBACK.md items 6–7 |
| Ranking, impact buffer, split routing | study_B.md **B8**, **B22** |
| Event history, CSV, Hedera sales | study_B.md **B10**, **B19** (RPC limits, Multicall3) |
| API server and shop | study_B.md **B11**, **B12**, **B17** (widget, 23-line integration) |
| Agent and spending policy | study_B.md **B13**, Module 6 |
| Tests and how we know it works | study_B.md **B5**, **B14**, **B18**, **B19** |
| Whitechain specifics | study_B.md **B19**, Module 5 |

### A.1 The detailed walkthrough (kept from the first version)
### One payment, end to end (any-token, Unichain)
1. Shop server calls `createInvoice(USDC, 1.00, expiry, orderRef)` → event `InvoiceCreated`.
2. Widget opens `/pay/unichain-sepolia/<id>?embed=1`; the page asks `/api/rank`.
3. Ranker: read invoice → multicall balances → quote every vetted route (exact output) → price tokens with a tiny probe quote (fees removed) → impact → buffer → gas → sort → recommend.
4. Payer approves `maxAmountIn` (never unlimited), then one of:
   - `payWithToken`: contract pulls max, `unlock` → swaps backwards per hop (exact out) → `settle` input → `take` USDC straight to the merchant → returns leftover → asserts merchant delta == amount and contract balance == 0.
   - `payWithBasket` / split: several exact-input legs in one unlock, total ≥ invoice, excess back.
   - hook route: a generic router swaps through the hooked pool with `hookData=(id, payer)`; `afterSwap` takes exactly the amount to the merchant and marks the invoice paid.
5. Page posts `tender:paid` to the shop; the shop confirms with `getInvoice` on-chain, never from the message.
6. Dashboard/CSV rebuild everything from events; Hedera sales from the mirror node.

### Local development = the real thing, copied
`scripts/dev-fork.sh`: anvil forks of Unichain Sepolia and Whitechain Sepolia (real Uniswap, real USDC/USDT), our contracts deployed with the same scripts as production, test accounts funded by writing token storage, dev wallets in the app. `e2e-fork.sh` and `ui.e2e.ts` drive it automatically.


### A.2 Reading the code in order (about 40 minutes)
1. `contracts/src/CheckoutCore.sol` (183 lines): the state machine.
2. `contracts/src/UniswapCheckout.sol`: `payWithToken` → `_payExactOut` → `unlockCallback` → `_exactOutCallback` → `_swapExactOut` → `_settle`.
3. `contracts/src/CheckoutHook.sol` (90 lines): `afterSwap` top to bottom.
4. `packages/core/src/rank.ts`: steps 1–4 in the comments.
5. `server/src/app.ts`: one handler per endpoint.
6. `app/src/pages/PayPage.tsx`: `pay()` has one branch per route kind.
7. `e2e/fork.e2e.ts`: the whole product in one script, with asserts.
