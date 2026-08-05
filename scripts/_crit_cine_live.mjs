/**
 * "Is it alive?" measured as pixel motion between consecutive composited frames.
 * Reports mean |delta| and % of pixels moving >2/255, per phase.
 *
 *   node _crit_cine_live.mjs lobby            idle liveness of a route
 *   node _crit_cine_live.mjs curtain-hold     the veil while the battle builds
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const what = argv[0] ?? "lobby";
const [vw, vh] = String(argv[1] ?? "1600x900").split("x").map(Number);
const reduced = argv.includes("--reduced");

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, "http://localhost:5173");
if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });

const session = await page.context().newCDPSession(page);
const frames = [];
let casting = false;
session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  if (casting) frames.push({ data, t: metadata.timestamp });
  await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

let label = what;
if (what === "curtain-hold") {
  await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(() => { location.hash = "#lobby"; });
  await page.waitForTimeout(2500);
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  casting = true;
  await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
  await page.waitForTimeout(1400);
  casting = false;
  await session.send("Page.stopScreencast");
} else {
  await page.goto(`http://localhost:5173/?nointro#${what}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2200);
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 2 });
  casting = true;
  await page.waitForTimeout(2600);
  casting = false;
  await session.send("Page.stopScreencast");
}

const chunk = async (shots) => page.evaluate(async (shots) => {
  const load = async (b64) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bm, 0, 0);
    return ctx.getImageData(0, 0, bm.width, bm.height);
  };
  const out = [];
  let prev = null;
  for (const s of shots) {
    const img = await load(s.data);
    if (prev) {
      let sum = 0, moving = 0, n = 0, max = 0;
      const a = prev.data, b = img.data;
      for (let i = 0; i < a.length; i += 4 * 3) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        const dd = d / 3;
        sum += dd; if (dd > 2) moving++; if (dd > max) max = dd; n++;
      }
      out.push({ t: s.t, mean: sum / n, pct: (moving / n) * 100, max });
    }
    prev = img;
  }
  return out;
}, shots);

const res = [];
for (let i = 0; i < frames.length; i += 20) {
  const slice = frames.slice(Math.max(0, i - 1), i + 20);
  res.push(...(await chunk(slice)));
}

const t0 = res.length ? res[0].t : 0;
const meanDelta = res.reduce((a, r) => a + r.mean, 0) / Math.max(1, res.length);
const meanPct = res.reduce((a, r) => a + r.pct, 0) / Math.max(1, res.length);
const still = res.filter((r) => r.mean < 0.05).length;
console.log(`${label} ${vw}x${vh}${reduced ? " REDUCED" : ""} — ${frames.length} frames, ${res.length} pairs`);
console.log(`  fps ≈ ${(frames.length / ((frames.at(-1)?.t - frames[0]?.t) || 1)).toFixed(1)}`);
console.log(`  mean per-pixel delta  ${meanDelta.toFixed(3)} / 255`);
console.log(`  mean %% pixels moving  ${meanPct.toFixed(2)}%`);
console.log(`  identical pairs       ${still} of ${res.length} (${((still / Math.max(1, res.length)) * 100).toFixed(0)}%)`);
console.log(`  trace ` + res.map((r) => `${((r.t - t0) * 1000).toFixed(0)}:${r.mean.toFixed(2)}/${r.pct.toFixed(1)}`).join(" "));
await browser.close();
