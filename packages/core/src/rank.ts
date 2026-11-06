import { erc20Abi, formatUnits, type Address, type PublicClient } from "viem";
import { checkoutCoreAbi } from "./abi.ts";
import type { ChainConfig } from "./config.ts";
import { candidatePaths, describePath, type Hop } from "./paths.ts";
import type { Quoter } from "./quoter.ts";
import type { TradingApiQuote } from "./tradingApi.ts";

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

/** One row of the ranking panel. */
export interface RankedRoute {
  source: "direct" | "v4-quoter" | "uniswap-api";
  token: TokenInfo;
  hops: Hop[]; // [] = pay in the settle token directly
  label: string;
  amountIn: bigint; // what the swap needs right now
  maxAmountIn: bigint; // amountIn + slippage buffer; the payer approves this and never pays more
  balance: bigint;
  gasUnits: bigint;
  gasUsd: number;
  inputUsd: number; // value of amountIn at the token's small-trade price
  overpayUsd: number; // inputUsd - invoice value = fees + price impact
  totalCostUsd: number; // inputUsd + gasUsd: what the ranking sorts by
  affordable: boolean; // balance >= maxAmountIn
  executable: boolean; // our contract can run this route (hook-free v4 pools, or direct)
  note?: string;
}

export interface RankResult {
  invoice: { id: bigint; amount: bigint; settleToken: TokenInfo; merchant: Address; expiry: bigint };
  routes: RankedRoute[]; // cheapest first
  recommended?: RankedRoute; // cheapest route that is both affordable and executable
  usdPerToken: Record<string, number>;
  gasPriceWei: bigint;
  ethUsd: number;
}

/** Gas our contract uses, measured with `forge test --gas-report` (payWithToken: ~200k 1 hop, ~250k 2 hops). */
export const GAS = { direct: 70_000n, swapBase: 150_000n, perHop: 50_000n } as const;
export const gasForHops = (hops: number) => (hops === 0 ? GAS.direct : GAS.swapBase + GAS.perHop * BigInt(hops));

