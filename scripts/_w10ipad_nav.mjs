/**
 * What a navigation costs the main thread, per engine, per candidate.
 *
 * The owner reports half a second of freeze on every navigation on iPad Pro
 * Safari and nothing at all on a desktop Chromium. A freeze is a blocked main
 * thread, so the instrument is an rAF gap recorder — which is the *right* probe
 * for this symptom even though this project's own notes warn that rAF cannot
 * see a compositor curtain. It cannot, and it does not need to: a curtain the
 * player never sees is not what was reported.
 *
 * ## Four things this instrument does that the twelve liars did not
 *
 * 1. **The recorder is not inside a long-lived `page.evaluate`.** Instrument
 *    four in this project was an fps probe that measured the protocol round
 *    trip it was itself holding open, and reported 9–19fps on a page running at
 *    75. The loop here is started by one short evaluate, writes into a global
 *    array, and is read by a second short evaluate after the window has closed.
 *    Nothing is awaited across the measurement.
 *
 * 2. **The sample grid is validated before the first arm runs.** Instrument
 *    eleven was an 830ms grid wearing a 200ms label. Every run prints an idle
 *    baseline — one second of rAF with nothing happening — and if the engine is
 *    not delivering frames at a plausible cadence, the numbers below are not
 *    measurements of anything and the run says so.
 *
 * 3. **There is a null arm.** `noop` injects a stylesheet that matches nothing.
 *    Any difference it shows against `base` is the instrument's own noise, and
 *    no arm may be believed unless it clears that.
 *
 * 4. **Arms are interleaved, not blocked.** A browser that gets slower as it
 *    warms would otherwise hand its drift to whichever arm ran last.
 *
 * ## What it cannot do
 *
 * It cannot test Safari. Playwright's WebKit is the same engine core as Safari
 * 26 but a completely different graphics port — no Core Animation, no IOSurface,
 * and on this Windows host no GPU raster at all. Absolute numbers from the
 * `webkit` engine are meaningless. What transfers is the *ratio between arms
 * within one engine*, because that ratio is a property of how the engine's
 * rendering model treats a declaration, and that part is shared.
 *
 *   node scripts/_w10ipad_nav.mjs [--engine chromium|webkit|both] [--repeats 3]
 */

import { chromium, webkit } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const ENGINE = String(flag("engine", "both"));
const REPEATS = Number(flag("repeats", 3));
const ARM_FILTER = flag("arms", null);

/** iPad Pro 11" in landscape, at its real backing-store ratio. */
const IPAD = { width: 1194, height: 834 };

/**
 * The walk. Ordinary menu legs only — no `heavy` route, because the report is
 * "every navigation" and a veiled leg measures the veil rather than the leg.
 * One of each relation the shell can plan: descend, ascend and sibling.
 */
const WALK = [
  ["missions", "descend"],
  ["lobby", "ascend"],
  ["settings", "descend"],
  ["a11y", "descend"],
  ["fairness", "sibling"],
  ["settings", "ascend"],
  ["lobby", "ascend"],
];

/**
 * Each arm removes exactly one thing. The rule for writing one is that it must
 * be a *subtraction* expressible as an override — anything needing a keyframe
 * rewrite is not testable this way and is called out in the report instead.
 */
