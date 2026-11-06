import { createConfig, http, type Config } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { defineChain, type Chain } from "viem";
import type { AppConfig } from "./api.ts";

/**
 * Builds the wallet configuration from the server's /api/config, so chain IDs, RPCs and contract
 * addresses live in ONE place (the server's environment).
 *  - injected(): the browser wallet (MetaMask, Rabby, ...)
 *  - mock(): LOCAL FORK ONLY. "Dev wallets" for anvil's unlocked test accounts, so the whole flow can be
 *    clicked through (and tested automatically) without an extension. Never enabled on a real network.
 */
export function buildWagmiConfig(app: AppConfig): Config {
  const chains = app.chains.map((c) =>
    defineChain({
      id: c.id,
      name: c.name,
      nativeCurrency: c.nativeCurrency,
      rpcUrls: { default: { http: [c.rpcUrl] } },
      blockExplorers: { default: { name: "Explorer", url: c.explorer } },
    }),
  ) as unknown as [Chain, ...Chain[]];

  return createConfig({
    chains,
    connectors: [
      injected(),
      ...(app.devWalletAccounts ?? []).map((account) => mock({ accounts: [account], features: { reconnect: true } })),
    ],
    transports: Object.fromEntries(app.chains.map((c) => [c.id, http(c.rpcUrl)])),
  });
}
