# Tender: architecture, trade-offs and backlog

The one file to open before a judge conversation. Everything here is as built on Nov 6, 2026.

## 1. Infrastructure map

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

Shared library `packages/core`: config, routes, quoting, ranking, basket, history, CSV, Hedera. Imported by server, shop, agent and app.

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
| 1 | **HCS audit log for agent spending** (Hedera "extra points") | Each purchase written to a public, tamper-evident topic; shown on the Agents page | 1.5 h |
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