const ARMS = {
  base: "",
  /** The null arm. Matches nothing; measures the instrument. */
  noop: ".w10-nothing-matches-this { color: red; }",
  /**
   * The tree as it was before this pass, restored in one arm. This is the arm
   * that answers "did making it cheaper for WebKit make it worse for Blink",
   * which is the question the brief actually asks and the one a layer census
   * cannot answer.
   */
  "old tree": `
    .screen[data-nav] { will-change: transform, opacity, filter !important; }
    .atmosphere[data-travel] .atm-body { will-change: transform, filter !important; }
    .d-room-crawl { animation: room-crawl 34s ease-in-out infinite alternate !important;
      will-change: transform !important; transform: none !important; }`,
  /** The full-viewport `filter` on the outgoing screen root, both halves. */
  "no-screen-filter": `
    .screen[data-nav="descend-hold"], .screen[data-nav="descend-out"],
    .screen[data-nav="curtain-hold"], .screen[data-nav="curtain-out"] { filter: none !important; }`,
  /** The ascend entrance's animated blur — the only animated filter left. */
  "no-ascend-blur": `
    @keyframes nav-ascend-in {
      from { opacity: .3; transform: scale(var(--nav-recede-scale)) translate3d(0, calc(var(--nav-recede-lift) * -1), 0); }
      30%  { opacity: .76; transform: scale(calc(1 - (1 - var(--nav-recede-scale)) * .3)) translate3d(0, calc(var(--nav-recede-lift) * -.3), 0); }
      to   { opacity: 1; transform: scale(1) translate3d(0,0,0); }
    }`,
  /** `will-change` on the screen roots, which is written on both at once. */
  "no-screen-willchange": ".screen[data-nav] { will-change: auto !important; }",
  /** `will-change: filter` on the whole world, added and removed per leg. */
  "no-world-willchange": ".atmosphere[data-travel] .atm-body { will-change: transform !important; }",
  /** The 3D-context trigger on the screen roots. */
  "no-backface": ".screen[data-nav] { backface-visibility: visible !important; }",
  /** Both screens' seven-layer rooms. */
  "no-room": ".screen > .d-room { display: none !important; }",
  /** The plane in front of `#app`. */
  "no-fore": ".atmosphere-fore { display: none !important; }",
  /** The whole persistent world, as an upper bound on what it can be worth. */
  "no-world": ".atmosphere, .atmosphere-fore { display: none !important; }",
};

const armNames = Object.keys(ARMS).filter((a) => !ARM_FILTER || String(ARM_FILTER).split(",").includes(a));

/**
 * The recorder. Installed once per page; `start()` opens a window and `read()`
 * closes it. Deliberately tiny — everything it touches is a preallocated array
 * and a monotonic clock, so the probe cannot become the thing it measures.
 */
const RECORDER = `
window.__w10 = (function () {
  let stamps = null;
  let running = false;
  function tick() {
    if (!running) return;
    stamps.push(performance.now());
    requestAnimationFrame(tick);
  }
  return {
    start() { stamps = []; running = true; requestAnimationFrame(tick); },
    stop() { running = false; const s = stamps || []; stamps = null; return s; },
  };
})();`;

function gapsOf(stamps) {
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
  return gaps;
}

function summarise(gaps) {
  if (gaps.length === 0) return { frames: 0, max: 0, median: 0, stall: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    frames: gaps.length,
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    /** Time spent in gaps a player would read as a hitch, over the 30fps floor. */
    stall: gaps.filter((g) => g > 33).reduce((a, g) => a + (g - 33), 0),
  };
}

async function runEngine(name, type, launchOpts) {
  const browser = await type.launch({ headless: true, ...launchOpts });
  const context = await browser.newContext({ viewport: IPAD, deviceScaleFactor: 2, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(RECORDER);
  /**
   * Seeded, and `?nointro` in the **query** rather than the hash. Instrument
   * three in this project was a camera that put the title card over every
   * capture because the flag went in the wrong half of the URL and the game
   * booted happily underneath it — every wait and every selector still resolved.
   */
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "load" });
  await page.waitForTimeout(3000);

  /**
   * A warm walk before anything is measured, and it is not politeness.
   *
   * Every route in this app is a lazy import and the shell keeps a per-route
   * stopwatch that decides whether a leg gets veiled. Measuring the first arm on
   * a cold module graph hands it the whole cost of loading the game and reads it
   * back as the arm's own — a first pass at this put `base` 112ms above a null
   * arm that changes nothing, purely because `base` ran first.
   */
  for (let pass = 0; pass < 2; pass++) {
    for (const [route] of WALK) {
      await page.evaluate((r) => {
        location.hash = "#" + r;
      }, route);
      await page.waitForTimeout(700);
    }
  }
  await page.evaluate(() => {
    location.hash = "#lobby";
  });
  await page.waitForTimeout(1200);

  // --- calibration: is the clock real, and is the page delivering frames? ---
  await page.evaluate("window.__w10.start()");
  await page.waitForTimeout(1000);
  const idle = summarise(gapsOf(await page.evaluate("window.__w10.stop()")));
  const cadenceOk = idle.frames >= 20 && idle.median > 4 && idle.median < 60;

  const results = {};
  for (const arm of armNames) results[arm] = [];

  for (let repeat = 0; repeat < REPEATS; repeat++) {
    for (const arm of armNames) {
      // fresh page state per arm: back to the lobby, settled, no style left over
      await page.evaluate(() => {
        document.getElementById("w10-arm")?.remove();
        location.hash = "#lobby";
      });
      await page.waitForTimeout(900);
      if (ARMS[arm]) {
        await page.evaluate((css) => {
          const el = document.createElement("style");
          el.id = "w10-arm";
          el.textContent = css;
          document.head.appendChild(el);
        }, ARMS[arm]);
        await page.waitForTimeout(250);
      }

      for (const [route, relation] of WALK) {
        await page.evaluate("window.__w10.start()");
        await page.evaluate((r) => {
          location.hash = "#" + r;
        }, route);
        await page.waitForTimeout(1400);
        const s = summarise(gapsOf(await page.evaluate("window.__w10.stop()")));
        results[arm].push({ route, relation, ...s });
      }
    }
  }

  await browser.close();
  return { engine: name, idle, cadenceOk, results };
}

