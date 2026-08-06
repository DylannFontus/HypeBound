/**
 * What entering a heavy screen costs, on a grid that has been calibrated against
 * a stall of known length.
 *
 * ## Why another one of these
 *
 * Eleven instruments have lied in this project and the eleventh — `_w7rw_probe`'s
 * idle sampler — lied about its *sample interval* rather than its arithmetic: it
 * asked for 200ms between samples and got ~830ms, because the screenshot it took
 * first cost ~620ms of wall clock that nobody had budgeted. Calibrating a metric
 * is not calibrating a grid, so this file calibrates the grid, and says how.
 *
 * Three properties, all checkable, all printed by `--calibrate`:
 *
 * 1. **The sample interval is the display's own frame.** The clock is the
 *    `DOMHighResTimeStamp` the browser hands `requestAnimationFrame`, which is
 *    the vsync the compositor actually hit. On the review machine that is 75Hz,
 *    so the grid is 13.3ms. There is no `waitForTimeout` and no `screenshot()`
 *    anywhere inside a sample; the only thing that happens between two samples is
 *    the page.
 * 2. **The probe costs one array store per frame.** The callback writes one
 *    `Float64Array` slot and compares two numbers. Nothing is read from the DOM,
 *    no rect is measured, no style is computed — the mistake `_w7leg_walk.mjs`
 *    makes on purpose behind `--probe` and pays 40ms a navigation for.
 * 3. **A stall of known length is reported at its known length.** `--calibrate`
 *    blocks the main thread for exactly 120ms at a known offset in an otherwise
 *    idle sample and then asserts the probe found it: one rAF gap of ~120ms, one
 *    long task of ~120ms, and about nine frames missing from a 1.6s window. An
 *    instrument that cannot see a stall it caused itself cannot be trusted about
 *    one it did not.
 *
 * The long-task observer is registered **once per document** and its buffer is
 * cleared per leg, because instrument seven in this project lied by addition:
 * a fresh observer per iteration without disconnecting the last printed every
 * task twice on the second reading and three times on the third.
 *
 * ## What it will not do
 *
 * It never runs the V8 sampling profiler during a frame-rate sample.
 * `_w7leg_cost.mjs` — which is where the 11.5/20.0/28.8fps figures came from —
 * holds `Profiler.start()` at a 200µs interval across the whole navigation, and
 * a sampler that interrupts the main thread five thousand times a second is not
 * free. `--profiler` reruns the identical sample with it on, so the two numbers
 * can be put side by side rather than argued about.
 *
 * ## Usage
 *
 *   node scripts/_w9heavy.mjs --calibrate
 *   node scripts/_w9heavy.mjs --enter gallery,deckbuilder,collection --repeat 3
 *   node scripts/_w9heavy.mjs --walk lobby,collection,lobby,gallery,lobby
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
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
const has = (name) => argv.includes(`--${name}`);

const ORIGIN = "http://localhost:5173";
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const WINDOW_MS = Number(flag("window", 1600));
const SETTLE_MS = Number(flag("settle", 2600));
const repeat = Number(flag("repeat", 2));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });

/**
 * A live Vite dev server with three other people editing it pushes a full reload
 * down the HMR socket on every save, and a reload in the middle of a walk does
 * not shorten it — it silently restarts the shell's own stopwatch half way
 * through and produces a *wrong* number rather than a missing one.
 */
let reloaded = false;
page.on("load", () => {
  reloaded = true;
});

