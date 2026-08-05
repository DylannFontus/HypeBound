/**
 * What the compositor actually put on the glass during a navigation, and how
 * much of it moved.
 *
 * A rAF trace cannot answer this — rAF runs on the main thread, so it reports
 * blocking whether or not a pixel changed — and `page.screenshot` cannot either,
 * because it blocks the very thread whose stall is the question. So: a CDP
 * screencast in **lossless PNG**, decoded here rather than in the page, with
 * three numbers per consecutive pair:
 *
 *   mean   mean absolute per-pixel luminance delta, 0-255
 *   moved  percentage of pixels that changed by more than 2/255
 *   lum    mean luminance of the frame itself
 *
 * The calibration is `hearthstone_frames/`: an idle Hearthstone floor moves
 * 0.6-1.3 mean delta per 200ms and never reaches zero. JPEG cannot be used for
 * this — its own quantisation noise sits at about 0.3 mean and would flatter a
 * dead frame into looking alive, which is how a 3%-white crawl survived review.
 *
 *   node scripts/_w7leg_film.mjs lobby collection --dir <out> --hold 4000
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { decodePng, luminance } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const VALUED = new Set(["--size", "--dir", "--hold", "--every", "--keep", "--warm"]);
const routes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  routes.push(argv[i]);
}
const [vw, vh] = String(flag("size", "1280x720")).split("x").map(Number);
const dir = String(flag("dir", "scripts/screenshots/w7/legs"));
const hold = Number(flag("hold", 4000));
const every = Number(flag("every", 1));
const keep = argv.includes("--keep");
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
/**
 * A reload under a warm-up throws the shell's stopwatch away and the leg that
 * gets filmed is a first visit wearing a warm module cache — which is how the
 * same command produced a veiled reel and an unveiled one twenty minutes apart.
 * This drives a live dev server three other people are editing, so it is
 * reported loudly rather than absorbed.
 */
let reloads = 0;
page.on("load", () => {
  reloads += 1;
});
// `?nointro` before the seeder, so the first-run cinematic cannot sit on top
// of the starter picker for the whole of its timeout.
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${routes[0] ?? "lobby"}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
await page.waitForTimeout(1400);

/**
 * Walk the leg `--warm N` times before filming it, **without reloading**.
 *
 * The shell's stopwatch lives in instance fields, so "the second visit" only
 * exists inside one document — and the second visit is the one a player
 * actually makes. A film that always reloads first can only ever photograph the
 * first navigation of a session, which is exactly how a cover that appears once
 * per session gets reported as a cover that is always there.
 */
const warm = Number(flag("warm", 0));
reloads = 0;
for (let i = 0; i < warm; i += 1) {
  for (const hash of [routes[1] ?? "collection", routes[0] ?? "lobby"]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, `#${hash}`);
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0 && !document.querySelector(".nav-curtain"), null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1400);
  }
}

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
// half size: the delta statistics are unchanged by a box downsample and the
// decode is four times cheaper, which is what lets this run losslessly at all.
await session.send("Page.startScreencast", {
  format: "png",
  everyNthFrame: every,
  maxWidth: Math.round(vw / 2),
  maxHeight: Math.round(vh / 2),
});

/**
 * t=0 is taken **inside the page**, on the line that changes the hash.
 *
 * `Date.now()` on this side includes the CDP round trip that delivers the
 * evaluate, which is a few milliseconds of the instrument charged to the thing
 * being measured — and the number this film exists to produce is "how long
 * before the click is acknowledged", where a few milliseconds is a tenth of the
 * budget. `performance.timeOrigin + performance.now()` is the same wall clock
 * the screencast's own `metadata.timestamp` is on.
 */
const clickWall = await page.evaluate((hash) => {
  const stamp = performance.timeOrigin + performance.now();
  location.hash = hash;
  return stamp;
}, `#${routes[1] ?? "collection"}`);
await page.waitForTimeout(hold);
await session.send("Page.stopScreencast");
await session.detach().catch(() => {});
await browser.close();

mkdirSync(dir, { recursive: true });
const frames = [];
for (const shot of shots) {
  const t = Math.round(shot.t * 1000 - clickWall);
  if (t < -80) continue;
  const buf = Buffer.from(shot.data, "base64");
  const png = decodePng(buf);
  frames.push({ t: Math.max(0, t), lum: luminance(png), w: png.width, h: png.height, buf });
}

let mean = 0;
for (const f of frames) {
  let sum = 0;
  for (let i = 0; i < f.lum.length; i += 1) sum += f.lum[i];
  f.lumMean = sum / f.lum.length;
  // The 95th percentile is the load-bearing brightness number, per
  // `tests/never-a-blank-frame.ts`: a mean survives a screen going dark if
  // anything at all is still bright, while the p95 asks "is there a highlight
  // anywhere in this picture", which is what a blank frame does not have.
  const sorted = Float32Array.from(f.lum).sort();
  f.p95 = sorted[Math.floor(0.95 * sorted.length)];
  mean += f.lumMean;
}
/**
 * The reference is **the screen the player was looking at when they clicked**,
 * and only that.
 *
 * `never-a-blank-frame` takes the dimmer of the two ends, which is right for a
 * pass/fail guard and wrong for reading a trace: the tail of a film of the
 * Collection is a grid that is still filling in, so the destination end drifts
 * for seconds and every percentage in the table moves with it. One fixed
 * reference, taken from five frames of a settled departure screen, is the only
 * way two runs of this are comparable.
 */
