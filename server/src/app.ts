import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address, type PublicClient } from "viem";
import { z } from "zod";
import {
  buildBasket,
  checkoutCoreAbi,
  hederaRows,
  invoiceRows,
  listInvoices,
  rankRoutes,
  RankError,
  toCsv,
  txUrl,
  type ChainConfig,
  type ChainKey,
  type HederaSale,
  type Quoter,
  type TradingApiQuote,
} from "@tender/core";

/** Everything the API needs from the outside world, passed in so tests can swap in fakes. */
export interface ServerDeps {
  chains: Record<ChainKey, ChainConfig>;
  clientFor: (chain: ChainKey) => PublicClient;
  quoterFor: (chain: ChainKey) => Quoter | undefined;
  /** Present only when UNISWAP_API_KEY is set. */
  tradingApiFor?: (chain: ChainKey, payer: Address) => (tokenIn: Address, amountOut: bigint) => Promise<TradingApiQuote | null>;
  listHederaSales: (account: string) => Promise<HederaSale[]>;
  /** Public settings the frontend needs (no secrets). */
  publicInfo?: {
    demoMerchant?: Address; // shown on the dashboard when no wallet is connected
    hederaMerchant?: string; // 0.0.x account that receives agent payments
    shopUrl?: string;
    devWalletAccounts?: Address[]; // LOCAL FORK ONLY: unlocked anvil accounts for the "dev wallet"
  };
}

/** JSON can't hold bigint, so every bigint goes out as a decimal string. */
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

const chainKey = z.enum(["unichain-sepolia", "whitechain-sepolia"]);
const address = z.string().refine((s) => isAddress(s), "not an address").transform((s) => s as Address);
const rankBody = z.object({
  chain: chainKey,
  invoiceId: z.coerce.bigint(),
  payer: address,
  slippageBps: z.number().int().min(0).max(500).optional(),
});

