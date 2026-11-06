import { describe, expect, it } from "vitest";
import { zeroAddress, type Address, type PublicClient } from "viem";
import {
  buildBasket,
  candidatePaths,
  hookedPaths,
  csvCell,
  hederaRows,
  hashscanTxUrl,
  loadChains,
  onchainQuoter,
  parseMirrorSales,
  parseTopicMessages,
  listAuditLog,
  parseTradingApiQuote,
  bufferForImpact,
  encodeHookData,
  hookSwapArgs,
  rankRoutes,
  RankError,
  toCsv,
  toExactInPathKeys,
  toExactOutPathKeys,
  toMirrorTxId,
  withSlippage,
  type Hop,
  type Quoter,
} from "../src/index.ts";

const USDC = "0x31d0220469e10c4E71834a79b1f276d740d3768F" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const DEMO = "0x00000000000000000000000000000000000000D3" as Address;
const HOOK = "0x0000000000000000000000000000000000008044" as Address;

// ---------------------------------------------------------------------------
// A fake Quoter with fixed prices: 1 WETH = $3,000, 1 DEMO = $1.50, plus a fee per hop.
// A route through the "thin" direct DEMO pool costs 20% more, like the real seeded pools.
// ---------------------------------------------------------------------------
const usdPer: Record<string, number> = { [WETH.toLowerCase()]: 3000, [DEMO.toLowerCase()]: 1.5, [USDC.toLowerCase()]: 1 };
const decimalsOf = (a: Address) => (a.toLowerCase() === USDC.toLowerCase() ? 6 : 18);
// Only the pools we seed exist: WETH/USDC 0.05%, DEMO/WETH 0.30%, DEMO/USDC 0.30% (thin), plus the same
// two token pairs with the CheckoutHook attached.
const POOLS = new Set([`${WETH}>${USDC}@500`, `${DEMO}>${WETH}@3000`, `${DEMO}>${USDC}@3000`]);
// Price impact grows with trade size, like real pools: the thin DEMO/USDC pool moves 2% per $1, the
// medium DEMO/WETH pool 0.5% per $1, and the deep WETH/USDC pool not at all.
function routeMultiplier(hops: Hop[], usd = 0, out: Address = USDC) {
  const exists = hops.every((h, i) => POOLS.has(`${h.tokenIn}>${hops[i + 1]?.tokenIn ?? out}@${h.fee}`));
  if (!exists) return null;
  const impactPerUsd = hops.length === 1 && hops[0]!.tokenIn === DEMO ? 0.02 : hops[0]!.tokenIn === DEMO ? 0.005 : 0;
  // like v4: the fee is taken from the input, so you put in 1/(1 - fee) more per hop
  return (1 + impactPerUsd * usd) * hops.reduce((m, h) => m / (1 - h.fee / 1_000_000), 1);
}
const fakeQuoter: Quoter = {
  async exactOut(hops, _settle, amountOut) {
    const usd = Number(amountOut) / 1e6;
    const m = routeMultiplier(hops, usd);
    if (m === null) return null;
    const tokens = (usd * m) / usdPer[hops[0]!.tokenIn.toLowerCase()]!;
    return { amountIn: BigInt(Math.ceil(tokens * 10 ** decimalsOf(hops[0]!.tokenIn))), gas: 100_000n };
  },
  async exactIn(hops, out, amountIn) {
    // `out` is the final token: USDC for whole routes, the next token when the basket quotes one hop at a time
    const m = routeMultiplier(hops, 0, out);
    if (m === null) return null;
    const usd = (Number(amountIn) / 10 ** decimalsOf(hops[0]!.tokenIn)) * usdPer[hops[0]!.tokenIn.toLowerCase()]!;
    return { amountOut: BigInt(Math.floor((usd / m / usdPer[out.toLowerCase()]!) * 10 ** decimalsOf(out))), gas: 100_000n };
  },
};

