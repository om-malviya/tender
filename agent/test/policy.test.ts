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
    expect(requirementToUsd({ network: "hedera:testnet", asset: "0.0.0", amount: "50000" })).toBeNull(); // HBAR, no rate set
    expect(decide(policy, emptyLedger(), { merchant: shop, amountUsd: null }).allow).toBe(false);
  });

  it("understands HBAR only at the rate its policy names, and keeps budgets in dollars", () => {
    const req = { network: "hedera:testnet", asset: "0.0.0", amount: "50000000" }; // 0.5 HBAR in tinybars
    expect(requirementToUsd(req, undefined, 0.1)).toBeCloseTo(0.05); // at $0.10 per HBAR
    expect(requirementToUsd(req, undefined, 0)).toBeNull(); // a zero or missing rate is no rate
    expect(requirementToUsd({ ...req, network: "hedera:mainnet" }, undefined, 0.1)).toBeNull(); // testnet only
  });

  it("the demo sequence holds in HBAR too: two 0.5-HBAR purchases, then the per-merchant cap", () => {
    const hbarPolicy = { ...policy, hbarUsd: 0.1 };
    const usd = requirementToUsd({ network: "hedera:testnet", asset: "0.0.0", amount: "50000000" }, undefined, hbarPolicy.hbarUsd)!;
    let ledger = emptyLedger();
    for (const n of [1, 2]) {
      expect(decide(hbarPolicy, ledger, { merchant: shop, amountUsd: usd }).allow).toBe(true);
      ledger = recordSpend(ledger, { at: "t", merchant: shop, amountUsd: usd, txId: `tx${n}` });
    }
    expect(decide(hbarPolicy, ledger, { merchant: shop, amountUsd: usd })).toMatchObject({ allow: false });
  });

  it("recording a purchase keeps the audit topic, so every decision lands in ONE log", () => {
    const withTopic = { ...emptyLedger(), topicId: "0.0.4242" };
    const after = recordSpend(withTopic, { at: "t", merchant: shop, amountUsd: 0.05, txId: "tx1" });
    expect(after.topicId).toBe("0.0.4242");
    expect(recordSpend(after, { at: "t", merchant: shop, amountUsd: 0.05, txId: "tx2" }).topicId).toBe("0.0.4242");
  });
});
