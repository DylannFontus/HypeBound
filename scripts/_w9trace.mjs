/**
 * Where a heavy entry's blocked milliseconds *actually* go, asked of Blink.
 *
 * The V8 sampling profiler answers "which JavaScript function was on the stack",
 * and on these three routes that question is a trap: it filters `(program)` out
 * as noise, and `(program)` is style, layout, paint and raster — which is where
 * the collection's steady-state cost turned out to live. `_w7leg_cost.mjs` shows
 * `fillRect 1029ms` on the deck builder and reads as "card rasterisation is the
 * problem"; the same navigation's long tasks add up to 907ms, so the JS cannot be
 * more than a fraction of it and the sampler simply has nothing to say about the
 * rest.
 *
 * So this runs the DevTools timeline trace over the navigation and adds up
 * **self** time per trace event, nested duration removed, which is the only
 * arithmetic that lets style, layout, paint and script be compared with each
 * other at all.
 *
 * ## Calibrating the instrument
 *
 * Trace events are wall-clock timestamped by Blink itself, in microseconds, on
 * the same clock `performance.now()` uses — so there is no sample interval to get
 * wrong here in the way `_w7rw_probe`'s 200ms-labelled-830ms grid was wrong.
 * What *can* be wrong is the arithmetic, so the total of every self time is
 * printed beside the long-task total measured independently by
 * `_w9heavy.mjs`. If the two disagree by more than the tracing overhead, the
 * attribution below is not describing the same navigation.
 *
 *   node scripts/_w9trace.mjs gallery
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const argv = process.argv.slice(2);
const route = argv[0] ?? "gallery";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const WINDOW_MS = Number(flag("window", 3000));
const EXTRA_CSS = flag("css", "");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
if (EXTRA_CSS) await page.addStyleTag({ content: String(EXTRA_CSS) });
await page.waitForTimeout(1400);

const session = await page.context().newCDPSession(page);
const events = [];
session.on("Tracing.dataCollected", ({ value }) => events.push(...value));
const done = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));

const TRACE_CATEGORIES = [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "blink.user_timing",
      /**
       * The reason, not just the cost.
       *
       * "Style is 44% of this navigation" is a symptom with at least four
       * different diseases behind it — too many elements, an attribute write on a
       * screen root, a relational selector, or an animation of a property that is
       * not compositable. Blink knows which, and `invalidationTracking` is where
       * it says so: every `ScheduleStyleInvalidationTracking` carries the node,
       * the reason and the class or attribute that did it.
       */
      "disabled-by-default-devtools.timeline.invalidationTracking",
];
const CLICK_PRE = process.argv.includes("--click");
if (!CLICK_PRE) {
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: TRACE_CATEGORIES },
  });
}

/**
 * Either a navigation or a click on a settled screen — `--click <selector>`.
 * A filter change is not a route change and the two want different setups, but
 * they want exactly the same attribution.
 */
const CLICK = flag("click", "");
if (CLICK) {
  await page.evaluate((hash) => { location.hash = hash; }, `#${route}`);
  await page.waitForSelector(".card-cell, .gal-tile, .pool-cell", { timeout: 20000 });
  await page.waitForTimeout(4000);
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: TRACE_CATEGORIES },
  });
  await page.evaluate((sel) => document.querySelector(sel)?.click(), String(CLICK));
} else {
  await page.evaluate((hash) => { location.hash = hash; }, `#${route}`);
}
await page.waitForTimeout(WINDOW_MS);
await session.send("Tracing.end");
await done;

/**
 * Self time, nested duration removed.
 *
 * Blink emits complete events (`ph: "X"`) with a duration and nested events on
 * the same thread inside them. Adding up `dur` therefore counts a `Layout` twice
 * once as itself and once inside the `FunctionCall` that provoked it, which is
 * how a 900ms navigation gets reported as 3,000ms of work. Sorting by start and
 * walking a stack gives each event only the time nothing deeper was on it.
 */
const main = events
  .filter((e) => e.ph === "X" && typeof e.dur === "number" && e.dur > 0)
  .filter((e) => e.cat.includes("devtools.timeline"));