describe("paths", () => {
  it("enumerates direct and via-WETH routes for every fee tier", () => {
    const p = candidatePaths(DEMO, USDC, WETH);
    expect(p.filter((x) => x.length === 1)).toHaveLength(3);
    expect(p.filter((x) => x.length === 2)).toHaveLength(9);
    expect(candidatePaths(WETH, USDC, WETH)).toHaveLength(3); // no WETH->WETH->USDC
  });

  it("with a pool allowlist, only routes through vetted pools", () => {
    const allowed = [
      { a: WETH, b: USDC, fee: 500, tickSpacing: 10 },
      { a: DEMO, b: WETH, fee: 3000, tickSpacing: 60 },
      { a: USDC, b: DEMO, fee: 3000, tickSpacing: 60 }, // token order doesn't matter
    ];
    const demo = candidatePaths(DEMO, USDC, WETH, allowed);
    expect(demo).toHaveLength(2); // direct 0.30% and DEMO-0.30%->WETH-0.05%->USDC
    expect(candidatePaths(WETH, USDC, WETH, allowed)).toEqual([[{ tokenIn: WETH, fee: 500, tickSpacing: 10 }]]);
  });

  it("refuses a pool with the right tokens but an unvetted fee tier or tick spacing", () => {
    // On the real testnet the WETH/USDC 0.30% pool priced WETH absurdly: only the vetted 0.05%/10 pool may be used.
    const allowed = [{ a: WETH, b: USDC, fee: 500, tickSpacing: 10 }];
    const weth = candidatePaths(WETH, USDC, WETH, allowed);
    expect(weth).toEqual([[{ tokenIn: WETH, fee: 500, tickSpacing: 10 }]]);
    expect(weth.flat().some((h) => h.fee === 3000 || h.fee === 10000)).toBe(false);
    // same fee, different tick spacing = a different pool: refused too
    expect(candidatePaths(WETH, USDC, WETH, [{ a: WETH, b: USDC, fee: 500, tickSpacing: 60 }])).toEqual([]);
  });

  it("keeps hooked and plain pools apart: hooked entries never become plain routes, and vice versa", () => {
    const allowed = [
      { a: DEMO, b: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK },
      { a: WETH, b: USDC, fee: 500, tickSpacing: 10 },
    ];
    expect(candidatePaths(DEMO, USDC, WETH, allowed)).toEqual([]); // the only DEMO/USDC pool is hooked
    expect(hookedPaths(DEMO, USDC, allowed)).toEqual([[{ tokenIn: DEMO, fee: 3000, tickSpacing: 60, hooks: HOOK }]]);
    expect(hookedPaths(WETH, USDC, allowed)).toEqual([]); // WETH/USDC here is plain
  });

  it("the ranker never even quotes an unvetted pool", async () => {
    const asked: string[] = [];
    const spy: Quoter = {
      exactOut: async (hops, settle, amt) => (asked.push(hops.map((h) => h.fee).join(">")), fakeQuoter.exactOut(hops, settle, amt)),
      exactIn: async (hops, settle, amt) => (asked.push(hops.map((h) => h.fee).join(">")), fakeQuoter.exactIn(hops, settle, amt)),
    };
    await rankRoutes({ client: fakeClient({ balances: [0n, 10n ** 18n, 100n * 10n ** 18n] }), cfg, invoiceId: 1n, payer: "0x000000000000000000000000000000000000dEaD", quoter: spy, now: 1n });
    expect(asked.length).toBeGreaterThan(0);
    // cfg's allowlist is the seeded pools: WETH/USDC 0.05%, DEMO/WETH 0.30%, DEMO/USDC 0.30%
    for (const fees of asked) expect(["500", "3000", "3000>500"]).toContain(fees);
  });

  it("maps our Hop[] to the Quoter's PathKey[] for exact output (rename) and exact input (shifted)", () => {
    const hops: Hop[] = [
      { tokenIn: DEMO, fee: 3000, tickSpacing: 60 },
      { tokenIn: WETH, fee: 500, tickSpacing: 10 },
    ];
    expect(toExactOutPathKeys(hops).map((k) => k.intermediateCurrency)).toEqual([DEMO, WETH]);
    expect(toExactInPathKeys(hops, USDC).map((k) => k.intermediateCurrency)).toEqual([WETH, USDC]);
    expect(toExactOutPathKeys(hops).every((k) => k.hooks === zeroAddress)).toBe(true);
  });

  it("rounds the slippage buffer UP so maxAmountIn is never too small", () => {
    expect(withSlippage(10_000n, 50)).toBe(10_050n);
    expect(withSlippage(1n, 50)).toBe(2n);
  });
});