const head = frames.slice(0, 5);
const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
const reference = median(head.map((f) => f.lumMean));
const referenceP95 = median(head.map((f) => f.p95));

console.log(
  `${routes[0]} -> ${routes[1]}   ${frames.length} frames over ${hold}ms at ${vw}x${vh}` +
    (reloads > 0
      ? `\n  !! THE PAGE RELOADED ${reloads} TIME(S) UNDER THIS FILM — the shell's stopwatch was reset, so\n` +
        `     this is a first visit however many warm-ups were asked for. Re-run it.`
      : "")
);
/**
 * The Hearthstone comparison has to be over the **same window**, and it was not.
 *
 * `hearthstone_frames/` is sampled 0.2 seconds apart, so its "0.6–1.3 mean delta
 * with nothing happening" is a figure per *200ms*. A screencast here runs at
 * 13–25ms, so a per-frame delta of 0.5 is not "below the floor" — compared like
 * for like it is an order of magnitude above it. Reading the two against each
 * other directly is a unit error, and it is exactly the shape of the six
 * measurement failures this project has already logged: a confident answer to a
 * narrower question than the one asked.
 *
 * So every frame is also differenced against whichever earlier frame is closest
 * to 200ms behind it. That column, and only that column, is comparable to the
 * reference. It is also the honest one for *periodic* motion, where a fast
 * oscillation can return to where it started and read as still.
 */
const at200 = (index) => {
  const want = frames[index].t - 200;
  let best = -1;
  let bestGap = Infinity;
  for (let i = index - 1; i >= 0; i -= 1) {
    const gap = Math.abs(frames[i].t - want);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
    if (frames[i].t < want - 60) break;
  }
  return bestGap <= 70 ? best : -1;
};
console.log(`     t(ms)   gap   mean-delta   d/200ms   moved%    lum   lum%   p95%   note`);
let identical = 0;
let deadWindows = [];
let deadFrom = null;
for (let i = 0; i < frames.length; i += 1) {
  const f = frames[i];
  const prev = frames[i - 1];
  let delta = 0;
  let moved = 0;
  if (prev && prev.lum.length === f.lum.length) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < f.lum.length; k += 1) {
      const d = Math.abs(f.lum[k] - prev.lum[k]);
      sum += d;
      if (d > 2) count += 1;
    }
    delta = sum / f.lum.length;
    moved = (count / f.lum.length) * 100;
  }
  if (prev && delta === 0) identical += 1;
  const gap = prev ? f.t - prev.t : 0;
  // Hearthstone's idle floor is 0.6-1.3; anything under it is a still image.
  const note = !prev ? "" : delta < 0.05 ? "DEAD" : delta < 0.6 ? "below HS idle floor" : "";
  if (note === "DEAD") {
    if (deadFrom === null) deadFrom = prev.t;
  } else if (deadFrom !== null) {
    deadWindows.push([deadFrom, prev ? prev.t : f.t]);
    deadFrom = null;
  }
  const lumPct = (100 * f.lumMean) / Math.max(1e-6, reference);
  const p95Pct = (100 * f.p95) / Math.max(1e-6, referenceP95);
  const back = at200(i);
  let wide = -1;
  if (back >= 0) {
    let sum = 0;
    const older = frames[back].lum;
    for (let k = 0; k < f.lum.length; k += 1) sum += Math.abs(f.lum[k] - older[k]);
    wide = sum / f.lum.length;
    f.wide = wide;
  }
  console.log(
    `  ${String(f.t).padStart(6)} ${String(gap).padStart(5)} ${delta.toFixed(3).padStart(12)} ${(wide < 0
      ? "-"
      : wide.toFixed(3)
    ).padStart(9)} ${moved.toFixed(2).padStart(8)} ${f.lumMean.toFixed(1).padStart(6)} ${lumPct
      .toFixed(0)
      .padStart(5)}% ${p95Pct.toFixed(0).padStart(5)}%   ${note}${lumPct < 50 || p95Pct < 50 ? "  DARK" : ""}`
  );
  if (keep) writeFileSync(`${dir}/t${String(f.t).padStart(5, "0")}.png`, f.buf);
}
if (deadFrom !== null) deadWindows.push([deadFrom, frames[frames.length - 1].t]);

const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
const wides = frames.map((f) => f.wide).filter((w) => typeof w === "number");
console.log(
  `\n  frames ${frames.length}  identical pairs ${identical}  worst compositor gap ${Math.max(0, ...gaps)}ms` +
    `  mean lum ${(mean / Math.max(1, frames.length)).toFixed(1)}` +
    (wides.length === 0
      ? ""
      : `\n  delta per 200ms — the only column comparable to hearthstone_frames' 0.6-1.3 idle floor:` +
        `  median ${wides
          .slice()
          .sort((a, b) => a - b)
          [Math.floor(wides.length / 2)].toFixed(2)}  min ${Math.min(...wides).toFixed(2)}  max ${Math.max(
          ...wides
        ).toFixed(2)}`)
);
for (const [a, b] of deadWindows) {
  if (b - a >= 60) console.log(`  DEAD WINDOW  ${a} -> ${b}  (${b - a}ms with no measurable change)`);
}
if (keep) console.log(`  frames -> ${dir}`);
