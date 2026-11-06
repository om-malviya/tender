import type { Address } from "viem";
import type { Hop } from "./paths.ts";
import type { Quoter } from "./quoter.ts";

/** Matches UniswapCheckout.sol's `Leg` struct. */
export interface BasketLeg {
  tokenIn: Address;
  amountIn: bigint;
  path: Hop[]; // [] for the settle token itself
  minOut: bigint;
}

export interface Holding {
  token: Address;
  balance: bigint;
  /** Best route to the settle token (from rankRoutes). */
  hops: Hop[];
  /** Lower = cheaper way to pay (e.g. totalCostUsd / invoiceUsd from the ranking). */
  costRatio: number;
}

/**
 * Builds a basket payment when no single token covers the invoice.
 * Greedy: spend the settle token first (no swap), then the cheapest tokens, until the invoice is covered.
 * Each swapped leg gets a `minOut` (what it must deliver even after slippage); the legs' minOuts plus the
 * direct leg add up to at least the invoice, so the on-chain `Underpaid` check can't trip.
 *
 * Legs run one after another in ONE transaction, so two legs can share a pool (DEMO->WETH->USDC and
 * WETH->USDC both end in WETH/USDC): the first moves its price before the second trades. Quoting each leg on
 * its own over-promises the later one (the contract then reverts with LegBelowMin). So legs are quoted hop by
 * hop against what earlier legs already pushed into each pool: see marginalOut.
 */
export async function buildBasket(args: {
  quoter: Quoter;
  settle: Address;
  invoiceAmount: bigint;
  settleBalance: bigint;
  holdings: Holding[];
  slippageBps?: number;
  maxLegs?: number;
}): Promise<{ legs: BasketLeg[]; guaranteedOut: bigint; covers: boolean }> {
  const bps = BigInt(args.slippageBps ?? 50);
  const maxLegs = args.maxLegs ?? 4;
  const legs: BasketLeg[] = [];
  const used: PoolUse = new Map();
  const afterSlippage = (x: bigint) => (x * (10_000n - bps)) / 10_000n;
  let remaining = args.invoiceAmount; // still needed, in guaranteed settle-token units

  if (args.settleBalance > 0n) {
    const use = args.settleBalance < remaining ? args.settleBalance : remaining;
    legs.push({ tokenIn: args.settle, amountIn: use, path: [], minOut: 0n });
    remaining -= use;
  }

  const ordered = [...args.holdings].filter((h) => h.balance > 0n).sort((a, b) => a.costRatio - b.costRatio);
  for (const h of ordered) {
    if (remaining === 0n || legs.length >= maxLegs) break;

    // Can this token alone cover the rest (with a slippage buffer on top)? The exact-output quote ignores
    // earlier legs, so check it against them and scale the input up if a shared pool now pays less.
    const buffered = (remaining * (10_000n + bps) + 9_999n) / 10_000n;
    const need = await args.quoter.exactOut(h.hops, args.settle, buffered);
    let covered = false;
    for (let amountIn = need?.amountIn ?? 0n, tries = 0; need && amountIn > 0n && amountIn <= h.balance && tries < 4; tries++) {
      const m = await marginalOut(args.quoter, h.hops, args.settle, amountIn, used);
      if (!m) break;
      if (afterSlippage(m.out) >= remaining) {
        legs.push({ tokenIn: h.token, amountIn, path: h.hops, minOut: remaining });
        m.commit();
        remaining = 0n;
        covered = true;
        break;
      }
      amountIn = (amountIn * remaining) / (afterSlippage(m.out) || 1n) + amountIn / 1_000n + 1n; // proportional top-up + 0.1%
    }
    if (covered) break;

    // Otherwise spend all of it and count only what's guaranteed after slippage.
    const m = await marginalOut(args.quoter, h.hops, args.settle, h.balance, used);
    if (!m || m.out === 0n) continue;
    const minOut = afterSlippage(m.out);
    legs.push({ tokenIn: h.token, amountIn: h.balance, path: h.hops, minOut });
    m.commit();
    remaining = minOut >= remaining ? 0n : remaining - minOut;
  }

  const direct = legs.find((l) => l.path.length === 0)?.amountIn ?? 0n;
  const guaranteedOut = direct + legs.reduce((s, l) => s + l.minOut, 0n);
  return { legs, guaranteedOut, covers: remaining === 0n };
}

/** Input each pool has already absorbed from earlier legs, keyed by direction (tokenIn>tokenOut@fee/spacing).
 *  Every basket leg flows toward the settle token, so a pool is only ever crossed in one direction. */
type PoolUse = Map<string, bigint>;
const poolId = (h: Hop, out: Address) => `${h.tokenIn.toLowerCase()}>${out.toLowerCase()}@${h.fee}/${h.tickSpacing}`;

/**
 * What `amountIn` delivers along `hops` AFTER the earlier legs: quoted hop by hop, each hop's output is the
 * pool's marginal output, quote(already in + mine) - quote(already in). `commit()` records this leg's flow.
 */
async function marginalOut(quoter: Quoter, hops: Hop[], settle: Address, amountIn: bigint, used: PoolUse) {
  let amt = amountIn;
  const flows: [string, bigint][] = [];
  for (let i = 0; i < hops.length; i++) {
    const out = hops[i + 1]?.tokenIn ?? settle;
    const id = poolId(hops[i]!, out);
    const prior = used.get(id) ?? 0n;
    const total = await quoter.exactIn([hops[i]!], out, prior + amt);
    if (!total) return null;
    let got = total.amountOut;
    if (prior > 0n) {
      const before = await quoter.exactIn([hops[i]!], out, prior);
      if (!before) return null;
      got -= before.amountOut + 1n; // two rounded quotes can overshoot a real sequential swap by one unit: round down
    }
    flows.push([id, prior + amt]);
    amt = got;
  }
  return { out: amt, commit: () => flows.forEach(([id, total]) => used.set(id, total)) };
}
