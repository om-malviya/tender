# Videos: one for ETHGlobal, one per sponsor

Four videos, cut from **one recording session**. Each sponsor video spends most of its time on that sponsor and shows **how that sponsor's technology creates Tender's differences** from Uniswap's Universal Router, 0x Swap-and-Send and Coinbase Commerce. The other two sponsors get one line each.

| Video | Length | Must show (sponsor rules) |
|---|---|---|
| A. ETHGlobal (general) | 3:30 (rule: 2:00–4:00) | the product, all three rails, what's new, proof |
| B. Uniswap Foundation | ~3:00 | the v4 integration: PoolManager, Quoter, the hook; live txs and contracts |
| C. Whitechain | ~3:00 (rule: 2–4 min) | the drop-in (~20 lines), **customer and merchant view**, flows after payment (refund, CSV), a real payment in their USDT, why settle on Whitechain |
| D. Hedera | ~3:00 (rule: ≤5 min) | the x402 endpoint, an agent paying **with no human**, the **HashScan link**, spending controls, HCS audit log |

**Honesty line, in every video that shows the app:** the app clips are recorded on the demo stack (a local copy of the testnets with dev wallets, so the whole flow fits on screen); the same contracts are live, and each video then shows the real transactions on the explorers. Say it once, plainly.

---

## 1. Recording plan (do this once)

**Setup:** 1440×900 window, dark theme, cursor visible, browser zoom 100%. Close notifications.

