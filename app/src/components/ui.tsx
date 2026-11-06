import type { ReactNode } from "react";
import type { InvoiceStatus, PublicChain, RouteView } from "../lib/api.ts";
import { routeParts, short } from "../lib/format.ts";

/** Page header: breadcrumb, title, one line of context, actions on the right. */
export function PageHeader(props: { crumb: string[]; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className="crumb">
        {props.crumb.map((c, i) => (
          <span key={i}>
            {i > 0 ? " / " : ""}
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
  if (source === "direct") return <span className="pill plain">Direct</span>;
  if (source === "uniswap-api") return <span className="pill plain violet">Uniswap API</span>;
  if (source === "v4-hook") return <span className="pill plain green" title="The pool itself settles the invoice. Paid through a generic Uniswap router, not Tender's contract.">Hook · any router</span>;
  if (source === "split") return <span className="pill plain amber" title="Two pools in one transaction, to cut price impact">Split</span>;
  return <span className="pill plain blue">v4 Quoter</span>;
}

export function ChainPill({ chain }: { chain: "unichain-sepolia" | "whitechain-sepolia" }) {
  return <span className={`pill plain ${chain === "unichain-sepolia" ? "violet" : "amber"}`}>{chain === "unichain-sepolia" ? "Unichain" : "Whitechain"}</span>;
}

/** Truncated monospace address/hash linked to the chain's explorer. */
export function Addr({ value, chain, kind = "address" }: { value?: string; chain?: PublicChain; kind?: "address" | "tx" }) {
  if (!value) return <span className="faint">—</span>;
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
  if (label.includes(" split: ") || label.includes(" · ")) {
    return (
      <span className="route">
        <span className="token">{label}</span>
      </span>
    );
  }
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

/** Deterministic identicon from an address (MetaMask-style account avatar, no library). */
export function Identicon({ address, size = 26 }: { address: string; size?: number }) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  const n = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2) || "0", 16);
  const hue = (n(0) * 360) / 255;
  const hue2 = (hue + 40 + (n(1) % 80)) % 360;
  const cells: boolean[] = [];
  for (let i = 0; i < 15; i++) cells.push(n(2 + (i % 18)) % 2 === 0);
  const rects = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!cells[y * 3 + x]) continue;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
      if (x < 2) rects.push(<rect key={`m${x}-${y}`} x={4 - x} y={y} width="1" height="1" />);
    }
  }
  return (
    <span className="identicon" style={{ width: size, height: size }}>
      <svg viewBox="0 0 5 5" shapeRendering="crispEdges" style={{ background: `hsl(${hue2} 45% 22%)` }}>
        <g fill={`hsl(${hue} 80% 65%)`}>{rects}</g>
      </svg>
    </span>
  );
}

/** A coloured circle with the token symbol, like a wallet's asset list. */
export function TokenLogo({ symbol, size = 26 }: { symbol: string; size?: number }) {
  const colors: Record<string, string> = { USDC: "#2775ca", USDT: "#26a17b", WETH: "#627eea", DEMO: "#8b5cf6" };
  return (
    <span className="token-logo" style={{ width: size, height: size, background: colors[symbol] ?? "#4b5563" }}>
      {symbol.slice(0, 4)}
    </span>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <span key={s} style={{ display: "contents" }}>
          {i > 0 && <span className="sep" />}
          <span className={`s${i === current ? " on" : i < current ? " done" : ""}`}>
            <b>{i < current ? "✓" : i + 1}</b>
            {s}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Centered confirmation sheet, MetaMask-style. */
export function Sheet(props: { title: string; onClose?: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{props.title}</h2>
          {props.onClose && (
            <button className="btn ghost small" onClick={props.onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="sheet-body">{props.children}</div>
        {props.foot && <div className="sheet-foot">{props.foot}</div>}
      </div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Spinner = () => <span className="spinner" />;

export const Icon = {
  home: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8l6-5 6 5v6H2V8z" /><path d="M6 14v-4h4v4" /></svg>,
  dashboard: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>,
  pay: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6h12M2 10h12M10 3l3 3-3 3M6 13l-3-3 3-3" /></svg>,
  merchant: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6l1.5-3h9L14 6M2 6v7h12V6M2 6h12M6 13V9h4v4" /></svg>,
  agents: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></svg>,
  shop: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10l-1 8H4L3 5zM6 5V3.5a2 2 0 014 0V5" /></svg>,
};
