// Visual + functional QA of the real app against the LIVE testnets (start it with scripts/live-local.sh).
// For every page, at desktop and phone width: full-page screenshot, console errors, failed requests,
// horizontal overflow, and the values we expect from the chains. Read-only: nothing is signed or sent.
//   npx tsx e2e/live.visual.ts <screenshot-folder>
import { chromium, type Page } from "playwright";

const APP = "http://localhost:5173";
const SHOP = "http://localhost:8788";
const out = process.argv[2] ?? "e2e-shots";
type Check = { page: string; width: number; ok: boolean; what: string };
const checks: Check[] = [];
const problems: string[] = [];

async function visit(page: Page, name: string, url: string, width: number, expect: (p: Page) => Promise<[string, boolean][]>) {
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(m.text().slice(0, 160));
  const onFail = (r: { url(): string; failure(): { errorText: string } | null }) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  page.on("console", onConsole);
  page.on("requestfailed", onFail);
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const [what, ok] of await expect(page)) checks.push({ page: name, width, ok, what });
  checks.push({ page: name, width, ok: overflow <= 1, what: `no sideways scroll (overflow ${overflow}px)` });
  checks.push({ page: name, width, ok: errors.length === 0, what: `no console errors / failed requests${errors.length ? ": " + errors.join(" | ") : ""}` });
  await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
  page.off("console", onConsole);
  page.off("requestfailed", onFail);
}

const text = (p: Page) => p.locator("body").innerText();
const has = async (p: Page, s: string | RegExp) => {
  const t = await text(p);
  return typeof s === "string" ? t.includes(s) : s.test(t);
};

const b = await chromium.launch();
const page = await (await b.newContext({ acceptDownloads: true })).newPage();
for (const width of [1440, 390]) {
  await visit(page, "landing", `${APP}/`, width, async (p) => [
    ["hero headline", await has(p, "Pay with any token.")],
    ["live stat: 4 invoices paid", /\b4\s*invoices paid/i.test(await text(p))],
    ["test count shown", await has(p, "44 + 55")],
  ]);
  await visit(page, "dashboard", `${APP}/dashboard`, width, async (p) => [
    ["4 invoices", /Invoices\s*4/.test(await text(p))],
    ["Whitechain 1.00 USDT row", await has(p, "1.00 USDT")],
    ["Unichain paid with DEMO", await has(p, "DEMO")],
    ["refunded $0.40", await has(p, "$0.40")],
  ]);
  await visit(page, "merchant", `${APP}/merchant`, width, async (p) => [
    ["lists invoices", (await p.locator("table tbody tr").count()) >= 4],
    ["refund recorded", await has(p, /Refunded|0\.40/)],
  ]);
  await visit(page, "agents", `${APP}/agents`, width, async (p) => [
    ["audit topic linked", await has(p, "0.0.11345065")],
    ["two Bought entries", (await p.getByText("Bought", { exact: true }).count()) >= 2],
    ["agent revenue $0.20 from 4 HBAR sales", /Revenue from agents\s*\$0\.20/.test(await text(p))],
    ["one Refused entry", (await p.getByText("Refused", { exact: true }).count()) >= 1],
  ]);
  await visit(page, "pay-unichain-1", `${APP}/pay/unichain-sepolia/1`, width, async (p) => [
    ["shows Paid", await has(p, "Paid")],
    ["amount 0.10 USDC", await has(p, /0\.10\s*USDC/)],
  ]);
  await visit(page, "pay-whitechain-1", `${APP}/pay/whitechain-sepolia/1`, width, async (p) => [
    ["says it was paid", await has(p, /paid/i)],
    ["partial refund labelled as such", await has(p, "Part refunded")],
    ["refund amount shown: 0.40 USDT", /Refunded to payer\s*0\.40\s*USDT/.test(await text(p))],
    ["no 'Amount due' on a settled invoice", !(await has(p, "Amount due"))],
  ]);
  await visit(page, "pay-lookup", `${APP}/pay`, width, async (p) => [["lookup form", (await p.locator("input, select").count()) >= 1]]);
  await visit(page, "shop", `${SHOP}/`, width, async (p) => [["shop page", await has(p, "Chai")]]);
}

// Click EVERY visible button and internal link on every page (fresh load each time). Read-only: no wallet is
// connected, so nothing can be signed. A click fails if it logs an error, blanks the page, or lands on a 404.
const pages = ["/", "/dashboard", "/merchant", "/agents", "/pay", "/pay/unichain-sepolia/1", "/pay/whitechain-sepolia/1"];
await page.setViewportSize({ width: 1440, height: 900 });
for (const path of pages) {
  await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
  const targets = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href]"))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el, i) => ({ i, tag: el.tagName, label: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40), href: el.getAttribute("href") || "", ext: el.getAttribute("target") === "_blank" })),
  );
  for (const t of targets) {
    if (t.ext || /^https?:/.test(t.href)) {
      checks.push({ page: `click ${path}`, width: 1440, ok: /^https?:\/\/[^ ]+$/.test(t.href) || t.href.startsWith("/"), what: `external link "${t.label}" -> ${t.href.slice(0, 70)}` });
      continue;
    }
    if (t.href.startsWith("mailto:")) continue;
    await page.goto(`${APP}${path}`, { waitUntil: "networkidle" });
    const errs: string[] = [];
    const onErr = (m: { type(): string; text(): string }) => m.type() === "error" && errs.push(m.text().slice(0, 120));
    page.on("console", onErr);
    const el = page.locator("button, a[href]").filter({ visible: true }).nth(t.i);
    const before = page.url();
    if (await el.isDisabled()) {
      checks.push({ page: `click ${path}`, width: 1440, ok: true, what: `button "${t.label}" is disabled until its form is filled (expected)` });
      continue;
    }
    await el.click({ timeout: 5_000 }).catch((e) => errs.push(`click failed: ${String(e).slice(0, 80)}`));
    await page.waitForTimeout(700);
    const body = (await text(page)).trim();
    const notFound = /not found|unknown network|no such page/i.test(body) && !/no invoices/i.test(body);
    page.off("console", onErr);
    checks.push({
      page: `click ${path}`,
      width: 1440,
      ok: errs.length === 0 && body.length > 20 && !notFound,
      what: `${t.tag === "A" ? "link" : "button"} "${t.label || t.href}"${page.url() !== before ? ` -> ${page.url().replace(APP, "")}` : ""}${errs.length ? " ERR " + errs.join(" | ") : ""}${notFound ? " LANDED ON 'NOT FOUND'" : ""}`,
    });
    await page.keyboard.press("Escape").catch(() => {});
  }
}

// interactions (desktop)
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${APP}/merchant`, { waitUntil: "networkidle" });
const csvButton = page.getByRole("link", { name: /csv/i }).or(page.getByRole("button", { name: /csv/i })).first();
if (await csvButton.count()) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }).catch(() => null), csvButton.click()]);
  const rows = dl ? (await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8")).trim().split("\n") : [];
  checks.push({ page: "merchant CSV", width: 1440, ok: rows.length >= 5, what: `CSV download: ${rows.length} lines (header + 4 invoices expected)` });
} else problems.push("no CSV export control found on /merchant");
await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /connect wallet/i }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/connect-wallet-1440.png` });
checks.push({ page: "connect wallet", width: 1440, ok: (await text(page)).match(/MetaMask|wallet|Install|Browser/i) !== null, what: "wallet panel opens with a clear next step" });

await b.close();
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.page.padEnd(17)} ${String(c.width).padEnd(5)} ${c.what}`);
for (const p of problems) console.log(`NOTE  ${p}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
process.exitCode = failed.length ? 1 : 0;
