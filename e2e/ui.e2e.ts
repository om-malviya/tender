// Clicks through the real UI in a headless browser, against the local stack from scripts/dev-fork.sh.
//   bash scripts/dev-fork.sh        (in one terminal)
//   npx tsx e2e/ui.e2e.ts [outDir]  (in another; screenshots go to outDir, default ./.fork/shots)
// Each run spends ~0.8 of the payer's 3 DEMO and 1 of its 5 USDT, so restart dev-fork.sh after ~3 runs.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const APP = "http://localhost:5173";
const SHOP = "http://localhost:8788";
const out = process.argv[2] ?? ".fork/shots";
mkdirSync(out, { recursive: true });

async function waitForUp(url: string) {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never came up`);
}
await waitForUp(`${APP}/api/config`); // via Vite's proxy: proves app + API are both up
await waitForUp(SHOP);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (p: Page, name: string) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });

// Dev wallets from the server config: [payer, merchant] (scripts/fork-up.sh)
const config = (await (await fetch(`${APP}/api/config`)).json()) as { devWalletAccounts: string[] };
const devAddress = { payer: config.devWalletAccounts[0]!, merchant: config.devWalletAccounts[1]! };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Make sure `which` dev wallet is the connected one. wagmi restores a remembered wallet shortly AFTER the
 *  page loads, so check what's actually connected, switch if it's the wrong one, and confirm the address. */
async function connect(p: Page, which: "payer" | "merchant") {
  const want = short(devAddress[which]);
  const wallet = p.locator(".wallet");
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.waitForTimeout(1000);
    if ((await wallet.innerText()).includes(want)) return;
    const disconnect = p.getByRole("button", { name: "Disconnect" });
    if (await disconnect.isVisible()) {
      await disconnect.click();
      continue;
    }
    await p.getByRole("button", { name: "Connect wallet" }).click();
    const option = p.getByRole("button", { name: `Dev wallet (${which})` });
    if (await option.isVisible()) await option.click();
  }
  await p.locator(".wallet", { hasText: want }).waitFor({ timeout: 10_000 });
}

// 1. Dashboard (no wallet: shows the demo merchant)
await page.goto(APP);
await page.getByRole("heading", { name: /Pay with any token/ }).waitFor();
await shot(page, "0-landing");
await page.goto(`${APP}/dashboard`);
await page.getByRole("heading", { name: "Dashboard" }).waitFor();
await page.getByText("Recent payments").waitFor();
await shot(page, "1-dashboard");

// 2. Shop -> buy with any token -> Tender popup
await page.goto(SHOP);
await shot(page, "2-shop");
const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /Pay with any token/ }).click()]);
popup.on("pageerror", (e) => errors.push(e.message));
await popup.setViewportSize({ width: 1100, height: 820 });
const title = popup.getByText(/Checkout · Invoice #/);
await title.waitFor();
const invoiceId = (await title.innerText()).match(/#(\d+)/)![1]!;
await connect(popup, "payer");
await popup.getByText("Best", { exact: true }).waitFor({ timeout: 60_000 });
await shot(popup, "3-checkout-ranked");

// the pre-selected row is the one marked BEST. Which route wins depends on current pool prices
// (repeated runs on the same fork move them); e2e/fork.e2e.ts checks the fresh-fork case.
const best = popup.locator("tr.selected");
assert.match(await best.innerText(), /Best/i);

// 3. Pay
await popup.getByRole("button", { name: /^Pay 1\.00 USDC with DEMO/ }).click();
await popup.getByRole("dialog", { name: "Review payment" }).waitFor();
await shot(popup, "3b-review-sheet");
await popup.getByRole("button", { name: "Confirm and pay" }).click();
await popup.getByText("Payment confirmed").waitFor({ timeout: 90_000 });
assert.match(await popup.locator(".panel", { hasText: "Payment confirmed" }).innerText(), /exactly 1\.00 USDC/);
await shot(popup, "4-checkout-paid");

// 4. The shop hears about it and confirms ON-CHAIN through its own server
await page.locator("#status.ok").waitFor({ timeout: 30_000 });
assert.match(await page.locator("#status").innerText(), /confirmed/);
await shot(page, "5-shop-confirmed");
// the widget reuses one named checkout window; a real shopper closes it after paying
await popup.close();

// 4b. Whitechain: pay a USDT invoice from the shop (no swap: direct stablecoin; the wallet switches chain)
await page.goto(SHOP);
const [wcPopup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /Pay with USDT/ }).click()]);
wcPopup.on("pageerror", (e) => errors.push(e.message));
await wcPopup.setViewportSize({ width: 1100, height: 820 });
await wcPopup.getByText(/Checkout · Invoice #/).waitFor();
await connect(wcPopup, "payer");
await wcPopup.getByText("Best", { exact: true }).waitFor({ timeout: 60_000 });
assert.match(await wcPopup.locator("tr.selected").innerText(), /USDT \(no swap\)/);
await shot(wcPopup, "5b-whitechain-checkout");
await wcPopup.getByRole("button", { name: /^Pay 1\.00 USDT$/ }).click();
await wcPopup.getByRole("button", { name: "Confirm and pay" }).click();
await wcPopup.getByText("Payment confirmed").waitFor({ timeout: 90_000 });
assert.match(await wcPopup.locator(".panel", { hasText: "Payment confirmed" }).innerText(), /exactly 1\.00 USDT/);
await shot(wcPopup, "5c-whitechain-paid");
await page.locator("#status.ok").waitFor({ timeout: 30_000 });
assert.match(await page.locator("#status").innerText(), /confirmed/);

// 5. Merchant refunds 0.25 of it
await page.goto(`${APP}/merchant`);
await connect(page, "merchant");
// work on the row of the invoice we just paid (earlier runs may have left other invoices on the fork)
// invoice numbers are per chain (Unichain #3 and Whitechain #3 both exist), so match the chain-specific link
const row = page.locator("tbody tr", { has: page.locator(`a[href="/pay/unichain-sepolia/${invoiceId}"]`) });
await row.getByRole("button", { name: "Refund…" }).click();
await page.getByPlaceholder("0.25").fill("0.25");
await page.getByRole("button", { name: "Refund 0.25 USDC" }).click();
// wait for that row's STATUS PILL (the word "Refunded" is also a filter button)
await row.locator(".pill", { hasText: "Refunded" }).waitFor({ timeout: 60_000 });
assert.match(await row.innerText(), /0\.25/);
await shot(page, "6-merchant-refunded");

// 6. Dashboard again, now with activity; agents page
await page.goto(`${APP}/dashboard`);
await page.locator("tbody tr").first().waitFor();
await shot(page, "7-dashboard-after");
await page.goto(`${APP}/agents`);
await shot(page, "8-agents");

await browser.close();
assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`UI E2E PASSED, screenshots in ${out}`);
