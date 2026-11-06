# Study guide for Project B (Tender)

> **For:** you, Person 2. You know roughly how a blockchain works and need to present Tender to sponsor judges alone and answer their questions.
> **Budget:** about 7.5 hours over 9 modules. If you only have about 3.5 hours, do the **minimum path**: Modules 1, 3, 4 and 8.
> **How to use each module:**
> 1. Read the explanation.
> 2. Skim the links if you want more depth.
> 3. Answer the self-test **out loud** before opening the answers.
> 4. Memorise the "say it in one sentence" lines; those are your booth answers.
>
> This file grows during the build. Each time we write a file, a **Build log** entry at the bottom points to the exact lines worth reading (`file:line`), explains what they do and why, and lists what a judge may ask about them. Read the Build log with the code open next to it.

## Progress tracker
- [ ] Module 0: Blockchain refresher (20 min)
- [ ] Module 1: Tokens, approvals, permits (60 min) **[minimum path]**
- [ ] Module 2: Solidity + Foundry (90 min)
- [ ] Module 3: AMMs and Uniswap v4 (90 min) **[minimum path]**
- [ ] Module 4: Tender's contracts, the design (30 min) **[minimum path]**
- [ ] Module 5: Whitechain, L2s, merchant payments (40 min)
- [ ] Module 6: Hedera + x402 + agents (45 min)
- [ ] Module 7: Frontend glue: wallets, viem, signing (30 min)
- [ ] Module 8: Pitch drill (30 min) **[minimum path]**

---

## Module 0: Blockchain refresher (20 min)

**Why it matters for Tender.** Every judge question assumes you know what an account, a transaction, gas and a revert are.

### Concepts
- **Account.** An address (20 bytes, like `0xAbC…`). There are two kinds:
  - **EOA (externally owned account):** controlled by a private key, i.e. your wallet. **Only EOAs can start a transaction.**
  - **Contract account:** has code and no private key. It only runs when called.
- **Transaction.** A signed message from an EOA containing:
  - `to` (who)
  - `value` (native coin sent)
  - `data` (which function, with which arguments)
  - `nonce` (counter that stops replays)
  - gas settings

  It goes into a block. Afterwards you get a **receipt**: success or failure, gas used, and **logs (events)**.
- **Read vs write.**
  - Reading state (`balanceOf`, `getInvoice`) is an `eth_call`. It's free, instant, and not a transaction.
  - Changing state costs gas and needs a signature.
- **Gas.**
  - Each operation costs gas units. Fee = gas used × gas price, paid in the chain's native coin:
    - ETH on Unichain
    - WBT on Whitechain
    - HBAR on Hedera
  - A failed transaction still pays for the gas it used.
- **Revert = all or nothing.** If anything fails inside a transaction, **every** state change in it is undone, as if it never happened (except the gas fee). Tender relies on this heavily: if the merchant doesn't get exactly the right amount, we revert and nobody loses money.
- **Chain ID.** A number that identifies a network, so a signature for one chain can't be replayed on another.
  - Unichain Sepolia = 1301
  - Whitechain Sepolia = 1874
- **Testnet.** A practice network whose coins are worthless, topped up from a **faucet**.
- **Explorer.** A website that shows transactions, contracts and events (Uniscan/Blockscout, the Whitechain explorer, HashScan). Judges click your explorer links.
- **L1 vs L2.**
  - Ethereum is the L1.
  - Unichain and Whitechain are **L2 rollups**: they run transactions cheaply and post the data back to Ethereum for security. More in Module 5.
- **Never** put a real wallet's private key in a project. Use fresh testnet-only keys stored in `.env`, and never commit them.

### Links (optional)
- https://ethereum.org/en/developers/docs/accounts/
- https://ethereum.org/en/developers/docs/transactions/
- https://ethereum.org/en/developers/docs/gas/

### Self-test
1. Can a smart contract start a transaction by itself?
2. A transaction runs out of gas halfway through. What happens to the state changes and to the fee?
3. Why does a chain ID exist?

<details><summary>Answers</summary>

1. No. Only an EOA can start one. A contract only runs when something calls it, though it can then call other contracts during that transaction.
2. All state changes are reverted, but the gas used is still paid.
3. So a signed transaction or message for one chain can't be replayed on another.
</details>

---

## Module 1: Tokens, approvals, permits (60 min) **[minimum path]**

**Why it matters for Tender.** Payment *is* moving tokens. Half the judge questions about safety are really about approvals.

### 1.1 ERC-20: the standard token interface
Every ERC-20 token is a contract that keeps a `mapping(address => uint256) balances` and exposes:

| Function | Meaning |
|---|---|
| `balanceOf(addr)` | how many units `addr` has |
| `transfer(to, amount)` | move **my** tokens to `to` |
| `approve(spender, amount)` | allow `spender` to move up to `amount` of my tokens |
| `allowance(owner, spender)` | how much `spender` may still move |
| `transferFrom(from, to, amount)` | `spender` moves `from`'s tokens (uses up allowance) |
| `decimals()` | how many decimal places the token uses |

It also emits events: `Transfer(from, to, amount)` and `Approval(owner, spender, amount)`.

### 1.2 Decimals: the most common bug in the room
Token amounts are integers. There are no decimals inside the EVM.
- **USDC and USDT use 6 decimals:** 1.00 USDC = `1_000_000` units.
- **WETH and most tokens use 18 decimals:** 1 WETH = `1_000_000_000_000_000_000` units.
- A Tender invoice for "1.00 USDC" stores `amount = 1_000_000`. Mixing up 6 and 18 is a classic bug: you'd be off by 10^12.

### 1.3 Why approve + transferFrom?
A contract can't take your tokens just because you called it. The token contract only lets **you** move your tokens. So:
1. You call `token.approve(TenderContract, 1_000_000)`, which is the permission.
2. You call `Tender.payInvoice(id)`, and Tender calls `token.transferFrom(you, merchant, 1_000_000)`.

That's two transactions, which is annoying.

**Risk:** approving "unlimited" (`type(uint256).max`) means a buggy or malicious contract could later drain that token from you. **Tender's UI approves the exact amount only.**

### 1.4 EIP-2612 `permit`: approval by signature
- Instead of an approve **transaction**, you sign an off-chain **message** (free, no gas) that says "I allow X to spend Y until time T".
- The contract calls `token.permit(owner, spender, value, deadline, v, r, s)` and then `transferFrom`, all in one transaction.
- The signature uses **EIP-712 typed data** (Module 7), so your wallet shows readable fields instead of random bytes.
- Not every token supports permit. USDC does. Whitechain's USDT is unknown, so we check and fall back to approve.

### 1.5 Permit2: Uniswap's universal approval contract
- Many tokens have no `permit`. **Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`, same address on every chain) fixes this. You approve Permit2 once per token, and Permit2 then manages finer permissions:
  - **AllowanceTransfer:** "spender S may move up to N tokens until time T". Stored inside Permit2, **with an expiry**.
  - **SignatureTransfer:** a one-time signed permission for a single transfer.
- **Where you'll meet it.** Uniswap's Universal Router and the Trading API's `/swap` transactions pull tokens through Permit2. Know it for questions.
- **Tender's contract does *not* use Permit2.** It talks to the v4 PoolManager directly and pays it by a plain token transfer inside the swap, so it never gives any allowance to anyone. That makes a good booth answer: "our contract approves nothing".

### 1.6 Stablecoins and wrapped tokens
- **USDC (Circle) and USDT (Tether)** are tokens meant to equal $1. Testnet versions are worthless.
- **WETH** is "wrapped ETH". ETH itself isn't an ERC-20, so WETH is an ERC-20 you get by depositing ETH, 1:1. Uniswap v4 can also use native ETH directly (written as address `0`).
- **USDT quirk.** On Ethereum mainnet, USDT's `transfer`/`transferFrom`/`approve` **don't return a bool** like the standard says. Calling them through the normal IERC20 interface can revert. That's why we use **OpenZeppelin `SafeERC20`** (`safeTransfer`, `safeTransferFrom`, `forceApprove`), which works with both styles.
- **Fee-on-transfer tokens** deliver less than you sent. We check balances before and after and reject them.

### Say it in one sentence
- "The customer approves only the exact amount, and our contract holds zero tokens between transactions and approves nothing to anyone."
- "We use SafeERC20 because USDT-style tokens don't follow the ERC-20 return-value rule."

### Links
- ERC-20: https://ethereum.org/en/developers/docs/standards/tokens/erc-20/
- EIP-2612: https://eips.ethereum.org/EIPS/eip-2612
- Permit2 repo and readme: https://github.com/Uniswap/permit2
- SafeERC20: https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20

### Self-test
1. An invoice is 2.50 USDC. What number is stored?
2. Why can't Tender just "take" the customer's tokens?
3. What's the difference between approve and permit?
4. Does Tender's contract use Permit2? Why or why not?
5. Why SafeERC20?

<details><summary>Answers</summary>

1. `2_500_000` (6 decimals).
2. Only the owner can move tokens unless they've given an allowance (approve or permit) to a spender.
3. Approve is an on-chain transaction that costs gas. Permit is an off-chain signature that a contract submits, so approval and payment happen in one transaction.
4. No. It calls the v4 PoolManager directly and pays by transferring tokens to it during the swap, so it needs no allowance. Permit2 is only needed when going through the Universal Router.
5. Some tokens (USDT) don't return a bool from transfer/approve. SafeERC20 handles both styles and reverts on failure.
</details>

---

## Module 2: Solidity + Foundry (90 min)

**Why it matters for Tender.** You must be able to explain every line of `CheckoutCore.sol` and `UniswapCheckout.sol`.

### 2.1 Anatomy of a contract (teaching example, not our project code)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;                       // compiler version allowed

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract BookLending {
    enum State { None, Available, Lent }       // a small set of named values
    struct Book { address owner; State state; address borrower; uint64 dueAt; }

    uint256 public nextId;                     // storage variable (lives on-chain forever)
    mapping(uint256 => Book) public books;     // key → value table; every key "exists" with zeroed default

    event Lent(uint256 indexed id, address indexed borrower, uint64 dueAt);   // logs for off-chain apps
    error NotOwner();                          // cheap, named revert reason
    error NotAvailable();

    modifier onlyOwner(uint256 id) {           // reusable check
        if (books[id].owner != msg.sender) revert NotOwner();
        _;                                     // "run the function body here"
    }

    function add() external returns (uint256 id) {
        id = nextId++;
        books[id] = Book({ owner: msg.sender, state: State.Available, borrower: address(0), dueAt: 0 });
    }

    function lend(uint256 id, address to, uint64 dueAt) external onlyOwner(id) {
        Book storage b = books[id];            // `storage` = a pointer to on-chain data (edits persist)
        if (b.state != State.Available) revert NotAvailable();
        b.state = State.Lent;
        b.borrower = to;
        b.dueAt = dueAt;
        emit Lent(id, to, dueAt);
    }
}
```

### 2.2 Concepts to know
- **Types:**
  - `uint256` (unsigned integer), `address`, `bool`, `bytes32`.
  - Smaller types (`uint128`, `uint160`, `uint64`, `uint48`, `uint24`, `int24`) save storage. Uniswap uses them everywhere, so you'll see casts like `uint128(amount)`.
- **Data locations:**
  - `storage`: on-chain and persistent.
  - `memory`: temporary, for the duration of the call.
  - `calldata`: read-only input from the transaction. Cheapest for arrays like `PathKey[] calldata path`.
- **Visibility:**
  - `external` (called from outside), `public` (from outside and inside), `internal` (this contract and children), `private` (this contract only).
  - `view` = reads but doesn't write. `pure` = neither reads nor writes. `payable` = can receive native ETH.
- **Globals:** `msg.sender` (who called *this* function), `msg.value` (ETH sent), `block.timestamp` (current block time, in seconds).
- **Errors:**
  - `revert CustomError()` or `require(cond, "msg")`.
  - Reverting undoes everything in the transaction.
  - Since 0.8, arithmetic overflow reverts automatically.
- **Events:** cheap logs that contracts can't read but apps can. `indexed` fields can be filtered. **Our merchant dashboard, CSV export and webhooks are built entirely from events.**
- **Inheritance:** `contract UniswapCheckout is CheckoutCore` reuses all of Core's code and adds swap functions. We deploy plain Core on Whitechain and the child on Unichain.
- **Constructor and `immutable`:** values set once at deploy and never changeable. That's how Tender has **no admin**: the PoolManager address and the token allowlist are fixed at deploy.
- **Interfaces:** `IERC20(token).transferFrom(...)` calls another contract. Every external call is a point where the other contract runs its code. See reentrancy below.

### 2.3 The two security patterns judges always ask about
**Checks-Effects-Interactions (CEI):**
1. **Checks:** validate the inputs and state (`status == Open`, not expired).
2. **Effects:** update *your own* storage (`status = Paid`).
3. **Interactions:** call other contracts (token transfers, the router), last.

**Reentrancy.** If you call an external contract *before* updating your state, that contract can call you back while your state is still old. Classic bug:
```solidity
// VULNERABLE teaching example
function withdraw() external {
    uint256 bal = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: bal}("");   // attacker's code runs here and calls withdraw() again…
    require(ok);
    balances[msg.sender] = 0;                         // …before this line ever runs → drained
}
```
**Fixes:**
- Update state first (CEI).
- Add OpenZeppelin `ReentrancyGuard`'s `nonReentrant` modifier, which blocks re-entry during the call.

Tender does **both**: an invoice is marked `Paid` before any token moves, and every state-changing function is `nonReentrant`.

### 2.4 Foundry: the toolkit
| Command | What it does |
|---|---|
| `forge init` / `forge install <repo>` | new project / add a library into `lib/` |
| `forge build` | compile |
| `forge test -vvv` | run tests (`-vvv` shows traces on failure) |
| `forge test --fork-url $RPC` | run tests against a **copy of a real chain** (real Uniswap contracts, real pools) |
| `forge test --gas-report` | gas used per function |
| `forge script script/X.s.sol --rpc-url $RPC --private-key $PK --broadcast` | deploy (without `--broadcast` it only simulates) |
| `forge verify-contract` | publish source to the explorer so anyone can read it |
| `cast call <addr> "symbol()(string)" --rpc-url $RPC` | read a contract from the terminal |
| `cast send …` | send a transaction from the terminal |
| `anvil` | local test chain |

**Writing tests:**
- Test contracts inherit `forge-std/Test.sol`. Functions named `test_…` are tests.
- Useful cheatcodes:
  - `vm.prank(addr)`: the next call comes from `addr`.
  - `vm.expectRevert(Err.selector)`: the next call must revert with this error.
  - `vm.warp(t)`: set the block time (used to test expiry).
  - `deal(token, addr, amt)`: give someone tokens.
  - `makeAddr("alice")`: a named test address.
- **Fuzz test:** a test function with parameters. Foundry runs it with hundreds of random inputs.
- **Invariant test:** functions named `invariant_…`. Foundry calls random sequences of functions, then checks that the invariant still holds. For example, "contract token balance is always 0".

