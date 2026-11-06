import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { useAppConfig } from "../lib/appConfig.ts";

/**
 * A "ticket": a card with a hidden layer of cipher characters. The layer is transparent until the cursor
 * is over the card; then a soft radial window around the cursor reveals the characters in neon colours,
 * and they fade out again as the cursor moves away or leaves.
 */
function Ticket(props: { n: string; title: string; children: ReactNode; seed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cipher = useMemo(() => cipherText(props.seed, 700), [props.seed]);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.style.setProperty("--reveal", "1");
  }
  function onLeave() {
    ref.current?.style.setProperty("--reveal", "0");
  }

  return (
    <div ref={ref} className="ticket reveal" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="ticket-cipher" aria-hidden="true">
        {cipher}
      </div>
      <div className="ticket-body">
        <div className="step-n">{props.n}</div>
        <h3>{props.title}</h3>
        <p>{props.children}</p>
      </div>
    </div>
  );
}

/** Deterministic pseudo-random hex/base64-looking text, so the same ticket always shows the same cipher. */
function cipherText(seed: number, length: number) {
  const alphabet = "0123456789abcdef0123456789abcdefxkqzv+/=";
  let s = seed * 2654435761;
  let out = "";
  for (let i = 0; i < length; i++) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    out += i % 9 === 8 ? " " : alphabet[s % alphabet.length];
  }
  return out;
}

/** Fade-in on scroll for anything with class "reveal". */
function useScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) return; // everything stays visible
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && en.target.classList.add("in")),
      { threshold: 0.12 },
    );
    for (const el of els) {
      if (el.getBoundingClientRect().top > window.innerHeight) el.classList.add("pending"); // only animate what's below the fold
      io.observe(el);
    }
    // Fallback: whatever hasn't scrolled into view after 1.5 s is shown anyway (screenshots, odd viewports).
    const t = setTimeout(() => els.forEach((el) => el.classList.add("in")), 1500);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, []);
}

