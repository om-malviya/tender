// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {CheckoutCore} from "./CheckoutCore.sol";

/// @title UniswapCheckout
/// @notice Pay a stablecoin invoice with any token. The contract swaps through Uniswap v4 pools so the
///         merchant receives EXACTLY the invoice amount, and the payer gets back whatever input wasn't needed.
/// @dev Talks to the v4 PoolManager directly using flash accounting:
///      unlock -> (inside unlockCallback) swap each hop -> settle what we owe -> take what we're owed.
///      Only pools WITHOUT hooks are used (hooks = address(0) is hard-coded below).
contract UniswapCheckout is CheckoutCore, IUnlockCallback {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @notice One pool on a route. `tokenIn` is what goes INTO this pool; the output is the next hop's
    ///         tokenIn, or the invoice's settle token (USDC) for the last hop.
    ///         Example DEMO -> WETH -> USDC: [ {DEMO, 3000, 60}, {WETH, 500, 10} ]
    struct Hop {
        address tokenIn;
        uint24 fee;
        int24 tickSpacing;
    }

    /// @notice One part of a basket payment. A leg in the settle token itself has an empty path (no swap).
    struct Leg {
        address tokenIn;
        uint256 amountIn;
        Hop[] path;
        uint256 minOut; // slippage guard: this leg must produce at least this much of the settle token
    }

    /// @dev What unlockCallback should do; the first value in the data we pass to PoolManager.unlock.
    enum Action {
        ExactOut,
        Basket
    }

    IPoolManager public immutable poolManager;

    event BasketPaid(uint256 indexed id, address indexed payer, address[] tokensIn, uint256[] amountsIn, uint256 totalOut);

    error NotPoolManager();
    error DeadlinePassed();
    error BadPath();
    error TooExpensive(uint256 needed, uint256 maxAmountIn);
    error PartialFill();
    error LegBelowMin(uint256 leg, uint256 out, uint256 minOut);
    error Underpaid(uint256 got, uint256 needed);
    error FeeOnTransfer();
    error InvariantBroken();

    constructor(IPoolManager _poolManager, address[] memory settleTokens) CheckoutCore(settleTokens) {
        poolManager = _poolManager;
    }

    // ---------------------------------------------------------------------
    // Pay with one token (exact output)
    // ---------------------------------------------------------------------

    /// @notice Pay invoice `id` with `tokenIn`, spending at most `maxAmountIn`.
    /// @param path Route from tokenIn to the invoice's settle token (see Hop).
    /// @param deadline The transaction reverts if mined after this time (protects against a stale quote).
    /// @return amountIn How much of tokenIn was actually spent. The rest of maxAmountIn is returned.
    function payWithToken(uint256 id, address tokenIn, uint256 maxAmountIn, Hop[] calldata path, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountIn)
    {
        // 1. Checks + effects: invoice Open and not expired -> mark Paid, record payer.
        if (block.timestamp > deadline) revert DeadlinePassed();
        Invoice storage inv = _markPaid(id);
        if (
            tokenIn == address(0) || tokenIn == inv.settleToken || maxAmountIn == 0 || path.length == 0
                || path[0].tokenIn != tokenIn
        ) revert BadPath();

        // 2-5. Pull, swap, return leftover, check invariants.
        amountIn = _payExactOut(inv, tokenIn, maxAmountIn, path);
        emit InvoicePaid(id, inv.merchant, msg.sender, tokenIn, amountIn, inv.amount);
    }

    /// @dev Balances recorded before a payment, to prove afterwards that the merchant received exactly
    ///      the invoice amount and that this contract kept nothing.
    struct Snapshot {
        uint256 merchantOut;
        uint256 selfIn;
        uint256 selfOut;
    }

    function _payExactOut(Invoice storage inv, address tokenIn, uint256 maxAmountIn, Hop[] calldata path)
        internal
        returns (uint256 amountIn)
    {
        address settleToken = inv.settleToken;
        address merchant = inv.merchant;
        bytes memory data =
            abi.encode(Action.ExactOut, abi.encode(path, settleToken, inv.amount, maxAmountIn, merchant));
        Snapshot memory before = Snapshot({
            merchantOut: IERC20(settleToken).balanceOf(merchant),
            selfIn: IERC20(tokenIn).balanceOf(address(this)),
            selfOut: IERC20(settleToken).balanceOf(address(this))
        });

        // 2. Pull the payer's maximum; whatever isn't needed goes back in step 4.
        _pullExact(tokenIn, msg.sender, maxAmountIn);

        // 3. Swap. The PoolManager calls back unlockCallback, which runs _exactOutCallback.
        amountIn = abi.decode(poolManager.unlock(data), (uint256));

        // 4. Return the unused input to the payer.
        if (maxAmountIn > amountIn) IERC20(tokenIn).safeTransfer(msg.sender, maxAmountIn - amountIn);

        // 5. Invariants: merchant received exactly the invoice amount; this contract kept nothing.
        if (IERC20(settleToken).balanceOf(merchant) - before.merchantOut != inv.amount) revert InvariantBroken();
        if (IERC20(tokenIn).balanceOf(address(this)) != before.selfIn) revert InvariantBroken();
        if (IERC20(settleToken).balanceOf(address(this)) != before.selfOut) revert InvariantBroken();
    }

    // ---------------------------------------------------------------------
    // Pay with several tokens at once (basket)
    // ---------------------------------------------------------------------

    /// @notice Pay one invoice from several tokens in one transaction (e.g. leftover balances).
    ///         Each leg is swapped with exact INPUT; the total must cover the invoice. The merchant gets
    ///         exactly the invoice amount and any excess settle token goes back to the payer.
    function payWithBasket(uint256 id, Leg[] calldata legs, uint256 deadline)
        external
        nonReentrant
        returns (uint256 totalOut)
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        Invoice storage inv = _markPaid(id);
        if (legs.length == 0) revert BadPath();

        totalOut = _payBasket(inv, legs);

        (address[] memory tokensIn, uint256[] memory amountsIn) = _legSummary(legs);
        emit BasketPaid(id, msg.sender, tokensIn, amountsIn, totalOut);
        emit InvoicePaid(id, inv.merchant, msg.sender, address(0), 0, inv.amount);
    }

    function _payBasket(Invoice storage inv, Leg[] calldata legs) internal returns (uint256 totalOut) {
        address settleToken = inv.settleToken;

        // Validate every leg and record this contract's balance of each input BEFORE pulling anything.
        uint256[] memory selfBefore = _checkLegs(legs, settleToken);
        uint256 selfOutBefore = IERC20(settleToken).balanceOf(address(this));

        for (uint256 i = 0; i < legs.length; i++) {
            _pullExact(legs[i].tokenIn, msg.sender, legs[i].amountIn);
        }

        // Swap every non-direct leg inside one unlock; the swapped settle token is taken to this contract.
        poolManager.unlock(abi.encode(Action.Basket, abi.encode(legs, settleToken)));

        // Total = direct legs + swap output, both now sitting in this contract.
        totalOut = IERC20(settleToken).balanceOf(address(this)) - selfOutBefore;
        _payMerchantAndReturnExcess(settleToken, inv.merchant, inv.amount, totalOut);

        // Invariants: this contract kept nothing, of the settle token or of any input token.
        if (IERC20(settleToken).balanceOf(address(this)) != selfOutBefore) revert InvariantBroken();
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].tokenIn != settleToken && IERC20(legs[i].tokenIn).balanceOf(address(this)) != selfBefore[i]) {
                revert InvariantBroken();
            }
        }
    }

    /// @dev A leg is either "settle token, no path" (direct top-up) or "other token, path starting with it".
    function _checkLegs(Leg[] calldata legs, address settleToken) internal view returns (uint256[] memory selfBefore) {
        selfBefore = new uint256[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            Leg calldata leg = legs[i];
            bool direct = leg.tokenIn == settleToken;
            if (
                leg.amountIn == 0 || leg.tokenIn == address(0) || (direct && leg.path.length != 0)
                    || (!direct && (leg.path.length == 0 || leg.path[0].tokenIn != leg.tokenIn))
            ) revert BadPath();
            selfBefore[i] = IERC20(leg.tokenIn).balanceOf(address(this));
        }
    }

    /// @dev Merchant gets exactly `amount`; anything above it goes back to the payer.
    function _payMerchantAndReturnExcess(address settleToken, address merchant, uint256 amount, uint256 totalOut)
        internal
    {
        if (totalOut < amount) revert Underpaid(totalOut, amount);
        uint256 merchantBefore = IERC20(settleToken).balanceOf(merchant);
        IERC20(settleToken).safeTransfer(merchant, amount);
        if (totalOut > amount) IERC20(settleToken).safeTransfer(msg.sender, totalOut - amount);
        if (IERC20(settleToken).balanceOf(merchant) - merchantBefore != amount) revert InvariantBroken();
    }

    function _legSummary(Leg[] calldata legs)
        internal
        pure
        returns (address[] memory tokensIn, uint256[] memory amountsIn)
    {
        tokensIn = new address[](legs.length);
        amountsIn = new uint256[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            tokensIn[i] = legs[i].tokenIn;
            amountsIn[i] = legs[i].amountIn;
        }
    }

    // ---------------------------------------------------------------------
    // Uniswap v4 flash accounting
    // ---------------------------------------------------------------------

    /// @notice Called by the PoolManager during `unlock`. Every swap, settle and take happens in here,
    ///         and when it returns the PoolManager checks that all debts are zero.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Action action, bytes memory inner) = abi.decode(data, (Action, bytes));
        if (action == Action.ExactOut) return _exactOutCallback(inner);
        return _basketCallback(inner);
    }

    /// @dev Walks the route BACKWARDS: "how much WETH for exactly `amount` USDC?", then
    ///      "how much DEMO for exactly that much WETH?". Intermediate tokens net to zero
    ///      (one hop owes them in, the next pays them out).
    function _exactOutCallback(bytes memory inner) internal returns (bytes memory) {
        (Hop[] memory path, address settleToken, uint256 amount, uint256 maxAmountIn, address merchant) =
            abi.decode(inner, (Hop[], address, uint256, uint256, address));

        uint256 needed = amount;
        address tokenOut = settleToken;
        for (uint256 i = path.length; i > 0; i--) {
            Hop memory hop = path[i - 1];
            needed = _swapExactOut(hop, tokenOut, needed);
            tokenOut = hop.tokenIn;
        }
        // `needed` is now the amount of path[0].tokenIn the whole route costs.
        if (needed > maxAmountIn) revert TooExpensive(needed, maxAmountIn);

        _settle(path[0].tokenIn, needed); // pay what we owe
        poolManager.take(Currency.wrap(settleToken), merchant, amount); // collect what we're owed, straight to the merchant
        return abi.encode(needed);
    }

    /// @dev Runs each leg forward with exact input, settles every input, takes all output to this contract.
    function _basketCallback(bytes memory inner) internal returns (bytes memory) {
        (Leg[] memory legs, address settleToken) = abi.decode(inner, (Leg[], address));

        uint256 out = 0;
        for (uint256 i = 0; i < legs.length; i++) {
            Leg memory leg = legs[i];
            if (leg.tokenIn == settleToken) continue; // direct leg: already pulled, no swap

            uint256 amt = leg.amountIn;
            for (uint256 j = 0; j < leg.path.length; j++) {
                address tokenOut = j + 1 < leg.path.length ? leg.path[j + 1].tokenIn : settleToken;
                amt = _swapExactIn(leg.path[j], tokenOut, amt);
            }
            if (amt < leg.minOut) revert LegBelowMin(i, amt, leg.minOut);

            _settle(leg.tokenIn, leg.amountIn);
            out += amt;
        }
        if (out > 0) poolManager.take(Currency.wrap(settleToken), address(this), out);
        return abi.encode(out);
    }

    /// @dev One exact-output swap: receive exactly `amountOut` of tokenOut, return how much tokenIn it costs.
    function _swapExactOut(Hop memory hop, address tokenOut, uint256 amountOut) internal returns (uint256 amountIn) {
        (PoolKey memory key, bool zeroForOne) = _poolKey(hop, tokenOut);
        // Positive amountSpecified = exact OUTPUT in Uniswap v4.
        BalanceDelta delta = poolManager.swap(key, _swapParams(zeroForOne, amountOut.toInt256()), "");
        (int128 inDelta, int128 outDelta) = _split(delta, zeroForOne);
        if (outDelta < 0 || uint256(uint128(outDelta)) != amountOut) revert PartialFill();
        amountIn = uint256(uint128(-inDelta)); // negative delta = what we owe the pool
    }

    /// @dev One exact-input swap: give exactly `amountIn` of tokenIn, return how much tokenOut we receive.
    function _swapExactIn(Hop memory hop, address tokenOut, uint256 amountIn) internal returns (uint256 amountOut) {
        (PoolKey memory key, bool zeroForOne) = _poolKey(hop, tokenOut);
        // Negative amountSpecified = exact INPUT in Uniswap v4.
        BalanceDelta delta = poolManager.swap(key, _swapParams(zeroForOne, -amountIn.toInt256()), "");
        (int128 inDelta, int128 outDelta) = _split(delta, zeroForOne);
        if (inDelta > 0 || uint256(uint128(-inDelta)) != amountIn) revert PartialFill();
        amountOut = uint256(uint128(outDelta));
    }

    /// @dev Pay the PoolManager what we owe in `token`: sync (snapshot its balance), transfer, settle.
    function _settle(address token, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(Currency.wrap(token));
        IERC20(token).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    /// @dev Builds the PoolKey for one hop. v4 identifies a pool by its two tokens SORTED by address,
    ///      plus fee, tick spacing and hook. We always use hooks = 0, so only hook-free pools are reachable.
    function _poolKey(Hop memory hop, address tokenOut) internal pure returns (PoolKey memory key, bool zeroForOne) {
        if (hop.tokenIn == tokenOut) revert BadPath();
        zeroForOne = hop.tokenIn < tokenOut; // true when we sell currency0 for currency1
        (address c0, address c1) = zeroForOne ? (hop.tokenIn, tokenOut) : (tokenOut, hop.tokenIn);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: hop.fee,
            tickSpacing: hop.tickSpacing,
            hooks: IHooks(address(0))
        });
    }

    /// @dev No price limit (the extreme allowed values); protection comes from maxAmountIn / minOut instead.
    function _swapParams(bool zeroForOne, int256 amountSpecified) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    /// @dev Reorders a pool's (amount0, amount1) delta into (input side, output side).
    function _split(BalanceDelta delta, bool zeroForOne) internal pure returns (int128 inDelta, int128 outDelta) {
        (inDelta, outDelta) = zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
    }

    /// @dev Pull exactly `amount` from `from`; rejects fee-on-transfer tokens that deliver less.
    function _pullExact(address token, address from, uint256 amount) internal {
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - before != amount) revert FeeOnTransfer();
    }
}
