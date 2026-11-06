# Demo video script (target 3:30, must be 2:00–4:00)

Record at 1440×900, dark theme, cursor visible. Speak the bold lines; the rest is what's on screen.

**Before recording (checked in browser QA on Nov 7):**
1. Start the stack **fresh**: stop any running one, then `bash scripts/dev-fork.sh`. Every payment moves the local pools; on fresh pools the two-hop DEMO route is "Best", as the narration says. A re-used stack can rank the direct pool first.
2. Hedera is not simulated: the Agents page reads the real merchant `0.0.11344182` and audit topic `0.0.11345065`. Give it 2–3 seconds to load from the mirror node before talking over it.
3. For the agent scene, have a second terminal ready in `tender/`: `X402_ASSET=hbar bash scripts/hedera-live.sh` (it takes over the shop on :8788 for about 30 seconds, so record it after the shop scenes; it spends 1 test HBAR).

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page, hero | **"At a crypto checkout you usually hold the wrong token. Tender lets you pay with any token, and the merchant gets the exact amount."** |
| 0:15 | Scroll to the six tickets, hover one | **"Six things a checkout should do and a swap router doesn't."** |
| 0:25 | Demo shop → "Pay with any token · Unichain" | **"A separate shop. Its whole Tender integration is 23 lines."** |
| 0:35 | Checkout popup, connect wallet, balances appear | **"I hold DEMO and a little WETH. The store wants 1.00 USDC."** |
| 0:45 | Ranked routes table | **"Every route, ranked by true cost: fees, impact and gas. The two-hop route beats the thin direct pool. The buffer is sized from measured impact, not a flat number."** |
| 1:05 | Click Pay → review sheet | **"You pay up to this, the merchant receives exactly 1.00, the rest comes back in the same transaction."** Confirm. |
| 1:20 | Receipt: "Merchant received exactly 1.00 USDC", returned amount | **"Exactly one dollar. The unused DEMO came back."** Shop shows "confirmed on-chain". |
| 1:35 | New invoice; pick the "Hook · any router" route; pay | **"This one isn't paid through our contract at all. A plain Uniswap router swaps through a hooked pool, and the pool's hook settles the invoice. Any router or wallet can pay a Tender invoice."** |
| 2:00 | Shop → "Pay with USDT · Whitechain"; pay | **"Same widget, Whitechain, their USDT. One signature."** |
| 2:15 | Merchant page: refund 0.25, Export CSV opens | **"The merchant refunds part of it on-chain and exports a CSV for the accountant."** |
| 2:35 | Terminal: `X402_ASSET=hbar bash scripts/hedera-live.sh`: purchases 1 and 2 settle, purchase 3 is refused | **"An AI agent buys from the same shop over x402 on Hedera: 402, pay, data. Inside a spending policy: the third purchase is refused."** Show the HashScan link. |
| 3:00 | Dashboard: three rails in one table; Agents page | **"One merchant, three rails, one ledger."** |
| 3:10 | `forge test` output (41 passed: the 4 invariants run as one campaign) | **"Forty-four Solidity checks against a real v4 PoolManager, with invariants and fuzzing; fifty-six TypeScript tests; end-to-end runs on copies of both testnets; and a browser check of every page and button against the live testnets."** |
| 3:20 | README "What we don't solve" | **"What we don't solve: our own testnet pools, exact-input only for the hook, the agent's policy lives in its code. The repo says so."** |
| 3:30 | Landing page | End. |

Each party appears: customer (0:35–1:35), merchant (2:15), agent (2:35). Whitechain wants 2–4 min; Hedera wants ≤5 with a HashScan link (2:35).
