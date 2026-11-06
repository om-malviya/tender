import { erc20Abi, formatUnits, type Address, type PublicClient } from "viem";
import { checkoutCoreAbi } from "./abi.ts";
import type { ChainConfig } from "./config.ts";
import { candidatePaths, describePath, hookedPaths, type Hop } from "./paths.ts";
import type { Quoter } from "./quoter.ts";
import type { TradingApiQuote } from "./tradingApi.ts";

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

/** One leg of a split route: part of the invoice bought through one path. Executed via payWithBasket. */
export interface SplitLeg {
  hops: Hop[];
  amountIn: bigint; // exact input the leg spends (quote + buffer)
  minOut: bigint; // the share of the invoice this leg must deliver
}

/** For "v4-hook" routes: everything a generic v4 router needs to pay the invoice by swapping. */
export interface HookRoute {
  router: Address; // a plain v4 router (Uniswap's PoolSwapTest) that forwards hookData
  pool: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  zeroForOne: boolean;
}

/** One row of the ranking panel. */
export interface RankedRoute {
  source: "direct" | "v4-quoter" | "uniswap-api" | "v4-hook" | "split";
  token: TokenInfo;
  hops: Hop[]; // [] = pay in the settle token directly; for "split" see `split`
  label: string;
  amountIn: bigint; // what the swap needs right now
  maxAmountIn: bigint; // amountIn + buffer; the payer approves this and never pays more
  slippageBps: number; // the buffer used (sized from measured price impact unless fixed by the caller)
  impactBps: number; // measured price impact of this route (0 for direct)
  balance: bigint;
  gasUnits: bigint;
  gasUsd: number;
  inputUsd: number; // value of amountIn at the token's small-trade price
  overpayUsd: number; // inputUsd - invoice value = fees + price impact
  totalCostUsd: number; // inputUsd + gasUsd: what the ranking sorts by
  affordable: boolean; // balance >= maxAmountIn
  executable: boolean; // we know how to run this route (contract, basket or generic router)
  split?: SplitLeg[];
  hook?: HookRoute;
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

/** Gas measured with `forge test --gas-report`: payWithToken ~200k (1 hop) / ~250k (2 hops), basket ~130k/leg, hook swap ~180k. */
export const GAS = { direct: 70_000n, swapBase: 150_000n, perHop: 50_000n, basketBase: 120_000n, perLeg: 130_000n, hookSwap: 180_000n } as const;
export const gasForHops = (hops: number) => (hops === 0 ? GAS.direct : GAS.swapBase + GAS.perHop * BigInt(hops));

export const withSlippage = (amount: bigint, bps: number) => (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n;

/**
 * Slippage buffer sized from the route's measured price impact: a thin pool that already moved 2% for our
 * trade will move more between quote and execution than a deep one. Floor 0.25%, cap 3%.
 */
export const bufferForImpact = (impactBps: number) => Math.min(300, Math.max(25, Math.round(25 + impactBps / 2)));

const SPLITS = [0.25, 0.5, 0.75]; // share of the invoice bought on route A; the rest on route B

const Status = ["None", "Open", "Paid", "Cancelled"] as const;

export class RankError extends Error {}

/**
 * Ranks every way the payer could pay invoice `invoiceId` right now.
 *  1. read the invoice
 *  2. scan the payer's balances (one multicall)
 *  3. quote every candidate route for every token they hold: plain v4 pools (our contract), hooked pools
 *     (any router), the Trading API if a key is set, and split routes across two plain paths
 *  4. convert to USD, add gas, size each route's slippage buffer from its impact, sort by total cost
 */
export async function rankRoutes(args: {
  client: PublicClient;
  cfg: ChainConfig;
  invoiceId: bigint;
  payer: Address;
  quoter?: Quoter; // required on chains with swaps
  tradingApi?: (tokenIn: Address, amountOut: bigint) => Promise<TradingApiQuote | null>;
  /** fixed buffer in bps; when omitted each route gets an impact-based buffer (see bufferForImpact) */
  slippageBps?: number;
  now?: bigint;
}): Promise<RankResult> {
  const { client, cfg, payer } = args;
  if (!cfg.checkout) throw new RankError(`no checkout contract configured for ${cfg.key}`);

  // 1. invoice
  const inv = await client.readContract({ address: cfg.checkout, abi: checkoutCoreAbi, functionName: "getInvoice", args: [args.invoiceId] });
  const now = args.now ?? BigInt(Math.floor(Date.now() / 1000));
  if (Status[inv.status] !== "Open") throw new RankError(`invoice is ${Status[inv.status]}, not Open`);
  if (now > inv.expiry) throw new RankError("invoice has expired");

  const settle: TokenInfo = cfg.settleToken;
  const invoiceUsd = Number(formatUnits(inv.amount, settle.decimals)); // stablecoin: 1 unit = $1
  const tokens: TokenInfo[] = [settle];
  if (cfg.swaps) tokens.push({ address: cfg.swaps.weth, symbol: "WETH", decimals: 18 }, ...cfg.swaps.extraTokens);

  // 2. balances: one batched call through Multicall3; if a chain has none, read them one by one
  const reads = tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [payer] }) as const);
  const balances = await client.multicall({ contracts: reads, allowFailure: false }).catch(() => Promise.all(reads.map((r) => client.readContract(r))));
  const balanceOf = new Map(tokens.map((t, i) => [t.address.toLowerCase(), balances[i] as bigint]));
  const symbolOf = (a: Address) => tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 6);

  const gasPriceWei = await client.getGasPrice();
  const usdPerToken: Record<string, number> = { [settle.address.toLowerCase()]: 1 };
  const routes: RankedRoute[] = [];

  // Pay directly in the settle token (no swap).
  routes.push(makeRoute({ source: "direct", token: settle, hops: [], amountIn: inv.amount, balance: balanceOf.get(settle.address.toLowerCase())!, label: `${settle.symbol} (no swap)` }));

  // 3. swap routes for every other token the payer holds
  if (cfg.swaps && args.quoter) {
    const quoter = args.quoter;
    const swaps = cfg.swaps;
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
      const isWeth = t.address.toLowerCase() === swaps.weth.toLowerCase();
      if (balance === 0n && !isWeth) continue; // nothing to pay with, and no price needed
      const paths = candidatePaths(t.address, settle.address, swaps.weth, swaps.pools);
      const quotes = await Promise.all(paths.map((p) => quoter.exactOut(p, settle.address, inv.amount)));
      const found = paths.flatMap((p, i) => (quotes[i] ? [{ hops: p, amountIn: quotes[i]!.amountIn }] : []));
      if (found.length) {
        const best = found.reduce((a, b) => (b.amountIn < a.amountIn ? b : a));
        const price = await priceOf(t, best.hops);
        if (price !== undefined) usdPerToken[t.address.toLowerCase()] = price;
      }
      if (balance === 0n) continue;

      for (const f of found) {
        routes.push(makeRoute({ source: "v4-quoter", token: t, hops: f.hops, amountIn: f.amountIn, balance, label: describePath(f.hops, settle.symbol, symbolOf) }));
      }

      // Hooked pools: the pool itself settles the invoice, so ANY router can pay it. Exact-input swap:
      // the payer sends amountIn (+ buffer); the hook takes exactly the invoice and the rest comes back.
      if (swaps.hook && swaps.swapRouter) {
        for (const p of hookedPaths(t.address, settle.address, swaps.pools)) {
          const q = await quoter.exactOut(p, settle.address, inv.amount);
          if (!q) continue;
          const hop = p[0]!;
          const zeroForOne = t.address.toLowerCase() < settle.address.toLowerCase();
          routes.push(
            makeRoute({
              source: "v4-hook",
              token: t,
              hops: p,
              amountIn: q.amountIn,
              balance,
              label: `${describePath(p, settle.symbol, symbolOf)} · hooked pool`,
              gasUnits: GAS.hookSwap,
              hook: {
                router: swaps.swapRouter,
                pool: {
                  currency0: zeroForOne ? t.address : settle.address,
                  currency1: zeroForOne ? settle.address : t.address,
                  fee: hop.fee,
                  tickSpacing: hop.tickSpacing,
                  hooks: hop.hooks!,
                },
                zeroForOne,
              },
            }),
          );
        }
      }

      // Split routing: buy part of the invoice on each of the two best plain paths. Worth it when the
      // cheapest pool is thin: price impact grows with size, so two smaller trades can cost less in total.
      if (found.length >= 2) {
        const [a, b] = [...found].sort((x, y) => (x.amountIn < y.amountIn ? -1 : 1));
        let bestSplit: { legs: SplitLeg[]; amountIn: bigint; share: number } | undefined;
        for (const share of SPLITS) {
          const outA = (inv.amount * BigInt(Math.round(share * 10_000))) / 10_000n;
          const outB = inv.amount - outA;
          const [qa, qb] = await Promise.all([quoter.exactOut(a!.hops, settle.address, outA), quoter.exactOut(b!.hops, settle.address, outB)]);
          if (!qa || !qb) continue;
          const total = qa.amountIn + qb.amountIn;
          if (!bestSplit || total < bestSplit.amountIn) {
            bestSplit = {
              share,
              amountIn: total,
              legs: [
                { hops: a!.hops, amountIn: qa.amountIn, minOut: outA },
                { hops: b!.hops, amountIn: qb.amountIn, minOut: outB },
              ],
            };
          }
        }
        // only show a split when it beats the best single route by more than rounding noise (0.05%)
        if (bestSplit && bestSplit.amountIn * 10_005n < a!.amountIn * 10_000n) {
          const pct = Math.round(bestSplit.share * 100);
          routes.push(
            makeRoute({
              source: "split",
              token: t,
              hops: a!.hops,
              amountIn: bestSplit.amountIn,
              balance,
              label: `${t.symbol} split: ${pct}% ${describePath(a!.hops, settle.symbol, symbolOf)} + ${100 - pct}% ${describePath(b!.hops, settle.symbol, symbolOf)}`,
              gasUnits: GAS.basketBase + GAS.perLeg * 2n,
              split: bestSplit.legs,
            }),
          );
        }
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
              label: api.hops ? describePath(api.hops, settle.symbol, symbolOf) : `${t.symbol} via ${api.protocols}`,
              executable: api.hops !== null,
              note: api.hops ? undefined : "route uses pools our contract can't execute (v3 / hooks / split)",
            }),
          );
        }
      }
    }
  }

  // 4. USD values, impact, buffers, gas, ranking
  const ethUsd = cfg.swaps ? (usdPerToken[cfg.swaps.weth.toLowerCase()] ?? 0) : 0;
  for (const r of routes) {
    const price = usdPerToken[r.token.address.toLowerCase()];
    r.inputUsd = price !== undefined ? Number(formatUnits(r.amountIn, r.token.decimals)) * price : NaN;
    r.overpayUsd = r.inputUsd - invoiceUsd;
    // price impact = overpay beyond the pool fees, as bps of the invoice
    const feeBps = r.hops.reduce((f, h) => f + h.fee / 100, 0);
    r.impactBps = r.hops.length && !Number.isNaN(r.inputUsd) ? Math.max(0, (r.overpayUsd / invoiceUsd) * 10_000 - feeBps) : 0;
    r.slippageBps = r.hops.length === 0 ? 0 : (args.slippageBps ?? bufferForImpact(r.impactBps));
    r.maxAmountIn = withSlippage(r.amountIn, r.slippageBps);
    if (r.split) for (const leg of r.split) leg.amountIn = withSlippage(leg.amountIn, r.slippageBps);
    r.affordable = r.balance >= r.maxAmountIn;
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
  label: string;
  gasUnits?: bigint;
  executable?: boolean;
  split?: SplitLeg[];
  hook?: HookRoute;
  note?: string;
}): RankedRoute {
  return {
    source: a.source,
    token: a.token,
    hops: a.hops,
    label: a.label,
    amountIn: a.amountIn,
    maxAmountIn: a.amountIn, // finalised in step 4 once the impact is known
    slippageBps: 0,
    impactBps: 0,
    balance: a.balance,
    gasUnits: a.gasUnits ?? gasForHops(a.hops.length),
    gasUsd: 0,
    inputUsd: 0,
    overpayUsd: 0,
    totalCostUsd: 0,
    affordable: false,
    executable: a.executable ?? true,
    split: a.split,
    hook: a.hook,
    note: a.note,
  };
}
