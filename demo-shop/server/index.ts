import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadChains, type ChainKey } from "@tender/core";
import { createShopApp } from "./app.ts";

const chains = loadChains();
const account = process.env.MERCHANT_PK ? privateKeyToAccount(process.env.MERCHANT_PK as Hex) : undefined;

const priceUsd = process.env.SHOP_PRICE_USD ?? "1.00";
// Shared secret between this server and its own page. Random per start unless SHOP_TOKEN is set.
const shopToken = process.env.SHOP_TOKEN ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const agentPriceUsd = process.env.AGENT_PRICE_USD ?? "0.05";

const app = createShopApp({
  chains,
  publicClientFor: (k: ChainKey) => createPublicClient({ chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) as PublicClient,
  merchantWalletFor: (k: ChainKey) =>
    account ? { account, wallet: createWalletClient({ account, chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) } : undefined,
  product: { name: "Chai & Code sticker pack", priceUsd },
  invoiceGuard: { token: shopToken },
  hedera: process.env.HEDERA_MERCHANT_ID
    ? {
        payTo: process.env.HEDERA_MERCHANT_ID,
        facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
        priceUsd: agentPriceUsd,
        // X402_ASSET=hbar prices the agent endpoint in native HBAR (testnet HBAR has no market price, so the
        // rate is a setting; the agent's policy.json names the same rate). Default: Hedera testnet USDC.
        hbarPerUsd: process.env.X402_ASSET === "hbar" ? Number(process.env.HBAR_PER_USD ?? "10") : undefined,
      }
    : undefined,
});

// The shop's web page. Prices and the Tender widget's URL are filled in from the same settings the
// server charges with, so the page can never show a different price than the invoice.
const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8")
  .replaceAll("__TENDER_APP_URL__", process.env.TENDER_APP_URL ?? "http://localhost:5173")
  .replaceAll("__PRICE_USD__", priceUsd)
  .replaceAll("__SHOP_TOKEN__", shopToken)
  .replaceAll("__AGENT_PRICE_USD__", agentPriceUsd);
app.get("/", (c) => c.html(page));

const port = Number(process.env.SHOP_PORT ?? 8788);
serve({ fetch: app.fetch, port });
console.log(`Chai & Code shop on http://localhost:${port}  (x402 paywall: ${process.env.HEDERA_MERCHANT_ID ? "on" : "off"})`);
