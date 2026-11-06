import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * The agent's spending rules. This is what stops a buggy or prompt-injected agent from draining its
 * wallet. It's checked BEFORE the agent signs anything.
 * Honest limit: it's enforced by the agent's own code, not on-chain, so keep the agent's balance small.
 */
export interface SpendingPolicy {
  budgetTotal: number; // USD the agent may spend in total
  perMerchantCap: number; // USD it may spend at any single merchant
  allowlist: string[]; // merchant hostnames it may pay at all
  humanApprovalAbove: number; // single payments above this need a human (the agent refuses)
}

export interface LedgerEntry {
  at: string;
  merchant: string;
  amountUsd: number;
  txId: string;
}
export interface Ledger {
  totalUsd: number;
  perMerchant: Record<string, number>;
  entries: LedgerEntry[];
}

export type Decision = { allow: true } | { allow: false; reason: string; needsHuman?: boolean };

/** The decision itself: a pure function, so every rule is unit-tested. */
export function decide(policy: SpendingPolicy, ledger: Ledger, req: { merchant: string; amountUsd: number | null }): Decision {
  if (req.amountUsd === null) return { allow: false, reason: "price is not in a currency this agent understands (USDC only)" };
  if (!policy.allowlist.includes(req.merchant)) return { allow: false, reason: `merchant "${req.merchant}" is not on the allowlist` };
  if (req.amountUsd > policy.humanApprovalAbove)
    return { allow: false, needsHuman: true, reason: `$${req.amountUsd} is above the $${policy.humanApprovalAbove} auto-approve limit: needs a human` };
  const atMerchant = ledger.perMerchant[req.merchant] ?? 0;
  if (atMerchant + req.amountUsd > policy.perMerchantCap + 1e-9)
    return { allow: false, reason: `per-merchant cap reached: spent $${atMerchant.toFixed(2)} of $${policy.perMerchantCap} at ${req.merchant}` };
  if (ledger.totalUsd + req.amountUsd > policy.budgetTotal + 1e-9)
    return { allow: false, reason: `total budget reached: spent $${ledger.totalUsd.toFixed(2)} of $${policy.budgetTotal}` };
  return { allow: true };
}

/** Converts an x402 payment requirement into USD. Only Hedera testnet USDC (6 decimals) is understood. */
export function requirementToUsd(req: { network: string; asset: string; amount: string }, usdcTokenId = "0.0.429274"): number | null {
  if (req.network !== "hedera:testnet" || req.asset !== usdcTokenId) return null;
  return Number(req.amount) / 1e6;
}

export const emptyLedger = (): Ledger => ({ totalUsd: 0, perMerchant: {}, entries: [] });

export function loadLedger(path: string): Ledger {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Ledger) : emptyLedger();
}

export function recordSpend(ledger: Ledger, entry: LedgerEntry): Ledger {
  return {
    totalUsd: ledger.totalUsd + entry.amountUsd,
    perMerchant: { ...ledger.perMerchant, [entry.merchant]: (ledger.perMerchant[entry.merchant] ?? 0) + entry.amountUsd },
    entries: [...ledger.entries, entry],
  };
}

export function saveLedger(path: string, ledger: Ledger) {
  writeFileSync(path, JSON.stringify(ledger, null, 2));
}