// ---------------------------------------------------------------------------
// rankRoutes with a fake chain client
// ---------------------------------------------------------------------------
function fakeClient(opts: { status?: number; expiry?: bigint; balances: bigint[] }) {
  return {
    readContract: async () => ({
      merchant: "0x000000000000000000000000000000000000beef",
      settleToken: USDC,
      amount: 10_000_000n, // 10 USDC
      expiry: opts.expiry ?? 2_000_000_000n,
      status: opts.status ?? 1,
      payer: zeroAddress,
      refunded: 0n,
      orderRef: "0x" + "00".repeat(32),
    }),
    multicall: async () => opts.balances, // [USDC, WETH, DEMO]
    getGasPrice: async () => 1_000_000_000n, // 1 gwei
  } as unknown as PublicClient;
}
const cfg = loadChains({ UNICHAIN_CHECKOUT: "0x0000000000000000000000000000000000000c0c", DEMO })["unichain-sepolia"];
const cfgHooked = loadChains({ UNICHAIN_CHECKOUT: "0x0000000000000000000000000000000000000c0c", DEMO, UNICHAIN_HOOK: HOOK })["unichain-sepolia"];

describe("rankRoutes", () => {
  it("prefers the deep two-hop DEMO route over the thin direct pool", async () => {
    const res = await rankRoutes({
      client: fakeClient({ balances: [0n, 0n, 100n * 10n ** 18n] }),
      cfg,
      invoiceId: 1n,
      payer: "0x000000000000000000000000000000000000dEaD",
      quoter: fakeQuoter,
      now: 1n,
    });
    const demoRoutes = res.routes.filter((r) => r.token.symbol === "DEMO" && r.source === "v4-quoter");
    expect(demoRoutes).toHaveLength(2); // direct 0.30% and DEMO->WETH(0.30%)->USDC(0.05%); 1% pools missing
    expect(res.recommended?.hops).toHaveLength(2);
    expect(res.recommended!.totalCostUsd).toBeLessThan(demoRoutes.find((r) => r.hops.length === 1)!.totalCostUsd);
    // buffers are sized from each route's measured impact: thin pool 20% -> capped at 3%; two-hop ~5% -> ~2.75%
    expect(demoRoutes.find((r) => r.hops.length === 1)!.slippageBps).toBe(300);
    expect(res.recommended!.slippageBps).toBeGreaterThan(200);
    expect(res.recommended!.slippageBps).toBeLessThan(300);
    // the deep WETH/USDC pool has no impact, so a WETH payer would get the 0.25% floor
    const wethRes = await rankRoutes({ client: fakeClient({ balances: [0n, 10n ** 18n, 0n] }), cfg, invoiceId: 1n, payer: "0x000000000000000000000000000000000000dEaD", quoter: fakeQuoter, now: 1n });
    expect(wethRes.recommended!.slippageBps).toBe(25);
    // overpay = fees (0.30% + 0.05% ≈ $0.035) + the medium pool's impact (5% ≈ $0.50)
    expect(res.recommended!.overpayUsd).toBeGreaterThan(0.5);
    expect(res.recommended!.overpayUsd).toBeLessThan(0.6);
    expect(res.ethUsd).toBeCloseTo(3000, 0); // WETH priced (fee removed) even though the payer holds none
  });

  it("marks routes the payer can't afford and skips them for the recommendation", async () => {
    const res = await rankRoutes({
      client: fakeClient({ balances: [0n, 0n, 6n * 10n ** 18n] }), // only 6 DEMO = $9
      cfg,
      invoiceId: 1n,
      payer: "0x000000000000000000000000000000000000dEaD",
      quoter: fakeQuoter,
      now: 1n,
    });
    expect(res.routes.filter((r) => r.token.symbol === "DEMO").every((r) => !r.affordable)).toBe(true);
    expect(res.recommended).toBeUndefined();
  });

  it("offers paying in USDC directly when the payer holds enough", async () => {
    const res = await rankRoutes({
      client: fakeClient({ balances: [20_000_000n, 0n, 0n] }),
      cfg,
      invoiceId: 1n,
      payer: "0x000000000000000000000000000000000000dEaD",
      quoter: fakeQuoter,
      now: 1n,
    });
    expect(res.recommended?.source).toBe("direct");
    expect(res.recommended?.amountIn).toBe(10_000_000n);
  });

  it("refuses invoices that are not payable", async () => {
    await expect(
      rankRoutes({ client: fakeClient({ status: 2, balances: [0n, 0n, 0n] }), cfg, invoiceId: 1n, payer: zeroAddress, quoter: fakeQuoter, now: 1n }),
    ).rejects.toThrow(RankError);
    await expect(
      rankRoutes({ client: fakeClient({ expiry: 5n, balances: [0n, 0n, 0n] }), cfg, invoiceId: 1n, payer: zeroAddress, quoter: fakeQuoter, now: 10n }),
    ).rejects.toThrow(/expired/);
  });
});

