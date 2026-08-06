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
const routes = process.argv.slice(2);
for (const route of routes.length ? routes : ["collection", "lobby", "gallery", "lobby", "decks", "lobby", "deckbuilder"]) {
  await page.evaluate(() => {
    window.__t = [];
    if (!window.__obs) {
      window.__obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.push(Math.round(e.duration)); });
      window.__obs.observe({ entryTypes: ["longtask"] });
    }
  });
  const t0 = Date.now();
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(2500);
  const tasks = await page.evaluate(() => window.__t.slice());
  console.log(route.padEnd(12), "wall", Date.now() - t0, "| longtasks", tasks.join(",") || "none", "| worst", Math.max(0, ...tasks));
}
await browser.close();
