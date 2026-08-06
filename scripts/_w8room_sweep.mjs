/**
 * Is every route alive at rest, and does the thing that makes it alive cost
 * anything?
 *
 * ## Why a new file, when nine instruments have already lied here
 *
 * The brief's instruction is to reuse `_w7rw_probe.mjs`, which is the validated
 * one, and this obeys it in the way that matters: **the arithmetic below is
 * `_w7rw_probe.mjs`'s.** Both now import `meanDelta` and `quantiles` from
 * `lib/idle.mjs` rather than each keeping a copy, which is stronger than the
 * copies were — a copy is identical on the day it is pasted.
 *
 * What it adds is the only thing the probe cannot do: **all forty-nine routes in
 * one browser session**. The probe launches Chrome, seeds an account and
 * navigates per invocation, which is about seventy seconds a route and over
 * half an hour for a sweep — long enough that nobody runs it, which is how a
 * per-screen defect survives two waves. One browser, one seeded account, one
 * hash change per route brings it to about eight minutes.
 *
 * ## The five traps this file is written against
 *
 * **Frame-to-frame differencing.** At 50fps consecutive frames are 20ms apart
 * and a 3.6s breathe moves 0.5% of its amplitude in that time, so a genuinely
 * breathing screen reports 0.00. Every figure here is a **200ms** figure, which
 * is the grid the reference frames themselves are on.
 *
 * **A grid that is not the grid on the label — the correction of wave 9, and
 * the reason this header no longer reads the way it did.** The first version of
 * this file sampled with `page.screenshot()` then `waitForTimeout(200)` and
 * called the result a per-200ms figure. On this machine that loop achieves
 * **843ms**, because one 1600x900 `page.screenshot()` costs 691ms and
 * `decodePng` another 64ms. Every figure the wave-8 sweep published was
 * therefore an 843ms number compared against a 200ms floor, in the direction
 * that flatters, and the `calib` block above it gave the whole thing a clean
 * bill of health because it was checking the arithmetic and nothing else.
 * `lib/idle.mjs` carries the fix and `_w9grid.mjs replay` carries the proof:
 * the reference frames are replayed into a browser at a known cadence and
 * photographed back out, and the sampler is required to walk them one at a time.
 * **Every row below prints the grid it achieved**, and a row that drifted more
 * than 8% off 200ms is refused rather than reported.
 *
 * **A probe that cannot prove it is looking at its subject.** A route that
 * failed to build shows the error screen, and an error screen has an
 * atmosphere behind it like anything else — so it measures perfectly well and
 * tells you nothing about the route you asked for. Every row prints the hash it
 * actually landed on and the screen class it actually photographed, and a route
 * that landed somewhere else is reported as MISSED rather than folded into the
 * pass rate.
 *
 * **A census that counts elements rather than pixels.** `planes` is the number
 * of room layers actually *drawn*, and it used to be `room.children.length`,
 * which counts a `display: none` element as readily as a painted one. That is
 * not a hypothetical difference in this build — `:root[data-board="true"]` drops
 * the room behind a match on purpose — so six routes were passing the roomless
 * check while drawing no room at all, for a reason that had nothing to do with
 * being correct. The row now names every plane it saw drawn.
 *
 * **A long session that quietly degrades.** Three other builders save into this
 * Vite server while the sweep walks it, and a bad save takes the module graph
 * with it: the first honest run reported twenty-six consecutive roomless routes
 * after a dev-server 500, all of them fine on a reload. Page errors are charged
 * to the route that was on screen when they happened, a roomless reading is
 * re-taken over a full navigation before it is believed, and a route that throws
 * becomes one row rather than the end of the run.
 *
 *   node scripts/_w8room_sweep.mjs calib
 *   node scripts/_w8room_sweep.mjs idle [--seconds n] [--only a,b,c] [--size WxH]
 *                                       [--scale-ui 1.4] [--reduced-motion] [--high-contrast]
 *                                       [--without grain|room|both]
 *                                       [--sabotage <route> [--sabotage-layer room|both]]
 *   node scripts/_w8room_sweep.mjs cost <route>   -- frame interval with the room and without
 *
 * Exit code is non-zero if any measured route is under the floor, so this is
 * usable as a gate and not only as a report. `--sabotage` is how you check that
 * claim rather than believing it: it undresses one named route at runtime and
 * the run should go red naming that route and no other.
 *
 * A full default sweep writes `_w8room_sweep.results.json` beside this file, and
 * `tests/every-screen-is-a-room.test.ts` asserts against it.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";
import { createIdleSampler, f3, quantiles, referenceAtLag, referenceGrid } from "./lib/idle.mjs";

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

/**
 * The floor the brief sets, and the reference the floor comes from.
 *
 * 0.5 is the reference set's **minimum** at 200ms: the quietest single tick in
 * forty seconds of real gameplay. A screen under it is quieter at rest than
 * Hearthstone has ever been for a fifth of a second. `LIVELY` is the reference
 * *median* and is reported rather than gated on, because a menu is not obliged
 * to be as busy as a board mid-turn.
 *
 * Both are per-200ms and only per-200ms. `_w9grid.mjs ref` prints the same
 * reference at 400/600/800/1000ms, and it climbs to 1.274/4.480 by 800ms —
 * which is the exchange rate that condemns every figure the wave-8 run of this
 * file published.
 *
 * They are also per-1920x1080, which is the reference's size and not this
 * sweep's. `_w9grid.mjs ref --crop 1600x900` recomputes the reference on a
 * centred window the size this file photographs and gets **0.553 / 2.046** —
 * the borders of a Hearthstone frame are its quietest region, so cropping them
 * away raises the floor by a tenth on the minimum and a fifth on the median.
 * 0.5 is therefore very slightly lenient here. It is left alone deliberately:
 * every figure this project has published is against 0.501, moving it would
 * silently re-scale the lot, and no route in the honest sweep is anywhere near
 * either number — the quietest measured route sits at 0.853. Recorded so that
 * the next person to lean on the floor knows which one they are leaning on.
 */
