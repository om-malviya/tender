# Project B: Tender (working name)

**Pay with any token. The merchant gets the exact stablecoin amount.**

> ETHGlobal Mumbai 2026 · Project B (team project; Person 2 leads it) · Plan v2, Nov 4 2026
> **Build timing (team decision, Nov 4):** the team has a conference during the hackathon, so Project B is built **before** kickoff. The team says it has told the organisers. Build in the open: keep the organisers' written OK, never rewrite commit dates, and add a "Build timeline" section to the README (§1).
> **v2 change:** `UniswapCheckout` calls the v4 PoolManager directly (unlock → swap → settle → take) instead of the Universal Router, so swaps are tested locally against a real PoolManager (§5.2).
> Verification labels in this file: **[V]** means checked on the official sponsor page or docs on Nov 4. **[CHECK]** means it is unconfirmed and must be tested before we rely on it.

---

## Build status (Nov 4, nothing deployed, nothing committed)
- **Contracts done:** `CheckoutCore`, `UniswapCheckout` (pay with any token + basket), `DemoToken`, deploy/seed scripts. **31 Foundry tests pass** against a real v4 PoolManager.
- **Off-chain done:**
  - `packages/core`: ranker, basket builder, history, CSV, Hedera sales.
  - `server`: the Tender API.
  - `demo-shop/server`: invoices + x402 paywall, **verified live: returns a correct 402**.
  - `agent`: the x402 buyer with a spending policy.
  - **29 TypeScript tests pass.**
- **End-to-end on a local fork of Unichain Sepolia: passes.** It covers invoice, ranking, exact-output payment, basket, refund and CSV, and it caught two real-world bugs (broken testnet pools; a block-number cache).
- **Frontend: first draft built Nov 5 (provisional, the design may change).** The reference is EAS Scan in a dark theme, with the sidebar pinned far-left and the content filling the rest. Done:
  - pages: Dashboard, Pay (ranked routes + receipt), Merchant (create / refund / cancel / CSV), Agent sales
  - the `tender.js` widget (popup, origin-checked)
  - the Chai & Code shop page: **23-line integration**, payment confirmed on-chain by the shop's own server
  - **UI test passes:** a headless browser clicks shop → checkout → pay → shop confirms → merchant refund
  - `scripts/dev-fork.sh` runs the whole product locally for rehearsal
- **Whitechain tested on a local copy (Nov 5):** USDT invoice, approve + pay, **one-transaction permit payment (USDT permit confirmed working: domain "Tether USD" / "1")**, refund, CSV, shop on-chain confirmation, plus the browser flow. Found and fixed 3 real bugs before deployment: the Unichain RPC's 1,000-block `getLogs` limit, Multicall3 missing from the Whitechain chain definition, and per-chain invoice numbers.
- **No hardcoded data values (Nov 5):** decimals come from each token's config, and shop and agent prices come from the server settings.
- **Differentiation work (Nov 6), after an honest comparison with Universal Router / 0x Swap-and-Send / Coinbase Commerce OPP:**
  - **CheckoutHook (Uniswap v4 hook):** the pool itself settles invoices; any router that forwards hookData can pay one. Deploy script mines the hook address; 10 hook tests through Uniswap's own router; fork run passes.
  - **Ranker:** slippage buffer sized from measured price impact (0.25–3%), split routing across two pools when cheaper; both executed from the pay page.
  - 41 Solidity tests, 34 TypeScript tests, both local e2e flows pass. 3 local commits so far.
- **Frontend second pass (Nov 6):** Linear + MetaMask direction confirmed by the user. Stepped checkout with a review sheet, account pill with identicon, token balances, and a full landing page (hero, cursor-revealed neon "tickets", timeline, About, Built-on, comparison). Browser test passes.
- **Waiting on:** testnet keys and funds for deployment, plus the Uniswap API key and Hedera accounts.

## 0. TL;DR

- **The problem.** At a crypto checkout, the customer usually holds the wrong token. They have DEMO or WETH and the store wants 1.00 USDC. Today they swap in one app, work out the amount by hand and pay in another, and the merchant can still be paid too little.
- **What Tender does.** A merchant creates an invoice for an exact stablecoin amount. Tender ranks every Uniswap route for each token the customer holds by total cost (input value + gas). Then one Solidity transaction does an exact-output swap: the merchant receives **exactly** 1.00 USDC and the customer gets back whatever input wasn't needed.
- **One merchant toolkit, three ways to get paid:**
  1. **Any token through Uniswap** on Unichain Sepolia. This is the core, for the Uniswap prize.
  2. **USDT invoices, refunds and accountant export** on Whitechain Sepolia, for the Whitechain Operate prize.
  3. **Pay-per-request sales to AI agents through x402** on Hedera testnet, for the Hedera x402 prize.
- **Prizes targeted (the maximum of 3 partner prizes):** Uniswap "Build with Uniswap" ($10k), Whitechain "Operate" ($5k) and Hedera "AI Agents That Pay" ($6.5k).
- **Uniswap comes first.** The Uniswap part has to work on its own. Whitechain and Hedera are layered on top, and the plan cuts Hedera first if time runs out.
- **Resolved Nov 7: Tender is submitted as one team project** (teammate: parthdagia05). The original precondition was to ask on the ETHGlobal Discord whether two members of one group can submit two separate solo projects. If the answer is no, Project B is dropped and both of you build Receipts.

---

## 1. Event rules that shape this plan

| Rule | What it means for B |
|---|---|
| Submission deadline Sat Nov 7, 09:00 IST [V] | No late submissions. |
| At most 3 partner prizes per submission [V] | Uniswap, Whitechain and Hedera fill all three. Project A uses ENS, Arkiv and World, so the two projects don't overlap. |
| Built from scratch [V]: "all work on your project must begin after the hackathon officially starts" | **Team decision: build before kickoff** because of the conference clash; the team has told the organisers. Keep their confirmation in writing, and confirm which track this lets us enter. "Kickoff track" doesn't appear on the prize pages. Keep honest commit dates, and add a README "Build timeline" (what was built before the event, what was built during it). If the organisers say pre-built work can't enter the main prizes, enter the **Continuity** prizes instead: Uniswap ($5k, 4 × $1,250), Whitechain "Bring Your Product to Whitechain" ($3k, 2 × $1,500, needs proof of starting point + a "before and during" README section), Hedera Continuity ($1.5k, 2 × $750). |
| AI use must be documented [V] | `AI_USAGE.md`: which tools, which parts, which decisions you made yourself. Commit the prompts and specs. **You must be able to explain every contract and function at the booth.** |
| Demo videos [V] | **Updated Nov 7: four videos** cut from one recording session: one for ETHGlobal (2–4 min), one per sponsor (Uniswap ~3 min, Whitechain 2–4 min, Hedera ≤5 min). Each sponsor video centres on that sponsor and shows how its technology creates Tender's differences. Plan and scripts: `tender/docs/VIDEOS.md`. |
| Each project separate [PDF] | Project B gets its own repo, demo and README, separate from Receipts. |

---

## 2. Sponsors: what each judge checks and what we deliver

### 2.1 Uniswap Foundation: Build with Uniswap ($10,000; 1st $4k, 2nd $3k, 3rd $2k, 4th $1k) [V]
- **Scope:** any part of the Uniswap stack: the API, v2/v3/v4, hooks, or tooling.
- **Qualification (missing items get the submission audited before winners are named):**
  - [ ] Public GitHub repo, open source (MIT).
  - [ ] `FEEDBACK.md` in the repo.
  - [ ] Uniswap Developer Feedback Form submitted (developers.uniswap.org/hackathon-feedback) with a link to `FEEDBACK.md`.
  - [ ] A README that points to the exact contracts and lines that call Uniswap.