**Config:**
- `foundry.toml` sets the `solc` version and `evm_version`. Profiles let one project use different settings, e.g. `FOUNDRY_PROFILE=whitechain`.
- `remappings` tell the compiler where `@uniswap/...` imports live.
- **EVM version** (cancun, prague) is which set of opcodes the chain supports. Whitechain's docs say to compile with solc 0.8.30 and `prague`, or verification fails.

### Say it in one sentence
- "We follow checks-effects-interactions and use nonReentrant: the invoice is marked Paid before any token moves."
- "Our tests deploy a real Uniswap v4 PoolManager locally and swap through real pools, plus invariant tests that throw random call sequences at the contract."

### Links
- Solidity by Example (short, practical): https://solidity-by-example.org/
- Solidity docs: https://docs.soliditylang.org/
- Foundry book: https://book.getfoundry.sh/
- Optional free course: https://updraft.cyfrin.io/

### Self-test
1. What's the difference between `storage` and `memory`?
2. Why are events essential for our merchant dashboard?
3. Explain reentrancy and our two defences.
4. What does `vm.expectRevert` do, and which Tender behaviours should be tested with it?
5. How do our tests swap through Uniswap v4 without a testnet?

<details><summary>Answers</summary>

1. `storage` is persistent on-chain data. `memory` is temporary and only exists during the call.
2. Contracts can't search history, but apps can query events (`getLogs`) to list invoices, payments and refunds cheaply and build the CSV.
3. An external contract calls back into us before our state is updated. We update state first (CEI) and use `nonReentrant`.
4. It asserts that the next call reverts (optionally with a specific error). Use it for: paying twice, paying after expiry, a non-merchant refunding, over-refunding, an unlisted token, `maxAmountIn` too low, a hook in the path.
5. v4-core ships test helpers (`Deployers`) that deploy a real PoolManager and create pools with liquidity inside the test. So every `forge test` runs real v4 swaps locally. (A *fork test* is the other option: a test against a copy of a live chain.)
</details>

---

## Module 3: AMMs and Uniswap v4 (90 min) **[minimum path]**

**Why it matters for Tender.** This is the Uniswap judges' home turf. Expect deep questions here.

### 3.1 What an AMM is
- An order book (like a stock exchange) matches buyers and sellers. That's expensive on-chain.
- An **Automated Market Maker** instead keeps a **pool** holding two tokens, and the price comes from a formula.
- **Liquidity providers (LPs)** deposit both tokens and earn the trading fees.

### 3.2 Constant product: x · y = k (Uniswap v2's model; still the intuition for v3 and v4)
- **Start:** a pool with 10 ETH (x) and 30,000 USDC (y). k = 300,000. Spot price = 3,000 USDC per ETH.
- **Buy 1 ETH:** the pool must keep x·y = k. New x = 9, so new y = 300,000 / 9 = 33,333.33. You pay **3,333.33 USDC**, not 3,000. That's 11.1% worse than spot. This is **price impact**: your own trade moves the price.
- **Buy 0.1 ETH:** new x = 9.9, so y = 30,303.03. You pay 303.03, about **1% impact**.
- **Lesson:** big trades in shallow pools are expensive. That's why Tender ranks routes: a deeper pool two hops away can beat a shallow direct pool.
- **Fees:** each swap also pays a fee tier (for example 0.05%, 0.3% or 1%) to LPs.

### 3.3 Price impact vs slippage
- **Price impact:** the price movement caused by *your* trade. It's known at quote time.
- **Slippage:** the price moving *between your quote and your transaction executing*, because of other trades or an attacker.
- **Slippage tolerance:** you set a limit. For exact output that's `amountInMaximum`: "I'll pay at most X". If the swap would need more, it reverts. Tender uses `maxAmountIn` = quote + 0.5%.

### 3.4 Exact input vs exact output
- **Exact input:** "swap exactly 0.001 WETH, give me whatever USDC that buys (at least min)".
- **Exact output:** "give me exactly 1.00 USDC, take whatever WETH it costs (at most max)".
- **Tender uses exact output** because the invoice amount is fixed. The merchant must get exactly 1.00. The unused part of `maxAmountIn` goes back to the payer.
- The **basket payment** uses exact-input legs, and the excess USDC goes back to the payer.

### 3.5 Multi-hop routes
- A route can chain pools: DEMO → WETH → USDC.
- Every hop adds a fee and gas, but if the DEMO/USDC pool is shallow, going through the deep WETH pools can still be cheaper overall.
- **The ranking panel exists to show this trade-off honestly.**

### 3.6 Uniswap versions in one minute each
- **v2:** one contract per pair. Liquidity is spread over all prices (x·y=k).
- **v3:** **concentrated liquidity**. LPs pick a price range, so there's much more depth near the current price.
  - Prices are in discrete **ticks**: price = 1.0001^tick.
  - **tickSpacing** limits which ticks are usable, and goes with the fee tier.
  - The current price is stored as **sqrtPriceX96** = √price × 2^96, a fixed-point number. Price ≈ (sqrtPriceX96 / 2^96)², adjusted for the two tokens' decimals.
- **v4 (what we use):**
  - **Singleton PoolManager.** Every pool lives inside **one** contract instead of one contract per pool. Creating pools and multi-hop swaps are much cheaper.
  - **PoolKey.** A pool is identified by `(currency0, currency1, fee, tickSpacing, hooks)`. `currency0` is the token with the lower address (tokens are always sorted). The **PoolId** is the hash of the key.
  - **Flash accounting.** Inside one `unlock` session, the PoolManager only tracks **deltas** (who owes what), not actual transfers. At the end every delta must be zero:
    - you **settle** (pay in) what you owe
    - you **take** (withdraw) what you're owed

    This uses transient storage (EIP-1153), which is cheap memory that resets after the transaction.
  - **Native ETH** is supported directly (currency `address(0)`).
  - **Hooks.** A pool can attach a hook contract that runs custom code at moments like `beforeSwap` and `afterSwap` (dynamic fees, oracles, limits…). The hook's **address bits** encode which moments it uses. **Tender only routes through pools with no hook (`hooks = address(0)`)**, because a hook is arbitrary code running during the payer's swap.

### 3.7 The pieces Tender uses
- **PoolManager, called directly.** This is the heart of our Uniswap integration. Five calls to know:
  1. `poolManager.unlock(data)`: "I want to do some swaps". The PoolManager immediately calls back our contract's `unlockCallback(data)`. Everything happens inside that callback.
  2. `poolManager.swap(key, params, hookData)`: swap in one pool. `params.amountSpecified` **negative = exact input** ("I give exactly this much"), **positive = exact output** ("I want exactly this much out"). It returns a `BalanceDelta`: for each of the pool's two tokens, negative = we owe the pool, positive = the pool owes us.
  3. `poolManager.sync(currency)`, then transfer the tokens to the PoolManager, then `poolManager.settle()`: **pay** what we owe. sync records the balance before, so settle can measure what arrived.
  4. `poolManager.take(currency, to, amount)`: **withdraw** what we're owed, sent to any address. We send the USDC **straight to the merchant**.
  5. When the callback returns, the PoolManager checks that every debt is zero. If not, the whole transaction reverts (`CurrencyNotSettled`).
