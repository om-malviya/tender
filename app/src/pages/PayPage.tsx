import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { parseEventLogs, type Hex } from "viem";
import { useConnection } from "wagmi";
import { checkoutCoreAbi, uniswapCheckoutAbi } from "@tender/core";
import { api, type BasketView, type ChainKey, type RouteView } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { amount, short, tokenOf, usd } from "../lib/format.ts";
import { errorText, useTx } from "../lib/tx.ts";
import { Addr, ChainPill, Empty, PageHeader, Panel, RouteChips, SourcePill, Spinner, StatusPill } from "../components/ui.tsx";

/** /pay: open an invoice by chain + id. */
export function PayLookupPage() {
  const cfg = useAppConfig();
  const navigate = useNavigate();
  const [chain, setChain] = useState<ChainKey>(cfg.chains.find((c) => c.checkout)?.key ?? "unichain-sepolia");
  const [id, setId] = useState("");
  return (
    <>
      <PageHeader crumb={["Pay"]} title="Pay an invoice" subtitle="Paste an invoice number from a merchant. Shops open this page for you through the Tender widget." />
      <Panel title="Open an invoice">
        <form
          className="panel-body row"
          onSubmit={(e) => {
            e.preventDefault();
            if (id) navigate(`/pay/${chain}/${id}`);
          }}
        >
          <div className="field">
            <label>Network</label>
            <select value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
              {cfg.chains.map((c) => (
                <option key={c.key} value={c.key} disabled={!c.checkout}>
                  {c.name} {c.checkout ? "" : "(not deployed)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Invoice #</label>
            <input value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1" />
          </div>
          <button className="btn primary" type="submit" disabled={!id}>
            Open invoice
          </button>
        </form>
      </Panel>
    </>
  );
}

type Receipt = { txHash: Hex; spent: { symbol: string; amount: string; decimals: number }[]; returned?: string; settled: string; route: string };

/** /pay/:chain/:id: the customer view. Invoice, ranked routes, pay, receipt. */
export function PayPage() {
  const { chain, id } = useParams() as { chain: ChainKey; id: string };
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const cfg = useAppConfig();
  const chainCfg = cfg.chain(chain);
  const { address, isConnected } = useConnection();
  const tx = useTx();
  const queryClient = useQueryClient();

  const invoiceQ = useQuery({ queryKey: ["invoice", chain, id], queryFn: () => api.invoice(chain, id), refetchInterval: 10_000 });
  const inv = invoiceQ.data;
  const settle = tokenOf(chainCfg, inv?.settleToken) ?? chainCfg?.settleToken;
  const now = useNow();
  const secondsLeft = inv ? Number(inv.expiry) - now : 0;
  const payable = inv?.status === "Open" && secondsLeft > 0;

  // Quotes go stale fast (prices move), so re-rank every 20 s while the page is open.
  const rankQ = useQuery({
    queryKey: ["rank", chain, id, address],
    queryFn: () => api.rank(chain, id, address!),
    enabled: Boolean(address && payable),
    refetchInterval: 20_000,
  });
  const routes = rankQ.data?.routes ?? [];
  const recommendedIndex = routes.findIndex((r) => r.affordable && r.executable && !Number.isNaN(r.totalCostUsd));
  const [picked, setPicked] = useState<number | null>(null);
  const selectedIndex = picked !== null && routes[picked] ? picked : recommendedIndex;
  const selected = selectedIndex >= 0 ? routes[selectedIndex] : undefined;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [basket, setBasket] = useState<BasketView | null>(null);

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 10 * 60); // 10 min: a stale quote can't be mined later

  function announce(txHash: Hex) {
    // The shop's widget listens for this; it should still confirm the payment on-chain.
    if (embed && window.opener) window.opener.postMessage({ type: "tender:paid", chain, invoiceId: id, txHash }, "*");
    queryClient.invalidateQueries({ queryKey: ["invoice", chain, id] });
  }

  async function pay(route: RouteView) {
    if (!chainCfg?.checkout || !inv || !settle) return;
    setError(null);
    try {
      const checkout = chainCfg.checkout;
      const invoiceId = BigInt(id);
      if (route.source === "direct") {
        setBusy(`Approving ${settle.symbol}…`);
        await tx.approveIfNeeded(chainCfg.id, settle.address, checkout, BigInt(inv.amount));
        setBusy("Paying…");
        const r = await tx.send({ chainId: chainCfg.id, address: checkout, abi: checkoutCoreAbi, functionName: "payInvoice", args: [invoiceId] });
        setReceipt({ txHash: r.transactionHash, spent: [{ symbol: settle.symbol, amount: inv.amount, decimals: settle.decimals }], settled: inv.amount, route: `${settle.symbol} (no swap)` });
        announce(r.transactionHash);
      } else {
        const maxIn = BigInt(route.maxAmountIn);
        setBusy(`Approving at most ${amount(maxIn, route.token.decimals)} ${route.token.symbol}…`);
        await tx.approveIfNeeded(chainCfg.id, route.token.address, checkout, maxIn);
        setBusy("Swapping on Uniswap v4 and paying…");
        const r = await tx.send({
          chainId: chainCfg.id,
          address: checkout,
          abi: uniswapCheckoutAbi,
          functionName: "payWithToken",
          args: [invoiceId, route.token.address, maxIn, route.hops.map((h) => ({ ...h })), deadline()],
        });
        const [ev] = parseEventLogs({ abi: uniswapCheckoutAbi, eventName: "InvoicePaid", logs: r.logs });
        const spent = ev?.args.amountIn ?? maxIn;
        setReceipt({
          txHash: r.transactionHash,
          spent: [{ symbol: route.token.symbol, amount: spent.toString(), decimals: route.token.decimals }],
          returned: (maxIn - spent).toString(),
          settled: (ev?.args.amountSettled ?? BigInt(inv.amount)).toString(),
          route: route.label,
        });
        announce(r.transactionHash);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function buildBasket() {
    if (!address) return;
    setError(null);
    setBusy("Building a basket from your balances…");
    try {
      setBasket(await api.basket(chain, id, address));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function payBasket() {
    if (!basket || !chainCfg?.checkout || !inv) return;
    setError(null);
    try {
      for (const leg of basket.legs) {
        const t = tokenOf(chainCfg, leg.tokenIn);
        setBusy(`Approving ${amount(leg.amountIn, t?.decimals ?? 18)} ${t?.symbol ?? short(leg.tokenIn)}…`);
        await tx.approveIfNeeded(chainCfg.id, leg.tokenIn, chainCfg.checkout, BigInt(leg.amountIn));
      }
      setBusy("Swapping every leg and paying…");
      const r = await tx.send({
        chainId: chainCfg.id,
        address: chainCfg.checkout,
        abi: uniswapCheckoutAbi,
        functionName: "payWithBasket",
        args: [BigInt(id), basket.legs.map((l) => ({ tokenIn: l.tokenIn, amountIn: BigInt(l.amountIn), path: l.path.map((h) => ({ ...h })), minOut: BigInt(l.minOut) })), deadline()],
      });
      const [ev] = parseEventLogs({ abi: uniswapCheckoutAbi, eventName: "BasketPaid", logs: r.logs });
      const total = ev?.args.totalOut ?? BigInt(inv.amount);
      setReceipt({
        txHash: r.transactionHash,
        spent: basket.legs.map((l) => {
          const t = tokenOf(chainCfg, l.tokenIn);
          return { symbol: t?.symbol ?? short(l.tokenIn), amount: l.amountIn, decimals: t?.decimals ?? 18 };
        }),
        returned: (total - BigInt(inv.amount)).toString(),
        settled: inv.amount,
        route: `basket of ${basket.legs.length} tokens`,
      });
      announce(r.transactionHash);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!chainCfg) return <Empty>Unknown network “{chain}”.</Empty>;

  return (
    <>
      {!embed && (
        <PageHeader
          crumb={["Pay", `Invoice #${id}`]}
          title={`Invoice #${id}`}
          subtitle={<>Pay with any token you hold. The merchant always receives the exact amount.</>}
          actions={<Link className="btn" to="/pay">Open another</Link>}
        />
      )}
      {embed && <h1 style={{ fontSize: 20, marginBottom: 14 }}>Tender checkout · Invoice #{id}</h1>}

      <Panel title="Invoice" actions={inv && <StatusPill status={inv.status === "Open" && secondsLeft <= 0 ? "Expired" : inv.status} refunded={inv.refunded !== "0"} />}>
        <div className="panel-body">
          {invoiceQ.isLoading && <Spinner />}
          {invoiceQ.error && <div className="callout red">{String(invoiceQ.error.message)}</div>}
          {inv && settle && (
            <dl className="kv">
              <div>
                <dt>Amount due</dt>
                <dd className="big-amount">
                  {amount(inv.amount, settle.decimals)} <span className="muted">{settle.symbol}</span>
                </dd>
              </div>
              <div>
                <dt>Merchant</dt>
                <dd>
                  <Addr value={inv.merchant} chain={chainCfg} />
                </dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>
                  <ChainPill chain={chain} />
                </dd>
              </div>
              <div>
                <dt>{inv.status === "Open" ? "Expires" : "Payer"}</dt>
                <dd>{inv.status === "Open" ? (secondsLeft > 0 ? `in ${Math.floor(secondsLeft / 60)} min ${secondsLeft % 60}s` : "expired") : <Addr value={inv.payer} chain={chainCfg} />}</dd>
              </div>
            </dl>
          )}
        </div>
      </Panel>

      {receipt && settle && (
        <Panel title="Payment confirmed" actions={<span className="pill green">Settled</span>}>
          <div className="panel-body">
            <div className="receipt-line">
              <span className="muted">Merchant received</span>
              <b>
                exactly {amount(receipt.settled, settle.decimals)} {settle.symbol}
              </b>
            </div>
            <div className="receipt-line">
              <span className="muted">You paid</span>
              <span>{receipt.spent.map((s) => `${amount(s.amount, s.decimals, 6)} ${s.symbol}`).join(" + ")}</span>
            </div>
            {receipt.returned && receipt.returned !== "0" && (
              <div className="receipt-line">
                <span className="muted">Returned to you in the same transaction</span>
                <span>
                  {amount(receipt.returned, receipt.spent.length > 1 ? settle.decimals : receipt.spent[0]!.decimals, 6)}{" "}
                  {receipt.spent.length > 1 ? settle.symbol : receipt.spent[0]!.symbol}
                </span>
              </div>
            )}
            <div className="receipt-line">
              <span className="muted">Route</span>
              <RouteChips label={receipt.route} />
            </div>
            <div className="receipt-line">
              <span className="muted">Transaction</span>
              <Addr value={receipt.txHash} chain={chainCfg} kind="tx" />
            </div>
          </div>
        </Panel>
      )}

      {!receipt && inv && !payable && inv.status === "Paid" && <div className="callout green">This invoice has been paid.</div>}

      {!receipt && payable && (
        <Panel
          title="Ranked routes"
          subtitle={chainCfg.swaps ? "Every way you could pay, cheapest first: value of what you give up + gas. Quotes from the Uniswap v4 Quoter, refreshed every 20 s." : `${settle?.symbol} on ${chainCfg.name}: paid directly, no swap needed.`}
          actions={rankQ.isFetching ? <Spinner /> : null}
        >
          {!isConnected && <Empty>Connect a wallet (bottom left) to see what you can pay with.</Empty>}
          {isConnected && rankQ.error && <Empty>{String(rankQ.error.message)}</Empty>}
          {isConnected && routes.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Route</th>
                    <th>Source</th>
                    <th className="num">You pay</th>
                    <th className="num">Fees + impact</th>
                    <th className="num">Gas</th>
                    <th className="num">Total cost</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r, i) => {
                    const usable = r.affordable && r.executable;
                    return (
                      <tr
                        key={`${r.source}-${r.label}`}
                        className={`${usable ? "selectable" : "dim"}${i === selectedIndex ? " selected" : ""}`}
                        onClick={() => usable && setPicked(i)}
                      >
                        <td className="mono faint">{i + 1}</td>
                        <td>
                          <RouteChips label={r.label} />
                        </td>
                        <td>
                          <SourcePill source={r.source} />
                        </td>
                        <td className="num">
                          {amount(r.amountIn, r.token.decimals, 6)} <span className="muted">{r.token.symbol}</span>
                        </td>
                        <td className="num muted">{usd(r.overpayUsd)}</td>
                        <td className="num muted">{usd(r.gasUsd)}</td>
                        <td className="num">
                          <b>{usd(r.totalCostUsd)}</b>
                        </td>
                        <td>
                          {i === recommendedIndex ? (
                            <span className="pill green">Best</span>
                          ) : !r.executable ? (
                            <span className="pill" title={r.note}>Compare only</span>
                          ) : !r.affordable ? (
                            <span className="pill amber" title={`You hold ${amount(r.balance, r.token.decimals)} ${r.token.symbol}`}>
                              Can't afford
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {isConnected && (
            <div className="panel-foot">
              {selected && inv && settle ? (
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="muted">
                    You approve at most{" "}
                    <b style={{ color: "var(--text)" }}>
                      {amount(selected.maxAmountIn, selected.token.decimals, 6)} {selected.token.symbol}
                    </b>{" "}
                    (quote + 0.5%). Whatever the swap doesn't use comes straight back.
                  </div>
                  <button className="btn primary" disabled={Boolean(busy)} onClick={() => pay(selected)}>
                    {busy ??
                      (selected.source === "direct"
                        ? `Pay ${amount(inv.amount, settle.decimals)} ${settle.symbol}`
                        : `Pay ${amount(inv.amount, settle.decimals)} ${settle.symbol} with ${selected.token.symbol}`)}
                  </button>
                </div>
              ) : rankQ.isLoading ? (
                <span className="muted">Scanning your balances and quoting routes…</span>
              ) : chainCfg.swaps ? (
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="muted">No single token in your wallet covers this invoice. Combine several in one transaction:</div>
                  <button className="btn primary" disabled={Boolean(busy)} onClick={buildBasket}>
                    {busy ?? "Pay with a basket of tokens"}
                  </button>
                </div>
              ) : (
                <span className="muted">Your wallet doesn't hold enough {settle?.symbol} for this invoice.</span>
              )}
            </div>
          )}
        </Panel>
      )}

      {!receipt && basket && settle && (
        <Panel title="Basket payment" subtitle="Each leg is swapped with exact input; together they guarantee at least the invoice amount. Any excess comes back to you.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Route</th>
                  <th className="num">Spend</th>
                  <th className="num">Guaranteed {settle.symbol}</th>
                </tr>
              </thead>
              <tbody>
                {basket.legs.map((l, i) => {
                  const t = tokenOf(chainCfg, l.tokenIn);
                  return (
                    <tr key={i}>
                      <td>
                        <span className="token">{t?.symbol ?? short(l.tokenIn)}</span>
                      </td>
                      <td className="muted">{l.path.length ? `${l.path.length}-hop swap` : "no swap"}</td>
                      <td className="num">{amount(l.amountIn, t?.decimals ?? 18, 6)}</td>
                      <td className="num">{amount(l.path.length ? l.minOut : l.amountIn, settle.decimals)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel-foot row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className={basket.covers ? "muted" : ""}>
              {basket.covers ? `Guaranteed ${amount(basket.guaranteedOut, settle.decimals)} ${settle.symbol} ≥ ${amount(inv!.amount, settle.decimals)} due` : "Your whole wallet isn't enough for this invoice."}
            </span>
            <button className="btn primary" disabled={!basket.covers || Boolean(busy)} onClick={payBasket}>
              {busy ?? "Pay with basket"}
            </button>
          </div>
        </Panel>
      )}

      {error && <div className="callout red" style={{ marginBottom: 18 }}>{error}</div>}
      {busy && !error && (
        <div className="callout" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Spinner /> {busy} Confirm in your wallet.
        </div>
      )}
    </>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
