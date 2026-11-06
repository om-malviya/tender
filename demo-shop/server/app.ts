import { Hono } from "hono";
import { keccak256, parseEventLogs, parseUnits, toHex, type Account, type PublicClient, type WalletClient } from "viem";
import { z } from "zod";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { checkoutCoreAbi, HEDERA_TESTNET_USDC, type ChainConfig, type ChainKey } from "@tender/core";

/**
 * "Chai & Code": a separate little store that uses Tender the way a real merchant would.
 *  - Humans: the shop's server creates an on-chain invoice, and the page opens the Tender widget to pay it.
 *  - AI agents: GET /api/agent/dataset is paywalled with x402 and settles in USDC on Hedera testnet.
 */
export interface ShopDeps {
  chains: Record<ChainKey, ChainConfig>;
  publicClientFor: (chain: ChainKey) => PublicClient;
  /** The merchant's wallet (testnet key held by the shop server; a demo shortcut, see README). */
  merchantWalletFor: (chain: ChainKey) => { wallet: WalletClient; account: Account } | undefined;
  product: { name: string; priceUsd: string };
  hedera?: { payTo: string; facilitatorUrl: string; priceUsd: string };
  /** false in tests: don't contact the facilitator at startup */
  syncFacilitatorOnStart?: boolean;
  /** Guards for the one endpoint that spends the merchant's gas (create-invoice). */
  invoiceGuard?: {
    /** shared secret the shop page sends as `x-shop-token`; the page gets it from the same server */
    token?: string;
    /** max invoices per client IP per window (default 10 per 10 min) */
    maxPerWindow?: number;
    windowMs?: number;
  };
}

export const DATASET_PATH = "/api/agent/dataset";

export function createShopApp(deps: ShopDeps) {
  const app = new Hono();

  // --- x402 paywall: must be registered before the route it protects -------------------------------
  if (deps.hedera) {
    const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: deps.hedera.facilitatorUrl })).register(
      "hedera:testnet",
      new ExactHederaScheme(), // "$0.05" is priced in Hedera testnet USDC (0.0.429274) by default
    );
    app.use(
      paymentMiddleware(
        {
          [`GET ${DATASET_PATH}`]: {
            accepts: { scheme: "exact", network: "hedera:testnet", payTo: deps.hedera.payTo, price: `$${deps.hedera.priceUsd}` },
            description: "Chai & Code: today's Mumbai chai price index (JSON)",
            mimeType: "application/json",
          },
        },
        resourceServer,
        undefined,
        undefined,
        deps.syncFacilitatorOnStart ?? true,
      ),
    );
  }

  // --- discovery: how an agent finds what's for sale ------------------------------------------------
  app.get("/.well-known/tender.json", (c) =>
    c.json({
      merchant: "Chai & Code",
      paidEndpoints: deps.hedera
        ? [
            {
              path: DATASET_PATH,
              method: "GET",
              description: "Today's Mumbai chai price index",
              protocol: "x402",
              network: "hedera:testnet",
              asset: HEDERA_TESTNET_USDC,
              priceUsd: deps.hedera.priceUsd,
            },
          ]
        : [],
    }),
  );

  // --- the paid resource -----------------------------------------------------------------------------
  app.get(DATASET_PATH, (c) => {
    if (!deps.hedera) return c.json({ error: "x402 paywall not configured: set HEDERA_MERCHANT_ID" }, 503);
    // Only reached after the middleware has verified and settled the payment.
    return c.json({
      dataset: "mumbai-chai-index",
      generatedAt: new Date().toISOString(),
      currency: "INR",
      items: [
        { stall: "Churchgate cutting chai", priceInr: 15 },
        { stall: "Bandra masala chai", priceInr: 25 },
        { stall: "Fort irani chai", priceInr: 30 },
      ],
    });
  });

  // --- humans: create an invoice the Tender widget will pay -------------------------------------------
  // This is the only endpoint that sends a transaction from the merchant's key, so it is guarded:
  // a per-IP rate limit, plus a token the shop page carries (so random callers can't burn the merchant's gas).
  const guard = { maxPerWindow: 10, windowMs: 10 * 60_000, ...deps.invoiceGuard };
  const hits = new Map<string, number[]>();
  const createBody = z.object({ chain: z.enum(["unichain-sepolia", "whitechain-sepolia"]) });
  app.post("/api/create-invoice", async (c) => {
    if (guard.token && c.req.header("x-shop-token") !== guard.token) return c.json({ error: "missing or wrong shop token" }, 401);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < guard.windowMs);
    if (recent.length >= guard.maxPerWindow) return c.json({ error: "too many invoices from this address; try again later" }, 429);
    hits.set(ip, [...recent, now]);

    const body = createBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues }, 400);
    const chain = body.data.chain;
    const cfg = deps.chains[chain];
    const merchant = deps.merchantWalletFor(chain);
    if (!cfg.checkout || !merchant) return c.json({ error: `${chain} is not configured (checkout address / MERCHANT_PK)` }, 503);

    const amount = parseUnits(deps.product.priceUsd, cfg.settleToken.decimals); // $1.00 -> 1_000_000
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 60); // 30 minutes to pay
    const orderRef = keccak256(toHex(`chai-and-code:${Date.now()}:${Math.random()}`));

    const hash = await merchant.wallet.writeContract({
      address: cfg.checkout,
      abi: checkoutCoreAbi,
      functionName: "createInvoice",
      args: [cfg.settleToken.address, amount, expiry, orderRef],
      account: merchant.account,
      chain: cfg.chain,
    });
    const receipt = await deps.publicClientFor(chain).waitForTransactionReceipt({ hash });
    const [created] = parseEventLogs({ abi: checkoutCoreAbi, eventName: "InvoiceCreated", logs: receipt.logs });
    if (!created) return c.json({ error: "invoice transaction did not emit InvoiceCreated" }, 500);

    return c.json({
      chain,
      invoiceId: created.args.id.toString(),
      amount: deps.product.priceUsd,
      currency: cfg.settleToken.symbol,
      orderRef,
      txHash: hash,
    });
  });

  // --- "is this order paid?" Answered from the CHAIN, never from the browser's word ------------------
  app.get("/api/orders/:chain/:id", async (c) => {
    const chain = z.enum(["unichain-sepolia", "whitechain-sepolia"]).safeParse(c.req.param("chain"));
    if (!chain.success) return c.json({ error: "unknown chain" }, 400);
    const cfg = deps.chains[chain.data];
    if (!cfg.checkout) return c.json({ error: `${chain.data} is not configured` }, 503);
    const inv = await deps.publicClientFor(chain.data).readContract({
      address: cfg.checkout,
      abi: checkoutCoreAbi,
      functionName: "getInvoice",
      args: [BigInt(c.req.param("id"))],
    });
    const merchant = deps.merchantWalletFor(chain.data)?.account.address;
    // Paid AND to us: an invoice someone else created can't fake one of our orders.
    const paid = inv.status === 2 && (!merchant || inv.merchant.toLowerCase() === merchant.toLowerCase());
    return c.json({ paid, payer: inv.payer, amount: inv.amount.toString() });
  });

  return app;
}
