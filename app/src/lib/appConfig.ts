import { createContext, useContext } from "react";
import type { AppConfig, ChainKey } from "./api.ts";

/** The server's /api/config, loaded once at startup (see main.tsx) and shared with every page. */
export const AppConfigContext = createContext<AppConfig | null>(null);

export function useAppConfig() {
  const cfg = useContext(AppConfigContext);
  if (!cfg) throw new Error("AppConfigContext missing");
  return {
    ...cfg,
    chain: (key: ChainKey) => cfg.chains.find((c) => c.key === key),
    chainById: (id?: number) => cfg.chains.find((c) => c.id === id),
  };
}
