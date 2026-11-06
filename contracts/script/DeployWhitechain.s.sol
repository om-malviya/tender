// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {CheckoutCore} from "../src/CheckoutCore.sol";

/// @notice Deploys CheckoutCore (USDT invoices + refunds) to Whitechain Sepolia (chain 1874).
///
///   FOUNDRY_PROFILE=whitechain forge script script/DeployWhitechain.s.sol \
///       --rpc-url https://rpc.testnet.whitechain.io/ --private-key $DEPLOYER_PK --broadcast
///   FOUNDRY_PROFILE=whitechain forge verify-contract <address> src/CheckoutCore.sol:CheckoutCore \
///       --rpc-url https://rpc.testnet.whitechain.io/ --verifier blockscout \
///       --verifier-url https://explorer.testnet.whitechain.io/api/ \
///       --constructor-args $(cast abi-encode "constructor(address[],address)" "[0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7]" 0x0000000000000000000000000000000000000000)
contract DeployWhitechain is Script {
    /// Whitechain's test USDT. The prize requires payments in THIS token (not a self-minted one).
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    function run() external returns (CheckoutCore core) {
        address[] memory settle = new address[](1);
        settle[0] = USDT;

        vm.startBroadcast();
        core = new CheckoutCore(settle, address(0)); // no Uniswap on Whitechain, so no hook
        vm.stopBroadcast();

        console2.log("CheckoutCore (Whitechain)", address(core));
    }
}