const pids = new Map();
for (const e of main) pids.set(`${e.pid}:${e.tid}`, (pids.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
const busiest = [...pids.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const thread = main.filter((e) => `${e.pid}:${e.tid}` === busiest).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

const self = new Map();
const stack = [];
for (const e of thread) {
  while (stack.length > 0 && stack[stack.length - 1].end <= e.ts) stack.pop();
  const parent = stack[stack.length - 1];
  if (parent) parent.child += e.dur;
  stack.push({ end: e.ts + e.dur, child: 0, name: e.name, dur: e.dur });
  // record on pop
}
// second pass: walk again, closing frames and banking their self time
const open = [];
const bank = (frame) => self.set(frame.name, (self.get(frame.name) ?? 0) + (frame.dur - frame.child) / 1000);
for (const e of thread) {
  while (open.length > 0 && open[open.length - 1].end <= e.ts) bank(open.pop());
  const parent = open[open.length - 1];
  if (parent) parent.child += e.dur;
  open.push({ end: e.ts + e.dur, child: 0, name: e.name, dur: e.dur });
}
while (open.length > 0) bank(open.pop());

const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
const total = [...self.values()].reduce((a, b) => a + b, 0);

console.log(`\n=== ${route} @${vw}x${vh}, ${WINDOW_MS}ms after the click${EXTRA_CSS ? "  [+css]" : ""} ===`);
console.log(`  ${total.toFixed(0)}ms of traced main-thread self time\n`);
for (const [name, ms] of rows) {
  console.log(`  ${ms.toFixed(1).padStart(8)}ms  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}

/**
 * Style recalculation, itemised.
 *
 * `UpdateLayoutTree` carries `elementCount` — how many elements Blink actually
 * re-resolved — so "style is 44% of the navigation" can be turned into "style is
 * forty passes over fifteen hundred elements each", which is a different defect
 * with a different fix. A handful of large passes is a tree that is too big; a
 * great many large passes is something invalidating the whole subtree over and
 * over, which is the failure `transitions.css` §2.7 already exists to avoid.
 */
const recalcs = thread
  .filter((e) => e.name === "UpdateLayoutTree")
  .map((e) => ({ ts: e.ts, dur: e.dur / 1000, n: e.args?.elementCount ?? e.args?.beginData?.elementCount ?? 0 }));
if (recalcs.length > 0) {
  const elements = recalcs.reduce((a, r) => a + r.n, 0);
  const t0 = Math.min(...thread.map((e) => e.ts));
  console.log(
    `\n  ${recalcs.length} style recalcs over ${elements} elements ` +
      `(${(elements / Math.max(1, recalcs.length)).toFixed(0)} per pass)`
  );
  for (const r of recalcs.sort((a, b) => b.dur - a.dur).slice(0, 12)) {
    console.log(`      ${r.dur.toFixed(1).padStart(7)}ms  ${String(r.n).padStart(5)} elements  @${Math.round((r.ts - t0) / 1000)}ms`);
  }
}

/** Who keeps dirtying the tree, in Blink's own words. */
const invalidations = new Map();
for (const e of events) {
  if (!/InvalidationTracking/.test(e.name)) continue;
  const d = e.args?.data ?? {};
  const key = `${e.name.replace("Tracking", "")}  ${d.reason ?? "?"}  ${d.nodeName ?? d.invalidatedSelectorId ?? ""}${
    d.extraData ? ` [${d.extraData}]` : ""
  }`;
  invalidations.set(key, (invalidations.get(key) ?? 0) + 1);
}
if (invalidations.size > 0) {
  console.log(`\n  why the style was dirtied (${[...invalidations.values()].reduce((a, b) => a + b, 0)} records)`);
  for (const [key, n] of [...invalidations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`      ${String(n).padStart(5)}x  ${key}`);
  }
}

/** The four buckets that matter for "should this be virtualised". */
const bucket = (names) =>
  names.reduce((sum, n) => sum + (self.get(n) ?? 0), 0);
console.log(
  `\n  script  ${bucket(["FunctionCall", "TimerFire", "EventDispatch", "v8.callFunction", "RunTask", "RunMicrotasks", "v8.run"]).toFixed(0)}ms` +
    `   style ${bucket(["UpdateLayoutTree", "ScheduleStyleRecalculation", "InvalidateLayout"]).toFixed(0)}ms` +
    `   layout ${bucket(["Layout", "LayoutShift", "PrePaint"]).toFixed(0)}ms` +
    `   paint ${bucket(["Paint", "PaintImage", "UpdateLayerTree", "Commit", "CompositeLayers", "RasterTask", "Rasterize"]).toFixed(0)}ms\n`
);

await session.detach().catch(() => {});
await browser.close();
