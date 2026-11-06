// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

import {UniswapCheckout} from "../src/UniswapCheckout.sol";
import {DemoToken} from "../src/mocks/DemoToken.sol";

/// @notice Deploys DemoToken + UniswapCheckout to Unichain Sepolia (chain 1301).
///
///   forge script script/DeployUnichain.s.sol --rpc-url $UNICHAIN_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
contract DeployUnichain is Script {
    /// Uniswap v4 PoolManager on Unichain Sepolia (developers.uniswap.org/docs/protocols/v4/deployments)
    address internal constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    /// Circle USDC on Unichain Sepolia (override with UNICHAIN_USDC if it differs)
    address internal constant DEFAULT_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    function run() external returns (UniswapCheckout checkout, DemoToken demo) {
        address usdc = vm.envOr("UNICHAIN_USDC", DEFAULT_USDC);
        address[] memory settle = new address[](1);
        settle[0] = usdc;

        vm.startBroadcast();
        demo = new DemoToken();
        checkout = new UniswapCheckout(IPoolManager(POOL_MANAGER), settle);
        vm.stopBroadcast();

        console2.log("DemoToken       ", address(demo));
        console2.log("UniswapCheckout ", address(checkout));
        console2.log("settle token    ", usdc);
    }
}
