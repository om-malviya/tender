// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {CheckoutCore} from "./CheckoutCore.sol";

/// @title CheckoutHook
/// @notice A Uniswap v4 hook that turns a pool into a payment terminal. Any router or wallet that swaps through a
///         hooked pool with `hookData = abi.encode(invoiceId, payer)` pays that Tender invoice:
///           - the swap must be exact-INPUT and must output the invoice's settle token
///           - the hook takes exactly `invoice.amount` of the output and sends it to the merchant
///           - the rest of the output goes to the swapper as usual, and the invoice is marked Paid
///         If the output doesn't cover the invoice, the whole swap reverts and nobody loses anything.
///         A swap with empty hookData is a normal swap; the hook does nothing.
/// @dev Lives at an address whose low bits encode AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA (v4 requires this).
///      It holds no funds and has no admin. Only the PoolManager can call it.
contract CheckoutHook {
    using Hooks for IHooks;

    IPoolManager public immutable poolManager;
    CheckoutCore public immutable checkout;

    error NotPoolManager();
    error ExactInputOnly();
    error WrongSettleToken(address expected, address got);
    error Underpaid(uint256 got, uint256 needed);
    error AmountTooLarge();

    constructor(IPoolManager _poolManager, CheckoutCore _checkout) {
        poolManager = _poolManager;
        checkout = _checkout;
        // Reverts unless this contract's address carries exactly the flags for what it implements.
        IHooks(address(this)).validateHookPermissions(
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    /// @notice v4 calls this after every swap in a hooked pool. Returning a positive int128 makes the PoolManager
    ///         charge that much of the swap's "unspecified" currency (the OUTPUT, for exact-input swaps) to the
    ///         swapper and credit it to this hook, which immediately `take`s it to the merchant.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        external
        returns (bytes4, int128)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (hookData.length == 0) return (IHooks.afterSwap.selector, 0); // ordinary swap, nothing to settle

        (uint256 invoiceId, address payer) = abi.decode(hookData, (uint256, address));
        if (params.amountSpecified >= 0) revert ExactInputOnly(); // only exact-input lets a hook touch the output

        // zeroForOne: currency0 in, currency1 out. Output delta is positive (owed to the swapper).
        (Currency tokenIn, Currency tokenOut, int128 amountInDelta, int128 outDelta) = params.zeroForOne
            ? (key.currency0, key.currency1, delta.amount0(), delta.amount1())
            : (key.currency1, key.currency0, delta.amount1(), delta.amount0());
        uint256 output = outDelta > 0 ? uint256(uint128(outDelta)) : 0;
        uint256 amountIn = amountInDelta < 0 ? uint256(uint128(-amountInDelta)) : 0;

        // Record the payment first (checks-effects), then move the money.
        (address merchant, address settleToken, uint256 amount) =
            checkout.settleFromHook(invoiceId, payer, Currency.unwrap(tokenIn), amountIn);
        if (Currency.unwrap(tokenOut) != settleToken) revert WrongSettleToken(settleToken, Currency.unwrap(tokenOut));
        if (output < amount) revert Underpaid(output, amount);
        if (amount > uint256(uint128(type(int128).max))) revert AmountTooLarge();

        poolManager.take(tokenOut, merchant, amount); // exactly the invoice amount, straight to the merchant
        return (IHooks.afterSwap.selector, int128(uint128(amount)));
    }
}
