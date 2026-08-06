/**
 * Which navigations can `waitUntil: "networkidle"` still finish, and why not.
 *
 * The previous two instruments narrowed `verify:screens`' death to a `page.goto`
 * that commits and then never satisfies `networkidle`, on a screen that issues no
 * requests at all. Those two facts cannot both be true of the *screen*, so the
 * remaining suspect is a request Playwright still counts as open — one that was
 * started and then neither finished nor failed.
 *
 * This walks a list of routes with `goto`, and on every failure prints exactly
 * what Playwright thinks is still in flight, with how long it has been there. A
 * bare timeout names the destination and hides the cause; the open-request list
 * names the cause and makes the destination irrelevant, which is the right way
 * round for something that will be fixed once and never thought about again.
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

const inflight = new Map();
const T0 = Date.now();
const trace = process.argv.includes("--trace");
page.on("request", (r) => {
  inflight.set(r, Date.now());
  if (trace) console.log(`      +${String(Date.now() - T0).padStart(6)}ms req ${r.resourceType()} ${r.url().slice(0, 110)}`);
});
page.on("requestfinished", (r) => inflight.delete(r));
page.on("requestfailed", (r) => inflight.delete(r));

const open = () =>
  [...inflight.entries()].map(([r, t]) => `${Date.now() - t}ms ${r.resourceType()} ${r.url().slice(0, 110)}`);

if (process.argv.includes("--seed")) await seedPlayedAccount(page);
if (process.argv.includes("--battle")) {
  await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=301", { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
  console.log("parked on a live battle at the mulligan");
} else {
  await page.goto("http://localhost:5173/#lobby", { waitUntil: "load" });
}
await page.waitForTimeout(2500);

const routes = ["stats", "lobby", "stats", "collection", "stats", "lobby", "profile", "stats"];
for (const route of routes) {
  const t = Date.now();
  let verdict;
  try {
    await page.goto(`http://localhost:5173/#${route}`, { waitUntil: "networkidle", timeout: 8000 });
    verdict = `ok in ${Date.now() - t}ms`;
  } catch {
    verdict = `TIMEOUT after ${Date.now() - t}ms`;
  }
  console.log(`#${route.padEnd(11)} ${verdict}   inflight=${inflight.size}`);
  for (const line of open().slice(0, 8)) console.log(`      open: ${line}`);
}

await browser.close();
