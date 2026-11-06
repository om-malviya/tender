import { serve } from "@hono/node-server";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { listAuditLog, listHederaSales, loadChains, onchainQuoter, quoteViaTradingApi, type ChainKey } from "@tender/core";
import { createApp } from "./app.ts";

// Wires the API to real networks using environment variables (see .env.example), then starts it.
const chains = loadChains();
const clients = new Map<ChainKey, PublicClient>();
// Public RPCs rate-limit (Unichain's answers HTTP 429 when the dashboard scans event logs for several visitors at
// once), so each chain gets retries and, if configured, a second provider that takes over when the first refuses.
const FALLBACK_RPC: Record<ChainKey, string | undefined> = {
  "unichain-sepolia": process.env.UNICHAIN_SEPOLIA_RPC_FALLBACK ?? "https://unichain-sepolia-rpc.publicnode.com",
  "whitechain-sepolia": process.env.WHITECHAIN_SEPOLIA_RPC_FALLBACK,
};
const isLocal = (url: string) => /127\.0\.0\.1|localhost/.test(url);
const clientFor = (k: ChainKey) => {
  if (!clients.has(k)) {
    const main = chains[k].rpcUrl;
    const backup = isLocal(main) ? undefined : FALLBACK_RPC[k]; // a local fork has no "backup"
    const transport = backup ? fallback([http(main, { retryCount: 2 }), http(backup, { retryCount: 2 })]) : http(main, { retryCount: 3 });
    clients.set(k, createPublicClient({ chain: chains[k].chain, transport }) as PublicClient);
  }
  return clients.get(k)!;
};
const apiKey = process.env.UNISWAP_API_KEY;

const app = createApp({
  chains,
  clientFor,
  quoterFor: (k) => (chains[k].swaps ? onchainQuoter(clientFor(k), chains[k].swaps!.quoter) : undefined),
  tradingApiFor: apiKey
    ? (k, payer) => (tokenIn, amountOut) =>
        quoteViaTradingApi({ apiKey, chainId: chains[k].chain.id, tokenIn, tokenOut: chains[k].settleToken.address, amountOut, swapper: payer })
    : undefined,
  // HBAR_USD: the same demo rate the shop prices with (HBAR_PER_USD=10 there) and the agent's policy uses
  listHederaSales: (account) => listHederaSales({ merchant: account, hbarUsd: Number(process.env.HBAR_USD ?? "0.1") }),
  listAuditLog: (topicId) => listAuditLog({ topicId }),
  publicInfo: {
    demoMerchant: process.env.DEMO_MERCHANT as `0x${string}` | undefined,
    hederaMerchant: process.env.HEDERA_MERCHANT_ID,
    hederaTopic: process.env.HCS_TOPIC_ID,
    shopUrl: process.env.SHOP_URL ?? "http://localhost:8788",
    devWalletAccounts: process.env.DEV_WALLET_ACCOUNTS?.split(",").filter(Boolean) as `0x${string}`[] | undefined,
  },
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Tender API on http://localhost:${port}  (Trading API: ${apiKey ? "on" : "off, using the v4 Quoter only"})`);