- **Hop** (our struct) describes one pool on the route: `{ tokenIn, fee, tickSpacing }`. From it the contract builds the PoolKey (sorted currencies, fee, tickSpacing, hooks = 0). For exact output we walk the route **backwards** from USDC: first "how much WETH for exactly 1 USDC?", then "how much DEMO for exactly that much WETH?".
- **Universal Router** (we *don't* use it, but know it). A Uniswap contract that runs encoded **commands** (e.g. `V4_SWAP` with actions `SWAP_EXACT_OUT`, `SETTLE_ALL`, `TAKE_ALL`) and pulls tokens through Permit2. It's built for wallets. We call the PoolManager ourselves so our contract can enforce the merchant guarantees with fewer moving parts, and so we can test everything locally.
- **Quoter.** A contract that simulates a swap and returns "amount in needed" plus a gas estimate, without doing it (it reverts internally). We only ever call it with `eth_call`/`simulateContract`, never in a real transaction.
- **StateView.** Reads pool state (current sqrtPrice, liquidity) for spot prices.
- **PoolModifyLiquidityTest.** A helper contract on testnets for adding liquidity simply. We use it to seed our demo pools.
- **Uniswap Trading API.** Uniswap's hosted routing service.
  - Flow: `POST /quote` returns the best route + gas estimate + maybe a `permitData` to sign. Then `POST /swap` returns a ready transaction. Then the wallet sends it.
  - Needs an `x-api-key` (keep it on the server). Limit: 6 requests per second per key. Refresh quotes older than about 30 s.
  - `protocols` can restrict routing to `V2`/`V3`/`V4`.
  - **UniswapX** is a different system: off-chain signed orders filled by "fillers". It isn't documented for testnets, so we don't use it.
  - **Tender uses `/quote` for ranking.** Execution goes through **our** contract, not `/swap`, because the contract must enforce the merchant guarantees.

### 3.8 MEV and sandwich attacks
- **MEV** is profit extracted by ordering transactions. **Sandwich attack:** an attacker sees your pending swap, buys first (pushing the price up), lets your swap run at the worse price, then sells.
- **The defence is your slippage limit:** the attacker can only push you up to `amountInMaximum`, and beyond that your transaction reverts.
- In Tender the **merchant is never affected** (they always get exactly the amount). The payer's worst case is bounded by `maxAmountIn` = quote + 0.5%.

### 3.9 Unichain
- Uniswap's own L2 (OP Stack, like Whitechain). The testnet is **Unichain Sepolia, chain 1301**.
- The Uniswap v4 PoolManager and Quoter are deployed there, and Circle USDC has a faucet.
- That's why it's our Uniswap chain.

### Say it in one sentence
- "Tender does an exact-output swap directly on the v4 PoolManager: the merchant gets exactly the invoice amount, the payer is capped at maxAmountIn, and the unused input is returned in the same transaction."
- "Flash accounting means the PoolManager tracks only what each side owes during an unlock, and everything must net to zero: we settle the input and take the output."
- "We rank routes from both the Trading API and the on-chain v4 Quoter by total cost, which is input value plus gas, because a deep two-hop route can beat a shallow direct pool."

### Links
- v4 hooks concept: https://developers.uniswap.org/docs/protocols/v4/concepts/hooks
- v4 swapping from a contract: https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping
- Trading API integration guide: https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide
- Deep dive if curious (v3 math): https://uniswapv3book.com/

### Self-test
1. Pool: 100 DEMO / 100 USDC. Roughly how much DEMO to get 10 USDC out (ignore fees)? Why is it more than 10?
2. Price impact vs slippage: what's the difference?
3. Why exact output for invoices?
4. What is a PoolKey and why are currency0/currency1 sorted?
5. Explain flash accounting, settle and take, in your own words.
6. Why do we ban hooks in paths?
7. Why don't we just use the Trading API's `/swap` transaction?
8. How does `maxAmountIn` protect against a sandwich attack?

<details><summary>Answers</summary>

1. k = 10,000. New USDC = 90, so DEMO = 10,000 / 90 ≈ 111.1. You add about **11.1 DEMO**. It's more than 10 because of price impact (and real pools also charge a fee).
2. Impact is caused by your own trade's size. Slippage is the price changing between quote and execution.
3. The invoice amount is fixed in the merchant's currency, so the merchant must receive exactly that and the payer's side flexes, up to a cap.
4. The pool's identity: `(currency0, currency1, fee, tickSpacing, hooks)`. Sorting means there's exactly one key for a given pair and settings.
5. During one unlock, the PoolManager records debts and credits instead of moving tokens each step. At the end we pay in (settle) what we owe and withdraw (take) what we're owed, and everything must net to zero or the transaction reverts.
6. Hooks are arbitrary code that runs during the swap. Banning them keeps the guarantees simple until there's an audited allowlist.
7. Its transaction pays the swapper. We need our contract in the middle to enforce exact merchant payment, refund the leftover and mark the invoice Paid, all in one transaction.
8. The attacker can only worsen your price up to the cap. Beyond it the transaction reverts and only gas is lost.
</details>

---

## Module 4: Tender's contracts, the design (30 min) **[minimum path]**

**Why it matters.** "Walk me through your contract" is the first booth question. Read this next to `PLAN_B.md` §5. Line-by-line notes get added to the Build log once the code exists.

### 4.1 CheckoutCore: the invoice state machine
```
createInvoice → Open ──pay──► Paid ──refund (partial, repeatable, total ≤ amount)──► Paid
                 ├──cancel──► Cancelled
                 └──after expiry: Open but unpayable
```
- **Non-custodial.** Payment moves payer → merchant directly, and the contract holds 0 tokens.
- **No admin.** The token allowlist is fixed at deploy; there's nothing to upgrade and no owner.
- **Refunds** are pulled from the merchant's wallet (they approve first) to the **recorded payer** only. Only the merchant can refund, and only up to the amount paid in total.

### 4.2 UniswapCheckout.payWithToken: nine steps you should be able to recite
1. **Check:** invoice open and not expired, before the deadline, path starts with the payer's token.
2. **Effect:** mark Paid and record the payer.
3. **Pull** `maxAmountIn` from the payer, and check the amount actually received.
4. **Unlock** the PoolManager. It calls back our `unlockCallback`.
5. **Swap backwards** hop by hop with exact output, starting from "exactly `amount` USDC".
6. **Cap:** the input needed must be ≤ `maxAmountIn`.
7. **Settle** the input token we owe, and **take** exactly `amount` USDC straight to the merchant.
8. **Return** the leftover input to the payer, and check the invariants: merchant delta == amount, contract balances == 0.
9. **Emit** `InvoicePaid`.

If anything fails at any step, the **whole transaction reverts**: the invoice is Open again and nobody lost anything but gas.

### 4.3 The invariants (memorise them)
1. The merchant receives **exactly** the invoice amount.
2. The contract's token balances are **0** after every call.
3. The payer never spends more than `maxAmountIn`.
4. Total refunded ≤ the invoice amount.

### 4.4 Basket payment (novelty)
- Several **exact-input** legs (for example 0.4 USDC directly + DEMO→USDC + WETH→USDC).
- Require the sum to be ≥ the amount. Send the merchant exactly the amount and the excess back to the payer.
- The ranker picks the legs greedily, cheapest tokens first.

### Self-test
1. Draw the invoice state machine from memory.
2. Recite the nine steps of `payWithToken`.
3. Why is marking Paid *before* the swap safe even though the swap could fail?
4. Why does the contract need to measure the balance received in step 3?

<details><summary>Answers</summary>

3. Because a failed swap reverts the whole transaction, including the Paid marking. CEI gives safety against reentrancy and costs nothing in correctness.
4. Fee-on-transfer tokens deliver less than requested. We reject them so the accounting stays exact.
</details>

---

## Module 5: Whitechain, L2s, merchant payments (40 min)

**Why it matters.** The Whitechain judges care about real merchant flows, not crypto cleverness.

### 5.1 L2 rollups and the OP Stack
- An **L2 rollup** executes transactions on its own fast chain, then posts the transaction data to Ethereum (L1).
- **Optimistic rollups** (like those built with the **OP Stack**, Optimism's open-source rollup software) assume batches are valid unless someone proves fraud within a challenge window. That's why withdrawals to L1 traditionally take about 7 days.
- A **sequencer** orders transactions on the L2.
- **Whitechain is an EVM-compatible OP Stack L2** whose gas token is **WBT**. The testnet is **Whitechain Sepolia, chain 1874**.
- "EVM-compatible" means our Solidity contract and Foundry work unchanged. We just point at a different RPC.

### 5.2 Why merchants might want on-chain stablecoin settlement
| Benefit | Honest counterpoint |
|---|---|
| Final settlement in seconds; no chargeback reversals | Customers lose card-style buyer protection; we offer voluntary on-chain refunds |
| Public, verifiable receipt for both sides | Amounts and addresses are public |
| Global, 24/7, no bank in the middle | Customer needs a wallet and some WBT for gas |
| Programmable: invoices, partial refunds, exports from events | Regulation and tax handling are the merchant's job |
| Non-custodial: money lands straight in the merchant's wallet | Merchant must secure their own keys |

### 5.3 Merchant payment vocabulary
- **Invoice:** a request for an exact amount, with an expiry and an order reference.
- **Payment link:** a URL that opens checkout for an invoice.
- **Refund / partial refund:** sending some or all of the money back to the payer.
- **Reconciliation:** matching payments to orders. That's what `orderRef` and the CSV are for.
- **Webhook:** the payment system calls the shop's server ("order 123 paid") so the shop can ship.
- **Drop-in widget:** a `<script>` plus one function call that a shop adds. It opens a popup or iframe, and the popup reports back with `postMessage`. The shop must check the message's **origin**, and should confirm on-chain.

### 5.4 Deploying and verifying on Whitechain
- Deploy with `forge script … --rpc-url https://rpc.testnet.whitechain.io/ --broadcast`.
- Verify with `forge verify-contract … --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/`.
- **Why verify?** The explorer then shows the source code, so judges and users can read exactly what they're trusting. It's a qualification requirement.

### Say it in one sentence
- "Payments settle in Whitechain USDT directly into the merchant's wallet in seconds, with a public receipt; refunds and exports come from the same on-chain record, which a card rail can't give a small merchant."

### Links
- Whitechain docs: https://docs.whitechain.io
- Deploy with Foundry: https://docs.whitechain.io/build/deploy/deploy-with-foundry.md
- OP Stack overview: https://docs.optimism.io/

### Self-test
1. What does "OP Stack L2" mean in one sentence?
2. Give two benefits and two downsides of on-chain stablecoin checkout for a merchant.
3. Why must the shop check the `postMessage` origin?
4. What is contract verification and why do judges care?

<details><summary>Answers</summary>

1. A chain built on Optimism's rollup software that executes transactions cheaply and posts their data to Ethereum for security.
3. Otherwise any page could send a fake "paid" message. The shop should also confirm the payment on-chain.
4. Publishing the source code to the explorer so anyone can check the deployed bytecode matches it. It proves what the contract really does.
</details>

---

## Module 6: Hedera + x402 + agents (45 min)

**Why it matters.** Hedera is very different from Ethereum. The judges will test whether you know the basics.

### 6.1 Hedera basics
- **Not a typical blockchain.** Hedera uses **hashgraph** consensus: nodes gossip about transactions and reach agreement through "virtual voting".
  - Finality is fast (a few seconds) and doesn't roll back.
  - Fees are **fixed in USD terms** and very low.
  - The network is run by a council of organisations.
- **Accounts** have IDs like `0.0.123456` (shard.realm.number), with an **ED25519** or **ECDSA (secp256k1)** key. The native coin is **HBAR**. Hedera also has an EVM layer, but **x402 on Hedera uses native token transfers, not contracts**.
- **HTS (Hedera Token Service).** Native tokens (like USDC) created without a smart contract, with IDs like `0.0.xxxxx`.
  - **Gotcha:** an account must **associate** with a token before it can receive it. This is an anti-spam rule.
- **HCS (Hedera Consensus Service).** Post messages to a **topic**, and they get an ordered, timestamped, tamper-evident record. Good for audit logs (our stretch goal).
- **Mirror nodes.** Read history through a REST API. **HashScan** is the explorer.
- **Transaction ID** = payer account + valid-start timestamp. Each ID can only execute once, which is why a signed payment can't be replayed.

### 6.2 x402: payments built into HTTP
- **HTTP 402 "Payment Required"** has existed since the 1990s but was never used. x402 is an open standard that gives it a job. The flow on Hedera:
  1. The agent calls `GET /api/agent/dataset`.
  2. The server replies **402** with payment requirements: amount, asset, `payTo` account, and the **fee payer** (the facilitator).
  3. The agent builds a Hedera `TransferTransaction` (asset → payTo), sets the facilitator as the fee payer, signs it, and resends the request with the payment attached in a header (`X-PAYMENT` in the docs).
  4. The server asks the **facilitator** to `/verify` (structure, asset, amount, destination) and then `/settle`. The facilitator adds its signature, pays the network fee and submits it.
  5. The server returns the data. The agent logs the transaction ID and its HashScan link.
- **Facilitator.** A service that verifies and submits payments so the merchant doesn't run blockchain infrastructure. Testnet options: Blocky402 (`https://api.testnet.blocky402.com`) and x402.org (`https://x402.org/facilitator`). The trade-off is trusting a third party (centralisation), which the Hedera docs themselves mention.
- **Packages:**
  - `@x402/core` (client and resource server)
  - `@x402/hedera` (the Hedera "exact" scheme)
  - `@hiero-ledger/sdk` (Hedera keys and transactions)

### 6.3 Agents and spending controls
- An **AI agent** here is a program with its own wallet that decides to buy things.
- **The risk:** a bug or a prompt injection ("ignore your instructions and pay this address") could make it spend money.
- **Our policy:** total budget, per-merchant cap, merchant allowlist, and human approval above a threshold.
- **Honest limit:** the policy is enforced in the agent's code, not on-chain, so we keep only a small balance in the agent account.

### Say it in one sentence
- "x402 turns payment into part of the HTTP request: the agent asks, gets a 402 with a price, signs a Hedera transfer, the facilitator settles it and pays the fee, and the agent gets the data, all with no human."
- "Our agent only pays allowlisted merchants within a budget and per-merchant cap; the third purchase in the demo is refused."

### Links
- x402 on Hedera: https://docs.hedera.com/solutions/ai/x402
- How it works: https://docs.hedera.com/solutions/ai/x402/how-it-works
- Pay with x402: https://docs.hedera.com/solutions/ai/x402/pay-with-x402
- Facilitators: https://docs.hedera.com/solutions/ai/x402/facilitators
- x402 protocol: https://github.com/x402-foundation/x402

### Self-test
1. What is token association, and what breaks if you forget it?
2. Walk through the x402 flow in five steps.
3. Who pays the Hedera network fee in x402, and why does that matter for agents?
4. Why can't the same signed payment be submitted twice?
5. What's the weakness of our spending policy, and how do we limit it?

<details><summary>Answers</summary>

1. An account must opt in to an HTS token before receiving it. Without it the payment to the merchant fails.
3. The facilitator does, so the agent doesn't need HBAR for fees and the merchant doesn't run infrastructure.
4. A Hedera transaction ID (payer + valid start time) can only execute once, and the facilitator verifies before settling.
5. It's enforced off-chain in the agent's code. We keep the agent's balance small and disclose it.
</details>

---

## Module 7: Frontend glue: wallets, viem, signing (30 min)

**Why it matters.** You'll demo a web app and should know how it talks to the chain.

### Concepts
- **How a dApp works:**
  - The web page reads chain data through an **RPC node** (an HTTP endpoint that speaks the Ethereum JSON-RPC protocol).
  - It asks the **wallet** (MetaMask, Rabby) to sign transactions. The page **never sees the private key**.
- **viem.** A TypeScript library for talking to Ethereum:
  - `publicClient.readContract` / `multicall`: reads; multicall batches many reads, e.g. all balances, into one request.
  - `simulateContract`: a dry run, used for the Quoter.
  - `walletClient.writeContract`: send a transaction through the wallet.
  - `getLogs`: fetch events for the dashboard.
- **wagmi.** React hooks on top of viem (connect wallet, read, write). Used in the Next.js app.
- **ABI.** The JSON description of a contract's functions and events. Foundry writes it to `out/…json`, and the frontend uses it to encode calls.
- **EIP-712 typed data signing.** Structured messages that wallets display readably. Used for permits (EIP-2612 and Permit2).
- **API keys stay server-side.** The Uniswap API key is used in our Next.js `/api/rank` route, never in browser code.

### Links
- https://viem.sh
- https://wagmi.sh
- EIP-712: https://eips.ethereum.org/EIPS/eip-712

### Self-test
1. Does our web app ever hold the customer's private key?
2. Why multicall for balances?
3. Where does the Uniswap API key live, and why?

<details><summary>Answers</summary>

1. No. The wallet signs, and the page only asks.
2. One request instead of one per token: faster and kinder to rate limits.
3. On the server (API route). In browser code anyone could copy it.
</details>

---

## Module 8: Pitch drill (30 min) **[minimum path]**

### 30-second pitch (memorise)
> "At a crypto checkout, customers hold the wrong token. Tender lets them pay with any token while the merchant receives the exact stablecoin amount. We rank every Uniswap route by true total cost, including gas, then one Solidity transaction does an exact-output v4 swap: the merchant gets exactly 1.00 USDC, the customer's unused input comes back, and if anything's off the whole thing reverts. Merchants get a drop-in widget, refunds and CSV export on Whitechain in USDT, and they can sell to AI agents per request over x402 on Hedera, all in one dashboard."

### Sponsor-specific openers
- **Uniswap:** "We use the Uniswap API and the v4 Quoter to rank routes, and swap directly on the v4 PoolManager with exact output to guarantee an exact merchant payment on-chain. Here are the lines…"
- **Whitechain:** "A drop-in USDT checkout in about 20 lines, merchant and customer views, plus refunds and accountant export after the first payment."
- **Hedera:** "An x402-protected endpoint on Hedera testnet, paid by an autonomous agent with a budget, per-merchant cap and allowlist. Here's the HashScan link, and here's it refusing the third purchase."

### Drill method
1. Open `PLAN_B.md` §15 (hostile questions).
2. Cover the answers and answer each question out loud in at most 20 seconds.
3. Mark any you fumbled and re-read the matching module.
4. Do the "walk me through payWithToken" question (Module 4.2) until it takes under 60 seconds.
5. Practise saying **"we don't solve X, and here's why"** calmly. Honest limits win trust.

---

## Glossary
| Term | Meaning |
|---|---|
| ABI | JSON description of a contract's functions/events, used to encode calls |
| AMM | Automated market maker: a pool that prices trades by formula |
| Basket payment | Tender paying one invoice from several tokens in one transaction |
| CEI | Checks-Effects-Interactions: the ordering that prevents reentrancy |
| EOA | Externally owned account (wallet with a private key) |
| Exact output | Swap that fixes the amount out and caps the amount in |
| Facilitator | x402 service that verifies and settles payments and pays the fees |
| Flash accounting | v4 tracking of debts/credits during an unlock, settled at the end |
| Fork test | A test run against a copy of a live chain |
| HCS / HTS | Hedera Consensus Service / Hedera Token Service |
| Hook | Custom code attached to a v4 pool, run at swap/liquidity moments |
| Invariant | A property that must always be true (e.g. contract balance = 0) |
| MEV / sandwich | Profit from ordering transactions / buying before and selling after a victim |
| Permit / Permit2 | Approval by signature / Uniswap's universal approval contract |
| PoolKey / PathKey | v4 pool identity / one hop in a v4 route |
| Price impact | Price movement caused by your own trade's size |
| Quoter | Contract that simulates a swap to return the amount needed |
| Rollup / OP Stack | L2 that posts data to Ethereum / Optimism's rollup software |
| Slippage | Price change between quote and execution |
| Universal Router | Uniswap contract that executes encoded commands (e.g. V4_SWAP); we don't use it |
| unlock / settle / take | v4 PoolManager calls: start a session / pay what you owe / withdraw what you're owed |
| x402 | Open standard using HTTP 402 for machine payments |

---

## Build log (appended as we build)
Each entry: **file → what it does → the lines to read, in order → likely judge questions + answers.**
The links open the exact line in VS Code. Read with the code next to this file.

**How to run everything yourself** (do this once; seeing tests pass makes the code real):
```
cd tender/contracts
forge test                                   # all 31 tests
forge test --match-test twoHop -vvvv         # full call trace of one payment (see B3 "The trace")
forge test --gas-report                      # gas per function

cd ..                                        # back to tender/
npm install                                  # once
npx vitest run                               # 29 TypeScript tests (ranker, basket, API, shop, agent policy)
bash scripts/e2e-fork.sh                     # FULL end-to-end on a local copy of Unichain Sepolia (see B14)
bash scripts/dev-fork.sh                     # the WHOLE PRODUCT on your laptop: open http://localhost:5173 (see B18)
npx tsx e2e/ui.e2e.ts                        # (with dev-fork running) a robot clicks through the real UI
npx tsx e2e/paywall.check.ts                 # asks the real Hedera facilitator for a 402 price tag (no payment)
```

---

### B1. `foundry.toml`: compiler settings ([open](tender/contracts/foundry.toml))
**What it does.** Tells Foundry where code lives, which compiler to use, and where libraries are.

**Lines to know**
- [L6](tender/contracts/foundry.toml#L6) `solc = "0.8.26"`. Uniswap's PoolManager, which our tests deploy, needs exactly this version.
- [L13](tender/contracts/foundry.toml#L13) `code_size_limit`. Raised **for tests only**: the test contract embeds a whole PoolManager and is about 118 KB. Real deployments use the normal 24 KB limit.
- [L14–20](tender/contracts/foundry.toml#L14-L20) **remappings**: `v4-core/…` means `lib/v4-core/…`, and so on.
- [L32–35](tender/contracts/foundry.toml#L32-L35) `[profile.whitechain]`: solc **0.8.30** + **prague**, because the Whitechain docs say verification fails otherwise. Build: `FOUNDRY_PROFILE=whitechain forge build src/CheckoutCore.sol` (checked: it compiles).

**Judge question.** "Why two compiler versions?" → "Unichain tests need 0.8.26 because of Uniswap's PoolManager. Whitechain's explorer verifies 0.8.30/prague, and CheckoutCore compiles under both because its pragma is `^0.8.24`."

---

### B2. `CheckoutCore.sol`: invoices, payment, refunds (both chains) ([open](tender/contracts/src/CheckoutCore.sol))
**What it does.** A merchant creates an invoice for an exact stablecoin amount. Anyone pays it, and the merchant can refund it partly or fully. This exact file is what runs on **Whitechain** with USDT.

**Read in this order**
1. [L14](tender/contracts/src/CheckoutCore.sol#L14) `contract CheckoutCore is ReentrancyGuard`. It inherits OpenZeppelin's `nonReentrant` lock (Module 2.3).
2. [L18–34](tender/contracts/src/CheckoutCore.sol#L18-L34) the `Status` enum and `Invoice` struct. Know every field. "Expired" isn't stored; it's computed from `expiry`.
3. [L37](tender/contracts/src/CheckoutCore.sol#L37) `nextInvoiceId = 1`. Ids start at 1 because an unused mapping slot is all zeros (`status = None`), so id 0 can never be confused with a real invoice.
4. [L40](tender/contracts/src/CheckoutCore.sol#L40) + [L70–74](tender/contracts/src/CheckoutCore.sol#L70-L74) `isSettleToken`, filled once in the **constructor**. There's no function to change it later, so **no admin exists**.
5. [L81–99](tender/contracts/src/CheckoutCore.sol#L81-L99) `createInvoice`: three checks (allowed token, amount > 0, expiry in the future). `msg.sender` becomes the merchant.
6. [L132–134](tender/contracts/src/CheckoutCore.sol#L132-L134) `payInvoice` → [L162–166](tender/contracts/src/CheckoutCore.sol#L162-L166) `_payDirect` → [L178–182](tender/contracts/src/CheckoutCore.sol#L178-L182) `_markPaid`. **This is checks-effects-interactions**: `_markPaid` sets `status = Paid` ([L180](tender/contracts/src/CheckoutCore.sol#L180)) *before* the token moves at L164. The tokens go **payer → merchant directly**, so the contract never holds them.
7. [L105–115](tender/contracts/src/CheckoutCore.sol#L105-L115) `refund`: only the merchant ([L107](tender/contracts/src/CheckoutCore.sol#L107)), only if Paid, never more than paid in total ([L110](tender/contracts/src/CheckoutCore.sol#L110)), and always to the **recorded payer** ([L113](tender/contracts/src/CheckoutCore.sol#L113)). The effect (`refunded += amount`, [L112](tender/contracts/src/CheckoutCore.sol#L112)) happens before the transfer.
8. [L139–143](tender/contracts/src/CheckoutCore.sol#L139-L143) `payInvoiceWithPermit`: an EIP-2612 signature replaces the approve transaction (Module 1.4). The `try … catch {}` on [L141](tender/contracts/src/CheckoutCore.sol#L141) means that if someone copies the signature from the mempool and submits it first, the allowance already exists and payment still works, so it can't be griefed.
9. [L49–56](tender/contracts/src/CheckoutCore.sol#L49-L56) the `InvoicePaid` event. The merchant dashboard and CSV export are built only from events like this.

**Judge questions**
- "Where is the money held?" → "Nowhere. [L164](tender/contracts/src/CheckoutCore.sol#L164) moves it payer → merchant in the same call; the tests assert the contract balance is always 0."
- "Can a stranger refund money to themselves?" → "No. Only the invoice's merchant can call refund (L107), and the money only goes to the recorded payer (L113)."
- "Why mark Paid before transferring?" → "Checks-effects-interactions. If the token call re-entered us, the invoice is already Paid. If anything fails, the whole transaction reverts, so marking early costs nothing."
- "Your linter flags reentrancy warnings." → "Every function that calls a token is `nonReentrant`, and state is updated before the call. The warnings are the linter's generic pattern matching."

---

### B3. `UniswapCheckout.sol`: pay with any token via Uniswap v4 ([open](tender/contracts/src/UniswapCheckout.sol))
**What it does.** Extends CheckoutCore. The payer sends up to `maxAmountIn` of any token, the contract swaps through v4 pools for **exactly** the invoice amount of USDC, pays the merchant, and returns the unused input. This is **the file the Uniswap judges will read.**

**Read in this order**
1. [L25](tender/contracts/src/UniswapCheckout.sol#L25) `is CheckoutCore, IUnlockCallback`. It reuses all the invoice logic, and promises the PoolManager it has an `unlockCallback` function.
2. [L32–45](tender/contracts/src/UniswapCheckout.sol#L32-L45) the `Hop` and `Leg` structs, i.e. how a route is described. DEMO→WETH→USDC = `[ {DEMO,3000,60}, {WETH,500,10} ]`.
3. [L52](tender/contracts/src/UniswapCheckout.sol#L52) `poolManager` is `immutable`, set once. It's the only Uniswap contract we trust.
4. [L78–93](tender/contracts/src/UniswapCheckout.sol#L78-L93) `payWithToken`: deadline check, `_markPaid` ([L85](tender/contracts/src/UniswapCheckout.sol#L85), same CEI as B2), path checks (`BadPath`), then the work.
5. [L104–131](tender/contracts/src/UniswapCheckout.sol#L104-L131) `_payExactOut`, the five steps:
   - a `Snapshot` of balances ([L98](tender/contracts/src/UniswapCheckout.sol#L98))
   - **pull** the max ([L119](tender/contracts/src/UniswapCheckout.sol#L119))
   - **unlock** ([L122](tender/contracts/src/UniswapCheckout.sol#L122))
   - **return leftover** ([L125](tender/contracts/src/UniswapCheckout.sol#L125))
   - **invariants** ([L128–130](tender/contracts/src/UniswapCheckout.sol#L128-L130)): merchant +amount exactly, and the contract kept nothing.
6. [L227–232](tender/contracts/src/UniswapCheckout.sol#L227-L232) `unlockCallback`. [L228](tender/contracts/src/UniswapCheckout.sol#L228) is critical: **only the PoolManager may call it**.
7. [L237–254](tender/contracts/src/UniswapCheckout.sol#L237-L254) `_exactOutCallback`, **the heart of the Uniswap integration**:
   - the loop at [L243](tender/contracts/src/UniswapCheckout.sol#L243) walks the route **backwards** from USDC
   - [L249](tender/contracts/src/UniswapCheckout.sol#L249) is the price cap (`TooExpensive`)
   - [L251](tender/contracts/src/UniswapCheckout.sol#L251) **settles** what we owe
   - [L252](tender/contracts/src/UniswapCheckout.sol#L252) **takes** the USDC **straight to the merchant**
8. [L280–288](tender/contracts/src/UniswapCheckout.sol#L280-L288) `_swapExactOut`: **positive `amountSpecified` = exact output** ([L282](tender/contracts/src/UniswapCheckout.sol#L282)). It checks the pool delivered the full amount (`PartialFill`).
9. [L300–305](tender/contracts/src/UniswapCheckout.sol#L300-L305) `_settle`, v4's three-step payment: `sync` (the PoolManager notes its balance) → transfer tokens to it → `settle` (it counts what arrived).
10. [L309–320](tender/contracts/src/UniswapCheckout.sol#L309-L320) `_poolKey`: the two tokens are **sorted by address** ([L311](tender/contracts/src/UniswapCheckout.sol#L311)), and `hooks: IHooks(address(0))` ([L318](tender/contracts/src/UniswapCheckout.sol#L318)) is why only pools without hooks can ever be used.
11. [L323–329](tender/contracts/src/UniswapCheckout.sol#L323-L329) `_swapParams`: no price limit (the extreme values). Protection comes from `maxAmountIn` instead.
12. [L337–341](tender/contracts/src/UniswapCheckout.sol#L337-L341) `_pullExact`: measures what really arrived, which rejects fee-on-transfer tokens.

**Worked example (it's the real test, numbers from the trace).** Invoice 10 USDC, payer sends max 8 DEMO, route DEMO→WETH→USDC:

| Step (inside `unlockCallback`) | Our debts/credits at the PoolManager |
|---|---|
| swap WETH/USDC, exact out 10 USDC → needs 0.003335 WETH | USDC **+10**, WETH **−0.003335** |
| swap DEMO/WETH, exact out 0.003335 WETH → needs 6.69 DEMO | WETH **0** (nets out), DEMO **−6.69** |
| `_settle(DEMO, 6.69)` | DEMO **0** |
| `take(USDC, merchant, 10)` | USDC **0**: everything is zero, so `unlock` succeeds |

After the unlock, the contract returns 8 − 6.69 = **1.31 DEMO** to the payer.

**The trace.** Run `forge test --match-test twoHop -vvvv` and you'll see exactly: `transferFrom` (pull 8 DEMO) → `PoolManager::unlock` → `UniswapCheckout::unlockCallback` → `swap` (amountSpecified 1e7 = 10 USDC) → `swap` (3.335e15 WETH) → `sync` → `transfer` 6.69 DEMO → `settle` → `take` 10 USDC to merchant → `transfer` 1.31 DEMO back to payer.

**Basket (novelty), when you're comfortable with the above.**
- [L140–154](tender/contracts/src/UniswapCheckout.sol#L140-L154) `payWithBasket` → [L156–181](tender/contracts/src/UniswapCheckout.sol#L156-L181) `_payBasket` → [L257–277](tender/contracts/src/UniswapCheckout.sol#L257-L277) `_basketCallback`.
- Same idea, but each leg is **exact input** (negative `amountSpecified`, [L292](tender/contracts/src/UniswapCheckout.sol#L292)). The total must cover the invoice, and the excess goes back to the payer ([L198–206](tender/contracts/src/UniswapCheckout.sol#L198-L206)).

**Gas (from `forge test --gas-report`).** `payWithToken` ≈ 200k gas for one hop and ≈ 250k for two. `createInvoice` ≈ 147k. A 3-leg basket ≈ 390k.

**Judge questions**
- "Anyone can call `unlockCallback`, it's external!" → "It reverts unless `msg.sender` is the PoolManager ([L228](tender/contracts/src/UniswapCheckout.sol#L228)), and the PoolManager only calls back whoever called `unlock`, which is us, with data we built."
- "Explain flash accounting." → Use the table above: debts and credits are tracked during the unlock, and everything must be zero at the end.
- "Why no price limit on the swap?" → "Exact output plus `maxAmountIn` is the protection. If the route costs more than the payer's cap, [L249](tender/contracts/src/UniswapCheckout.sol#L249) reverts the whole thing."
- "What if the pool runs out of liquidity?" → "The swap would deliver less than asked. `PartialFill` reverts, and the payer keeps everything."
- "Why check balances when you already know the amounts?" → "Defence in depth: the invariants prove the outcome, not the intent. They compare before/after, so someone sending tokens to the contract can't break payments."
- "Why not the Universal Router?" → "It's built for wallets and needs Permit2 allowances. Calling the PoolManager directly means fewer contracts to trust, no approvals from our contract, and every swap tested locally against a real PoolManager."
- "Why `zeroForOne = tokenIn < tokenOut`?" → "v4 sorts a pool's tokens by address. If we sell the lower-address token (currency0), we're swapping zero-for-one."

---

### B4. `mocks/DemoToken.sol` ([open](tender/contracts/src/mocks/DemoToken.sol))
**What it does.** A worthless, anyone-can-mint ERC-20 called DEMO, used **only on testnet** as "the wrong token the customer holds". 15 lines, nothing to defend. It isn't used on Whitechain (their prize requires their real USDT).

---

### B5. The tests: your proof at the booth
**[TenderFixture.sol](tender/contracts/test/utils/TenderFixture.sol)**: the shared setup.
- [L43](tender/contracts/test/utils/TenderFixture.sol#L43) `deployFreshManagerAndRouters()` deploys a **real Uniswap v4 PoolManager**. This is why we need no testnet to test swaps.
- [L53–55](tender/contracts/test/utils/TenderFixture.sol#L53-L55): the three pools. WETH/USDC is deep, DEMO/WETH is deep, and DEMO/USDC is **thin on purpose**.
- [L110](tender/contracts/test/utils/TenderFixture.sol#L110) shows how a starting price becomes `sqrtPriceX96` (Module 3.6).

**[UniswapCheckout.t.sol](tender/contracts/test/UniswapCheckout.t.sol)**: the ones to show judges:
- [L20](tender/contracts/test/UniswapCheckout.t.sol#L20) single hop: the merchant gets exactly 10 USDC.
- [L55](tender/contracts/test/UniswapCheckout.t.sol#L55) **the ranking proof**: the two-hop route costs ~6.69 DEMO, the thin direct pool ~8 DEMO. `vm.snapshotState`/`revertToState` runs both from the same starting state.
- [L76](tender/contracts/test/UniswapCheckout.t.sol#L76) the cap is too low → reverts, the **invoice stays Open**, and the payer loses nothing.
- [L153](tender/contracts/test/UniswapCheckout.t.sol#L153) only the PoolManager can call the callback.
- [L162](tender/contracts/test/UniswapCheckout.t.sol#L162) basket: 4 USDC + 3 DEMO + 0.001 WETH pays 10 USDC, and the excess comes back.
- [L221](tender/contracts/test/UniswapCheckout.t.sol#L221) **fuzz**: 1,000 random invoice sizes; the merchant always gets exactly the amount.

**[CheckoutCore.t.sol](tender/contracts/test/CheckoutCore.t.sol)**: the invoice rules (= Whitechain behaviour):
- [L45](tender/contracts/test/CheckoutCore.t.sol#L45) full lifecycle: create → pay → partial refund → refund the rest.
- [L64](tender/contracts/test/CheckoutCore.t.sol#L64) permit: pay with a signature and no approve transaction.
- [L159](tender/contracts/test/CheckoutCore.t.sol#L159) over-refund reverts.
- [L184](tender/contracts/test/CheckoutCore.t.sol#L184) fuzz on refund sequences.

**[Invariants.t.sol](tender/contracts/test/Invariants.t.sol)**: the strongest evidence.
- [L14](tender/contracts/test/Invariants.t.sol#L14) a **handler**: a "random user" that creates, pays (directly or by swapping WETH), refunds, cancels and lets time pass. It keeps **ghost** totals of what should have happened.
- [L113–140](tender/contracts/test/Invariants.t.sol#L113-L140), the four invariants checked after every call:
  - the contract holds nothing
  - merchant balance = paid − refunded
  - refunds ≤ amount
  - refunded implies Paid
- Result: **256 runs × 64 calls = 16,384 random calls, all invariants held.**

**Judge question.** "How do you know it works?" → "31 tests, including a real v4 PoolManager, 1,000-run fuzz tests and invariant tests over 16k random calls. Here, I'll run them." (Run `forge test` live; it takes about 3 seconds.)

### B6. Deploy scripts: how the contracts get onto real testnets
These are run once each, from your terminal. They're not deployed yet, because that needs your testnet keys and faucet funds.

**[DeployUnichain.s.sol](tender/contracts/script/DeployUnichain.s.sol)**
- [L16](tender/contracts/script/DeployUnichain.s.sol#L16) the real Uniswap v4 PoolManager on Unichain Sepolia. **Checked on-chain on Nov 4**: the contract exists at that address.
- [L18](tender/contracts/script/DeployUnichain.s.sol#L18) Circle USDC. **Checked on-chain**: symbol USDC, 6 decimals, supports permit.
- [L26–27](tender/contracts/script/DeployUnichain.s.sol#L26-L27) deploys DemoToken and UniswapCheckout. `vm.startBroadcast()` means "the following calls become real transactions signed by your key".

**[SeedPools.s.sol](tender/contracts/script/SeedPools.s.sol)**: why we create our own pools
- Testnet pools are often empty or have nonsense prices, so the demo creates and funds its own three pools: the same shape as the tests, but smaller.
- [L52](tender/contracts/script/SeedPools.s.sol#L52) wraps testnet ETH into WETH.
- [L61–65](tender/contracts/script/SeedPools.s.sol#L61-L65) is the important trick:
  - The 0.05% WETH/USDC pool **already exists** on Unichain Sepolia, at its own (odd) price of roughly $1,000–1,200 per WETH.
  - So the script reads that price back and prices DEMO against it ([`_wethForUsdc`, L71](tender/contracts/script/SeedPools.s.sol#L71)).
  - Result: 1 DEMO = $1.50 on **both** routes, and the "two hops beat the thin pool" story holds whatever WETH costs.
- [L90–97](tender/contracts/script/SeedPools.s.sol#L90-L97): `getSlot0` reads a pool's current price. 0 means "doesn't exist yet → create it"; otherwise keep the existing price.
- [L104](tender/contracts/script/SeedPools.s.sol#L104) adds full-range liquidity through Uniswap's `PoolModifyLiquidityTest` helper, which is deployed on Unichain Sepolia.
- What it costs you on the real testnet: about 0.1 testnet ETH and 36 faucet USDC.

**[DeployWhitechain.s.sol](tender/contracts/script/DeployWhitechain.s.sol)**
- [L18](tender/contracts/script/DeployWhitechain.s.sol#L18) Whitechain's official test USDT. **Checked on-chain**: 6 decimals, supports permit.
- [L25](tender/contracts/script/DeployWhitechain.s.sol#L25) deploys only CheckoutCore, with no Uniswap part (Uniswap isn't on Whitechain).
- The header comment has the exact `forge verify-contract … --verifier blockscout` command Whitechain requires.

**Both deploy scripts were dry-run locally (no keys, no money): they work.**

**Judge question.** "Why are your pools so small and your own?" → "Testnet liquidity is thin and unreliable, so the demo seeds its own pools. The contract and ranker work with any v4 pool without hooks; on mainnet the Trading API would route over real liquidity."

---

**Your self-test for B1–B5**
1. Point to the line that makes Tender non-custodial in `CheckoutCore`.
2. Point to the line that stops anyone but the PoolManager calling the callback.
3. In the worked example, why does WETH end at 0 without us ever holding WETH?
4. Which line would revert if a sandwich attack pushed the price up by 5% with a 0.5% buffer?
5. Which test proves the ranking panel's claim that two hops can beat one?

<details><summary>Answers</summary>

1. [CheckoutCore.sol L164](tender/contracts/src/CheckoutCore.sol#L164): `safeTransferFrom(msg.sender, inv.merchant, …)`, payer straight to merchant.
2. [UniswapCheckout.sol L228](tender/contracts/src/UniswapCheckout.sol#L228).
3. The first swap leaves us owing WETH (−), and the second swap gives us exactly that WETH (+). Flash accounting nets them inside the PoolManager, so no WETH is ever transferred to us.
4. [L249](tender/contracts/src/UniswapCheckout.sol#L249) `TooExpensive`: the route now needs more than `maxAmountIn`, so everything reverts.
5. [UniswapCheckout.t.sol L55](tender/contracts/test/UniswapCheckout.t.sol#L55) `test_twoHopRoute_isCheaperThan_thinDirectPool`.
</details>

---

## Build log, part 2: everything off-chain (TypeScript)

**The big picture.** The contracts can only check and move money. Everything else runs off-chain:
- **finding** routes and **pricing** them
- **reading** history for the dashboard
- **creating** invoices for the shop
- **paying** as an AI agent

All of it lives in `tender/` as four small TypeScript packages:

| Folder | What it is | Runs where |
|---|---|---|
| `packages/core` | shared library: networks, routes, quoting, ranking, basket, history, CSV, Hedera | imported by everything |
| `server` | the **Tender API**: what the pay page and merchant dashboard will call | `npm run server` → :8787 |
| `demo-shop/server` | **Chai & Code**: a separate shop that uses Tender (invoices + x402 paywall) | `npm run shop` → :8788 |
| `agent` | the **AI agent** that buys from the shop over x402 on Hedera | `npm run agent` |

The frontend (pay page, dashboard, widget, shop pages) comes next, from your reference design.

---

### B7. `packages/core`: networks, routes and quotes
**[config.ts](tender/packages/core/src/config.ts)**
- [L5](tender/packages/core/src/config.ts#L5) Whitechain isn't built into viem, so we describe it ourselves (chain 1874, gas token WBT).
- [L51](tender/packages/core/src/config.ts#L51) `FEE_TIERS`: the v4 fee tiers we search: 0.05%, 0.30%, 1%, each with its tick spacing.
- [L37](tender/packages/core/src/config.ts#L37) + [L43](tender/packages/core/src/config.ts#L43) + [L68](tender/packages/core/src/config.ts#L68): the **vetted-pool allowlist**. **Know this story; it's a great judge answer:**
  - Our end-to-end test found that a real WETH/USDC pool on Unichain Sepolia prices WETH at *trillions* of dollars.
  - The ranker routed through it and every dollar figure exploded.
  - So routes may only use pools we've vetted. `TENDER_ANY_POOL=1` lifts the rule.
- [L63](tender/packages/core/src/config.ts#L63) `loadChains` reads everything from environment variables, with verified defaults. That's how tests point the same code at a local fork.

**[paths.ts](tender/packages/core/src/paths.ts)**
- [L5](tender/packages/core/src/paths.ts#L5) `Hop`: exactly the Solidity `Hop` struct, so the ranker's output goes straight into `payWithToken`.
- [L27](tender/packages/core/src/paths.ts#L27) `candidatePaths`: every route we try.
  - 3 direct routes (one per fee tier) plus 9 via WETH (every tier combination).
  - [L29](tender/packages/core/src/paths.ts#L29) then drops anything not on the allowlist.
- [L61](tender/packages/core/src/paths.ts#L61) vs [L75](tender/packages/core/src/paths.ts#L75): **the PathKey gotcha** (also in FEEDBACK.md):
  - For exact **output**, Uniswap's `intermediateCurrency` is each hop's *input*.
  - For exact **input**, it's each hop's *output*.
  - Same route, two encodings.

**[quoter.ts](tender/packages/core/src/quoter.ts)**
- [L18](tender/packages/core/src/quoter.ts#L18) the Quoter ABI, checked against the live Quoter on Nov 4.
- [L62](tender/packages/core/src/quoter.ts#L62) `Quoter` is an *interface*: the real one asks the chain, and tests pass a fake with fixed prices. This is called dependency injection, and it's why the ranker tests run offline in milliseconds.
- [L73](tender/packages/core/src/quoter.ts#L73) `simulateContract`. The Quoter "does" a swap and then reverts with the answer, so we only ever *simulate* it (eth_call): no transaction, no gas.
- [L81](tender/packages/core/src/quoter.ts#L81) a pool that doesn't exist just returns `null` and the route is dropped.

**[tradingApi.ts](tender/packages/core/src/tradingApi.ts)**: the Uniswap Trading API as a second quote source
- [L71](tender/packages/core/src/tradingApi.ts#L71) `POST /quote` with `type: "EXACT_OUTPUT"` ([L84](tender/packages/core/src/tradingApi.ts#L84)) and our `x-api-key`.
- [L45](tender/packages/core/src/tradingApi.ts#L45): if the API's route is all plain v4 pools, our contract can execute it. Otherwise (v3, hooks, split routes) it's shown in the panel for comparison as "not executable".
- Not tested live yet: it needs your API key. The parser is written defensively and unit-tested with sample responses.

---

### B8. `rank.ts`: the ranking panel's brain ([open](tender/packages/core/src/rank.ts))
**Read in this order**
1. [L15](tender/packages/core/src/rank.ts#L15) `RankedRoute`: one row of the panel. Know these fields:
   - `amountIn`: what the swap needs.
   - `maxAmountIn`: plus 0.5%; the payer approves this.
   - `inputUsd`, `overpayUsd` (fees + price impact), `gasUsd`, `totalCostUsd` (what we sort by).
   - `affordable`, `executable`.
2. [L73](tender/packages/core/src/rank.ts#L73) **step 1:** read the invoice from the contract. Refuse if it isn't Open or has expired.
3. [L89](tender/packages/core/src/rank.ts#L89) **step 2:** all the payer's balances in **one** multicall.
4. [L102](tender/packages/core/src/rank.ts#L102) "pay in USDC directly" is always a candidate route (no swap).
5. [L106–156](tender/packages/core/src/rank.ts#L106-L156) **step 3:** for each token the payer holds, quote every allowed route in parallel ([L125](tender/packages/core/src/rank.ts#L125)), plus the Trading API if a key is set ([L137](tender/packages/core/src/rank.ts#L137)).
6. [L113–119](tender/packages/core/src/rank.ts#L113-L119) **token prices:** quote a tiny $0.01 trade on the best route, then **remove the pool fee** ([L116](tender/packages/core/src/rank.ts#L116)). This was a real bug caught by a unit test: without it, the "overpay" column hid the fees.
7. [L158–169](tender/packages/core/src/rank.ts#L158-L169) **step 4:**
   - USD values, plus gas in USD (gas units from our own `forge test --gas-report`, [L43](tender/packages/core/src/rank.ts#L43))
   - sort cheapest first
   - **recommend** the cheapest route that is affordable *and* executable ([L169](tender/packages/core/src/rank.ts#L169))
8. [L46](tender/packages/core/src/rank.ts#L46) `withSlippage` rounds **up**, so `maxAmountIn` is never one unit too small.

**Real output from the fork test** ($1.00 invoice; the payer holds 3 DEMO, 0.0003 WETH, 0.40 USDC):
```
 x USDC (no swap)                     direct     1 USDC          total $1.09   <- can't afford (has 0.40)
 x WETH -0.05%-> USDC                 v4-quoter  0.000797 WETH   total $1.29   <- can't afford (has 0.0003)
   DEMO -0.30%-> WETH -0.05%-> USDC   v4-quoter  0.6987 DEMO     total $1.37   <- RECOMMENDED
   DEMO -0.30%-> USDC                 v4-quoter  0.8024 DEMO     total $1.46   <- the thin pool loses
```
On the local fork the gas price is anvil's default, so the gas column is inflated. Real Unichain gas is far cheaper.

**Judge questions**
- "How do you rank?" → "Total cost = the value of what you give up, plus gas, in USD. Fees and price impact show up as overpay."
- "Why would two hops ever beat one?" → "Depth. A thin pool's price impact costs more than an extra 0.05% fee. Our fork run shows 0.699 vs 0.802 DEMO."
- "What about broken or manipulated pools?" → "We found one on the real testnet pricing WETH at trillions of dollars. Tender only routes through vetted pools (config.ts L68), and the merchant is protected either way because the contract guarantees the exact amount."
- "What if the Trading API is down?" → "The on-chain Quoter is always used; the API is a second opinion."

---

### B9. `basket.ts`: paying one invoice from several tokens ([open](tender/packages/core/src/basket.ts))
- [L42](tender/packages/core/src/basket.ts#L42) USDC first (no swap, no cost), then the other tokens, cheapest first ([L48](tender/packages/core/src/basket.ts#L48)).
- [L53](tender/packages/core/src/basket.ts#L53): can this one token cover the rest (plus a 0.5% buffer)? If yes, take just enough and stop.
- [L62](tender/packages/core/src/basket.ts#L62): if not, spend all of it, and count only its **guaranteed** output (`minOut` = quote − 0.5%).
- [L70](tender/packages/core/src/basket.ts#L70): the guaranteed outputs add up to at least the invoice, so the contract's `Underpaid` check can't fail. Any extra comes back to the payer.
- **Fork run:** 0.40 USDC + 0.00032 WETH + 0.151 DEMO → the merchant got exactly 1.00 USDC.

---

### B10. History, CSV and Hedera sales: the merchant dashboard's data
**[invoices.ts](tender/packages/core/src/invoices.ts)**: **events are our database**
- [L41](tender/packages/core/src/invoices.ts#L41) `listInvoices` rebuilds a merchant's history from `InvoiceCreated` / `InvoicePaid` / `Refunded` / `Cancelled` events. There's no backend database at all.
- [L74–86](tender/packages/core/src/invoices.ts#L74-L86) scans in chunks of `cfg.logChunk` blocks: **1,000 on Unichain, 5,000 on Whitechain**, the limits we measured on their public RPCs. Up to 6 chunks run in parallel ([`mapLimit`, L43](tender/packages/core/src/invoices.ts#L43)), and everything already scanned is remembered ([`logCache`, L40](tender/packages/core/src/invoices.ts#L40)), so later loads only fetch new blocks. See B19 for how we found this.
- [L73](tender/packages/core/src/invoices.ts#L73) `cacheTime: 0`: **a bug the fork test caught.** viem caches the latest block number for ~4 s, so a refund made a moment ago was missing from the dashboard.
- [L122](tender/packages/core/src/invoices.ts#L122) "Expired" is computed (Open and past expiry), just like in the contract.

**[csv.ts](tender/packages/core/src/csv.ts)**: the accountant export (a Whitechain extra-credit item)
- [L6](tender/packages/core/src/csv.ts#L6) one row per sale across **all three rails**: date, rail, invoice, order ref, status, amount, refunded, net, payer, paid with, tx link.
- [L25](tender/packages/core/src/csv.ts#L25) proper CSV escaping (quotes and commas), so Excel opens it cleanly.

**[hedera.ts](tender/packages/core/src/hedera.ts)**
- [L2](tender/packages/core/src/hedera.ts#L2) Hedera testnet USDC is token `0.0.429274`, the same constant the official `@x402/hedera` library uses.
- [L33](tender/packages/core/src/hedera.ts#L33) + [L53](tender/packages/core/src/hedera.ts#L53) reads the merchant's incoming USDC payments from Hedera's public **mirror node**. No keys needed, which is how agent sales appear in the dashboard.

---

### B11. The Tender API server ([open](tender/server/src/app.ts))
| Endpoint | Line | Used by |
|---|---|---|
| `POST /api/rank` `{chain, invoiceId, payer}` | [L51](tender/server/src/app.ts#L51) | pay page: the ranking panel |
| `POST /api/basket` | [L73](tender/server/src/app.ts#L73) | pay page: "pay with several tokens" |
| `GET /api/invoices/:chain/:id` | [L107](tender/server/src/app.ts#L107) | pay page header, the shop's thank-you page |
| `GET /api/invoices?merchant=0x…` | [L124](tender/server/src/app.ts#L124) | merchant dashboard (both chains) |
| `GET /api/hedera/sales?account=0.0.x` | [L131](tender/server/src/app.ts#L131) | merchant dashboard (agent sales) |
| `GET /api/export.csv?merchant=0x…&hedera=0.0.x` | [L138](tender/server/src/app.ts#L138) | the "Export CSV" button |

- [L23](tender/server/src/app.ts#L23) `ServerDeps`: everything external (chain clients, quoter, Trading API, mirror node) is passed in. Tests pass fakes; [index.ts](tender/server/src/index.ts) passes the real ones.
- [L33](tender/server/src/app.ts#L33) JSON can't hold `bigint` (token amounts are huge integers), so amounts go out as strings like `"1000000"`.
- [L37](tender/server/src/app.ts#L37) every input is validated with `zod`: a bad address or chain gives a 400, not a crash.
- [index.ts L19](tender/server/src/index.ts#L19): the Trading API is only used when `UNISWAP_API_KEY` is set. The key stays on the server.
- The server holds **no keys and no money**. It only reads the chain. The payer signs in their own wallet.

---

### B12. Chai & Code shop server: invoices for humans, x402 for agents ([open](tender/demo-shop/server/app.ts))
**x402 paywall**, [L31–51](tender/demo-shop/server/app.ts#L31-L51):
- [L32](tender/demo-shop/server/app.ts#L32) an x402 **resource server** that talks to a **facilitator** (Blocky402 on testnet) and understands Hedera's "exact" scheme.
- [L37–40](tender/demo-shop/server/app.ts#L37-L40) the middleware: `GET /api/agent/dataset` costs **$0.05**, paid to the merchant's Hedera account on `hedera:testnet`.
- [L74](tender/demo-shop/server/app.ts#L74): the dataset handler only ever runs *after* the payment is verified and settled.
- **Live check, done Nov 4** (`npx tsx e2e/paywall.check.ts`). Calling it without paying returns **HTTP 402** with this price tag:
  ```
  { scheme: "exact", network: "hedera:testnet", amount: "50000", asset: "0.0.429274",
    payTo: <merchant>, maxTimeoutSeconds: 300, extra: { feePayer: "0.0.7162784" } }
  ```
  So: 50,000 units = $0.05 USDC, and the facilitator's account `0.0.7162784` pays the Hedera network fee.

**Discovery**, [L54](tender/demo-shop/server/app.ts#L54): `/.well-known/tender.json` lists what's for sale, so the agent can *find* the endpoint (a Hedera requirement).

**Invoices for humans**, [L91](tender/demo-shop/server/app.ts#L91): `POST /api/create-invoice`
- Turns $1.00 into `1_000_000` units ([L99](tender/demo-shop/server/app.ts#L99)).
- Sends `createInvoice` from the merchant's wallet ([L103](tender/demo-shop/server/app.ts#L103)).
- Reads the new invoice id from the `InvoiceCreated` event and returns it to the page, which opens the Tender widget.
- The merchant key sitting on the shop server is a **demo shortcut**. Say so if asked.

**Judge questions**
- "What does the facilitator do?" → "It verifies the signed Hedera transfer (right asset, amount and recipient), adds its signature as fee payer, submits it, and tells the shop it settled."
- "Who pays gas on Hedera?" → "The facilitator: account 0.0.7162784 in the 402 above. The agent needs no HBAR for fees."

---

### B13. The AI agent ([policy.ts](tender/agent/src/policy.ts), [run.ts](tender/agent/src/run.ts))
**The policy:** [policy.ts L30](tender/agent/src/policy.ts#L30) `decide()` is a pure function with four rules, each unit-tested:
- allowlist ([L32](tender/agent/src/policy.ts#L32))
- human approval above a threshold ([L33](tender/agent/src/policy.ts#L33))
- per-merchant cap ([L37](tender/agent/src/policy.ts#L37))
- total budget ([L39](tender/agent/src/policy.ts#L39))

[L44](tender/agent/src/policy.ts#L44): it only understands Hedera testnet USDC. Anything else is refused.

**The flow** ([run.ts](tender/agent/src/run.ts)):
1. [L33](tender/agent/src/run.ts#L33) discovery: read the shop's manifest.
2. [L46–51](tender/agent/src/run.ts#L46-L51) **the key design choice**: the policy runs inside x402's `onBeforePaymentCreation` hook, on the **real 402 price tag**, right before anything is signed. If the policy says no, it `abort`s ([L49](tender/agent/src/run.ts#L49)) and nothing is signed or paid.
3. [L54](tender/agent/src/run.ts#L54) `wrapFetchWithPayment` does the whole 402 → sign → retry dance automatically.
4. [L61](tender/agent/src/run.ts#L61) reads the settlement receipt header, records the Hedera transaction id in `ledger.json`, and prints the HashScan link.

**Demo with `policy.json`** ($0.20 budget, $0.10 per merchant, price $0.05): run 1 buys, run 2 buys, **run 3 is refused**: "per-merchant cap reached".

**Status:** the policy is tested and the paywall works live. A real paid run needs your two Hedera testnet accounts (merchant and agent), with the agent's account holding a little USDC.

---

### B14. How we know it all works together ([e2e-fork.sh](tender/scripts/e2e-fork.sh), [fork.e2e.ts](tender/e2e/fork.e2e.ts))
**The test setup**
- [fork-up.sh L24](tender/scripts/fork-up.sh#L24) starts **anvil forked from Unichain Sepolia**: a private copy of the real chain on your laptop. The real Uniswap PoolManager, Quoter, USDC and pools are all there, but nothing we do reaches the real network.
- [L31](tender/scripts/fork-up.sh#L31): on a fork you can write storage directly, so we give the test accounts USDC by setting the USDC contract's balance slot. That's impossible on a real chain, and it's why this is only a test.
- [L41](tender/scripts/fork-up.sh#L41): we deploy with **the same scripts** we'll use for the real testnet, so those scripts are tested too.

**What [fork.e2e.ts](tender/e2e/fork.e2e.ts) proves**, using the real API and shop code:
1. [L53](tender/e2e/fork.e2e.ts#L53) shop invoice → ranking → `payWithToken`: the merchant got **exactly** 1.00 USDC ([L81](tender/e2e/fork.e2e.ts#L81)).
2. [L85](tender/e2e/fork.e2e.ts#L85) basket from 3 tokens: exactly 1.00 USDC.
3. [L102](tender/e2e/fork.e2e.ts#L102) merchant refund of 0.25.
4. [L107](tender/e2e/fork.e2e.ts#L107) the dashboard data and CSV show it (amount 1, refunded 0.25, net 0.75).
5. [L119](tender/e2e/fork.e2e.ts#L119) the contract holds 0 of every token.

**Bugs it caught that unit tests couldn't:**
- **Broken real-world pools.** One prices WETH at trillions of dollars → vetted-pool allowlist (B7).
- **The 4-second block-number cache** → refunds missing from the dashboard (B10).

That's the honest answer to **"how do you know it works?"**:
- 31 Solidity tests against a real PoolManager
- 29 TypeScript tests
- a full end-to-end run against a copy of the live chain, which found and fixed 2 real-world bugs

**Self-test for B7–B14**
1. Why does the ranker call the Quoter with `simulateContract` and never send a transaction?
2. What did the fork test find on the real testnet, and what did we change?
3. In a basket, why can't the contract's `Underpaid` check fail if every leg meets its `minOut`?
4. Where does the agent's policy run, and why there rather than before calling the shop?
5. Who pays the Hedera network fee in x402, and how do you know?
6. The dashboard has no database. Where does its data come from?

<details><summary>Answers</summary>

1. The Quoter simulates a swap and reverts with the result. A real transaction would just fail and cost gas; an `eth_call` is free and returns the answer.
2. A WETH/USDC pool pricing WETH at trillions of dollars. The ranker routed through it and the USD maths exploded. Now routes may only use vetted pools (config.ts allowlist), and the seeding script prices our pools from the real WETH price.
3. The basket builder makes the legs' `minOut` values (plus any direct USDC) add up to at least the invoice. Each leg reverts unless it delivers its `minOut`, so the total is always ≥ the invoice.
4. In x402's `onBeforePaymentCreation` hook. It sees the shop's **actual** 402 price tag (amount, asset, recipient) right before signing, so a shop can't advertise one price and charge another.
5. The facilitator. The live 402 response shows `extra.feePayer: "0.0.7162784"`, which is Blocky402's testnet account.
6. From the contract's events (`InvoiceCreated`, `InvoicePaid`, `Refunded`, `Cancelled`) via `getLogs`, and for Hedera, from the public mirror node.
</details>

---

## Build log, part 3: the frontend (first draft, design may change)

> The look (colours, layout, wording) is **provisional** until you and your teammate confirm a design. The parts below marked **stays** are the logic. They won't change when the design does, so study those first.

**The layout (from your teammate's brief):** EAS Scan's explorer style in a dark theme. The navigation buttons sit in a sidebar pinned to the **far left**, and **the rest of the screen** is the content.

| Page | URL | What it shows |
|---|---|---|
| Dashboard | `/` | stat cards, recent payments, the three rails, recent agent sales (like EAS's dashboard) |
| Pay | `/pay/:chain/:id` | the invoice, the **ranked routes** table, pay, receipt |
| Merchant | `/merchant` | create invoice, every invoice on both chains, refund, cancel, Export CSV |
| Agent sales | `/agents` | Hedera x402 purchases and how agents pay |
| Shop | `http://localhost:8788` | Chai & Code, a separate merchant site using the widget |

---

### B15. How the app talks to wallets and the API (stays)
- [main.tsx L14–17](tender/app/src/main.tsx#L14-L17): on startup the app asks the API for `/api/config` (chain IDs, RPCs, contract addresses), then builds the wallet setup from it. Addresses live in **one** place: the server's environment.
- [wagmi.ts L27](tender/app/src/lib/wagmi.ts#L27) `injected()`: the browser wallet (MetaMask, Rabby…).
- [wagmi.ts L28](tender/app/src/lib/wagmi.ts#L28) `mock()`: **"dev wallets", local fork only.** They're anvil's unlocked test accounts, so the whole flow can be clicked through (and tested by a robot) without an extension. They're never offered on a real network.
- [api.ts L3](tender/app/src/lib/api.ts#L3): token amounts arrive as **strings** (JSON has no bigint) and become `BigInt` before any maths or transaction.

**[tx.ts](tender/app/src/lib/tx.ts)**: every transaction goes through one helper ([L11](tender/app/src/lib/tx.ts#L11)):
1. [L23](tender/app/src/lib/tx.ts#L23) switch the wallet to the right chain.
2. [L41–48](tender/app/src/lib/tx.ts#L41-L48) **approve exactly what's needed, never "unlimited"**, and only if the current allowance is too low ([L44](tender/app/src/lib/tx.ts#L44)).
   - [L46](tender/app/src/lib/tx.ts#L46): USDT-style tokens refuse to change one non-zero allowance to another, so we reset to 0 first. This is the same USDT quirk as SafeERC20 in Module 1.
3. [L27](tender/app/src/lib/tx.ts#L27) send, wait for the receipt, and fail loudly if it reverted.

**Judge question.** "Does your app ask for unlimited approvals?" → "No. The payer approves `maxAmountIn` (quote + 0.5%) exactly, and the merchant approves only the refund amount."

---

### B16. The pay page (logic stays, look may change) ([open](tender/app/src/pages/PayPage.tsx))
1. [L74–78](tender/app/src/pages/PayPage.tsx#L74-L78) asks the API to rank routes, and **re-ranks every 20 s**: prices move, and quotes older than about 30 s are stale.
2. [L81](tender/app/src/pages/PayPage.tsx#L81) pre-selects the cheapest route that's affordable and executable, the "BEST" row. You can click another row.
3. [L99](tender/app/src/pages/PayPage.tsx#L99) `pay(route)`:
   - **Direct** ([L105](tender/app/src/pages/PayPage.tsx#L105)): approve the stablecoin, then `payInvoice`.
   - **Swap** ([L113](tender/app/src/pages/PayPage.tsx#L113)): approve `maxAmountIn`, then `payWithToken` ([L121](tender/app/src/pages/PayPage.tsx#L121)) with the route's hops and a deadline.
4. [L91](tender/app/src/pages/PayPage.tsx#L91) the **deadline is 10 minutes**. A transaction stuck in a queue can't be mined later at a stale price.
5. [L124](tender/app/src/pages/PayPage.tsx#L124) the receipt numbers come from the contract's own `InvoicePaid` **event**, not from the quote: what really happened.
6. [L155](tender/app/src/pages/PayPage.tsx#L155) basket: approve each leg, then `payWithBasket` ([L169](tender/app/src/pages/PayPage.tsx#L169)).
7. [L93–96](tender/app/src/pages/PayPage.tsx#L93-L96) in the shop's popup (`?embed=1`), it tells the shop "paid" with `postMessage` ([L95](tender/app/src/pages/PayPage.tsx#L95)).

**What the robot saw** (UI test, local fork):
- The checkout ranked 4 routes and marked BEST. USDC and WETH were dimmed as **Can't afford**.
- After paying, the receipt said: *Merchant received exactly 1.00 USDC · You paid 0.802407 DEMO · Returned to you in the same transaction 0.004012 DEMO*.
- On one run the **thin direct pool won**, because earlier test payments had moved the two-hop pools' prices. The ranker follows the live market; that's the point.

---

### B17. The widget and the shop (Whitechain's "about 20 lines")
**[tender.js](tender/app/public/tender.js)**: the drop-in piece, one `<script>` tag.
- [L19](tender/app/public/tender.js#L19) opens the pay page in a **popup, not an iframe**: browser wallets like MetaMask don't work inside cross-origin iframes. [L20](tender/app/public/tender.js#L20) falls back to a normal tab if popups are blocked.
- [L27](tender/app/public/tender.js#L27) **checks who sent the message.** It only accepts "paid" from the Tender app's own origin; any other page's message is ignored.

**[The shop page](tender/demo-shop/public/index.html#L52)**: the whole integration is **23 lines**. Count them for the judges:
1. one `<script>` tag for the widget
2. `POST /api/create-invoice` to the shop's own server
3. `Tender.checkout({...})`
4. on paid, ask the shop's own server whether it's really paid

**[Shop server L126](tender/demo-shop/server/app.ts#L126)** `/api/orders/:chain/:id` answers "is it paid?" by **reading the chain**, never by trusting the browser. [L139](tender/demo-shop/server/app.ts#L139) also checks the invoice belongs to *this* merchant, so someone else's invoice can't fake one of our orders.

**Judge question.** "Couldn't someone fake the 'paid' message?" → "The widget ignores messages from other origins, and even then the shop confirms on-chain. The message is only a hint to go and check."

---

### B18. Running the whole product on your laptop
- `bash scripts/dev-fork.sh`:
  - local copy of Unichain Sepolia with Tender deployed ([fork-up.sh](tender/scripts/fork-up.sh))
  - the API, the shop and the app ([dev-fork.sh L20](tender/scripts/dev-fork.sh#L20))
- Open **http://localhost:5173** → Connect wallet → **Dev wallet (payer)**. It holds 3 DEMO, 0.0003 WETH and 0.40 USDC.
- Open **http://localhost:8788** → "Pay with any token" → the Tender popup → pay.
- Switch to **Dev wallet (merchant)** on the Merchant page to refund.
- **This is how to rehearse the demo** without testnet funds. Everything is local, and Ctrl+C stops it all.
- [ui.e2e.ts](tender/e2e/ui.e2e.ts) is the robot version: a headless browser clicks dashboard → shop → popup → pay → shop confirms → merchant refund, and takes screenshots. **It passes.**

**Self-test for B15–B18**
1. Why does the widget open a popup instead of an iframe?
2. Why does the shop ask its own server whether an order is paid, instead of trusting the popup's message?
3. How much does the payer approve, and why that amount?
4. Why does the pay page re-rank every 20 seconds?

<details><summary>Answers</summary>

1. Browser wallets don't inject into cross-origin iframes, so the customer couldn't connect. A popup is a normal top-level page.
2. A message can be faked; the chain can't. The server reads `getInvoice` and checks it's Paid and belongs to this merchant.
3. `maxAmountIn` = the quote + 0.5%, exactly, never unlimited. That's the most the contract can take, and anything unused is returned in the same transaction.
4. Pool prices move, so a quote goes stale within about 30 s. Re-ranking keeps "BEST" and `maxAmountIn` current.
</details>

---

### B19. Whitechain tested on a local copy, and three real bugs it caught before deployment
**What we did.** [fork-up.sh L53](tender/scripts/fork-up.sh#L53) also starts a **local copy of Whitechain Sepolia**, keeping its real chain ID 1874. Then:
- **Gives the test accounts USDT.** Whitechain's USDT is a proxy whose storage layout isn't published, so [FindBalanceSlot.s.sol](tender/contracts/script/FindBalanceSlot.s.sol#L17) uses Foundry's `stdStorage` to *discover* which storage slot holds a balance, and [`set_usdt`, L66](tender/scripts/fork-up.sh#L66) writes it. That's only possible on a local copy.
- **Deploys `CheckoutCore`** with Whitechain's required compiler settings, solc 0.8.30 + prague ([L78](tender/scripts/fork-up.sh#L78)).

**What [whitechain.e2e.ts](tender/e2e/whitechain.e2e.ts) proves**, using the real Whitechain USDT contract (copied) and our real server and shop code:
1. [L45](tender/e2e/whitechain.e2e.ts#L45) shop invoice → ranking offers "USDT (no swap)" → approve + `payInvoice` → the merchant got **exactly 1.00 USDT**, and the shop confirmed it **on-chain**.
2. [L64](tender/e2e/whitechain.e2e.ts#L64) **one-transaction payment with a permit signature**, with no approve step. This proves **Whitechain's USDT permit really works**. Its signing domain isn't published; we worked it out by matching the token's `DOMAIN_SEPARATOR`: **name "Tether USD", version "1"** ([L75](tender/e2e/whitechain.e2e.ts#L75)).
3. [L101](tender/e2e/whitechain.e2e.ts#L101) partial refund of 0.40 USDT, back to the original payer.
4. [L108](tender/e2e/whitechain.e2e.ts#L108) the CSV row reads `Paid,USDT,1,0.4,0.6`, and the contract holds 0 USDT.

The **browser** version passes too ([ui.e2e.ts L95](tender/e2e/ui.e2e.ts#L95)): shop → "Pay with USDT" → popup → the wallet switches to Whitechain by itself → receipt "exactly 1.00 USDT" → the shop confirms.

**The three bugs, all found locally, none would have shown up until real deployment:**

| Bug | What would have happened live | Fix |
|---|---|---|
| Public RPCs cap `getLogs`: **Unichain rejects ranges over 1,000 blocks** (we asked for 10,000) | ~17 minutes after deploying (Unichain makes ~1 block/s) the **merchant dashboard and CSV stop loading** | per-chain chunk size ([config.ts L92](tender/packages/core/src/config.ts#L92), [L108](tender/packages/core/src/config.ts#L108)), parallel chunks, cache of already-scanned blocks |
| Our Whitechain network definition didn't list **Multicall3** (the helper contract for batch reads) | the **Whitechain pay page crashes** when ranking | Multicall3 is deployed on Whitechain at its standard address → registered ([config.ts L12](tender/packages/core/src/config.ts#L12)); plus a fallback to one-by-one reads ([rank.ts L93](tender/packages/core/src/rank.ts#L93)) |
| Invoice numbers are **per chain** (there's a Unichain #3 *and* a Whitechain #3) | confusing if anything looks rows up by number alone | the table always shows the chain label; anything that finds an invoice uses chain + id |

**Judge questions**
- "How did you test Whitechain without testnet funds?" → "A local copy of Whitechain Sepolia with the real USDT contract. We gave test accounts USDT by writing its storage, and ran the full flow including a permit payment. On the real testnet we'll repeat it with real test USDT for the README links."
- "Does Whitechain's USDT support permit?" → "Yes. We proved it by paying an invoice in one transaction with a signature. The domain is name 'Tether USD', version '1', chain 1874."

---

### B20. No hardcoded data values
**Every value on screen comes from the chain**, through the API. In the code, the only fixed numbers are *definitions*, such as "USDC has 6 decimals" in the network config, never data. What changed:
- **Decimals:** the dashboard converts each invoice with *its own* stablecoin's decimals ([DashboardPage.tsx L32](tender/app/src/pages/DashboardPage.tsx#L32)), and so does the CSV export ([csv.ts L39](tender/packages/core/src/csv.ts#L39)). Hedera sales carry their token's symbol and decimals ([hedera.ts L4](tender/packages/core/src/hedera.ts#L4)). Previously every amount assumed 6.
- **Shop prices:** the shop page's "$1.00" and the agent price are filled in from the **same settings the server charges with** ([index.ts L33](tender/demo-shop/server/index.ts#L33)), so the page can never show a different price from the invoice.
- **Explanation text** no longer quotes a specific agent price.

**Self-test for B19–B20**
1. Why couldn't we just "send" ourselves test USDT on the local Whitechain copy, and what did we do instead?
2. What would have broken about 17 minutes after deploying on Unichain, and why?
3. How do we know Whitechain's USDT permit works if its signing details aren't published?

<details><summary>Answers</summary>

1. Only the token's owner can mint, and we don't hold real test USDT. On a *local copy* we can write storage directly, so we found the balance slot with `stdStorage` and wrote a balance into it.
2. The dashboard's history scan: Unichain's public RPC rejects log queries over 1,000 blocks, and at ~1 block per second the range since deployment passes 1,000 after ~17 minutes. Now the scan uses 1,000-block chunks, runs them in parallel, and caches.
3. We computed the domain separator for name "Tether USD" / version "1" / chain 1874 and it matched the token's `DOMAIN_SEPARATOR` exactly. Then we paid an invoice in one transaction with a permit signature, which only succeeds if the permit is valid.
</details>

---

## Build log, part 4: what makes Tender different (Nov 6)

> **Quick reference:** [tender/docs/ARCHITECTURE.md](tender/docs/ARCHITECTURE.md) has the infrastructure map, every design trade-off with its cost, the optimisation backlog, and the numbers to quote. Open it before any judge conversation.


**Why this part exists.** Three products already do "swap and deliver to a merchant": Uniswap's Universal Router, 0x's Swap-and-Send (`recipient` parameter) and Coinbase's Commerce Onchain Payment Protocol (`swapAndTransferUniswapV3Token`, Uniswap v3, Permit2). Our `CheckoutCore` + `UniswapCheckout` is honestly close to Coinbase's design, rebuilt on v4. Judges will know this, so these are the parts to lead with.

| What they can't do | Tender |
|---|---|
| Pay an invoice from **inside the liquidity layer**, with any router | **CheckoutHook** (B21) |
| Pay one invoice from **several tokens** in one transaction | basket (B3, B9) |
| Show the payer **every route and its true cost** before paying | ranking panel (B8) |
| Size the slippage buffer from **measured impact**, split a trade across pools to cut impact | B22 |
| USDT invoices + refunds + CSV on another chain, agent sales over x402, **one ledger** | B10–B13 |

---

### B21. `CheckoutHook.sol`: the pool itself settles the invoice ([open](tender/contracts/src/CheckoutHook.sol))
**The idea in one line.** Attach a hook to a pool. Any swap through that pool carrying `hookData = (invoiceId, payer)` pays the invoice: the hook takes exactly the invoice amount out of the swap's output and sends it to the merchant, the swapper keeps the rest, the invoice is marked Paid. **Tender's contract is never called.** A wallet, an aggregator, Uniswap's own router: anything that forwards hookData can pay a Tender invoice.

**Read in this order**
1. [L24](tender/contracts/src/CheckoutHook.sol#L24) a plain contract, no admin, holds no funds. [L40](tender/contracts/src/CheckoutHook.sol#L40) checks at deploy that its **address** carries exactly the permissions it uses (v4 encodes a hook's permissions in the low 14 bits of its address).
2. [L63](tender/contracts/src/CheckoutHook.sol#L63) `afterSwap`: v4 calls this after every swap in the pool.
   - [L67](tender/contracts/src/CheckoutHook.sol#L67) only the PoolManager may call it.
   - [L68](tender/contracts/src/CheckoutHook.sol#L68) no hookData → ordinary swap, the hook does nothing.
   - [L71](tender/contracts/src/CheckoutHook.sol#L71) **exact-input only.** A hook may only adjust the swap's *unspecified* currency, which is the output only for exact-input swaps. So the payer sends "enough" and gets change, instead of asking for an exact output.
3. [L82](tender/contracts/src/CheckoutHook.sol#L82) record the payment in `CheckoutCore` first (checks-effects), then [L83–84](tender/contracts/src/CheckoutHook.sol#L83-L84) refuse the wrong output token or an output that doesn't cover the invoice. **A revert here reverts the whole swap**: the payer keeps everything.
4. [L87](tender/contracts/src/CheckoutHook.sol#L87) `take` exactly the invoice amount **straight to the merchant**; [L88](tender/contracts/src/CheckoutHook.sol#L88) returning that number tells v4 to charge it to the swapper. The swapper receives output − amount as change.

**The other side, in CheckoutCore:** [L46](tender/contracts/src/CheckoutCore.sol#L46) the hook's address is fixed at deploy; [L158–162](tender/contracts/src/CheckoutCore.sol#L158-L162) `settleFromHook` can only be called by that hook and only marks state (no tokens move there).

**How the hook gets its special address** ([DeployUnichain.s.sol](tender/contracts/script/DeployUnichain.s.sol)): the hook and the checkout reference each other, and the hook's address must have the right low bits. So: predict the checkout's address from the deployer's next nonce ([L38](tender/contracts/script/DeployUnichain.s.sol#L38)), **mine a CREATE2 salt** until the hook's address has the flags ([L60–65](tender/contracts/script/DeployUnichain.s.sol#L60-L65), 1 in 16,384 tries), deploy the checkout with that hook address, then deploy the hook through the deterministic CREATE2 deployer ([L47](tender/contracts/script/DeployUnichain.s.sol#L47)). Dry-run on a local fork: hook at `…8044`, low bits `1000100` = afterSwap + afterSwapReturnDelta. In tests we skip mining: the code is simply placed at a flag address ([TenderFixture L42](tender/contracts/test/utils/TenderFixture.sol#L42), [L62](tender/contracts/test/utils/TenderFixture.sol#L62)).

**Tests ([CheckoutHook.t.sol](tender/contracts/test/CheckoutHook.t.sol)), all through Uniswap's own `PoolSwapTest` router, not our contract:** [L58](tender/contracts/test/CheckoutHook.t.sol#L58) merchant gets exactly 10 USDC and the payer keeps ~$2 change; [L88](tender/contracts/test/CheckoutHook.t.sol#L88) empty hookData = normal swap; [L100](tender/contracts/test/CheckoutHook.t.sol#L100) output too small → revert, invoice still Open, nothing moved; [L111](tender/contracts/test/CheckoutHook.t.sol#L111) exact-output → revert; [L142](tender/contracts/test/CheckoutHook.t.sol#L142) only the PoolManager. **41 Solidity tests pass.** On the local Unichain fork ([fork.e2e.ts L92](tender/e2e/fork.e2e.ts#L92)): *"paid via generic router: merchant +1.00 USDC (exact), payer got 0.019801 USDC change; Tender's contract never called."*

**In the app:** the ranking panel shows these as **"Hook · any router"** routes ([rank.ts L157](tender/packages/core/src/rank.ts#L157)); paying one calls the generic router with the swap arguments and hookData ([routers.ts L58](tender/packages/core/src/routers.ts#L58), [PayPage L105](tender/app/src/pages/PayPage.tsx#L105)).

**Judge questions**
- "How is this different from Coinbase Commerce or 0x swap-and-send?" → "Those are routers that deliver output to a recipient. Here the payment logic lives in the pool: any router pays the invoice by swapping through it, and the merchant guarantee is enforced by the hook, not by whoever built the transaction."
- "Why exact-input only?" → "v4 only lets a hook adjust the unspecified currency, which is the output for exact-input swaps. The payer sends enough, the hook takes exactly the invoice, change comes back in the same transaction."
- "Can someone pay my invoice and claim to be me?" → "They can set any payer address in hookData, and that only decides where refunds go. They still paid. The merchant receives the exact amount either way."
- "What if the output doesn't cover the invoice?" → "The hook reverts, which reverts the whole swap. Nothing moves."

---

### B22. Ranker optimisations: impact-sized buffers and split routing ([rank.ts](tender/packages/core/src/rank.ts))
- **Impact-based slippage buffer** ([L70](tender/packages/core/src/rank.ts#L70), [L258–259](tender/packages/core/src/rank.ts#L258-L259)). Price impact = overpay beyond the pool fees, measured per route. The buffer is 0.25% + half the impact, capped at 3%. A deep pool gets the floor; a thin pool that already moved 20% for our trade gets 3%, because it will move more between quote and execution. The pay page shows the number and where it came from.
- **Split routing** ([L190–213](tender/packages/core/src/rank.ts#L190-L213)): try 25/50/75% of the invoice on the two best plain paths; offer the split only if it beats the best single path by more than 0.05%. Executed through `payWithBasket` as two exact-input legs ([PayPage L129](tender/app/src/pages/PayPage.tsx#L129)). Fork run: *"split route offered: 50% DEMO→WETH→USDC + 50% DEMO→USDC"* after earlier trades had moved the deep route's price.
- **Why splitting helps:** impact grows with trade size (x·y=k, Module 3.2). Two half-size trades on two pools can cost less than one full-size trade on the cheaper pool.
- **Bug this caught:** the basket builder must only use plain-pool routes ([server/app.ts L116](tender/server/src/app.ts#L116)); it briefly quoted a hooked pool for a leg the contract then ran on the plain pool.

**Self-test for B21–B22**
1. Which v4 permission lets the hook charge the invoice to the swapper, and what limits it to exact-input?
2. Why does the deploy script mine a salt?
3. Why can a split of one payment across two pools be cheaper than the cheapest pool alone?

<details><summary>Answers</summary>

1. `afterSwapReturnDelta`: the hook returns a delta in the swap's unspecified currency. For exact-input swaps that's the output; for exact-output it would be the input, which is no use for taking the merchant's money.
2. v4 reads a hook's permissions from its address bits, so the address must be chosen; CREATE2 with a mined salt gives a predictable address with the right bits.
3. Price impact grows with size. Two smaller trades each move their pool less, so the total can be lower than one large trade's impact, even after paying a second pool's fee.
</details>

---

### B23. The frontend, second pass (Nov 6): Linear + MetaMask
**Brief:** Linear's dark, slightly bright surface and density; MetaMask's wallet elements; direct copy; a proper landing page.

**Seven screens** ([App.tsx](tender/app/src/App.tsx)): `/` landing (full-width, own top bar), `/dashboard`, `/pay`, `/pay/:chain/:id` checkout (also the shop's popup), `/merchant`, `/agents`, plus the separate Chai & Code shop.

**What to be able to explain**
- **Theme** ([styles.css](tender/app/src/styles.css)): one set of tokens at the top (`--bg #08090a`, panels, borders, `--accent #7a7cff`, neon set for the landing). Everything else uses them, so a restyle is a token change.
- **MetaMask elements** ([ui.tsx](tender/app/src/components/ui.tsx)): `Identicon` (deterministic avatar drawn from the address, no library), `TokenLogo`, the account pill with a network dot ([WalletPanel.tsx](tender/app/src/components/WalletPanel.tsx)), token rows with balance + USD, and the **review sheet** (`Sheet`): *you pay up to → merchant receives*, route, quote, price buffer and where it came from, fees, gas, "unused amount returned", and who settles it.
- **Stepped checkout** ([PayPage.tsx](tender/app/src/pages/PayPage.tsx)): Route → Review → Pay (step 1 approve, step 2 pay, with wallet prompts) → Done. The ranking stops refreshing once a payment is in flight. Errors drop you back to the route list.
- **Landing** ([LandingPage.tsx](tender/app/src/pages/LandingPage.tsx)): hero with live stats, six **tickets**, a payment timeline, About, Built-on (sponsors and tools with the job each does), the comparison table, footer.
  - **The ticket effect:** each ticket has a hidden layer of deterministic cipher characters (`cipherText`, a tiny xorshift generator seeded per ticket). On mouse move the card gets `--mx/--my/--reveal` CSS variables; the layer is neon gradient text (`background-clip: text`) masked by a radial window at the cursor, so characters light up around the pointer and fade as it moves away; a matching glow border follows. Pure CSS variables + one mousemove handler, no animation library.
  - Sections fade in on scroll, but only if they start below the fold, so nothing is ever hidden (a full-page screenshot caught that).

**Judge questions**
- "Why a review step?" → "It's where the guarantee becomes visible: the cap, what the merchant gets, what comes back, and the buffer with the impact it was sized from."
- "Why is the landing page separate from the app shell?" → "Marketing page vs tool, like Linear: full-width story first, sidebar once you're working."

**Design system (third pass, Nov 6), the rules to quote if asked about the UI**
- **One accent.** Dark, slightly desaturated indigo (`#6163d8`) for filled buttons and the selected row; pastel lavender (`#b3b5f2`) for links and labels. Chosen by rendering both light and dark purple on the real dashboard: dark fills keep white text readable on video; light purple only works as text.
- **Two semantic colours, nothing else.** Sage green = success (Paid, Settled, the ok check). Dusty rose = errors and danger. Open invoices use the accent. Chains, sources, "Not enough", Expired, Cancelled, Refunded are all neutral grey pills. The landing tickets' neon is the one flourish and uses the accent hues.
- **Scale.** Type ratio 1.25 from 14px (11 · 12 · 14 · 17 · 22 · 28 · 35 · 54). Spacing 4 · 8 · 12 · 16 · 24 · 40 · 64. Controls 36px tall (30 small, 44 hero). Landing content 1200px wide, 64px top bar with 15px links.
- Everything is a token in `:root` of [styles.css](tender/app/src/styles.css), so a colour change is one line.

---

### B24. Deployment runbooks and the HCS audit log (Nov 6)
**Runbooks**, so going live is one command each once the keys arrive:
- [scripts/deploy-unichain.sh](tender/scripts/deploy-unichain.sh): deploys DemoToken + UniswapCheckout + CheckoutHook (mined address), seeds the plain and hooked pools, then makes **two real proof payments**: `payWithToken` through DEMO→WETH→USDC, and a **hook payment through Uniswap's own router**, and checks on-chain that the hook marked the invoice Paid. Prints explorer links and writes `deployments/unichain-sepolia.env`.
- [scripts/deploy-whitechain.sh](tender/scripts/deploy-whitechain.sh): deploys CheckoutCore with Whitechain's compiler settings, **verifies it on their explorer**, then a real USDT payment and a 0.40 refund. Writes `deployments/whitechain-sepolia.env`.
- Both were dry-run on the local forks and pass. Two bash-3 (macOS) quirks were found and fixed on the way, which is exactly why you dry-run a runbook.

**HCS audit log** (Hedera "extra points"): the agent now writes every decision to a **Hedera Consensus Service topic**, a public, ordered, tamper-evident log.
- [agent/src/run.ts](tender/agent/src/run.ts) `audit()`: creates the topic on the first run (`TopicCreateTransaction`, remembered in `ledger.json`), then one `TopicMessageSubmitTransaction` per event: `{kind: "purchase", merchant, amountUsd, txId, totalSpentUsd}` or `{kind: "refused", merchant, amountUsd, reason}`.
- [packages/core/src/hedera.ts](tender/packages/core/src/hedera.ts) `parseTopicMessages` / `listAuditLog`: reads the topic from the mirror node (base64 → JSON), newest first; unit-tested.
- API `GET /api/hedera/audit?topic=0.0.x`; the **Agents page** shows the log with Bought/Refused pills and a HashScan link to the topic.
- **Why it matters:** the spending policy itself runs in the agent's code (an honest limit); the audit log makes what the agent did *publicly verifiable* even if you don't trust the agent. Judges listed exactly this as an extra-points item.
- Status: code + unit tests done; the live topic gets created on the agent's first real run with your Hedera accounts.

**Judge question.** "Why HCS and not just a database log?" → "Anyone can read it, nobody can edit it, and the sequence numbers prove nothing was dropped. HashScan shows it with no trust in us."

---

### B25. Hosting: frontend live on Cloudflare, backend ready for AWS (Nov 6)
**Decision** (also in PLAN_B.md §6b): the frontend goes on Cloudflare (free), the two backend services (Tender API, demo shop) go on AWS App Runner in Mumbai, and the contracts go on the testnets.

**What's live:** **https://tender.tender-app.workers.dev**
- Cloudflare moved Pages into Workers, so the site is a Worker that serves static files only ([app/wrangler.jsonc](tender/app/wrangler.jsonc)). `not_found_handling: "single-page-application"` returns `index.html` for unknown paths, which is why a deep link like `/pay/unichain-sepolia/1` loads.
- The API address is **baked in at build time** (`VITE_API_URL`, read in [app/src/lib/api.ts](tender/app/src/lib/api.ts)). The browser calls it directly; the server allows that with CORS (`app.use("/api/*", cors())` in [server/src/app.ts](tender/server/src/app.ts)).
- **Offline mode** ([app/src/main.tsx](tender/app/src/main.tsx)): if the API can't be reached, the landing page still renders and the app pages say "The Tender API is offline". It's live this way until the backend is hosted, and it also protects the demo if the backend restarts.

**Backend on AWS: ready but blocked.**
- [Dockerfile](tender/Dockerfile): one image for both services; the start command picks `npm run server` or `npm run shop`. `tsx` had to move to runtime dependencies or the container couldn't start.
- [scripts/deploy-aws.sh](tender/scripts/deploy-aws.sh): builds for **linux/amd64** (App Runner's CPU type; this Mac is ARM, hence `docker buildx`), pushes to ECR, creates both services **capped at 2 instances each**, so a burst of traffic can't run up the bill.
- **Budgets:** $20/month for testing and $100 total, with email alerts, measured *before* credits (otherwise the credits hide real usage).
- **The blocker:** the AWS account is on the Free plan and its registration is incomplete, so every compute service answers "not signed up". The image is already in ECR; deployment resumes the moment the account is activated.

**Judge questions**
- "Where is this hosted?" → "Frontend on Cloudflare's edge, free and global; the API and demo shop are containers on AWS App Runner in Mumbai, and the contracts are on Unichain Sepolia and Whitechain Sepolia."
- "What happens if your server dies mid-demo?" → "The landing page keeps working because it's static, and the app says the API is offline instead of crashing. Payments are on-chain, so nothing is lost: when the API comes back it rebuilds every invoice from contract events."

---

### B26. Live on Unichain Sepolia, and tests per category (Nov 6)
**What's live** (all three contracts verified on Blockscout, links in [README](tender/README.md)):
- `UniswapCheckout` `0x013a…5795`, `CheckoutHook` `0x40a7…8044`, `DemoToken` `0x29ad…339c`; record in [deployments/unichain-sepolia.env](tender/deployments/unichain-sepolia.env).
- **Proof 1, any-token payment:** invoice #1 (0.10 USDC) paid in DEMO through DEMO→WETH→USDC. Checked on-chain afterwards: the merchant's USDC went up by exactly 100000 (0.10 USDC with 6 decimals), the invoice is Paid, the contract holds 0 DEMO and 0 USDC.
- **Proof 2, hook payment:** invoice #2 paid by calling **Uniswap's own `PoolSwapTest` router** on the hooked DEMO/USDC pool, with `hookData = (invoiceId, payer)`. Our checkout contract was never called by the payer; the hook settled the invoice from inside the swap.

**Budget engineering.** The faucet gives 0.01 ETH a day, but the full seeding needed about 0.12 WETH. So [SeedPools.s.sol](tender/contracts/script/SeedPools.s.sol) has a `LITE` profile: it reads the live WETH/USDC price (≈ $1,293), wraps only the WETH it needs, and seeds about $25 of liquidity in total. Invoices are 0.10 USDC so price impact stays small. We **thinned the direct DEMO/USDC pool on purpose** so the ranking shows a real choice: two-hop 2.8% vs direct 12.8% vs split 1.0%.

**Rehearse first.** Before spending real testnet funds, the runbook ran against a local fork of the *live* chain, with the real wallet and real pool state. That rehearsal caught the budget mismatch. The live run then found two public-RPC problems, a receipt timeout and a stale read. The runbooks now wait 300 s for receipts, stop on any revert, and read each invoice id from its own `InvoiceCreated` event. A stale read once made the hook swap target the already-paid invoice #1; **the hook refused it**, which is the safety check doing its job.

**Tests: at least three checks per category.** 88 automated tests (41 Foundry + 47 Vitest); the README has a table by sponsor. New this round:
- Trading API parser: multi-hop order and labels; split routes not executable; quotes without an input amount rejected.
- HCS audit log: right mirror URL (topic, newest first, limit); mirror errors raised, not hidden; empty topics.
- Quoter batching: separate ticks → separate batches; per-quote fallback when Multicall3 fails.
- Audit log API: bad topic id → 400; entries returned; empty when not configured.

**Mutation checking** (how we know a pass isn't luck): break the code on purpose and confirm a test fails. Six bugs tried, six caught. One break *wasn't* caught, and that was correct: swapping `queueMicrotask` for `setTimeout` only delays the flush, so behaviour doesn't change.

**Judge questions**
- "How do I know the merchant got exactly the amount?" → "Open the any-token transaction: the USDC transfer to the merchant is exactly 100000 units. The contract checks this before finishing, and our tests assert it for any amount (fuzzed)."
- "Is the hook really router-agnostic?" → "Proof 2 was sent to Uniswap's own test router. Our checkout contract isn't in the call; the pool's hook settled the invoice."
- "Why is liquidity so small?" → "Testnet faucets give 0.01 ETH a day. We seed our own pools, and the ranking measures their real depth; the same code works on deeper pools."

---

### B27. Live on Whitechain Sepolia (Nov 6)
**What's live:** `CheckoutCore` at `0x013a…5795`, **verified** on Whitechain's explorer with exactly the compiler settings their docs require (solc 0.8.30, `prague`). Record: [deployments/whitechain-sepolia.env](tender/deployments/whitechain-sepolia.env).
- **Invoice #1** (1.00 USDT): approve + `payInvoice`, then a **0.40 partial refund**. On-chain afterwards: status Paid, `refunded = 400000`, contract holds 0 USDT.
- **Invoice #2** (0.50 USDT): paid in **one transaction with an EIP-2612 permit signature**, with no separate approve. [scripts/permit-proof.ts](tender/scripts/permit-proof.ts) first checks that the allowance is **0**. `payInvoiceWithPermit` swallows a failed permit in `try/catch`, so with zero allowance the payment can *only* succeed if the permit worked. That's how the proof rules out luck.
- Same address as on Unichain (`0x013a…5795`): a contract's address comes from the deployer's address and its transaction count. Both chains happened to line up.

**Where the test USDT came from.** The Whitechain faucet gives only WBT (2 per day), and their rule says self-minted tokens don't count. Reading the USDT contract's transfer history showed other teams **swapping WBT for USDT on the testnet DEX** (a Uniswap-v3-style WBT/USDT pool holding ~93k USDT). We simulated first, then swapped **0.15 WBT → 10.94 USDT** with a 2% minimum-output guard.

**Budget:** deploy + verify + 3 proof transactions + the permit payment cost about **0.008 WBT**. One full demo cycle costs about 0.002 WBT, so the remaining 1.84 WBT covers hundreds of demo payments.

**Judge questions**
- "Is that real Whitechain USDT?" → "Yes, the official contract `0xcedf…55a7`. We got it by swapping WBT on the testnet DEX, the same way other teams did; the swap transaction is in our deployments file."
- "Show me the refund." → "Invoice #1: paid 1.00 USDT, then the merchant refunded 0.40. The refund is pulled from the merchant's wallet back to the original payer, recorded on-chain, and it can never exceed what was paid."
- "Why does the permit matter for a merchant?" → "The customer signs once and pays once: one transaction instead of two, which is how card checkouts feel."
