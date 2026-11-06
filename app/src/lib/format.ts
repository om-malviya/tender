import { formatUnits } from "viem";
import type { ChainKey, PublicChain, Token } from "./api.ts";

/** "1000000" with 6 decimals -> "1.00"; long fractions trimmed to `digits` significant decimals. */
export function amount(raw: string | bigint | undefined, decimals: number, digits = 6): string {
  if (raw === undefined) return "-";
  const s = formatUnits(BigInt(raw), decimals);
  const [whole, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, digits).replace(/0+$/, "");
  const shown = trimmed.length < 2 && decimals <= 6 ? (trimmed + "00").slice(0, 2) : trimmed;
  return shown ? `${whole}.${shown}` : whole!;
}

export const usd = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "-" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(n < 10 ? 4 : 2)}`;

export const short = (a?: string, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "-");

export function age(unix?: number): string {
  if (!unix) return "-";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export const chainLabel = (k: ChainKey) => (k === "unichain-sepolia" ? "Unichain" : "Whitechain");

export const tokenOf = (chain: PublicChain | undefined, address?: string): Token | undefined =>
  chain?.tokens.find((t) => t.address.toLowerCase() === address?.toLowerCase());

/** "DEMO -0.30%-> WETH -0.05%-> USDC" -> ["DEMO", "0.30%", "WETH", "0.05%", "USDC"] for the route chips. */
export const routeParts = (label: string) => label.split(/\s-(\d+\.\d+%)->\s/);
