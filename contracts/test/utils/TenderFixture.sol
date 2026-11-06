// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {LiquidityAmounts} from "v4-core/test/utils/LiquidityAmounts.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

import {UniswapCheckout} from "../../src/UniswapCheckout.sol";

/// @notice Shared test setup: a REAL Uniswap v4 PoolManager (deployed by v4-core's Deployers helper),
///         three test tokens, three pools with liquidity, and a UniswapCheckout pointed at that PoolManager.
///
///         Prices (all pools full-range):
///           WETH/USDC  fee 0.05% : 100 WETH   : 300,000 USDC   -> 1 WETH = $3,000   (deep)
///           DEMO/WETH  fee 0.30% : 200,000 DEMO : 100 WETH     -> 1 DEMO = 0.0005 WETH = $1.50
///           DEMO/USDC  fee 0.30% : 40 DEMO    : 60 USDC        -> 1 DEMO = $1.50    (deliberately THIN)
///         The thin direct DEMO/USDC pool makes the two-hop route DEMO->WETH->USDC cheaper, which is
///         exactly what the ranking panel is meant to reveal.
abstract contract TenderFixture is Deployers {
    MockERC20 internal usdc; // 6 decimals, like real USDC
    MockERC20 internal weth; // 18 decimals
    MockERC20 internal demo; // 18 decimals

    UniswapCheckout internal checkout;

    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");

    uint24 internal constant FEE_LOW = 500;
    int24 internal constant TS_LOW = 10;
    uint24 internal constant FEE_MID = 3000;
    int24 internal constant TS_MID = 60;

    function setUpTender() internal {
        deployFreshManagerAndRouters(); // real PoolManager + helper routers

        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        demo = new MockERC20("Demo", "DEMO", 18);

        address[] memory settle = new address[](1);
        settle[0] = address(usdc);
        checkout = new UniswapCheckout(manager, settle);

        _addPool(address(weth), 100e18, address(usdc), 300_000e6, FEE_LOW, TS_LOW);
        _addPool(address(demo), 200_000e18, address(weth), 100e18, FEE_MID, TS_MID);
        _addPool(address(demo), 40e18, address(usdc), 60e6, FEE_MID, TS_MID);
    }

    // ------------------------------------------------------------------
    // Helpers used by the tests
    // ------------------------------------------------------------------

    function _hop(address tokenIn, uint24 fee, int24 tickSpacing) internal pure returns (UniswapCheckout.Hop memory) {
        return UniswapCheckout.Hop({tokenIn: tokenIn, fee: fee, tickSpacing: tickSpacing});
    }

    /// WETH -> USDC (deep pool)
    function _pathWeth() internal view returns (UniswapCheckout.Hop[] memory path) {
        path = new UniswapCheckout.Hop[](1);
        path[0] = _hop(address(weth), FEE_LOW, TS_LOW);
    }

    /// DEMO -> WETH -> USDC (two deep pools)
    function _pathDemoViaWeth() internal view returns (UniswapCheckout.Hop[] memory path) {
        path = new UniswapCheckout.Hop[](2);
        path[0] = _hop(address(demo), FEE_MID, TS_MID);
        path[1] = _hop(address(weth), FEE_LOW, TS_LOW);
    }

    /// DEMO -> USDC (thin direct pool)
    function _pathDemoDirect() internal view returns (UniswapCheckout.Hop[] memory path) {
        path = new UniswapCheckout.Hop[](1);
        path[0] = _hop(address(demo), FEE_MID, TS_MID);
    }

    function _newInvoice(uint256 amount) internal returns (uint256 id) {
        vm.prank(merchant);
        id = checkout.createInvoice(address(usdc), amount, uint64(block.timestamp + 1 hours), keccak256("order-1"));
    }

    function _fundPayer(MockERC20 token, uint256 amount) internal {
        token.mint(payer, amount);
        vm.prank(payer);
        token.approve(address(checkout), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Pool creation
    // ------------------------------------------------------------------

    /// @dev Creates a hook-free pool where `amountA` of tokenA is worth `amountB` of tokenB,
    ///      and adds exactly that much full-range liquidity.
    function _addPool(address tokenA, uint256 amountA, address tokenB, uint256 amountB, uint24 fee, int24 tickSpacing)
        internal
    {
        (address t0, uint256 a0, address t1, uint256 a1) =
            tokenA < tokenB ? (tokenA, amountA, tokenB, amountB) : (tokenB, amountB, tokenA, amountA);

        PoolKey memory key = PoolKey(Currency.wrap(t0), Currency.wrap(t1), fee, tickSpacing, IHooks(address(0)));
        // price = token1 per token0 in raw units; sqrtPriceX96 = sqrt(price) * 2^96
        uint160 sqrtPriceX96 = uint160(Math.sqrt(FullMath.mulDiv(a1, 1 << 192, a0)));
        manager.initialize(key, sqrtPriceX96);

        int24 lower = TickMath.minUsableTick(tickSpacing);
        int24 upper = TickMath.maxUsableTick(tickSpacing);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), a0, a1
        );

        MockERC20(t0).mint(address(this), a0 * 2);
        MockERC20(t1).mint(address(this), a1 * 2);
        MockERC20(t0).approve(address(modifyLiquidityRouter), type(uint256).max);
        MockERC20(t1).approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), bytes32(0)), ""
        );
    }
}
