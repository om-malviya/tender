// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";

import {UniswapCheckout} from "../src/UniswapCheckout.sol";
import {CheckoutHook} from "../src/CheckoutHook.sol";
import {DemoToken} from "../src/mocks/DemoToken.sol";

/// @notice Deploys DemoToken, UniswapCheckout and the CheckoutHook to Unichain Sepolia (chain 1301).
///
///   forge script script/DeployUnichain.s.sol --rpc-url $UNICHAIN_SEPOLIA_RPC \
///       --private-key $DEPLOYER_PK --broadcast
///
/// The hook and the checkout reference each other, and a v4 hook must live at an address whose low 14 bits
/// spell out its permissions. So: predict the checkout's address (next nonce), MINE a CREATE2 salt that gives
/// the hook a valid address, deploy the checkout with that hook address, then deploy the hook at it.
contract DeployUnichain is Script {
    /// Uniswap v4 PoolManager on Unichain Sepolia (developers.uniswap.org/docs/protocols/v4/deployments)
    address internal constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    /// Circle USDC on Unichain Sepolia (override with UNICHAIN_USDC if it differs)
    address internal constant DEFAULT_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    uint160 internal constant HOOK_FLAGS = Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    function run() external returns (UniswapCheckout checkout, DemoToken demo, CheckoutHook hook) {
        address usdc = vm.envOr("UNICHAIN_USDC", DEFAULT_USDC);
        address[] memory settle = new address[](1);
        settle[0] = usdc;

        vm.startBroadcast();
        demo = new DemoToken();
        (, address deployer,) = vm.readCallers();
        vm.stopBroadcast();

        // The checkout is the deployer's next plain CREATE, so its address is known before it exists.
        address predictedCheckout = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        bytes memory hookInitCode = abi.encodePacked(type(CheckoutHook).creationCode, abi.encode(POOL_MANAGER, predictedCheckout));
        (bytes32 salt, address hookAddr) = _mineSalt(hookInitCode);

        vm.startBroadcast();
        checkout = new UniswapCheckout(IPoolManager(POOL_MANAGER), settle, hookAddr);
        require(address(checkout) == predictedCheckout, "checkout address prediction failed");
        // CREATE2 through the deterministic deployer (0x4e59...956C, present on every EVM chain): calldata is
        // salt ++ initcode, it returns the new address. Same deployer vm.computeCreate2Address assumes.
        (bool ok, bytes memory ret) = CREATE2_FACTORY.call(abi.encodePacked(salt, hookInitCode));
        require(ok, "CREATE2 deploy failed");
        hook = CheckoutHook(address(bytes20(ret)));
        require(address(hook) == hookAddr, "hook address mismatch");
        vm.stopBroadcast();

        console2.log("DemoToken       ", address(demo));
        console2.log("UniswapCheckout ", address(checkout));
        console2.log("CheckoutHook    ", address(hook));
        console2.log("settle token    ", usdc);
    }

    /// @dev Tries salts until the CREATE2 address has exactly HOOK_FLAGS in its low 14 bits (1 in 16,384).
    function _mineSalt(bytes memory initCode) internal view returns (bytes32 salt, address addr) {
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 i = 0; i < 400_000; i++) {
            salt = bytes32(i);
            addr = vm.computeCreate2Address(salt, initCodeHash);
            if (uint160(addr) & Hooks.ALL_HOOK_MASK == HOOK_FLAGS) return (salt, addr);
        }
        revert("no salt found");
    }
}
