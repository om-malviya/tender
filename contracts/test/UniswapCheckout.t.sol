// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CheckoutCore} from "../src/CheckoutCore.sol";
import {UniswapCheckout} from "../src/UniswapCheckout.sol";
import {TenderFixture} from "./utils/TenderFixture.sol";

/// @notice Swaps through a real v4 PoolManager with real pools (see TenderFixture).
contract UniswapCheckoutTest is TenderFixture {
    uint256 internal constant TEN_USDC = 10e6;

    function setUp() public {
        setUpTender();
    }

    // ------------------------------------------------------------------
    // payWithToken: the happy paths
    // ------------------------------------------------------------------

    function test_payWithToken_singleHop_merchantGetsExactAmount() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);

        vm.prank(payer);
        uint256 spent = checkout.payWithToken(id, address(weth), 0.01e18, _pathWeth(), block.timestamp);

        assertEq(usdc.balanceOf(merchant), TEN_USDC, "merchant must receive exactly 10 USDC");
        assertEq(weth.balanceOf(payer), 1e18 - spent, "payer pays only what the swap needed");
        // 10 USDC at $3,000/WETH is ~0.00333 WETH, plus a 0.05% fee and a tiny price impact
        assertGt(spent, 0.00333e18);
        assertLt(spent, 0.00336e18);
        _assertCheckoutHoldsNothing();

        CheckoutCore.Invoice memory inv = checkout.getInvoice(id);
        assertEq(uint8(inv.status), uint8(CheckoutCore.Status.Paid));
        assertEq(inv.payer, payer);
    }

    function test_payWithToken_twoHop_DEMO_via_WETH() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(demo, 100e18);

        vm.prank(payer);
        uint256 spent = checkout.payWithToken(id, address(demo), 8e18, _pathDemoViaWeth(), block.timestamp);

        assertEq(usdc.balanceOf(merchant), TEN_USDC);
        assertEq(demo.balanceOf(payer), 100e18 - spent);
        // 10 USDC / $1.50 = 6.67 DEMO, plus 0.3% + 0.05% fees
        assertGt(spent, 6.66e18);
        assertLt(spent, 6.72e18);
        _assertCheckoutHoldsNothing();
    }

    /// The point of route ranking: the deep two-hop route beats the thin direct pool.
    function test_twoHopRoute_isCheaperThan_thinDirectPool() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(demo, 100e18);

        uint256 snap = vm.snapshotState();
        vm.prank(payer);
        uint256 direct = checkout.payWithToken(id, address(demo), 50e18, _pathDemoDirect(), block.timestamp);
        vm.revertToState(snap);

        vm.prank(payer);
        uint256 twoHop = checkout.payWithToken(id, address(demo), 50e18, _pathDemoViaWeth(), block.timestamp);

        assertLt(twoHop, direct, "two-hop should cost less DEMO than the thin direct pool");
        // thin pool: 40 DEMO / 60 USDC -> taking 10 USDC costs ~8 DEMO (price impact ~20%)
        assertGt(direct, 7.9e18);
    }

    // ------------------------------------------------------------------
    // payWithToken: everything that must fail (and leave the invoice Open)
    // ------------------------------------------------------------------

    function test_revert_maxTooLow_invoiceStaysOpen_payerKeepsFunds() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);

        vm.prank(payer);
        try checkout.payWithToken(id, address(weth), 0.003e18, _pathWeth(), block.timestamp) {
            fail();
        } catch (bytes memory err) {
            assertEq(bytes4(err), UniswapCheckout.TooExpensive.selector);
        }

        assertEq(uint8(checkout.getInvoice(id).status), uint8(CheckoutCore.Status.Open), "invoice still payable");
        assertEq(weth.balanceOf(payer), 1e18, "payer lost nothing");
        assertEq(usdc.balanceOf(merchant), 0);
    }

    function test_revert_pathMustStartWithTokenIn() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(demo, 100e18);

        vm.prank(payer);
        vm.expectRevert(UniswapCheckout.BadPath.selector);
        checkout.payWithToken(id, address(demo), 8e18, _pathWeth(), block.timestamp); // path starts with WETH
    }

    function test_revert_tokenInIsSettleToken() public {
        uint256 id = _newInvoice(TEN_USDC);
        UniswapCheckout.Hop[] memory path = new UniswapCheckout.Hop[](1);
        path[0] = _hop(address(usdc), FEE_LOW, TS_LOW);

        vm.prank(payer);
        vm.expectRevert(UniswapCheckout.BadPath.selector);
        checkout.payWithToken(id, address(usdc), TEN_USDC, path, block.timestamp);
    }

    function test_revert_poolThatDoesNotExist() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);
        UniswapCheckout.Hop[] memory path = new UniswapCheckout.Hop[](1);
        path[0] = _hop(address(weth), 100, 1); // no WETH/USDC pool at 0.01%

        vm.prank(payer);
        vm.expectRevert(); // PoolManager: PoolNotInitialized
        checkout.payWithToken(id, address(weth), 0.01e18, path, block.timestamp);
        assertEq(weth.balanceOf(payer), 1e18);
    }

    function test_revert_deadlinePassed() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);

        vm.prank(payer);
        vm.expectRevert(UniswapCheckout.DeadlinePassed.selector);
        checkout.payWithToken(id, address(weth), 0.01e18, _pathWeth(), block.timestamp - 1);
    }

    function test_revert_invoiceExpired() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);
        vm.warp(block.timestamp + 2 hours);

        vm.prank(payer);
        vm.expectRevert(CheckoutCore.Expired.selector);
        checkout.payWithToken(id, address(weth), 0.01e18, _pathWeth(), block.timestamp);
    }

    function test_revert_payTwice() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(weth, 1e18);

        vm.startPrank(payer);
        checkout.payWithToken(id, address(weth), 0.01e18, _pathWeth(), block.timestamp);
        vm.expectRevert(CheckoutCore.NotOpen.selector);
        checkout.payWithToken(id, address(weth), 0.01e18, _pathWeth(), block.timestamp);
        vm.stopPrank();
    }

    function test_revert_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(UniswapCheckout.NotPoolManager.selector);
        checkout.unlockCallback("");
    }

    // ------------------------------------------------------------------
    // payWithBasket
    // ------------------------------------------------------------------

    function test_basket_coversInvoice_andReturnsExcess() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(usdc, 4e6);
        _fundPayer(demo, 3e18);
        _fundPayer(weth, 0.001e18);

        UniswapCheckout.Leg[] memory legs = new UniswapCheckout.Leg[](3);
        legs[0] = UniswapCheckout.Leg(address(usdc), 4e6, new UniswapCheckout.Hop[](0), 0); // 4 USDC as-is
        legs[1] = UniswapCheckout.Leg(address(demo), 3e18, _pathDemoViaWeth(), 4.4e6); // ~$4.48
        legs[2] = UniswapCheckout.Leg(address(weth), 0.001e18, _pathWeth(), 2.9e6); // ~$2.99

        vm.prank(payer);
        uint256 totalOut = checkout.payWithBasket(id, legs, block.timestamp);

        assertEq(usdc.balanceOf(merchant), TEN_USDC, "merchant gets exactly 10 USDC");
        assertGt(totalOut, TEN_USDC);
        assertEq(usdc.balanceOf(payer), totalOut - TEN_USDC, "excess goes back to the payer");
        assertEq(demo.balanceOf(payer), 0);
        assertEq(weth.balanceOf(payer), 0);
        _assertCheckoutHoldsNothing();
    }

    function test_basket_revert_underpaid() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(usdc, 4e6);
        _fundPayer(demo, 1e18);

        UniswapCheckout.Leg[] memory legs = new UniswapCheckout.Leg[](2);
        legs[0] = UniswapCheckout.Leg(address(usdc), 4e6, new UniswapCheckout.Hop[](0), 0);
        legs[1] = UniswapCheckout.Leg(address(demo), 1e18, _pathDemoViaWeth(), 0); // only ~$1.49

        vm.prank(payer);
        try checkout.payWithBasket(id, legs, block.timestamp) {
            fail();
        } catch (bytes memory err) {
            assertEq(bytes4(err), UniswapCheckout.Underpaid.selector);
        }
        assertEq(usdc.balanceOf(payer), 4e6, "nothing moved");
    }

    function test_basket_revert_legBelowMin() public {
        uint256 id = _newInvoice(TEN_USDC);
        _fundPayer(demo, 10e18);

        UniswapCheckout.Leg[] memory legs = new UniswapCheckout.Leg[](1);
        legs[0] = UniswapCheckout.Leg(address(demo), 10e18, _pathDemoViaWeth(), 20e6); // asks for $20 from ~$15

        vm.prank(payer);
        try checkout.payWithBasket(id, legs, block.timestamp) {
            fail();
        } catch (bytes memory err) {
            assertEq(bytes4(err), UniswapCheckout.LegBelowMin.selector);
        }
    }

    // ------------------------------------------------------------------
    // Fuzz: for ANY invoice size the merchant gets exactly the amount
    // ------------------------------------------------------------------

    function testFuzz_payWithToken_exactAmountForAnyInvoice(uint256 amount) public {
        amount = bound(amount, 1, 5_000e6); // 0.000001 to 5,000 USDC
        uint256 id = _newInvoice(amount);
        _fundPayer(weth, 10e18);

        vm.prank(payer);
        uint256 spent = checkout.payWithToken(id, address(weth), 10e18, _pathWeth(), block.timestamp);

        assertEq(usdc.balanceOf(merchant), amount);
        assertEq(weth.balanceOf(payer), 10e18 - spent);
        _assertCheckoutHoldsNothing();
    }

    function _assertCheckoutHoldsNothing() internal view {
        assertEq(usdc.balanceOf(address(checkout)), 0, "checkout holds USDC");
        assertEq(weth.balanceOf(address(checkout)), 0, "checkout holds WETH");
        assertEq(demo.balanceOf(address(checkout)), 0, "checkout holds DEMO");
    }
}
