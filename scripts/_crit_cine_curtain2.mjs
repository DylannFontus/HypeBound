/** Curtain, measured on a WARM second entry so the dev server's module fetch is not charged. */
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const outDir = "D:/Gooner Card Game/scripts/screenshots/w2/cinematics/curtain2";
mkdirSync(outDir, { recursive: true });
const [vw, vh] = String(process.argv[2] ?? "1600x900").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
// WARM: enter a battle once and come back
await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = "#lobby"; });
await page.waitForTimeout(2500);

// DOM probe of the curtain over time
await page.evaluate(() => {
  window.__probe = [];
  window.__t0 = performance.now();
  const snap = () => {
    const c = document.querySelector(".nav-curtain");
    window.__probe.push({
      t: Math.round(performance.now() - window.__t0),
      curtain: c ? (c.dataset.phase ?? "?") : null,
      billing: c ? (c.dataset.billing ?? null) : null,
      sides: document.querySelectorAll(".match-side").length,
      portraits: document.querySelectorAll(".match-portrait").length,
      battle: document.querySelector(".battle-screen") !== null,
    });
    if (performance.now() - window.__t0 < 9000) setTimeout(snap, 40);
  };
  snap();
  window.__gaps = []; let last = performance.now();
  const tick = () => { const n = performance.now(); window.__gaps.push([Math.round(n - window.__t0), n - last]); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime - window.__t0), Math.round(e.duration)]); }).observe({ entryTypes: ["longtask"] });
});

const session = await page.context().newCDPSession(page);
const frames = [];
session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  frames.push({ data, t: metadata.timestamp });
  await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
const t0 = Date.now();
await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
await page.waitForTimeout(8000);
await session.send("Page.stopScreencast");

const stats = await page.evaluate(async (shots) => {
  const grade = async (b64) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    const W = bm.width, H = bm.height;
    const c = new OffscreenCanvas(W, H); const ctx = c.getContext("2d");
    ctx.drawImage(bm, 0, 0);
    const { data } = ctx.getImageData(0, 0, W, H);
    const all = []; let sum = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      all.push(l); sum += l;
    }
    all.sort((a, b) => a - b);
    const mean = sum / all.length; let v = 0; for (const l of all) v += (l - mean) ** 2;
    return { mean, p95: all[Math.floor(all.length * 0.95)], sd: Math.sqrt(v / all.length) };
  };
  const out = []; for (const s of shots) out.push({ t: s.t, ...(await grade(s.data)) });
  return out;
}, frames);

const rel = stats.map((s, i) => ({ i, ms: s.t * 1000 - t0, ...s }));
console.log(`WARM curtain ${vw}x${vh} — ${frames.length} frames in 8000ms (${(frames.length/8).toFixed(1)} fps)`);
// frame-emission gaps
let worstGap = 0, gapAt = 0;
for (let i = 1; i < rel.length; i++) { const g = rel[i].ms - rel[i-1].ms; if (g > worstGap) { worstGap = g; gapAt = rel[i].ms; } }
console.log(`  worst screencast gap ${worstGap.toFixed(0)}ms at ${gapAt.toFixed(0)}ms`);
console.log("  " + rel.filter(f=>f.ms<7000).map((f) => `${f.ms.toFixed(0)}:${f.mean.toFixed(1)}/${f.sd.toFixed(1)}`).join(" "));

const probe = await page.evaluate(() => window.__probe);
const changes = [];
let prev = null;
for (const p of probe) {
  const key = `${p.curtain}|${p.billing}|${p.sides}|${p.portraits}|${p.battle}`;
  if (key !== prev) { changes.push(p); prev = key; }
}
console.log("  DOM timeline:");
for (const c of changes) console.log(`    t=${c.t} curtain=${c.curtain} billing=${c.billing} sides=${c.sides} portraits=${c.portraits} battle=${c.battle}`);
const longs = await page.evaluate(() => window.__long);
console.log(`  long tasks: ${longs.map(([s,d])=>`${s}ms:${d}ms`).join(", ")}`);
const gaps = await page.evaluate(() => window.__gaps);
const over = gaps.filter(([,g]) => g > 33);
console.log(`  rAF gaps >33ms: ${over.length}/${gaps.length}  worst ${over.map(([s,g])=>`${s}ms:${g.toFixed(0)}`).sort((a,b)=>Number(b.split(":")[1])-Number(a.split(":")[1])).slice(0,8).join(", ")}`);

const step = Math.max(1, Math.round(rel.length / 26));
for (let i = 0; i < rel.length; i += step) writeFileSync(`${outDir}/w-${String(Math.round(rel[i].ms)).padStart(5,"0")}.jpg`, Buffer.from(frames[rel[i].i].data, "base64"));
if (errors.length) console.log("  errors: " + errors.slice(0,6).join(" | "));
await browser.close();