export function createApp(deps: ServerDeps) {
  const app = new Hono();
  app.use("/api/*", cors()); // the pay page and dashboard run on another origin

  app.get("/health", (c) => c.json({ ok: true }));

  /** Everything the frontend needs to talk to the chains: one source of truth, from the server's env. */
  app.get("/api/config", (c) =>
    c.json({
      chains: Object.values(deps.chains).map((cfg) => ({
        key: cfg.key,
        id: cfg.chain.id,
        name: cfg.chain.name,
        nativeCurrency: cfg.chain.nativeCurrency,
        rpcUrl: cfg.rpcUrl,
        explorer: cfg.explorer,
        checkout: cfg.checkout ?? null,
        settleToken: cfg.settleToken,
        swaps: Boolean(cfg.swaps),
        tokens: [
          cfg.settleToken,
          ...(cfg.swaps ? [{ address: cfg.swaps.weth, symbol: "WETH", decimals: 18 }, ...cfg.swaps.extraTokens] : []),
        ],
      })),
      ...deps.publicInfo,
    }),
  );

  /** The ranking panel: every way to pay this invoice, cheapest first. */
  app.post("/api/rank", async (c) => {
    const body = rankBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues }, 400);
    const { chain, invoiceId, payer, slippageBps } = body.data;
    try {
      const res = await rankRoutes({
        client: deps.clientFor(chain),
        cfg: deps.chains[chain],
        invoiceId,
        payer,
        slippageBps,
        quoter: deps.quoterFor(chain),
        tradingApi: deps.tradingApiFor?.(chain, payer),
      });
      return c.json(json(res));
    } catch (e) {
      if (e instanceof RankError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  /** A basket payment for when no single token covers the invoice. */
  app.post("/api/basket", async (c) => {
    const body = rankBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues }, 400);
    const { chain, invoiceId, payer, slippageBps } = body.data;
    const cfg = deps.chains[chain];
    const quoter = deps.quoterFor(chain);
    if (!cfg.swaps || !quoter) return c.json({ error: "basket payments need Uniswap (Unichain only)" }, 400);
    try {
      const ranked = await rankRoutes({ client: deps.clientFor(chain), cfg, invoiceId, payer, slippageBps, quoter });
      const invoiceUsd = Number(ranked.invoice.amount) / 10 ** cfg.settleToken.decimals;
      // best (cheapest) PLAIN-pool route per token, whatever the balance. Only "v4-quoter" routes run inside
      // payWithBasket; hook routes go through a different pool and split routes are already baskets.
      const best = new Map<string, (typeof ranked.routes)[number]>();
      for (const r of ranked.routes) {
        if (r.source !== "v4-quoter" || !r.executable || !r.hops.length) continue;
        const k = r.token.address.toLowerCase();
        if (!best.has(k)) best.set(k, r);
      }
      const settleBalance = ranked.routes.find((r) => r.source === "direct")?.balance ?? 0n;
      const basket = await buildBasket({
        quoter,
        settle: cfg.settleToken.address,
        invoiceAmount: ranked.invoice.amount,
        settleBalance,
        slippageBps,
        holdings: [...best.values()].map((r) => ({ token: r.token.address, balance: r.balance, hops: r.hops, costRatio: r.totalCostUsd / invoiceUsd })),
      });
      return c.json(json(basket));
    } catch (e) {
      if (e instanceof RankError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  /** One invoice, straight from contract storage (used by the pay page and the shop's "thank you" page). */
  app.get("/api/invoices/:chain/:id", async (c) => {
    const chain = chainKey.safeParse(c.req.param("chain"));
    if (!chain.success) return c.json({ error: "unknown chain" }, 400);
    const cfg = deps.chains[chain.data];
    if (!cfg.checkout) return c.json({ error: `no checkout configured for ${chain.data}` }, 503);
    const inv = await deps.clientFor(chain.data).readContract({
      address: cfg.checkout,
      abi: checkoutCoreAbi,
      functionName: "getInvoice",
      args: [BigInt(c.req.param("id"))],
    });
    const status = (["None", "Open", "Paid", "Cancelled"] as const)[inv.status];
    if (status === "None") return c.json({ error: "no such invoice" }, 404);
    return c.json(json({ chain: chain.data, id: c.req.param("id"), ...inv, status, settleSymbol: cfg.settleToken.symbol, checkout: cfg.checkout }));
  });

  /** The merchant dashboard: every invoice on every chain for one merchant. */
  app.get("/api/invoices", async (c) => {
    const merchant = address.safeParse(c.req.query("merchant"));
    if (!merchant.success) return c.json({ error: "merchant query parameter must be an address" }, 400);
    const records = await allInvoices(deps, merchant.data);
    return c.json(json({ invoices: records }));
  });

  app.get("/api/hedera/sales", async (c) => {
    const account = c.req.query("account");
    if (!account || !/^\d+\.\d+\.\d+$/.test(account)) return c.json({ error: "account must look like 0.0.12345" }, 400);
    return c.json(json({ sales: await deps.listHederaSales(account) }));
  });

  /** Accountant export: all rails in one CSV. */
  app.get("/api/export.csv", async (c) => {
    const merchant = address.safeParse(c.req.query("merchant"));
    if (!merchant.success) return c.json({ error: "merchant query parameter must be an address" }, 400);
    const records = await allInvoices(deps, merchant.data);
    const tokens = new Map<string, { symbol: string; decimals: number }>();
    for (const cfg of Object.values(deps.chains)) {
      tokens.set(cfg.settleToken.address.toLowerCase(), cfg.settleToken);
      if (cfg.swaps) {
        tokens.set(cfg.swaps.weth.toLowerCase(), { symbol: "WETH", decimals: 18 });
        for (const t of cfg.swaps.extraTokens) tokens.set(t.address.toLowerCase(), t);
      }
    }
    const rows = invoiceRows(records, {
      settle: (r) => tokens.get(r.settleToken.toLowerCase()) ?? deps.chains[r.chain].settleToken,
      tokenLabel: (a) => tokens.get(a.toLowerCase()),
      txUrl: (ch, h) => txUrl(deps.chains[ch], h),
    });
    const hederaAccount = c.req.query("hedera");
    if (hederaAccount) rows.push(...hederaRows(await deps.listHederaSales(hederaAccount)));
    return c.body(toCsv(rows), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tender-${merchant.data.slice(0, 8)}.csv"`,
    });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error", detail: String(err.message ?? err) }, 500);
  });

  return app;
}

async function allInvoices(deps: ServerDeps, merchant: Address) {
  const keys = (Object.keys(deps.chains) as ChainKey[]).filter((k) => deps.chains[k].checkout);
  const lists = await Promise.all(keys.map((k) => listInvoices({ client: deps.clientFor(k), cfg: deps.chains[k], merchant })));
  return lists.flat().sort((a, b) => (b.paidAt ?? b.createdAt ?? 0) - (a.paidAt ?? a.createdAt ?? 0));
}
