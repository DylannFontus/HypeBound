/** Liveness + nav under the in-app reduced-motion setting. */
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const outDir = "D:/Gooner Card Game/scripts/screenshots/w2/cinematics/rm";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#settings", { waitUntil: "networkidle" });
// flip the saved setting directly
await page.evaluate(() => {
  document.documentElement.dataset.reducedMotion = "true";
  for (const k of Object.keys(localStorage)) {
    if (!/settings/i.test(k)) continue; console.log(k);
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v && typeof v === "object" && "reducedMotion" in v) { v.reducedMotion = true; localStorage.setItem(k, JSON.stringify(v)); }
      else if (v && typeof v === "object" && v.settings && "reducedMotion" in v.settings) { v.settings.reducedMotion = true; localStorage.setItem(k, JSON.stringify(v)); }
    } catch {}
  }
});
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.evaluate(() => { document.documentElement.dataset.reducedMotion = "true"; });
await page.waitForTimeout(900);
const attr = await page.evaluate(() => document.documentElement.dataset.reducedMotion ?? "(unset)");
console.log(`data-reduced-motion = ${attr}`);

const session = await page.context().newCDPSession(page);
const frames = [];
let casting = false;
session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  if (casting) frames.push({ data, t: metadata.timestamp });
  await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "png", everyNthFrame: 2 });
casting = true;
await page.waitForTimeout(2600);
casting = false;
await session.send("Page.stopScreencast");

const chunkFn = async (shots) => page.evaluate(async (shots) => {
  const load = async (b64) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bm, 0, 0);
    return ctx.getImageData(0, 0, bm.width, bm.height);
  };
  const out = []; let prev = null;
  for (const s of shots) {
    const img = await load(s.data);
    if (prev) {
      let sum = 0, moving = 0, n = 0;
      const a = prev.data, b = img.data;
      for (let i = 0; i < a.length; i += 12) {
        const d = (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3;
        sum += d; if (d > 2) moving++; n++;
      }
      out.push({ t: s.t, mean: sum/n, pct: (moving/n)*100 });
    }
    prev = img;
  }
  return out;
}, shots);

const res = [];
for (let i = 0; i < frames.length; i += 20) res.push(...(await chunkFn(frames.slice(Math.max(0, i-1), i+20))));
const meanDelta = res.reduce((a,r)=>a+r.mean,0)/Math.max(1,res.length);
const meanPct = res.reduce((a,r)=>a+r.pct,0)/Math.max(1,res.length);
const still = res.filter(r=>r.mean<0.05).length;
console.log(`REDUCED lobby idle — ${res.length} pairs, mean delta ${meanDelta.toFixed(3)}/255, ${meanPct.toFixed(2)}% moving, ${still} identical pairs`);

// nav under reduced motion
await page.evaluate(() => {
  window.__anim = [];
  for (const t of ["animationstart","animationend"]) document.addEventListener(t, (e)=>window.__anim.push([t, e.animationName, Math.round(performance.now())]), true);
  window.__c0 = performance.now();
});
await page.evaluate(() => document.querySelector("#lobby-collection")?.click());
await page.waitForTimeout(2000);
const anim = await page.evaluate(() => ({ t0: window.__c0, list: window.__anim }));
console.log("nav animations under reduced motion:");
for (const [t,n,ms] of anim.list.slice(0,20)) console.log(`   ${t.padEnd(14)} ${String(n).padEnd(26)} +${Math.round(ms-anim.t0)}ms`);
await browser.close();
