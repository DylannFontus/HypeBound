/**
 * Watch a navigation frame by frame, because a still cannot show a hole.
 *
 * §3a of the AAA bar has one non-negotiable in it — *"never a blank frame. No
 * moment where neither screen is drawn, and no moment where the page background
 * flashes through"* — and the way that requirement fails is invisible to every
 * other kind of check. The code is right, the keyframes are right, the
 * stylesheet says the outgoing screen fades over 170ms; and then a destination's
 * constructor blocks the main thread for 588ms, the exit animation reaches its
 * `opacity: 0` fill state and holds there, the incoming screen has not been
 * placed yet, and for half a second the document contains exactly one screen and
 * it is invisible. Two independent screencasts of `lobby → #uikit` caught it —
 * `uk-32_t640.jpg` and `uk2-32_t651.jpg`, both bare atmosphere.
 *
 * Nothing static finds that. So this samples the real DOM on every animation
 * frame of a real navigation in a real browser, and asks four questions of the
 * trace.
 *
 * ## 1. Was anything drawn?
 *
 * Every sampled frame must contain a `.screen` above `VISIBLE` opacity, **or**
 * be covered by the curtain. A veil is a drawn thing and covering a load is what
 * it is for; bare atmosphere is the hole.
 *
 * ## 2. Was anything *observed*?
 *
 * This is the question the first one cannot survive without, and it is the
 * subtle one. When the main thread blocks, the `requestAnimationFrame` probe
 * stops sampling — so a navigation that freezes for three seconds produces a
 * trace with no bad frames in it, and a test that only asked question 1 would
 * call that a pass. Measured on `lobby → collection`: fourteen samples across
 * 4.9 seconds, one gap of 3279ms. So any gap longer than `OBSERVABLE` must have
 * the curtain up on both sides of it. Unobserved and uncovered is a failure,
 * because the frames nobody photographed are exactly where the hole was found.
 *
 * ## 3. Did it take longer than the budget?
 *
 * 260–420ms, measured from the first frame of the exit to the last frame of the
 * entrance, off the browser's own animation events rather than off a timer. The
 * budget applies to an ordinary navigation. It does not apply behind a curtain,
 * and that is not a loophole: the contract's answer to a build that cannot be
 * made fast is to cover it deliberately, so the rule enforced here is **you may
 * exceed the budget only behind a veil.**
 *
 * ## 4. Did both ends of the exchange actually animate?
 *
 * `collection → lobby` once produced one animation frame and *zero* animation
 * events in a 1600ms window: both screens pinned at their 0% keyframes, the
 * lobby at opacity 0 behind an opaque Collection, and a Playwright screenshot of
 * that state timing out at thirty seconds. A transition that never starts is
 * indistinguishable from one that finished instantly unless you count the
 * events, so they are counted.
 *
 * ## What this costs, and why it is not skipped quietly
 *
 * It needs a browser and the dev server. On CI there is neither, and a test that
 * cannot observe anything is honestly skipped there. On a developer's machine
 * the dev server is running by definition — that is how this project is worked
 * on — so a missing one is a **failure with instructions**, not a skip. A guard
 * that goes quiet when its instrument is unplugged is the same class of mistake
 * as the camera that could not photograph motion.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";

const ORIGIN = "http://localhost:5173";

/** The same two browsers `scripts/shot.mjs` looks for, plus the usual Linux paths. */
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function unavailable(): Promise<string | null> {
  if (BROWSERS.find((path) => existsSync(path)) === undefined) return "no Chrome or Edge on this machine";
  try {
    const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return `the dev server answered ${response.status}`;
  } catch {
    return `nothing is serving ${ORIGIN}`;
  }
  return null;
}

const REASON = await unavailable();
const OPTED_OUT = process.env["CI"] !== undefined || process.env["HYPEBOUND_NO_BROWSER"] !== undefined;

/**
 * The one assertion that runs unconditionally.
 *
 * Everything below is skipped when there is no instrument to measure with, and a
 * skip that nobody notices is how a suite quietly stops guarding anything. This
 * turns "I cannot run" into a failure everywhere except the two places where it
 * is genuinely expected.
 */
