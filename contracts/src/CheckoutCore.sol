// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CheckoutCore
/// @notice Merchant invoices for an exact stablecoin amount, paid by anyone, refundable by the merchant.
/// @dev Non-custodial: every payment moves tokens payer -> merchant (and refunds merchant -> payer)
///      inside a single call, so this contract never holds a balance. No owner, no admin, no upgrades.
///      Deployed on Whitechain Sepolia as-is (USDT) and extended by UniswapCheckout on Unichain Sepolia (USDC).
contract CheckoutCore is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev "Expired" is not a stored status: an Open invoice past its expiry simply can't be paid.
    enum Status {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address merchant; // receives the payment; the only one allowed to refund or cancel
        address settleToken; // the stablecoin the merchant wants (must be on the allowlist)
        uint256 amount; // exact amount in token units (6 decimals for USDC/USDT: 1.00 = 1_000_000)
        uint64 expiry; // unix timestamp; paying after this reverts
        Status status;
        address payer; // set when paid; refunds can only go back to this address
        uint256 refunded; // total refunded so far, never more than `amount`
        bytes32 orderRef; // the merchant's own order id (hashed), for reconciliation and CSV export
    }

    /// @notice Next id to hand out. Starts at 1 so that id 0 never refers to a real invoice.
    uint256 public nextInvoiceId = 1;

    /// @notice Stablecoins invoices may be priced in. Fixed at deploy time; nobody can change it later.
    mapping(address => bool) public isSettleToken;

    mapping(uint256 => Invoice) internal _invoices;

    event InvoiceCreated(
        uint256 indexed id, address indexed merchant, address settleToken, uint256 amount, uint64 expiry, bytes32 orderRef
    );
    /// @dev tokenIn/amountIn describe what the payer spent; amountSettled is what the merchant received.
    ///      For a basket payment tokenIn is address(0); the per-token detail is in BasketPaid.
    event InvoicePaid(
        uint256 indexed id,
        address indexed merchant,
        address indexed payer,
        address tokenIn,
        uint256 amountIn,
        uint256 amountSettled
    );
    event Refunded(
        uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 totalRefunded
    );
    event Cancelled(uint256 indexed id, address indexed merchant);

    error TokenNotAllowed();
    error ZeroAmount();
    error Expired();
    error NotOpen();
    error NotPaid();
    error NotMerchant();
    error RefundTooLarge();

    constructor(address[] memory settleTokens) {
        for (uint256 i = 0; i < settleTokens.length; i++) {
            isSettleToken[settleTokens[i]] = true;
        }
    }

    // ---------------------------------------------------------------------
    // Merchant actions
    // ---------------------------------------------------------------------

    /// @notice Create an invoice. The caller becomes the merchant who gets paid.
    function createInvoice(address settleToken, uint256 amount, uint64 expiry, bytes32 orderRef)
        external
        returns (uint256 id)
    {
        if (!isSettleToken[settleToken]) revert TokenNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert Expired();

        id = nextInvoiceId++;
        _invoices[id] = Invoice({
            merchant: msg.sender,
            settleToken: settleToken,
            amount: amount,
            expiry: expiry,
            status: Status.Open,
            payer: address(0),
            refunded: 0,
            orderRef: orderRef
        });
        emit InvoiceCreated(id, msg.sender, settleToken, amount, expiry, orderRef);
    }

    /// @notice Refund part or all of a paid invoice back to the original payer.
    /// @dev The merchant must first approve this contract for `amount` of the settle token.
    function refund(uint256 id, uint256 amount) external nonReentrant {
        Invoice storage inv = _invoices[id];
        if (inv.merchant != msg.sender) revert NotMerchant();
        if (inv.status != Status.Paid) revert NotPaid();
        if (amount == 0) revert ZeroAmount();
        if (inv.refunded + amount > inv.amount) revert RefundTooLarge();

        inv.refunded += amount; // effect first ...
        IERC20(inv.settleToken).safeTransferFrom(msg.sender, inv.payer, amount); // ... then interaction
        emit Refunded(id, msg.sender, inv.payer, amount, inv.refunded);
    }

    /// @notice Cancel an invoice that hasn't been paid yet.
    function cancel(uint256 id) external {
        Invoice storage inv = _invoices[id];
        if (inv.merchant != msg.sender) revert NotMerchant();
        if (inv.status != Status.Open) revert NotOpen();

        inv.status = Status.Cancelled;
        emit Cancelled(id, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Customer actions: pay in the settle token itself
    // ---------------------------------------------------------------------

    /// @notice Pay an invoice in its settle token. The payer must have approved this contract first.
    function payInvoice(uint256 id) external nonReentrant {
        _payDirect(id);
    }

    /// @notice Same as payInvoice, but the approval is an EIP-2612 signature, so it's one transaction.
    /// @dev The permit call is wrapped in try/catch: if someone front-runs and submits the same signature,
    ///      the allowance already exists and the payment still goes through.
    function payInvoiceWithPermit(uint256 id, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        Invoice storage inv = _requirePayable(id);
        try IERC20Permit(inv.settleToken).permit(msg.sender, address(this), inv.amount, deadline, v, r, s) {} catch {}
        _payDirect(id);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    function isExpired(uint256 id) external view returns (bool) {
        Invoice storage inv = _invoices[id];
        return inv.status == Status.Open && block.timestamp > inv.expiry;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _payDirect(uint256 id) internal {
        Invoice storage inv = _markPaid(id);
        IERC20(inv.settleToken).safeTransferFrom(msg.sender, inv.merchant, inv.amount);
        emit InvoicePaid(id, inv.merchant, msg.sender, inv.settleToken, inv.amount, inv.amount);
    }

    /// @dev Checks an invoice can be paid right now (Open and not expired).
    function _requirePayable(uint256 id) internal view returns (Invoice storage inv) {
        inv = _invoices[id];
        if (inv.status != Status.Open) revert NotOpen();
        if (block.timestamp > inv.expiry) revert Expired();
    }

    /// @dev Checks-Effects: marks the invoice Paid and records the payer BEFORE any token moves.
    ///      If anything later in the transaction fails, the whole transaction reverts and the
    ///      invoice is Open again, so marking it early is always safe.
    function _markPaid(uint256 id) internal returns (Invoice storage inv) {
        inv = _requirePayable(id);
        inv.status = Status.Paid;
        inv.payer = msg.sender;
    }
}
