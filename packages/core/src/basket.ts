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
  let remaining = args.invoiceAmount; // still needed, in guaranteed settle-token units

  if (args.settleBalance > 0n) {
    const use = args.settleBalance < remaining ? args.settleBalance : remaining;
    legs.push({ tokenIn: args.settle, amountIn: use, path: [], minOut: 0n });
    remaining -= use;
  }

  const ordered = [...args.holdings].filter((h) => h.balance > 0n).sort((a, b) => a.costRatio - b.costRatio);
  for (const h of ordered) {
    if (remaining === 0n || legs.length >= maxLegs) break;

    // Can this token alone cover the rest (with a slippage buffer on top)?
    const buffered = (remaining * (10_000n + bps) + 9_999n) / 10_000n;
    const need = await args.quoter.exactOut(h.hops, args.settle, buffered);
    if (need && need.amountIn <= h.balance) {
      legs.push({ tokenIn: h.token, amountIn: need.amountIn, path: h.hops, minOut: remaining });
      remaining = 0n;
      break;
    }

    // Otherwise spend all of it and count only what's guaranteed after slippage.
    const out = await args.quoter.exactIn(h.hops, args.settle, h.balance);
    if (!out || out.amountOut === 0n) continue;
    const minOut = (out.amountOut * (10_000n - bps)) / 10_000n;
    legs.push({ tokenIn: h.token, amountIn: h.balance, path: h.hops, minOut });
    remaining = minOut >= remaining ? 0n : remaining - minOut;
  }

  const direct = legs.find((l) => l.path.length === 0)?.amountIn ?? 0n;
  const guaranteedOut = direct + legs.reduce((s, l) => s + l.minOut, 0n);
  return { legs, guaranteedOut, covers: remaining === 0n };
}
