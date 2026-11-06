import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { useConnection, useSwitchChain } from "wagmi";
import { checkoutCoreAbi, hookSwapArgs, poolSwapTestAbi, uniswapCheckoutAbi } from "@tender/core";
import { api, type BasketView, type ChainKey, type RouteView } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";
import { amount, short, tokenOf, usd } from "../lib/format.ts";
import { errorText, useTx } from "../lib/tx.ts";
import { Addr, ChainPill, Empty, PageHeader, Panel, RouteChips, Sheet, SourcePill, Spinner, StatusPill, Stepper, TokenLogo } from "../components/ui.tsx";

/** /pay: open an invoice by chain + id. */
export function PayLookupPage() {
  const cfg = useAppConfig();
  const navigate = useNavigate();
  const [chain, setChain] = useState<ChainKey>(cfg.chains.find((c) => c.checkout)?.key ?? "unichain-sepolia");
  const [id, setId] = useState("");
  return (
    <>
      <PageHeader crumb={["Pay"]} title="Pay an invoice" subtitle="Enter an invoice number from a merchant. Shops open this for you through the Tender widget." />
      <Panel title="Open an invoice">
        <form
          className="panel-body row"
          onSubmit={(e) => {
            e.preventDefault();
            if (id) navigate(`/pay/${chain}/${id}`);
          }}
        >
          <div className="field">
            <label htmlFor="lookup-network">Network</label>
            <select id="lookup-network" value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
              {cfg.chains.map((c) => (
                <option key={c.key} value={c.key} disabled={!c.checkout}>
                  {c.name}
                  {c.checkout ? "" : " (not deployed)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lookup-id">Invoice #</label>
            <input id="lookup-id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} placeholder="1" autoFocus />
          </div>
          <button className="btn primary" type="submit" disabled={!id}>
            Open
          </button>
        </form>
      </Panel>
    </>
  );
}

type Receipt = { txHash: Hex; spent: { symbol: string; amount: string; decimals: number }[]; returned?: { amount: string; symbol: string; decimals: number }; settled: string; route: string };
type Phase = "idle" | "review" | "approving" | "paying" | "done";

const STEPS = ["Route", "Review", "Pay", "Done"];

/** /pay/:chain/:id: the checkout. Route → review sheet → approve/pay → receipt. */
export function PayPage() {
  const { chain, id } = useParams() as { chain: ChainKey; id: string };
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const cfg = useAppConfig();
  const chainCfg = cfg.chain(chain);
  const { address, isConnected, chainId: walletChainId, status: walletStatus } = useConnection();
  const switchChain = useSwitchChain();
  const askedToSwitch = useRef(false);
  // The wallet follows the invoice's chain as soon as the page opens (asked once; a refusal is respected and
  // the pay step asks again), so the wallet badge never says Unichain while you pay a Whitechain invoice.
  // Wait for a fully established connection: a wallet still reconnecting from a previous page drops the request.
  useEffect(() => {
    if (walletStatus !== "connected" || !chainCfg || walletChainId === chainCfg.id || askedToSwitch.current) return;
    askedToSwitch.current = true;
    switchChain.mutate({ chainId: chainCfg.id });
  }, [walletStatus, walletChainId, chainCfg, switchChain]);
  const tx = useTx();
  const queryClient = useQueryClient();

  const invoiceQ = useQuery({ queryKey: ["invoice", chain, id], queryFn: () => api.invoice(chain, id), refetchInterval: 10_000 });
  const inv = invoiceQ.data;
  const settle = tokenOf(chainCfg, inv?.settleToken) ?? chainCfg?.settleToken;
  const now = useNow();
  const secondsLeft = inv ? Number(inv.expiry) - now : 0;
  const payable = inv?.status === "Open" && secondsLeft > 0;

  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [basket, setBasket] = useState<BasketView | null>(null);

  // Quotes go stale fast, so re-rank every 20 s while choosing a route (not while a payment is in flight).
  const rankQ = useQuery({
    queryKey: ["rank", chain, id, address],
    queryFn: () => api.rank(chain, id, address!),
    enabled: Boolean(address && payable),
    refetchInterval: phase === "idle" ? 20_000 : false,
  });
  const routes = rankQ.data?.routes ?? [];
  const recommendedIndex = routes.findIndex((r) => r.affordable && r.executable && !Number.isNaN(r.totalCostUsd));
  const [picked, setPicked] = useState<number | null>(null);
  const selectedIndex = picked !== null && routes[picked] ? picked : recommendedIndex;
  const displayOrder = routes.map((_, i) => i).sort((a, b) => Number(usableRoute(routes[b]!)) - Number(usableRoute(routes[a]!)));
  const selected = selectedIndex >= 0 ? routes[selectedIndex] : undefined;

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 10 * 60); // a stale quote can't be mined later

  function announce(txHash: Hex) {
    // The shop's widget listens for this; it still confirms the payment on-chain.
    if (embed && window.opener) window.opener.postMessage({ type: "tender:paid", chain, invoiceId: id, txHash }, "*");
    queryClient.invalidateQueries({ queryKey: ["invoice", chain, id] });
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setPhase("done");
    } catch (e) {
      setError(errorText(e));
      setPhase("idle");
    } finally {
      setBusy(null);
    }
  }

  function pay(route: RouteView) {
    if (!chainCfg?.checkout || !inv || !settle || !tx.address) return;
    const checkout = chainCfg.checkout;
    const invoiceId = BigInt(id);
    const me = tx.address;
    const hops = (hs: RouteView["hops"]) => hs.map((h) => ({ tokenIn: h.tokenIn, fee: h.fee, tickSpacing: h.tickSpacing }));
    const balanceOf = (token: Address) => tx.client(chainCfg.id).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [me] });

    return run(async () => {
      if (route.source === "direct") {
        setPhase("approving");
        setBusy(`Approve ${amount(inv.amount, settle.decimals)} ${settle.symbol}`);
        await tx.approveIfNeeded(chainCfg.id, settle.address, checkout, BigInt(inv.amount));
        setPhase("paying");
        setBusy("Confirm the payment in your wallet");
        const r = await tx.send({ chainId: chainCfg.id, address: checkout, abi: checkoutCoreAbi, functionName: "payInvoice", args: [invoiceId] });
        setReceipt({ txHash: r.transactionHash, spent: [{ symbol: settle.symbol, amount: inv.amount, decimals: settle.decimals }], settled: inv.amount, route: route.label });
        announce(r.transactionHash);
      } else if (route.source === "v4-hook" && route.hook) {
        // Paid by a plain Uniswap router swapping through the hooked pool. Tender's contract is never called.
        const amountIn = BigInt(route.maxAmountIn);
        setPhase("approving");
        setBusy(`Approve ${amount(amountIn, route.token.decimals)} ${route.token.symbol} for the router`);
        await tx.approveIfNeeded(chainCfg.id, route.token.address, route.hook.router, amountIn);
        setPhase("paying");
        setBusy("Confirm the swap in your wallet");
        const before = await balanceOf(settle.address);
        const r = await tx.send({ chainId: chainCfg.id, address: route.hook.router, abi: poolSwapTestAbi, functionName: "swap", args: hookSwapArgs(route.hook, amountIn, invoiceId, me) });
        const after = await balanceOf(settle.address);
        setReceipt({
          txHash: r.transactionHash,
          spent: [{ symbol: route.token.symbol, amount: amountIn.toString(), decimals: route.token.decimals }],
          returned: { amount: (after - before).toString(), symbol: settle.symbol, decimals: settle.decimals },
          settled: inv.amount,
          route: route.label,
        });
        announce(r.transactionHash);
      } else if (route.source === "split" && route.split) {
        const legs = route.split.map((l) => ({ tokenIn: route.token.address, amountIn: BigInt(l.amountIn), path: hops(l.hops), minOut: BigInt(l.minOut) }));
        const total = legs.reduce((s, l) => s + l.amountIn, 0n);
        setPhase("approving");
        setBusy(`Approve ${amount(total, route.token.decimals)} ${route.token.symbol}`);
        await tx.approveIfNeeded(chainCfg.id, route.token.address, checkout, total);
        setPhase("paying");
        setBusy("Confirm the payment in your wallet");
        const r = await tx.send({ chainId: chainCfg.id, address: checkout, abi: uniswapCheckoutAbi, functionName: "payWithBasket", args: [invoiceId, legs, deadline()] });
        const [ev] = parseEventLogs({ abi: uniswapCheckoutAbi, eventName: "BasketPaid", logs: r.logs });
        const out = ev?.args.totalOut ?? BigInt(inv.amount);
        setReceipt({
          txHash: r.transactionHash,
          spent: [{ symbol: route.token.symbol, amount: total.toString(), decimals: route.token.decimals }],
          returned: { amount: (out - BigInt(inv.amount)).toString(), symbol: settle.symbol, decimals: settle.decimals },
          settled: inv.amount,
          route: route.label,
        });
        announce(r.transactionHash);
      } else {
        const maxIn = BigInt(route.maxAmountIn);
        setPhase("approving");
        setBusy(`Approve up to ${amount(maxIn, route.token.decimals)} ${route.token.symbol}`);
        await tx.approveIfNeeded(chainCfg.id, route.token.address, checkout, maxIn);
        setPhase("paying");
        setBusy("Confirm the payment in your wallet");
        const r = await tx.send({ chainId: chainCfg.id, address: checkout, abi: uniswapCheckoutAbi, functionName: "payWithToken", args: [invoiceId, route.token.address, maxIn, hops(route.hops), deadline()] });
        const [ev] = parseEventLogs({ abi: uniswapCheckoutAbi, eventName: "InvoicePaid", logs: r.logs });
        const spent = ev?.args.amountIn ?? maxIn;
        setReceipt({
          txHash: r.transactionHash,
          spent: [{ symbol: route.token.symbol, amount: spent.toString(), decimals: route.token.decimals }],
          returned: { amount: (maxIn - spent).toString(), symbol: route.token.symbol, decimals: route.token.decimals },
          settled: (ev?.args.amountSettled ?? BigInt(inv.amount)).toString(),
          route: route.label,
        });
        announce(r.transactionHash);
      }
    });
  }

  async function buildBasket() {
    if (!address) return;
    setError(null);
    setBusy("Building a basket from your balances");
    try {
      setBasket(await api.basket(chain, id, address));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function payBasket() {
    if (!basket || !chainCfg?.checkout || !inv || !settle) return;
    const checkout = chainCfg.checkout;
    return run(async () => {
      setPhase("approving");
      for (const leg of basket.legs) {
        const t = tokenOf(chainCfg, leg.tokenIn);
        setBusy(`Approve ${amount(leg.amountIn, t?.decimals ?? 18)} ${t?.symbol ?? short(leg.tokenIn)}`);
        await tx.approveIfNeeded(chainCfg.id, leg.tokenIn, checkout, BigInt(leg.amountIn));
      }
      setPhase("paying");
      setBusy("Confirm the payment in your wallet");
      const r = await tx.send({
        chainId: chainCfg.id,
        address: checkout,
        abi: uniswapCheckoutAbi,
        functionName: "payWithBasket",
        args: [BigInt(id), basket.legs.map((l) => ({ tokenIn: l.tokenIn, amountIn: BigInt(l.amountIn), path: l.path.map((h) => ({ tokenIn: h.tokenIn, fee: h.fee, tickSpacing: h.tickSpacing })), minOut: BigInt(l.minOut) })), deadline()],
      });
      const [ev] = parseEventLogs({ abi: uniswapCheckoutAbi, eventName: "BasketPaid", logs: r.logs });
      const total = ev?.args.totalOut ?? BigInt(inv.amount);
      setReceipt({
        txHash: r.transactionHash,
        spent: basket.legs.map((l) => {
          const t = tokenOf(chainCfg, l.tokenIn);
          return { symbol: t?.symbol ?? short(l.tokenIn), amount: l.amountIn, decimals: t?.decimals ?? 18 };
        }),
        returned: { amount: (total - BigInt(inv.amount)).toString(), symbol: settle.symbol, decimals: settle.decimals },
        settled: inv.amount,
        route: `Basket of ${basket.legs.length} tokens`,
      });
      announce(r.transactionHash);
    });
  }

  if (!chainCfg) return <Empty>Unknown network “{chain}”.</Empty>;

  // an invoice someone already paid shows the flow as finished (every step ticked), not "step 1: Route"
  const settledBefore = phase === "idle" && invoiceQ.data?.status === "Paid";
  const stepIndex = settledBefore ? STEPS.length : phase === "idle" ? 0 : phase === "review" ? 1 : phase === "done" ? 3 : 2;
  const seen = new Set<string>();
  const balances = routes.filter((r) => (seen.has(r.token.address) ? false : (seen.add(r.token.address), true))).map((r) => ({ token: r.token, balance: r.balance }));
  const priceOf = (addr: string) => rankQ.data?.usdPerToken?.[addr.toLowerCase()];
  const inFlight = phase !== "idle" && phase !== "done";
  const symbolOf = (a: string) => tokenOf(chainCfg, a)?.symbol ?? short(a);
  const legLabel = (l: BasketView["legs"][number]) =>
    l.path.length
      ? `${l.path.map((h) => `${symbolOf(h.tokenIn)} -${(h.fee / 10_000).toFixed(2)}%->`).join(" ")} ${settle?.symbol ?? ""}`
      : `${symbolOf(l.tokenIn)} (no swap)`;

  return (
    <>
      {!embed ? (
        <PageHeader crumb={["Pay", `Invoice #${id}`]} title={`Invoice #${id}`} subtitle="Pay with any token you hold. The merchant receives the exact amount." actions={<Link className="btn" to="/pay">Open another</Link>} />
      ) : (
        <h1 style={{ fontSize: 16, marginBottom: 12 }}>Checkout · Invoice #{id}</h1>
      )}
      {(phase !== "idle" || !invoiceQ.data || invoiceQ.data.status === "Open" || invoiceQ.data.status === "Paid") && <Stepper steps={STEPS} current={stepIndex} />}

      <Panel title="Invoice" actions={inv && <StatusPill status={inv.status === "Open" && secondsLeft <= 0 ? "Expired" : inv.status} refunded={inv.refunded} amount={inv.amount} />}>
        <div className="panel-body">
          {invoiceQ.isLoading && <Spinner />}
          {invoiceQ.error && <div className="callout red">{String(invoiceQ.error.message)}</div>}
          {inv && settle && (
            <dl className="kv">
              <div>
                <dt>{inv.status === "Open" ? "Amount due" : "Amount"}</dt>
                <dd className="big-amount">
                  {amount(inv.amount, settle.decimals)} <span className="muted">{settle.symbol}</span>
                </dd>
              </div>
              {inv.refunded !== "0" && (
                <div>
                  <dt>Refunded to payer</dt>
                  <dd className="big-amount">
                    {amount(inv.refunded, settle.decimals)} <span className="muted">{settle.symbol}</span>
                  </dd>
                </div>
              )}
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
            <div className="status-line" style={{ marginBottom: 10 }}>
              <span className="ok-check">✓</span>
              <div>
                <div>
                  Merchant received <b>exactly {amount(receipt.settled, settle.decimals)} {settle.symbol}</b>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  <Addr value={receipt.txHash} chain={chainCfg} kind="tx" />
                </div>
              </div>
            </div>
            <div className="receipt-line">
              <span className="muted">You paid</span>
              <span>{receipt.spent.map((s) => `${amount(s.amount, s.decimals, 6)} ${s.symbol}`).join(" + ")}</span>
            </div>
            {receipt.returned && receipt.returned.amount !== "0" && (
              <div className="receipt-line">
                <span className="muted">Returned to you in the same transaction</span>
                <span>
                  {amount(receipt.returned.amount, receipt.returned.decimals, 6)} {receipt.returned.symbol}
                </span>
              </div>
            )}
            <div className="receipt-line">
              <span className="muted">Route</span>
              <RouteChips label={receipt.route} />
            </div>
          </div>
        </Panel>
      )}

      {!receipt && inv && !payable && inv.status === "Paid" && <div className="callout green">This invoice has been paid.</div>}

      {!receipt && payable && isConnected && balances.length > 0 && (
        <Panel title="Your balances" subtitle={`On ${chainCfg.name}`}>
          <div className="tokens">
            {balances.map((b) => (
              <div className="token-row" key={b.token.address}>
                <TokenLogo symbol={b.token.symbol} />
                <span className="sym">{b.token.symbol}</span>
                <span className="bal">
                  <div>{amount(b.balance, b.token.decimals, 6)}</div>
                  <div className="usd">{usd((Number(b.balance) / 10 ** b.token.decimals) * (priceOf(b.token.address) ?? NaN))}</div>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!receipt && payable && (
        <Panel
          title="Choose how to pay"
          subtitle={chainCfg.swaps ? "Cheapest first. Total = value of what you give up + gas. Quotes from the Uniswap v4 Quoter, refreshed every 20 s." : `${settle?.symbol} on ${chainCfg.name}, paid directly.`}
          actions={rankQ.isFetching ? <Spinner /> : null}
        >
          {!isConnected && <Empty>Connect a wallet to see what you can pay with.</Empty>}
          {isConnected && rankQ.error && <Empty>{String(rankQ.error.message)}</Empty>}
          {isConnected && routes.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Route</th>
                    <th className="num">You pay</th>
                    <th className="num">Fees + impact</th>
                    <th className="num">Gas</th>
                    <th className="num">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {/* routes you can use first (cheapest first, as ranked), then the ones you can't, dimmed */}
                  {displayOrder.map((i) => {
                    const r = routes[i]!;
                    const usable = r.affordable && r.executable;
                    return (
                      <tr key={`${r.source}-${r.label}`} className={`${usable ? "selectable" : "dim"}${i === selectedIndex ? " selected" : ""}`} onClick={() => usable && setPicked(i)}>
                        <td>
                          <div className="route-cell">
                            <RouteChips label={r.label} />
                            <SourcePill source={r.source} />
                          </div>
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
                            <span className="pill accent">Best</span>
                          ) : !r.executable ? (
                            <span className="pill plain" title={r.note}>
                              Compare only
                            </span>
                          ) : !r.affordable ? (
                            <span className="pill plain" title={`You hold ${amount(r.balance, r.token.decimals)} ${r.token.symbol}`}>
                              Not enough
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
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <span className="muted">Selected</span>
                    <RouteChips label={selected.label} />
                  </div>
                  <button className="btn primary" disabled={inFlight} onClick={() => setPhase("review")}>
                    {selected.source === "direct"
                      ? `Pay ${amount(inv.amount, settle.decimals)} ${settle.symbol}`
                      : `Pay ${amount(inv.amount, settle.decimals)} ${settle.symbol} with ${selected.token.symbol}${selected.source === "v4-hook" ? " via any router" : selected.source === "split" ? " (split)" : ""}`}
                  </button>
                </div>
              ) : rankQ.isLoading ? (
                <span className="muted">Scanning your balances and quoting routes…</span>
              ) : chainCfg.swaps ? (
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="muted">No single token covers this invoice. Combine several in one transaction.</div>
                  <button className="btn primary" disabled={Boolean(busy)} onClick={buildBasket}>
                    {busy ?? "Pay with a basket"}
                  </button>
                </div>
              ) : (
                <span className="muted">Your wallet doesn't hold enough {settle?.symbol} for this invoice.</span>
              )}
            </div>
          )}
        </Panel>
      )}

      {!receipt && basket && settle && inv && (
        <Panel title="Basket" subtitle="Each leg is swapped with exact input; together they guarantee at least the invoice amount. Any excess comes back to you.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
                        <RouteChips label={legLabel(l)} />
                      </td>
                      <td className="num">{amount(l.amountIn, t?.decimals ?? 18, 6)}</td>
                      <td className="num">{amount(l.path.length ? l.minOut : l.amountIn, settle.decimals)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel-foot row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted">{basket.covers ? `Guaranteed ${amount(basket.guaranteedOut, settle.decimals)} ${settle.symbol} ≥ ${amount(inv.amount, settle.decimals)} due` : "Your whole wallet isn't enough for this invoice."}</span>
            <button className="btn primary" disabled={!basket.covers || inFlight} onClick={payBasket}>
              Pay {amount(inv.amount, settle.decimals)} {settle.symbol} with basket
            </button>
          </div>
        </Panel>
      )}

      {error && <div className="callout red" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Basket payments show progress inline; single-route payments go through the review sheet. */}
      {inFlight && !selected && (
        <div className="callout status-line">
          <Spinner /> {busy}
        </div>
      )}

      {/* Review sheet: what you pay, what the merchant gets, what comes back. Then approve + pay with status. */}
      {inFlight && selected && inv && settle && (
        <Sheet
          title={phase === "review" ? "Review payment" : phase === "approving" ? "Step 1 of 2 · Approve" : "Step 2 of 2 · Pay"}
          onClose={phase === "review" ? () => setPhase("idle") : undefined}
          foot={
            phase === "review" ? (
              <>
                <button className="btn" onClick={() => setPhase("idle")}>
                  Back
                </button>
                <button className="btn primary" onClick={() => pay(selected)}>
                  Confirm and pay
                </button>
              </>
            ) : (
              <span className="status-line">
                <Spinner /> {busy}
              </span>
            )
          }
        >
          <div className="flow">
            <div>
              <div className="lbl">You pay up to</div>
              <div className="amt">
                {amount(selected.maxAmountIn, selected.token.decimals, 6)} {selected.token.symbol}
              </div>
            </div>
            <div className="arrow">→</div>
            <div style={{ textAlign: "right" }}>
              <div className="lbl">Merchant receives</div>
              <div className="amt">
                {amount(inv.amount, settle.decimals)} {settle.symbol}
              </div>
            </div>
          </div>
          <div>
            <div className="detail">
              <span className="k">Route</span>
              <RouteChips label={selected.label} />
            </div>
            <div className="detail">
              <span className="k">Quoted now</span>
              <span>
                {amount(selected.amountIn, selected.token.decimals, 6)} {selected.token.symbol}
              </span>
            </div>
            {selected.hops.length > 0 && (
              <div className="detail">
                <span className="k">Price buffer</span>
                <span>
                  {(selected.slippageBps / 100).toFixed(2)}%{selected.impactBps > 0 ? ` · from ${(selected.impactBps / 100).toFixed(2)}% measured impact` : ""}
                </span>
              </div>
            )}
            <div className="detail">
              <span className="k">Fees + impact</span>
              <span>{usd(selected.overpayUsd)}</span>
            </div>
            <div className="detail">
              <span className="k">Network fee (est.)</span>
              <span>{usd(selected.gasUsd)}</span>
            </div>
            <div className="detail">
              <span className="k">Unused amount</span>
              <span>Returned in the same transaction</span>
            </div>
            <div className="detail">
              <span className="k">Settled by</span>
              <span>{selected.source === "v4-hook" ? "The pool's hook, via a generic Uniswap router" : selected.source === "direct" ? "CheckoutCore" : "UniswapCheckout"}</span>
            </div>
          </div>
          {phase !== "review" && (
            <div className="callout">{phase === "approving" ? "Approving the exact amount, never unlimited." : "Swapping and paying in one transaction. If anything is off, it reverts and nothing moves."}</div>
          )}
        </Sheet>
      )}
    </>
  );
}

const usableRoute = (r: RouteView) => r.affordable && r.executable;

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
