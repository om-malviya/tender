import type { ReactNode } from "react";
import type { InvoiceStatus, PublicChain, RouteView } from "../lib/api.ts";
import { routeParts, short } from "../lib/format.ts";

/** EAS-style page header: breadcrumb, title, one line of context, actions on the right. */
export function PageHeader(props: { crumb: string[]; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className="crumb">
        {props.crumb.map((c, i) => (
          <span key={i}>
            {" / "}
            {c}
          </span>
        ))}
      </div>
      <div className="page-head">
        <div>
          <h1>{props.title}</h1>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
        {props.actions && <div className="head-actions">{props.actions}</div>}
      </div>
    </>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function Panel(props: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; foot?: ReactNode; id?: string }) {
  return (
    <section className="panel" id={props.id}>
      <div className="panel-head">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
        {props.actions}
      </div>
      {props.children}
      {props.foot && <div className="panel-foot">{props.foot}</div>}
    </section>
  );
}

const statusColor: Record<string, string> = { Paid: "green", Open: "blue", Expired: "amber", Cancelled: "red", Refunded: "violet" };
export function StatusPill({ status, refunded }: { status: InvoiceStatus; refunded?: boolean }) {
  const label = status === "Paid" && refunded ? "Refunded" : status;
  return <span className={`pill ${statusColor[label] ?? ""}`}>{label}</span>;
}

export function SourcePill({ source }: { source: RouteView["source"] }) {
  if (source === "direct") return <span className="pill">Direct</span>;
  if (source === "uniswap-api") return <span className="pill violet">Uniswap API</span>;
  return <span className="pill blue">v4 Quoter</span>;
}

export function ChainPill({ chain }: { chain: "unichain-sepolia" | "whitechain-sepolia" }) {
  return <span className={`pill ${chain === "unichain-sepolia" ? "violet" : "amber"}`}>{chain === "unichain-sepolia" ? "Unichain" : "Whitechain"}</span>;
}

/** Truncated monospace address/hash linked to the chain's explorer, like EAS Scan's UID column. */
export function Addr({ value, chain, kind = "address" }: { value?: string; chain?: PublicChain; kind?: "address" | "tx" }) {
  if (!value) return <span className="faint">-</span>;
  const href = chain ? `${chain.explorer}/${kind === "tx" ? "tx" : "address"}/${value}` : undefined;
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noreferrer" title={value}>
      {short(value)}
    </a>
  ) : (
    <span className="mono" title={value}>
      {short(value)}
    </span>
  );
}

/** DEMO →0.30% WETH →0.05% USDC */
export function RouteChips({ label }: { label: string }) {
  const parts = routeParts(label);
  return (
    <span className="route">
      {parts.map((p, i) =>
        i % 2 === 0 ? (
          <span key={i} className="token">
            {p}
          </span>
        ) : (
          <span key={i} className="hop">
            → {p}
          </span>
        ),
      )}
    </span>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Spinner = () => <span className="spinner" />;