const PROBE = () => {
  const w = window;
  if (w.__w9) return;
  /** 4096 slots is 54 seconds of 75Hz; a sample is 1.6–3. */
  const state = {
    t0: 0,
    raf: new Float64Array(4096),
    n: 0,
    long: [],
    running: false,
    marks: {},
    dom: null,
  };
  w.__w9 = state;
  state.obs = new PerformanceObserver((list) => {
    if (!state.running) return;
    for (const entry of list.getEntries()) {
      state.long.push([Math.round(entry.startTime - state.t0), Math.round(entry.duration)]);
    }
  });
  state.obs.observe({ entryTypes: ["longtask"] });

  /**
   * Start a sample. Returns synchronously — the caller waits on the *node* side
   * with a CDP timer, which does not touch the page, rather than awaiting a
   * promise inside a long-lived `page.evaluate`. Instrument four in this project
   * reported 9–19fps for a page running at 75 by doing the latter.
   */
  w.__w9start = (ms, watchDom, mark0) => {
    state.t0 = performance.now();
    state.mark0 = mark0 ?? 1600;
    state.n = 0;
    state.long.length = 0;
    state.marks = {};
    state.running = true;

    if (watchDom) {
      const at = () => Math.round(performance.now() - state.t0);
      const mark = (k) => {
        if (state.marks[k] === undefined) state.marks[k] = at();
      };
      const app = document.getElementById("app");
      const before = new Set(document.querySelectorAll("#app > .screen"));
      state.dom = new MutationObserver(() => {
        if (document.querySelector(".nav-curtain")) mark("veilUp");
        else if (state.marks.veilUp !== undefined) mark("veilGone");
        for (const el of document.querySelectorAll("#app > .screen")) {
          if (before.has(el)) continue;
          mark("placed");
          if (el.dataset.nav === "settled") mark("settled");
        }
      });
      if (app) state.dom.observe(app, { childList: true, subtree: true, attributes: true });
    }

    /**
     * How many card bitmaps existed at the window boundary.
     *
     * One `querySelectorAll` on one frame out of a hundred and twenty, so it
     * cannot move the number it is reported beside — and it is the difference
     * between "the frame rate improved" and "the work moved to just after the
     * window", which is the shape of lie an fps figure alone cannot rule out.
     */
    state.drawnAt = -1;
    const tick = (now) => {
      if (state.n < state.raf.length) state.raf[state.n++] = now - state.t0;
      if (state.drawnAt < 0 && now - state.t0 >= state.mark0) {
        state.drawnAt = document.querySelectorAll("#app > .screen canvas").length;
      }
      if (now - state.t0 < ms) requestAnimationFrame(tick);
      else {
        state.running = false;
        state.drawnEnd = document.querySelectorAll("#app > .screen canvas").length;
        state.dom?.disconnect();
        state.dom = null;
      }
    };
    requestAnimationFrame(tick);
  };

  /** Block the main thread for exactly `ms`, to give the probe a known answer. */
  w.__w9stall = (delay, ms) => {
    setTimeout(() => {
      const until = performance.now() + ms;
      while (performance.now() < until) {
        /* deliberately spinning */
      }
    }, delay);
  };

  w.__w9read = (windowMs) => {
    const raf = Array.from(state.raf.subarray(0, state.n));
    const gaps = [];
    for (let i = 1; i < raf.length; i += 1) gaps.push(raf[i] - raf[i - 1]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0);
    const inWindow = raf.filter((t) => t <= windowMs).length;
    return {
      frames: inWindow,
      fps: Number(((inWindow / windowMs) * 1000).toFixed(1)),
      gapMedian: Number(at(0.5).toFixed(1)),
      gapP95: Number(at(0.95).toFixed(1)),
      gapWorst: Number(Math.max(0, ...gaps).toFixed(1)),
      long: state.long.slice(),
      longTotal: state.long.reduce((a, b) => a + b[1], 0),
      longWorst: Math.max(0, ...state.long.map((l) => l[1])),
      marks: { ...state.marks },
      nodes: document.querySelector("#app > .screen")?.getElementsByTagName("*").length ?? 0,
      drawnAt: state.drawnAt,
      drawnEnd: state.drawnEnd ?? -1,
      /** Every gap over one and a half frames at 75Hz, so a stall is nameable. */
      stalls: gaps.map((g, i) => [Math.round(raf[i]), Math.round(g)]).filter(([, g]) => g >= 20),
    };
  };
};

