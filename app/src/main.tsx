import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { App } from "./App.tsx";
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
    root.render(
      <div className="main">
        <div className="callout red">
          <b>Can't reach the Tender API.</b> Start it with <span className="mono">npm run server</span> in <span className="mono">tender/</span>. ({String(e.message ?? e)})
        </div>
      </div>,
    );
  });
