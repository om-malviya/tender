import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { PageHeader, Panel, Stat } from "../components/ui.tsx";
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
    </>
  );
}