describe("rankRoutes: hook and split routes", () => {
  const client = () => fakeClient({ balances: [0n, 0n, 100n * 10n ** 18n] });
  const payer = "0x000000000000000000000000000000000000dEaD" as Address;

  it("offers a hooked-pool route that any router can execute, with the swap arguments", async () => {
    const res = await rankRoutes({ client: client(), cfg: cfgHooked, invoiceId: 1n, payer, quoter: fakeQuoter, now: 1n });
    const hook = res.routes.find((r) => r.source === "v4-hook")!;
    expect(hook).toBeDefined();
    expect(hook.hook!.pool.hooks).toBe(HOOK);
    expect(hook.hook!.router).toBe("0x9140a78c1a137c7ff1c151ec8231272af78a99a4");
    expect(hook.hook!.zeroForOne).toBe(DEMO.toLowerCase() < USDC.toLowerCase());
    const args = hookSwapArgs(hook.hook!, hook.maxAmountIn, 1n, payer);
    expect(args[1].amountSpecified).toBe(-hook.maxAmountIn); // exact input
    expect(args[3]).toBe(encodeHookData(1n, payer));
  });

  it("no hook configured: no hook routes", async () => {
    const res = await rankRoutes({ client: client(), cfg, invoiceId: 1n, payer, quoter: fakeQuoter, now: 1n });
    expect(res.routes.some((r) => r.source === "v4-hook")).toBe(false);
  });

  it("adds a split route when splitting across two paths beats the best single path", async () => {
    // $10 via WETH alone costs ~5% impact; 75% via WETH + 25% on the thin pool costs less in total
    const res = await rankRoutes({ client: client(), cfg, invoiceId: 1n, payer, quoter: fakeQuoter, now: 1n });
    const split = res.routes.find((r) => r.source === "split")!;
    expect(split).toBeDefined();
    expect(split.split).toHaveLength(2);
    expect(split.split![0]!.minOut + split.split![1]!.minOut).toBe(10_000_000n); // legs cover the whole invoice
    const bestSingle = res.routes.filter((r) => r.source === "v4-quoter" && r.token.symbol === "DEMO").sort((a, b) => a.totalCostUsd - b.totalCostUsd)[0]!;
    expect(split.amountIn).toBeLessThan(bestSingle.amountIn);
  });

  it("a fixed slippage overrides the impact-based buffer", async () => {
    const res = await rankRoutes({ client: client(), cfg, invoiceId: 1n, payer, quoter: fakeQuoter, slippageBps: 100, now: 1n });
    expect(res.routes.filter((r) => r.hops.length).every((r) => r.slippageBps === 100)).toBe(true);
  });

  it("bufferForImpact: floor 0.25%, half the impact on top, cap 3%", () => {
    expect(bufferForImpact(0)).toBe(25);
    expect(bufferForImpact(100)).toBe(75);
    expect(bufferForImpact(10_000)).toBe(300);
  });
});

