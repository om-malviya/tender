import { describe, expect, it } from "vitest";
import { zeroAddress, type Address, type PublicClient } from "viem";
import { loadChains, type HederaSale, type Quoter } from "@tender/core";
import { createApp } from "../src/app.ts";
import { createShopApp } from "../../demo-shop/server/app.ts";

const DEMO = "0x00000000000000000000000000000000000000D3" as Address;
const chains = loadChains({ UNICHAIN_CHECKOUT: "0x0000000000000000000000000000000000000c0c", DEMO });

const fakeClient = {
  readContract: async () => ({
    merchant: "0x000000000000000000000000000000000000beef",
    settleToken: chains["unichain-sepolia"].settleToken.address,
    amount: 1_000_000n,
    expiry: 9_999_999_999n,
    status: 1,
    payer: zeroAddress,
    refunded: 0n,
    orderRef: "0x" + "00".repeat(32),
  }),
  multicall: async () => [5_000_000n, 0n, 0n], // payer holds 5 USDC
  getGasPrice: async () => 1n,
} as unknown as PublicClient;
const noQuotes: Quoter = { exactOut: async () => null, exactIn: async () => null };
const sales: HederaSale[] = [
  { txId: "0.0.5-1-1", timestamp: 1730700000, payer: "0.0.5", amount: 50_000n, tokenId: "0.0.429274", symbol: "USDC", decimals: 6, hashscanUrl: "https://hashscan.io/x" },
];

const app = createApp({
  chains,
  clientFor: () => fakeClient,
  quoterFor: () => noQuotes,
  listHederaSales: async () => sales,
});
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("Tender API", () => {
  it("ranks routes and serialises bigints as strings", async () => {
    const res = await post("/api/rank", { chain: "unichain-sepolia", invoiceId: "1", payer: "0x000000000000000000000000000000000000dEaD" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommended.source).toBe("direct");
    expect(body.recommended.amountIn).toBe("1000000");
  });

  it("validates input", async () => {
    expect((await post("/api/rank", { chain: "mars", invoiceId: "1", payer: "0xnope" })).status).toBe(400);
    expect((await app.request("/api/invoices?merchant=bob")).status).toBe(400);
    expect((await app.request("/api/hedera/sales?account=bob")).status).toBe(400);
  });

  it("reads one invoice", async () => {
    const res = await app.request("/api/invoices/unichain-sepolia/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "Open", amount: "1000000", settleSymbol: "USDC" });
  });

  it("refuses chains with no deployed checkout yet", async () => {
    expect((await app.request("/api/invoices/whitechain-sepolia/1")).status).toBe(503);
  });

  it("lists Hedera agent sales", async () => {
    const body = await (await app.request("/api/hedera/sales?account=0.0.7")).json();
    expect(body.sales[0]).toMatchObject({ payer: "0.0.5", amount: "50000" });
  });
});

describe("Chai & Code shop", () => {
  const shop = createShopApp({
    chains,
    publicClientFor: () => fakeClient,
    merchantWalletFor: () => undefined,
    product: { name: "stickers", priceUsd: "1.00" },
  });

  it("publishes a manifest (empty when the paywall is off)", async () => {
    expect(await (await shop.request("/.well-known/tender.json")).json()).toEqual({ merchant: "Chai & Code", paidEndpoints: [] });
  });

  it("guards create-invoice with a token and a rate limit", async () => {
    const guarded = createShopApp({
      chains,
      publicClientFor: () => fakeClient,
      merchantWalletFor: () => undefined,
      product: { name: "stickers", priceUsd: "1.00" },
      invoiceGuard: { token: "s3cret", maxPerWindow: 2 },
    });
    const call = (headers: Record<string, string>) =>
      guarded.request("/api/create-invoice", { method: "POST", body: JSON.stringify({ chain: "unichain-sepolia" }), headers: { "content-type": "application/json", ...headers } });
    expect((await call({})).status).toBe(401); // no token
    expect((await call({ "x-shop-token": "s3cret" })).status).toBe(503); // token ok, wallet not configured
    expect((await call({ "x-shop-token": "s3cret" })).status).toBe(503);
    expect((await call({ "x-shop-token": "s3cret" })).status).toBe(429); // third within the window
  });

  it("says clearly when x402 or the merchant wallet isn't configured", async () => {
    expect((await shop.request("/api/agent/dataset")).status).toBe(503);
    const res = await shop.request("/api/create-invoice", { method: "POST", body: JSON.stringify({ chain: "unichain-sepolia" }) });
    expect(res.status).toBe(503);
  });
});

describe("Hedera audit log API", () => {
  const entries = [{ sequence: 2, consensusAt: 1730700050, payer: "0.0.5", body: { kind: "refused", reason: "over budget" }, raw: "{}" }];
  const withAudit = createApp({
    chains,
    clientFor: () => fakeClient,
    quoterFor: () => noQuotes,
    listHederaSales: async () => sales,
    listAuditLog: async (topic) => (topic === "0.0.4242" ? entries : []),
  });

  it("rejects a malformed topic id", async () => {
    expect((await withAudit.request("/api/hedera/audit?topic=bob")).status).toBe(400);
    expect((await withAudit.request("/api/hedera/audit")).status).toBe(400);
  });

  it("returns the topic's entries from the mirror reader", async () => {
    const res = await withAudit.request("/api/hedera/audit?topic=0.0.4242");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries });
  });

  it("returns an empty log when no mirror reader is configured", async () => {
    const res = await app.request("/api/hedera/audit?topic=0.0.4242");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });
});
