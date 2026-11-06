import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { Empty, PageHeader, Panel, Stat } from "../components/ui.tsx";
import { age, usd } from "../lib/format.ts";
import { AgentSalesTable } from "./DashboardPage.tsx";

/** Hedera x402: what AI agents bought from the merchant, and the rules they buy under. */
export function AgentsPage() {
  const cfg = useAppConfig();
  const salesQ = useQuery({
    queryKey: ["hedera-sales", cfg.hederaMerchant],
    queryFn: () => api.hederaSales(cfg.hederaMerchant!),
    enabled: Boolean(cfg.hederaMerchant),
    refetchInterval: 15_000,
  });
  const auditQ = useQuery({
    queryKey: ["hedera-audit", cfg.hederaTopic],
    queryFn: () => api.auditLog(cfg.hederaTopic!),
    enabled: Boolean(cfg.hederaTopic),
    refetchInterval: 15_000,
  });
  const audit = auditQ.data?.entries ?? [];
  const sales = salesQ.data?.sales ?? [];
  const total = sales.reduce((s, x) => s + Number(x.amount) / 10 ** x.decimals, 0);
  const agents = new Set(sales.map((s) => s.payer)).size;

  return (
    <>
      <PageHeader
        crumb={["Agent sales"]}
        title="Agent sales"
        subtitle={<>AI agents buy from the shop per request over HTTP 402 (x402), settled in USDC on Hedera testnet.</>}
      />

      <div className="stats">
        <Stat label="Revenue from agents" value={`$${total.toFixed(2)}`} sub={sales[0] ? `${sales[0].symbol} · token ${sales[0].tokenId}` : "no sales yet"} />
        <Stat label="Purchases" value={sales.length} sub="each one a Hedera transaction" />
        <Stat label="Distinct agents" value={agents} />
        <Stat label="Merchant account" value={<span className="mono" style={{ fontSize: 18 }}>{cfg.hederaMerchant ?? "-"}</span>} sub="receives the payments" />
      </div>

      <Panel title="How an agent pays" subtitle="No checkout form and no human: payment is part of the HTTP request">
        <div className="panel-body steps">
          <div className="step">
            <div className="step-n">01</div>
            <h3>Discover</h3>
            <p>The agent reads the shop's /.well-known/tender.json to find what's for sale and the price.</p>
          </div>
          <div className="step">
            <div className="step-n">02</div>
            <h3>402 Payment Required</h3>
            <p>Calling the endpoint returns a price tag: the amount and token, the merchant's account, and the facilitator that pays the network fee.</p>
          </div>
          <div className="step">
            <div className="step-n">03</div>
            <h3>Policy check, then sign</h3>
            <p>Allowlist, per-merchant cap, total budget, human approval above a limit. Only then does it sign a Hedera USDC transfer.</p>
          </div>
          <div className="step">
            <div className="step-n">04</div>
            <h3>Settle &amp; deliver</h3>
            <p>The facilitator verifies and submits it; the shop returns the data; the agent logs the HashScan link.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Purchases" subtitle="Read from the public Hedera mirror node">
        <AgentSalesTable sales={sales} loading={salesQ.isLoading} configured={Boolean(cfg.hederaMerchant)} />
      </Panel>

      <Panel
        title="Spending audit log"
        subtitle="Every decision the agent makes, bought or refused, written to a Hedera Consensus Service topic. Public and tamper-evident."
        actions={cfg.hederaTopic && <a className="btn small" href={`https://hashscan.io/testnet/topic/${cfg.hederaTopic}`} target="_blank" rel="noreferrer">Topic {cfg.hederaTopic} ↗</a>}
      >
        {!cfg.hederaTopic ? (
          <Empty>Set HCS_TOPIC_ID on the server (the agent creates the topic on its first run and prints it).</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Decision</th>
                  <th>Merchant</th>
                  <th className="num">Amount</th>
                  <th>Detail</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.sequence}>
                    <td className="mono faint">{e.sequence}</td>
                    <td>{e.body?.kind === "purchase" ? <span className="pill green">Bought</span> : e.body?.kind === "refused" ? <span className="pill red">Refused</span> : <span className="pill plain">Note</span>}</td>
                    <td className="mono">{e.body?.merchant ?? "-"}</td>
                    <td className="num">{e.body?.amountUsd !== undefined ? usd(e.body.amountUsd) : "-"}</td>
                    <td className="muted">{e.body?.txId ? <a href={`https://hashscan.io/testnet/transaction/${e.body.txId}`} target="_blank" rel="noreferrer" className="mono">{e.body.txId}</a> : (e.body?.reason ?? e.raw)}</td>
                    <td className="muted">{age(Math.floor(e.consensusAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!auditQ.isLoading && audit.length === 0 && <Empty>No entries yet.</Empty>}
          </div>
        )}
      </Panel>
    </>
  );
}