export const withSlippage = (amount: bigint, bps: number) => (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n;

const Status = ["None", "Open", "Paid", "Cancelled"] as const;

export class RankError extends Error {}

/**
 * Ranks every way the payer could pay invoice `invoiceId` right now.
 *  1. read the invoice
 *  2. scan the payer's balances (one multicall)
 *  3. quote every candidate route for every token they hold (v4 Quoter, plus the Trading API if a key is set)
 *  4. convert to USD, add gas, sort by total cost, pick the cheapest one that's affordable and executable
 */
export async function rankRoutes(args: {
  client: PublicClient;
  cfg: ChainConfig;
  invoiceId: bigint;
  payer: Address;
  quoter?: Quoter; // required on chains with swaps
  tradingApi?: (tokenIn: Address, amountOut: bigint) => Promise<TradingApiQuote | null>;
  slippageBps?: number;
  now?: bigint;
}): Promise<RankResult> {
  const { client, cfg, payer } = args;
  const slippageBps = args.slippageBps ?? 50; // 0.5%
  if (!cfg.checkout) throw new RankError(`no checkout contract configured for ${cfg.key}`);

  // 1. invoice
  const inv = await client.readContract({
    address: cfg.checkout,
    abi: checkoutCoreAbi,
    functionName: "getInvoice",
    args: [args.invoiceId],
  });
  const now = args.now ?? BigInt(Math.floor(Date.now() / 1000));
  if (Status[inv.status] !== "Open") throw new RankError(`invoice is ${Status[inv.status]}, not Open`);
  if (now > inv.expiry) throw new RankError("invoice has expired");

  const settle: TokenInfo = cfg.settleToken;
  const invoiceUsd = Number(formatUnits(inv.amount, settle.decimals)); // stablecoin: 1 unit = $1
  const tokens: TokenInfo[] = [settle];
  if (cfg.swaps) tokens.push({ address: cfg.swaps.weth, symbol: "WETH", decimals: 18 }, ...cfg.swaps.extraTokens);

  // 2. balances: one batched call through Multicall3; if a chain has none, read them one by one
  const reads = tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [payer] }) as const);
  const balances = await client
    .multicall({ contracts: reads, allowFailure: false })
    .catch(() => Promise.all(reads.map((r) => client.readContract(r))));
  const balanceOf = new Map(tokens.map((t, i) => [t.address.toLowerCase(), balances[i] as bigint]));
  const symbolOf = (a: Address) => tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 6);

  const gasPriceWei = await client.getGasPrice();
  const usdPerToken: Record<string, number> = { [settle.address.toLowerCase()]: 1 };
  const routes: RankedRoute[] = [];

  // Pay directly in the settle token (no swap).
  routes.push(
    makeRoute({ source: "direct", token: settle, hops: [], amountIn: inv.amount, balance: balanceOf.get(settle.address.toLowerCase())!, slippageBps: 0, label: `${settle.symbol} (no swap)` }),
  );

  // 3. swap routes for every other token the payer holds
  if (cfg.swaps && args.quoter) {
    const quoter = args.quoter;
    // Market price of each token: quote a tiny trade (0.01 of the settle token: ~no price impact) on its
    // best route, then remove the pool fees. v4 takes the fee from the input, so the input is inflated by
    // 1/(1 - fee) per hop. Without this, the "overpay" column would hide the fees.
    const probe = 10n ** BigInt(Math.max(settle.decimals - 2, 0));
    const priceOf = async (t: TokenInfo, best: Hop[]) => {
      const q = await quoter.exactOut(best, settle.address, probe);
      if (!q || q.amountIn === 0n) return undefined;
      const feeFactor = best.reduce((f, h) => f * (1 - h.fee / 1_000_000), 1);
      return Number(formatUnits(probe, settle.decimals)) / (Number(formatUnits(q.amountIn, t.decimals)) * feeFactor);
    };

    for (const t of tokens.slice(1)) {
      const balance = balanceOf.get(t.address.toLowerCase()) ?? 0n;
      const isWeth = t.address.toLowerCase() === cfg.swaps.weth.toLowerCase();
      if (balance === 0n && !isWeth) continue; // nothing to pay with, and no price needed
      const paths = candidatePaths(t.address, settle.address, cfg.swaps.weth, cfg.swaps.pools);
      const quotes = await Promise.all(paths.map((p) => quoter.exactOut(p, settle.address, inv.amount)));
      const found = paths.flatMap((p, i) => (quotes[i] ? [{ hops: p, amountIn: quotes[i]!.amountIn }] : []));
      if (found.length) {
        const best = found.reduce((a, b) => (b.amountIn < a.amountIn ? b : a));
        const price = await priceOf(t, best.hops);
        if (price !== undefined) usdPerToken[t.address.toLowerCase()] = price;
      }
      // Only show routes for tokens the payer actually holds; still price WETH for gas maths.
      if (balance === 0n) continue;
      for (const f of found) {
        routes.push(makeRoute({ source: "v4-quoter", token: t, hops: f.hops, amountIn: f.amountIn, balance, slippageBps, label: describePath(f.hops, settle.symbol, symbolOf) }));
      }
      if (args.tradingApi) {
        const api = await args.tradingApi(t.address, inv.amount).catch(() => null);
        if (api) {
          routes.push(
            makeRoute({
              source: "uniswap-api",
              token: t,
              hops: api.hops ?? [],
              amountIn: api.amountIn,
              balance,
              slippageBps,
              label: api.hops ? describePath(api.hops, settle.symbol, symbolOf) : `${t.symbol} via ${api.protocols}`,
              executable: api.hops !== null,
              note: api.hops ? undefined : "route uses pools our contract can't execute (v3 / hooks / split)",
            }),
          );
        }
      }
    }
  }

  // 4. USD values, gas, ranking
  const ethUsd = cfg.swaps ? (usdPerToken[cfg.swaps.weth.toLowerCase()] ?? 0) : 0;
  for (const r of routes) {
    const price = usdPerToken[r.token.address.toLowerCase()];
    r.inputUsd = price !== undefined ? Number(formatUnits(r.amountIn, r.token.decimals)) * price : NaN;
    r.overpayUsd = r.inputUsd - invoiceUsd;
    r.gasUsd = Number(formatUnits(r.gasUnits * gasPriceWei, 18)) * ethUsd;
    r.totalCostUsd = r.inputUsd + r.gasUsd;
    if (Number.isNaN(r.inputUsd)) r.note = r.note ?? "no price for this token";
  }
  routes.sort((a, b) => (Number.isNaN(a.totalCostUsd) ? 1 : Number.isNaN(b.totalCostUsd) ? -1 : a.totalCostUsd - b.totalCostUsd));
  const recommended = routes.find((r) => r.affordable && r.executable && !Number.isNaN(r.totalCostUsd));

  return {
    invoice: { id: args.invoiceId, amount: inv.amount, settleToken: settle, merchant: inv.merchant, expiry: inv.expiry },
    routes,
    recommended,
    usdPerToken,
    gasPriceWei,
    ethUsd,
  };
}

function makeRoute(a: {
  source: RankedRoute["source"];
  token: TokenInfo;
  hops: Hop[];
  amountIn: bigint;
  balance: bigint;
  slippageBps: number;
  label: string;
  executable?: boolean;
  note?: string;
}): RankedRoute {
  const maxAmountIn = withSlippage(a.amountIn, a.slippageBps);
  return {
    source: a.source,
    token: a.token,
    hops: a.hops,
    label: a.label,
    amountIn: a.amountIn,
    maxAmountIn,
    balance: a.balance,
    gasUnits: gasForHops(a.hops.length),
    gasUsd: 0,
    inputUsd: 0,
    overpayUsd: 0,
    totalCostUsd: 0,
    affordable: a.balance >= maxAmountIn,
    executable: a.executable ?? true,
    note: a.note,
  };
}
