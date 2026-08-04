/** How long the collection screen's constructor actually takes, per the shell's own stopwatch. */
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
for (let i = 0; i < 4; i++) {
  try { await seedPlayedAccount(page); break; } catch { await page.waitForTimeout(700); }
}
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

for (const route of ["collection", "lobby", "collection", "lobby", "deckbuilder", "lobby", "gallery", "lobby", "decks"]) {
  const ms = await page.evaluate(async (r) => {
    const t = performance.now();
    location.hash = `#${r}`;
    await new Promise((res) => setTimeout(res, 2000));
    return Math.round(performance.now() - t);
  }, route);
  const painted = await page.evaluate(() => document.querySelectorAll("canvas").length);
  console.log(`${route.padEnd(12)} settle ${ms}ms  canvases ${painted}`);
}
await browser.close();