- **What won before (from the PDF):** clear, novel mechanisms, not UI wrappers.
- **What we deliver:**
  - `UniswapCheckout.sol`: an exact-output swap that works with the v4 PoolManager directly (unlock, swap, settle, take), with the invariants enforced on-chain.
  - A route ranker that uses the **Trading API** and the **v4 Quoter**.
  - A basket payment that pays one invoice from several tokens in one transaction.
- **Workshop:** "How to Navigate the Uniswap Stack", Thu Nov 5, 4:30 PM IST, Workshop Room 1 [V]. **Attend this one.**

### 2.2 Whitechain: Operate, Stablecoin Payments for Business ($5,000; 1st $2.5k, 2nd $1.5k, 3rd $1k) [V]
- **What judges want:**
  - A drop-in piece (widget, SDK, payment link, plugin) that a separate demo app adds in **about 20 lines**.
  - Both the **merchant and the customer** views.
  - Extra credit for steps after the first payment: refund, renewal, accountant export.
- **Won't place:** a plain-transfer pay button, tip jars, bill splitters, bridges into a local currency, or payroll, escrow or splits on their own.
- **Qualification:**
  - [ ] Contracts deployed on **Whitechain Sepolia (chain 1874)** and **verified** on the explorer.
  - [ ] At least one payment settled in their **USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`** in the main flow, with the explorer link in the README. A self-minted token does **not** count.
  - [ ] One README line on why the flow needs on-chain stablecoin settlement on Whitechain.
  - [ ] Public repo with **steady commits** (not one upload at the end), and a README covering setup, architecture and limitations.
  - [ ] A 2–4 minute video showing **each party**.
  - [ ] `WHITECHAIN_FEEDBACK.md`: what worked, where you got stuck, what the docs were missing.
- **What we deliver:**
  - `CheckoutCore.sol` deployed and verified on Whitechain Sepolia.
  - The `tender.js` widget, embedded in a separate `demo-shop` app in about 20 lines.
  - Customer pay page.
  - Merchant dashboard with invoices, full or partial **refunds** and **CSV export**.
- **Workshop:** "How to Win on Whitechain", Nov 5, 4:30 PM IST, Room 2. It **clashes with Uniswap's workshop**, so watch the recording listed on the prize page.

### 2.3 Hedera: AI Agents That Pay, x402 on Hedera ($6,500; 1st $3k, 2nd $2k, 3rd $1.5k) [V]
- **Qualification:**
  - [ ] At least one **x402-protected endpoint** that settles on Hedera testnet, using a facilitator listed in the Hedera docs or one you run yourself.
  - [ ] An **agent** that finds the endpoint and completes at least one paid request end to end, with **no human approval**.
  - [ ] Public repo whose README covers setup, architecture and the payment flow, and includes the **Hedera transaction ID** of at least one settled payment.
  - [ ] Demo video of **5 minutes or less** showing a payment settling, with the **HashScan link**.
- **Extra points (the closest thing to judging criteria):**
  - **Agent spending controls** (budget, per-merchant limit, allowlist, human approval above a threshold). We build this.
  - An HCS topic as an audit log (stretch).
  - Settling in an HTS token like USDC. We do this, or fall back to HBAR.
  - ERC-8004 / HCS-14 identity, A2A/ACP negotiation, Scheduled Transactions, Agent Kit or MCP. Not planned.
- **What we deliver:**
  - The demo shop sells a digital product to AI agents at `GET /api/agent/dataset`, protected with x402.
  - `agent/` is an autonomous buyer with a spending policy.
  - Hedera sales appear in the same merchant dashboard.
- **Workshop:** "Hedera X Claude Code", Nov 5, 3:30 PM IST, Room 2 [V].

---

## 3. The product

### 3.1 Problem
1. **The customer holds the wrong token.** The store prices in USDC; the customer has WETH or some other token. Today that means two transactions in two apps, with the swap amount worked out by hand.
2. **The merchant needs an exact amount.** If the customer swaps a fixed amount *in* (exact input), the merchant gets "about 1 USDC". Invoices, accounting and refunds all need exactly 1.00.
3. **The cheapest route isn't obvious.** A direct pool can be worse than a two-hop route through WETH once fees, price impact and gas are counted. Wallets rarely show the comparison.
4. **Payment doesn't end at checkout.** Merchants need refunds, records and exports. AI agents can't fill in checkout forms at all and need machine-payable endpoints.

### 3.2 Solution
- **Exact-output settlement (the mechanism).** The customer gives an upper bound on what they'll spend (`maxAmountIn`). The contract swaps for exactly the invoice amount, pays the merchant, returns the unused input, and **reverts** if any invariant breaks.
- **Route ranking.** For every token the customer holds and every candidate route, we compute the input amount needed, its USD value, the gas cost in USD and the price impact, and rank them. The UI shows the ranking panel, not a black box.
- **Basket payment.** One invoice paid from several tokens in one transaction, which uses up leftover small balances.
- **Merchant toolkit.**
  - Drop-in widget.
  - Invoices with expiry.
  - Partial refunds recorded on-chain.
  - CSV export.
  - Same dashboard for all chains.
- **Agent sales.** The same merchant sells per request to AI agents through x402. The agent pays without a human, inside a spending policy.

### 3.3 The three users and their flows

**A. Customer (human), Unichain Sepolia, any token**
1. In the demo shop, clicks **Buy**. The shop's server creates an invoice on-chain (`createInvoice`), and the widget opens the Tender pay page.
2. Connects a wallet. Tender scans their token balances.
3. Sees the **ranked routes panel**. For example: DEMO→WETH→USDC costs $1.012 total, direct DEMO→USDC costs $1.041, WETH→USDC costs $1.006. The cheapest affordable route is preselected.
4. Approves the token (or signs a permit), then clicks **Pay**. One transaction to `UniswapCheckout.payWithToken`.
5. Sees a receipt: the merchant got exactly 1.000000 USDC, the customer spent X and got Y back, with an explorer link. The widget tells the shop "paid", and the shop shows "Order confirmed".

**B. Customer (human), Whitechain Sepolia, USDT**
- Same widget. The invoice is in USDT, so there's no swap: approve, then `payInvoice`. Explorer link on the receipt.

**C. Merchant**
1. Opens `/merchant` and connects the merchant wallet.
2. Sees every invoice on both chains (Open, Paid, Cancelled, Expired, Refunded) plus Hedera agent sales.
3. **Refund:** picks an invoice, enters an amount (partial allowed), approves USDT or USDC, then calls `refund`. The money goes back to the original payer and the event is recorded on-chain.
4. **Export CSV:** date, chain, invoice id, order ref, payer, token in, amount in, amount settled, refunded, tx link. This is for an accountant.

**D. AI agent (Hedera)**
1. Reads the shop's `/.well-known/tender.json` manifest to find the paid endpoint `GET /api/agent/dataset`, priced at 0.05 USDC.
2. Calls it and gets **HTTP 402** with the payment requirements (amount, asset, payTo, fee payer).
3. Checks its **spending policy**: is the merchant allowlisted, is it under the per-merchant cap and the total budget, and is it below the human-approval threshold?
4. If allowed, it signs a Hedera transfer. The facilitator verifies it, pays the network fee, and settles. The agent gets the data and logs the transaction ID with its HashScan link.
5. If it isn't allowed, it refuses and logs why. The demo shows one refusal.

---

## 4. Architecture

```
                         ┌──────────────── demo-shop (separate app) ───────────────┐
                         │  ~20 lines: <script src=".../tender.js">                 │
                         │  Tender.checkout({ chain, invoiceId, onPaid })           │
                         │  server: createInvoice (merchant testnet key)            │
                         │  x402 paywall: GET /api/agent/dataset  (Hedera)          │
                         └───────────────┬───────────────────────────┬──────────────┘
                                         │ popup/iframe               │ 402 / X-PAYMENT
                                         ▼                            ▼
 Customer wallet ◄──► Tender app (Next.js)                     agent/ (Node)
                      /pay/[chain]/[id] ──► /api/rank ──► Uniswap Trading API /quote
                           │                   └──────► v4 Quoter (eth_call, Unichain)
                           │ tx
                           ▼
        Unichain Sepolia: UniswapCheckout (is CheckoutCore)
             PoolManager.unlock → unlockCallback: swap each hop (exact out)
             → settle tokenIn, take exact USDC to merchant, payer refunded leftover
        Whitechain Sepolia: CheckoutCore (USDT) — pay, refund, cancel
        Hedera testnet: HTS transfer settled by facilitator (Blocky402 / x402.org)

  /merchant dashboard ◄── events (getLogs) from Unichain + Whitechain, Hedera mirror node REST
