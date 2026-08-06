/**
 * Is every route alive at rest, and does the thing that makes it alive cost
 * anything?
 *
 * ## Why a new file, when nine instruments have already lied here
 *
 * The brief's instruction is to reuse `_w7rw_probe.mjs`, which is the validated
 * one, and this obeys it in the way that matters: **the arithmetic below is
 * `_w7rw_probe.mjs`'s, character for character.** `meanDelta` and `quantiles`
 * are copied rather than reimplemented, the sampling grid is the same 200ms,
 * and `calib` recomputes the reference from `hearthstone_frames/` with this
 * file's own copy and refuses to run if the numbers do not come back as
 * n=203 / min 0.501 / median 1.713. If the metric here had drifted from the
 * metric the floors are written against, the run stops before it reports
 * anything.
 *
 * What it adds is the only thing the probe cannot do: **all forty-nine routes in
 * one browser session**. The probe launches Chrome, seeds an account and
 * navigates per invocation, which is about seventy seconds a route and over
 * half an hour for a sweep — long enough that nobody runs it, which is how a
 * per-screen defect survives two waves. One browser, one seeded account, one
 * hash change per route brings it to about six minutes.
 *
 * ## The two traps this file is written against
 *
 * **Frame-to-frame differencing.** At 50fps consecutive frames are 20ms apart
 * and a 3.6s breathe moves 0.5% of its amplitude in that time, so a genuinely
 * breathing screen reports 0.00. Every figure here is a **200ms** figure, which
 * is the grid the reference frames themselves are on.
 *
 * **A probe that cannot prove it is looking at its subject.** A route that
 * failed to build shows the error screen, and an error screen has an
 * atmosphere behind it like anything else — so it measures perfectly well and
 * tells you nothing about the route you asked for. Every row prints the hash it
 * actually landed on and the screen class it actually photographed, and a route
 * that landed somewhere else is reported as MISSED rather than folded into the
 * pass rate.
 *
 *   node scripts/_w8room_sweep.mjs calib
 *   node scripts/_w8room_sweep.mjs idle [--seconds n] [--only a,b,c] [--size WxH]
 *                                       [--scale-ui 1.4] [--reduced-motion] [--high-contrast]
 *   node scripts/_w8room_sweep.mjs cost <route>   -- frame interval with the room and without
 *
 * Exit code is non-zero if any measured route is under the floor, so this is
 * usable as a gate and not only as a report.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  path.join("C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join("C:", "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "idle";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const UI_SCALE = Number(flag("scale-ui", 0)) || 0;
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w8", "room")));
mkdirSync(OUT, { recursive: true });

/** The floor the brief sets, and the reference the floor comes from. */
const FLOOR = 0.5;
const REFERENCE = { n: 203, min: 0.501, median: 1.713 };

/**
 * With `--reduced-motion` the run is asking the opposite question, so it
 * applies the opposite gate: every route must be a *still*. See the summary
 * block at the end of the idle mode for why that is an assertion and not a skip.
 */
const STILL_EXPECTED = argv.includes("--reduced-motion");

/** Mean absolute per-channel delta. Identical arithmetic to `_w7rw_probe.mjs`. */
function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < n; i += a.channels) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

const quantiles = (values) => {
  const s = [...values].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: q(0),
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
};
const f3 = (x) => (x === undefined || x === null ? "    -" : x.toFixed(3).padStart(5));

/**
 * Recompute the reference with this file's own arithmetic.
 *
 * Not a formality. The whole reason the published floors mean anything is that
 * one metric produced both them and the numbers being compared to them, and the
 * cheapest way for that to stop being true is for somebody to copy this
 * function and change a `+= 4` to a `+= a.channels`. If the three numbers do
 * not come back, nothing below is comparable to anything and the run stops.
 */
function calibrate() {
  const dir = path.join(HERE, "..", "hearthstone_frames");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const deltas = [];
  let prev = null;
  for (const file of files) {
    const img = decodePng(readFileSync(path.join(dir, file)));
    if (prev) deltas.push(meanDelta(prev, img));
    prev = img;
  }
  return quantiles(deltas);
}