export function LandingPage() {
  const cfg = useAppConfig();
  useScrollReveal();
  const merchant = cfg.demoMerchant;
  const invoicesQ = useQuery({ queryKey: ["invoices", merchant], queryFn: () => api.invoices(merchant!), enabled: Boolean(merchant) });
  const paid = (invoicesQ.data?.invoices ?? []).filter((i) => i.status === "Paid");
  const swapped = paid.filter((i) => i.paidWith && i.paidWith.toLowerCase() !== i.settleToken.toLowerCase()).length;

  return (
    <div className="landing">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div className="brand-name">Tender</div>
          <span className="net-pill">testnet</span>
        </div>
        <nav className="topnav">
          <a href="#what">What it does</a>
          <a href="#how">How it works</a>
          <a href="#about">About</a>
          <a href="#built">Built on</a>
          <a href="#compare">Compare</a>
        </nav>
        <div className="row" style={{ gap: 8 }}>
          {cfg.shopUrl && (
            <a className="btn ghost small" href={cfg.shopUrl} target="_blank" rel="noreferrer">
              Demo shop ↗
            </a>
          )}
          <Link className="btn primary small" to="/dashboard">
            Open app
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow">ETHGlobal Mumbai 2026 · Uniswap v4 · Whitechain · Hedera</div>
        <h1>
          Pay with any token.
          <br />
          <span className="accent">The merchant gets the exact amount.</span>
        </h1>
        <p>
          Tender turns a merchant invoice into one transaction: every Uniswap route ranked by true cost, an exact-output swap, and the unused input
          returned to the payer. The same merchant takes USDT on Whitechain and sells to AI agents over x402 on Hedera, all in one ledger.
        </p>
        <div className="hero-actions">
          <Link className="btn primary" to="/dashboard">
            Open dashboard
          </Link>
          {cfg.shopUrl && (
            <a className="btn" href={cfg.shopUrl} target="_blank" rel="noreferrer">
              Try the demo shop ↗
            </a>
          )}
          <Link className="btn ghost" to="/pay">
            Pay an invoice
          </Link>
        </div>
        <div className="hero-stats">
          <div>
            <b>{paid.length}</b>
            <span>invoices paid</span>
          </div>
          <div>
            <b>{swapped}</b>
            <span>via Uniswap swaps</span>
          </div>
          <div>
            <b>44 + 55</b>
            <span>Solidity + TypeScript tests</span>
          </div>
          <div>
            <b>0</b>
            <span>tokens held by the contract, ever</span>
          </div>
        </div>
        <a className="scroll-cue" href="#what">
          Scroll <span>↓</span>
        </a>
      </section>

      <section id="what" className="section">
        <div className="section-head reveal">
          <h2>What it does</h2>
          <p>Six things a checkout should do and a swap router doesn't. Move your cursor over a ticket.</p>
        </div>
        <div className="tickets">
          <Ticket n="01 · Exact output" title="The merchant is never short" seed={11}>
            The contract swaps for exactly the invoice amount, pays the merchant, and returns what it didn't need. If anything is off, the whole transaction reverts.
          </Ticket>
          <Ticket n="02 · Ranked routes" title="See every route, pick the cheapest" seed={23}>
            Direct, two-hop, split across pools, or through a hooked pool. Each with fees, price impact and gas. Buffers sized from measured impact, not a flat number.
          </Ticket>
          <Ticket n="03 · Checkout hook" title="The pool settles the invoice" seed={37}>
            A Uniswap v4 hook takes the invoice amount out of the swap and sends it to the merchant. Any router or wallet can pay a Tender invoice just by swapping.
          </Ticket>
          <Ticket n="04 · Basket" title="Pay from several tokens at once" seed={41}>
            Leftover USDC plus a little WETH plus some DEMO, in one transaction. The merchant still gets the exact amount.
          </Ticket>
          <Ticket n="05 · Whitechain" title="USDT invoices, refunds, exports" seed={53}>
            A drop-in widget a shop adds in about 20 lines. Partial refunds recorded on-chain and a CSV the accountant can open.
          </Ticket>
          <Ticket n="06 · Hedera x402" title="Sell to AI agents per request" seed={67}>
            HTTP 402 price tags settled in USDC on Hedera. The agent pays inside a spending policy, with no checkout form and no human.
          </Ticket>
        </div>
      </section>

      <section id="how" className="section">
        <div className="section-head reveal">
          <h2>How a payment works</h2>
          <p>One transaction, four guarantees checked on-chain.</p>
        </div>
        <ol className="timeline">
          {[
            ["Invoice", "The merchant creates an invoice for an exact stablecoin amount with an expiry. It lives on-chain."],
            ["Rank", "Tender scans the payer's balances and quotes every vetted route: direct, via WETH, split, or a hooked pool. Cheapest total first."],
            ["Review", "The payer sees what they give up, what the merchant gets, the price buffer and the gas, then confirms. Approvals are for the exact amount, never unlimited."],
            ["Settle", "An exact-output swap on the Uniswap v4 PoolManager. The USDC goes straight to the merchant; the unused input comes back to the payer in the same transaction."],
            ["Verify", "The contract asserts: merchant received exactly the amount, it holds nothing, the payer spent at most their cap. Otherwise everything reverts."],
          ].map(([t, d], i) => (
            <li key={t} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="about" className="section about">
        <div className="section-head reveal">
          <h2>About Tender</h2>
        </div>
        <div className="about-grid">
          <div className="reveal">
            <h3>The problem</h3>
            <p>
              At a crypto checkout the customer usually holds the wrong token. The store wants 1.00 USDC; the customer has WETH or something else. Today that is
              two apps, a guessed amount, and a merchant who may still be paid short.
            </p>
          </div>
          <div className="reveal">
            <h3>The idea</h3>
            <p>
              Put the guarantee where it can't be skipped: in the contract and, with the hook, in the pool itself. Then give the payer the information a
              trader has: every route, its real cost, and what comes back.
            </p>
          </div>
          <div className="reveal">
            <h3>What it is not</h3>
            <p>
              Not custody, not an operator: the contracts hold no funds and have no admin. Not an exchange: it settles invoices. The core "swap and deliver"
              idea exists elsewhere; the hook, the basket, the ranking and the three rails are what's new.
            </p>
          </div>
          <div className="reveal">
            <h3>Built at ETHGlobal Mumbai 2026</h3>
            <p>
              A two-person team, one project each. Tender is the payments half. 41 Solidity tests against a real v4 PoolManager, 34 TypeScript tests, two
              local end-to-end flows and one browser flow, all passing.
            </p>
          </div>
        </div>
      </section>

      <section id="built" className="section">
        <div className="section-head reveal">
          <h2>Built on</h2>
          <p>Sponsors and tools, and the job each one does.</p>
        </div>
        <div className="built-grid">
          {[
            ["Uniswap v4", "PoolManager flash accounting for exact-output swaps; the Quoter for ranking; a v4 hook as the checkout terminal.", "sponsor"],
            ["Unichain Sepolia", "Where the any-token checkout and the hook live. Circle USDC as the settle token.", "chain"],
            ["Whitechain Sepolia", "USDT invoices with one-signature permit payments, refunds and the accountant CSV.", "sponsor"],
            ["Hedera · x402", "HTTP 402 payments settled in USDC on Hedera; the facilitator pays the network fee; agents pay inside a spending policy.", "sponsor"],
            ["Foundry", "Contracts, 41 tests incl. 16k-call invariants, deploy scripts with CREATE2 salt mining for the hook.", "tool"],
            ["viem + wagmi", "Chain reads, typed contract calls, wallet connection and exact-amount approvals.", "tool"],
            ["Hono", "The read-only Tender API and the demo shop server.", "tool"],
            ["anvil forks", "Local copies of both testnets, so the whole product runs on a laptop with real Uniswap and real USDC/USDT.", "tool"],
            ["Playwright", "A headless browser that clicks through shop → checkout → pay → refund before every change ships.", "tool"],
          ].map(([name, role, kind], i) => (
            <div key={name} className="built reveal" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <b>{name}</b>
                <span className={`pill plain${kind === "sponsor" ? " accent" : ""}`}>{kind}</span>
              </div>
              <p>{role}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="compare" className="section">
        <div className="section-head reveal">
          <h2>How it compares</h2>
          <p>Honest: the core "swap and deliver exactly X" exists elsewhere. These parts don't.</p>
        </div>
        <div className="panel reveal">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Universal Router</th>
                  <th>0x Swap &amp; Send</th>
                  <th>Coinbase Commerce</th>
                  <th>Tender</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Payment logic lives in the pool (any router pays)", "—", "—", "—", "✓"],
                  ["One invoice from several tokens", "—", "—", "—", "✓"],
                  ["Payer sees every route and its true cost", "—", "—", "—", "✓"],
                  ["Exact amount to merchant, leftover returned", "partly", "partly", "✓", "✓"],
                  ["Invoices, refunds, cancel on-chain", "—", "—", "intents", "✓"],
                  ["No operator or admin", "✓", "✓", "operator", "✓"],
                  ["USDT rail + AI-agent rail, one ledger", "—", "—", "—", "✓"],
                ].map((row) => (
                  <tr key={row[0]}>
                    {row.map((c, i) => (
                      <td key={i} className={i === 0 ? "" : "num"} style={i === 4 ? { color: "var(--green)", fontWeight: 600 } : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">T</div>
          <div className="brand-name">Tender</div>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/merchant">Merchant</Link>
          <Link to="/agents">Agents</Link>
          {cfg.shopUrl && (
            <a href={cfg.shopUrl} target="_blank" rel="noreferrer">
              Demo shop
            </a>
          )}
        </div>
        <span className="faint">Testnets only. Nothing here has monetary value.</span>
      </footer>
    </div>
  );
}
