// The payment flows the demo video shows beyond the main checkout, clicked through the real UI on the local
// stack (scripts/dev-fork.sh, started fresh): hook payment through any router, split payment, basket payment,
// the merchant's CSV export, and a landing ticket's hover reveal. Merchant and payer use separate browser
// sessions, like two real people.
//   npx tsx e2e/ui.flows.e2e.ts [outDir]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";

const APP = "http://localhost:5173";
const out = process.argv[2] ?? ".fork/shots-flows";
mkdirSync(out, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const config = (await (await fetch(`${APP}/api/config`)).json()) as { devWalletAccounts: string[] };
const dev = { payer: config.devWalletAccounts[0]!, merchant: config.devWalletAccounts[1]! };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function connect(p: Page, which: "payer" | "merchant") {
  const wallet = p.locator(".wallet");
  for (let attempt = 0; attempt < 5; attempt++) {
    await p.waitForTimeout(1000);
    if ((await wallet.innerText()).includes(short(dev[which]))) return;
    const disconnect = p.getByRole("button", { name: "Disconnect" });
    if (await disconnect.isVisible()) {
      await disconnect.click();
      continue;
    }
    await p.getByRole("button", { name: "Connect wallet" }).click();
    const option = p.getByRole("button", { name: `Dev wallet (${which})` });
    if (await option.isVisible()) await option.click();
  }
  throw new Error(`could not connect the ${which} dev wallet`);
}

async function createInvoice(merchant: Page, amount: string): Promise<string> {
  await merchant.goto(`${APP}/merchant`, { waitUntil: "networkidle" });
  await connect(merchant, "merchant");
  await merchant.getByLabel(/^Amount/).fill(amount);
  await merchant.getByRole("button", { name: "Create invoice" }).click();
  const created = merchant.getByText(/Invoice #\d+ created\./);
  await created.waitFor({ timeout: 60_000 });
  return (await created.innerText()).match(/#(\d+)/)![1]!;
}

/** On the payer's pay page: pick the route whose row matches, review, confirm, wait for the receipt. */
async function payWith(payer: Page, id: string, row: RegExp, name: string) {
  await payer.goto(`${APP}/pay/unichain-sepolia/${id}`, { waitUntil: "networkidle" });
  await connect(payer, "payer");
  await payer.getByText("Best", { exact: true }).waitFor({ timeout: 60_000 });
  const target = payer.locator("tbody tr").filter({ hasText: row }).first();
  await target.click();
  assert.match(await payer.locator("tr.selected").innerText(), row, `${name}: route selected`);
  await shot(payer, `${name}-1-selected`);
  await payer.locator(".panel-foot .btn.primary").click();
  await payer.getByRole("button", { name: "Confirm and pay" }).click();
  await payer.getByText("Payment confirmed").waitFor({ timeout: 120_000 });
  await shot(payer, `${name}-2-receipt`);
  const receipt = await payer.locator("body").innerText();
  assert.match(receipt, /Merchant received\s+exactly 1\.00 USDC/, `${name}: exact amount`);
  console.log(`${name}: invoice #${id} paid; receipt says "Merchant received exactly 1.00 USDC"`);
}

const browser = await chromium.launch();
const ctx = (): Promise<BrowserContext> => browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const merchant = await (await ctx()).newPage();
const payer = await (await ctx()).newPage();
const errors: string[] = [];
for (const p of [merchant, payer]) p.on("pageerror", (e) => errors.push(e.message));

// 1. Landing: hover a ticket, the hidden characters light up around the cursor
await payer.goto(`${APP}/`, { waitUntil: "networkidle" });
const ticket = payer.locator(".ticket").first();
await ticket.scrollIntoViewIfNeeded();
const box = (await ticket.boundingBox())!;
await payer.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
await payer.waitForTimeout(400);
await ticket.screenshot({ path: `${out}/0-ticket-hover.png` });
assert.ok(Number(await ticket.evaluate((el) => getComputedStyle(el).getPropertyValue("--reveal") || "0")) > 0, "ticket reveal is on while hovered");
console.log("ticket: hover reveal is on");

// 2. Hook payment: Uniswap's own router swaps through the hooked pool; the pool's hook settles the invoice
await payWith(payer, await createInvoice(merchant, "1.00"), /DEMO[\s\S]*hooked pool/, "hook");

// 3. Split payment: part of the DEMO through each of two paths, one transaction
await payWith(payer, await createInvoice(merchant, "1.00"), /^\s*\d+%/m, "split");

// 4. Basket: an invoice no single token covers -> "Pay with a basket"
const basketId = await createInvoice(merchant, "2.00");
await payer.goto(`${APP}/pay/unichain-sepolia/${basketId}`, { waitUntil: "networkidle" });
await connect(payer, "payer");
await payer.getByRole("button", { name: "Pay with a basket" }).click({ timeout: 60_000 });
await payer.getByText("Basket", { exact: true }).first().waitFor({ timeout: 60_000 });
await shot(payer, "basket-1-plan");
await payer.locator(".panel-foot .btn.primary").last().click();
await payer.getByText("Payment confirmed").waitFor({ timeout: 120_000 });
await shot(payer, "basket-2-receipt");
assert.match(await payer.locator("body").innerText(), /Merchant received\s+exactly 2\.00 USDC/, "basket: exact amount");
console.log(`basket: invoice #${basketId} paid from several tokens; merchant received exactly 2.00 USDC`);

// 5. Merchant: the accountant's CSV has every invoice
await merchant.goto(`${APP}/merchant`, { waitUntil: "networkidle" });
await connect(merchant, "merchant");
const [download] = await Promise.all([merchant.waitForEvent("download"), merchant.getByRole("link", { name: "Export CSV" }).click()]);
const csv = readFileSync((await download.path())!, "utf8").trim().split("\n");
assert.ok(csv.length >= 4, "CSV has a header and the three invoices");
await shot(merchant, "merchant-after");
console.log(`csv: ${csv.length - 1} rows; header: ${csv[0]!.slice(0, 60)}…`);

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log(`UI FLOWS PASSED, screenshots in ${out}`);
