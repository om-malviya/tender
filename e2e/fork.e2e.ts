// Drives the whole product against a local fork of Unichain Sepolia (started by scripts/e2e-fork.sh).
// Uses the REAL server + shop code in-process, real Uniswap v4 contracts (copied by the fork) and our
// freshly deployed UniswapCheckout. Exits non-zero if any check fails.
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, maxUint256, parseEther, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { demoTokenAbi, loadChains, onchainQuoter, uniswapCheckoutAbi, type ChainKey } from "@tender/core";
import { createApp } from "../server/src/app.ts";
import { createShopApp } from "../demo-shop/server/app.ts";

const chains = loadChains();
const cfg = chains["unichain-sepolia"];
const chain = cfg.chain;
const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient;
const merchant = privateKeyToAccount(process.env.MERCHANT_PK as Hex);
const payer = privateKeyToAccount(process.env.PAYER_PK as Hex);
const payerWallet = createWalletClient({ account: payer, chain, transport: http(cfg.rpcUrl) });
const merchantWallet = createWalletClient({ account: merchant, chain, transport: http(cfg.rpcUrl) });
const USDC = cfg.settleToken.address;
const WETH = cfg.swaps!.weth;
const DEMO = process.env.DEMO as Address;
const checkout = cfg.checkout!;

const clientFor = (k: ChainKey) =>
  k === "unichain-sepolia" ? client : (createPublicClient({ chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) as PublicClient);
const api = createApp({
  chains,
  clientFor,
  quoterFor: (k: ChainKey) => (k === "unichain-sepolia" ? onchainQuoter(client, cfg.swaps!.quoter) : undefined),
  listHederaSales: async () => [],
});
const shop = createShopApp({
  chains,
  publicClientFor: clientFor,
  merchantWalletFor: (k) => (k === "unichain-sepolia" ? { wallet: merchantWallet, account: merchant } : undefined),
  product: { name: "Chai & Code sticker pack", priceUsd: "1.00" },
});
const post = async (app: { request: (p: string, i: RequestInit) => Response | Promise<Response> }, path: string, body: unknown) => {
  const res = await app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const json = await res.json();
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(json)}`);
  return json;
};
const usdc = (a: bigint) => formatUnits(a, 6);
const balance = (token: Address, who: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const send = async (hash: Promise<Hex>) => {
  const r = await client.waitForTransactionReceipt({ hash: await hash });
  assert.equal(r.status, "success");
  return r;
};

// --- the payer already holds the "wrong" tokens (scripts/fork-up.sh): 3 DEMO, 0.0003 WETH, 0.40 USDC ---
for (const t of [DEMO, WETH, USDC]) await send(payerWallet.writeContract({ address: t, abi: erc20Abi, functionName: "approve", args: [checkout, maxUint256] }));

// ===== 1. Single-token payment =====================================================================
const order1 = await post(shop, "/api/create-invoice", { chain: "unichain-sepolia" });
console.log(`\n1) shop created invoice #${order1.invoiceId} for ${order1.amount} ${order1.currency}`);

const ranked = await post(api, "/api/rank", { chain: "unichain-sepolia", invoiceId: order1.invoiceId, payer: payer.address });
console.log("   ranking (cheapest first):");
for (const r of ranked.routes)
  console.log(`   ${r.affordable ? " " : "x"} ${r.label.padEnd(44)} ${r.source.padEnd(10)} in ${Number(r.amountIn) / 10 ** r.token.decimals} ${r.token.symbol}  total $${r.totalCostUsd.toFixed(4)}`);
const best = ranked.recommended;
assert.ok(best, "a payable route was recommended");
assert.equal(best.token.symbol, "DEMO");
assert.equal(best.hops.length, 2, "the deep DEMO->WETH->USDC route should beat the thin direct DEMO pool");
const directDemo = ranked.routes.find((r: { token: { symbol: string }; hops: unknown[] }) => r.token.symbol === "DEMO" && r.hops.length === 1);
assert.ok(directDemo && directDemo.totalCostUsd > best.totalCostUsd);
console.log(`   recommended: ${best.label}, max ${Number(best.maxAmountIn) / 1e18} DEMO`);

