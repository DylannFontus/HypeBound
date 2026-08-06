/**
 * What the cover actually does, in pixels, for as long as it is up.
 *
 * Two questions the shell's own logs cannot answer. **Is it moving?** — the
 * brief's calibration is Hearthstone's idle floor, which moves 0.6-1.3/255 per
 * 200ms and never reaches zero, against a menu veil measured at 0.002. And
 * **does it cover?** — at 844x390 the billing pushes the panels apart and the
 * bottom of the viewport shows the board through a closed curtain.
 *
 * So this films a navigation, notes every frame in which `.nav-curtain` is in
 * the document, and reports the mean frame-to-frame delta inside that window
 * plus the worst uncovered strip, measured off the panels' own rectangles
 * rather than off the pixels (a black board under a black curtain photographs
 * as covered).
 *
 *   node scripts/_w3nav_curtain.mjs lobby battle --size 844x390
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const VALUED = new Set(["--size", "--dir", "--cast"]);
const routes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  routes.push(argv[i]);
}
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const dir = flag("dir", null);
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

const from = routes[0] ?? "lobby";
const to = routes[1] ?? "battle";

await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
await page.waitForTimeout(1200);

/**
 * The curtain's geometry, sampled every frame it exists.
 *
 * `getBoundingClientRect` on three elements per frame is affordable precisely
 * because the thread it would compete with is the one that is blocked: while a
 * battle constructor holds it, this probe is not running either, and the frames
 * it does get are the frames the page had to spare.
 */
await page.evaluate(() => {
  const w = window;
  w.__veil = [];
  w.__t0 = performance.now();
  const tick = () => {
    const veil = document.querySelector(".nav-curtain");
    if (veil !== null) {
      const top = veil.querySelector(".is-top");
      const bottom = veil.querySelector(".is-bottom");
      const a = top?.getBoundingClientRect();
      const b = bottom?.getBoundingClientRect();
      const billing = veil.querySelector(".match-billing, [class*='billing'], [class*='match-']");
      w.__veil.push({
        t: Math.round(performance.now() - w.__t0),
        phase: veil.dataset.phase,
        arm: veil.dataset.arm ?? "",
        gap: a && b ? Math.round(b.top - a.bottom) : null,
        topBottom: a ? Math.round(a.bottom) : null,
        bottomTop: b ? Math.round(b.top) : null,
        height: window.innerHeight,
        billing: billing === null ? null : Number(getComputedStyle(billing).opacity),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
const [cw, ch] = String(flag("cast", "480x300")).split("x").map(Number);
await session.send("Page.startScreencast", { format: "png", maxWidth: cw, maxHeight: ch });

const clickWall = Date.now();
await page.evaluate((hash) => {
  window.__veil.length = 0;
  window.__t0 = performance.now();
  location.hash = hash;
}, `#${to}`);
await page
  .waitForFunction(() => document.querySelector(".nav-curtain") === null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(600);
await session.send("Page.stopScreencast");

const veil = await page.evaluate(() => window.__veil);
const frames = await page.evaluate(async (list) => {
  const out = [];
  let previous = null;
  for (const shot of list) {
    const image = new Image();
    image.src = `data:image/png;base64,${shot.data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const pen = canvas.getContext("2d", { willReadFrequently: true });
    pen.drawImage(image, 0, 0);
    const px = pen.getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = new Float32Array(px.length / 4);
    let sum = 0;
    for (let i = 0, p = 0; i < px.length; i += 4, p += 1) {
      lum[p] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += lum[p];
    }
    let delta = 0;
    let moved = 0;
    if (previous !== null) {
      let acc = 0;
      for (let p = 0; p < lum.length; p += 1) {
        const d = Math.abs(lum[p] - previous[p]);
        acc += d;
        if (d >= 12) moved += 1;
      }
      delta = acc / lum.length;
      moved = (100 * moved) / lum.length;
    }
    previous = lum;
    out.push({ t: shot.t, mean: sum / lum.length, delta, moved });
  }
  return out;
}, shots);

const rel = frames.map((f) => ({ ...f, t: Math.round(f.t * 1000 - clickWall) }));
const covered = veil.length === 0 ? null : [veil[0].t, veil[veil.length - 1].t];
const inVeil = covered === null ? [] : rel.filter((f) => f.t >= covered[0] + 200 && f.t <= covered[1] - 60);

/** The stillest 200ms inside the cover, which is the number the brief names. */
let stillest = Infinity;
for (let i = 0; i < inVeil.length; i += 1) {
  const w = inVeil.filter((f) => f.t >= inVeil[i].t && f.t < inVeil[i].t + 200);
  if (w.length < 3) continue;
  const m = w.reduce((a, f) => a + f.delta, 0) / w.length;
  if (m < stillest) stillest = m;
}

const worstGap = veil.reduce((a, s) => (s.gap !== null && s.gap > a ? s.gap : a), -Infinity);
/**
 * Only once the close has had time to land. The first frames of the close are
 * two panels still off-screen, and reporting those as a hole would mean every
 * curtain that ever worked failed this check.
 */
const CLOSED_AFTER = 260;
const closed = veil.filter((s) => s.phase === "close" && s.t >= (veil[0]?.t ?? 0) + CLOSED_AFTER);
const worstClosedGap = closed.reduce((a, s) => (s.gap !== null && s.gap > a ? s.gap : a), -Infinity);
const billingUp = veil.find((s) => (s.billing ?? 0) > 0.5);

console.log(
  `${from} -> ${to} at ${vw}x${vh}\n` +
    `  curtain up          ${covered === null ? "never" : `${covered[0]}ms .. ${covered[1]}ms (${covered[1] - covered[0]}ms)`}\n` +
    `  frames under it     ${inVeil.length} of ${rel.length}\n` +
    `  mean delta          ${inVeil.length === 0 ? "n/a" : (inVeil.reduce((a, f) => a + f.delta, 0) / inVeil.length).toFixed(3)}/255   ` +
    `stillest 200ms ${stillest === Infinity ? "n/a" : stillest.toFixed(3)}   (Hearthstone idle floor 0.6-1.3)\n` +
    `  pixels moving       ${inVeil.length === 0 ? "n/a" : (inVeil.reduce((a, f) => a + f.moved, 0) / inVeil.length).toFixed(2)}%\n` +
    `  mean luminance      ${inVeil.length === 0 ? "n/a" : (inVeil.reduce((a, f) => a + f.mean, 0) / inVeil.length).toFixed(1)}/255\n` +
    `  panel gap, closed   worst ${worstClosedGap === -Infinity ? "n/a" : `${worstClosedGap}px`} of ${veil[0]?.height ?? vh}px viewport   (negative = overlapping, which is what covering looks like)\n` +
    `  panel gap, any      worst ${worstGap === -Infinity ? "n/a" : `${worstGap}px`}\n` +
    `  billing visible at  ${billingUp === undefined ? "never" : `${billingUp.t}ms`}`
);

if (dir !== null) {
  mkdirSync(dir, { recursive: true });
  for (const shot of shots) {
    const t = Math.round(shot.t * 1000 - clickWall);
    if (t < -100) continue;
    writeFileSync(`${dir}/t${String(Math.max(0, t)).padStart(5, "0")}.png`, Buffer.from(shot.data, "base64"));
  }
  console.log(`  frames written to   ${dir}`);
}

await browser.close();
