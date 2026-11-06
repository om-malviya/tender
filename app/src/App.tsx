import { BrowserRouter, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.tsx";
import { Empty } from "./components/ui.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { LandingPage } from "./pages/LandingPage.tsx";
import { MerchantPage } from "./pages/MerchantPage.tsx";
import { PayLookupPage, PayPage } from "./pages/PayPage.tsx";
import { WalletPanel } from "./components/WalletPanel.tsx";

/** Sidebar pinned far left, the page fills the rest. Inside the shop's checkout popup (?embed=1) there is
 *  no sidebar: a slim top bar with the brand and the account. */
function Layout() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  if (pathname === "/") return <Outlet />;
  if (params.get("embed") === "1") {
    return (
      <div className="main embed">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">T</div>
            <div className="brand-name">Tender</div>
            <span className="net-pill">testnet</span>
          </div>
          <div style={{ width: 230 }}>
            <WalletPanel />
          </div>
        </div>
        <Outlet />
      </div>
    );
  }
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LandingPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="pay" element={<PayLookupPage />} />
          <Route path="pay/:chain/:id" element={<PayPage />} />
          <Route path="merchant" element={<MerchantPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="*" element={<Empty>Nothing here.</Empty>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