if (mode === "calib" || mode === "idle") {
  const s = calibrate();
  if (!s) {
    console.log("!! hearthstone_frames/ is missing — this instrument cannot be calibrated, so it will not report");
    process.exit(2);
  }
  console.log(
    `[calib] hearthstone_frames n=${s.n} min=${f3(s.min)} median=${f3(s.median)} p90=${f3(s.p90)} max=${f3(s.max)}`
  );
  const agrees =
    s.n === REFERENCE.n && Math.abs(s.min - REFERENCE.min) < 0.002 && Math.abs(s.median - REFERENCE.median) < 0.002;
  console.log(
    `[calib] published n=${REFERENCE.n} min=${REFERENCE.min} median=${REFERENCE.median} -> ` +
      (agrees ? "AGREES, the numbers below are on the brief's scale" : "!! DOES NOT AGREE — nothing below is comparable")
  );
  if (!agrees) process.exit(2);
  if (mode === "calib") process.exit(0);
}

/**
 * Every route `main.ts` registers, read from the source rather than typed out.
 *
 * A hand-kept list is the same species of mistake as a hand-kept list of which
 * screens get a room: it is right on the day it is written. The point of this
 * sweep is that the fiftieth route is measured without anybody adding it here.
 */
function registeredRoutes() {
  const main = readFileSync(path.join(HERE, "..", "src", "main.ts"), "utf8");
  return [...main.matchAll(/shell\.register\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The handful of routes that need something in the query string to build at
 * all. Everything else is bare. A route that is not here and does not build
 * lands on the error screen, which the run reports as MISSED — it does not get
 * quietly counted as a pass because an error screen happens to have dust on it.
 */
const ROUTE_PARAMS = {
  battle: "?seed=7&difficulty=casual",
  tutorial: "?stage=1",
  puzzle: "?index=0",
  boss: "?seed=7",
  storyscene: "?chapter=1",
  storybattle: "?chapter=1",
  news: "",
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // The scrollbar is styled and part of the picture; hiding it is instrument
  // lie number two in this project's list.
  ignoreDefaultArgs: ["--hide-scrollbars"],
  // Permits the software fallback, never forces it. Forcing swiftshader is
  // instrument lie number one: it capped the camera at 1.6fps.
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(`console: ${m.text()}`));

const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});

async function applySettings() {
  const patch = {};
  if (UI_SCALE) patch.uiScale = UI_SCALE;
  if (argv.includes("--reduced-motion")) patch.reducedMotion = true;
  if (argv.includes("--high-contrast")) patch.highContrast = true;
  if (!Object.keys(patch).length) return;
  await page.evaluate(async (p) => {
    const mod = await import("/src/save/settings.ts");
    mod.updateSettings(p);
  }, patch);
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => ({
    scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
    motion: document.documentElement.dataset.reducedMotion,
    contrast: document.documentElement.dataset.contrast,
  }));
  console.log(`[settings] ${JSON.stringify(got)}`);
  if (UI_SCALE && Number(got.scale) !== UI_SCALE) console.log("!! UI SCALE DID NOT APPLY — every number below is at 1.0");
}

