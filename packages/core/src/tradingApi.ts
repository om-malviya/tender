import { zeroAddress, type Address } from "viem";
import type { Hop } from "./paths.ts";

export const TRADING_API_URL = "https://trade-api.gateway.uniswap.org/v1";

/** What we keep from a Uniswap Trading API quote. */
export interface TradingApiQuote {
  amountIn: bigint;
  /** Our contract can only execute routes made entirely of hook-free v4 pools; otherwise null. */
  hops: Hop[] | null;
  /** e.g. "v4 > v4" or "v3": shown in the panel for routes we can't execute. */
  protocols: string;
  gasUseEstimate?: bigint;
  gasFeeUsd?: number;
  priceImpactPct?: number;
}

type Pool = {
  type?: string;
  tokenIn?: { address?: string };
  tokenOut?: { address?: string };
  fee?: string | number;
  tickSpacing?: string | number;
  hooks?: string;
};

/**
 * Turns the API's JSON into a TradingApiQuote. Written defensively: the API docs don't fully specify
 * the response shape, so every field is optional and anything unexpected returns null.
 * [CHECK on the first real response with our API key: field names route/input/gasUseEstimate.]
 */
export function parseTradingApiQuote(json: unknown): TradingApiQuote | null {
  const q = (json as { quote?: Record<string, unknown> })?.quote;
  if (!q) return null;
  const amount = (q.input as { amount?: string } | undefined)?.amount;
  if (!amount) return null;

  // `route` is an array of split routes, each an array of pools. We only accept a single, unsplit route.
  const route = q.route as Pool[][] | undefined;
  let hops: Hop[] | null = null;
  let protocols = "unknown";
  if (Array.isArray(route) && route.length === 1 && Array.isArray(route[0])) {
    const pools = route[0];
    protocols = pools.map((p) => (p.type ?? "?").replace("-pool", "")).join(" > ");
    const allPlainV4 = pools.every(
      (p) => p.type === "v4-pool" && (!p.hooks || p.hooks.toLowerCase() === zeroAddress) && p.tokenIn?.address,
    );
    if (allPlainV4) {
      hops = pools.map((p) => ({
        tokenIn: p.tokenIn!.address as Address,
        fee: Number(p.fee),
        tickSpacing: Number(p.tickSpacing),
      }));
    }
  } else if (Array.isArray(route)) {
    protocols = `split across ${route.length} routes`;
  }

  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  return {
    amountIn: BigInt(amount),
    hops,
    protocols,
    gasUseEstimate: q.gasUseEstimate !== undefined ? BigInt(q.gasUseEstimate as string) : undefined,
    gasFeeUsd: num(q.gasFeeUSD),
    priceImpactPct: num(q.priceImpact),
  };
}

/** Asks the Uniswap Trading API for the best route that delivers exactly `amountOut` of tokenOut. */
export async function quoteViaTradingApi(args: {
  apiKey: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountOut: bigint;
  swapper: Address;
  fetchImpl?: typeof fetch;
}): Promise<TradingApiQuote | null> {
  const res = await (args.fetchImpl ?? fetch)(`${TRADING_API_URL}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-api-key": args.apiKey },
    body: JSON.stringify({
      type: "EXACT_OUTPUT",
      amount: args.amountOut.toString(),
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      tokenInChainId: args.chainId,
      tokenOutChainId: args.chainId,
      swapper: args.swapper,
      protocols: ["V4", "V3"],
    }),
  });
  if (!res.ok) return null; // 404 = no route; 429 = rate limited; we simply fall back to the Quoter
  return parseTradingApiQuote(await res.json());
}
