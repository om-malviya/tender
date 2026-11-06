// Whitechain USDT flow on a LOCAL copy of Whitechain Sepolia (started by scripts/fork-up.sh).
// Real Whitechain USDT contract (copied by the fork), our CheckoutCore compiled with Whitechain's required
// settings, and the real server + shop code in-process. Exits non-zero if any check fails.
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, erc20Abi, http, parseSignature, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkoutCoreAbi, loadChains, type ChainKey } from "@tender/core";
import { createApp } from "../server/src/app.ts";
import { createShopApp } from "../demo-shop/server/app.ts";

const chains = loadChains();
const cfg = chains["whitechain-sepolia"];
const clientFor = (k: ChainKey) => createPublicClient({ chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) as PublicClient;
const client = clientFor("whitechain-sepolia");
const merchant = privateKeyToAccount(process.env.MERCHANT_PK as Hex);
const payer = privateKeyToAccount(process.env.PAYER_PK as Hex);
const walletOf = (account: typeof payer) => createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const payerWallet = walletOf(payer);
const merchantWallet = walletOf(merchant);
const USDT = cfg.settleToken.address;
const checkout = cfg.checkout!;
assert.equal(cfg.chain.id, 1874, "the local copy keeps Whitechain's real chain id");

const api = createApp({ chains, clientFor, quoterFor: () => undefined, listHederaSales: async () => [] });
const shop = createShopApp({
  chains,
  publicClientFor: clientFor,
  merchantWalletFor: (k) => ({ account: merchant, wallet: createWalletClient({ account: merchant, chain: chains[k].chain, transport: http(chains[k].rpcUrl) }) }),
  product: { name: "Chai & Code sticker pack", priceUsd: "1.00" },
});
const call = async (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, path: string, body?: unknown) => {
  const res = await app.request(path, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const json = await res.json();
  assert.equal(res.status, 200, `${path}: ${JSON.stringify(json)}`);
  return json;
};
const usdt = (who: Address) => client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const mined = async (hash: Promise<Hex>) => {
  const r = await client.waitForTransactionReceipt({ hash: await hash });
  assert.equal(r.status, "success");
  return r;
};
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

// ===== 1. Customer: approve + pay a USDT invoice =====================================================
const order1 = await call(shop, "/api/create-invoice", { chain: "whitechain-sepolia" });
console.log(`\n1) shop created Whitechain invoice #${order1.invoiceId} for ${order1.amount} ${order1.currency}`);
assert.equal(order1.currency, "USDT");

const ranked = await call(api, "/api/rank", { chain: "whitechain-sepolia", invoiceId: order1.invoiceId, payer: payer.address });
assert.equal(ranked.routes.length, 1, "Whitechain has no Uniswap: the only route is paying USDT directly");
assert.equal(ranked.recommended.source, "direct");
assert.equal(ranked.recommended.token.symbol, "USDT");
console.log(`   ranking: ${ranked.recommended.label}, affordable=${ranked.recommended.affordable}`);

const m0 = await usdt(merchant.address);
await mined(payerWallet.writeContract({ address: USDT, abi: erc20Abi, functionName: "approve", args: [checkout, 1_000_000n] })); // exact amount
await mined(payerWallet.writeContract({ address: checkout, abi: checkoutCoreAbi, functionName: "payInvoice", args: [BigInt(order1.invoiceId)] }));
assert.equal((await usdt(merchant.address)) - m0, 1_000_000n, "merchant must receive exactly 1.00 USDT");
const confirmed1 = await call(shop, `/api/orders/whitechain-sepolia/${order1.invoiceId}`);
assert.equal(confirmed1.paid, true, "the shop's server confirms on-chain");
console.log("   paid with approve + payInvoice: merchant +1.00 USDT (exact); shop confirmed on-chain");

// ===== 2. Customer: ONE transaction with an EIP-2612 permit signature (no approve tx) =================
const order2 = await call(shop, "/api/create-invoice", { chain: "whitechain-sepolia" });
assert.equal(await client.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [payer.address, checkout] }), 0n, "no allowance before");
const nonce = await client.readContract({
  address: USDT,
  abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
  functionName: "nonces",
  args: [payer.address],
});
// Domain worked out by matching the token's DOMAIN_SEPARATOR: name "Tether USD", version "1", chain 1874.
const signature = await payerWallet.signTypedData({
  domain: { name: "Tether USD", version: "1", chainId: cfg.chain.id, verifyingContract: USDT },
  types: {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  message: { owner: payer.address, spender: checkout, value: 1_000_000n, nonce, deadline },
});
const { r, s, v, yParity } = parseSignature(signature);
const m1 = await usdt(merchant.address);
await mined(
  payerWallet.writeContract({
    address: checkout,
    abi: checkoutCoreAbi,
    functionName: "payInvoiceWithPermit",
    args: [BigInt(order2.invoiceId), deadline, Number(v ?? BigInt(yParity + 27)), r, s],
  }),
);
assert.equal((await usdt(merchant.address)) - m1, 1_000_000n, "permit payment: merchant receives exactly 1.00 USDT");
console.log(`\n2) invoice #${order2.invoiceId} paid in ONE transaction with a USDT permit signature (Whitechain USDT permit works)`);

// ===== 3. Merchant: partial refund of invoice 1 ======================================================
const p0 = await usdt(payer.address);
await mined(merchantWallet.writeContract({ address: USDT, abi: erc20Abi, functionName: "approve", args: [checkout, 400_000n] }));
await mined(merchantWallet.writeContract({ address: checkout, abi: checkoutCoreAbi, functionName: "refund", args: [BigInt(order1.invoiceId), 400_000n] }));
assert.equal((await usdt(payer.address)) - p0, 400_000n, "refund goes back to the original payer");
console.log(`\n3) merchant refunded 0.40 USDT on invoice #${order1.invoiceId} to the original payer`);

// ===== 4. Dashboard + CSV include the Whitechain invoices, in USDT ===================================
const list = await call(api, `/api/invoices?merchant=${merchant.address}`);
const wc = list.invoices.filter((i: { chain: string }) => i.chain === "whitechain-sepolia");
assert.equal(wc.length, 2);
const csv = await (await api.request(`/api/export.csv?merchant=${merchant.address}`)).text();
const line = csv.split("\n").find((l) => l.startsWith("") && l.includes(`whitechain-sepolia,${order1.invoiceId},`))!;
console.log("\n4) CSV row:", line);
assert.match(line, /,Paid,USDT,1,0\.4,0\.6,/);

// ===== 5. Nothing left in the contract ===============================================================
assert.equal(await usdt(checkout), 0n, "CheckoutCore holds no USDT");
console.log("5) Whitechain CheckoutCore holds 0 USDT\n\nWHITECHAIN E2E PASSED");