```

### Language split
- **Solidity, with Foundry for building, testing and deploying.** Everything that moves or protects money: invoices, payment, swap, refund, cancel, and the invariants.
- **TypeScript.** Everything off-chain:
  - Ranker: it calls an HTTP API, and Solidity can't.
  - Pay page, dashboard and widget: these are UI.
  - Hedera x402: it's a native Hedera token transfer through a facilitator, not a smart contract.

| Component | Language | Priority |
|---|---|---|
| `CheckoutCore.sol` | Solidity | P0 |
| `UniswapCheckout.sol` (`payWithToken`) | Solidity | P0 |
| `payWithBasket` | Solidity | P1 |
| Deploy and seed scripts, tests | Solidity (Foundry) | P0 |
| Route ranker `/api/rank` | TypeScript | P0 |
| Pay page + ranking panel | TypeScript (Next.js, viem, wagmi) | P0 |
| Merchant dashboard (refund, CSV) | TypeScript | P1 (needed for Whitechain) |
| Widget `tender.js` + demo shop | TypeScript / HTML | P1 (needed for Whitechain) |
| x402 paywall + agent | TypeScript | P1 (needed for Hedera) |
| Webhooks, HCS audit log, native ETH | TypeScript / Solidity | P2 |

---

## 5. Smart contracts

### 5.1 `CheckoutCore.sol`: invoices, payment, refund (deployed on both chains)

**Design principles**
- **Non-custodial.** Money moves straight from payer to merchant inside one transaction, and the contract holds **zero** tokens between transactions. That leaves nothing to steal and is a strong booth answer.
- **No admin and no upgrades.** The list of accepted settlement tokens is fixed in the constructor (stored as `immutable`, or set once). No owner can change the rules later.
- **Kept small** so you can explain every line.

**State**
```
enum Status { None, Open, Paid, Cancelled }        // "Expired" is computed: Open && now > expiry
struct Invoice {
    address merchant;      // who gets paid; only they can refund/cancel
    address settleToken;   // USDC (Unichain) or USDT (Whitechain); must be allowlisted
    uint256 amount;        // exact amount in token units (USDC/USDT use 6 decimals → 1.00 = 1_000_000)
    uint64  expiry;        // unix timestamp; payment after this reverts
    Status  status;
    address payer;         // set on payment; refunds go here
    uint256 refunded;      // cumulative refunded amount, never > amount
    bytes32 orderRef;      // merchant's order id (hashed), for reconciliation
}
uint256 public nextInvoiceId;
mapping(uint256 => Invoice) public invoices;
mapping(address => bool) public isSettleToken;      // set in constructor
```

**Invoice lifecycle (state machine)**
```
createInvoice → Open ──payInvoice / payWithToken / payWithBasket──► Paid ──refund(partial…)──► Paid (refunded ≤ amount)
                 │
                 ├──cancel (merchant)──► Cancelled
                 └──time passes > expiry──► (Open but expired: cannot be paid)
