import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { suppressHmrReload } from "./lib/nohmr.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const OUT = "D:/Gooner Card Game/scripts/screenshots/w2/battlemotion/dbg";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, d: e.duration }); }).observe({ entryTypes: ["longtask"] }); } catch {}
});
await suppressHmrReload(page);
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await page.evaluate(() => { setTimeout(() => { location.hash = "#battle"; }, 0); }).catch(() => {});
await page.waitForTimeout(4000);
await page.evaluate(() => { setTimeout(() => { location.hash = "#lobby"; }, 0); }).catch(() => {});
await page.waitForTimeout(2600);

const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => { frames.push({ t: Date.now(), data: f.data }); await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
const wall0 = Date.now();
await page.evaluate(() => { performance.clearMarks(); window.__long.length = 0; window.__t0 = performance.now(); setTimeout(() => { location.hash = "#battle"; }, 0); }).catch(() => {});
await page.waitForTimeout(3000);
await cdp.send("Page.stopScreencast");
const out = await page.evaluate(() => {
  const t0 = window.__t0;
  return {
    marks: performance.getEntriesByType("mark").map((m) => `${m.name}@${Math.round(m.startTime - t0)}`),
    long: window.__long.filter((e) => e.t >= t0).map((e) => `${Math.round(e.t - t0)}:+${Math.round(e.d)}`),
  };
});
console.log("marks:", out.marks.join("  "));
console.log("longtasks:", out.long.join("  "));
let n = 0;
for (const f of frames) {
  const ms = f.t - wall0;
  writeFileSync(`${OUT}/d${String(n).padStart(3, "0")}-${ms}ms.jpg`, Buffer.from(f.data, "base64"));
  n++;
}
console.log("frames at:", frames.map((f) => f.t - wall0).join(","));
await browser.close();
