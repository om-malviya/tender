// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title DemoToken
/// @notice TESTNET ONLY. A worthless token anyone can mint. It plays "the wrong token the customer holds"
///         in the Unichain Sepolia demo, so the checkout has something to swap from.
contract DemoToken is ERC20 {
    constructor() ERC20("Tender Demo Token", "DEMO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