const FLOOR = 0.5;
const LIVELY = 1.713;
const LAG_MS = 200;
const REFERENCE = { n: 203, min: 0.501, median: 1.713 };

/**
 * With `--reduced-motion` the run is asking the opposite question, so it
 * applies the opposite gate: every route must be a *still*. See the summary
 * block at the end of the idle mode for why that is an assertion and not a skip.
 */
const STILL_EXPECTED = argv.includes("--reduced-motion");

/** See the block beside its use in the route loop. */
const SABOTAGE = flag("sabotage", null);
const SABOTAGE_SEL =
  { room: ".screen > .d-room", both: ".screen > .d-room, .atm-fore-grain" }[String(flag("sabotage-layer", "room"))] ??
  ".screen > .d-room";

/**
 * The table this run publishes, and the reason it is a file rather than only a
 * console.
 *
 * `tests/every-screen-is-a-room.test.ts` is the cheap half of this gate and runs
 * on every commit; it cannot open a browser, so before wave 9 it could only
 * *name* this script and repeat its prose. It now reads the table below and
 * asserts three things a sentence cannot: that every registered route is in it,
 * that every row cleared the floor, and — the one that would have caught
 * instrument eleven — that every row was taken on a 200ms grid. Written only
 * for a full default sweep, so a `--only` run or a `--reduced-motion` run cannot
 * quietly replace the record with three routes.
 */
const RESULTS = path.join(HERE, "_w8room_sweep.results.json");

/**
 * Recompute the reference, and — the half wave 8 skipped — recompute it **on
 * the grid this run is about to sample at**.
 *
 * The old version of this block checked only that `meanDelta` still reproduced
 * n=203 / min 0.501 / median 1.713 from the reference directory, and passed,
 * and the run underneath it was on an 843ms grid the whole time. Reproducing a
 * distribution proves the arithmetic; it cannot see the stopwatch. So this now
 * asserts two things: that the arithmetic is unchanged, and that the reference
 * frames are themselves 200ms apart — read off their own filenames, because
 * "per 200ms" is a claim about the reference set and nobody had ever checked it.
 */