```

**Functions**

| Function | Who | Checks (revert if not) | Effect |
|---|---|---|---|
| `createInvoice(settleToken, amount, expiry, orderRef) → id` | merchant (`msg.sender`) | token allowlisted; amount > 0; expiry > now | stores the invoice; emits `InvoiceCreated` |
| `payInvoice(id)` | anyone (the payer) | status Open; now ≤ expiry | **first** marks Paid and payer, **then** `safeTransferFrom(payer → merchant, amount)`; emits `InvoicePaid` |
| `payInvoiceWithPermit(id, deadline, v, r, s)` | payer | same + valid EIP-2612 permit | calls `permit`, then the same as `payInvoice`. One signature instead of an approve transaction. USDC supports it; Whitechain USDT is **[CHECK]**. |
| `refund(id, amount)` | the invoice's merchant only | status Paid; `refunded + amount ≤ invoice.amount` | `refunded += amount`, then `safeTransferFrom(merchant → payer, amount)`; emits `Refunded` |
| `cancel(id)` | the invoice's merchant only | status Open | status = Cancelled; emits `Cancelled` |
| `getInvoice(id)`, `isExpired(id)` | anyone (view) | none | read helpers for the UI |

**Events (the dashboard, CSV export and webhooks read only these)**
```
InvoiceCreated(uint256 indexed id, address indexed merchant, address settleToken, uint256 amount, uint64 expiry, bytes32 orderRef)
InvoicePaid(uint256 indexed id, address indexed merchant, address indexed payer, address tokenIn, uint256 amountIn, uint256 amountSettled)
Refunded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 totalRefunded)
Cancelled(uint256 indexed id, address indexed merchant)
```

**Custom errors:** `NotMerchant`, `NotOpen`, `NotPaid`, `Expired`, `TokenNotAllowed`, `ZeroAmount`, `RefundTooLarge`.

**Safety**
- **Checks-effects-interactions.** Update state (Paid, refunded) **before** any token transfer.
- `ReentrancyGuard` (`nonReentrant`) on every function that changes state.
- `SafeERC20` for every transfer. Mainnet USDT's `transfer` doesn't return a bool, and SafeERC20 handles both styles.
- No `receive()`. ETH sent here reverts. (Native ETH support is P2.)

### 5.2 `UniswapCheckout.sol is CheckoutCore` (Unichain Sepolia only)

**Constructor:** the v4 `PoolManager` address and the settle-token allowlist (USDC). Both are fixed forever.

**Why we call the PoolManager directly (v2 decision) and not the Universal Router**
- **Tested locally.** v4-core's test helpers deploy a real PoolManager, so every swap path is tested on every `forge test` with no testnet or fork.
- **Fewer things to trust.** Only the PoolManager. No Permit2 allowance, no router command encoding.
- **You can explain every step.** The contract does v4's flash accounting itself: unlock → swap → settle what we owe → take what we're owed.

**Path format.** `struct Hop { address tokenIn; uint24 fee; int24 tickSpacing; }`
- Listed from the payer's token toward USDC: `path[0].tokenIn` is the payer's token, and each later hop's `tokenIn` is the previous hop's output. The last hop outputs USDC.
- Single hop WETH→USDC: `[ {WETH, 500, 10} ]`.
- Two hops DEMO→WETH→USDC: `[ {DEMO, 3000, 60}, {WETH, 500, 10} ]`.
- **There is no `hooks` field. The contract always uses `hooks = address(0)`, so only plain pools without hooks can be used.**
- From each hop the contract builds the `PoolKey` (sorts the two currencies, adds fee, tickSpacing and hooks = 0) and the direction (`zeroForOne` = input currency is `currency0`).

**P0: `payWithToken(id, tokenIn, maxAmountIn, Hop[] path, deadline)`**
1. **Checks.** Invoice Open and not expired. `block.timestamp ≤ deadline`. `tokenIn` ≠ settle token (use `payInvoice` for that). The path is non-empty and `path[0].tokenIn == tokenIn`. `maxAmountIn > 0`.
2. **Effects.** Mark the invoice Paid and record the payer, before any external call.
3. **Pull** `maxAmountIn` of `tokenIn` from the payer. Measure the balance before and after, and revert if less arrived (this blocks fee-on-transfer tokens).
4. **`poolManager.unlock(data)`.** The PoolManager calls back our `unlockCallback(data)`. **Only the PoolManager may call it.**
5. **Inside the callback, swap backwards from USDC (exact output):**
   - The last hop swaps for exactly `invoice.amount` USDC (in v4, a **positive** `amountSpecified` means exact output). The result tells us how much of that hop's input is needed.
   - The previous hop swaps for exactly that amount, and so on back to `tokenIn`.
   - Each hop checks the pool really delivered the full requested output; otherwise it reverts (`PartialFill`).
6. **Price cap.** `amountIn ≤ maxAmountIn`, or revert `TooExpensive`.
7. **Settle** what we owe: `poolManager.sync(tokenIn)`, transfer `amountIn` of `tokenIn` to the PoolManager, then `poolManager.settle()`.
8. **Take** what we're owed: `poolManager.take(USDC, merchant, invoice.amount)`. The USDC goes **straight to the merchant**. Intermediate tokens (WETH in a two-hop route) net to zero: one hop owes it in, the next hop pays it out. So all debts are settled and `unlock` returns.
9. **Refund leftovers.** Send `maxAmountIn − amountIn` of `tokenIn` back to the payer.
10. **Invariants (revert if broken):** the merchant's USDC balance went up by exactly `invoice.amount`, and this contract holds 0 of `tokenIn` and of USDC. Emit `InvoicePaid(id, merchant, payer, tokenIn, amountIn, invoice.amount)`.

If anything fails at any step, the **whole transaction reverts**: the invoice is Open again and the payer keeps their tokens.

**Why only pools without hooks**
- A hook is arbitrary code that runs during the swap.
- The payer is protected by `maxAmountIn` either way, but banning hooks keeps the security story simple: "we only route through plain v4 pools".
- An allowlist of audited hooks is future work.

**P1: `payWithBasket(id, Leg[] legs, deadline)`, the novelty feature**
- `struct Leg { address tokenIn; uint256 amountIn; Hop[] path; uint256 minOut; }`. A leg with `tokenIn == USDC` and an empty path is a direct top-up with no swap.
- Pull every leg's `amountIn` from the payer. Then one `unlock` runs every leg as **exact input** (negative `amountSpecified`) forward to USDC, checking each leg's output ≥ `minOut`.
- Settle every input token, and take all the USDC to this contract. Require total ≥ `invoice.amount`.
- Send exactly `invoice.amount` to the merchant and any excess USDC back to the payer.
- The ranker builds the basket greedily: cheapest cost-per-dollar tokens first, until the invoice is covered plus a 0.5% buffer.

**Not supported:** Uniswap v2/v3 pools. The ranking panel still shows v3 routes from the Trading API for comparison, marked "not executable". Native ETH is P2.

### 5.3 `DemoToken.sol` (Unichain only)
- An OpenZeppelin ERC-20 called "DEMO" with a public `mint` (testnet only, clearly labelled). It plays the "wrong token the customer holds".
- Self-minted tokens are fine for Uniswap. For Whitechain they are not, which is why Whitechain uses their real USDT.

### 5.4 Scripts
- **`DeployUnichain.s.sol`:** deploys `DemoToken` and `UniswapCheckout` (with the PoolManager and USDC). Prints the addresses.
- **`SeedPools.s.sol`:** creates our own v4 pools, because testnet liquidity is thin. It calls `PoolManager.initialize(PoolKey, sqrtPriceX96)` and adds liquidity with `PoolModifyLiquidityTest` (simplest) or `PositionManager`.
  - `WETH/USDC` at fee 500 / tickSpacing 10: the deep pool.
  - `DEMO/WETH` at fee 3000 / tickSpacing 60: medium depth.
  - `DEMO/USDC` at fee 3000 / tickSpacing 60: **deliberately thin**, so the direct route is worse than the two-hop route and the ranking panel has something to show.
  - Funding: Circle faucet USDC (10 per drip, hourly), testnet ETH wrapped to WETH, and minted DEMO. Keep demo invoices around 1 USDC.
- **`DeployWhitechain.s.sol`:** deploys `CheckoutCore` with USDT `0xcedf…55a7` on the allowlist. Then:
  ```
  forge script script/DeployWhitechain.s.sol --rpc-url https://rpc.testnet.whitechain.io/ --private-key $PK --broadcast
  forge verify-contract <addr> src/CheckoutCore.sol:CheckoutCore --rpc-url https://rpc.testnet.whitechain.io/ \
      --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/
  ```

### 5.5 `foundry.toml` profiles
- **`default` (Unichain):** solc picked automatically (v4-core needs 0.8.26 for some files), `evm_version = "cancun"`.
- **`whitechain`:** `solc = "0.8.30"` and `evm_version = "prague"`, per the Whitechain docs; verification fails otherwise [V]. It compiles `CheckoutCore.sol` on its own (`--skip test`).
- `CheckoutCore.sol` uses `pragma solidity ^0.8.24;` so both profiles can compile it.
- Libraries via `forge install`: OpenZeppelin contracts and `Uniswap/v4-core`, which includes the test helpers that deploy a real PoolManager. Nothing else.

### 5.6 Tests (Foundry)
| Test file | What it proves |
|---|---|
| `CheckoutCore.t.sol` (unit) | create → pay → refund (partial, then the rest) → over-refund reverts. Pay twice reverts. Pay after expiry reverts (`vm.warp`). Non-merchant refund or cancel reverts. Unlisted token reverts. Cancel then pay reverts. |
| `CheckoutCore.fuzz.t.sol` (fuzz) | For random amounts and refund sequences, total refunded ≤ amount, and the contract balance is always 0. |
| `UniswapCheckout.t.sol` (local, real PoolManager from v4-core's test helpers) | `payWithToken` single-hop and two-hop: merchant receives exactly the invoice amount, payer gets the leftover back, contract ends at 0. Too-low `maxAmountIn` reverts and the invoice stays Open (the whole transaction rolls back). Wrong path start reverts. Only the PoolManager can call `unlockCallback`. Basket payment covers the invoice and returns the excess. |
| `Invariants.t.sol` (invariant, at least 10k runs) | The four invariants in 5.2, over random calls through a handler contract. |

---

## 6. Off-chain components

### 6.1 Route ranker `POST /api/rank`
**Input:** `{ chainId: 1301, invoiceId, payer }`

1. **Read the invoice** from the contract (settle token, amount, status).
2. **Scan balances:** one viem `multicall` of `balanceOf(payer)` over our token list (WETH, DEMO, USDC, plus any token the API returns).
3. **Candidate routes per token (two sources):**
   - **(a) Uniswap Trading API.** `POST https://trade-api.gateway.uniswap.org/v1/quote` with headers `x-api-key` and `content-type: application/json`, and body `{ type: "EXACT_OUTPUT", amount: invoice.amount, tokenIn, tokenOut: USDC, tokenInChainId: 1301, tokenOutChainId: 1301, swapper: payer, protocols: ["V4","V3"] }`.
     - **[CHECK]** that EXACT_OUTPUT works on testnet.
     - Fallback: EXACT_INPUT with a binary search on the amount (about 6 calls, within the 6 requests per second limit).
     - Read the route, gas fields and price impact from the response. **[CHECK]** the field names on the first real response, and save one sample response in the repo.
   - **(b) On-chain v4 Quoter `0x56dc…4472`.** `quoteExactOutput({ exactCurrency: USDC, path, exactAmount })` via `simulateContract`/`eth_call` (Quoter functions revert internally, so they're only ever simulated). Run it over our enumerated paths: direct `token→USDC`, and `token→WETH→USDC`. This covers our seeded pools even if the API doesn't index them.
4. **Score:** `totalCostUSD = amountIn × spotPriceUSD(tokenIn) + gasEstimate × gasPrice × ETHpriceUSD`.
   - Spot price comes from the pool's current price (`StateView.getSlot0`) or a tiny reference quote.
   - Also show **overpay vs. spot** = fees + price impact.
5. **Filter and flag:**
   - `affordable` = balance ≥ amountIn × 1.005 (0.5% slippage buffer).
   - `executable` = the route uses only v4 pools without hooks (our contract only swaps through those).
6. **Output:** a ranked list `[{ source: "uniswap-api"|"v4-quoter", tokenIn, hops:[…], amountIn, maxAmountIn, gasUSD, impactPct, totalCostUSD, affordable, executable, pathKeys }]`.
7. **Caching and limits:** cache quotes for 15 s, and re-quote if a quote is older than 30 s [V: the API docs say to refresh quotes older than about 30 s]. The API key lives **only on the server**.

### 6.2 Pay page `/pay/[chain]/[invoiceId]` (customer view)
- **Invoice card:** merchant, amount, expiry countdown, status.
- **Ranking panel (the visible hook):**
  - A table of routes with the cheapest first, plus source badges ("Uniswap API" / "on-chain Quoter").
  - Unaffordable routes are greyed out.
  - "Pay with basket" appears when no single token covers the invoice.
- **Pay button** runs: approve (exact amount, never unlimited) or permit, then `payWithToken`. On Whitechain it's approve, then `payInvoice`.
- **Receipt:** merchant received X, you spent Y, you got Z back, explorer link. When embedded, it `postMessage`s `{type:"tender:paid", invoiceId, txHash}` to the opener.

### 6.3 Merchant dashboard `/merchant`
- Connect the merchant wallet. Invoices come from `getLogs` filtered by the indexed `merchant` on **both** chains.
- Agent sales come from the Hedera mirror node REST API: `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=<merchant 0.0.x>`.
- **Actions:**
  - Create invoice (form).
  - Cancel.
  - **Refund** (amount field, approve, then `refund`).
  - **Export CSV**, generated in the browser from the events.
- Totals per chain and per status.

### 6.4 Widget `tender.js` + `demo-shop` (the "about 20 lines" for Whitechain)
- **`tender.js`:**
  - Exposes `Tender.checkout({ chain, invoiceId, appUrl, onPaid, onClose })`.
  - Opens `appUrl/pay/<chain>/<id>?embed=1` in a popup (or an iframe modal).
  - Listens for the `tender:paid` message. It **checks the message origin** and then calls `onPaid(txHash)`.
- **`demo-shop`:** a separate small app, "Chai & Code", that sells one digital product.
  - Its server holds a **merchant testnet key** and calls `createInvoice` when Buy is clicked.
  - Production would use gasless, signed off-chain invoices. That is listed under limitations.
- **The integration the judges count:**
  ```html
  <script src="https://<tender-app>/tender.js"></script>
  <button id="buy">Buy — 1.00 USDT</button>
  <script>
    document.getElementById("buy").onclick = async () => {
      const { invoiceId } = await fetch("/api/create-invoice", { method: "POST" }).then(r => r.json());
      Tender.checkout({
        chain: "whitechain-sepolia",
        invoiceId,
        onPaid: (txHash) => { location.href = "/thanks?tx=" + txHash; },
      });
    };
  </script>
  ```
  plus about 8 lines of server route that calls `createInvoice`. Count the lines before submitting.
- **P2:** a webhook from Tender to the shop on `InvoicePaid`, HMAC-signed.

### 6.5 Hedera x402: paywall + agent
- **Paywall (in `demo-shop`):** `GET /api/agent/dataset` is wrapped by an x402 resource server.
  - Packages: `x402ResourceServer` from `@x402/core/server` [V], registered with `ExactHederaScheme` from `@x402/hedera/exact/server` [V], on network `hedera:testnet`.
  - Price: 0.05 of an HTS USDC token, which is 50,000 units at 6 decimals.
  - `payTo`: the merchant's Hedera account.
  - Facilitator: `https://api.testnet.blocky402.com`, or `https://x402.org/facilitator` [V].
  - **[CHECK]**
    - Which asset the facilitator supports: `curl <facilitator>/supported`.
    - The testnet USDC token ID. The docs example shows `0.0.6001`, which may be a placeholder; check against `/supported`.
    - The Express/Next middleware package name.
  - Fallback: price in HBAR.
- **Discovery:** the shop serves `/.well-known/tender.json`, which lists its paid endpoints, prices and asset. The agent reads it to find the endpoint. **[CHECK]** whether x402 has a standard discovery format we should use instead.
- **Agent (`agent/run.ts`):**
  - Client: `x402Client().register("hedera:*", new ExactHederaScheme(createClientHederaSigner(accountId, PrivateKey.fromString(KEY), { network: "hedera:testnet" })))` [V].
  - **Spending policy (`agent/policy.json`):**
    ```json
    { "budgetTotal": 0.20, "perMerchantCap": 0.10, "allowlist": ["chai-and-code.local"], "humanApprovalAbove": 0.10 }
    ```
  - Before paying, it checks the 402 requirements against the policy and its local spend ledger (`agent/ledger.json`).
  - After paying, it prints the Hedera transaction ID and `https://hashscan.io/testnet/transaction/<id>`.
  - **Demo:** run 1 pays, run 2 pays, run 3 is **refused** ("per-merchant cap reached").
  - **Honest limit:** the policy is enforced by the agent's own code, not on-chain. If the agent's key is stolen, the policy can be bypassed, so the agent account only holds a small balance.
- **Accounts needed:** two Hedera testnet accounts (merchant and agent) from portal.hedera.com. Both must be **associated** with the USDC token before they can receive it.
- **P2:** write each spend to an **HCS topic** as a tamper-evident audit log (an extra-points item).

### 6.6 Environment variables (`.env`, never committed; `.env.example` is committed)
```
UNISWAP_API_KEY=            # server only
UNICHAIN_SEPOLIA_RPC=       # [CHECK] e.g. https://sepolia.unichain.org
WHITECHAIN_SEPOLIA_RPC=https://rpc.testnet.whitechain.io/
DEPLOYER_PK=  MERCHANT_PK=  # fresh testnet-only wallets
HEDERA_MERCHANT_ID=  HEDERA_MERCHANT_KEY=
HEDERA_AGENT_ID=     HEDERA_AGENT_KEY=
X402_FACILITATOR_URL=https://api.testnet.blocky402.com
```

---

## 6b. Hosting decision (Nov 6): AWS for the backend, Cloudflare for the frontend

| Part | Where | How | Why |
|---|---|---|---|
| **Tender API** (`server`) | **AWS App Runner**, region ap-south-1 (Mumbai) | container from one Docker image, `npm run server`, port 8787, public https URL | managed HTTPS, no servers to maintain, cheapest AWS way to run a container 24/7 |
| **Demo shop** (`demo-shop`) | **AWS App Runner**, second service | same image, `npm run shop`, port 8788 | separate URL = separate merchant site, as the Whitechain judges expect |
| **Agent** | laptop (`npm run agent`) or a one-off container | not a service: it runs when the demo needs it | nothing to keep running |
| **Frontend** (`app`, incl. the `tender.js` widget) | **Cloudflare, Workers static assets** (Pages now deploys this way) | static Vite build with `VITE_API_URL` baked in; `app/wrangler.jsonc` serves `dist/` with SPA fallback; the browser calls the API directly (CORS) | free, fast, global; the widget is served from the same origin. **Live: https://tender.tender-app.workers.dev** |
| **Contracts** | Unichain Sepolia, Whitechain Sepolia | `scripts/deploy-unichain.sh`, `scripts/deploy-whitechain.sh` | per sponsor requirements |

Files: `Dockerfile`, `scripts/deploy-aws.sh` (ECR push + App Runner create/update for both services, capped at 2 instances each), `scripts/deploy-cloudflare.sh` (build + `wrangler deploy`), `app/wrangler.jsonc`, `.env.deploy.example` (runtime env for the containers).

**Status (Nov 6):**
- Frontend: **live** at https://tender.tender-app.workers.dev, built against a placeholder API, so the landing page works and app pages say "API offline". Redeploy with the real API URL once the backend is up.
- Backend image: built for linux/amd64 and **pushed to ECR** (`tender`, ap-south-1).
- Backend services: **blocked**. The AWS account is on the Free plan with $100 credits, and its registration is incomplete, so App Runner, Lambda, EC2, S3 and the rest answer "not signed up". On hold by the user's choice; the scripts are ready.
- Budgets: `tender-testing` $20/month and `tender-total` $100, email alerts, measured before credits.

Needed from the user, only when we reach this step: an AWS IAM user access key (ECR + App Runner + IAM role creation), a Cloudflare API token with Pages:Edit and the account id. Secrets go into `.env.deploy` (git-ignored); nothing is committed.

Order: contracts first (so the env has addresses) → `deploy-aws.sh` (prints the API and shop URLs) → `deploy-cloudflare.sh` with the API URL → re-run `deploy-aws.sh` once with `SHOP_URL`/`TENDER_APP_URL` filled in.

## 7. Repo layout (`tender/`, public, MIT)
```
tender/
├─ contracts/                 Foundry
│  ├─ src/CheckoutCore.sol
│  ├─ src/UniswapCheckout.sol
│  ├─ src/mocks/DemoToken.sol
│  ├─ script/DeployUnichain.s.sol  SeedPools.s.sol  DeployWhitechain.s.sol
│  ├─ test/CheckoutCore.t.sol  UniswapCheckout.t.sol  Invariants.t.sol
│  └─ foundry.toml
├─ app/                       Next.js: /pay, /merchant, /api/rank
├─ widget/tender.js
├─ demo-shop/                 separate app: widget integration + x402 paywall
├─ agent/                     Hedera x402 buyer + policy
├─ docs/PLAN_B.md  docs/study_B.md  docs/THREAT_MODEL.md  docs/prompts/
├─ README.md  FEEDBACK.md  WHITECHAIN_FEEDBACK.md  AI_USAGE.md  LICENSE  .env.example
```

---

## 8. Network and address reference

| Item | Value | Status |
|---|---|---|
| Unichain Sepolia chain ID | 1301 | [V] |
| v4 PoolManager (1301) | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | [V] |
| Universal Router 2.1.2 (1301) | `0xDf38F24fE153761634Be942F9d859f3DBA857E95` | [V] |
| v4 Quoter (1301) | `0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472` | [V] |
| v4 PositionManager (1301) | `0xf969aee60879c54baaed9f3ed26147db216fd664` | [V] |
| v4 StateView (1301) | `0xc199f1072a74d4e905aba1a84d9a45e2546b6222` | [V] |
| PoolModifyLiquidityTest (1301) | `0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab` | [V] |
| Permit2 (all chains) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | [V] |
| USDC (1301, Circle) | `0x31d0220469e10c4E71834a79b1f276d740d3768F` | [V] on-chain Nov 4: symbol USDC, 6 decimals, supports permit |
| WETH (1301) | `0x4200000000000000000000000000000000000006` (OP Stack predeploy) | [V] on-chain Nov 4 |
| Unichain Sepolia RPC / explorer | `https://sepolia.unichain.org` / `https://sepolia.uniscan.xyz` | RPC [V] (returns chain 1301); explorer [CHECK] |
| Uniswap Trading API | `https://trade-api.gateway.uniswap.org/v1`, `x-api-key`, 6 requests/s | [V] |
| Whitechain Sepolia chain ID | 1874 | [V] |
| Whitechain RPC / explorer / faucet | `https://rpc.testnet.whitechain.io/` / `https://explorer.testnet.whitechain.io` / `https://faucet.testnet.whitechain.io` | [V] |
| Whitechain USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | [V] on-chain Nov 4: 6 decimals, **supports permit**; how to get test USDT is **[CHECK]** |
| Hedera testnet facilitators | `https://api.testnet.blocky402.com`, `https://x402.org/facilitator` | [V] |
| Hedera explorer / mirror node | `https://hashscan.io/testnet` / `https://testnet.mirrornode.hedera.com` | [CHECK] |

---

## 9. Accounts, keys and funds (allowed before kickoff)
- [ ] **Two fresh browser-wallet accounts used only for testnets:** "merchant" and "customer", plus a "deployer" key. Never reuse a wallet that holds real funds.
- [ ] **Unichain Sepolia ETH** for both, from a faucet listed at developers.uniswap.org/docs/unichain/tools/faucets.
- [ ] **Circle USDC** on Unichain Sepolia from faucet.circle.com (10 per drip). Start collecting early, because pools need liquidity.
- [ ] **Whitechain WBT** for gas from the faucet. **Find out how to get test USDT** (faucet, Discord or the booth); without it the Whitechain prize is impossible.
- [ ] **Two Hedera testnet accounts** (merchant and agent) from portal.hedera.com. Note the key type. Associate them with the USDC token.
- [ ] **Uniswap Developer Platform API key** (developers.uniswap.org/dashboard).
- [ ] **Tools installed:** Foundry (`foundryup`), Node 20+, pnpm, git, and a browser wallet.
- [x] **Discord:** two-solo-projects question: resolved, Tender is a team project.

---

## 10. Priorities and cut order
1. **P0, Uniswap and the core** (without this there's no project):
   - CheckoutCore + UniswapCheckout.`payWithToken` + unit tests and local PoolManager tests.
   - SeedPools.
   - Ranker with both sources.
   - Pay page with the ranking panel.
   - README with contract and line links, `FEEDBACK.md`, the feedback form.
2. **P1, Whitechain:**
   - Deploy and verify CheckoutCore.
   - Widget + demo shop (about 20 lines).
   - Dashboard with refund and CSV.
   - One real USDT payment and one refund linked in the README.
   - `WHITECHAIN_FEEDBACK.md`.
3. **P1, Hedera:**
   - x402 paywall.
   - Agent with policy.
   - Settled transaction ID + HashScan link in the README.
4. **P1, novelty:** `payWithBasket`, invariant suite.
5. **P2:** webhooks, HCS audit log, native ETH, gasless signed invoices, YetiTrade swaps on Whitechain.

**Rule:** if a rail isn't truly working, drop it and don't pitch it. Three honest partial claims lose to two solid ones.

---

## 11. Threat model and what we don't solve

| Attack / failure | Handling |
|---|---|
| Reentrancy through a malicious `tokenIn` | `nonReentrant` + checks-effects-interactions; invoice is marked Paid before any external call |
| Fee-on-transfer or rebasing `tokenIn` | Balance before/after check; revert if fewer tokens arrive than were pulled |
| Sandwich attack or price move between quote and transaction | The payer's loss is capped by `maxAmountIn` (quote + 0.5%); `deadline`; if the swap needs more, the whole transaction reverts and only gas is lost; the merchant always gets exactly the amount |
| Malicious hook in a pool on the path | Hooks banned (`hooks == address(0)` per hop) |
| Broken or manipulated pool (found for real: a testnet WETH/USDC pool prices WETH at trillions of dollars) | The ranker only routes through a vetted-pool allowlist (`packages/core/src/config.ts`); the contract still guarantees the merchant's exact amount whatever pool is used |
| Payer passes a bad path | The path must end in the settle token, or the merchant delta check fails and everything reverts. A payer can only hurt themselves, bounded by `maxAmountIn` |
| Double payment | Status must be Open; it's set to Paid first |
| Refund abuse | Only the invoice's merchant can refund; cumulative refunds ≤ amount; refunds only go to the recorded payer |
| Funds stuck in the contract | Non-custodial; invariant: contract balance is 0 after every call |
| Leftover approvals | The customer approves the exact amount; the contract gives no approvals to anyone (it pays the PoolManager by direct transfer) and holds 0 tokens |
| Someone calls `unlockCallback` directly | Reverts unless `msg.sender` is the PoolManager |
| Leaked Uniswap API key | Server-side only, behind the Next.js API route |
| Compromised agent key overspending | The policy is enforced by the agent; the agent account holds only a small balance. **Disclosed** |
| Fake postMessage to the shop | The widget checks the message origin; the shop should confirm payment on-chain (README note) |

**What we don't solve (say this in the demo):**
- Testnet liquidity is our own seeded pools. On mainnet, the Trading API routes over real liquidity.
- On Whitechain the customer still needs WBT for gas. Gasless checkout is Whitechain's separate "Scale" track and isn't part of ours.
- Invoices cost the merchant a transaction. Production would use off-chain signed invoices.
- The agent's spending policy is enforced in its own code, not on-chain.
- The merchant's server key in the demo shop is a demo shortcut.
- There are no subscriptions or recurring billing.

---

## 12. Unknowns to check first at kickoff (with fallbacks)

| # | Unknown | How to check | Fallback |
|---|---|---|---|
| 1 | Trading API supports EXACT_OUTPUT on 1301 | One `curl` to `/quote` | EXACT_INPUT + binary search; or Quoter only |
| 2 | API returns routes on the testnet at all | Same `curl` | Ranker uses the v4 Quoter only; the panel still ranks routes |
| 3 | ~~v4 swap sign convention and multi-hop exact output~~ | **Done Nov 4:** 31 tests pass against a real PoolManager, including two-hop exact output | n/a |
| 4 | ~~Circle USDC address on 1301~~ | **Done Nov 4:** `cast call` returns USDC, 6 decimals, permit supported | n/a |
| 5 | How to get Whitechain test USDT | Faucet / Discord / booth | Without it, Whitechain is dropped |
| 6 | ~~Whitechain USDT supports `permit`~~ | **Done Nov 4:** `DOMAIN_SEPARATOR()` and `nonces()` exist, so `payInvoiceWithPermit` should work (confirm with one real payment) | approve + `payInvoice` |
| 7 | ~~`whitechain` profile compiles with 0.8.30~~ | **Done Nov 4:** `FOUNDRY_PROFILE=whitechain forge script script/DeployWhitechain.s.sol` compiles with 0.8.30/prague | n/a |
| 8 | ~~Hedera facilitator assets and USDC token ID~~ | **Done Nov 4:** Blocky402 `/supported` lists `exact` on `hedera:testnet`, fee payer `0.0.7162784`; USDC = `0.0.429274` (constant in `@x402/hedera`); our paywall returns a correct 402 live | n/a |
| 9 | ~~x402 middleware package~~ | **Done Nov 4:** `@x402/hono` `paymentMiddleware` (used in demo-shop) | n/a |
| 10 | Two solo projects allowed | resolved: one team project | n/a |

---

## 13. Demo

### Videos (updated Nov 7: four videos, see `tender/docs/VIDEOS.md`; the scene list below is the original single-video draft)
| Time | On screen | Proves |
|---|---|---|
| 0:00 | "You hold DEMO and WETH. The store wants exactly 1.00 USDC." The shop's Buy button opens the Tender widget | The problem |
| 0:20 | Ranking panel: three routes with amount in, gas in USD, impact, total. The two-hop route beats the direct one | Uniswap API + Quoter, the ranking |
| 0:50 | Pay. Explorer shows the merchant got **exactly 1.000000 USDC** and the customer got leftover DEMO back | Exact-output mechanism |
| 1:20 | Basket: a wallet with 0.4 USDC + DEMO + a little WETH pays one invoice in one transaction | Novelty |
| 1:50 | Same widget in the shop, now Whitechain: pay 1 USDT. Whitechain explorer link | Whitechain customer view, real USDT |
| 2:15 | Merchant dashboard: partial refund of 0.40 USDT, then Export CSV opens | Whitechain merchant view, steps after payment |
| 2:40 | Terminal: agent finds the dataset endpoint, gets 402, pays 0.05 USDC on Hedera, HashScan link. Third run is **refused** by the policy | Hedera x402 + spending controls |
| 3:10 | "What we don't solve" + repo and contract links | Honesty |

### Booth (4 minutes)
1. The same flow live.
2. Run `forge test` live, including the "too-low max reverts" test.
3. Show the CheckoutCore line where the invoice is marked Paid before the transfer.
4. Keep the video ready as a backup.

---

## 14. Submission package

### README (top to bottom)
1. One-line pitch, demo link, video link.
2. **Deployed and verified addresses** (Unichain, Whitechain), with explorer links:
   - one sample `payWithToken` transaction
   - one USDT payment
   - one refund
   - one Hedera transaction ID with its HashScan link
3. **"Where we use Uniswap":** links to the exact lines (`UniswapCheckout.sol#Lxx` for `unlock`/`swap`/`settle`/`take`, the ranker file for the Trading API call, the Quoter call).
4. **"Why on-chain stablecoin settlement on Whitechain":** one line (see §15.2 Q1).
5. Architecture diagram, setup, how to run the tests.
6. Threat model summary + "what we don't solve".
7. Built with AI (link to `AI_USAGE.md`).

### `FEEDBACK.md` (Uniswap)
Fill it in **while building**, not at the end:
- What worked.
- What was confusing: v4 action encoding, exact-output path order, testnet liquidity, API testnet coverage.
- Missing docs.
- Time to first successful swap.
- One concrete improvement.

### `WHITECHAIN_FEEDBACK.md`
Same idea: a few honest lines on faucet, USDT, verification, RPC and docs.

### `AI_USAGE.md`
- **Tools:** Claude Code.
- **Parts AI drafted:** list them.
- **Decisions you made yourself.** Write these in your own words:
  - product framing
  - non-custodial design
  - banning hooks
  - pool layout
  - policy numbers
  - demo shop concept
- **Prompts and specs:** `docs/prompts/` and this plan.

### Submission text drafts (each opens with that sponsor's own wording)
- **Uniswap:** "Tender integrates the **Uniswap API** and **v4 (PoolManager flash accounting, Quoter)** to turn any token a customer holds into an **exact-output** merchant payment: the merchant receives exactly the invoice amount, the payer gets the unused input back, and every route is ranked by total cost, gas included. Contracts and lines: …"
- **Whitechain:** "A **drop-in USDT checkout** a merchant adds in about 20 lines, with both **merchant and customer views** and **flows past the first payment**: partial refunds recorded on-chain and an accountant CSV export. Settled in Whitechain USDT on Whitechain Sepolia, contracts verified: …"
- **Hedera:** "An **x402-protected endpoint settling on Hedera testnet**, paid end to end by an **autonomous agent with spending controls** (total budget, per-merchant cap, allowlist, human approval above a threshold). Settled transaction: … (HashScan)"

---

## 15. Hostile questions and honest answers

### 15.1 Uniswap
| Question | Answer |
|---|---|
| Why not just swap in the Uniswap app and then pay? | That's two transactions, the amount is worked out by hand, and the merchant can be under- or over-paid. Ours is one transaction, exact amount guaranteed by the contract, leftover returned, and the route chosen by total cost including gas. |
| Isn't this just a UI wrapper? | No. The guarantees live in the contract: exact merchant amount, payer cap, zero contract balance, hook ban. Any app can call `payWithToken`. The basket payment is a new on-chain mechanism. |
| Why exact output and not exact input? | An invoice is fixed in the merchant's currency. Exact input makes the payer guess, and the merchant gets "about" the amount. |
| What about sandwich attacks or MEV? | The payer's worst case is `maxAmountIn` (quote + 0.5%). If the price moves past that, the transaction reverts. The merchant is never affected. |
| The price moved between quote and transaction? | Same: it reverts and only gas is lost. Quotes older than 30 s are refreshed. |
| Why your own pools? | Testnet liquidity is thin. The contract and ranker are pool-agnostic, and on mainnet the Trading API sees all liquidity. |
| Why call the PoolManager directly and not the Universal Router? | Fewer things to trust (no Permit2 allowance, no router), and we test every swap path locally against a real PoolManager. Our contract does v4's flash accounting itself: unlock, swap each hop, settle the input, take the USDC straight to the merchant. |
| Why ban hooks? | A hook runs arbitrary code during the swap. Until there's an audited allowlist, we only route through plain pools. |
| Explain v4 flash accounting. | During one unlock, the PoolManager only tracks how much each side owes (deltas). Everything must net to zero by the end: we *settle* what we owe and *take* what we're owed. |
| Gas cost? | (Fill in from `forge test --gas-report`.) |
| What if the Trading API is down? | The ranker falls back to the on-chain Quoter, which we control. |
| What did you find hard? | See `FEEDBACK.md`. Have two concrete points ready. |

### 15.2 Whitechain
| Question | Answer |
|---|---|
| Why on-chain and not Stripe? | Final settlement in seconds, no chargeback reversals (refunds are voluntary and recorded on-chain), a public receipt the customer can verify, works globally with USDT, and no custody: money goes straight to the merchant's wallet. |
| How is this more than a pay button? | Invoices with expiry and exact amounts, a drop-in widget, a merchant dashboard, partial refunds, CSV export, and separate customer and merchant views. |
| Who holds the funds? | Nobody. The contract holds zero tokens; payment goes payer → merchant in one transaction. |
| Who pays gas? | The customer pays a little WBT. Gasless checkout (relayer/permit) is a known next step and listed as a limitation. |
| Show me the 20 lines. | Open `demo-shop` and count. |
| How does a refund work? | The merchant approves the stablecoin and calls `refund(id, amount)`. Only the merchant can, only up to what was paid, and only to the original payer. |
| What about accounting? | CSV built from on-chain events: one row per payment and refund, with transaction links. |

### 15.3 Hedera
| Question | Answer |
|---|---|
| Why x402? | Agents can't fill in checkout forms or manage subscriptions. x402 turns payment into part of the HTTP request: ask, get a 402 with a price, pay, get the data. |
| Who pays the network fee? | The facilitator is the fee payer. The agent only signs the value transfer. |
| What stops the agent overspending? | Its policy: total budget, per-merchant cap, merchant allowlist, human approval above a threshold. It's enforced in the agent's code (disclosed), and the agent account holds only a small balance. |
| Can a payment be replayed? | Each Hedera transaction ID (payer account + start time) can only execute once, and the facilitator verifies the amount, asset and destination before settling. |
| Why Hedera? | Fast finality, low fixed fees, and native tokens (HTS) without deploying a contract. Good for many tiny payments. |
| Show the settled payment. | HashScan link in the README and in the agent's log output. |
| How does this connect to the rest of Tender? | Same merchant, same dashboard: an agent is just another kind of customer. |

---

## 16. Definition of done (check before submitting)
- [ ] `forge test` all green, including the PoolManager swap tests and invariant tests. Paste the gas report into the README.
- [ ] Unichain: a real `payWithToken` transaction where the merchant receives exactly the invoice amount (explorer link).
- [ ] Unichain: a real basket payment (P1).
- [ ] Whitechain: CheckoutCore **verified**. A real USDT payment and a refund (explorer links).
- [ ] Hedera: an agent run with a settled transaction ID (HashScan) and one refused run.
- [ ] Demo shop integration is about 20 lines (counted).
- [ ] README, `FEEDBACK.md` + feedback form submitted, `WHITECHAIN_FEEDBACK.md`, `AI_USAGE.md`, LICENSE.
- [ ] Video between 2:00 and 4:00, showing every party.
- [ ] Three submission texts.
- [ ] Steady commit history through the event.

---

## 17. Sources (checked Nov 4, 2026)
- ETHGlobal Mumbai prizes: https://ethglobal.com/events/mumbai/prizes (Uniswap, Whitechain and Hedera sub-pages)
- Uniswap supported chains: https://developers.uniswap.org/docs/trading/swapping-api/supported-chains
- Uniswap API integration guide: https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide
- Uniswap API FAQ (rate limit): https://developers.uniswap.org/docs/trading/swapping-api/faqs
- Swap routing (protocols): https://developers.uniswap.org/docs/trading/swapping-api/concepts/swap-routing
- v4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
- v4 swapping from a contract: https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping
- Whitechain Foundry deploy: https://docs.whitechain.io/build/deploy/deploy-with-foundry.md
- Hedera x402: https://docs.hedera.com/solutions/ai/x402 (how-it-works, pay-with-x402, merchant-integration, facilitators)
- Circle USDC (Unichain Sepolia address, from sample code): https://developers.circle.com/gateway/quickstarts/unified-balance-evm