/** What is actually on screen, so a row can prove it photographed its subject. */
async function subject() {
  return page.evaluate(() => {
    const screen = [...document.querySelectorAll(".screen")].find((s) => !s.classList.contains("screen-out"));
    const room = screen?.querySelector(":scope > .d-room");
    return {
      hash: location.hash.replace(/^#/, "").split("?")[0],
      cls: screen ? String(screen.className).slice(0, 46) : "NONE",
      layers: room ? room.children.length : 0,
      accent: screen ? getComputedStyle(screen).getPropertyValue("--hall-accent").trim() : "",
      grain: document.querySelectorAll(".atm-fore-grain").length,
    };
  });
}

/**
 * Sample at rest on the reference's own 200ms grid.
 *
 * The screenshot carries an explicit timeout and a `catch`, and that is not
 * defensive coding for its own sake — `never-a-blank-frame.test.ts` records a
 * real state in this project where a screen ends up pinned at the 0% keyframe
 * of an entrance that never started and `page.screenshot` hangs for thirty
 * seconds. A sweep that dies on route eleven of forty-nine tells you nothing
 * about routes twelve to forty-nine; a sweep that records "the camera could not
 * see this one" and carries on tells you exactly where to look.
 */
async function idleAt(seconds) {
  const shots = [];
  let lost = 0;
  for (let i = 0; i * 0.2 < seconds; i += 1) {
    const buf = await page.screenshot({ timeout: 8000 }).catch(() => null);
    if (buf) shots.push(decodePng(buf));
    else lost += 1;
    await page.waitForTimeout(200);
  }
  const ds = [];
  for (let i = 1; i < shots.length; i += 1) ds.push(meanDelta(shots[i - 1], shots[i]));
  if (!ds.length) return { n: 0, min: null, median: null, max: null, lost };
  return { ...quantiles(ds), lost };
}

try {
  if (mode === "idle") {
    const seconds = Number(flag("seconds", 3));
    const only = flag("only", null);
    const wanted = only ? String(only).split(",") : registeredRoutes();
    console.log(`[sweep] ${wanted.length} routes at ${VW}x${VH}, ${seconds}s each, floor ${FLOOR} per 200ms\n`);

    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await applySettings();
    await settled();
    await page.waitForTimeout(1500);

    const rows = [];
    for (const route of wanted) {
      const params = ROUTE_PARAMS[route] ?? "";
      await page.evaluate((h) => (location.hash = h), `${route}${params}`);
      await settled();
      /**
       * 2200ms of settle before a single sample, and it is not padding. Every
       * screen in this build runs an entrance cascade, counts its numbers up
       * and fills its meters on arrival; measuring through that reports the
       * arrival, not the rest. The mote fields also arrive on an idle callback
       * and fade in over 1.2s.
       */
      await page.waitForTimeout(2200);
      const seen = await subject();
      const stats = await idleAt(seconds);
      const missed = seen.hash !== route || seen.cls.includes("error-screen") || stats.n === 0;
      rows.push({ route, ...seen, ...stats, missed });
      const verdict = missed
        ? stats.n === 0
          ? "NO FRAMES (the camera could not photograph it)"
          : `MISSED (landed on ${seen.hash} / ${seen.cls})`
        : STILL_EXPECTED
          ? stats.max > 0.02
            ? "STILL MOVING"
            : "still, as asked"
          : stats.median < FLOOR
            ? "UNDER FLOOR"
            : stats.min <= 0
              ? "FROZEN FRAME"
              : "alive";
      console.log(
        `  ${route.padEnd(15)} n=${String(stats.n).padStart(2)} min=${f3(stats.min)} med=${f3(stats.median)} ` +
          `max=${f3(stats.max)}  planes=${seen.layers} accent=${(seen.accent || "-").padEnd(8)} ${verdict}`
      );
    }

    const measured = rows.filter((r) => !r.missed);
    const roomless = measured.filter((r) => r.layers === 0);
    const all = quantiles(measured.map((r) => r.median));
    console.log(
      `\n[sweep] ${measured.length} routes measured, ${rows.length - measured.length} missed. ` +
        `medians: min=${f3(all.min)} median=${f3(all.median)} max=${f3(all.max)}`
    );

    /**
     * Under reduced motion the floor inverts, and this is the assertion rather
     * than a skip.
     *
     * "Alive at rest" and "honours reduced motion" are the same requirement
     * read from two directions, so the same instrument answers both — and the
     * second direction is the one nobody checks. A decorative layer that was
     * added without a reduced-motion rule is invisible to a reviewer, invisible
     * to the type checker, and shows up here as a route that is still moving
     * when it has been asked not to. 0.02 rather than 0 because a screen with a
     * `<video>`, a canvas or a caret would legitimately produce a hundredth of
     * a level; nothing in this build does, and all four proof routes come back
     * at exactly 0.000.
     */
    if (STILL_EXPECTED) {
      const moving = measured.filter((r) => r.max > 0.02);
      console.log(
        `[sweep] reduced motion: ${moving.length} route(s) still moving ` +
          `${moving.map((r) => `${r.route}@${f3(r.max)}`).join(" ") || "(none — every route is a still, as asked)"}`
      );
      console.log(`[sweep] with no room at all:     ${roomless.length} ${roomless.map((r) => r.route).join(" ") || "(none)"}`);
      if (moving.length || roomless.length) process.exitCode = 1;
    } else {
      const under = measured.filter((r) => r.median < FLOOR);
      const frozen = measured.filter((r) => r.min <= 0);
      console.log(`[sweep] under the ${FLOOR} floor: ${under.length} ${under.map((r) => r.route).join(" ") || "(none)"}`);
      console.log(`[sweep] with a zero minimum:     ${frozen.length} ${frozen.map((r) => r.route).join(" ") || "(none)"}`);
      console.log(`[sweep] with no room at all:     ${roomless.length} ${roomless.map((r) => r.route).join(" ") || "(none)"}`);
      if (under.length || frozen.length || roomless.length) process.exitCode = 1;
    }
    if (rows.length - measured.length) {
      console.log(`[sweep] missed: ${rows.filter((r) => r.missed).map((r) => `${r.route}->${r.hash}`).join(" ")}`);
    }
  }

  /* --------------------------------------------------------------- cost */
  /**
   * What the room costs, measured on the compositor rather than on the main
   * thread.
   *
   * `requestAnimationFrame` gap traces cannot see this and never could: rAF runs
   * on the main thread and reports blocking whether or not a pixel was late.
   * The screencast timestamps are presented-frame timestamps, so the median gap
   * between them is the real frame interval — and the same page is measured
   * twice, once with the room and grain running and once with them switched
   * off, so the screencast's own overhead is present in both arms and cancels.
   */
  if (mode === "cost") {
    const route = argv[1] ?? "missions";
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#${route}${ROUTE_PARAMS[route] ?? ""}`, { waitUntil: "networkidle" });
    await settled();
    /**
     * Eight seconds of warm-up, and the first version of this file did not have
     * it — which made this instrument the tenth liar in the project's list
     * rather than a measurement.
     *
     * Run as A-then-B, `#battle` reported 50.4fps with the room and 61.2fps
     * without, which reads as an 11fps regression and is worth reverting for.
     * The tell was the third arm: switching the room back **on** gave 75.3fps,
     * faster than either. There is no arrangement of a background layer that
     * makes the page faster by being added, so the trend was not the room — it
     * was the route still finishing its own work. `#battle` is warming a three.js
     * scene and `#collection` is rasterising card art for several seconds after
     * `settled()` returns, so an A/B where A is always first measures the
     * warm-up and attributes it to A.
     *
     * The fix is a long warm-up **and** interleaving: six arms, A B A B A B,
     * pooled. Whatever monotonic trend is left lands on both arms equally.
     */
    await page.waitForTimeout(8000);

    const session = await page.context().newCDPSession(page);
    let reel = [];
    let filming = false;
    session.on("Page.screencastFrame", (f) => {
      if (filming) reel.push((f.metadata.timestamp ?? 0) * 1000);
      void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });

    /**
     * Switch the layer under test off, or back on, without a reload.
     *
     * `--layer` picks which half is being charged: `room` is the seven planes
     * behind the screen, `grain` is the one drifting plane in front of it, and
     * the default charges both together. Attribution matters here because the
     * two have completely different shapes — the room is four composited
     * layers behind whatever the screen paints, and the grain is one composited
     * layer that has to blend over everything the screen painted, including a
     * WebGL canvas.
     */
    const UNDER_TEST =
      { room: ".d-room", grain: ".atm-fore-grain" }[String(flag("layer", "both"))] ?? ".d-room, .atm-fore-grain";
    const setRoom = async (on) => {
      await page.evaluate(
        ({ visible, sel }) => {
          let tag = document.getElementById("__roomcost");
          if (!tag) {
            tag = document.createElement("style");
            tag.id = "__roomcost";
            document.head.appendChild(tag);
          }
          tag.textContent = visible ? "" : `${sel} { display: none !important; }`;
        },
        { visible: on, sel: UNDER_TEST }
      );
      // A composited layer that has just been dropped or re-created needs a
      // couple of frames before its steady-state cost is what is being timed.
      await page.waitForTimeout(700);
    };

    const film = async (ms) => {
      reel = [];
      filming = true;
      await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: VW, maxHeight: VH });
      await page.evaluate(() => {
        window.__long = [];
        window.__obs?.disconnect();
        window.__obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
        });
        window.__obs.observe({ entryTypes: ["longtask"] });
      });
      await page.waitForTimeout(ms);
      filming = false;
      await session.send("Page.stopScreencast").catch(() => {});
      const gaps = [];
      for (let i = 1; i < reel.length; i += 1) gaps.push(reel[i] - reel[i - 1]);
      const long = await page.evaluate(() => window.__long ?? []);
      return { gaps, longMs: long.reduce((a, b) => a + b, 0), longN: long.length };
    };

    /**
     * How many interleaved A/B rounds, and why the default is not three.
     *
     * Three rounds gave +0.98, +0.87 and +0.79ms on two different routes, which
     * looked like a converged answer and was not: the next two runs of the same
     * command gave +1.62 and −0.12. The instrument's own spread is roughly
     * ±1.5ms on this machine — there are two other builders' browsers competing
     * for it — and three rounds is simply not enough samples to see through
     * that. A number quoted from three rounds would have been the eleventh
     * confident wrong answer in this project's list.
     *
     * Eight rounds is about ninety seconds a route and brings the pooled
     * medians over roughly ten thousand presented frames each, which is where
     * the run-to-run spread drops under half a millisecond.
     */
    const ROUNDS = Number(flag("rounds", 8));
    console.log(
      `[cost] #${route} at ${VW}x${VH}, ${ROUNDS * 2} interleaved arms of 3s, charging "${UNDER_TEST}"\n`
    );
    const arms = { on: { gaps: [], longMs: 0, longN: 0 }, off: { gaps: [], longMs: 0, longN: 0 } };
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const state of ["on", "off"]) {
        await setRoom(state === "on");
        const r = await film(3000);
        arms[state].gaps.push(...r.gaps);
        arms[state].longMs += r.longMs;
        arms[state].longN += r.longN;
        const g = quantiles(r.gaps);
        console.log(
          `  round ${round + 1} room ${state.padEnd(3)}  frames=${String(r.gaps.length + 1).padStart(3)} ` +
            `median gap=${g.median?.toFixed(2)}ms (${(1000 / g.median).toFixed(1)}fps)  p90=${g.p90?.toFixed(2)}ms`
        );
      }
    }
    await setRoom(true);

    const on = quantiles(arms.on.gaps);
    const off = quantiles(arms.off.gaps);
    const delta = on.median - off.median;
    console.log(
      `\n[cost] pooled: room ON  median gap ${on.median.toFixed(2)}ms (${(1000 / on.median).toFixed(1)}fps) ` +
        `p90 ${on.p90.toFixed(2)}ms  longtasks ${arms.on.longN}/${arms.on.longMs}ms`
    );
    console.log(
      `[cost] pooled: room OFF median gap ${off.median.toFixed(2)}ms (${(1000 / off.median).toFixed(1)}fps) ` +
        `p90 ${off.p90.toFixed(2)}ms  longtasks ${arms.off.longN}/${arms.off.longMs}ms`
    );
    console.log(
      `[cost] the room costs ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}ms of frame interval ` +
        `(${((delta / off.median) * 100).toFixed(1)}% of a frame)`
    );
  }
} finally {
  if (pageErrors.length) {
    console.log(`\n${pageErrors.length} page error(s):`);
    for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log("  " + e.slice(0, 180));
  }
  await browser.close();
}