if (mode === "calib" || mode === "idle") {
  const grid = referenceGrid();
  if (!grid) {
    console.log("!! hearthstone_frames/ is missing — this instrument cannot be calibrated, so it will not report");
    process.exit(2);
  }
  console.log(
    `[calib] reference set: ${grid.n} frames, filename timestamps ${grid.gaps.join("/")}ms apart -> ` +
      (grid.uniform ? `a genuine ${grid.stepMs}ms grid` : "!! NOT UNIFORM, 'per 200ms' was never true")
  );
  if (!grid.uniform || grid.stepMs !== LAG_MS) process.exit(2);
  const s = referenceAtLag(LAG_MS);
  console.log(
    `[calib] hearthstone_frames n=${s.n} min=${f3(s.min)} median=${f3(s.median)} p90=${f3(s.p90)} max=${f3(s.max)}`
  );
  const agrees =
    s.n === REFERENCE.n && Math.abs(s.min - REFERENCE.min) < 0.002 && Math.abs(s.median - REFERENCE.median) < 0.002;
  console.log(
    `[calib] published n=${REFERENCE.n} min=${REFERENCE.min} median=${REFERENCE.median} -> ` +
      (agrees ? "AGREES, the numbers below are on the brief's scale" : "!! DOES NOT AGREE — nothing below is comparable")
  );
  const eight = referenceAtLag(800);
  console.log(
    `[calib] and the same reference on the grid wave 8 actually sampled at (~843ms): ` +
      `min=${f3(eight.min)} median=${f3(eight.median)} — the floor those figures should have faced`
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

/**
 * What is actually on screen, so a row can prove it photographed its subject.
 *
 * `layers` counts planes that are **rendered**, not planes that are in the DOM,
 * and that distinction is not pedantry — it is a hole this sweep's own sabotage
 * mode found in it within a minute of existing. `--sabotage legal` hid the room
 * with `display: none` and the row still came back `planes=7`, because
 * `room.children.length` counts a hidden element as readily as a painted one.
 * A census that cannot tell a drawn layer from a suppressed one is the eighth
 * instrument in this project's list wearing new clothes: `:root[data-board]`
 * already hides the room over a match by exactly this mechanism, so the
 * difference between "no room" and "a room that is not drawn" was never
 * hypothetical.
 *
 * `offsetParent` is null for anything inside a `display: none` subtree, which is
 * the cheap and exact test; `position: fixed` would defeat it, and none of the
 * seven planes is fixed.
 */
async function subject() {
  return page.evaluate(() => {
    const screen = [...document.querySelectorAll(".screen")].find((s) => !s.classList.contains("screen-out"));
    const room = screen?.querySelector(":scope > .d-room");
    const drawn = (el) => el instanceof HTMLElement && el.offsetParent !== null && getComputedStyle(el).opacity !== "0";
    const roomDrawn = room ? drawn(room) : false;
    return {
      hash: location.hash.replace(/^#/, "").split("?")[0],
      cls: screen ? String(screen.className).slice(0, 46) : "NONE",
      layers: roomDrawn ? [...room.children].filter(drawn).length : 0,
      inDom: room ? room.children.length : 0,
      /**
       * *Which* planes are drawn, not merely how many.
       *
       * `#story` came back with six of seven the first time the census could
       * tell drawn from hidden, and a count cannot say whether that is a defect
       * or the design. Named, it is answerable in one line: the missing plane is
       * `.d-room-wall`, and `hall.css` §5 hides it on a hall with no rail
       * standing in it — "the parts of the room that only make sense beside a
       * rail". A number would have had to be argued about; a name is checkable.
       */
      drawnLayers: room ? [...room.children].filter(drawn).map((el) => String(el.className).split(/\s+/)[0]) : [],
      /**
       * Both halves of `hall.css` §5's condition, separately, because the
       * exemption it grants is narrower than either half alone: the wall is
       * dropped on `.d-hall` **and** (`.d-hall-solo` or no `.d-rail`). A test
       * that excused a missing wall on any rail-less screen would excuse it on
       * the thirty-odd routes that are not halls at all.
       */
      hall: Boolean(screen?.classList.contains("d-hall")),
      rail: Boolean(screen?.querySelector(":scope > .d-rail")),
      accent: screen ? getComputedStyle(screen).getPropertyValue("--hall-accent").trim() : "",
      grain: [...document.querySelectorAll(".atm-fore-grain")].filter(drawn).length,
      /**
       * A match is allowed — required — to have no drawn room: behind an opaque
       * three.js board the seven planes are invisible and cost +0.79ms of frame
       * interval, so `transitions.css` drops them off `:root[data-board]`. Read
       * from the flag the shell actually sets rather than from a list of route
       * ids, for the same reason the shell writes it that way.
       *
       * Until the count above learned to tell a drawn plane from a hidden one,
       * `#battle` reported seven planes and passed the roomless check for a
       * reason that had nothing to do with the room.
       */
      board: document.documentElement.dataset.board === "true",
    };
  });
}

/**
 * Sample at rest on the reference's own 200ms grid — and this time actually on
 * it.
 *
 * `lib/idle.mjs` holds the sampler and the argument for it; the two properties
 * that matter to a reader of this file are that the loop sleeps the *remainder*
 * of each period rather than a whole period on top of a 691ms capture, and that
 * it hands back the interval it achieved so no figure here can be quoted
 * without one. The capture keeps an explicit timeout and a null return for the
 * same reason the old one did: `never-a-blank-frame.test.ts` records a real
 * state where a screen is pinned at the 0% keyframe of an entrance that never
 * started and the camera hangs. A sweep that dies on route eleven tells you
 * nothing about routes twelve to forty-nine.
 */
let idleAt = null;

try {
  if (mode === "idle") {
    const seconds = Number(flag("seconds", 3));
    const only = flag("only", null);
    const wanted = only ? String(only).split(",") : registeredRoutes();
    console.log(`[sweep] ${wanted.length} routes at ${VW}x${VH}, ${seconds}s each, floor ${FLOOR} per ${LAG_MS}ms\n`);

    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await applySettings();
    await settled();
    await page.waitForTimeout(1500);
    idleAt = await createIdleSampler(page, { lagMs: LAG_MS, timeoutMs: 8000 });

    /**
     * `--without grain` — the question the corrected grid makes unavoidable.
     *
     * `.atm-fore-grain` is a full-viewport field of noise at the highest spatial
     * frequency a display has, drifting continuously, and mean-absolute-delta is
     * exactly the statistic it is best at moving. It is entirely possible for a
     * screen to be perceptually dead and still clear a 0.5 floor on grain alone;
     * instrument ten in this project's list was an emptiness metric fooled by a
     * grain overlay, so the failure mode is not hypothetical here. Running the
     * sweep a second time with the grain suppressed separates "this screen is
     * alive" from "this screen has noise over it", and both numbers belong in
     * the table.
     */
    const WITHOUT = { grain: ".atm-fore-grain", room: ".screen > .d-room", both: ".atm-fore-grain, .screen > .d-room" }[
      String(flag("without", ""))
    ];
    if (WITHOUT) {
      await page.evaluate((sel) => {
        const tag = document.createElement("style");
        tag.id = "__sweep_without";
        tag.textContent = `${sel} { display: none !important; }`;
        document.head.appendChild(tag);
      }, WITHOUT);
      console.log(`[sweep] measuring WITHOUT "${WITHOUT}" — every figure below is the screen with that layer removed\n`);
    }

    const rows = [];
    for (const route of wanted) {
      /**
       * Which route was on screen when the app broke.
       *
       * A page error used to be printed once at the end of the run as a set,
       * which tells you that something failed and not when — and "when" is the
       * whole question if the failure is a dev-server 500 that poisons every
       * route measured after it. Charged per route, the log reads as a
       * timestamp. Declared outside the `try` because the `catch` reports it too.
       */
      const errorsBefore = pageErrors.length;
      const params = ROUTE_PARAMS[route] ?? "";
      try {
        /**
         * `.catch` on the hash write, and a `try` around the whole route.
         *
         * A run of this file died on route forty-seven of forty-nine with
         * "Execution context was destroyed, most likely because of a navigation"
         * — thrown by the hash write itself, because that is what a hash write is
         * *for*. Playwright resolves `evaluate` against the context it started in,
         * and if the app tears that context down quickly enough the call rejects
         * after having done exactly what was asked. Forty-six good rows were lost
         * to a successful navigation.
         *
         * More generally: a sweep whose value is the completeness of its table
         * must never let one route end the run. A route that throws becomes a row
         * that says so, the page is walked back to a known screen, and the other
         * forty-eight are still measured.
         */
        await page.evaluate((h) => (location.hash = h), `${route}${params}`).catch(() => {});
        await settled();
        /**
         * 2200ms of settle before a single sample, and it is not padding. Every
         * screen in this build runs an entrance cascade, counts its numbers up
         * and fills its meters on arrival; measuring through that reports the
         * arrival, not the rest. The mote fields also arrive on an idle callback
         * and fade in over 1.2s.
         */
        await page.waitForTimeout(2200);
        /**
         * `--sabotage <route> [--sabotage-layer room|both]` — the proof that this
         * gate can still go red.
         *
         * A gate nobody has ever seen fail is a gate nobody has evidence for, and
         * the honest way to see this one fail is to reproduce the defect it was
         * written for: one screen, undressed, while the other forty-eight are
         * left alone. Done here at runtime rather than by editing
         * `transitions.css`, because three other builders are in that file today
         * and because a sabotage that has to be remembered and undone is a
         * sabotage that eventually is not.
         *
         * `room` is the literal wave-8 defect: the seven planes gone, everything
         * else — including the grain on the persistent front plane — left in
         * place. `both` additionally suppresses the grain for the duration of this
         * one route's sample. The difference between the two is not a detail; it
         * is the answer to "what is actually keeping these screens above the
         * floor", and the sweep prints both so nobody has to take a view on it.
         */
        const sabotaged = SABOTAGE === route;
        if (sabotaged) {
          await page.evaluate((sel) => {
            const tag = document.createElement("style");
            tag.id = "__sabotage";
            tag.textContent = `${sel} { display: none !important; }`;
            document.head.appendChild(tag);
          }, SABOTAGE_SEL);
          await page.waitForTimeout(600);
          console.log(`  -- sabotaging #${route}: "${SABOTAGE_SEL}" removed for this route only`);
        }
        let seen = await subject();
        /**
         * A zero is confirmed by a full reload before it is believed. This one is
         * the twelfth liar, caught in its first run.
         *
         * The first honest sweep came back with twenty-seven roomless routes, and
         * they were not scattered: routes one to twenty-three had seven planes and
         * twenty-four to forty-nine had none, with a dev-server 500 in the error
         * log. Three other builders are saving files into this Vite server while
         * the sweep walks it; one bad save degrades the module graph and every
         * route measured afterwards is a route measured in a broken app. As a
         * *finding* that is worthless, and as a **published table it is a lie of
         * exactly the kind this wave exists to stop** — a confident answer to a
         * question nobody asked ("what does this route look like after the app
         * broke?").
         *
         * A hash change cannot recover from that; a full navigation can. So a
         * roomless reading is re-taken over a fresh load of the page, and only a
         * route that comes back roomless twice — once mid-session and once from a
         * clean boot — is reported as roomless. The reload also re-seeds nothing
         * and costs about four seconds, which is affordable precisely because it
         * only happens on the rows that would otherwise be an accusation.
         */
        if (seen.layers === 0 && !seen.board && !sabotaged) {
          await page.goto(`${ORIGIN}/?nointro#${route}${params}`, { waitUntil: "networkidle" }).catch(() => {});
          await settled();
          await page.waitForTimeout(2200);
          const after = await subject();
          console.log(
            `  -- ${route}: no room in the running session; after a full reload planes=${after.layers}` +
              (after.layers > 0 ? "  (the session was degraded, not the route)" : "  (confirmed roomless)")
          );
          seen = after;
        }
        /**
         * One retry, and only for the clock.
         *
         * A route can lose the grid for reasons that have nothing to do with it —
         * three other builders' browsers are on this machine, and a GC pause or a
         * Vite recompile lands wherever it lands. Retrying a *refused* sample is
         * not the same as retrying until the number is nice: the reading itself is
         * never re-rolled, only a run whose stopwatch failed, and if the second
         * attempt is also off grid the route is reported as refused rather than
         * measured.
         */
        let stats = await idleAt({ seconds });
        if (!stats.onGrid && stats.n > 0) {
          await page.waitForTimeout(800);
          const second = await idleAt({ seconds });
          if (second.onGrid) stats = second;
        }
        /**
         * A route that could not be photographed on the grid is `missed`, not
         * `under floor` and not `alive`.
         *
         * This is the line that makes the wave-8 mistake unrepeatable rather than
         * merely fixed. `onGrid` is false whenever the loop drifted more than 8%
         * off the interval it was asked for, which is what happens when a route is
         * so expensive to capture that the period cannot be held — and a number
         * from a slower clock compared to this floor is exactly the thing that
         * went wrong. It is refused, loudly, with its achieved interval printed.
         */
        const missed = seen.hash !== route || seen.cls.includes("error-screen") || stats.n === 0 || !stats.onGrid;
        const errored = pageErrors.length - errorsBefore;
        rows.push({ route, ...seen, ...stats, missed, sabotaged, errored });
        if (sabotaged) await page.evaluate(() => document.getElementById("__sabotage")?.remove());
        if (errored) console.log(`  -- ${route}: ${errored} page error(s) raised while it was on screen`);
        const verdict = missed
          ? stats.n === 0
            ? "NO FRAMES (the camera could not photograph it)"
            : !stats.onGrid
              ? `OFF GRID (${stats.grid.median?.toFixed(0)}ms achieved, ${LAG_MS}ms asked) — refused`
              : `MISSED (landed on ${seen.hash} / ${seen.cls})`
          : STILL_EXPECTED
            ? stats.max > 0.02
              ? "STILL MOVING"
              : "still, as asked"
            : stats.median < FLOOR
              ? "UNDER FLOOR"
              : stats.min <= 0
                ? "FROZEN FRAME"
                : stats.median < LIVELY
                  ? "alive"
                  : "alive (above the reference median)";
        console.log(
          `  ${route.padEnd(15)} n=${String(stats.n).padStart(2)} min=${f3(stats.min)} med=${f3(stats.median)} ` +
            `max=${f3(stats.max)}  grid=${String(stats.grid.median?.toFixed(0) ?? "-").padStart(3)}ms ` +
            `planes=${seen.layers} accent=${(seen.accent || "-").padEnd(8)} ${verdict}`
        );
      } catch (error) {
        /*
         * A route that threw is a row, not the end of the run. The page is
         * walked back to a known screen over a full navigation so the next
         * route does not inherit whatever state broke this one.
         */
        console.log(`  ${route.padEnd(15)} THREW: ${String(error.message).slice(0, 110)}`);
        rows.push({
          route,
          hash: "?",
          cls: "THREW",
          layers: 0,
          inDom: 0,
          drawnLayers: [],
          hall: false,
          rail: false,
          board: false,
          accent: "",
          grain: 0,
          n: 0,
          min: null,
          median: null,
          max: null,
          grid: { median: null, min: null, max: null },
          onGrid: false,
          missed: true,
          sabotaged: false,
          errored: pageErrors.length - errorsBefore,
        });
        await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" }).catch(() => {});
        await settled();
      }
    }

    const measured = rows.filter((r) => !r.missed);
    const grids = quantiles(measured.map((r) => r.grid.median));
    console.log(
      `\n[grid] every figure above was taken at ${grids.median?.toFixed(1)}ms ` +
        `(${grids.min?.toFixed(0)}–${grids.max?.toFixed(0)}ms across ${grids.n} routes) against a ${LAG_MS}ms floor. ` +
        `Wave 8's run of this same file achieved 843ms.`
    );
    /**
     * A route with no drawn room, *excluding* the ones a board is standing in
     * front of. `data-board` is the shell's own flag, so this exemption is the
     * same one the stylesheet uses rather than a second opinion about which
     * routes are matches.
     */
    const roomless = measured.filter((r) => r.layers === 0 && !r.board);
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
      const quiet = measured.filter((r) => r.median >= FLOOR && r.median < LIVELY);
      console.log(
        `[sweep] under the ${FLOOR} floor: ${under.length} ` +
          `${under.map((r) => `${r.route}@${f3(r.median)}`).join(" ") || "(none)"}`
      );
      console.log(
        `[sweep] over the floor but under the reference median ${LIVELY}: ${quiet.length} ` +
          `${quiet.map((r) => r.route).join(" ") || "(none)"}   (reported, not gated — a menu need not be a board)`
      );
      console.log(`[sweep] with a zero minimum:     ${frozen.length} ${frozen.map((r) => r.route).join(" ") || "(none)"}`);
      const behindBoard = measured.filter((r) => r.board).map((r) => r.route);
      console.log(`[sweep] with no room at all:     ${roomless.length} ${roomless.map((r) => r.route).join(" ") || "(none)"}`);
      console.log(
        `[sweep] room correctly dropped behind a board: ${behindBoard.length} ${behindBoard.join(" ") || "(none)"}`
      );
      if (under.length || frozen.length || roomless.length) process.exitCode = 1;
    }
    if (rows.length - measured.length) {
      console.log(`[sweep] missed: ${rows.filter((r) => r.missed).map((r) => `${r.route}->${r.hash}`).join(" ")}`);
    }

    const isDefaultRun =
      !only && !SABOTAGE && !WITHOUT && !UI_SCALE && !STILL_EXPECTED && !argv.includes("--high-contrast") &&
      VW === 1600 && VH === 900;
    if (isDefaultRun) {
      writeFileSync(
        RESULTS,
        `${JSON.stringify(
          {
            note:
              "Written by `node scripts/_w8room_sweep.mjs idle`. Every figure is a mean-absolute-per-channel " +
              "delta between two captures `lagMs` apart, and `gridMs` is the interval that run ACTUALLY achieved " +
              "— the field whose absence made this instrument the eleventh liar in the project. " +
              "tests/every-screen-is-a-room.test.ts asserts against this file.",
            takenAt: new Date().toISOString(),
            viewport: `${VW}x${VH}`,
            lagMs: LAG_MS,
            floor: FLOOR,
            reference: REFERENCE,
            routes: rows.map((r) => ({
              route: r.route,
              n: r.n,
              min: r.min === null ? null : +r.min.toFixed(4),
              median: r.median === null ? null : +r.median.toFixed(4),
              max: r.max === null ? null : +r.max.toFixed(4),
              gridMs: r.grid.median === null ? null : +r.grid.median.toFixed(1),
              onGrid: r.onGrid,
              planes: r.layers,
              planesInDom: r.inDom,
              drawnLayers: r.drawnLayers,
              hall: r.hall,
              rail: r.rail,
              board: r.board,
              accent: r.accent,
              pageErrors: r.errored,
              missed: r.missed,
            })),
          },
          null,
          2
        )}\n`
      );
      console.log(`\n[sweep] table written to ${path.relative(path.join(HERE, ".."), RESULTS)}`);
    } else {
      console.log("\n[sweep] not a default full sweep — the committed table was left alone");
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
