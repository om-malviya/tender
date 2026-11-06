import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useConnection } from "wagmi";
import { api, type HederaSaleView } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { age, amount, tokenOf } from "../lib/format.ts";
import { Addr, ChainPill, Empty, PageHeader, Panel, Stat, StatusPill } from "../components/ui.tsx";

/** The landing page, modelled on EAS Scan's dashboard: stats on top, the most recent activity below. */
export function DashboardPage() {
  const cfg = useAppConfig();
  const { address } = useConnection();
  const merchant = address ?? cfg.demoMerchant;

  const invoicesQ = useQuery({
    queryKey: ["invoices", merchant],
    queryFn: () => api.invoices(merchant!),
    enabled: Boolean(merchant),
    refetchInterval: 15_000,
  });
  const salesQ = useQuery({
    queryKey: ["hedera-sales", cfg.hederaMerchant],
    queryFn: () => api.hederaSales(cfg.hederaMerchant!),
    enabled: Boolean(cfg.hederaMerchant),
    refetchInterval: 30_000,
  });

  const invoices = invoicesQ.data?.invoices ?? [];
  const sales = salesQ.data?.sales ?? [];
  const paid = invoices.filter((i) => i.status === "Paid");
  // Each invoice is converted with ITS stablecoin's decimals (from /api/config), never an assumed 6.
  const settleDecimals = (i: (typeof invoices)[number]) => {
    const chain = cfg.chain(i.chain);
    return (tokenOf(chain, i.settleToken) ?? chain?.settleToken)?.decimals ?? 0;
  };
  const units = (raw: string, decimals: number) => Number(raw) / 10 ** decimals;
  const volume = paid.reduce((s, i) => s + units(i.amount, settleDecimals(i)), 0);
  const refunded = invoices.reduce((s, i) => s + units(i.refunded, settleDecimals(i)), 0);
  const agentUsd = sales.reduce((s, x) => s + units(x.amount, x.decimals), 0);
  const swapped = paid.filter((i) => i.paidWith && i.paidWith.toLowerCase() !== i.settleToken.toLowerCase()).length;

  return (
    <>
      <PageHeader
        crumb={["Dashboard"]}
        title="Dashboard"
        subtitle={
          merchant ? (
            <>
              Recent activity for {address ? "your wallet" : "the demo merchant"} <Addr value={merchant} />
            </>
          ) : (
            "Connect a merchant wallet to see its activity."
          )
        }
        actions={
          <>
            <Link className="btn primary" to="/merchant#create">
              Create invoice
            </Link>
            {cfg.shopUrl && (
              <a className="btn" href={cfg.shopUrl} target="_blank" rel="noreferrer">
                Open demo shop ↗
              </a>
            )}
          </>
        }
      />

      <div className="stats">
        <Stat label="Invoices" value={invoices.length} sub={`${invoices.filter((i) => i.status === "Open").length} open`} />
        <Stat label="Paid volume" value={`$${volume.toFixed(2)}`} sub={`${paid.length} paid · ${swapped} via Uniswap swap`} />
        <Stat label="Refunded" value={`$${refunded.toFixed(2)}`} sub="recorded on-chain" />
        <Stat label="Agent sales (x402)" value={`$${agentUsd.toFixed(2)}`} sub={cfg.hederaMerchant ? `${sales.length} on Hedera` : "Hedera not configured"} />
      </div>

      <Panel
        title="Recent payments"
        subtitle="Every row is rebuilt from the checkout contract's on-chain events"
        foot={<Link to="/merchant">All invoices →</Link>}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Rail</th>
                <th>Payer</th>
                <th>Paid with</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 8).map((i) => {
                const chain = cfg.chain(i.chain);
                const settle = tokenOf(chain, i.settleToken);
                const paidWith = i.paidWith && /^0x0+$/.test(i.paidWith) ? undefined : tokenOf(chain, i.paidWith);
                return (
                  <tr key={`${i.chain}-${i.id}`}>
                    <td>
                      <Link className="mono" to={`/pay/${i.chain}/${i.id}`}>
                        #{i.id}
                      </Link>
                    </td>
                    <td>
                      <ChainPill chain={i.chain} />
                    </td>
                    <td>
                      <Addr value={i.payer} chain={chain} />
                    </td>
                    <td>
                      {i.basket ? (
                        <span className="pill blue">Basket · {i.basket.tokens.length} tokens</span>
                      ) : paidWith && i.paidAmount ? (
                        <span>
                          {amount(i.paidAmount, paidWith.decimals, 4)} <span className="muted">{paidWith.symbol}</span>
                        </span>
                      ) : (
                        <span className="faint">-</span>
                      )}
                    </td>
                    <td className="num">
                      {amount(i.amount, settle?.decimals ?? 6)} <span className="muted">{settle?.symbol}</span>
                    </td>
                    <td>
                      <StatusPill status={i.status} refunded={i.refunded !== "0"} />
                    </td>
                    <td className="muted">{age(i.paidAt ?? i.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {invoicesQ.isLoading && <Empty>Loading on-chain history…</Empty>}
          {invoicesQ.error && <Empty>Couldn't load invoices: {String(invoicesQ.error.message)}</Empty>}
          {!invoicesQ.isLoading && !invoicesQ.error && invoices.length === 0 && <Empty>No invoices yet. Create one on the Merchant page, or buy something in the demo shop.</Empty>}
        </div>
      </Panel>

      <Panel title="How Tender gets a merchant paid" subtitle="One merchant, three payment rails, one dashboard">
        <div className="panel-body steps">
          <div className="step">
            <div className="step-n">01 · Uniswap v4 · Unichain</div>
            <h3>Pay with any token</h3>
            <p>Routes ranked by true cost. One exact-output swap: the merchant receives exactly the invoice amount, the payer gets the rest back.</p>
          </div>
          <div className="step">
            <div className="step-n">02 · Whitechain</div>
            <h3>USDT invoices &amp; refunds</h3>
            <p>Drop-in widget, partial refunds recorded on-chain, and a CSV export for the accountant.</p>
          </div>
          <div className="step">
            <div className="step-n">03 · Hedera · x402</div>
            <h3>Sell to AI agents</h3>
            <p>Agents pay per request over HTTP 402, inside a spending policy. No checkout form, no human.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Recent agent sales" subtitle="x402 payments settled on Hedera testnet" foot={<Link to="/agents">View all agent sales →</Link>}>
        <AgentSalesTable sales={sales.slice(0, 5)} loading={salesQ.isLoading} configured={Boolean(cfg.hederaMerchant)} />
      </Panel>
    </>
  );
}

export function AgentSalesTable(props: { sales: HederaSaleView[]; loading: boolean; configured: boolean }) {
  if (!props.configured) return <Empty>Set HEDERA_MERCHANT_ID on the server to show agent sales.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hedera transaction</th>
            <th>Agent account</th>
            <th className="num">Amount</th>
            <th>Type</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {props.sales.map((s) => (
            <tr key={s.txId}>
              <td>
                <a className="mono" href={s.hashscanUrl} target="_blank" rel="noreferrer">
                  {s.txId}
                </a>
              </td>
              <td className="mono">{s.payer}</td>
              <td className="num">
                {amount(s.amount, s.decimals)} <span className="muted">{s.symbol}</span>
              </td>
              <td>
                <span className="pill violet">x402</span>
              </td>
              <td className="muted">{age(s.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.loading && <Empty>Loading from the Hedera mirror node…</Empty>}
      {!props.loading && props.sales.length === 0 && <Empty>No agent purchases yet.</Empty>}
    </div>
  );
}
