import { useState } from "react";
import { useConnect, useConnection, useDisconnect } from "wagmi";
import { useAppConfig } from "../lib/appConfig.ts";
import { short } from "../lib/format.ts";
import { Identicon } from "./ui.tsx";

/** MetaMask-style account pill: identicon, short address, network with a status dot. */
export function WalletPanel() {
  const { address, chainId, isConnected } = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const cfg = useAppConfig();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    const chain = cfg.chainById(chainId);
    return (
      <div className="wallet">
        <div className="account" title={address}>
          <Identicon address={address} />
          <div style={{ minWidth: 0 }}>
            <div className="mono">{short(address)}</div>
            <div className="account-net">
              <span className="dot" style={{ background: chain ? "var(--green)" : "var(--amber)" }} />
              {chain?.name ?? `Chain ${chainId}`}
            </div>
          </div>
        </div>
        <button className="btn ghost small block" onClick={() => disconnect.mutate()}>
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
      {open && (
        <div className="chooser">
          {connect.connectors.map((c) => (
            <button key={c.uid} className="btn ghost small block" onClick={() => connect.mutate({ connector: c }, { onSuccess: () => setOpen(false) })}>
              {c.type === "mock" ? devLabel(mocks.indexOf(c)) : c.name}
            </button>
          ))}
        </div>
      )}
      <button className="btn primary block" onClick={() => setOpen(!open)}>
        {connect.isPending ? "Connecting…" : open ? "Choose a wallet" : "Connect wallet"}
      </button>
      {connect.error && <div className="faint" style={{ fontSize: 12 }}>{connect.error.message.split("\n")[0]}</div>}
    </div>
  );
}
