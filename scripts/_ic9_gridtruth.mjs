/**
 * Does the idle sampler actually sample on the grid it prints — measured by the
 * subject rather than by the photographer.
 *
 * `lib/idle.mjs` was written to end instrument eleven, and it reports its own
 * achieved interval from `performance.now()` on the Node side. That is a real
 * improvement and it is still the photographer timing himself. Two things it
 * cannot see:
 *
 *   1. **Latency between the capture call and the frame that comes back.** If
 *      `Page.captureScreenshot` returns a frame composited 300ms ago, the gaps
 *      the Node clock records are 200ms apart and the *pictures* are not.
 *   2. **Whether the camera slows the subject.** Five synchronous captures a
 *      second is real pressure on the compositor. A page whose rAF rate collapses
 *      under it moves less between frames, and the sampler would report a
 *      truthful 200ms grid over a screen that is no longer running at the speed
 *      the player sees.
 *
 * Both are invisible from Node and both are trivially visible from the page. So
 * this paints the page's own clock into the top-left corner as forty-eight
 * binary swatches — twenty-four bits of milliseconds since arm, twenty-four bits
 * of rAF count — updated inside the page's own rAF. Decoding those out of the
 * captured PNGs gives the interval **the pixels are actually on**, and the rAF
 * delta across each interval gives the subject's frame rate while it is being
 * photographed. A control run with the camera idle gives the frame rate when it
 * is not.
 *
 * The swatch block is 288x24 in the corner. It does contaminate a delta figure,
 * which is why this file only ever measures time and frame counts and never
 * publishes an idle delta — the two runs are separate on purpose.
 *
 *   node scripts/_ic9_gridtruth.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { decodePng } from "./lib/png.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const CELL = 12;
const BITS = 24;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

/** Paint the page's own clock and rAF counter into the corner, in binary. */
const ARM = ({ cell, bits }) => {
  const host = document.createElement("div");
  host.id = "ic9-clock";
  host.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
    width:${bits * cell}px;height:${cell * 2}px;display:grid;
    grid-template-columns:repeat(${bits},${cell}px);grid-template-rows:${cell}px ${cell}px;`;
  const cells = [];
  for (let i = 0; i < bits * 2; i += 1) {
    const d = document.createElement("div");
    d.style.cssText = "background:#000";
    host.appendChild(d);
    cells.push(d);
  }
  document.body.appendChild(host);
  const t0 = performance.now();
  let frames = 0;
  const write = (offset, value) => {
    for (let b = 0; b < bits; b += 1) {
      const on = (value >> (bits - 1 - b)) & 1;
      const want = on ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
      const c = cells[offset + b];
      if (c.style.background !== want) c.style.background = want;
    }
  };
  const tick = () => {
    frames += 1;
    write(0, Math.round(performance.now() - t0) & 0xffffff);
    write(bits, frames & 0xffffff);
    window.__ic9raf = frames;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__ic9armed = t0;
};

/** Read the two binary rows back out of a decoded frame. */
function readClock(img) {
  const bit = (row, b) => {
    const x = b * CELL + Math.floor(CELL / 2);
    const y = row * CELL + Math.floor(CELL / 2);
    const i = (y * img.width + x) * img.channels;
    return img.data[i] > 127 ? 1 : 0;
  };
  const rd = (row) => {
    let v = 0;
    for (let b = 0; b < BITS; b += 1) v = (v << 1) | bit(row, b);
    return v >>> 0;
  };
  return { ms: rd(0), raf: rd(1) };
}

const grab = async (opts) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", ...opts });
  return Buffer.from(r.data, "base64");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function arm(route) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.evaluate(ARM, { cell: CELL, bits: BITS });
  await page.waitForTimeout(400);
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s.at(-1) };
};
const line = (label, s, unit = "ms") =>
  `${label.padEnd(34)} n=${String(s.n).padStart(3)}  min ${s.min?.toFixed(1)}  median ${s.med?.toFixed(1)}  max ${s.max?.toFixed(1)} ${unit}`;

/**
 * The loop under test: the exact scheduling `lib/idle.mjs::createIdleSampler`
 * uses — anchor on the previous capture's start, sleep the remainder.
 */
async function run(label, { lagMs, fast, count }) {
  await grab(fast ? { optimizeForSpeed: true } : {}); // discard the warm-up
  const rows = [];
  for (let k = 0; k < count; k += 1) {
    const started = performance.now();
    const buf = await grab(fast ? { optimizeForSpeed: true } : {});
    const ended = performance.now();
    rows.push({ started, ended, img: decodePng(buf) });
    if (fast) {
      const rest = started + lagMs - performance.now();
      if (rest > 0) await sleep(rest);
    } else {
      // The old shape: sleep a whole period ON TOP of the capture.
      await sleep(lagMs);
    }
  }
  const nodeGaps = [];
  const pageGaps = [];
  const rafPerGap = [];
  const latency = [];
  let prev = null;
  for (const r of rows) {
    const c = readClock(r.img);
    if (prev) {
      nodeGaps.push(r.started - prev.started);
      pageGaps.push(c.ms - prev.clock.ms);
      rafPerGap.push(c.raf - prev.clock.raf);
    }
    // how stale is the returned frame relative to the moment the call returned?
    latency.push(r.ended - r.started);
    prev = { ...r, clock: c };
  }
  const pg = stats(pageGaps);
  const ng = stats(nodeGaps);
  const fps = pageGaps.map((g, i) => (rafPerGap[i] / g) * 1000).filter((x) => Number.isFinite(x));
  console.log(`\n--- ${label} ---`);
  console.log(line("  NODE clock gap (what it prints)", ng));
  console.log(line("  PAGE clock gap (what it IS)", pg));
  console.log(line("  capture call cost", stats(latency)));
  console.log(line("  subject fps while photographed", stats(fps), "fps"));
  console.log(
    `  page-vs-node skew: median ${(pg.med - ng.med).toFixed(1)}ms  |  drift from ${lagMs}ms nominal: node ${(((ng.med - lagMs) / lagMs) * 100).toFixed(1)}%  page ${(((pg.med - lagMs) / lagMs) * 100).toFixed(1)}%`
  );
  return { pg, ng, fps: stats(fps) };
}

// ---- 1. the subject's frame rate with NO camera on it -----------------------
await arm("lobby");
const before = await page.evaluate(() => window.__ic9raf);
await page.waitForTimeout(3000);
const after = await page.evaluate(() => window.__ic9raf);
console.log(`CONTROL  #lobby unphotographed: ${(((after - before) / 3000) * 1000).toFixed(1)} fps over 3.0s`);

// ---- 2. the loop lib/idle.mjs actually uses ---------------------------------
const fast = await run("lib/idle.mjs shape — optimizeForSpeed, anchored sleep", { lagMs: 200, fast: true, count: 16 });

// ---- 3. the loop instrument eleven used -------------------------------------
await arm("lobby");
const slow = await run("instrument eleven's shape — plain capture + full sleep", {
  lagMs: 200,
  fast: false,
  count: 8,
});

// ---- 4. do the two encoders agree on pixels? --------------------------------
await page.evaluate(() => {
  document.getElementById("ic9-clock")?.remove();
  for (const el of document.getAnimations()) el.pause();
});
await page.waitForTimeout(500);
const a = decodePng(await grab({}));
const b = decodePng(await grab({ optimizeForSpeed: true }));
let diff = 0;
for (let i = 0; i < Math.min(a.data.length, b.data.length); i += 1) if (a.data[i] !== b.data[i]) diff += 1;
console.log(
  `\nENCODER CHECK on a paused page: ${a.width}x${a.height} vs ${b.width}x${b.height}, differing bytes ${diff} of ${a.data.length} — optimizeForSpeed ${diff === 0 ? "is the same pixels" : "CHANGES PIXELS"}`
);

console.log(
  `\nVERDICT  the fast loop lands ${fast.pg.med.toFixed(0)}ms apart in page time (node said ${fast.ng.med.toFixed(0)}ms); the old loop lands ${slow.pg.med.toFixed(0)}ms apart.`
);
await browser.close();
