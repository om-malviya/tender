# Submission texts

Paste these into the ETHGlobal submission form. Each opens with the sponsor's own criteria words. Fill the `_TBD_` links after deployment.

## Project description (general)

**Tender: pay with any token, the merchant gets the exact amount.**

A merchant creates an invoice for an exact stablecoin amount. The customer pays with any token they hold. Tender ranks every Uniswap v4 route by true cost (input value + fees + price impact + gas), runs an exact-output swap on the v4 PoolManager, sends the merchant exactly the invoice amount, and returns the unused input to the payer in the same transaction. If anything is off, the whole transaction reverts.

What's new: a **Uniswap v4 CheckoutHook** that settles invoices from inside any router's swap (the pool itself is the payment terminal); **basket payments** (one invoice from several tokens); a visible **ranking panel** with impact-sized slippage and split routing; and three rails for one merchant: any-token on Unichain, **USDT invoices, refunds and CSV export on Whitechain**, and **x402 sales to AI agents on Hedera**, all in one dashboard.

Non-custodial, no admin: the contracts hold zero tokens after every call. 44 Solidity checks (real v4 PoolManager, fuzz, invariants), 56 TypeScript tests, local-fork and browser end-to-end runs.

## Uniswap Foundation: Build with Uniswap

Tender integrates the **Uniswap v4 AMM, the v4 Quoter and the Uniswap API**, and ships a **new v4 hook**.

- Exact-output, multi-hop swaps directly on the **PoolManager** (unlock → swap → settle → take to the merchant), so the merchant receives exactly the invoice and the payer gets the leftover back: `contracts/src/UniswapCheckout.sol`.
- **CheckoutHook** (`afterSwap` + `afterSwapReturnDelta`): a hooked pool settles an invoice for any router that forwards `hookData`; demonstrated with Uniswap's own `PoolSwapTest` router, Tender's contract never called: `contracts/src/CheckoutHook.sol`. Hook address mined in the deploy script.
- Route ranking from the **v4 Quoter** and the **Trading API**, with buffers sized from measured price impact and **split routing** across two pools: `packages/core/src/rank.ts`.
- **Basket payments**: several tokens, one invoice, one unlock.
- Public repo, `FEEDBACK.md` (written while building: PathKey direction for exact output, `afterSwapReturnDelta` scope, hook deployment from a script, testnet pool prices), feedback form submitted. README points to every contract and line.

Proof on Unichain Sepolia (contracts verified on Blockscout): any-token payment https://unichain-sepolia.blockscout.com/tx/0x7dc679a80d3a49daa3f96a6d2e80f96af9efc23df5592d6a671af78da9f52fe9 (merchant received exactly 0.10 USDC, contract balance 0 after), hook payment through Uniswap's PoolSwapTest router https://unichain-sepolia.blockscout.com/tx/0x5445265c0fdbb79c5afc4f745dd9d1b3df5418584ad471f6389fb424cec857a8. UniswapCheckout https://unichain-sepolia.blockscout.com/address/0x013afebd608074993d87c299952116b5c3135795, CheckoutHook https://unichain-sepolia.blockscout.com/address/0x40a7409c828e62e4278ff8e4a9f30bc6ecf88044.

## Whitechain: Operate, Stablecoin Payments for Business

A **drop-in USDT checkout a merchant adds in about 20 lines** (23 in our demo shop), with **both the merchant and the customer view**, and flows **past the first payment: partial refunds recorded on-chain and a CSV export the accountant can open**.

- `CheckoutCore` deployed and **verified on Whitechain Sepolia** (chain 1874): https://explorer.testnet.whitechain.io/address/0x013aFEBD608074993D87C299952116b5c3135795
- Payment settled in **Whitechain USDT** (`0xcedf…55a7`, obtained by swapping WBT on the testnet DEX, not self-minted): https://explorer.testnet.whitechain.io/tx/0x41485818a21c88008ffbdee188c142278a0d2686068e65e707a25e53a655de64; one-signature permit payment: https://explorer.testnet.whitechain.io/tx/0x9620ce57304e80ec33ca18143560688409e5f4793a121ad7b62aa791c576ccf1; partial refund: https://explorer.testnet.whitechain.io/tx/0x798631d466d2c2c43662b1ba7eade7f36ca9404b32ce5204b95a234f7d8dd710. Contract balance is 0 after each.
- Why on-chain settlement on Whitechain: final USDT settlement in seconds straight to the merchant's wallet, a public receipt the customer can verify, refunds with an on-chain record, and an exportable ledger from the same payment, which card and bank rails can't give a small merchant.
- Widget: `app/public/tender.js`; integration: `demo-shop/public/index.html`; merchant view: `app/src/pages/MerchantPage.tsx`.
- `WHITECHAIN_FEEDBACK.md` included. Steady commit history. 2–4 min video shows customer, merchant and agent.

## Hedera: AI Agents That Pay, x402 on Hedera

An **x402-protected endpoint that settles on Hedera testnet through Blocky402**, and an **agent that discovers it and completes a paid request with no human**.

- Endpoint: `GET /api/agent/dataset` on the demo shop (`@x402/hono`, Hedera exact scheme), priced in **HTS USDC** (`0.0.429274`) by default or native HBAR (`X402_ASSET=hbar`). Discovery via `/.well-known/tender.json`. The live run settled in **HBAR** because Circle's Hedera testnet USDC faucet wasn't delivering on Nov 7.
- Agent with **spending controls**: merchant allowlist, per-merchant cap, total budget, human approval above a threshold, enforced on the real 402 price tag before signing (`agent/src/policy.ts`). The demo shows two purchases and a third **refused** by the policy.
- **HCS topic as a tamper-evident audit log** of every agent decision (bought / refused, amount, reason, transaction id): topic 0.0.11345065 (https://hashscan.io/testnet/topic/0.0.11345065), shown on the Agents page.
- Settled payments (agent, no human): https://hashscan.io/testnet/transaction/0.0.7162784@1793996113.115144711 and https://hashscan.io/testnet/transaction/0.0.7162784@1793996119.194396627; the third purchase was refused by the policy before signing (message 3 in the topic).
- README covers setup, architecture and the payment flow. Video ≤5 min with the HashScan link.
