import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { App } from "./App.tsx";
import { LandingPage } from "./pages/LandingPage.tsx";
import { api } from "./lib/api.ts";
import { AppConfigContext } from "./lib/appConfig.ts";
import { buildWagmiConfig } from "./lib/wagmi.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

// Load chain settings from the Tender API first, then build the wallet config from them.
api
  .config()
  .then((config) => {
    const wagmiConfig = buildWagmiConfig(config);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
    root.render(
      <StrictMode>
        <AppConfigContext.Provider value={config}>
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </WagmiProvider>
        </AppConfigContext.Provider>
      </StrictMode>,
    );
  })
  .catch((e) => {
    // API unreachable: the landing page still works (its live stats just stay empty); app pages say why.
    const local = !import.meta.env.VITE_API_URL;
    root.render(
      <StrictMode>
        <AppConfigContext.Provider value={{ chains: [] }}>
          <QueryClientProvider client={new QueryClient()}>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route
                  path="*"
                  element={
                    <div className="main">
                      <div className="callout red">
                        <b>The Tender API is offline.</b>{" "}
                        {local ? (
                          <>
                            Start it with <span className="mono">npm run server</span> in <span className="mono">tender/</span>.
                          </>
                        ) : (
                          "Please try again in a minute."
                        )}{" "}
                        ({String(e.message ?? e)}) <Link to="/">Back to the overview</Link>
                      </div>
                    </div>
                  }
                />
              </Routes>
            </BrowserRouter>
          </QueryClientProvider>
        </AppConfigContext.Provider>
      </StrictMode>,
    );
  });
