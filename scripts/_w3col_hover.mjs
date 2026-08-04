/** Real pointer hover over a middle tile; reports what the two neighbours did. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 5; i++) { try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); } }
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "networkidle" });
await page.waitForSelector(".card-cell canvas");
await page.waitForTimeout(2800);
const box = await (await page.$$(".card-cell"))[3].boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
await page.waitForTimeout(420);
console.log(JSON.stringify(await page.evaluate(() => {
  const c = [...document.querySelectorAll(".card-cell")].slice(2, 6);
  return c.map((n) => { const s = getComputedStyle(n); return { t: s.transform, f: s.filter.slice(0, 44) }; });
}), null, 1));
await page.screenshot({ path: "scripts/screenshots/w2/collection/r9-hover.png", clip: { x: 300, y: 190, width: 1290, height: 300 } });
await browser.close();