describe("buildBasket", () => {
  const demoHops: Hop[] = [
    { tokenIn: DEMO, fee: 3000, tickSpacing: 60 },
    { tokenIn: WETH, fee: 500, tickSpacing: 10 },
  ];
  const wethHops: Hop[] = [{ tokenIn: WETH, fee: 500, tickSpacing: 10 }];

  it("uses USDC first, then the cheapest tokens, and guarantees the full invoice", async () => {
    const b = await buildBasket({
      quoter: fakeQuoter,
      settle: USDC,
      invoiceAmount: 10_000_000n,
      settleBalance: 4_000_000n,
      holdings: [
        { token: DEMO, balance: 3n * 10n ** 18n, hops: demoHops, costRatio: 1.004 }, // ~$4.48 of DEMO
        { token: WETH, balance: 10n ** 16n, hops: wethHops, costRatio: 1.0005 }, // $30 of WETH: covers the rest
      ],
    });
    expect(b.covers).toBe(true);
    expect(b.legs.map((l) => l.tokenIn)).toEqual([USDC, WETH]); // WETH is cheaper, and enough on its own
    expect(b.guaranteedOut).toBeGreaterThanOrEqual(10_000_000n);
  });

  it("spends whole balances when no single token is enough", async () => {
    const b = await buildBasket({
      quoter: fakeQuoter,
      settle: USDC,
      invoiceAmount: 10_000_000n,
      settleBalance: 4_000_000n,
      holdings: [
        { token: DEMO, balance: 3n * 10n ** 18n, hops: demoHops, costRatio: 1.004 },
        { token: WETH, balance: 10n ** 15n, hops: wethHops, costRatio: 1.0005 }, // $3 of WETH
      ],
    });
    expect(b.legs).toHaveLength(3);
    expect(b.covers).toBe(true);
    expect(b.guaranteedOut).toBeGreaterThanOrEqual(10_000_000n);
  });

  it("accounts for legs that share a pool: the second leg's minimum reflects the first leg's price impact", async () => {
    // A tiny constant-product AMM (x*y=k, 0.3% fee on input) with real reserves, so a trade really moves the
    // price for the next one. DEMO/WETH and WETH/USDC are each shallow: the DEMO leg (DEMO->WETH->USDC) and
    // the WETH leg (WETH->USDC) both cross WETH/USDC, exactly the case that failed on the fork.
    const reserves: Record<string, [bigint, bigint]> = {
      [`${DEMO}>${WETH}`]: [100n * 10n ** 18n, 5n * 10n ** 16n], // 100 DEMO : 0.05 WETH ($1.50 / $3,000)
      [`${WETH}>${USDC}`]: [2n * 10n ** 16n, 60_000_000n], // 0.02 WETH : 60 USDC
    };
    const swapOut = (pool: string, amountIn: bigint) => {
      const [x, y] = reserves[pool]!;
      const inAfterFee = (amountIn * 997n) / 1000n;
      return (y * inAfterFee) / (x + inAfterFee);
    };
    const amm: Quoter = {
      async exactIn(hops, out, amountIn) {
        let amt = amountIn;
        for (let i = 0; i < hops.length; i++) amt = swapOut(`${hops[i]!.tokenIn}>${hops[i + 1]?.tokenIn ?? out}`, amt);
        return { amountOut: amt, gas: 1n };
      },
      async exactOut() {
        return null; // force the spend-everything branch for both legs
      },
    };
    const demoBal = 10n * 10n ** 18n; // ~$15 of DEMO
    const wethBal = 4n * 10n ** 15n; // ~$12 of WETH
    const b = await buildBasket({
      quoter: amm,
      settle: USDC,
      invoiceAmount: 20_000_000n,
      settleBalance: 0n,
      slippageBps: 0,
      holdings: [
        { token: DEMO, balance: demoBal, hops: demoHops, costRatio: 1 },
        { token: WETH, balance: wethBal, hops: wethHops, costRatio: 1.01 },
      ],
    });
    // Replay the legs in order on a STATEFUL copy of the pools (reserves change after every swap), the way
    // the contract runs them in one transaction, independently of how the planner computed its numbers.
    const live = Object.fromEntries(Object.entries(reserves).map(([k, v]) => [k, [...v] as [bigint, bigint]]));
    const trade = (pool: string, amountIn: bigint) => {
      const r = live[pool]!;
      const inAfterFee = (amountIn * 997n) / 1000n;
      const out = (r[1] * inAfterFee) / (r[0] + inAfterFee);
      r[0] += inAfterFee;
      r[1] -= out;
      return out;
    };
    const leg1 = trade(`${WETH}>${USDC}`, trade(`${DEMO}>${WETH}`, demoBal));
    const leg2 = trade(`${WETH}>${USDC}`, wethBal);
    for (const [i, delivered] of [leg1, leg2].entries()) {
      expect(delivered).toBeGreaterThanOrEqual(b.legs[i]!.minOut); // the contract's LegBelowMin check passes
      expect(delivered - b.legs[i]!.minOut).toBeLessThanOrEqual(2n); // and the minimum isn't needlessly loose
    }
    // The naive stand-alone quote for the WETH leg would have promised more than it can deliver.
    expect(swapOut(`${WETH}>${USDC}`, wethBal)).toBeGreaterThan(leg2);
  });

  it("reports when the wallet simply doesn't hold enough", async () => {
    const b = await buildBasket({
      quoter: fakeQuoter,
      settle: USDC,
      invoiceAmount: 10_000_000n,
      settleBalance: 1_000_000n,
      holdings: [{ token: DEMO, balance: 10n ** 18n, hops: demoHops, costRatio: 1 }],
    });
    expect(b.covers).toBe(false);
  });
});