const settled = (id, timeout = 40000) =>
  page
    .waitForFunction(
      (name) => {
        const s = document.querySelectorAll(".screen");
        return s.length === 1 && s[0] && s[0].dataset.nav === "settled" && s[0].classList.contains(name);
      },
      `${id}-screen`,
      { timeout }
    )
    .then(
      () => true,
      () => false
    );

/**
 * A stylesheet injected before the navigation, so a hypothesis can be measured
 * before it is written into a source file. `--css "<rules>"` is how
 * `content-visibility` was tested against the live grid rather than argued about.
 */
const EXTRA_CSS = flag("css", "");

const boot = async (start = "lobby") => {
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#${start}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
  if (EXTRA_CSS) await page.addStyleTag({ content: String(EXTRA_CSS) });
  await page.waitForTimeout(1400);
  await page.evaluate(PROBE);
  reloaded = false;
};

const line = (label, r) =>
  `  ${label.padEnd(28)} ${String(r.fps).padStart(5)}fps  ${String(r.frames).padStart(3)}f/${WINDOW_MS}ms   ` +
  `long ${String(r.long.length).padStart(2)}/${String(r.longTotal).padStart(5)}ms worst ${String(r.longWorst).padStart(4)}  ` +
  `gap med ${String(r.gapMedian).padStart(5)} p95 ${String(r.gapP95).padStart(6)} worst ${String(r.gapWorst).padStart(6)}  ` +
  `veil ${String(r.marks.veilUp ?? "-").padStart(4)}->${String(r.marks.veilGone ?? "-").padStart(5)}  ` +
  `settled ${String(r.marks.settled ?? -1).padStart(5)}  nodes ${String(r.nodes).padStart(4)}  ` +
  `canvas ${String(r.drawnAt).padStart(3)}@${WINDOW_MS} ${String(r.drawnEnd).padStart(3)}@end`;

// ---------------------------------------------------------------------------
// calibration
// ---------------------------------------------------------------------------