function report(run) {
  console.log(`\n=== ${run.engine} ===`);
  console.log(
    `calibration: idle ${run.idle.frames} frames in 1000ms, median gap ${run.idle.median.toFixed(1)}ms, ` +
      `max ${run.idle.max.toFixed(1)}ms  -> ${run.cadenceOk ? "GRID OK" : "GRID SUSPECT, numbers below mean nothing"}`
  );
  const rows = [];
  for (const [arm, legs] of Object.entries(run.results)) {
    const maxes = legs.map((l) => l.max).sort((a, b) => a - b);
    const stalls = legs.map((l) => l.stall);
    rows.push({
      arm,
      legs: legs.length,
      medianMax: maxes[Math.floor(maxes.length / 2)],
      p90Max: maxes[Math.floor(maxes.length * 0.9)],
      worst: maxes[maxes.length - 1],
      meanStall: stalls.reduce((a, b) => a + b, 0) / stalls.length,
    });
  }
  const base = rows.find((r) => r.arm === "base");
  console.log(
    "arm".padEnd(22) +
      "n".padStart(4) +
      "medMaxGap".padStart(11) +
      "p90".padStart(9) +
      "worst".padStart(9) +
      "meanStall".padStart(11) +
      "  vs base"
  );
  for (const r of rows) {
    const delta = base ? r.meanStall - base.meanStall : 0;
    console.log(
      r.arm.padEnd(22) +
        String(r.legs).padStart(4) +
        r.medianMax.toFixed(1).padStart(11) +
        r.p90Max.toFixed(1).padStart(9) +
        r.worst.toFixed(1).padStart(9) +
        r.meanStall.toFixed(1).padStart(11) +
        `  ${delta > 0 ? "+" : ""}${delta.toFixed(1)}ms`
    );
  }
  // per-relation breakdown for base, because a report of "every navigation"
  // should say whether every relation really is equally bad
  const byRelation = {};
  for (const leg of run.results["base"] ?? []) {
    (byRelation[leg.relation] ??= []).push(leg.max);
  }
  console.log("base, by relation:");
  for (const [rel, ms] of Object.entries(byRelation)) {
    const s = [...ms].sort((a, b) => a - b);
    console.log(`  ${rel.padEnd(10)} n=${s.length}  median max gap ${s[Math.floor(s.length / 2)].toFixed(1)}ms`);
  }
}

const runs = [];
if (ENGINE === "chromium" || ENGINE === "both") {
  runs.push(await runEngine("chromium", chromium, CHROME ? { executablePath: CHROME } : {}));
}
if (ENGINE === "webkit" || ENGINE === "both") {
  runs.push(await runEngine("webkit", webkit, {}));
}
for (const r of runs) report(r);
