// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";

/// @notice LOCAL TESTING TOOL. Finds the storage slot that holds `holder`'s balance in `token`, so a local
///         fork can give test accounts tokens with anvil_setStorageAt. Works for proxies too.
///         Never needed on a real network (you can't write storage there).
///
///   forge script script/FindBalanceSlot.s.sol --rpc-url <fork> --sig "run(address,address)" <token> <holder>
contract FindBalanceSlot is Script {
    using stdStorage for StdStorage;

    StdStorage internal store;

    function run(address token, address holder) external {
        uint256 slot = store.target(token).sig("balanceOf(address)").with_key(holder).find();
        console2.log("BALANCE_SLOT");
        console2.logBytes32(bytes32(slot));
    }
}
