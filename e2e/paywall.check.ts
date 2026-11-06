// Live check of the x402 paywall WITHOUT paying: asks the real Hedera testnet facilitator what it
// supports, then requests the paid endpoint with no payment and prints the 402 "price tag".
//   npx tsx e2e/paywall.check.ts
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { loadChains, type ChainKey } from "@tender/core";
import { createShopApp } from "../demo-shop/server/app.ts";

const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com";
const supported = await (await fetch(`${facilitatorUrl}/supported`)).json();
const hederaKinds = (supported.kinds ?? []).filter((k: { network: string }) => k.network.startsWith("hedera"));
console.log("facilitator supports:", JSON.stringify(hederaKinds));

const shop = createShopApp({
  chains: loadChains(),
  publicClientFor: (_: ChainKey) => {
    throw new Error("not needed");
  },
  merchantWalletFor: () => undefined,
  product: { name: "x", priceUsd: "1.00" },
  hedera: { payTo: process.env.HEDERA_MERCHANT_ID ?? "0.0.7777", facilitatorUrl, priceUsd: "0.05" },
});

const res = await shop.request("/api/agent/dataset");
console.log("status:", res.status);
const header = res.headers.get("PAYMENT-REQUIRED");
if (!header) throw new Error("no PAYMENT-REQUIRED header");
const required = decodePaymentRequiredHeader(header);
console.log("402 price tag:", JSON.stringify(required.accepts, null, 2));
if (res.status !== 402) process.exitCode = 1;
