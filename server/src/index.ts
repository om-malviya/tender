import { serve } from "@hono/node-server";
import { createPublicClient, http, type PublicClient } from "viem";
import { listAuditLog, listHederaSales, loadChains, onchainQuoter, quoteViaTradingApi, type ChainKey } from "@tender/core";
import { createApp } from "./app.ts";

// Wires the API to real networks using environment variables (see .env.example), then starts it.
const chains = loadChains();
const clients = new Map<ChainKey, PublicClient>();
const clientFor = (k: ChainKey) => {
  if (!clients.has(k)) clients.set(k, createPublicClient({ chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) as PublicClient);
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
  listHederaSales: (account) => listHederaSales({ merchant: account }),
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
