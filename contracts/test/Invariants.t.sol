// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {CheckoutCore} from "../src/CheckoutCore.sol";
import {UniswapCheckout} from "../src/UniswapCheckout.sol";
import {TenderFixture} from "./utils/TenderFixture.sol";

/// @notice The "random user" Foundry drives during invariant testing. Each function is one thing a real
///         merchant or customer might do, with inputs Foundry picks at random. Ghost variables keep a
///         running total of what SHOULD have happened, so the invariants can compare against reality.
contract CheckoutHandler is Test {
    UniswapCheckout internal checkout;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    address internal merchant;
    address internal payer;
    UniswapCheckout.Hop[] internal wethPath;

    uint256[] public ids;
    uint256 public ghostPaid; // sum of invoice amounts paid
    uint256 public ghostRefunded; // sum of refunds

    constructor(UniswapCheckout _checkout, MockERC20 _usdc, MockERC20 _weth, address _merchant, address _payer) {
        checkout = _checkout;
        usdc = _usdc;
        weth = _weth;
        merchant = _merchant;
        payer = _payer;
        wethPath.push(UniswapCheckout.Hop({tokenIn: address(_weth), fee: 500, tickSpacing: 10}));
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        vm.prank(merchant);
        ids.push(checkout.createInvoice(address(usdc), amount, uint64(block.timestamp + 1 hours), bytes32(0)));
    }

    function payDirect(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        CheckoutCore.Invoice memory inv = checkout.getInvoice(id);
        if (inv.status != CheckoutCore.Status.Open || block.timestamp > inv.expiry) return;

        vm.prank(payer);
        checkout.payInvoice(id);
        ghostPaid += inv.amount;
    }

    function payWithWeth(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        CheckoutCore.Invoice memory inv = checkout.getInvoice(id);
        if (inv.status != CheckoutCore.Status.Open || block.timestamp > inv.expiry) return;

        vm.prank(payer);
        checkout.payWithToken(id, address(weth), 1e18, wethPath, block.timestamp);
        ghostPaid += inv.amount;
    }

    function refund(uint256 seed, uint256 amount) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        CheckoutCore.Invoice memory inv = checkout.getInvoice(id);
        if (inv.status != CheckoutCore.Status.Paid || inv.refunded == inv.amount) return;

        amount = bound(amount, 1, inv.amount - inv.refunded);
        vm.prank(merchant);
        checkout.refund(id, amount);
        ghostRefunded += amount;
    }

    function cancel(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        if (checkout.getInvoice(id).status != CheckoutCore.Status.Open) return;
        vm.prank(merchant);
        checkout.cancel(id);
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 hours));
    }
}

/// @notice Properties that must hold after ANY sequence of handler calls.
contract InvariantsTest is TenderFixture {
    CheckoutHandler internal handler;

    function setUp() public {
        setUpTender();
        handler = new CheckoutHandler(checkout, usdc, weth, merchant, payer);

        usdc.mint(payer, 1_000_000e6);
        weth.mint(payer, 10_000e18);
        vm.startPrank(payer);
        usdc.approve(address(checkout), type(uint256).max);
        weth.approve(address(checkout), type(uint256).max);
        vm.stopPrank();
        vm.prank(merchant);
        usdc.approve(address(checkout), type(uint256).max); // for refunds

        targetContract(address(handler));
    }

    /// 1. Non-custodial: the contract never keeps any token.
    function invariant_checkoutHoldsNothing() public view {
        assertEq(usdc.balanceOf(address(checkout)), 0);
        assertEq(weth.balanceOf(address(checkout)), 0);
        assertEq(demo.balanceOf(address(checkout)), 0);
    }

    /// 2. The merchant's balance is exactly "everything paid minus everything refunded".
    ///    (Covers "merchant receives exactly the invoice amount" across every payment path.)
    function invariant_merchantBalanceMatchesBooks() public view {
        assertEq(usdc.balanceOf(merchant), handler.ghostPaid() - handler.ghostRefunded());
    }

    /// 3. No invoice is ever refunded more than it was worth.
    function invariant_refundsNeverExceedAmount() public view {
        uint256 n = handler.idsLength();
        for (uint256 i = 0; i < n; i++) {
            CheckoutCore.Invoice memory inv = checkout.getInvoice(handler.ids(i));
            assertLe(inv.refunded, inv.amount);
        }
    }

    /// 4. A refund only ever happens on a Paid invoice (never on Open or Cancelled ones).
    function invariant_refundedImpliesPaid() public view {
        uint256 n = handler.idsLength();
        for (uint256 i = 0; i < n; i++) {
            CheckoutCore.Invoice memory inv = checkout.getInvoice(handler.ids(i));
            if (inv.refunded > 0) assertEq(uint8(inv.status), uint8(CheckoutCore.Status.Paid));
        }
    }
}
