/**
 * What a filter change costs the collection, on a settled screen.
 *
 * The wave-8 carry-forward says "the collection also still rebuilds heavily on
 * filter changes", and that is a claim rather than a number — the last figure
 * attached to it, a 688ms long task on one Current chip, predates the FLIP, the
 * departure animation, the painter hold and the chunked cell build. So this
 * measures it on the screen as it stands, with the same calibrated grid
 * `_w9heavy.mjs` uses: one rAF ticker whose sample interval is the display's own
 * 13.3ms frame, one long-task observer installed once, and no screenshot
 * anywhere near the sample.
 *
 * Three actions, because they exercise different halves: a Current chip narrows
 * to a fifth of the grid, clearing it widens back, and a typed query is the path
 * that was once 2,499ms a keystroke.
 *
 *   node scripts/_w9filter.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const WINDOW_MS = 1200;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#collection`, { waitUntil: "networkidle" });
await page.waitForSelector(".card-cell", { timeout: 20000 });
/* Settled means settled: the chunked cell build and the lead-capped painter are
   both still running for a second or two after the screen is usable, and a
   filter measured on top of them is measuring the arrival. */
await page.waitForTimeout(4000);

await page.evaluate(() => {
  const w = window;
  w.__f = { raf: [], long: [], t0: 0, running: false };
  new PerformanceObserver((l) => {
    if (!w.__f.running) return;
    for (const e of l.getEntries()) w.__f.long.push(Math.round(e.duration));
  }).observe({ entryTypes: ["longtask"] });
  w.__fstart = (ms) => {
    w.__f.t0 = performance.now();
    w.__f.raf.length = 0;
    w.__f.long.length = 0;
    /* `collectionScreen.paint` already stamps every `renderCardToCanvas` call
       into `__cardMs`, so the share of a filter change that is rasterisation can
       be separated from the share that is reconcile, FLIP and departure — which
       is the difference between "it rebuilds heavily" and "it draws what you
       asked for". */
    w.__cards0 = (w.__cardMs ?? []).length;
    w.__ms0 = (w.__cardMs ?? []).reduce((a, b) => a + b, 0);
    w.__f.running = true;
    const tick = (now) => {
      w.__f.raf.push(now - w.__f.t0);
      if (now - w.__f.t0 < ms) requestAnimationFrame(tick);
      else w.__f.running = false;
    };
    requestAnimationFrame(tick);
  };
  w.__fread = () => {
    const raf = w.__f.raf;
    let worst = 0;
    for (let i = 1; i < raf.length; i += 1) worst = Math.max(worst, raf[i] - raf[i - 1]);
    return {
      frames: raf.length,
      worst: Math.round(worst),
      long: w.__f.long.length,
      total: w.__f.long.reduce((a, b) => a + b, 0),
      max: Math.max(0, ...w.__f.long),
      shown: document.querySelectorAll(".card-cell").length,
      cards: (w.__cardMs ?? []).length - w.__cards0,
      cardMs: Math.round((w.__cardMs ?? []).reduce((a, b) => a + b, 0) - w.__ms0),
    };
  };
});

const actions = [
  ["narrow: one Current chip", () => document.querySelectorAll(".filter-chip")[0]?.click()],
  ["widen: same chip again", () => document.querySelectorAll(".filter-chip")[0]?.click()],
  ["ownership tab: Favourites", () => document.querySelectorAll(".ownership-tab")[3]?.click()],
  ["ownership tab: All", () => document.querySelectorAll(".ownership-tab")[0]?.click()],
];

console.log(`\ncollection, settled, 1600x900 — window ${WINDOW_MS}ms on a 13.3ms grid\n`);
for (const [label, fn] of actions) {
  await page.evaluate(
    ([ms, source]) => {
      window.__fstart(ms);
      // eslint-disable-next-line no-new-func
      new Function(`return (${source})`)()();
    },
    [WINDOW_MS, fn.toString()]
  );
  await page.waitForTimeout(WINDOW_MS + 200);
  const r = await page.evaluate(() => window.__fread());
  console.log(
    `  ${label.padEnd(28)} ${String(((r.frames / WINDOW_MS) * 1000).toFixed(1)).padStart(5)}fps  ` +
      `worst gap ${String(r.worst).padStart(4)}ms   long ${String(r.long).padStart(2)}/${String(r.total).padStart(4)}ms ` +
      `worst ${String(r.max).padStart(4)}ms   cells ${String(r.shown).padStart(3)}   ` +
      `cards drawn ${String(r.cards).padStart(2)}/${String(r.cardMs).padStart(4)}ms`
  );
  await page.waitForTimeout(1200);
}

/* A typed query, one character at a time at a real typing speed. */
await page.click("#col-search");
await page.evaluate((ms) => window.__fstart(ms), 1800);
await page.type("#col-search", "shard", { delay: 120 });
await page.waitForTimeout(1400);
const typed = await page.evaluate(() => window.__fread());
console.log(
  `  ${"typing 'shard' at 8cps".padEnd(28)} ${String(((typed.frames / 1800) * 1000).toFixed(1)).padStart(5)}fps  ` +
    `worst gap ${String(typed.worst).padStart(4)}ms   long ${String(typed.long).padStart(2)}/${String(typed.total).padStart(4)}ms ` +
    `worst ${String(typed.max).padStart(4)}ms   cells ${String(typed.shown).padStart(3)}   ` +
    `cards drawn ${String(typed.cards).padStart(2)}/${String(typed.cardMs).padStart(4)}ms`
);
console.log("");

await browser.close();