describe("Trading API parser", () => {
  const sample = (route: unknown) => ({
    routing: "CLASSIC",
    quote: { input: { amount: "3341000000000000" }, route, gasUseEstimate: "120000", gasFeeUSD: "0.01", priceImpact: "0.02" },
  });

  it("turns an all-v4, hook-free route into executable hops", () => {
    const q = parseTradingApiQuote(
      sample([[{ type: "v4-pool", tokenIn: { address: WETH }, tokenOut: { address: USDC }, fee: "500", tickSpacing: "10", hooks: zeroAddress }]]),
    )!;
    expect(q.amountIn).toBe(3_341_000_000_000_000n);
    expect(q.hops).toEqual([{ tokenIn: WETH, fee: 500, tickSpacing: 10 }]);
    expect(q.gasUseEstimate).toBe(120_000n);
  });

  it("keeps v3 or hooked routes for comparison but marks them non-executable", () => {
    expect(parseTradingApiQuote(sample([[{ type: "v3-pool", tokenIn: { address: WETH }, tokenOut: { address: USDC }, fee: "500" }]]))!.hops).toBeNull();
    expect(
      parseTradingApiQuote(sample([[{ type: "v4-pool", tokenIn: { address: WETH }, fee: "500", tickSpacing: "10", hooks: "0x0000000000000000000000000000000000000044" }]]))!.hops,
    ).toBeNull();
    expect(parseTradingApiQuote({ error: "No quotes available" })).toBeNull();
  });

  it("keeps a multi-hop v4 route in order, with its label, impact and gas fee", () => {
    const q = parseTradingApiQuote(
      sample([
        [
          { type: "v4-pool", tokenIn: { address: DEMO }, tokenOut: { address: WETH }, fee: "3000", tickSpacing: "60", hooks: zeroAddress },
          { type: "v4-pool", tokenIn: { address: WETH }, tokenOut: { address: USDC }, fee: "500", tickSpacing: "10", hooks: zeroAddress },
        ],
      ]),
    )!;
    expect(q.hops).toEqual([
      { tokenIn: DEMO, fee: 3000, tickSpacing: 60 },
      { tokenIn: WETH, fee: 500, tickSpacing: 10 },
    ]);
    expect(q.protocols).toBe("v4 > v4");
    expect(q.priceImpactPct).toBe(0.02);
    expect(q.gasFeeUsd).toBe(0.01);
  });

  it("labels split routes as non-executable and rejects quotes without an input amount", () => {
    const pool = { type: "v4-pool", tokenIn: { address: WETH }, fee: "500", tickSpacing: "10", hooks: zeroAddress };
    const split = parseTradingApiQuote(sample([[pool], [pool]]))!;
    expect(split.hops).toBeNull();
    expect(split.protocols).toBe("split across 2 routes");
    expect(parseTradingApiQuote({ quote: { route: [[pool]] } })).toBeNull(); // no input.amount
    expect(parseTradingApiQuote({ quote: { input: { amount: "" }, route: [[pool]] } })).toBeNull();
  });
});

