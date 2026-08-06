/** Geometry + stacking of the match curtain at a given viewport, sampled while it is up. */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const [vw, vh] = String(process.argv[2] ?? "844x390").split("x").map(Number);
const scale = process.argv[3] ?? null; // ui-scale
const outDir = "D:/Gooner Card Game/scripts/screenshots/w2/cinematics/geo";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
if (scale) await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", s), scale);
await page.waitForTimeout(1000);
// warm
await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.evaluate(() => { location.hash = "#lobby"; });
await page.waitForTimeout(2200);

await page.evaluate(() => {
  window.__geo = [];
  const snap = () => {
    const c = document.querySelector(".nav-curtain");
    if (c) {
      const g = (sel) => { const e = c.querySelector(sel) ?? document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
      window.__geo.push({
        t: Math.round(performance.now()),
        phase: c.dataset.phase,
        curtainZ: getComputedStyle(c).zIndex,
        top: g(".nav-curtain-panel.is-top"),
        bottom: g(".nav-curtain-panel.is-bottom"),
        seam: g(".nav-curtain-seam"),
        vs: g(".match-vs"),
        away: g(".match-side.is-away"),
        home: g(".match-side.is-home"),
        awayPortrait: g(".is-away .match-portrait"),
        homePortrait: g(".is-home .match-portrait"),
        awayPlate: g(".is-away .match-plate"),
        homePlate: g(".is-home .match-plate"),
        mulliganZ: (() => { const m = document.querySelector(".mulligan-overlay"); return m ? getComputedStyle(m).zIndex : null; })(),
        mulliganBox: g(".mulligan-overlay"),
      });
    }
    if (performance.now() < window.__stop) setTimeout(snap, 30);
  };
  window.__stop = performance.now() + 6000;
  snap();
});
await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
await page.waitForTimeout(4000);
const geo = await page.evaluate(() => window.__geo);
const seen = new Set();
console.log(`viewport ${vw}x${vh}${scale ? ` --ui-scale ${scale}` : ""}`);
for (const g of geo) {
  const k = JSON.stringify([g.phase, g.top, g.bottom, g.away, g.home, g.awayPortrait, g.homePortrait, g.awayPlate, g.homePlate, g.vs]);
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  t=${g.t} phase=${g.phase} z=${g.curtainZ} mulliganZ=${g.mulliganZ}`);
  for (const key of ["top", "bottom", "seam", "vs", "away", "home", "awayPortrait", "homePortrait", "awayPlate", "homePlate", "mulliganBox"]) {
    if (g[key]) console.log(`      ${key.padEnd(14)} ${JSON.stringify(g[key])}`);
  }
}
await browser.close();
