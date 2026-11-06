import type { Address, PublicClient } from "viem";
import { toExactInPathKeys, toExactOutPathKeys, type Hop } from "./paths.ts";

/**
 * Uniswap v4 Quoter (v4-periphery). Its functions simulate a swap and return the result WITHOUT
 * swapping (internally they revert and decode the revert). They're not `view`, so we call them with
 * `simulateContract` (an eth_call). We never send them as transactions.
 * Signatures checked against the live Quoter on Unichain Sepolia (0x56DC…4472) on Nov 4.
 */
const pathKeyComponents = [
  { name: "intermediateCurrency", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
  { name: "hookData", type: "bytes" },
] as const;

export const v4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactOutput",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "exactCurrency", type: "address" },
          { name: "path", type: "tuple[]", components: pathKeyComponents },
          { name: "exactAmount", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "exactCurrency", type: "address" },
          { name: "path", type: "tuple[]", components: pathKeyComponents },
          { name: "exactAmount", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** Anything that can quote a route. The real one calls the Quoter; tests pass a fake. */
export interface Quoter {
  /** How much of hops[0].tokenIn buys exactly `amountOut` of `settle`? null if the route doesn't exist. */
  exactOut(hops: Hop[], settle: Address, amountOut: bigint): Promise<{ amountIn: bigint; gas: bigint } | null>;
  /** How much `settle` does exactly `amountIn` of hops[0].tokenIn buy? null if the route doesn't exist. */
  exactIn(hops: Hop[], settle: Address, amountIn: bigint): Promise<{ amountOut: bigint; gas: bigint } | null>;
}

export function onchainQuoter(client: PublicClient, quoter: Address): Quoter {
  return {
    async exactOut(hops, settle, amountOut) {
      try {
        const { result } = await client.simulateContract({
          address: quoter,
          abi: v4QuoterAbi,
          functionName: "quoteExactOutput",
          args: [{ exactCurrency: settle, path: toExactOutPathKeys(hops), exactAmount: amountOut }],
        });
        return { amountIn: result[0], gas: result[1] };
      } catch {
        return null; // pool missing, not enough liquidity, ...
      }
    },
    async exactIn(hops, settle, amountIn) {
      try {
        const { result } = await client.simulateContract({
          address: quoter,
          abi: v4QuoterAbi,
          functionName: "quoteExactInput",
          args: [{ exactCurrency: hops[0]!.tokenIn, path: toExactInPathKeys(hops, settle), exactAmount: amountIn }],
        });
        return { amountOut: result[0], gas: result[1] };
      } catch {
        return null;
      }
    },
  };
}
