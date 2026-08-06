/** Keyboard walk of the collection grid, and what the focus ring looks like. */
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
await page.waitForTimeout(2600);
console.log("tab stops in grid:", await page.$$eval(".card-cell", (n) => n.filter((c) => c.tabIndex === 0).length), "of", await page.$$eval(".card-cell", (n) => n.length));
await page.evaluate(() => document.querySelector(".card-cell").focus());
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(400);
console.log("focused:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.slice(0, 60)));
console.log("ring:", await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { outline: cs.outline, radius: cs.borderRadius, offset: cs.outlineOffset }; }));
await page.screenshot({ path: "scripts/screenshots/w2/collection/r5-keys.png" });
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
console.log("detail open:", await page.evaluate(() => !document.querySelector("#card-detail").hidden));
console.log("focus in overlay:", await page.evaluate(() => document.querySelector("#card-detail")?.contains(document.activeElement)));
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
console.log("listeners sane, card now:", await page.evaluate(() => document.querySelector(".cd-name")?.textContent));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
console.log("closed:", await page.evaluate(() => document.querySelector("#card-detail").hidden));
console.log("focus restored to grid:", await page.evaluate(() => document.activeElement?.classList.contains("card-cell")));
await browser.close();
