/** Hedera testnet USDC (an HTS token). Same constant the @x402/hedera library ships with. */
export const HEDERA_TESTNET_USDC = "0.0.429274";
/** Tokens we can label: HTS token id -> symbol + decimals (HBAR itself is "0.0.0", 8 decimals). */
export const HEDERA_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [HEDERA_TESTNET_USDC]: { symbol: "USDC", decimals: 6 },
  "0.0.0": { symbol: "HBAR", decimals: 8 },
};
export const HEDERA_TESTNET_MIRROR = "https://testnet.mirrornode.hedera.com";

/** One payment an agent made to the merchant over x402 on Hedera. */
export interface HederaSale {
  txId: string; // mirror-node format: 0.0.123-1700000000-123456789
  timestamp: number; // unix seconds (consensus time)
  payer: string;
  amount: bigint; // atomic units: divide by 10^decimals
  tokenId: string;
  symbol: string;
  decimals: number;
  /** value in USD: USDC at face value, HBAR at the configured rate (testnet HBAR has no market price) */
  usd: number;
  hashscanUrl: string;
}

/** "0.0.123@1700000000.123456789" (SDK format) -> "0.0.123-1700000000-123456789" (mirror node / HashScan). */
export function toMirrorTxId(txId: string): string {
  if (!txId.includes("@")) return txId;
  const [account, time] = txId.split("@") as [string, string];
  return `${account}-${time.replace(".", "-")}`;
}

export const hashscanTxUrl = (txId: string, network = "testnet") =>
  `https://hashscan.io/${network}/transaction/${toMirrorTxId(txId)}`;

type MirrorTx = {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
  transfers?: { account: string; amount: number }[];
};

/**
 * Pulls successful payments INTO the merchant's account out of a mirror-node response: HTS token payments
 * (USDC), and native HBAR payments when `hbarUsd` is given. An HBAR transfer only counts as a sale when ONE
 * other account sent exactly what the merchant received; that leaves out network fees (paid by the x402
 * facilitator) and anything that isn't a plain payment.
 */
export function parseMirrorSales(json: unknown, merchant: string, tokenId = HEDERA_TESTNET_USDC, hbarUsd?: number): HederaSale[] {
  const txs = ((json as { transactions?: MirrorTx[] })?.transactions ?? []).filter((t) => t.result === "SUCCESS");
  const sales: HederaSale[] = [];
  const sale = (t: MirrorTx, payer: string, amount: number, id: string, usd: number) =>
    sales.push({
      txId: t.transaction_id,
      timestamp: Number(t.consensus_timestamp),
      payer,
      amount: BigInt(amount),
      tokenId: id,
      symbol: HEDERA_TOKENS[id]?.symbol ?? id,
      decimals: HEDERA_TOKENS[id]?.decimals ?? 0,
      usd,
      hashscanUrl: hashscanTxUrl(t.transaction_id),
    });
  for (const t of txs) {
    const moves = (t.token_transfers ?? []).filter((x) => x.token_id === tokenId);
    const received = moves.find((x) => x.account === merchant && x.amount > 0);
    if (received) {
      const decimals = HEDERA_TOKENS[tokenId]?.decimals ?? 0;
      sale(t, moves.find((x) => x.amount < 0)?.account ?? "unknown", received.amount, tokenId, received.amount / 10 ** decimals);
      continue;
    }
    if (!hbarUsd) continue;
    const got = (t.transfers ?? []).find((x) => x.account === merchant && x.amount > 0);
    const payer = got && (t.transfers ?? []).find((x) => x.amount === -got.amount);
    if (got && payer) sale(t, payer.account, got.amount, "0.0.0", (got.amount / 1e8) * hbarUsd);
  }
  return sales;
}

/** The merchant's recent Hedera sales, read from the public mirror node (no keys needed). */
export async function listHederaSales(args: {
  merchant: string;
  tokenId?: string;
  /** USD per HBAR: set it to count native-HBAR sales too */
  hbarUsd?: number;
  mirrorUrl?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<HederaSale[]> {
  const url = new URL("/api/v1/transactions", args.mirrorUrl ?? HEDERA_TESTNET_MIRROR);
  url.searchParams.set("account.id", args.merchant);
  url.searchParams.set("transactiontype", "CRYPTOTRANSFER");
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(args.limit ?? 50));
  const res = await (args.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`mirror node ${res.status}`);
  return parseMirrorSales(await res.json(), args.merchant, args.tokenId, args.hbarUsd);
}

/** One entry of the agent's spending audit log, as written to a Hedera Consensus Service topic. */
export interface AuditEntry {
  sequence: number; // HCS sequence number (gapless, ordered by consensus)
  consensusAt: number; // unix seconds
  payer: string; // the account that submitted the message
  /** the message body the agent wrote (see agent/src/run.ts); unknown shapes are kept raw */
  body: { kind?: string; merchant?: string; amountUsd?: number; txId?: string; decision?: string; reason?: string; at?: string; [k: string]: unknown } | null;
  raw: string;
}

/** Decodes mirror-node topic messages (base64 bodies) into audit entries, newest first. */
export function parseTopicMessages(json: unknown): AuditEntry[] {
  const msgs = (json as { messages?: { sequence_number: number; consensus_timestamp: string; payer_account_id: string; message: string }[] })?.messages ?? [];
  return msgs
    .map((m) => {
      // base64 -> UTF-8 without Node's Buffer, so this also runs in the browser build
      const raw = new TextDecoder().decode(Uint8Array.from(atob(m.message), (c) => c.charCodeAt(0)));
      let body: AuditEntry["body"] = null;
      try {
        body = JSON.parse(raw);
      } catch {}
      return { sequence: m.sequence_number, consensusAt: Number(m.consensus_timestamp), payer: m.payer_account_id, body, raw };
    })
    .sort((a, b) => b.sequence - a.sequence);
}

/** The audit topic's messages from the public mirror node (no keys needed). */
export async function listAuditLog(args: { topicId: string; mirrorUrl?: string; limit?: number; fetchImpl?: typeof fetch }): Promise<AuditEntry[]> {
  const url = new URL(`/api/v1/topics/${args.topicId}/messages`, args.mirrorUrl ?? HEDERA_TESTNET_MIRROR);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(args.limit ?? 50));
  const res = await (args.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`mirror node ${res.status}`);
  return parseTopicMessages(await res.json());
}

export const hashscanTopicUrl = (topicId: string, network = "testnet") => `https://hashscan.io/${network}/topic/${topicId}`;
