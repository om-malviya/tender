import { getAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { checkoutCoreAbi, uniswapCheckoutAbi } from "./abi.ts";
import type { ChainConfig, ChainKey } from "./config.ts";

/** Everything the merchant dashboard and the CSV export need about one invoice. */
export interface InvoiceRecord {
  chain: ChainKey;
  id: bigint;
  merchant: Address;
  settleToken: Address;
  amount: bigint;
  expiry: bigint;
  orderRef: Hex;
  status: "Open" | "Paid" | "Cancelled" | "Expired";
  createdAt?: number;
  createdTx: Hex;
  payer?: Address;
  paidWith?: Address; // the token the payer spent (address(0) = basket of several tokens)
  paidAmount?: bigint;
  paidAt?: number;
  paidTx?: Hex;
  basket?: { tokens: readonly Address[]; amounts: readonly bigint[] };
  refunded: bigint;
  refunds: { amount: bigint; tx: Hex; at?: number }[];
  cancelledTx?: Hex;
}

const events = {
  created: getAbiItem({ abi: checkoutCoreAbi, name: "InvoiceCreated" }),
  paid: getAbiItem({ abi: checkoutCoreAbi, name: "InvoicePaid" }),
  refunded: getAbiItem({ abi: checkoutCoreAbi, name: "Refunded" }),
  cancelled: getAbiItem({ abi: checkoutCoreAbi, name: "Cancelled" }),
  basket: getAbiItem({ abi: uniswapCheckoutAbi, name: "BasketPaid" }),
};

type Log = { args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint };

/** Logs already fetched, per chain + contract + event + filter, up to block `to`. Later calls only fetch newer
 *  blocks, so the dashboard stays fast as the chain grows (Unichain makes ~1 block per second). */
const logCache = new Map<string, { to: bigint; logs: Log[] }>();

/** Runs `fn` over `items` with at most `limit` in flight (public RPCs dislike floods). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/**
 * Rebuilds a merchant's invoice history from the contract's EVENTS (not storage): events carry the
 * transaction hash and block, which the dashboard links to and the CSV needs. Public RPCs limit how many
 * blocks one getLogs call may cover (cfg.logChunk), so the range is scanned in chunks, a few in parallel,
 * and remembered between calls.
 */
export async function listInvoices(args: {
  client: PublicClient;
  cfg: ChainConfig;
  merchant: Address;
  now?: bigint;
}): Promise<InvoiceRecord[]> {
  const { client, cfg, merchant } = args;
  if (!cfg.checkout) return [];
  const address = cfg.checkout;
  // cacheTime 0: viem caches the block number for ~4s by default, which would hide a refund made just now
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const chunk = cfg.logChunk;

  const scan = async <E extends (typeof events)[keyof typeof events]>(event: E, filter?: Record<string, unknown>) => {
    const key = `${cfg.chain.id}:${address}:${event.name}:${JSON.stringify(filter ?? {})}`;
    const cached = logCache.get(key);
    const start = cached ? cached.to + 1n : cfg.deployBlock;
    const ranges: [bigint, bigint][] = [];
    for (let from = start; from <= latest; from += chunk) ranges.push([from, from + chunk - 1n > latest ? latest : from + chunk - 1n]);
    const fetched = await mapLimit(ranges, 6, async ([fromBlock, toBlock]) =>
      (await client.getLogs({ address, event: event as never, args: filter as never, fromBlock, toBlock })) as unknown as Log[],
    );
    const logs = [...(cached?.logs ?? []), ...fetched.flat()];
    logCache.set(key, { to: latest, logs });
    return logs;
  };

  const [created, paid, refunded, cancelled] = await Promise.all([
    scan(events.created, { merchant }),
    scan(events.paid, { merchant }),
    scan(events.refunded, { merchant }),
    scan(events.cancelled, { merchant }),
  ]);
  // BasketPaid isn't indexed by merchant; it only exists on the Uniswap contract.
  const baskets = cfg.swaps ? await scan(events.basket).catch(() => []) : [];

  // Block timestamps for the dates in the dashboard/CSV (one lookup per distinct block).
  const blocks = [...new Set([...created, ...paid, ...refunded].map((l) => l.blockNumber))];
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async (b) => times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))));

  const byId = new Map<bigint, InvoiceRecord>();
  for (const l of created) {
    const a = l.args as { id: bigint; merchant: Address; settleToken: Address; amount: bigint; expiry: bigint; orderRef: Hex };
    byId.set(a.id, {
      chain: cfg.key,
      id: a.id,
      merchant: a.merchant,
      settleToken: a.settleToken,
      amount: a.amount,
      expiry: a.expiry,
      orderRef: a.orderRef,
      status: "Open",
      createdAt: times.get(l.blockNumber),
      createdTx: l.transactionHash,
      refunded: 0n,
      refunds: [],
    });
  }
  for (const l of paid) {
    const a = l.args as { id: bigint; payer: Address; tokenIn: Address; amountIn: bigint };
    const r = byId.get(a.id);
    if (!r) continue;
    Object.assign(r, { status: "Paid", payer: a.payer, paidWith: a.tokenIn, paidAmount: a.amountIn, paidTx: l.transactionHash, paidAt: times.get(l.blockNumber) });
  }
  for (const l of baskets) {
    const a = l.args as { id: bigint; tokensIn: readonly Address[]; amountsIn: readonly bigint[] };
    const r = byId.get(a.id);
    if (r) r.basket = { tokens: a.tokensIn, amounts: a.amountsIn };
  }
  for (const l of refunded) {
    const a = l.args as { id: bigint; amount: bigint; totalRefunded: bigint };
    const r = byId.get(a.id);
    if (!r) continue;
    r.refunds.push({ amount: a.amount, tx: l.transactionHash, at: times.get(l.blockNumber) });
    r.refunded = a.totalRefunded;
  }
  for (const l of cancelled) {
    const r = byId.get((l.args as { id: bigint }).id);
    if (r) Object.assign(r, { status: "Cancelled", cancelledTx: l.transactionHash });
  }

  const now = args.now ?? BigInt(Math.floor(Date.now() / 1000));
  for (const r of byId.values()) if (r.status === "Open" && now > r.expiry) r.status = "Expired";
  return [...byId.values()].sort((x, y) => Number(y.id - x.id)); // newest first
}
