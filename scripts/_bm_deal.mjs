/**
 * Battle-motion measurement: is the board dead during the deal, and for how long?
 *
 * A CDP screencast across the mulligan confirm and the rival's first turn,
 * diffed frame to frame, with rAF gaps and long tasks recorded in the same
 * window — so "the board froze" can be told apart from "nothing happened to be
 * changing", which are two different defects with two different fixes.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
import { suppressHmrReload } from "./lib/nohmr.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg("dir", "D:/Gooner Card Game/scripts/screenshots/w2/battlemotion/deal");
const SAVE = process.argv.includes("--save");
mkdirSync(OUT, { recursive: true });
const [W, H] = String(arg("size", "1280x720")).split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(() => {
  window.__gaps = [];
  window.__long = [];
  window.__anim = [];
  document.addEventListener("animationstart", (e) => window.__anim.push({ n: e.animationName, t: performance.now() }), true);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, d: e.duration }); }).observe({ entryTypes: ["longtask"] });
  } catch {}
  let last = 0;
  const tick = (now) => { if (last) window.__gaps.push({ t: now, d: now - last }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await suppressHmrReload(page);
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#battle", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await page.waitForTimeout(1400);

const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ t: Date.now(), data: f.data });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

const t0 = Date.now();
await page.evaluate(() => {
  window.__gaps.length = 0; window.__long.length = 0; window.__anim.length = 0;
  window.__t0 = performance.now();
  document.querySelector(".mulligan-actions .btn-primary")?.click();
});
await page.waitForTimeout(Number(arg("span", 3600)));
await cdp.send("Page.stopScreencast");

const perf = await page.evaluate(() => {
  const t0 = window.__t0;
  return {
    gaps: window.__gaps.filter((g) => g.t >= t0).map((g) => ({ t: Math.round(g.t - t0), d: Math.round(g.d) })),
    long: window.__long.filter((e) => e.t >= t0).map((e) => ({ t: Math.round(e.t - t0), d: Math.round(e.d) })),
    anim: window.__anim.map((a) => ({ n: a.n, t: Math.round(a.t - t0) })),
  };
});

const lab = await browser.newPage({ viewport: { width: 64, height: 64 } });
const times = frames.map((f) => f.t - t0);
const rows = [];
let prev = null;
for (let i = 0; i < frames.length; i += 40) {
  const slice = frames.slice(i, i + 40).map((f) => f.data);
  const out = await lab.evaluate(async ({ list, carry }) => {
    const c = document.createElement("canvas");
    const x = c.getContext("2d", { willReadFrequently: true });
    const grab = async (b64) => {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + b64;
      await img.decode();
      c.width = Math.round(img.width / 4); c.height = Math.round(img.height / 4);
      x.drawImage(img, 0, 0, c.width, c.height);
      return Array.from(x.getImageData(0, 0, c.width, c.height).data);
    };
    const res = []; let last = carry;
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
  out.res.forEach((r, k) => { if (r) rows.push({ ms: times[i + k], dt: times[i + k] - times[i + k - 1], ...r }); });
}

const lines = [`frames=${frames.length} span=${times.at(-1)}ms`, "  t(ms)   dt   mean  max  moved%"];
for (const r of rows) lines.push(`${String(r.ms).padStart(6)} ${String(r.dt).padStart(4)} ${r.mean.toFixed(2).padStart(6)} ${String(r.max).padStart(4)} ${r.movedPct.toFixed(2).padStart(7)}`);

let best = { from: 0, to: 0, len: 0 }, run = null;
const dead = (r) => r.movedPct < 0.2 && r.mean < 0.4;
for (let i = 0; i <= rows.length; i++) {
  const d = i < rows.length && dead(rows[i]);
  if (d && run === null) run = i;
  if (!d && run !== null) {
    const from = rows[Math.max(0, run - 1)].ms, to = rows[i - 1].ms;
    if (to - from > best.len) best = { from, to, len: to - from };
    run = null;
  }
}
lines.push(`\nLONGEST DEAD WINDOW: ${best.from}ms -> ${best.to}ms = ${best.len}ms`);
lines.push(`frames in window: ${rows.length}; mean mad over whole run: ${(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(2)}`);
lines.push(`\nrAF gaps > 40ms: ${perf.gaps.filter((g) => g.d > 40).map((g) => `${g.t}:${g.d}`).join(", ") || "(none)"}`);
lines.push(`worst rAF gap: ${perf.gaps.reduce((a, g) => Math.max(a, g.d), 0)}ms over ${perf.gaps.length} frames`);
lines.push(`long tasks: ${perf.long.map((e) => `${e.t}:${e.d}`).join(", ") || "(none)"}`);
const hand = perf.anim.filter((a) => a.n === "hand-card-in").map((a) => a.t);
lines.push(`hand-card-in: [${hand.join(",")}]  spread=${hand.length > 1 ? Math.max(...hand) - Math.min(...hand) : 0}ms`);
const turn = perf.anim.filter((a) => a.n === "hand-card-turn").map((a) => a.t);
lines.push(`hand-card-turn: [${turn.join(",")}]`);

const text = lines.join("\n");
console.log(text);
writeFileSync(path.join(OUT, "deal.txt"), text);
if (SAVE) frames.forEach((f, i) => writeFileSync(path.join(OUT, `f${String(i).padStart(3, "0")}-${times[i]}ms.jpg`), Buffer.from(f.data, "base64")));
await browser.close();
