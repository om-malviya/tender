import { NavLink } from "react-router-dom";
import { useAppConfig } from "../lib/appConfig.ts";
import { WalletPanel } from "./WalletPanel.tsx";

const NAV = [
  { to: "/", icon: "◧", label: "Dashboard", end: true },
  { to: "/pay", icon: "⇄", label: "Pay an invoice" },
  { to: "/merchant", icon: "▤", label: "Merchant" },
  { to: "/agents", icon: "◎", label: "Agent sales" },
];

/** Pinned to the far left: brand, navigation buttons, demo links, and the wallet at the bottom. */
export function Sidebar() {
  const cfg = useAppConfig();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div className="brand-name">Tender</div>
        <span className="net-pill">testnet</span>
      </div>

      <nav className="nav-section">
        <div className="nav-label">Explore</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}>
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <nav className="nav-section">
        <div className="nav-label">Demo</div>
        {cfg.shopUrl && (
          <a className="nav-btn" href={cfg.shopUrl} target="_blank" rel="noreferrer">
            <span className="nav-icon">☕</span>
            Chai &amp; Code shop
            <span className="nav-ext">↗</span>
          </a>
        )}
      </nav>

      <div className="sidebar-bottom">
        <div className="rails">
          <b>Uniswap v4</b> any-token checkout
          <br />
          <b>Whitechain</b> USDT invoices
          <br />
          <b>Hedera</b> x402 agent sales
        </div>
        <WalletPanel />
      </div>
    </aside>
  );
}
