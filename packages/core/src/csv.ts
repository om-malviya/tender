import { formatUnits, zeroAddress, type Address } from "viem";
import type { HederaSale } from "./hedera.ts";
import type { InvoiceRecord } from "./invoices.ts";

/** Accountant export: one row per sale, across all three payment rails. */
export const CSV_HEADERS = [
  "date_utc",
  "rail",
  "invoice_id",
  "order_ref",
  "status",
  "currency",
  "amount",
  "refunded",
  "net",
  "payer",
  "paid_with",
  "paid_with_amount",
  "tx",
] as const;

type Row = Record<(typeof CSV_HEADERS)[number], string>;

/** RFC 4180 quoting: wrap in quotes if the value has a comma, quote or newline; double inner quotes. */
export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: Row[]): string {
  return [CSV_HEADERS.join(","), ...rows.map((r) => CSV_HEADERS.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n";
}

const iso = (unix?: number) => (unix ? new Date(unix * 1000).toISOString() : "");

export function invoiceRows(
  records: InvoiceRecord[],
  opts: {
    /** The stablecoin an invoice is priced in (symbol + decimals), e.g. USDC on Unichain, USDT on Whitechain. */
    settle: (r: InvoiceRecord) => { symbol: string; decimals: number };
    tokenLabel?: (addr: Address) => { symbol: string; decimals: number } | undefined;
    txUrl: (chain: InvoiceRecord["chain"], hash: string) => string;
  },
): Row[] {
  return records.map((r) => {
    const { symbol, decimals: d } = opts.settle(r);
    const paidWith = r.paidWith === zeroAddress ? { symbol: "basket", decimals: 0 } : r.paidWith ? opts.tokenLabel?.(r.paidWith) : undefined;
    return {
      date_utc: iso(r.paidAt ?? r.createdAt),
      rail: r.chain,
      invoice_id: r.id.toString(),
      order_ref: r.orderRef,
      status: r.status,
      currency: symbol,
      amount: formatUnits(r.amount, d),
      refunded: formatUnits(r.refunded, d),
      net: r.status === "Paid" ? formatUnits(r.amount - r.refunded, d) : "0",
      payer: r.payer ?? "",
      paid_with: paidWith?.symbol ?? (r.paidWith ?? ""),
      paid_with_amount: r.paidAmount !== undefined && paidWith && paidWith.decimals ? formatUnits(r.paidAmount, paidWith.decimals) : "",
      tx: r.paidTx ? opts.txUrl(r.chain, r.paidTx) : opts.txUrl(r.chain, r.createdTx),
    };
  });
}

export function hederaRows(sales: HederaSale[]): Row[] {
  return sales.map((s) => ({
    date_utc: iso(Math.floor(s.timestamp)),
    rail: "hedera-x402",
    invoice_id: "",
    order_ref: s.txId,
    status: "Paid",
    currency: s.symbol,
    amount: formatUnits(s.amount, s.decimals),
    refunded: "0",
    net: formatUnits(s.amount, s.decimals),
    payer: s.payer,
    paid_with: s.symbol,
    paid_with_amount: formatUnits(s.amount, s.decimals),
    tx: s.hashscanUrl,
  }));
}
