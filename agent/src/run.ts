import { readFileSync } from "node:fs";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { decide, loadLedger, recordSpend, requirementToUsd, saveLedger, type SpendingPolicy } from "./policy.ts";

/**
 * An autonomous buyer. No human clicks anything:
 *   1. read the shop's manifest to discover what's for sale
 *   2. call the paid endpoint; the shop answers HTTP 402 with a price
 *   3. check the spending policy; if allowed, sign a Hedera USDC transfer (the facilitator pays the fee)
 *   4. get the data, log the Hedera transaction id + HashScan link to the ledger
 *
 *   npm run agent -- http://localhost:8788
 */
const shop = new URL(process.argv[2] ?? process.env.SHOP_URL ?? "http://localhost:8788");
const merchant = shop.host;
const policyPath = new URL("../policy.json", import.meta.url);
const ledgerPath = new URL("../ledger.json", import.meta.url).pathname;
const policy = JSON.parse(readFileSync(policyPath, "utf8")) as SpendingPolicy;
let ledger = loadLedger(ledgerPath);

function parseKey(key: string) {
  if (key.startsWith("302")) return PrivateKey.fromStringDer(key); // DER-encoded (portal "DER" key)
  return process.env.HEDERA_AGENT_KEY_TYPE === "ed25519" ? PrivateKey.fromStringED25519(key) : PrivateKey.fromStringECDSA(key);
}

async function main() {
  const accountId = process.env.HEDERA_AGENT_ID;
  const key = process.env.HEDERA_AGENT_KEY;
  if (!accountId || !key) throw new Error("set HEDERA_AGENT_ID and HEDERA_AGENT_KEY (a Hedera testnet account holding USDC)");

  // 1. discovery
  const manifest = (await (await fetch(new URL("/.well-known/tender.json", shop))).json()) as {
    merchant: string;
    paidEndpoints: { path: string; priceUsd: string; description: string }[];
  };
  const item = manifest.paidEndpoints[0];
  if (!item) throw new Error(`${manifest.merchant} has nothing for sale`);
  console.log(`agent: ${manifest.merchant} sells "${item.description}" for $${item.priceUsd}`);

  // 2-3. pay with x402. The policy runs on the REAL 402 requirements, right before signing.
  let paidUsd = 0;
  const client = new x402Client()
    .register("hedera:*", new ExactHederaScheme(createClientHederaSigner(accountId, parseKey(key), { network: "hedera:testnet" })))
    .onBeforePaymentCreation(async ({ selectedRequirements: req }) => {
      const amountUsd = requirementToUsd(req);
      const decision = decide(policy, ledger, { merchant, amountUsd });
      if (!decision.allow) return { abort: true, reason: decision.reason };
      paidUsd = amountUsd!;
      console.log(`agent: policy OK, paying $${amountUsd} in ${req.asset} to ${req.payTo}`);
    });

  const res = await wrapFetchWithPayment(fetch, client)(new URL(item.path, shop));
  if (!res.ok) {
    console.log(`agent: did NOT buy (HTTP ${res.status}). ${await res.text().catch(() => "")}`.trim());
    process.exitCode = 1;
    return;
  }

  // 4. receipt
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const settlement = header ? decodePaymentResponseHeader(header) : undefined;
  const txId = settlement?.transaction ?? "unknown";
  ledger = recordSpend(ledger, { at: new Date().toISOString(), merchant, amountUsd: paidUsd, txId });
  saveLedger(ledgerPath, ledger);
  console.log(`agent: bought it. Hedera tx ${txId}`);
  console.log(`agent: https://hashscan.io/testnet/transaction/${txId}`);
  console.log(`agent: spent $${ledger.totalUsd.toFixed(2)} of $${policy.budgetTotal} total`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((e) => {
  console.error(`agent: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
