/**
 * What the collection costs the main thread.
 *
 * The round-one review measured two things and this measures the same two, in
 * the same units: the per-card draw, and the block a single keystroke in the
 * search box causes.
 *
 * ## Why the per-card figure needs a readback and the screen figure needs a
 * long-task observer
 *
 * Canvas2D in Chrome is deferred. A loop of `renderCard` calls with
 * `performance.now()` around it measures how fast JavaScript fills a command
 * buffer, and the picture is drawn later, wherever the driver feels like
 * flushing — which is why a naive version of this script reports 1.4ms at one
 * size and 16ms at the next depending on nothing at all. A one-pixel
 * `getImageData` drains the queue, so the interval around it is real work.
 *
 * The screen-level numbers do not need that trick, because a screen mount ends
 * in a paint. They come from `PerformanceObserver` on `longtask`, which is what
 * a player actually feels: total blocked time and the worst single task.
 *
 *   node scripts/measure-cardcost.mjs
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

await seedPlayedAccount(page);

// --- the screen mount --------------------------------------------------------

/**
 * A full page load of the lobby, so the mount below is the *first* one.
 *
 * A second visit is not a measurement of this domain at all: the shell keeps a
 * mounted screen, so the grid is already built and the stopwatch reads 80ms
 * whatever the renderer costs. The first mount is the one that builds 245
 * canvases, and it is the one a player pays.
 */
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

/**
 * Wall clock from the click to the grid being on screen, plus the worst single
 * task inside that window.
 *
 * Wall clock rather than a sum of long tasks, because a sum can exceed the
 * window it was measured in the moment the observer is fed from more than one
 * navigation, and a number that cannot be sanity-checked against a stopwatch is
 * not a measurement. The worst task is the one a player feels as a stutter.
 */
const mount = await page.evaluate(async () => {
  const tasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) tasks.push(entry.duration);
  });
  observer.observe({ entryTypes: ["longtask"] });

  const t0 = performance.now();
  location.hash = "#collection";
  await new Promise((resolve) => {
    const poll = () => {
      if (document.querySelectorAll(".card-cell").length >= 200) resolve();
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 1200));
  observer.disconnect();
  return { ms, worst: Math.max(0, ...tasks), n: tasks.length };
});
const cells = await page.locator(".card-cell").count();

// --- one keystroke -----------------------------------------------------------

const keystroke = await page.evaluate(() => {
  const input = document.querySelector("#col-search");
  if (!input) return null;
  const type = (value) => {
    const t = performance.now();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return performance.now() - t;
  };
  return { filter: type("a"), clear: type("") };
});

// --- the detail view, which is the one card that animates large ---------------

/**
 * Frame times with the 420px detail card open and its specular crawling.
 *
 * The micro-benchmark above reports 420px at 33ms, and it is worth not believing
 * it: sweeping nine sizes gave 400px at 1.6ms and 420px at 35ms, which is not a
 * cost curve, it is a deferred queue landing on alternate batches. The screen
 * itself cannot lie about it — if a repaint really cost 33ms, twelve of them a
 * second would put the frame time through the floor.
 */
const detail = await page.evaluate(async () => {
  document.querySelector(".card-cell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  const frames = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (frames.length >= 150) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  return {
    open: Boolean(document.querySelector(".cd-tilt")),
    median: frames[Math.floor(frames.length / 2)],
    p95: frames[Math.floor(frames.length * 0.95)],
    worst: frames[frames.length - 1],
  };
});
console.log(
  `detail view open=${detail.open}  frame time median ${detail.median.toFixed(1)} ms  ` +
    `p95 ${detail.p95.toFixed(1)} ms  worst ${detail.worst.toFixed(1)} ms`
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// --- the draw itself ---------------------------------------------------------

const perCard = await page.evaluate(async () => {
  const renderer = await import("/src/ui/cardRenderer/renderCard.ts");
  const content = await import("/src/engine/content.ts");
  const cards = Object.values(content.getContent().cards).filter((c) => !c.token);
  const out = [];

  /**
   * Largest first, and the reason is the deferred queue again.
   *
   * Running the sizes small-to-large put every earlier batch's backlog into the
   * last one's stopwatch and reported 420px at 38ms against 1.1ms for a tile —
   * a 34× gap for 6× the pixels. Draining the expensive size first leaves the
   * cheap ones measuring themselves.
   */
  for (const width of [420, 300, 168, 150, 92]) {
    const scale = width / 512;
    const dpr = Math.min(devicePixelRatio, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(512 * scale * dpr);
    canvas.height = Math.round(680 * scale * dpr);
    const ctx = canvas.getContext("2d");
    const paint = (card) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scale * dpr, scale * dpr);
      renderer.renderCard(ctx, card, { renderWidth: width });
    };

    for (let i = 0; i < 10; i++) paint(cards[i]);

    /**
     * No readback, deliberately, and this is a change of mind worth writing down.
     *
     * `getImageData` does drain the deferred queue — but on an accelerated canvas
     * it is a GPU→CPU readback that makes Chrome give up on acceleration for that
     * canvas, so every draw after the first flush is measured on the software
     * path. It turned a 1.1ms tile into a 12.5ms one and the "fix" was measuring
     * its own instrument. A long batch reaches the same honesty from the other
     * side: two hundred paints into one canvas cannot all stay queued, so the
     * wall clock over the batch is the real cost amortised, and it is directly
     * comparable to the 3.68ms/tile the round-one review recorded.
     */
    /**
     * Three batches, and the *minimum*, which is the only honest statistic here.
     *
     * The deferred queue does not vanish because the batch is long: it moves. A
     * sweep across nine sizes reported 260px at 26ms, 300px at 2.1ms, 340px at
     * 31ms and 360px at 1.8ms — alternating, because every other batch was
     * paying for the one before it. The minimum of several batches is the one
     * that drew its own work and nobody else's; a mean over the same samples is
     * a measurement of the instrument.
     */
    const n = 60;
    const batch = () => {
      const t = performance.now();
      for (let i = 0; i < n; i++) paint(cards[(i * 7) % cards.length]);
      return (performance.now() - t) / n;
    };
    const ms = Math.min(batch(), batch(), batch());

    /**
     * The same size at the *full* finish, which is what every card used to get.
     *
     * `renderWidth` is the only thing that differs, so the pair isolates exactly
     * what the tile finish buys and nothing else.
     */
    const fullBatch = () => {
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(scale * dpr, scale * dpr);
        renderer.renderCard(ctx, cards[(i * 7) % cards.length], {});
      }
      return (performance.now() - t) / n;
    };
    out.push({ width, ms, full: Math.min(fullBatch(), fullBatch(), fullBatch()) });
  }
  return out;
});

console.log(`lobby -> grid on screen  ${mount.ms.toFixed(0)} ms, worst single task ${mount.worst.toFixed(0)} ms (${mount.n} long tasks)`);
console.log(`cells on screen    ${cells}`);
console.log(`search keystroke   ${keystroke?.filter.toFixed(1)} ms blocked`);
console.log(`search cleared     ${keystroke?.clear.toFixed(1)} ms blocked`);
for (const { width, ms, full } of perCard) {
  console.log(`renderCard @ ${String(width).padStart(3)}px  ${ms.toFixed(2)} ms (tile finish)   ${full.toFixed(2)} ms (full finish)`);
}
if (errors.length) console.log("page errors:", errors.slice(0, 4));
await browser.close();