describe("Hedera mirror node + CSV", () => {
  const mirror = {
    transactions: [
      {
        transaction_id: "0.0.5555-1730700000-123456789",
        consensus_timestamp: "1730700003.000000001",
        result: "SUCCESS",
        token_transfers: [
          { token_id: "0.0.429274", account: "0.0.5555", amount: -50000 },
          { token_id: "0.0.429274", account: "0.0.7777", amount: 50000 },
        ],
      },
      { transaction_id: "0.0.1-1-1", consensus_timestamp: "1.0", result: "INSUFFICIENT_PAYER_BALANCE", token_transfers: [] },
    ],
  };

  it("finds successful USDC payments to the merchant", () => {
    const sales = parseMirrorSales(mirror, "0.0.7777");
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ payer: "0.0.5555", amount: 50_000n });
    expect(sales[0]!.hashscanUrl).toBe("https://hashscan.io/testnet/transaction/0.0.5555-1730700000-123456789");
  });

  it("converts SDK transaction ids to the mirror-node format", () => {
    expect(toMirrorTxId("0.0.5555@1730700000.123456789")).toBe("0.0.5555-1730700000-123456789");
    expect(hashscanTxUrl("0.0.5555@1730700000.123456789")).toContain("0.0.5555-1730700000-123456789");
  });

  it("writes RFC-4180 CSV", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    const csv = toCsv(hederaRows(parseMirrorSales(mirror, "0.0.7777")));
    expect(csv.split("\n")[0]).toBe("date_utc,rail,invoice_id,order_ref,status,currency,amount,refunded,net,payer,paid_with,paid_with_amount,tx");
    expect(csv).toContain("hedera-x402");
    expect(csv).toContain(",0.05,0,0.05,0.0.5555,USDC,0.05,");
  });
});

describe("HCS audit log", () => {
  it("decodes topic messages newest first and parses JSON bodies", () => {
    const body = { kind: "purchase", merchant: "localhost:8788", amountUsd: 0.05, txId: "0.0.5-1-1" };
    const json = {
      messages: [
        { sequence_number: 1, consensus_timestamp: "1730700000.1", payer_account_id: "0.0.5", message: Buffer.from(JSON.stringify(body)).toString("base64") },
        { sequence_number: 2, consensus_timestamp: "1730700050.1", payer_account_id: "0.0.5", message: Buffer.from("not json").toString("base64") },
      ],
    };
    const entries = parseTopicMessages(json);
    expect(entries.map((e) => e.sequence)).toEqual([2, 1]);
    expect(entries[1]!.body).toMatchObject({ kind: "purchase", amountUsd: 0.05 });
    expect(entries[0]!.body).toBeNull();
    expect(entries[0]!.raw).toBe("not json");
  });

  it("asks the mirror node for the right topic, newest first, with a limit", async () => {
    let asked: URL | undefined;
    const fetchImpl = (async (u: URL) => {
      asked = new URL(String(u));
      return new Response(JSON.stringify({ messages: [] }));
    }) as unknown as typeof fetch;
    await listAuditLog({ topicId: "0.0.4242", limit: 7, mirrorUrl: "https://mirror.example", fetchImpl });
    expect(asked!.origin + asked!.pathname).toBe("https://mirror.example/api/v1/topics/0.0.4242/messages");
    expect(asked!.searchParams.get("order")).toBe("desc");
    expect(asked!.searchParams.get("limit")).toBe("7");
  });

  it("raises a mirror-node error instead of showing an empty log", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(listAuditLog({ topicId: "0.0.4242", fetchImpl })).rejects.toThrow("mirror node 503");
  });

  it("returns an empty list for a topic with no messages (or no messages field)", () => {
    expect(parseTopicMessages({ messages: [] })).toEqual([]);
    expect(parseTopicMessages({})).toEqual([]);
    expect(parseTopicMessages(null)).toEqual([]);
  });
});

