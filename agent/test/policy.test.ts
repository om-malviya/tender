import { describe, expect, it } from "vitest";
import { decide, emptyLedger, recordSpend, requirementToUsd, type SpendingPolicy } from "../src/policy.ts";

const policy: SpendingPolicy = { budgetTotal: 0.2, perMerchantCap: 0.1, allowlist: ["localhost:8788"], humanApprovalAbove: 0.1 };
const shop = "localhost:8788";

describe("agent spending policy", () => {
  it("pays an allowlisted merchant within budget", () => {
    expect(decide(policy, emptyLedger(), { merchant: shop, amountUsd: 0.05 })).toEqual({ allow: true });
  });

  it("the demo sequence: buys twice, then the third purchase hits the per-merchant cap", () => {
    let ledger = emptyLedger();
    for (const n of [1, 2]) {
      expect(decide(policy, ledger, { merchant: shop, amountUsd: 0.05 }).allow).toBe(true);
      ledger = recordSpend(ledger, { at: "t", merchant: shop, amountUsd: 0.05, txId: `tx${n}` });
    }
    const third = decide(policy, ledger, { merchant: shop, amountUsd: 0.05 });
    expect(third).toMatchObject({ allow: false });
    expect(third.allow === false && third.reason).toMatch(/per-merchant cap/);
  });

  it("refuses merchants that aren't on the allowlist", () => {
    const d = decide(policy, emptyLedger(), { merchant: "evil.example", amountUsd: 0.01 });
    expect(d.allow === false && d.reason).toMatch(/allowlist/);
  });

  it("asks for a human above the auto-approve threshold", () => {
    expect(decide(policy, emptyLedger(), { merchant: shop, amountUsd: 0.5 })).toMatchObject({ allow: false, needsHuman: true });
  });

  it("enforces the total budget across merchants", () => {
    const p = { ...policy, allowlist: [shop, "b"], perMerchantCap: 1 };
    let ledger = recordSpend(emptyLedger(), { at: "t", merchant: "b", amountUsd: 0.18, txId: "x" });
    const d = decide(p, ledger, { merchant: shop, amountUsd: 0.05 });
    expect(d.allow === false && d.reason).toMatch(/total budget/);
  });

  it("only understands Hedera testnet USDC", () => {
    expect(requirementToUsd({ network: "hedera:testnet", asset: "0.0.429274", amount: "50000" })).toBe(0.05);
    expect(requirementToUsd({ network: "hedera:testnet", asset: "0.0.0", amount: "50000" })).toBeNull(); // HBAR
    expect(decide(policy, emptyLedger(), { merchant: shop, amountUsd: null }).allow).toBe(false);
  });
});
