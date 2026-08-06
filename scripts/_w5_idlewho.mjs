/**
 * Is the battle route holding a request open, or is nothing open at all?
 *
 * `_w5_gotoidle.mjs` showed twenty-four seconds of `networkidle` timeouts during
 * which not one request started and not one was outstanding by the client's own
 * bookkeeping. Two very different things produce that picture: a request the
 * browser still considers live but whose completion never reaches the client, or
 * a lifecycle signal that simply never re-arms. The first is a leak in the app
 * and the second is a property of the harness, and `verify:screens` should be
 * repaired differently in each case.
 *
 * So this asks the page itself. `performance.getEntriesByType("resource")` lists
 * every request the *document* has seen and gives `responseEnd === 0` for one
 * still running — a source independent of Playwright's counters. Then it waits
 * on `networkidle` with no navigation at all, which removes the hash change from
 * the question entirely.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=301", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.waitForTimeout(4000);

const pending = async () =>
  page.evaluate(() => {
    const rows = performance.getEntriesByType("resource");
    return {
      total: rows.length,
      unfinished: rows.filter((r) => r.responseEnd === 0).map((r) => `${r.initiatorType} ${r.name.slice(-70)}`),
    };
  });

console.log("parked on the battle. document's own view:", JSON.stringify(await pending(), null, 1));

for (const label of ["first", "second"]) {
  const t = Date.now();
  await page
    .waitForLoadState("networkidle", { timeout: 8000 })
    .then(() => console.log(`${label} waitForLoadState(networkidle) — no navigation — ok in ${Date.now() - t}ms`))
    .catch(() => console.log(`${label} waitForLoadState(networkidle) — no navigation — TIMEOUT after ${Date.now() - t}ms`));
}

const t2 = Date.now();
await page
  .goto("http://localhost:5173/#stats", { waitUntil: "load", timeout: 8000 })
  .then(() => console.log(`goto #stats with waitUntil:"load" ok in ${Date.now() - t2}ms`))
  .catch(() => console.log(`goto #stats with waitUntil:"load" TIMEOUT after ${Date.now() - t2}ms`));

console.log("after the hash change:", JSON.stringify(await pending(), null, 1));
await browser.close();
