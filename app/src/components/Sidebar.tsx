import { NavLink } from "react-router-dom";
import { useAppConfig } from "../lib/appConfig.ts";
import { Icon } from "./ui.tsx";
import { WalletPanel } from "./WalletPanel.tsx";

const NAV = [
  { to: "/", icon: Icon.home, label: "Overview", end: true },
  { to: "/dashboard", icon: Icon.dashboard, label: "Dashboard" },
  { to: "/pay", icon: Icon.pay, label: "Pay" },
  { to: "/merchant", icon: Icon.merchant, label: "Merchant" },
  { to: "/agents", icon: Icon.agents, label: "Agents" },
];

/** Pinned far left: brand, navigation, demo link, the account at the bottom. */
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
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}>
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      {cfg.shopUrl && (
        <nav className="nav-section">
          <div className="nav-label">Demo</div>
          <a className="nav-btn" href={cfg.shopUrl} target="_blank" rel="noreferrer">
            <span className="nav-icon">{Icon.shop}</span>
            Chai &amp; Code
            <span className="nav-ext">↗</span>
          </a>
        </nav>
      )}

      <div className="sidebar-bottom">
        <WalletPanel />
      </div>
    </aside>
  );
}
