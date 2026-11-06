import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { keccak256, parseEventLogs, parseUnits, toHex } from "viem";
import { useConnection } from "wagmi";
import { checkoutCoreAbi } from "@tender/core";
import { api, type ChainKey, type InvoiceRecordView } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { age, amount, short, tokenOf } from "../lib/format.ts";
import { errorText, useTx } from "../lib/tx.ts";
import { Addr, ChainPill, Empty, PageHeader, Panel, Spinner, StatusPill } from "../components/ui.tsx";

const FILTERS = ["All", "Open", "Paid", "Refunded", "Cancelled", "Expired"] as const;

/** The merchant view: create invoices, see every payment on both chains, refund, cancel, export CSV. */
export function MerchantPage() {
  const cfg = useAppConfig();
  const { address } = useConnection();
  const merchant = address ?? cfg.demoMerchant;
  const readOnly = !address;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const invoicesQ = useQuery({ queryKey: ["invoices", merchant], queryFn: () => api.invoices(merchant!), enabled: Boolean(merchant), refetchInterval: 15_000 });
  const all = invoicesQ.data?.invoices ?? [];
  const shown = all.filter((i) =>
    filter === "All" ? true : filter === "Refunded" ? i.refunded !== "0" : i.status === filter && !(filter === "Paid" && i.refunded !== "0"),
  );

  return (
    <>
      <PageHeader
        crumb={["Merchant"]}
        title="Merchant"
        subtitle={readOnly ? <>Read-only view of the demo merchant. Connect the merchant wallet to create invoices and refund.</> : <>Signed in as <Addr value={address} /></>}
        actions={
          merchant && (
            <a className="btn" href={api.csvUrl(merchant, cfg.hederaMerchant)}>
              Export CSV
            </a>
          )
        }
      />

      {!readOnly && <CreateInvoice />}

      <Panel
        title="Invoices"
        subtitle="Both chains, rebuilt from on-chain events. Refunds go back to the original payer only."
        actions={
          <div className="row" style={{ gap: 6 }}>
            {FILTERS.map((f) => (
              <button key={f} className={`btn small${f === filter ? " primary" : ""}`} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Rail</th>
                <th>Order ref</th>
                <th className="num">Amount</th>
                <th className="num">Refunded</th>
                <th>Payer</th>
                <th>Status</th>
                <th>Age</th>
                {!readOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <InvoiceRow key={`${i.chain}-${i.id}`} inv={i} readOnly={readOnly} />
              ))}
            </tbody>
          </table>
          {invoicesQ.isLoading && <Empty>Loading on-chain history…</Empty>}
          {!merchant && <Empty>Connect a wallet to see its invoices.</Empty>}
          {merchant && !invoicesQ.isLoading && shown.length === 0 && <Empty>No {filter === "All" ? "" : filter.toLowerCase() + " "}invoices.</Empty>}
        </div>
      </Panel>
    </>
  );
}

function InvoiceRow({ inv, readOnly }: { inv: InvoiceRecordView; readOnly: boolean }) {
  const cfg = useAppConfig();
  const chain = cfg.chain(inv.chain)!;
  const settle = tokenOf(chain, inv.settleToken) ?? chain.settleToken;
  const tx = useTx();
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remaining = BigInt(inv.amount) - BigInt(inv.refunded);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
      setRefundOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const refund = () =>
    run("Refunding…", async () => {
      const value = parseUnits(refundAmount || "0", settle.decimals);
      if (value <= 0n || value > remaining) throw new Error(`refund must be between 0 and ${amount(remaining, settle.decimals)} ${settle.symbol}`);
      // A refund pulls the stablecoin from the merchant's wallet, so the merchant approves it first.
      await tx.approveIfNeeded(chain.id, settle.address, chain.checkout!, value);
      await tx.send({ chainId: chain.id, address: chain.checkout!, abi: checkoutCoreAbi, functionName: "refund", args: [BigInt(inv.id), value] });
    });
  const cancel = () =>
    run("Cancelling…", () => tx.send({ chainId: chain.id, address: chain.checkout!, abi: checkoutCoreAbi, functionName: "cancel", args: [BigInt(inv.id)] }));

  return (
    <>
      <tr>
        <td>
          <Link className="mono" to={`/pay/${inv.chain}/${inv.id}`}>
            #{inv.id}
          </Link>
        </td>
        <td>
          <ChainPill chain={inv.chain} />
        </td>
        <td className="mono faint" title={inv.orderRef}>
          {short(inv.orderRef, 6)}
        </td>
        <td className="num">
          {amount(inv.amount, settle.decimals)} <span className="muted">{settle.symbol}</span>
        </td>
        <td className="num">{inv.refunded === "0" ? <span className="faint">-</span> : amount(inv.refunded, settle.decimals)}</td>
        <td>
          <Addr value={inv.payer} chain={chain} />
        </td>
        <td>
          <StatusPill status={inv.status} refunded={inv.refunded !== "0"} />
        </td>
        <td className="muted">{age(inv.paidAt ?? inv.createdAt)}</td>
        {!readOnly && (
          <td>
            {busy ? (
              <span className="row" style={{ gap: 6, alignItems: "center" }}>
                <Spinner /> <span className="muted">{busy}</span>
              </span>
            ) : inv.status === "Paid" && remaining > 0n ? (
              <button className="btn small" onClick={() => setRefundOpen(!refundOpen)}>
                Refund…
              </button>
            ) : inv.status === "Open" ? (
              <button className="btn small danger" onClick={cancel}>
                Cancel
              </button>
            ) : null}
          </td>
        )}
      </tr>
      {(refundOpen || error) && (
        <tr>
          <td colSpan={9}>
            {refundOpen && (
              <div className="row" style={{ alignItems: "center" }}>
                <span className="muted">
                  Refund to <Addr value={inv.payer} chain={chain} /> · up to {amount(remaining, settle.decimals)} {settle.symbol}
                </span>
                <input style={{ width: 120 }} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="0.25" />
                <button className="btn small" onClick={() => setRefundAmount(amount(remaining, settle.decimals, settle.decimals))}>
                  Full
                </button>
                <button className="btn small primary" onClick={refund}>
                  Refund {refundAmount || "…"} {settle.symbol}
                </button>
              </div>
            )}
            {error && <div className="callout red" style={{ marginTop: 8 }}>{error}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

function CreateInvoice() {
  const cfg = useAppConfig();
  const tx = useTx();
  const queryClient = useQueryClient();
  const deployed = cfg.chains.filter((c) => c.checkout);
  const [chainKey, setChainKey] = useState<ChainKey | undefined>(deployed[0]?.key);
  const [value, setValue] = useState("1.00");
  const [minutes, setMinutes] = useState("30");
  const [orderRef, setOrderRef] = useState("order-1001");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ chain: ChainKey; id: string } | null>(null);
  const chain = chainKey ? cfg.chain(chainKey) : undefined;

  async function create() {
    if (!chain?.checkout) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tx.send({
        chainId: chain.id,
        address: chain.checkout,
        abi: checkoutCoreAbi,
        functionName: "createInvoice",
        args: [chain.settleToken.address, parseUnits(value, chain.settleToken.decimals), BigInt(Math.floor(Date.now() / 1000) + Number(minutes) * 60), keccak256(toHex(orderRef))],
      });
      const [ev] = parseEventLogs({ abi: checkoutCoreAbi, eventName: "InvoiceCreated", logs: r.logs });
      setCreated({ chain: chain.key, id: ev!.args.id.toString() });
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="create" title="Create invoice" subtitle="The order reference is stored hashed, so it shows up in the CSV without revealing customer data on-chain.">
      <div className="panel-body">
        {deployed.length === 0 ? (
          <div className="callout">No checkout contract is configured on the server yet.</div>
        ) : (
          <div className="row">
            <div className="field">
              <label>Network</label>
              <select value={chainKey} onChange={(e) => setChainKey(e.target.value as ChainKey)}>
                {deployed.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} · {c.settleToken.symbol}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount ({chain?.settleToken.symbol})</label>
              <input style={{ width: 120 }} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="field">
              <label>Expires in (min)</label>
              <input style={{ width: 110 }} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Order reference</label>
              <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
            </div>
            <button className="btn primary" disabled={busy} onClick={create}>
              {busy ? "Creating…" : "Create invoice"}
            </button>
          </div>
        )}
        {created && (
          <div className="callout green" style={{ marginTop: 14 }}>
            <b>Invoice #{created.id} created.</b> Payment link: <Link to={`/pay/${created.chain}/${created.id}`}>{`${location.origin}/pay/${created.chain}/${created.id}`}</Link>
          </div>
        )}
        {error && <div className="callout red" style={{ marginTop: 14 }}>{error}</div>}
      </div>
    </Panel>
  );
}
