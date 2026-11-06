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

/**
 * Quotes against the on-chain v4 Quoter. Calls made in the same tick are BATCHED into one Multicall3
 * round-trip (the ranker fires ~12 quotes per token at once), so the ranking panel costs one RPC call
 * per token instead of twelve. If Multicall3 isn't available the batch falls back to individual calls.
 */
export function onchainQuoter(client: PublicClient, quoter: Address): Quoter {
  type Req = { fn: "quoteExactOutput" | "quoteExactInput"; args: readonly [{ exactCurrency: Address; path: ReturnType<typeof toExactOutPathKeys>; exactAmount: bigint }]; resolve: (r: { a: bigint; gas: bigint } | null) => void };
  let pending: Req[] = [];

  const single = async (r: Req) => {
    try {
      const { result } = await client.simulateContract({ address: quoter, abi: v4QuoterAbi, functionName: r.fn, args: r.args as never });
      return { a: result[0], gas: result[1] };
    } catch {
      return null; // pool missing, not enough liquidity, ...
    }
  };

  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length === 1) return batch[0]!.resolve(await single(batch[0]!));
    try {
      const results = await client.multicall({
        contracts: batch.map((r) => ({ address: quoter, abi: v4QuoterAbi, functionName: r.fn, args: r.args }) as never),
        allowFailure: true,
      });
      batch.forEach((r, i) => {
        const res = results[i] as { status: "success" | "failure"; result?: readonly [bigint, bigint] };
        r.resolve(res.status === "success" && res.result ? { a: res.result[0], gas: res.result[1] } : null);
      });
    } catch {
      await Promise.all(batch.map(async (r) => r.resolve(await single(r)))); // no Multicall3: one by one
    }
  };

  const enqueue = (fn: Req["fn"], args: Req["args"]) =>
    new Promise<{ a: bigint; gas: bigint } | null>((resolve) => {
      if (pending.length === 0) queueMicrotask(flush);
      pending.push({ fn, args, resolve });
    });

  return {
    async exactOut(hops, settle, amountOut) {
      const r = await enqueue("quoteExactOutput", [{ exactCurrency: settle, path: toExactOutPathKeys(hops), exactAmount: amountOut }]);
      return r && { amountIn: r.a, gas: r.gas };
    },
    async exactIn(hops, settle, amountIn) {
      const r = await enqueue("quoteExactInput", [{ exactCurrency: hops[0]!.tokenIn, path: toExactInPathKeys(hops, settle), exactAmount: amountIn }]);
      return r && { amountOut: r.a, gas: r.gas };
    },
  };
}
