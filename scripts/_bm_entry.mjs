/**
 * Battle-motion measurement: the lobby -> battle curtain, filmed and diffed.
 *
 * A CDP screencast (compositor frames) rather than page.screenshot, because
 * page.screenshot blocks and cannot sample a main-thread stall. Consecutive
 * frames are decoded and diffed inside a second browser page (one round trip
 * for the whole film, not one per frame) so a "dead" window is a number rather
 * than an impression, and every animationstart is recorded through an init
 * script so the record survives a reload.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
import { suppressHmrReload } from "./lib/nohmr.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg("dir", "D:/Gooner Card Game/scripts/screenshots/w2/battlemotion/entry");
const SAVE = process.argv.includes("--save");
const SPAN = Number(arg("span", 4200));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__anim = [];
  window.__t0 = 0;
  document.addEventListener("animationstart", (e) => {
    const t = e.target;
    window.__anim.push({
      n: e.animationName,
      t: performance.now(),
      c: String(t && t.className && t.className.baseVal !== undefined ? t.className.baseVal : (t && t.className) || ""),
    });
  }, true);
});
await suppressHmrReload(page);
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// warm the module cache for the battle route, then come back
await page.evaluate(() => { setTimeout(() => { location.hash = "#battle"; }, 0); }).catch(() => {});
await page.waitForTimeout(3800);
await page.evaluate(() => { setTimeout(() => { location.hash = "#lobby"; }, 0); }).catch(() => {});
await page.waitForTimeout(2600);
await page.evaluate(() => { window.__anim.length = 0; }).catch(() => {});

const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ t: Date.now(), data: f.data });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

const t0 = Date.now();
await page.evaluate(() => { window.__t0 = performance.now(); setTimeout(() => { location.hash = "#battle"; }, 0); }).catch(() => {});
await page.waitForTimeout(SPAN);
await cdp.send("Page.stopScreencast");

const anim = await page.evaluate(() => ({ list: window.__anim ?? [], t0: window.__t0 ?? 0 })).catch(() => ({ list: [], t0: 0 }));

// ---- diff consecutive frames, in one round trip -----------------------------
const lab = await browser.newPage({ viewport: { width: 64, height: 64 } });
const times = frames.map((f) => f.t - t0);
const rows = [];
const CHUNK = 40;
let prev = null;
for (let i = 0; i < frames.length; i += CHUNK) {
  const slice = frames.slice(i, i + CHUNK).map((f) => f.data);
  const out = await lab.evaluate(async ({ list, carry }) => {
    const c = document.createElement("canvas");
    const x = c.getContext("2d", { willReadFrequently: true });
    const grab = async (b64) => {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + b64;
      await img.decode();
      c.width = Math.round(img.width / 4);
      c.height = Math.round(img.height / 4);
      x.drawImage(img, 0, 0, c.width, c.height);
      return Array.from(x.getImageData(0, 0, c.width, c.height).data);
    };
    const res = [];
    let last = carry;
    for (const b64 of list) {
      const cur = await grab(b64);
      if (last) {
        let sum = 0, max = 0, moved = 0, n = 0;
        for (let p = 0; p < cur.length; p += 4) {
          const d = Math.max(Math.abs(last[p] - cur[p]), Math.abs(last[p + 1] - cur[p + 1]), Math.abs(last[p + 2] - cur[p + 2]));
          sum += d; if (d > max) max = d; if (d >= 12) moved++; n++;
        }
        res.push({ mean: sum / n, max, movedPct: (moved / n) * 100 });
      } else res.push(null);
      last = cur;
    }
    return { res, carry: last };
  }, { list: slice, carry: prev });
  prev = out.carry;
  for (let k = 0; k < out.res.length; k++) if (out.res[k]) rows.push({ ms: times[i + k], dt: times[i + k] - times[i + k - 1], ...out.res[k] });
}

const lines = [];
lines.push(`frames=${frames.length} span=${times.at(-1)}ms`);
lines.push("  t(ms)   dt   mean  max  moved%");
for (const r of rows) {
  lines.push(`${String(r.ms).padStart(6)} ${String(r.dt).padStart(4)} ${r.mean.toFixed(2).padStart(6)} ${String(r.max).padStart(4)} ${r.movedPct.toFixed(2).padStart(7)}`);
}

// longest run of frames under the perceptual floor
let best = { from: 0, to: 0, len: 0 };
let runStart = null;
const dead = (r) => r.movedPct < 0.05 && r.mean < 0.6;
for (let i = 0; i <= rows.length; i++) {
  const isDead = i < rows.length && dead(rows[i]);
  if (isDead && runStart === null) runStart = i;
  if (!isDead && runStart !== null) {
    const from = rows[Math.max(0, runStart - 1)].ms;
    const to = rows[i - 1].ms;
    if (to - from > best.len) best = { from, to, len: to - from };
    runStart = null;
  }
}
lines.push(`\nLONGEST DEAD WINDOW: ${best.from}ms -> ${best.to}ms = ${best.len}ms`);

lines.push("\nanimationstart (ms after click):");
const seen = new Map();
for (const a of anim.list) {
  const rel = Math.round(a.t - anim.t0);
  if (rel < -50) continue;
  if (!seen.has(a.n)) seen.set(a.n, []);
  seen.get(a.n).push(rel);
}
for (const [name, ts] of [...seen].sort((a, b) => a[1][0] - b[1][0])) {
  lines.push(`  ${name.padEnd(26)} n=${String(ts.length).padStart(3)}  first=${ts[0]}ms  [${ts.slice(0, 14).join(",")}]`);
}

const text = lines.join("\n");
console.log(text);
writeFileSync(path.join(OUT, "timeline.txt"), text);

if (SAVE) {
  frames.forEach((f, i) => writeFileSync(path.join(OUT, `f${String(i).padStart(3, "0")}-${times[i]}ms.jpg`), Buffer.from(f.data, "base64")));
  console.log(`\nwrote ${frames.length} frames to ${OUT}`);
}

await browser.close();