1. In `tender/`: stop anything running, then start the demo stack **fresh**: `bash scripts/dev-fork.sh`. Fresh matters: payments move the local pools, and on fresh pools the two-hop route is "Best", as the scripts say.
2. Record clips **in this order** (it matches the dev payer's balances: 3 DEMO, 0.40 USDC, a little WETH, 5 USDT):

| Clip | What to record | Used in |
|---|---|---|
| C1 | Landing: hero, scroll down, hover one ticket so the hidden characters light up | A B C D |
| C2 | Landing: scroll to "How it compares" table, hold 5 s | A B C D |
| C3 | Shop (`localhost:8788`): the product card and the integration code box on the right | A C |
| C4 | Shop → "Pay with any token · Unichain" → popup → Connect (Dev wallet, payer) → balances → ranked routes → click Pay → review sheet → Confirm → receipt "Merchant received exactly 1.00 USDC" | A B |
| C5 | Back in the shop: "Order #1 confirmed ✓ paid on-chain" | A C |
| C6 | Merchant page (Dev wallet, merchant): create a 1.00 USDC invoice → open its pay link as the payer → pick **"Hook · any router"** → review → pay → receipt "· hooked pool" | A B |
| C7 | Merchant page: create a **2.00** USDC invoice → open it as the payer → "No single token covers this invoice" → **Pay with a basket** → the basket plan → **Pay 2.00 USDC with basket** → receipt | A B |
| C8 | Shop → "Pay with USDT · Whitechain" → popup (wallet switches to Whitechain) → USDT balance → Pay → receipt "exactly 1.00 USDT" → shop confirms | A C |
| C9 | Merchant page: Refund 0.25 on the Unichain invoice → status **Part refunded** → **Export CSV** → open the file | A C |
| C10 | Dashboard (all rails in one table) → Agents page (wait 2–3 s for Hedera to load) | A C D |
| C11 | Terminal in `tender/`: `curl -i localhost:8788/.well-known/tender.json`, then `X402_ASSET=hbar bash scripts/hedera-live.sh` (two purchases settle, the third is refused). It takes over the shop on :8788, so record it **after** C3–C9. Spends 1 test HBAR. | A D |
| C12 | HashScan: one purchase tx (agent −0.5 HBAR → merchant +0.5, fee paid by `0.0.7162784`), then the topic `0.0.11345065` (purchase, purchase, refused) | A D |
| C13 | Unichain Blockscout: verified `UniswapCheckout` and `CheckoutHook`, then the two live proof txs | A B |
| C14 | Whitechain explorer: verified `CheckoutCore`, the USDT payment, the 0.40 refund, the one-signature permit payment | A C |
| C15 | Terminal: `cd contracts && forge test` (41 passed: 44 checks, the 4 invariants run as one campaign), `npx vitest run` (56 passed) | A B |
| C16 | README: the test table, then "What we don't solve" | A |

Links for C12–C14 are in the README's table at the top and in `deployments/*.env`.

---

## 2. The differences (common to all four videos)

On screen: **C2**, the "How it compares" table. Say it in one breath, ~20 s:

> **"Uniswap's Universal Router and 0x are swap tools; Coinbase Commerce is a hosted checkout that its operator signs. Tender is different in five ways: the pool itself can settle an invoice, so any router pays; one invoice can be paid from several tokens; you see every route and its true cost; invoices and refunds live on-chain with no admin; and the same merchant sells to AI agents."**

Each sponsor video then explains **which of these that sponsor makes possible**:

| Difference | Built on |
|---|---|
| The pool settles the invoice (any router pays) · exact amount to the merchant, change back in the same tx · basket of several tokens · every route ranked, impact-sized buffer, split routes, vetted pools · no router, no operator | **Uniswap v4** (PoolManager flash accounting, hooks, Quoter) |
| On-chain invoices and partial refunds to the original payer · merchant back office with CSV · a 23-line drop-in widget · one merchant across chains | **Whitechain** (USDT settlement, final in seconds, public record) |
| Sells to AI agents with spending controls · a public, tamper-evident audit log | **Hedera** (x402 settlement with facilitator-paid fees, HCS) |

---

## 3. Video A: ETHGlobal (3:30)

| Time | On screen | Say |
|---|---|---|
| 0:00 | C1 hero | **"At a crypto checkout you usually hold the wrong token. Tender lets you pay with any token, and the merchant gets the exact amount."** |
| 0:12 | C2 table | The differences paragraph (section 2). |
| 0:35 | C3 shop | **"This is a separate shop. Its whole Tender integration is this code: 23 lines."** |
| 0:45 | C4: balances → ranked routes | **"I hold DEMO and a little WETH; the shop wants 1.00 USDC. Tender ranks every Uniswap v4 route by true cost: fees, impact and gas. The two-hop route beats the thin direct pool."** |
| 1:05 | C4: review → receipt; C5 | **"I pay up to this; the merchant receives exactly 1.00, and the unused DEMO comes back in the same transaction. The shop confirms it on-chain."** |
| 1:25 | C6 hook receipt | **"This invoice was paid through a hooked pool by a plain Uniswap router. The pool's hook settled it: any router or wallet can pay a Tender invoice."** |
| 1:45 | C7 basket | **"No single token covers a 2-dollar invoice, so Tender combines three in one transaction."** |
| 2:00 | C8 Whitechain receipt | **"Same widget on Whitechain, in their USDT."** |
| 2:12 | C9 refund + CSV | **"The merchant refunds part of it on-chain, back to whoever paid, and exports a CSV for the accountant."** |
| 2:30 | C11 terminal | **"An AI agent buys data from the same shop over x402 on Hedera. Two purchases settle; the third breaks its spending policy and is refused before it signs."** |
| 2:50 | C12 HashScan topic; C10 dashboard | **"Every decision is in a public Hedera topic. One merchant, three rails, one ledger."** |
| 3:05 | C13 + C14 explorers | **"These are demo-stack recordings; the same contracts are live and verified on Unichain and Whitechain, with real payments."** |
| 3:15 | C15 tests | **"Forty-four Solidity checks against a real v4 PoolManager, fifty-six TypeScript tests, and a browser check of every page and button on the live testnets."** |
| 3:25 | C16 "What we don't solve" | **"And what we don't solve is written down."** End on C1. |

---

## 4. Video B: Uniswap Foundation (~3:00)

Focus: how **Uniswap v4** makes Tender's differences possible. Whitechain and Hedera: one line each.

| Time | On screen | Say |
|---|---|---|
| 0:00 | C1 hero | **"Tender is a checkout where you pay with any token and the merchant gets the exact amount. Most of what makes it different is built on Uniswap v4."** |
| 0:12 | C2 table | The differences paragraph, then: **"Four of those come straight from v4: hooks, flash accounting, the Quoter, and exact-output swaps."** |
| 0:35 | C4 ranked routes | **"First, routing. For every token you hold, Tender asks the v4 Quoter about every path, batched into one Multicall call, and the Trading API when there's a key. Each route shows input, fees plus impact, gas and total. The slippage buffer is sized from measured impact, not a flat number, and a split route appears when splitting across two pools is cheaper. Only vetted pools are used; we found broken ones on testnet."** |
| 1:05 | C4 review → receipt | **"Then the payment. Our contract talks to the v4 PoolManager directly: unlock, swap each hop backwards with exact output, settle the input, and `take` the USDC straight to the merchant. Before the transaction can finish, the contract checks the merchant got exactly the invoice and that it holds nothing itself. No router, no Permit2, no operator."** |
| 1:35 | C6 hook route → receipt | **"Now the part none of the others can do. This pool has our CheckoutHook. When a swap carries an invoice id, `afterSwap` takes exactly the invoice amount out of the output and sends it to the merchant, using `afterSwapReturnDelta`. This invoice was paid by Uniswap's own test router; our checkout contract was never called. The pool itself is the payment terminal."** |
| 2:05 | C7 basket | **"And flash accounting lets one unlock pay one invoice from several tokens. The planner even prices legs that share a pool against each other's impact; our end-to-end tests caught that one."** |
| 2:25 | C13 Blockscout | **"It's live on Unichain Sepolia, verified: the any-token payment, where the merchant got exactly 0.10 USDC, and the hook payment through Uniswap's router."** |
| 2:40 | C15 tests | **"Forty-four Solidity checks against a real v4 PoolManager, including fuzzing and invariants. And our feedback on building with v4 is in FEEDBACK.md."** |
| 2:52 | C10 dashboard | **"The same merchant also takes USDT on Whitechain and sells to AI agents on Hedera."** End. |

---

## 5. Video C: Whitechain (~3:00, must be 2–4 min)

Focus: Tender as a **business payments product on Whitechain**: drop-in, customer view, merchant view, life after the first payment. Uniswap and Hedera: one line each.

| Time | On screen | Say |
|---|---|---|
| 0:00 | C1 hero | **"For a business, taking stablecoins isn't a pay button. It's invoices, refunds and an accountant's export. Tender gives a merchant all of that, settled in USDT on Whitechain."** |
| 0:12 | C2 table | The differences paragraph, then: **"On Whitechain, Tender is the invoice lifecycle, the refunds, the back office, and the drop-in widget."** |
| 0:35 | C3 shop code box | **"This shop is a separate site. Its whole integration is this code, 23 lines: one script tag for the widget, one call to its own server to create the invoice, one to confirm the payment on-chain. Nothing hosted by us is trusted for the payment."** |
| 0:55 | C8: popup, Whitechain balance | **"The customer's view. The checkout opens, the wallet switches to Whitechain, and it shows their USDT."** |
| 1:10 | C8: pay → receipt; C5-style shop confirmation | **"They approve and pay. The merchant receives exactly 1.00 USDT, and the shop confirms the payment on-chain through its own server before shipping."** |
| 1:30 | C10 dashboard → C9 merchant page | **"The merchant's view: every invoice from every chain, rebuilt from contract events, no database."** |
| 1:45 | C9 refund | **"After the first payment: a partial refund. It's pulled from the merchant's wallet straight back to the original payer, recorded on-chain, and it can never exceed what was paid. The status reads 'Part refunded'."** |
| 2:05 | C9 Export CSV, file open | **"And the accountant gets a CSV: date, rail, invoice and order reference, status, currency, amount, refunded, net, who paid, with what, and the transaction."** |
| 2:20 | C14 Whitechain explorer | **"These clips are from our demo stack; on Whitechain Sepolia it's live and verified: a real payment in Whitechain USDT, a 0.40 refund, and a payment made with a single permit signature, no separate approval."** |
| 2:40 | C14 contract page | **"Why settle on Whitechain: USDT arrives in the merchant's wallet in seconds and is final; the customer gets a public receipt; refunds have a public record; and the export comes from the same source. Card and bank rails can't give a small merchant that."** |
| 2:55 | C10 dashboard | **"Customers can also pay with any token through Uniswap on Unichain, and AI agents buy over x402 on Hedera, all in the same ledger."** End. |

---

## 6. Video D: Hedera (~3:00, must be ≤5 min, show the HashScan link)

Focus: **AI agents paying a merchant over x402 on Hedera, with no human**, inside a spending policy, with a public audit log. Uniswap and Whitechain: one line each.

| Time | On screen | Say |
|---|---|---|
| 0:00 | C1 hero | **"Merchants will sell to AI agents, and agents don't fill in checkout forms. Tender lets the same merchant sell to agents over x402 on Hedera."** |
| 0:12 | C2 table | The differences paragraph, then: **"None of the three sells to agents. On Hedera, Tender does, with spending controls and a public audit log."** |
| 0:35 | C3 shop "For AI agents" box; C11 `curl` of `/.well-known/tender.json` | **"The shop publishes what it sells. An agent reads this manifest: the dataset, its price, the network."** |
| 0:55 | C11 hedera-live: purchase 1 | **"The agent calls the endpoint and gets HTTP 402: pay 0.5 HBAR to the merchant's account, and the facilitator, Blocky402, pays the network fee. Before signing, its spending policy checks the real price: is the merchant allowlisted, is it under the per-merchant cap and the total budget, does it need a human? It passes, so the agent signs and the facilitator settles on Hedera testnet."** |
| 1:30 | C11: purchase 2, purchase 3 refused | **"A second purchase settles. The third would go over the per-merchant cap, so the policy refuses it before anything is signed. No human was involved at any point."** |
| 1:50 | C12 HashScan transaction | **"Here it is on HashScan: 0.5 HBAR from the agent to the merchant, fee paid by the facilitator."** |
| 2:05 | C12 HashScan topic | **"Every decision, bought or refused, is a message in a Hedera Consensus Service topic. Anyone can read it, nobody can edit it, and the sequence numbers show nothing was dropped."** |
| 2:25 | C10 Agents page | **"The merchant sees agent revenue next to its other sales, read from the public mirror node."** |
| 2:40 | Agents page, stay | **"Honest notes: the endpoint is priced in Hedera USDC by default; this run settled in HBAR because Circle's testnet faucet wasn't delivering. And the policy runs in the agent's own code, which is exactly why the audit log is public."** |
| 2:55 | C10 dashboard | **"The same merchant takes any token through Uniswap and USDT on Whitechain: one ledger."** End. |

---

## 7. What each video proves (check before uploading)

- [ ] **A:** under 4:00; all three rails shown; explorers shown.
- [ ] **B:** the ranked routes, the exact-output receipt, the **hook payment**, the basket, Blockscout with the verified contracts and both live txs.
- [ ] **C:** 2–4 min; the **shop's integration code**, the **customer view** (checkout), the **merchant view** (dashboard, refund, CSV), the Whitechain explorer with the USDT payment and the refund, the "why Whitechain" line.
- [ ] **D:** under 5:00; the manifest, the 402, two settled purchases and a refusal, the **HashScan link** on screen, the HCS topic.