describe("the instrument", () => {
  it("is plugged in, or the environment has said it will not be", () => {
    expect(
      REASON === null || OPTED_OUT,
      `${REASON}. This suite drives the running dev server with a real browser; start ` +
        `\`npm run dev\` and re-run, or set HYPEBOUND_NO_BROWSER=1 to opt out deliberately.`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the probe, which runs inside the page
// ---------------------------------------------------------------------------

interface ScreenSample {
  id: string;
  nav: string;
  opacity: number;
  width: number;
  height: number;
  hidden: boolean;
}

interface FrameSample {
  t: number;
  screens: ScreenSample[];
  curtain: number | null;
}

interface AnimationRecord {
  type: string;
  name: string;
  screen: string | null;
  t: number;
}

interface Trace {
  frames: FrameSample[];
  events: AnimationRecord[];
}

/**
 * Installed after the departure screen has settled and before the hash changes.
 *
 * It is deliberately cheap — one `getComputedStyle` per screen per frame, and at
 * most two screens exist — because a probe that costs a frame changes the thing
 * it is measuring.
 */
function installProbe(): void {
  interface Probe extends Trace {
    t0: number;
    running: boolean;
  }
  const scope = window as unknown as { __navProbe?: Probe };
  const probe: Probe = { frames: [], events: [], t0: performance.now(), running: true };
  scope.__navProbe = probe;

  const screenOf = (node: EventTarget | null): string | null => {
    const element = node instanceof Element ? node.closest(".screen") : null;
    if (element === null) return null;
    return /([a-z0-9-]+)-screen/.exec(element.className)?.[1] ?? "?";
  };

  for (const type of ["animationstart", "animationend", "animationcancel"]) {
    document.addEventListener(
      type,
      (event) => {
        probe.events.push({
          type,
          name: (event as AnimationEvent).animationName,
          screen: screenOf(event.target),
          t: Math.round(performance.now() - probe.t0),
        });
      },
      true
    );
  }

  const tick = (): void => {
    if (!probe.running) return;
    const screens: ScreenSample[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(".screen")) {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      screens.push({
        id: /([a-z0-9-]+)-screen/.exec(element.className)?.[1] ?? "?",
        nav: element.dataset["nav"] ?? "",
        opacity: Number(style.opacity),
        width: Math.round(box.width),
        height: Math.round(box.height),
        hidden: style.visibility === "hidden" || style.display === "none",
      });
    }
    const veil = document.querySelector<HTMLElement>(".nav-curtain");
    probe.frames.push({
      t: Math.round(performance.now() - probe.t0),
      screens,
      curtain: veil === null ? null : Number(getComputedStyle(veil).opacity),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// the account
// ---------------------------------------------------------------------------

/**
 * The collection grant from `scripts/lib/account.mjs`, as a **string**, and the
 * reason is worth writing down because it will catch the next person too.
 *
 * Vitest runs this file through Vite's SSR transform, which rewrites every
 * `import()` it finds into `__vite_ssr_dynamic_import__` — including the ones
 * inside a function that is never executed here, because it is serialised and
 * shipped to the browser. Importing the shared seeder therefore fails inside the
 * page with `__vite_ssr_dynamic_import__ is not defined`, and the failure looks
 * like a browser problem rather than a bundler one. A string literal is not
 * transformed, and Playwright evaluates one as happily as a function.
 *
 * The logic is the seeder's, unchanged, and it matters here for one reason: a
 * fresh account owns twenty cards, and the collection screen is only the heavy
 * route this file needs when it has 245 canvases to build.
 */
const GRANT_COLLECTION = `(async () => {
  const files = [
    "afterparty-crew", "algorithm-syndicate", "corporate-creators", "cosplay-champions",
    "digital-demons", "gothic-royalty", "meme-collective", "neon-idols", "neutral",
    "touch-grass-order", "viral-influencers",
  ];
  const collection = {};
  for (const file of files) {
    const response = await fetch("/data/cards/" + file + ".json");
    if (!response.ok) continue;
    const raw = await response.json();
    for (const card of raw.cards ?? raw) {
      if (card.token || card.type === "leader" || card.variantOf) continue;
      collection[card.id] = card.rarity === "legendary" ? 1 : 2;
    }
  }
  const { profileStore } = await import("/src/save/profile.ts");
  const storage = await import("/src/save/storage.ts");
  profileStore.update((draft) => {
    draft.collection = collection;
    draft.clout = 5000;
    draft.shards = 5000;
  });
  storage.flushAllStores();
  return Object.keys(collection).length;
})()`;

/** The starter picker, driven through the app's own hook, then the grant. */
async function seedPlayedAccount(target: Page): Promise<void> {
  await target.goto(ORIGIN, { waitUntil: "networkidle" });
  const started = await target.evaluate(`(() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data?.starterFaction);
    } catch { return false; }
  })()`);
  if (started !== true) {
    if ((await target.locator(".starter-screen").count()) === 0) {
      await target.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
    }
    await target.waitForSelector(".starter-screen", { timeout: 30000 });
    await target.evaluate(`window.hypeboundStarter?.choose("neon-idols")`);
    await target.waitForSelector(".starter-screen", { state: "detached", timeout: 30000 });
  }
  const owned = await target.evaluate(GRANT_COLLECTION);
  // Fewer than a hundred means the card files did not load, and every timing
  // below would then be measured against a collection screen that is not heavy.
  expect(Number(owned), "the seeded account must own a full collection").toBeGreaterThan(100);
  await target.reload({ waitUntil: "networkidle" });
}

// ---------------------------------------------------------------------------
// thresholds
// ---------------------------------------------------------------------------

/** Below this a screen is not an image. The transitions.css exits bottom out around 0.12. */
const VISIBLE = 0.05;
/** Above this the veil is doing its job and there is nothing for a screen to be behind. */
const COVERED = 0.5;
/**
 * The longest stretch the probe may go unsampled while claiming to have watched.
 * Twelve frames at 60Hz — long enough that an ordinary hitch is not a failure,
 * short enough that the 588ms and 3279ms blocks this exists to find are.
 */
const OBSERVABLE = 200;
/** §3a and contract §E2. */
const BUDGET = 420;
/**
 * What the instrument costs, not what the transition is allowed to cost. A
 * frame of rAF granularity at each end of the measurement, plus the gap between
 * the hash changing and the browser committing the first style.
 */
const SAMPLING_SLACK = 80;

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

interface Leg {
  from: string;
  to: string;
  /** the destination or the origin blocks the thread, so the shell veils it */
  heavy?: boolean;
}

/**
 * Five legs: a descend, its exact ascend, a sibling slide, and both directions
 * through the heaviest route in the menu tree.
 *
 * `collection` is the heavy one and it is in here twice on purpose. Entering it
 * builds 245 card canvases and leaving it tears them down, and it was *leaving*
 * that produced the measurement this file was written after — the most-pressed
 * control in the menu tree drawing not one frame of its own transition.
 */
const LEGS: readonly Leg[] = [
  { from: "lobby", to: "missions" },
  { from: "missions", to: "lobby" },
  { from: "missions", to: "mastery" },
  { from: "lobby", to: "collection", heavy: true },
  { from: "collection", to: "lobby", heavy: true },
];

/**
 * ## Every leg is measured **warm**, and that is the whole of the flake fix
 *
 * This suite failed about two runs in five and every one of the failures was one
 * of two shapes: a >200ms unobserved window on a leg with no veil, or an
 * exchange over the 420ms budget. Both were real, both were reproducible, and
 * neither was about the transition.
 *
 * What they were about is that a leg's *first* execution in a document pays
 * costs that belong to nothing this file is asserting on. The dev server
 * transforms each route's module graph on demand, so a cold `#missions` is a
 * network round trip and a compile before a single line of screen code runs. The
 * card renderer's own tile cache is empty. And `Shell` keeps its build and
 * teardown stopwatches in instance fields, so on a cold document *every* route
 * is an unmeasured route and the veil decision is made from the table's prior
 * rather than from what the machine actually did — which means whether a given
 * leg is covered depended on how many times an earlier leg had happened to run,
 * including its retries.
 *
 * So: walk every route the suite touches, twice, before arming any probe. It
 * costs about eight seconds once and it removes the compile, the cold raster and
 * the unmeasured-route branch from all seven assertions at the same time. What
 * is left in the trace is the transition, which is the only thing here claims to
 * be about.
 *
 * The cold path is not simply discarded — see `FIRST_VISIT` below, which asserts
 * on it deliberately and separately, on a document of its own.
 */
const ROUTES_TOUCHED = ["lobby", "missions", "mastery", "collection", "play"] as const;

/**
 * The one leg that is measured **cold**, on a document nothing has touched.
 *
 * The shell covers a route it has no measurement for, and clears that cover once
 * it has one — so the two states are different guarantees and both need saying.
 * This is the first: a first visit to the Collection, on a fresh page, must be
 * covered, because a cold `#collection` genuinely blocks the thread (measured at
 * 1280×720: fourteen long tasks totalling 1,259ms) and an uncovered stall of
 * that length is the defect this whole file exists to catch.
 *
 * `warmMustNotVeil` is the second and it is the one that would regress silently.
 * If somebody re-pins `heavy: true` as an unconditional flag — which is exactly
 * what the code did for three waves — every assertion above would still pass,
 * because a veiled leg is excused from the budget check *and* from the darkness
 * check. A cover that is always up makes this suite measure nothing, and that
 * has happened before: the note at `HEAVY_BUILD_MS` in `shell.ts` records the
 * round it survived by concealing itself.
 */
const FIRST_VISIT: Leg = { from: "lobby", to: "collection", heavy: true };

/**
 * The legs that get photographed as well as probed, and why photographing them
 * is not the same check twice.
 *
 * Everything above this line reads the DOM. The DOM said this screen was fine.
 * `nav-descend-out` bottoms out at `opacity: 0.12` — a deliberate fix, so that a
 * held outgoing screen is still *an image* rather than a hole — and `VISIBLE` is
 * 0.05, so a frame containing one screen at 12% over a dark atmosphere counts as
 * drawn. Composited, that frame was measured at mean luminance 19.7 with a 95th
 * percentile pixel of 35.6, against 41.8/148.6 for the lobby it left: black, on
 * a real click of the front door's PLAY button, three frames running. Four
 * rounds of review passed it because every instrument in this file was pointed
 * at the tree rather than at the picture.
 *
 * So these legs are also filmed, with `Page.startScreencast`, which returns what
 * the compositor actually put on the glass. Both endpoints are unveiled by
 * design — a curtain is allowed to be dark, that is what a curtain is — and the
 * film is discarded if one appears, rather than being quietly excused.
 */
const FILMS: readonly Leg[] = [
  { from: "lobby", to: "play" },
  { from: "missions", to: "lobby" },
];

/**
 * How dark a frame may get, as a fraction of the dimmer of the two screens it is
 * between.
 *
 * Measured on this machine after the exit keyframe was given its 0.12 floor: the
 * darkest frame of `lobby → play` sits at 85% of the reference by mean and 73%
 * by 95th percentile. The defect this replaces sat at 45% and **23%**. Half is
 * therefore a long way from both — it cannot be tripped by an honest transition
 * that dips, and it cannot be satisfied by a frame nobody can see.
 *
 * The 95th percentile is the load-bearing one. A mean survives a screen going
 * dark if anything at all is still bright; the p95 is asking "is there a
 * highlight anywhere in this picture", which is exactly what a blank frame does
 * not have.
 */
const LIT_MEAN = 0.5;
const LIT_P95 = 0.5;

interface Photo {
  t: number;
  mean: number;
  p95: number;
}
interface Film {
  frames: Photo[];
  /** a veil appeared during the film, so its darkness is not this test's business */
  veiled: boolean;
}

let browser: Browser | undefined;
let page: Page | undefined;
/** Load events seen since the current leg armed its probe. See the retry note below. */
let reloads = 0;
const traces = new Map<string, Trace>();
/** A second capture, taken only for a leg whose first one had a blind spot. */
const retakes = new Map<string, Trace>();
const films = new Map<string, Film>();
/** Was the first visit to a heavy route covered, and the warm ones not? */
const veilOnFirstVisit: boolean[] = [];
const veilWhenWarm: boolean[] = [];

const key = (leg: Leg): string => `${leg.from} → ${leg.to}`;

/**
 * A reload happened underneath us, whether or not the `load` event has landed.
 *
 * Playwright rejects an in-flight `evaluate` with "Execution context was
 * destroyed" and the `load` event that would set `reloads` races that rejection
 * — and loses often enough that the retry loop used to rethrow a reload as a
 * genuine failure. That is one of the two flake shapes this file had.
 */
const isReload = (error: unknown): boolean =>
  /Execution context was destroyed|Target closed|frame was detached|Navigation to/i.test(String(error));

describe.skipIf(REASON !== null)("never a blank frame", () => {
  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: BROWSERS.find((path) => existsSync(path)),
      headless: true,
      // The same two decisions `scripts/shot.mjs` makes, for the same reasons —
      // see tests/camera-truth.test.ts. A software rasteriser would make every
      // timing below meaningless.
      ignoreDefaultArgs: ["--hide-scrollbars"],
      args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
    });
    page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on("load", () => {
      reloads += 1;
    });
    // A brand-new account owns nothing and is bounced to the starter picker, and
    // an empty collection is not the heavy route this file needs to measure.
    await seedPlayedAccount(page);

    /**
     * Wait until `id` is the only screen in the document and has stopped moving.
     *
     * Naming the screen matters more than it looks. The departure screen is
     * already alone and already settled at the instant the probe goes in, so a
     * condition that only asked "is one screen settled?" would be satisfied
     * before the navigation had begun — every trace five frames long, every
     * assertion below true and meaningless.
     */
    const settled = async (target: Page, id: string, timeout: number): Promise<boolean> =>
      target
        .waitForFunction(
          (name: string) => {
            const screens = document.querySelectorAll<HTMLElement>(".screen");
            const only = screens[0];
            return (
              screens.length === 1 &&
              only !== undefined &&
              only.dataset["nav"] === "settled" &&
              only.classList.contains(name)
            );
          },
          `${id}-screen`,
          { timeout }
        )
        .then(
          () => true,
          () => false
        );

    /**
     * Pay every one-time cost in the document before anything is measured.
     *
     * Two passes over every route the suite touches, going out through the hub
     * each time so both directions of every leg are exercised. The first pass
     * pays the dev server's on-demand compile and the card renderer's cold
     * raster; the second gives `Shell` a build *and* a teardown sample for each
     * route, which is what its veil decision is actually made from. Nothing is
     * probed and nothing is asserted here — this is the difference between
     * measuring a transition and measuring a module graph arriving.
     */
    const warmRoutes = async (target: Page): Promise<void> => {
      for (let pass = 0; pass < 2; pass += 1) {
        for (const route of ROUTES_TOUCHED) {
          if (route === "lobby") continue;
          for (const hash of [route, "lobby"]) {
            await target.evaluate((h) => {
              location.hash = h;
            }, `#${hash}`);
            await settled(target, hash, 40000);
            // the veil outlives the settle on a covered leg, and a leg that
            // starts under somebody else's cover is not the leg it says it is
            await target
              .waitForFunction(() => document.querySelector(".nav-curtain") === null, null, { timeout: 8000 })
              .catch(() => undefined);
            await target.waitForTimeout(160);
          }
        }
      }
    };

    /**
     * `fresh` reloads the document first, which is the only way to ask for a
     * *first* visit: `Shell`'s stopwatches are instance fields, so nothing short
     * of a new document puts a route back into the "never measured" state.
     * Everything else runs warm, deliberately — see `ROUTES_TOUCHED`.
     */
    const capture = async (leg: Leg, options: { fresh?: boolean } = {}): Promise<Trace> => {
      const target = page as Page;
      if (options.fresh === true) {
        await target.goto(`${ORIGIN}/#${leg.from}`, { waitUntil: "networkidle" });
        await target.reload({ waitUntil: "networkidle" });
      } else {
        await target.goto(`${ORIGIN}/#${leg.from}`, { waitUntil: "networkidle" });
      }
      // The departure has to be the screen we think it is and it has to be at
      // rest, or the leg measures something other than the relationship it was
      // chosen for — and the previous leg's settle bleeding into this one's
      // trace is the specific way that goes wrong.
      const ready = await settled(target, leg.from, 40000);
      expect(ready, `${key(leg)} never came to rest on ${leg.from}`).toBe(true);
      if (options.fresh !== true) await warmRoutes(target);
      /**
       * And back to the departure, at rest, with no cover left standing. A leg
       * that begins while the previous navigation's veil is still up records a
       * `curtain` on its first frames and excuses itself from the budget and the
       * darkness checks — which is how a suite can pass by measuring nothing.
       */
      await target.evaluate((hash) => {
        location.hash = hash;
      }, `#${leg.from}`);
      await settled(target, leg.from, 40000);
      await target
        .waitForFunction(() => document.querySelector(".nav-curtain") === null, null, { timeout: 8000 })
        .catch(() => undefined);
      await target.waitForTimeout(400);

      // From here to the collection, any load event is a reload that happened
      // underneath the probe rather than one this test asked for.
      reloads = 0;
      await target.evaluate(installProbe);
      await target.evaluate((hash) => {
        location.hash = hash;
      }, `#${leg.to}`);

      const arrived = await settled(target, leg.to, 40000);
      expect(arrived, `${key(leg)} never came to rest on ${leg.to}`).toBe(true);
      await target.waitForTimeout(260);

      return target.evaluate(() => {
        const scope = window as unknown as { __navProbe?: Trace & { running: boolean } };
        if (scope.__navProbe === undefined) return { frames: [], events: [] };
        scope.__navProbe.running = false;
        return { frames: scope.__navProbe.frames, events: scope.__navProbe.events };
      });
    };

    /**
     * Retried, and only when the page reloaded underneath the probe.
     *
     * This drives a **live** Vite dev server that other people are working
     * against, and an edit to any source file pushes `{"type":"full-reload"}`
     * down the HMR socket. Caught in the middle of a leg that wipes the probe,
     * or destroys the execution context outright. Measured while writing this:
     * two unrelated reloads inside sixty seconds, triggered by
     * `src/ui/battle/scene.ts` and `src/ui/screens/queueScreen.ts`.
     *
     * That is an artefact of the instrument and re-running the leg is the honest
     * answer to it — as against widening a threshold until the artefact stops
     * mattering, which is how a guard turns into decoration. A leg that reloads
     * three times in a row is reported as an empty trace and fails on its own
     * terms below rather than being quietly accepted.
     */
    /**
     * The cold half, first and on its own document, because everything after it
     * deliberately warms the one it runs in.
     *
     * Two round trips: the first visit must be covered, and the visit after it —
     * once the shell has a build and a teardown sample for the route — must not
     * be. Recorded rather than asserted here so a reload retry cannot leave the
     * assertion looking at nothing.
     */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const cold = await capture(FIRST_VISIT, { fresh: true });
        if (cold.frames.length === 0 || reloads !== 0) continue;
        veilOnFirstVisit.push(cold.frames.some((f) => f.curtain !== null && f.curtain >= COVERED));
        // back out and in again, on the same document, now that it is measured
        const again = await capture(FIRST_VISIT);
        if (again.frames.length === 0 || reloads !== 0) continue;
        veilWhenWarm.push(again.frames.some((f) => f.curtain !== null && f.curtain >= COVERED));
        break;
      } catch (error) {
        if (!isReload(error) && reloads === 0) throw error;
      }
    }

    /**
     * ## A blind spot is reported when it **reproduces**, not when it happens
     *
     * The 200ms threshold does not move — widening a threshold until an artefact
     * stops mattering is how a guard turns into decoration, and this file says so
     * about its own retry logic three paragraphs up. What changes is how many
     * samples a claim is made from.
     *
     * Measured, on this machine, over four consecutive runs: a warm
     * `lobby → collection` produced worst rAF gaps of 147, 155, 182 and **227**
     * milliseconds. `scripts/_w7leg_walk.mjs`, walking the identical leg six
     * times in one document with and without this file's per-frame probe
     * attached, reported 80–98ms every time in both arms — so the outlier is not
     * the probe's forced layout and not a property of the transition. It is one
     * unlucky frame in an eight-hundred-millisecond window, and a suite that
     * fails two runs in five on it is a suite people learn to re-run.
     *
     * A genuine stall does not behave like that. The defects this assertion was
     * written for — a 588ms constructor with nothing over it, a 3,279ms gap on
     * `lobby → collection` — are properties of the code and appear on every
     * capture. So a leg whose first trace has a blind spot is captured again, and
     * the assertion below reports one only if **every** trace for that leg has
     * one. Both traces are kept and both are printed, so a leg that is
     * intermittently bad is visible in the report even when it passes.
     */
    const blindSpots = (trace: Trace): number => {
      let count = 0;
      for (let i = 1; i < trace.frames.length; i += 1) {
        const before = trace.frames[i - 1] as FrameSample;
        const after = trace.frames[i] as FrameSample;
        if (after.t - before.t <= OBSERVABLE) continue;
        const veiled = (f: FrameSample): boolean => f.curtain !== null && f.curtain >= COVERED;
        if (veiled(before) && veiled(after)) continue;
        count += 1;
      }
      return count;
    };

    for (const leg of LEGS) {
      const kept: Trace[] = [];
      for (let take = 0; take < 2; take += 1) {
        let trace: Trace = { frames: [], events: [] };
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const candidate = await capture(leg);
            if (candidate.frames.length > 0 && reloads === 0) {
              trace = candidate;
              break;
            }
          } catch (error) {
            if (!isReload(error) && reloads === 0) throw error;
          }
        }
        kept.push(trace);
        // one capture is enough unless it saw something worth confirming
        if (blindSpots(trace) === 0) break;
      }
      traces.set(key(leg), kept[0] as Trace);
      if (kept.length > 1) retakes.set(key(leg), kept[1] as Trace);
    }

    /**
     * The same navigation, photographed rather than inspected.
     *
     * The screencast is capped at 640px wide because every frame is decoded and
     * reduced inside the page and the statistics are scale-invariant; at full
     * size the decode is slower than the thing being measured, which is how an
     * instrument starts changing its subject. A `MutationObserver` watches for a
     * curtain instead of a per-frame probe for the same reason — it costs
     * nothing while the thread is free and still reports the veil afterwards
     * when the thread was not.
     */
    const film = async (leg: Leg): Promise<Film> => {
      const target = page as Page;
      await target.goto(`${ORIGIN}/#${leg.from}`, { waitUntil: "networkidle" });
      const ready = await settled(target, leg.from, 40000);
      expect(ready, `${key(leg)} never came to rest on ${leg.from} before filming`).toBe(true);
      // Same reasoning as `capture`: a cold module graph is not a transition.
      await warmRoutes(target);
      await target.evaluate((hash) => {
        location.hash = hash;
      }, `#${leg.from}`);
      await settled(target, leg.from, 40000);
      await target
        .waitForFunction(() => document.querySelector(".nav-curtain") === null, null, { timeout: 8000 })
        .catch(() => undefined);
      await target.waitForTimeout(400);

      const session = await target.context().newCDPSession(target);
      const shots: { t: number; data: string }[] = [];
      session.on("Page.screencastFrame", (payload) => {
        const frame = payload as unknown as { data: string; sessionId: number; metadata: { timestamp?: number } };
        shots.push({ t: frame.metadata.timestamp ?? 0, data: frame.data });
        void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
      });

      await target.evaluate(() => {
        const scope = window as unknown as { __veiled?: boolean };
        scope.__veiled = document.querySelector(".nav-curtain") !== null;
        new MutationObserver(() => {
          if (document.querySelector(".nav-curtain") !== null) scope.__veiled = true;
        }).observe(document.body, { childList: true, subtree: true });
      });

      await session.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 640, maxHeight: 400 });
      await target.evaluate((hash) => {
        location.hash = hash;
      }, `#${leg.to}`);
      await settled(target, leg.to, 40000);
      await target.waitForTimeout(300);
      await session.send("Page.stopScreencast");

      const veiled = await target.evaluate(() => (window as unknown as { __veiled?: boolean }).__veiled === true);
      const base = shots.length === 0 ? 0 : (shots[0] as { t: number }).t;
      const frames = await target.evaluate(async (list: { t: number; data: string }[]) => {
        const out: { t: number; mean: number; p95: number }[] = [];
        for (const shot of list) {
          const image = new Image();
          image.src = `data:image/jpeg;base64,${shot.data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const pen = canvas.getContext("2d", { willReadFrequently: true });
          if (pen === null) continue;
          pen.drawImage(image, 0, 0);
          const px = pen.getImageData(0, 0, canvas.width, canvas.height).data;
          const lum = new Float32Array(px.length / 4);
          let sum = 0;
          for (let i = 0, p = 0; i < px.length; i += 4, p += 1) {
            const v = 0.2126 * (px[i] as number) + 0.7152 * (px[i + 1] as number) + 0.0722 * (px[i + 2] as number);
            lum[p] = v;
            sum += v;
          }
          const sorted = Float32Array.from(lum).sort();
          out.push({
            t: shot.t,
            mean: sum / lum.length,
            p95: sorted[Math.floor(0.95 * sorted.length)] as number,
          });
        }
        return out;
      }, shots);

      await session.detach().catch(() => undefined);
      return { veiled, frames: frames.map((f) => ({ ...f, t: Math.round((f.t - base) * 1000) })) };
    };

    for (const leg of FILMS) {
      let reel: Film = { frames: [], veiled: false };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        reloads = 0;
        try {
          const candidate = await film(leg);
          if (candidate.frames.length > 8 && reloads === 0) {
            reel = candidate;
            break;
          }
        } catch (error) {
          if (!isReload(error) && reloads === 0) throw error;
        }
      }
      films.set(key(leg), reel);
    }
  }, 900_000);

  afterAll(async () => {
    await browser?.close();
  });

  const trace = (leg: Leg): Trace => {
    const found = traces.get(key(leg));
    if (found === undefined) throw new Error(`no trace captured for ${key(leg)}`);
    return found;
  };

  const drawn = (frame: FrameSample): boolean =>
    frame.screens.some((s) => s.opacity > VISIBLE && s.width > 0 && s.height > 0 && !s.hidden);
  const covered = (frame: FrameSample): boolean => frame.curtain !== null && frame.curtain >= COVERED;

  it("captured a trace for every leg", () => {
    // The rest of this suite reads these traces. An empty one would make every
    // assertion below pass by having nothing to look at.
    for (const leg of LEGS) {
      const { frames, events } = trace(leg);
      expect(frames.length, `${key(leg)} sampled no frames at all`).toBeGreaterThan(2);
      expect(events.length, `${key(leg)} recorded no animation events at all`).toBeGreaterThan(0);
    }
  });

  it("draws something on every frame it sampled", () => {
    const holes: string[] = [];
    for (const leg of LEGS) {
      for (const frame of trace(leg).frames) {
        if (drawn(frame) || covered(frame)) continue;
        holes.push(
          `${key(leg)} at t=${frame.t}ms — ${frame.screens.length} screen(s): ` +
            `${frame.screens.map((s) => `${s.id}[${s.nav}] opacity ${s.opacity.toFixed(3)}`).join(", ") || "none"}` +
            `, curtain ${frame.curtain === null ? "absent" : frame.curtain.toFixed(2)}`
        );
      }
    }
    expect(holes, "a frame containing neither a screen nor a veil is bare atmosphere").toEqual([]);
  });

  /**
   * And it must have been looking. Every unobserved stretch longer than
   * `OBSERVABLE` has to be bracketed by a raised curtain, because otherwise the
   * previous assertion is a statement about frames nobody sampled.
   */
  it("never looks away from an uncovered navigation", () => {
    const spotsIn = (frames: readonly FrameSample[], label: string): string[] => {
      const found: string[] = [];
      for (let i = 1; i < frames.length; i += 1) {
        const before = frames[i - 1] as FrameSample;
        const after = frames[i] as FrameSample;
        const gap = after.t - before.t;
        if (gap <= OBSERVABLE) continue;
        if (covered(before) && covered(after)) continue;
        found.push(
          `${label} — ${gap}ms unsampled between t=${before.t} and t=${after.t} with no veil up ` +
            `(curtain ${before.curtain ?? "absent"} → ${after.curtain ?? "absent"})`
        );
      }
      return found;
    };

    const blind: string[] = [];
    for (const leg of LEGS) {
      const first = spotsIn(trace(leg).frames, key(leg));
      if (first.length === 0) continue;
      const second = retakes.get(key(leg));
      // No retake means the first pass was clean and this leg never got here.
      // A retake with nothing in it means the block did not reproduce.
      const again = second === undefined ? first : spotsIn(second.frames, `${key(leg)} (retake)`);
      if (again.length === 0) {
        console.log(`  a blind spot on ${key(leg)} did not reproduce on a second capture:\n    ${first.join("\n    ")}`);
        continue;
      }
      blind.push(...first, ...again);
    }
    expect(
      blind,
      "the main thread blocked in the open on two independent captures; that window is where the hole was found"
    ).toEqual([]);
  });

  /**
   * The exchange, measured off the browser's own animation events: the first
   * frame of the outgoing screen's exit to the last frame of the incoming
   * screen's entrance. `nav-child-rise` and the arrival sheen are deliberately
   * not counted — §3a budgets the transition between two screens and asks
   * separately for the contents to cascade in behind it.
   */
  it("finishes an uncovered exchange inside the 420ms budget", () => {
    const overruns: string[] = [];
    for (const leg of LEGS) {
      const { frames, events } = trace(leg);
      if (frames.some(covered)) continue; // covered: see the note on this file
      const exit = events.find((e) => e.type === "animationstart" && /^nav-[a-z]+-out$/.test(e.name));
      const entrances = events.filter((e) => e.type === "animationend" && /^nav-[a-z]+-in$/.test(e.name));
      expect(exit, `${key(leg)} never started an exit animation`).toBeDefined();
      expect(entrances.length, `${key(leg)} never finished an entrance animation`).toBeGreaterThan(0);
      const last = entrances[entrances.length - 1] as AnimationRecord;
      const span = last.t - (exit as AnimationRecord).t;
      if (span > BUDGET + SAMPLING_SLACK) {
        overruns.push(`${key(leg)} — ${span}ms from ${exit?.name} to the end of ${last.name} (budget ${BUDGET}ms)`);
      }
    }
    expect(overruns).toEqual([]);
  });

  /**
   * Both ends of the exchange have to move.
   *
   * The destination always animates. The departure animates too, unless the
   * navigation is veiled — behind an opaque curtain the exit is not visible and
   * the shell does not always get a frame for it — in which case the curtain
   * itself has to be the thing that moved, so that *something* is animating at
   * every moment of every navigation.
   */
  it("animates both endpoints of every exchange", () => {
    const still: string[] = [];
    for (const leg of LEGS) {
      const { frames, events } = trace(leg);
      const started = events.filter((e) => e.type === "animationstart");
      const incoming = started.filter((e) => e.screen === leg.to && e.name.startsWith("nav-"));
      const outgoing = started.filter((e) => e.screen === leg.from && e.name.startsWith("nav-"));
      const veil = started.filter((e) => e.name.startsWith("nav-curtain"));

      if (incoming.length === 0) still.push(`${key(leg)} — the arriving ${leg.to} ran no nav animation`);
      if (outgoing.length === 0 && !(frames.some(covered) && veil.length > 0)) {
        still.push(`${key(leg)} — the departing ${leg.from} ran no nav animation and nothing covered it`);
      }
    }
    expect(still, "a transition that never starts looks exactly like one that finished instantly").toEqual([]);
  });

  /**
   * ## The cover is a response to a measurement, and both directions of that
   * have to be asserted
   *
   * This used to read "veils a heavy leg in both directions", which was the
   * wave-4 fix written down as a test and is now half a rule. `heavy` is not a
   * property of a route; it is a property of a *visit*. A route the shell has
   * never built and never torn down is one it has no measurement for, and
   * covering it is right. A route it has measured at 109ms in and 41ms out is one
   * where the cover is the wait — filmed at 1280×720, the veil on a warm
   * `lobby → collection` was up for 562ms over a screen that had been in the
   * document since t=109ms.
   *
   * The second assertion is the load-bearing one and it is here because of how
   * this suite fails. **A veiled leg is excused from the budget check and from
   * the darkness check.** So a cover that is always up does not make this file
   * fail; it makes it stop measuring, silently, which is what happened for three
   * waves and is recorded at `HEAVY_BUILD_MS` in `shell.ts`. If somebody pins the
   * flag back on, this is the only thing in the repository that notices.
   */
  it("covers the first visit to a heavy route, and stops covering it once measured", () => {
    expect(
      veilOnFirstVisit.length,
      "the cold capture never produced a usable trace, so neither half of this was measured"
    ).toBeGreaterThan(0);
    expect(veilOnFirstVisit[0], `the first visit to ${key(FIRST_VISIT)} ran with no cover`).toBe(true);
    expect(veilWhenWarm.length, "the warm capture never produced a usable trace").toBeGreaterThan(0);
    expect(
      veilWhenWarm[0],
      `${key(FIRST_VISIT)} was still covered after the shell had measured the route in both ` +
        `directions. A permanent cover excuses this suite's budget and darkness checks, so it does ` +
        `not fail loudly — it stops measuring.`
    ).toBe(false);
  });

  const reel = (leg: Leg): Film => {
    const found = films.get(key(leg));
    if (found === undefined) throw new Error(`no film captured for ${key(leg)}`);
    return found;
  };

  /** The endpoints of the film, as the brightness a frame in between is judged against. */
  const ends = (frames: readonly Photo[], pick: (p: Photo) => number): number => {
    const head = frames.slice(0, 3).map(pick).sort((a, b) => a - b);
    const tail = frames.slice(-3).map(pick).sort((a, b) => a - b);
    return Math.min(head[Math.floor(head.length / 2)] ?? 0, tail[Math.floor(tail.length / 2)] ?? 0);
  };

  it("filmed every navigation it said it would", () => {
    for (const leg of FILMS) {
      expect(reel(leg).frames.length, `${key(leg)} produced no compositor frames`).toBeGreaterThan(8);
    }
    /**
     * A veil is allowed to be dark — covering a load deliberately is the
     * contract's own answer to a build that cannot be made fast, and the
     * assertion below therefore skips a veiled film. What it may not do is skip
     * *every* film, because then the pixel check would be passing by having
     * nothing to look at. If the shell starts veiling both of these, add a leg
     * that it does not.
     */
    expect(
      FILMS.some((leg) => !reel(leg).veiled),
      "every filmed leg raised a curtain, so the darkness check measured nothing"
    ).toBe(true);
  });

  /**
   * The picture, not the tree.
   *
   * Every frame the compositor produced has to be at least half as bright as the
   * dimmer of the two screens the navigation runs between — by mean, and by the
   * brightest 5% of its pixels. §3a: "no moment where neither screen is drawn,
   * and no moment where the page background flashes through". A screen held at
   * `opacity: 0.12` over a dark atmosphere satisfies the DOM and fails this.
   */
  it("never puts a dark frame on the glass", () => {
    const blackouts: string[] = [];
    for (const leg of FILMS) {
      const { frames, veiled } = reel(leg);
      if (frames.length === 0 || veiled) continue;
      const meanRef = ends(frames, (p) => p.mean);
      const p95Ref = ends(frames, (p) => p.p95);
      for (const frame of frames) {
        const dimMean = frame.mean < meanRef * LIT_MEAN;
        const dimP95 = frame.p95 < p95Ref * LIT_P95;
        if (!dimMean && !dimP95) continue;
        blackouts.push(
          `${key(leg)} at t=${frame.t}ms — mean ${frame.mean.toFixed(1)} (${((100 * frame.mean) / meanRef).toFixed(0)}% ` +
            `of ${meanRef.toFixed(1)}), p95 ${frame.p95.toFixed(1)} (${((100 * frame.p95) / p95Ref).toFixed(0)}% of ` +
            `${p95Ref.toFixed(1)})`
        );
      }
    }
    expect(
      blackouts,
      "a frame this dark is the page background showing through between two screens; the DOM probe cannot see it " +
        "because a screen at opacity 0.12 still counts as present"
    ).toEqual([]);
  });

  /** Printed on success as well as failure — the trace is the evidence. */
  it("reports what it measured", () => {
    const rows = LEGS.map((leg) => {
      const { frames, events } = trace(leg);
      const gaps = frames.slice(1).map((f, i) => f.t - (frames[i] as FrameSample).t);
      const worst = gaps.length === 0 ? 0 : Math.max(...gaps);
      const floor = Math.min(...frames.map((f) => Math.max(0, ...f.screens.map((s) => s.opacity))));
      const exit = events.find((e) => e.type === "animationstart" && /^nav-[a-z]+-out$/.test(e.name));
      const ends = events.filter((e) => e.type === "animationend" && /^nav-[a-z]+-in$/.test(e.name));
      const span =
        exit === undefined || ends.length === 0 ? "n/a" : `${(ends[ends.length - 1] as AnimationRecord).t - exit.t}ms`;
      const retake = retakes.get(key(leg));
      const retakeGaps = retake?.frames.slice(1).map((f, i) => f.t - (retake.frames[i] as FrameSample).t) ?? [];
      return (
        `  ${key(leg).padEnd(24)} frames ${String(frames.length).padStart(4)}  worst gap ${String(worst).padStart(5)}ms  ` +
        `min opacity ${floor.toFixed(2)}  exchange ${span.padStart(7)}  ` +
        `veiled ${frames.some(covered) ? "yes" : "no "}  events ${events.length}` +
        (retake === undefined
          ? ""
          : `  [retaken: worst gap ${retakeGaps.length === 0 ? "n/a" : `${Math.max(...retakeGaps)}ms`}]`)
      );
    });
    const films = FILMS.map((leg) => {
      const { frames } = reel(leg);
      if (frames.length === 0) return `  ${key(leg).padEnd(24)} no film`;
      const meanRef = ends(frames, (p) => p.mean);
      const p95Ref = ends(frames, (p) => p.p95);
      const worst = frames.reduce((a, b) => (b.p95 < a.p95 ? b : a), frames[0] as Photo);
      return (
        `  ${key(leg).padEnd(24)} frames ${String(frames.length).padStart(4)}  ` +
        `reference mean ${meanRef.toFixed(1)} p95 ${p95Ref.toFixed(1)}  ` +
        `darkest t=${String(worst.t).padStart(5)}ms mean ${worst.mean.toFixed(1)} ` +
        `(${((100 * worst.mean) / meanRef).toFixed(0)}%) p95 ${worst.p95.toFixed(1)} ` +
        `(${((100 * worst.p95) / p95Ref).toFixed(0)}%)`
      );
    });
    console.log(`\nnavigation traces\n${rows.join("\n")}\n\ncompositor films\n${films.join("\n")}`);
    expect(rows.length).toBe(LEGS.length);
  });
});
