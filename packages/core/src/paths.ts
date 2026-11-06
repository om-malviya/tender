import { zeroAddress, type Address } from "viem";
import { FEE_TIERS, type AllowedPool } from "./config.ts";

/** One pool on a route, exactly as UniswapCheckout.sol's `Hop` struct expects it. */
export interface Hop {
  tokenIn: Address;
  fee: number;
  tickSpacing: number;
  /** set only for hooked pools (CheckoutHook routes); UniswapCheckout.sol paths never carry it */
  hooks?: Address;
}

/** Uniswap's own route format, used by the v4 Quoter (and the Universal Router). */
export interface PathKey {
  intermediateCurrency: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  hookData: `0x${string}`;
}

/**
 * Every route we are willing to try from `tokenIn` to the settle token:
 *   - direct:  tokenIn -> settle            (one per fee tier)
 *   - via WETH: tokenIn -> WETH -> settle   (every fee-tier combination)
 * Pools that don't exist simply fail to quote and are dropped later.
 * If `allowed` is given, every hop must be one of those vetted pools.
 */
export function candidatePaths(tokenIn: Address, settle: Address, weth: Address, allowed?: AllowedPool[]): Hop[][] {
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  const plain = allowed?.filter((p) => !p.hooks || p.hooks === zeroAddress);
  const isAllowed = (path: Hop[]) =>
    !plain ||
    path.every((h, i) => {
      const out = path[i + 1]?.tokenIn ?? settle;
      return plain.some(
        (p) => p.fee === h.fee && p.tickSpacing === h.tickSpacing && ((same(p.a, h.tokenIn) && same(p.b, out)) || (same(p.b, h.tokenIn) && same(p.a, out))),
      );
    });
  return allPaths(tokenIn, weth, same).filter(isAllowed);
}

/** Single-hop routes through HOOKED pools (tokenIn -> settle with the CheckoutHook attached). */
export function hookedPaths(tokenIn: Address, settle: Address, allowed?: AllowedPool[]): Hop[][] {
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  return (allowed ?? [])
    .filter((p) => p.hooks && p.hooks !== zeroAddress && ((same(p.a, tokenIn) && same(p.b, settle)) || (same(p.b, tokenIn) && same(p.a, settle))))
    .map((p) => [{ tokenIn, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks }]);
}

function allPaths(tokenIn: Address, weth: Address, same: (a: Address, b: Address) => boolean): Hop[][] {
  const paths: Hop[][] = [];
  for (const t of FEE_TIERS) paths.push([{ tokenIn, fee: t.fee, tickSpacing: t.tickSpacing }]);
  if (!same(tokenIn, weth)) {
    for (const a of FEE_TIERS) {
      for (const b of FEE_TIERS) {
        paths.push([
          { tokenIn, fee: a.fee, tickSpacing: a.tickSpacing },
          { tokenIn: weth, fee: b.fee, tickSpacing: b.tickSpacing },
        ]);
      }
    }
  }
  return paths;
}

/**
 * Exact OUTPUT: the Quoter walks the path backwards from the output, and each PathKey's
 * `intermediateCurrency` is the INPUT of that hop. That's the same order as our Hop[], so it's a
 * field rename. (Checked against the live Quoter on Unichain Sepolia.)
 */
export function toExactOutPathKeys(hops: Hop[]): PathKey[] {
  return hops.map((h) => ({
    intermediateCurrency: h.tokenIn,
    fee: h.fee,
    tickSpacing: h.tickSpacing,
    hooks: h.hooks ?? zeroAddress, // empty hookData: the CheckoutHook does nothing during a quote
    hookData: "0x",
  }));
}

/**
 * Exact INPUT: the Quoter walks forward from the input, and each PathKey's `intermediateCurrency`
 * is the OUTPUT of that hop: the next hop's tokenIn, or the settle token for the last hop.
 */
export function toExactInPathKeys(hops: Hop[], settle: Address): PathKey[] {
  return hops.map((h, i) => ({
    intermediateCurrency: i + 1 < hops.length ? hops[i + 1]!.tokenIn : settle,
    fee: h.fee,
    tickSpacing: h.tickSpacing,
    hooks: h.hooks ?? zeroAddress,
    hookData: "0x",
  }));
}

/** Human-readable label like "DEMO -0.30%-> WETH -0.05%-> USDC". */
export function describePath(hops: Hop[], settleSymbol: string, symbolOf: (a: Address) => string): string {
  return (
    hops.map((h) => `${symbolOf(h.tokenIn)} -${(h.fee / 10_000).toFixed(2)}%->`).join(" ") + ` ${settleSymbol}`
  );
}
