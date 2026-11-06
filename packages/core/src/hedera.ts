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
};

/** Pulls successful token payments INTO the merchant's account out of a mirror-node response. */
export function parseMirrorSales(json: unknown, merchant: string, tokenId = HEDERA_TESTNET_USDC): HederaSale[] {
  const txs = ((json as { transactions?: MirrorTx[] })?.transactions ?? []).filter((t) => t.result === "SUCCESS");
  const sales: HederaSale[] = [];
  for (const t of txs) {
    const moves = (t.token_transfers ?? []).filter((x) => x.token_id === tokenId);
    const received = moves.find((x) => x.account === merchant && x.amount > 0);
    if (!received) continue;
    sales.push({
      txId: t.transaction_id,
      timestamp: Number(t.consensus_timestamp),
      payer: moves.find((x) => x.amount < 0)?.account ?? "unknown",
      amount: BigInt(received.amount),
      tokenId,
      symbol: HEDERA_TOKENS[tokenId]?.symbol ?? tokenId,
      decimals: HEDERA_TOKENS[tokenId]?.decimals ?? 0,
      hashscanUrl: hashscanTxUrl(t.transaction_id),
    });
  }
  return sales;
}

/** The merchant's recent Hedera sales, read from the public mirror node (no keys needed). */
export async function listHederaSales(args: {
  merchant: string;
  tokenId?: string;
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
  return parseMirrorSales(await res.json(), args.merchant, args.tokenId);
}
