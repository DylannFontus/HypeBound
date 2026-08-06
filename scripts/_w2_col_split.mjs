/** Split a collection keystroke into handler time, forced-layout time and paint time. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
await seedPlayedAccount(page);

const t0 = Date.now();
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".card-cell", { timeout: 20000 });
console.log("first card-cell after", Date.now() - t0, "ms");
await page.waitForTimeout(1800);
console.log("cells in DOM", await page.$$eval(".card-cell", (n) => n.length));
console.log("canvases in DOM", await page.$$eval(".card-cell canvas", (n) => n.length));

for (const q of ["b", "ba", "bad", "", "z"]) {
  const r = await page.evaluate(async (value) => {
    const input = document.querySelector("#col-search");
    input.value = value;
    const a = performance.now();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const b = performance.now();
    document.body.offsetHeight; // force layout
    const c = performance.now();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const d = performance.now();
    return { handler: +(b - a).toFixed(1), layout: +(c - b).toFixed(1), paint: +(d - c).toFixed(1) };
  }, q);
  console.log(JSON.stringify(q), r);
  await page.waitForTimeout(400);
}

await browser.close();
