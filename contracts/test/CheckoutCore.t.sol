// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {CheckoutCore} from "../src/CheckoutCore.sol";

/// @notice The invoice logic on its own: this is exactly what runs on Whitechain (with USDT).
contract CheckoutCoreTest is Test {
    CheckoutCore internal core;
    MockERC20 internal usdt;
    MockERC20 internal other;

    address internal merchant = makeAddr("merchant");
    uint256 internal payerKey = 0xA11CE;
    address internal payer = vm.addr(payerKey);
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT = 25e6; // 25.00 USDT

    function setUp() public {
        usdt = new MockERC20("Tether USD", "USDT", 6);
        other = new MockERC20("Other", "OTH", 6);
        address[] memory settle = new address[](1);
        settle[0] = address(usdt);
        core = new CheckoutCore(settle, address(0));

        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(core), type(uint256).max);
        vm.prank(merchant);
        usdt.approve(address(core), type(uint256).max); // merchants approve once to be able to refund
    }

    function _create() internal returns (uint256 id) {
        vm.prank(merchant);
        id = core.createInvoice(address(usdt), AMOUNT, uint64(block.timestamp + 1 days), keccak256("order-42"));
    }

    // ------------------------------------------------------------------
    // Happy path: create -> pay -> partial refund -> refund the rest
    // ------------------------------------------------------------------

    function test_fullLifecycle() public {
        uint256 id = _create();
        assertEq(id, 1, "ids start at 1");

        vm.prank(payer);
        core.payInvoice(id);
        assertEq(usdt.balanceOf(merchant), AMOUNT);
        assertEq(usdt.balanceOf(address(core)), 0, "non-custodial: contract never holds funds");

        vm.prank(merchant);
        core.refund(id, 10e6);
        assertEq(usdt.balanceOf(payer), 1_000e6 - AMOUNT + 10e6);

        vm.prank(merchant);
        core.refund(id, 15e6);
        assertEq(core.getInvoice(id).refunded, AMOUNT);
        assertEq(usdt.balanceOf(payer), 1_000e6, "fully refunded");
    }

    function test_payInvoiceWithPermit_oneTransaction() public {
        uint256 id = _create();
        address fresh = vm.addr(0xB0B);
        usdt.mint(fresh, AMOUNT); // no approve: the signature replaces it
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(0xB0B, fresh, AMOUNT, block.timestamp + 1 hours);

        vm.prank(fresh);
        core.payInvoiceWithPermit(id, block.timestamp + 1 hours, v, r, s);
        assertEq(usdt.balanceOf(merchant), AMOUNT);
        assertEq(core.getInvoice(id).payer, fresh);
    }

    function test_cancel() public {
        uint256 id = _create();
        vm.prank(merchant);
        core.cancel(id);
        assertEq(uint8(core.getInvoice(id).status), uint8(CheckoutCore.Status.Cancelled));

        vm.prank(payer);
        vm.expectRevert(CheckoutCore.NotOpen.selector);
        core.payInvoice(id);
    }

    function test_isExpired() public {
        uint256 id = _create();
        assertFalse(core.isExpired(id));
        vm.warp(block.timestamp + 2 days);
        assertTrue(core.isExpired(id));
    }

    // ------------------------------------------------------------------
    // Everything that must revert
    // ------------------------------------------------------------------

    function test_revert_createWithUnlistedToken() public {
        vm.prank(merchant);
        vm.expectRevert(CheckoutCore.TokenNotAllowed.selector);
        core.createInvoice(address(other), AMOUNT, uint64(block.timestamp + 1), bytes32(0));
    }

    function test_revert_createZeroAmount() public {
        vm.prank(merchant);
        vm.expectRevert(CheckoutCore.ZeroAmount.selector);
        core.createInvoice(address(usdt), 0, uint64(block.timestamp + 1), bytes32(0));
    }

    function test_revert_createAlreadyExpired() public {
        vm.prank(merchant);
        vm.expectRevert(CheckoutCore.Expired.selector);
        core.createInvoice(address(usdt), AMOUNT, uint64(block.timestamp), bytes32(0));
    }

    function test_revert_payTwice() public {
        uint256 id = _create();
        vm.startPrank(payer);
        core.payInvoice(id);
        vm.expectRevert(CheckoutCore.NotOpen.selector);
        core.payInvoice(id);
        vm.stopPrank();
    }

    function test_revert_payAfterExpiry() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(payer);
        vm.expectRevert(CheckoutCore.Expired.selector);
        core.payInvoice(id);
    }

    function test_revert_payUnknownInvoice() public {
        vm.prank(payer);
        vm.expectRevert(CheckoutCore.NotOpen.selector);
        core.payInvoice(999);
    }

    function test_revert_strangerCannotRefundOrCancel() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert(CheckoutCore.NotMerchant.selector);
        core.cancel(id);

        vm.prank(payer);
        core.payInvoice(id);
        vm.prank(stranger);
        vm.expectRevert(CheckoutCore.NotMerchant.selector);
        core.refund(id, 1);
    }

    function test_revert_refundBeforePaid() public {
        uint256 id = _create();
        vm.prank(merchant);
        vm.expectRevert(CheckoutCore.NotPaid.selector);
        core.refund(id, 1);
    }

    function test_revert_overRefund() public {
        uint256 id = _create();
        vm.prank(payer);
        core.payInvoice(id);

        vm.startPrank(merchant);
        core.refund(id, 20e6);
        vm.expectRevert(CheckoutCore.RefundTooLarge.selector);
        core.refund(id, 5e6 + 1);
        vm.stopPrank();
    }

    function test_revert_cancelAfterPaid() public {
        uint256 id = _create();
        vm.prank(payer);
        core.payInvoice(id);
        vm.prank(merchant);
        vm.expectRevert(CheckoutCore.NotOpen.selector);
        core.cancel(id);
    }

    // ------------------------------------------------------------------
    // Fuzz: any sequence of two refunds never exceeds the invoice amount
    // ------------------------------------------------------------------

    function testFuzz_refundsNeverExceedAmount(uint256 first, uint256 second) public {
        uint256 id = _create();
        vm.prank(payer);
        core.payInvoice(id);

        first = bound(first, 1, AMOUNT);
        vm.prank(merchant);
        core.refund(id, first);

        second = bound(second, 1, 2 * AMOUNT);
        vm.prank(merchant);
        if (first + second > AMOUNT) vm.expectRevert(CheckoutCore.RefundTooLarge.selector);
        core.refund(id, second);

        assertLe(core.getInvoice(id).refunded, AMOUNT);
        assertEq(usdt.balanceOf(address(core)), 0);
    }

    function _signPermit(uint256 key, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(core),
                value,
                usdt.nonces(owner),
                deadline
            )
        );
        return vm.sign(key, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash)));
    }
}
