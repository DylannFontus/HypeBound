/**
 * Measure what one keystroke in the collection search actually costs.
 *
 * Records the long tasks the main thread accumulates between one keystroke and
 * the next frame. The number the brief quotes (2,499.6ms for one character)
 * came from a render that rebuilt every canvas; this is the instrument that
 * says whether it still does.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const query = process.argv[2] ?? "bad idea committee";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
for (let attempt = 0; attempt < 4; attempt += 1) {
  try {
    await seedPlayedAccount(page);
    break;
  } catch {
    await page.waitForTimeout(800);
  }
}
const mountStart = Date.now();
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".card-cell", { timeout: 20000 });
console.log("first card-cell after", Date.now() - mountStart, "ms");
await page.waitForTimeout(2200);
console.log("cells", await page.$$eval(".card-cell", (n) => n.length),
  "canvases", await page.$$eval(".card-cell canvas", (n) => n.length));

await page.evaluate(() => {
  const w = window;
  w.__tasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) w.__tasks.push(entry.duration);
  }).observe({ entryTypes: ["longtask"] });
});

const input = await page.$("#col-search");
await input.click();

const rows = [];
for (const ch of query) {
  await page.evaluate(() => { window.__tasks.length = 0; });
  const t0 = Date.now();
  await page.keyboard.type(ch, { delay: 0 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wall = Date.now() - t0;
  const tasks = await page.evaluate(() => window.__tasks.slice());
  const blocked = tasks.reduce((a, b) => a + b, 0);
  const shown = await page.$$eval(".col-shelf:not([hidden]) .card-cell:not([hidden])", (n) => n.length);
  rows.push({ ch, wall, blocked: Math.round(blocked), worst: Math.round(Math.max(0, ...tasks)), shown });
  await page.waitForTimeout(40);
}

console.table(rows);
console.log("total wall", rows.reduce((a, r) => a + r.wall, 0), "ms");
console.log("total blocked", rows.reduce((a, r) => a + r.blocked, 0), "ms");
console.log("worst single task", Math.max(...rows.map((r) => r.worst)), "ms");

await browser.close();
