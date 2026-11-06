import { encodeAbiParameters, type Address, type Hex } from "viem";
import type { HookRoute } from "./rank.ts";

/** v4 price limits meaning "no limit": protection comes from amounts, not from a price bound. */
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/**
 * Uniswap's PoolSwapTest: a plain v4 router with no Tender code in it, deployed by Uniswap on every v4
 * testnet. It pulls the input from msg.sender, swaps, pays out the output, and forwards hookData untouched.
 * We use it to prove the CheckoutHook works with ANY router.
 */
export const poolSwapTestAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;

/** hookData the CheckoutHook expects: (invoiceId, payer). The payer is who refunds go to. */
export const encodeHookData = (invoiceId: bigint, payer: Address): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [invoiceId, payer]);

/** Arguments for `router.swap(...)` that pay `invoiceId` by sending exactly `amountIn` through the hooked pool. */
export function hookSwapArgs(route: HookRoute, amountIn: bigint, invoiceId: bigint, payer: Address) {
  return [
    route.pool,
    {
      zeroForOne: route.zeroForOne,
      amountSpecified: -amountIn, // negative = exact input
      sqrtPriceLimitX96: route.zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n,
    },
    { takeClaims: false, settleUsingBurn: false },
    encodeHookData(invoiceId, payer),
  ] as const;
}