const merchantBefore = await balance(USDC, merchant.address);
const demoBefore = await balance(DEMO, payer.address);
await send(
  payerWallet.writeContract({
    address: checkout,
    abi: uniswapCheckoutAbi,
    functionName: "payWithToken",
    args: [BigInt(order1.invoiceId), DEMO, BigInt(best.maxAmountIn), best.hops.map((h: { tokenIn: Address; fee: number; tickSpacing: number }) => ({ ...h })), BigInt(Math.floor(Date.now() / 1000) + 600)],
  }),
);
const got = (await balance(USDC, merchant.address)) - merchantBefore;
const spent = demoBefore - (await balance(DEMO, payer.address));
assert.equal(got, 1_000_000n, "merchant must receive exactly 1.00 USDC");
assert.ok(spent <= BigInt(best.maxAmountIn), "payer never pays more than maxAmountIn");
console.log(`   paid: merchant +${usdc(got)} USDC (exact), payer spent ${formatUnits(spent, 18)} DEMO`);

// ===== 2. Basket payment: 0.40 USDC + leftover DEMO + WETH pay one invoice ===========================
const order2 = await post(shop, "/api/create-invoice", { chain: "unichain-sepolia" });
const basket = await post(api, "/api/basket", { chain: "unichain-sepolia", invoiceId: order2.invoiceId, payer: payer.address });
console.log(`\n2) basket for invoice #${order2.invoiceId}: covers=${basket.covers}`);
for (const l of basket.legs) console.log(`   leg ${l.tokenIn.slice(0, 8)}… amountIn ${l.amountIn} minOut ${l.minOut}`);
assert.ok(basket.covers);
const legs = basket.legs.map((l: { tokenIn: Address; amountIn: string; path: { tokenIn: Address; fee: number; tickSpacing: number }[]; minOut: string }) => ({
  tokenIn: l.tokenIn,
  amountIn: BigInt(l.amountIn),
  path: l.path,
  minOut: BigInt(l.minOut),
}));
const m2 = await balance(USDC, merchant.address);
await send(payerWallet.writeContract({ address: checkout, abi: uniswapCheckoutAbi, functionName: "payWithBasket", args: [BigInt(order2.invoiceId), legs, BigInt(Math.floor(Date.now() / 1000) + 600)] }));
assert.equal((await balance(USDC, merchant.address)) - m2, 1_000_000n, "basket: merchant gets exactly 1.00 USDC");
console.log("   paid: merchant +1.00 USDC (exact) from", legs.length, "tokens");

// ===== 3. Merchant refunds 0.25 of the first invoice ================================================
await send(merchantWallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [checkout, maxUint256] }));
await send(merchantWallet.writeContract({ address: checkout, abi: uniswapCheckoutAbi, functionName: "refund", args: [BigInt(order1.invoiceId), 250_000n] }));
console.log(`\n3) merchant refunded 0.25 USDC on invoice #${order1.invoiceId}`);

// ===== 4. Dashboard + CSV come from on-chain events =================================================
const list = await (await api.request(`/api/invoices?merchant=${merchant.address}`)).json();
const inv1 = list.invoices.find((i: { id: string }) => i.id === order1.invoiceId);
const inv2 = list.invoices.find((i: { id: string }) => i.id === order2.invoiceId);
assert.equal(inv1.status, "Paid");
assert.equal(inv1.refunded, "250000");
assert.equal(inv2.status, "Paid");
assert.ok(inv2.basket, "basket details recovered from BasketPaid");
const csv = await (await api.request(`/api/export.csv?merchant=${merchant.address}`)).text();
console.log("\n4) dashboard sees", list.invoices.length, "invoices; CSV export:\n" + csv);
assert.match(csv, /unichain-sepolia,1,.*,Paid,USDC,1,0.25,0.75,/);

// ===== 5. The contract never kept anything ========================================================
for (const t of [USDC, WETH, DEMO]) assert.equal(await balance(t, checkout), 0n, "checkout must hold nothing");
console.log("5) checkout contract holds 0 USDC / 0 WETH / 0 DEMO\n\nE2E PASSED");
