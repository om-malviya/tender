import { useState } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { useAppConfig } from "../lib/appConfig.ts";
import { short } from "../lib/format.ts";

/** Connect / show / disconnect the wallet. Dev wallets only exist when running against a local fork. */
export function WalletPanel() {
  const { address, chainId, isConnected } = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const cfg = useAppConfig();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="wallet">
        <div className="wallet-card">
          <span className="dot" />
          <div style={{ minWidth: 0 }}>
            <div className="mono" title={address}>
              {short(address)}
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              {cfg.chainById(chainId)?.name ?? `chain ${chainId}`}
            </div>
          </div>
        </div>
        <button className="btn small block" onClick={() => disconnect.mutate()}>
          Disconnect
        </button>
      </div>
    );
  }

  // Dev wallets are listed in the order of DEV_WALLET_ACCOUNTS on the server: payer first, then merchant.
  const mocks = connect.connectors.filter((c) => c.type === "mock");
  const devLabel = (i: number) => `Dev wallet (${["payer", "merchant"][i] ?? i + 1})`;
  return (
    <div className="wallet">
      {open &&
        connect.connectors.map((c) => {
          const label = c.type === "mock" ? devLabel(mocks.indexOf(c)) : c.name;
          return (
            <button
              key={c.uid}
              className="btn small block"
              onClick={() => connect.mutate({ connector: c }, { onSuccess: () => setOpen(false) })}
            >
              {label}
            </button>
          );
        })}
      <button className="btn primary block" onClick={() => setOpen(!open)}>
        {connect.isPending ? "Connecting…" : open ? "Choose a wallet" : "Connect wallet"}
      </button>
      {connect.error && <div className="faint" style={{ fontSize: 12 }}>{connect.error.message.split("\n")[0]}</div>}
    </div>
  );
}
