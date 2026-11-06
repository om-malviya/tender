import type { Address, Hex } from "viem";

// Typed client for the Tender API (server/src/app.ts). Token amounts arrive as decimal STRINGS
// because JSON can't hold bigint; convert with BigInt(...) before doing maths or sending transactions.

export type ChainKey = "unichain-sepolia" | "whitechain-sepolia";
export interface Token {
  address: Address;
  symbol: string;
  decimals: number;
}
export interface PublicChain {
  key: ChainKey;
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorer: string;
  checkout: Address | null;
  settleToken: Token;
  swaps: boolean;
  tokens: Token[];
}
export interface AppConfig {
  chains: PublicChain[];
  demoMerchant?: Address;
  hederaMerchant?: string;
  hederaTopic?: string;
  shopUrl?: string;
  devWalletAccounts?: Address[];
}
export type InvoiceStatus = "Open" | "Paid" | "Cancelled" | "Expired" | "None";
export interface InvoiceView {
  chain: ChainKey;
  id: string;
  merchant: Address;
  settleToken: Address;
  amount: string;
  expiry: string;
  status: InvoiceStatus;
  payer: Address;
  refunded: string;
  orderRef: Hex;
  settleSymbol: string;
  checkout: Address;
}
export interface Hop {
  tokenIn: Address;
  fee: number;
  tickSpacing: number;
}
export interface SplitLegView {
  hops: Hop[];
  amountIn: string;
  minOut: string;
}
export interface HookRouteView {
  router: Address;
  pool: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
  zeroForOne: boolean;
}
export interface RouteView {
  source: "direct" | "v4-quoter" | "uniswap-api" | "v4-hook" | "split";
  token: Token;
  hops: Hop[];
  label: string;
  amountIn: string;
  maxAmountIn: string;
  slippageBps: number;
  impactBps: number;
  split?: SplitLegView[];
  hook?: HookRouteView;
  balance: string;
  gasUnits: string;
  gasUsd: number;
  inputUsd: number;
  overpayUsd: number;
  totalCostUsd: number;
  affordable: boolean;
  executable: boolean;
  note?: string;
}
export interface RankView {
  invoice: { id: string; amount: string; settleToken: Token; merchant: Address; expiry: string };
  routes: RouteView[];
  recommended?: RouteView;
  usdPerToken: Record<string, number>;
  ethUsd: number;
}
export interface BasketView {
  legs: { tokenIn: Address; amountIn: string; path: Hop[]; minOut: string }[];
  guaranteedOut: string;
  covers: boolean;
}
export interface InvoiceRecordView {
  chain: ChainKey;
  id: string;
  merchant: Address;
  settleToken: Address;
  amount: string;
  expiry: string;
  orderRef: Hex;
  status: Exclude<InvoiceStatus, "None">;
  createdAt?: number;
  createdTx: Hex;
  payer?: Address;
  paidWith?: Address;
  paidAmount?: string;
  paidAt?: number;
  paidTx?: Hex;
  basket?: { tokens: Address[]; amounts: string[] };
  refunded: string;
  refunds: { amount: string; tx: Hex; at?: number }[];
}
export interface AuditEntryView {
  sequence: number;
  consensusAt: number;
  payer: string;
  body: { kind?: string; merchant?: string; amountUsd?: number; txId?: string; reason?: string; totalSpentUsd?: number } | null;
  raw: string;
}
export interface HederaSaleView {
  txId: string;
  timestamp: number;
  payer: string;
  amount: string;
  tokenId: string;
  symbol: string;
  decimals: number;
  usd: number; // USDC at face value, HBAR at the server's configured rate
  hashscanUrl: string;
}

const BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `${res.status} ${res.statusText}`);
  return body as T;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  config: () => request<AppConfig>("/api/config"),
  invoice: (chain: ChainKey, id: string) => request<InvoiceView>(`/api/invoices/${chain}/${id}`),
  rank: (chain: ChainKey, invoiceId: string, payer: Address) => post<RankView>("/api/rank", { chain, invoiceId, payer }),
  basket: (chain: ChainKey, invoiceId: string, payer: Address) => post<BasketView>("/api/basket", { chain, invoiceId, payer }),
  invoices: (merchant: Address) => request<{ invoices: InvoiceRecordView[] }>(`/api/invoices?merchant=${merchant}`),
  hederaSales: (account: string) => request<{ sales: HederaSaleView[] }>(`/api/hedera/sales?account=${account}`),
  auditLog: (topic: string) => request<{ entries: AuditEntryView[] }>(`/api/hedera/audit?topic=${topic}`),
  csvUrl: (merchant: Address, hedera?: string) =>
    `${BASE}/api/export.csv?merchant=${merchant}${hedera ? `&hedera=${hedera}` : ""}`,
};
