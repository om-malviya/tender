// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

import {CheckoutCore} from "../src/CheckoutCore.sol";
import {CheckoutHook} from "../src/CheckoutHook.sol";
import {TenderFixture} from "./utils/TenderFixture.sol";

/// @notice The CheckoutHook: a plain v4 router (Uniswap's PoolSwapTest, not our contract) swaps through a
///         hooked pool with hookData = (invoiceId, payer), and the pool itself settles the invoice.
contract CheckoutHookTest is TenderFixture {
    uint256 internal constant TEN_USDC = 10e6;
    PoolKey internal wethUsdcHooked;
    PoolKey internal demoUsdcHooked;

    function setUp() public {
        setUpTender();
        wethUsdcHooked = _hookedKey(address(weth), address(usdc), FEE_LOW, TS_LOW);
        demoUsdcHooked = _hookedKey(address(demo), address(usdc), FEE_MID, TS_MID);
        // the payer lets the generic router pull tokens (same as with any wallet/router today)
        vm.startPrank(payer);
        weth.approve(address(_router()), type(uint256).max);
        demo.approve(address(_router()), type(uint256).max);
        usdc.approve(address(_router()), type(uint256).max);
        vm.stopPrank();
    }

    /// exact-input swap of `amountIn` of key's input side through the generic router, carrying hookData
    function _swapViaRouter(PoolKey memory key, address tokenIn, uint256 amountIn, bytes memory hookData) internal {
        bool zeroForOne = tokenIn < _other(key, tokenIn);
        _router().swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );
    }

    function _other(PoolKey memory key, address token) internal pure returns (address) {
        address c0 = address(uint160(uint256(bytes32(abi.encode(key.currency0)))));
        address c1 = address(uint160(uint256(bytes32(abi.encode(key.currency1)))));
        return token == c0 ? c1 : c0;
    }

    // ------------------------------------------------------------------
    // Happy path: any router pays the invoice by swapping through the pool
    // ------------------------------------------------------------------

    function test_anyRouter_paysInvoice_merchantGetsExact_payerGetsRest() public {
        uint256 id = _newInvoice(TEN_USDC);
        weth.mint(payer, 1e18);
        uint256 payerUsdcBefore = usdc.balanceOf(payer);

        // 0.004 WETH is ~$12 in the hooked pool: enough for the $10 invoice plus change
        vm.prank(payer);
        _swapViaRouter(wethUsdcHooked, address(weth), 0.004e18, abi.encode(id, payer));

        assertEq(usdc.balanceOf(merchant), TEN_USDC, "merchant receives exactly the invoice amount");
        uint256 change = usdc.balanceOf(payer) - payerUsdcBefore;
        assertGt(change, 1.9e6, "payer keeps the rest of the output (~$2)");
        assertLt(change, 2.1e6);
        assertEq(usdc.balanceOf(address(hook)), 0, "hook holds nothing");
        assertEq(usdc.balanceOf(address(checkout)), 0, "checkout holds nothing");

        CheckoutCore.Invoice memory inv = checkout.getInvoice(id);
        assertEq(uint8(inv.status), uint8(CheckoutCore.Status.Paid));
        assertEq(inv.payer, payer, "payer recorded from hookData, so refunds go to them");
    }

    function test_anyRouter_DEMO_direct_hookedPool() public {
        uint256 id = _newInvoice(TEN_USDC);
        demo.mint(payer, 100e18);
        vm.prank(payer);
        _swapViaRouter(demoUsdcHooked, address(demo), 7e18, abi.encode(id, payer)); // 7 DEMO ≈ $10.5
        assertEq(usdc.balanceOf(merchant), TEN_USDC);
        assertEq(uint8(checkout.getInvoice(id).status), uint8(CheckoutCore.Status.Paid));
    }

    function test_emptyHookData_isAnOrdinarySwap() public {
        weth.mint(payer, 1e18);
        vm.prank(payer);
        _swapViaRouter(wethUsdcHooked, address(weth), 0.004e18, "");
        assertEq(usdc.balanceOf(merchant), 0);
        assertGt(usdc.balanceOf(payer), 11e6, "payer simply received the output");
    }

    // ------------------------------------------------------------------
    // Everything that must fail (and leave the invoice Open, payer untouched)
    // ------------------------------------------------------------------

    function test_revert_outputDoesNotCoverInvoice() public {
        uint256 id = _newInvoice(TEN_USDC);
        weth.mint(payer, 1e18);
        vm.prank(payer);
        vm.expectRevert(); // CheckoutHook.Underpaid, wrapped by the PoolManager's hook-call error
        _swapViaRouter(wethUsdcHooked, address(weth), 0.002e18, abi.encode(id, payer)); // ~$6 < $10
        assertEq(uint8(checkout.getInvoice(id).status), uint8(CheckoutCore.Status.Open));
        assertEq(weth.balanceOf(payer), 1e18, "nothing moved");
        assertEq(usdc.balanceOf(merchant), 0);
    }

    function test_revert_exactOutputSwapsNotAllowed() public {
        uint256 id = _newInvoice(TEN_USDC);
        weth.mint(payer, 1e18);
        vm.prank(payer);
        vm.expectRevert(); // CheckoutHook.ExactInputOnly
        _router().swap(
            wethUsdcHooked,
            SwapParams({zeroForOne: true, amountSpecified: int256(TEN_USDC), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            abi.encode(id, payer)
        );
    }

    function test_revert_wrongOutputToken() public {
        uint256 id = _newInvoice(TEN_USDC); // invoice wants USDC ...
        usdc.mint(payer, 100e6);
        vm.prank(payer);
        vm.expectRevert(); // CheckoutHook.WrongSettleToken: this direction outputs WETH
        _swapViaRouter(wethUsdcHooked, address(usdc), 50e6, abi.encode(id, payer));
    }

    function test_revert_alreadyPaidInvoice() public {
        uint256 id = _newInvoice(TEN_USDC);
        weth.mint(payer, 1e18);
        vm.startPrank(payer);
        _swapViaRouter(wethUsdcHooked, address(weth), 0.004e18, abi.encode(id, payer));
        vm.expectRevert(); // CheckoutCore.NotOpen
        _swapViaRouter(wethUsdcHooked, address(weth), 0.004e18, abi.encode(id, payer));
        vm.stopPrank();
    }

    function test_revert_afterSwap_onlyPoolManager() public {
        vm.expectRevert(CheckoutHook.NotPoolManager.selector);
        hook.afterSwap(address(this), wethUsdcHooked, SwapParams(true, -1, 0), toBalanceDelta(0, 0), "");
    }

    function test_revert_settleFromHook_onlyHook() public {
        uint256 id = _newInvoice(TEN_USDC);
        vm.expectRevert(CheckoutCore.NotHook.selector);
        checkout.settleFromHook(id, payer, address(weth), 1);
    }

    function test_hook_isAtAValidV4Address() public view {
        assertEq(address(hook), HOOK_ADDR);
        assertEq(checkout.hook(), HOOK_ADDR);
    }
}
