// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {LiquidityAmounts} from "v4-core/test/utils/LiquidityAmounts.sol";

import {DemoToken} from "../src/mocks/DemoToken.sol";

interface IWETH {
    function deposit() external payable;
}

/// @notice Creates and funds the three demo pools on Unichain Sepolia (testnet liquidity is too thin to
///         rely on). Same shape as the test fixture, scaled down to what faucets give you:
///           WETH/USDC  0.05% : up to 0.03 WETH + 30 USDC (joins the existing pool at ITS price)
///           DEMO/WETH  0.30% : 50 DEMO + $75 of WETH at that price   -> 1 DEMO = $1.50
///           DEMO/USDC  0.30% : 4 DEMO + 6 USDC                       -> 1 DEMO = $1.50, deliberately THIN
///         and, if HOOK is set, two pools with the CheckoutHook attached (payable by any router):
///           WETH/USDC+hook 0.05% : $10 of WETH + 10 USDC
///           DEMO/USDC+hook 0.30% : 2 DEMO + 3 USDC
///
///   DEMO=<address from DeployUnichain> forge script script/SeedPools.s.sol \
///       --rpc-url $UNICHAIN_SEPOLIA_RPC --private-key $DEPLOYER_PK --broadcast
///
/// If a pool already exists (someone else created WETH/USDC at 0.05%), the script keeps its current price
/// and adds liquidity at that price; check the log line and pick another fee tier if the price is nonsense.
///
/// LITE=true: the same five pools sized for ONE day of faucets (0.01 ETH, 20 USDC): about 0.009 WETH and
/// 12.6 USDC. Wraps only the WETH it needs. Use invoices of ~0.10 USDC so price impact stays small.
///           WETH/USDC $5+5 · DEMO/WETH $5.50 of WETH · DEMO/USDC 0.4+0.6 (thin) · hooked $1+1 · hooked 4+6
contract SeedPools is Script {
    using StateLibrary for IPoolManager;

    IPoolManager internal constant POOL_MANAGER = IPoolManager(0x00B036B58a818B1BC34d502D3fE730Db729e62AC);
    PoolModifyLiquidityTest internal constant LIQUIDITY_ROUTER =
        PoolModifyLiquidityTest(0x5fa728C0A5cfd51BEe4B060773f50554c0C8A7AB);
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant DEFAULT_USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    function run() external {
        address usdc = vm.envOr("UNICHAIN_USDC", DEFAULT_USDC);
        address demo = vm.envAddress("DEMO");
        address hook = vm.envOr("HOOK", address(0));
        if (vm.envOr("LITE", false)) return _runLite(usdc, demo, hook);
        uint256 wrapEth = vm.envOr("WRAP_ETH", uint256(0.1 ether)); // ETH to wrap into WETH first

        vm.startBroadcast();
        if (wrapEth > 0) IWETH(WETH).deposit{value: wrapEth}();
        _prepare(usdc, demo);

        // WETH/USDC first. On Unichain Sepolia a 0.05% pool already exists at its own price (~$988/WETH
        // when checked on Nov 4), so read back whatever price the pool really has ...
        uint160 wethUsdcPrice = _seed(WETH, 0.03e18, usdc, 30e6, 500, 10, address(0));
        // ... and price DEMO against it so that 1 DEMO = $1.50 on BOTH routes: 50 DEMO = $75 of WETH.
        uint256 wethFor75Usd = _wethForUsdc(75e6, wethUsdcPrice, usdc);
        _seed(demo, 50e18, WETH, wethFor75Usd, 3000, 60, address(0));
        _seed(demo, 4e18, usdc, 6e6, 3000, 60, address(0)); // the deliberately thin direct pool
        if (hook != address(0)) {
            _seed(WETH, _wethForUsdc(10e6, wethUsdcPrice, usdc), usdc, 10e6, 500, 10, hook);
            _seed(demo, 2e18, usdc, 3e6, 3000, 60, hook);
        }
        vm.stopBroadcast();
    }

    function _runLite(address usdc, address demo, address hook) internal {
        // Price WETH from the live pool first, then wrap exactly the WETH the pools need (minus what we hold).
        (uint160 p,,,) = POOL_MANAGER.getSlot0(_key(WETH, usdc, 500, 10, address(0)).toId());
        require(p != 0, "WETH/USDC 0.05% pool missing: run the full profile");
        uint256 wethMain = _wethForUsdc(5e6, p, usdc);
        uint256 wethDemo = _wethForUsdc(5.5e6, p, usdc);
        uint256 wethHook = hook == address(0) ? 0 : _wethForUsdc(1e6, p, usdc);
        uint256 need = wethMain + wethDemo + wethHook;
        uint256 have = IERC20(WETH).balanceOf(msg.sender);
        console2.log("lite: WETH needed (wei)", need);

        vm.startBroadcast();
        if (need > have) IWETH(WETH).deposit{value: need - have}();
        _prepare(usdc, demo);
        _seed(WETH, wethMain, usdc, 5e6, 500, 10, address(0));
        _seed(demo, 3.6667e18, WETH, wethDemo, 3000, 60, address(0)); // $5.50 / $1.50
        _seed(demo, 0.4e18, usdc, 0.6e6, 3000, 60, address(0)); // deliberately thin direct pool: the two-hop wins
        if (hook != address(0)) {
            _seed(WETH, wethHook, usdc, 1e6, 500, 10, hook);
            _seed(demo, 4e18, usdc, 6e6, 3000, 60, hook);
        }
        vm.stopBroadcast();
    }

    function _prepare(address usdc, address demo) internal {
        DemoToken(demo).mint(msg.sender, 1_000e18);
        IERC20(WETH).approve(address(LIQUIDITY_ROUTER), type(uint256).max);
        IERC20(usdc).approve(address(LIQUIDITY_ROUTER), type(uint256).max);
        IERC20(demo).approve(address(LIQUIDITY_ROUTER), type(uint256).max);
    }

    function _key(address a, address b, uint24 fee, int24 tickSpacing, address hooks)
        internal
        pure
        returns (PoolKey memory)
    {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return PoolKey(Currency.wrap(t0), Currency.wrap(t1), fee, tickSpacing, IHooks(hooks));
    }

    /// @dev How much WETH is worth `usdcAmount` at the pool price sqrtPriceX96 (price = (sqrtP / 2^96)^2,
    ///      in token1-per-token0 raw units). Two cases, depending on which token sorts first.
    function _wethForUsdc(uint256 usdcAmount, uint160 sqrtPriceX96, address usdc) internal pure returns (uint256) {
        uint256 q96 = 1 << 96;
        if (usdc < WETH) {
            // currency0 = USDC, currency1 = WETH: WETH = USDC * price
            return FullMath.mulDiv(FullMath.mulDiv(usdcAmount, sqrtPriceX96, q96), sqrtPriceX96, q96);
        }
        // currency0 = WETH, currency1 = USDC: WETH = USDC / price
        return FullMath.mulDiv(FullMath.mulDiv(usdcAmount, q96, sqrtPriceX96), q96, sqrtPriceX96);
    }

    function _seed(
        address tokenA,
        uint256 amountA,
        address tokenB,
        uint256 amountB,
        uint24 fee,
        int24 tickSpacing,
        address hooks
    ) internal returns (uint160 sqrtPriceX96Used) {
        (address t0, uint256 a0, address t1, uint256 a1) =
            tokenA < tokenB ? (tokenA, amountA, tokenB, amountB) : (tokenB, amountB, tokenA, amountA);
        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), fee, tickSpacing, IHooks(hooks));
        PoolId id = key.toId();

        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(id);
        if (sqrtPriceX96 == 0) {
            sqrtPriceX96 = uint160(Math.sqrt(FullMath.mulDiv(a1, 1 << 192, a0)));
            POOL_MANAGER.initialize(key, sqrtPriceX96);
            console2.log("created pool, fee", fee, hooks == address(0) ? "" : "(hooked)");
        } else {
            console2.log("pool already existed, keeping its price; fee", fee);
        }

        int24 lower = TickMath.minUsableTick(tickSpacing);
        int24 upper = TickMath.maxUsableTick(tickSpacing);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), a0, a1
        );
        LIQUIDITY_ROUTER.modifyLiquidity(
            key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), bytes32(0)), ""
        );
        console2.log("  token0", t0);
        console2.log("  token1", t1);
        console2.log("  liquidity", uint256(liquidity));
        sqrtPriceX96Used = sqrtPriceX96;
    }
}