describe("onchainQuoter batching", () => {
  it("sends quotes issued in the same tick as one multicall, and maps failures to null", async () => {
    let multicalls = 0;
    let singles = 0;
    const client = {
      multicall: async ({ contracts }: { contracts: unknown[] }) => {
        multicalls++;
        return contracts.map((_, i) => (i === 1 ? { status: "failure" } : { status: "success", result: [BigInt(100 + i), 50_000n] }));
      },
      simulateContract: async () => {
        singles++;
        return { result: [7n, 1n] };
      },
    } as unknown as PublicClient;
    const q = onchainQuoter(client, "0x0000000000000000000000000000000000000001");
    const hops: Hop[] = [{ tokenIn: WETH, fee: 500, tickSpacing: 10 }];
    const [a, b, c] = await Promise.all([q.exactOut(hops, USDC, 1n), q.exactOut(hops, USDC, 2n), q.exactIn(hops, USDC, 3n)]);
    expect(multicalls).toBe(1);
    expect(singles).toBe(0);
    expect(a).toEqual({ amountIn: 100n, gas: 50_000n });
    expect(b).toBeNull(); // the failed pool quote
    expect(c).toEqual({ amountOut: 102n, gas: 50_000n });
    // a lone call skips the multicall
    expect(await q.exactOut(hops, USDC, 1n)).toEqual({ amountIn: 7n, gas: 1n });
    expect(singles).toBe(1);
  });

  it("sends quotes from separate ticks as separate batches", async () => {
    const batchSizes: number[] = [];
    const client = {
      multicall: async ({ contracts }: { contracts: unknown[] }) => {
        batchSizes.push(contracts.length);
        return contracts.map(() => ({ status: "success", result: [1n, 1n] }));
      },
      simulateContract: async () => ({ result: [1n, 1n] }),
    } as unknown as PublicClient;
    const q = onchainQuoter(client, "0x0000000000000000000000000000000000000001");
    const hops: Hop[] = [{ tokenIn: WETH, fee: 500, tickSpacing: 10 }];
    await Promise.all([q.exactOut(hops, USDC, 1n), q.exactOut(hops, USDC, 2n)]);
    await Promise.all([q.exactOut(hops, USDC, 3n), q.exactOut(hops, USDC, 4n), q.exactOut(hops, USDC, 5n)]);
    expect(batchSizes).toEqual([2, 3]);
  });

  it("falls back to one call per quote when Multicall3 fails, and a failing pool doesn't break the others", async () => {
    let n = 0;
    const client = {
      multicall: async () => {
        throw new Error("no multicall3 on this chain");
      },
      simulateContract: async () => {
        n++;
        if (n === 2) throw new Error("pool has no liquidity");
        return { result: [BigInt(10 * n), 5n] };
      },
    } as unknown as PublicClient;
    const q = onchainQuoter(client, "0x0000000000000000000000000000000000000001");
    const hops: Hop[] = [{ tokenIn: WETH, fee: 500, tickSpacing: 10 }];
    const res = await Promise.all([q.exactOut(hops, USDC, 1n), q.exactOut(hops, USDC, 2n), q.exactOut(hops, USDC, 3n)]);
    expect(n).toBe(3);
    expect(res.filter((r) => r === null)).toHaveLength(1);
    expect(res.filter(Boolean)).toHaveLength(2);
  });
});
