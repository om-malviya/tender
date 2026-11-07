# Demo video script

One video (about 3:45) for the ETHGlobal submission. It also meets each sponsor's video rule:
- **Whitechain:** 2–4 minutes and shows both the customer and the merchant.
- **Hedera:** 5 minutes or less and shows a payment settling with the HashScan link.
- **Uniswap:** no video rule; the video still shows the v4 integration.

**Honesty line, said once:** the app clips are recorded on the demo stack (a local copy of the testnets with dev wallets, so the whole flow fits on screen); the same contracts are live, and the video then shows the real transactions on the explorers.

---

## 1. Recording plan

**Setup:** 1440×900 window, dark theme, cursor visible, browser zoom 100%. Close notifications.

1. In `tender/`: stop anything running, then start the demo stack **fresh**: `bash scripts/dev-fork.sh`. Fresh matters: payments move the local pools, and on fresh pools the two-hop route is "Best", as the script says.
2. Record the clips **in this order** (it matches the dev payer's balances: 3 DEMO, 0.40 USDC, a little WETH, 5 USDT):

| Clip | What to record |
|---|---|
| C1 | Landing: hero, scroll down, hover one ticket so the hidden characters light up |
| C2 | Landing: scroll to "How it compares" table, hold 5 s |
| C3 | Shop (`localhost:8788`): the product card and the integration code box on the right |
| C4 | Shop → "Pay with any token · Unichain" → popup → Connect (Dev wallet, payer) → balances → ranked routes → click Pay → review sheet → Confirm → receipt "Merchant received exactly 1.00 USDC" |
| C5 | Back in the shop: "Order #1 confirmed ✓ paid on-chain" |
| C6 | Merchant page (Dev wallet, merchant): create a 1.00 USDC invoice → open its pay link as the payer → pick **"Hook · any router"** → review → pay → receipt "· hooked pool" |
| C7 | Merchant page: create a **2.00** USDC invoice → open it as the payer → "No single token covers this invoice" → **Pay with a basket** → the basket plan → **Pay 2.00 USDC with basket** → receipt |
| C8 | Shop → "Pay with USDT · Whitechain" → popup (wallet switches to Whitechain) → USDT balance → Pay → receipt "exactly 1.00 USDT" → shop confirms |
| C9 | Merchant page: Refund 0.25 on the Unichain invoice → status **Part refunded** → **Export CSV** → open the file |
| C10 | Dashboard (all rails in one table) → Agents page (wait 2–3 s for Hedera to load) |
| C11 | Terminal in `tender/`: `curl -i localhost:8788/.well-known/tender.json`, then `X402_ASSET=hbar bash scripts/hedera-live.sh` (two purchases settle, the third is refused). It takes over the shop on :8788, so record it **after** C3–C9. Spends 1 test HBAR. |
| C12 | HashScan: open the first `== settled:` link C11 printed (agent −0.5 HBAR → merchant +0.5, fee paid by `0.0.7162784`), keep the **address bar visible**; then the topic `0.0.11345065` (the run reuses it: the newest messages are purchase, purchase, refused) |
| C13 | Unichain Blockscout: verified `UniswapCheckout` and `CheckoutHook`, then the two live proof txs |
| C14 | Whitechain explorer: verified `CheckoutCore`, the USDT payment, the 0.40 refund, the one-signature permit payment |
| C15 | Terminal: `cd contracts && forge test` (41 passed: 44 checks, the 4 invariants run as one campaign), `npx vitest run` (56 passed) |
| C16 | README: the test table, then "What we don't solve" |

Links for C12–C14 are in the README's table at the top and in `deployments/*.env`.

---

## 2. The differences (~20 s, over the comparison table)

> **"Uniswap's Universal Router and 0x are swap tools; Coinbase Commerce is a hosted checkout that its operator signs. Tender is different in five ways: the pool itself can settle an invoice, so any router pays; one invoice can be paid from several tokens; you see every route and its true cost; invoices and refunds live on-chain with no admin; and the same merchant sells to AI agents."**

| Difference | Built on |
|---|---|
| The pool settles the invoice (any router pays) · exact amount to the merchant, change back in the same tx · basket of several tokens · every route ranked, impact-sized buffer, split routes, vetted pools · no router, no operator | **Uniswap v4** (PoolManager flash accounting, hooks, Quoter) |
| On-chain invoices and partial refunds to the original payer · merchant back office with CSV · a 23-line drop-in widget · one merchant across chains | **Whitechain** (USDT settlement, final in seconds, public record) |
| Sells to AI agents with spending controls · a public, tamper-evident audit log | **Hedera** (x402 settlement with facilitator-paid fees, HCS) |

---

## 3. The script (~3:45)

| Time | On screen | Say |
|---|---|---|
| 0:00 | C1 hero | **"Have you ever tried to pay at a crypto checkout and realised you're holding the wrong token? The shop wants USDC, your wallet has something else, so you leave, swap, come back, and hope the price didn't move. Tender fixes that: you pay with any token you hold, and the merchant still gets the exact amount."** |
| 0:18 | C2 table | **"So how is that different from what's already out there?"** Then the differences paragraph (section 2). |
| 0:35 | C3 shop | **"This is a separate shop. Its whole Tender integration is this code: 23 lines."** |
| 0:45 | C4: balances → ranked routes | **"I hold DEMO and a little WETH; the shop wants 1.00 USDC. Tender asks the Uniswap v4 Quoter about every route and ranks them by true cost: fees, impact and gas. The two-hop route beats the thin direct pool."** |
| 1:05 | C4: review → receipt; C5 | **"Our contract talks to the v4 PoolManager directly. I pay up to this; the merchant receives exactly 1.00, and the unused DEMO comes back in the same transaction. The shop confirms it on-chain."** |
| 1:25 | C6 hook receipt | **"This invoice was paid through a hooked pool by a plain Uniswap router. The pool's hook settled it: any router or wallet can pay a Tender invoice."** |
| 1:45 | C7 basket | **"No single token covers a 2-dollar invoice, so Tender combines three in one transaction."** |
| 2:00 | C8 Whitechain: popup → receipt → shop confirms | **"The customer's view on Whitechain: the same widget, paid in Whitechain USDT. It's final in seconds, with a public receipt."** |
| 2:12 | C9 refund + CSV | **"The merchant's view: refund part of it on-chain, back to whoever paid, and export a CSV for the accountant."** |
| 2:30 | C11 terminal | **"An AI agent buys data from the same shop over x402 on Hedera. It gets a 402, checks the price against its spending policy, and pays with no human; the Blocky402 facilitator settles it. Two purchases settle; the third breaks the per-merchant cap and is refused before it signs."** |
| 2:55 | C12 HashScan tx, then topic | **"Here's the payment on HashScan: 0.5 HBAR from the agent to the merchant. It's priced in Hedera USDC by default; this run used HBAR because the USDC faucet wasn't delivering. Every decision, bought or refused, is in a public Hedera topic."** |
| 3:15 | C10 dashboard | **"One merchant, three rails, one ledger."** |
| 3:20 | C13 + C14 explorers | **"These were demo-stack recordings; the same contracts are live and verified on Unichain and Whitechain, with real payments."** |
| 3:32 | C15 tests | **"Forty-four Solidity checks against a real v4 PoolManager, fifty-six TypeScript tests, and a browser check of every page and button on the live testnets."** |
| 3:42 | C16 "What we don't solve" | **"And what we don't solve is written down."** End on C1. |

---

## 4. Sponsor sections of the submission form

Point each sponsor at its part of the same video:
- **Uniswap:** 0:45–1:45 (ranking, exact-output payment on the PoolManager, hook payment, basket), explorers at 3:20.
- **Whitechain:** 0:35 (the 23-line integration), 2:00–2:30 (customer view, merchant refund and CSV), explorer at 3:20.
- **Hedera:** 2:30–3:15 (402, policy, payment with no human, the refusal, HashScan, the audit topic).

---

## 5. Check before uploading

- [ ] Between 2:00 and 4:00 (ETHGlobal, Whitechain), so also under 5:00 (Hedera).
- [ ] All three rails shown; the honesty line said once.
- [ ] Uniswap: the ranked routes, the exact-output receipt, the hook payment, the basket, Blockscout with the verified contracts.
- [ ] Whitechain: the shop's integration code, the **customer view** (checkout), the **merchant view** (refund, CSV), the Whitechain explorer with the USDT payment and the refund.
- [ ] Hedera: the 402, two settled purchases and a refusal, the **HashScan link** readable on screen, the HCS topic.