if (has("calibrate")) {
  await boot("lobby");
  console.log(`\n=== CALIBRATION at ${vw}x${vh}, window ${WINDOW_MS}ms ===\n`);

  await page.evaluate((ms) => window.__w9start(ms, false), WINDOW_MS);
  await page.waitForTimeout(WINDOW_MS + 250);
  const idle = await page.evaluate((w) => window.__w9read(w), WINDOW_MS);
  console.log(line("idle lobby, no injection", idle));
  console.log(
    `      grid: median ${idle.gapMedian}ms between samples  ->  ${(1000 / Math.max(0.01, idle.gapMedian)).toFixed(1)}Hz refresh\n`
  );

  await page.evaluate(
    ([ms]) => {
      window.__w9start(ms, false);
      window.__w9stall(400, 120);
    },
    [WINDOW_MS]
  );
  await page.waitForTimeout(WINDOW_MS + 250);
  const stalled = await page.evaluate((w) => window.__w9read(w), WINDOW_MS);
  console.log(line("idle lobby + 120ms stall@400", stalled));
  console.log(`      stalls seen: ${stalled.stalls.map(([t, g]) => `${g}ms@${t}`).join("  ") || "NONE"}`);
  console.log(`      long tasks:  ${stalled.long.map(([t, d]) => `${d}ms@${t}`).join("  ") || "NONE"}`);

  const found = stalled.stalls.find(([, g]) => g >= 100 && g <= 190);
  const task = stalled.long.find(([, d]) => d >= 100 && d <= 190);
  const lost = idle.frames - stalled.frames;
  console.log(
    `\n      VERDICT  gap ${found ? `OK (${found[1]}ms)` : "FAIL — the 120ms stall is invisible"}` +
      `   longtask ${task ? `OK (${task[1]}ms)` : "FAIL"}` +
      `   frames lost ${lost} (expect ~${Math.round(120 / Math.max(1, idle.gapMedian))})`
  );

  if (has("profiler")) {
    const session = await page.context().newCDPSession(page);
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 200 });
    await session.send("Profiler.start");
    await page.evaluate((ms) => window.__w9start(ms, false), WINDOW_MS);
    await page.waitForTimeout(WINDOW_MS + 250);
    const withProf = await page.evaluate((w) => window.__w9read(w), WINDOW_MS);
    await session.send("Profiler.stop");
    await session.detach().catch(() => {});
    console.log(line("idle lobby, V8 sampler @200us", withProf));
    console.log(
      `      the sampler costs ${(idle.fps - withProf.fps).toFixed(1)}fps on an idle page ` +
        `(${idle.fps} -> ${withProf.fps})`
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// entering a route, from the lobby, in one document
// ---------------------------------------------------------------------------

/**
 * A route nobody is editing, measured in the same batch as the ones that are.
 *
 * Four builders are on this machine at once and every one of them is driving a
 * headless Chrome. A frame rate measured at ten past the hour and compared with
 * one measured at half past is comparing two machine loads as much as two builds,
 * and that is a very easy way to publish a result that is really somebody else's
 * agent finishing. `#missions` is a menu route with a list and no card canvases
 * on it, untouched by this work; if its number moves between two batches then the
 * batches are not comparable and the ones next to it should not be read.
 */
const enterList = String(flag("enter", "")).split(",").filter(Boolean);
if (enterList.length > 0) {
  console.log(`\n=== ENTER  ${vw}x${vh}  window ${WINDOW_MS}ms  settle ${SETTLE_MS}ms ===\n`);
  for (let visit = 0; visit < repeat; visit += 1) {
    for (const route of enterList) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await boot("lobby");
        try {
          await page.evaluate(
            ([hash, ms, WINDOW]) => {
              window.__w9start(ms, true, WINDOW);
              location.hash = hash;
            },
            [`#${route}`, SETTLE_MS, WINDOW_MS]
          );
          await page.waitForTimeout(SETTLE_MS + 250);
          const out = await page.evaluate((w) => window.__w9read(w), WINDOW_MS);
          if (reloaded) throw new Error("reload");
          console.log(line(`lobby -> ${route}  #${visit}`, out));
          if (has("stalls")) {
            console.log(`      ${out.stalls.map(([t, g]) => `${g}@${t}`).join("  ")}`);
          }
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          console.error(`      (the page reloaded under the sample — retrying)`);
        }
      }
    }
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// a walk: several legs in one document, which is the visit a player makes
// ---------------------------------------------------------------------------

const walk = String(flag("walk", "")).split(",").filter(Boolean);
if (walk.length > 1) {
  console.log(`\n=== WALK  ${vw}x${vh}  window ${WINDOW_MS}ms  settle ${SETTLE_MS}ms ===\n`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rows = [];
    await boot(walk[0]);
    let broke = false;
    for (let step = 1; step < walk.length; step += 1) {
      const from = walk[step - 1];
      const to = walk[step];
      try {
        await page.evaluate(
          ([hash, ms, WINDOW]) => {
            window.__w9start(ms, true, WINDOW);
            location.hash = hash;
          },
          [`#${to}`, SETTLE_MS, WINDOW_MS]
        );
        await page.waitForTimeout(SETTLE_MS + 250);
        const out = await page.evaluate((w) => window.__w9read(w), WINDOW_MS);
        if (reloaded) throw new Error("reload");
        rows.push(line(`${from} -> ${to}`, out));
      } catch {
        broke = true;
        break;
      }
    }
    if (!broke) {
      for (const row of rows) console.log(row);
      break;
    }
    console.error(`  (the page reloaded under the walk — restarting, attempt ${attempt + 2})`);
  }
  console.log("");
}

await browser.close();
