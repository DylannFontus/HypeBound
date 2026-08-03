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

let browser: Browser | undefined;
let page: Page | undefined;
/** Load events seen since the current leg armed its probe. See the retry note below. */
let reloads = 0;
const traces = new Map<string, Trace>();

const key = (leg: Leg): string => `${leg.from} → ${leg.to}`;

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

    const capture = async (leg: Leg): Promise<Trace> => {
      const target = page as Page;
      await target.goto(`${ORIGIN}/#${leg.from}`, { waitUntil: "networkidle" });
      // The departure has to be the screen we think it is and it has to be at
      // rest, or the leg measures something other than the relationship it was
      // chosen for — and the previous leg's settle bleeding into this one's
      // trace is the specific way that goes wrong.
      const ready = await settled(target, leg.from, 40000);
      expect(ready, `${key(leg)} never came to rest on ${leg.from}`).toBe(true);
      await target.waitForTimeout(400);

      // From here to the collection, any load event is a reload that happened
      // underneath the probe rather than one this test asked for.
      reloads = 0;
      await target.evaluate(installProbe);
      await target.evaluate((hash) => {
        location.hash = hash;
      }, `#${leg.to}`);

      await settled(target, leg.to, 40000);
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
    for (const leg of LEGS) {
      let trace: Trace = { frames: [], events: [] };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const candidate = await capture(leg);
          if (candidate.frames.length > 0 && reloads === 0) {
            trace = candidate;
            break;
          }
        } catch (error) {
          if (reloads === 0) throw error;
        }
      }
      traces.set(key(leg), trace);
    }
  }, 420_000);

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
    const blind: string[] = [];
    for (const leg of LEGS) {
      const { frames } = trace(leg);
      for (let i = 1; i < frames.length; i += 1) {
        const before = frames[i - 1] as FrameSample;
        const after = frames[i] as FrameSample;
        const gap = after.t - before.t;
        if (gap <= OBSERVABLE) continue;
        if (covered(before) && covered(after)) continue;
        blind.push(
          `${key(leg)} — ${gap}ms unsampled between t=${before.t} and t=${after.t} with no veil up ` +
            `(curtain ${before.curtain ?? "absent"} → ${after.curtain ?? "absent"})`
        );
      }
    }
    expect(blind, "the main thread blocked in the open; that window is where the hole was found").toEqual([]);
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
   * The heavy legs get one extra requirement, and it is the round-4 fix stated
   * as a test: the shell must veil when *either* endpoint is expensive. Asking
   * only about the destination is what left Back-out-of-the-collection
   * unprotected.
   */
  it("veils a heavy leg in both directions", () => {
    for (const leg of LEGS.filter((l) => l.heavy === true)) {
      expect(trace(leg).frames.some(covered), `${key(leg)} ran without a veil`).toBe(true);
    }
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
      return (
        `  ${key(leg).padEnd(24)} frames ${String(frames.length).padStart(4)}  worst gap ${String(worst).padStart(5)}ms  ` +
        `min opacity ${floor.toFixed(2)}  exchange ${span.padStart(7)}  ` +
        `veiled ${frames.some(covered) ? "yes" : "no "}  events ${events.length}`
      );
    });
    console.log(`\nnavigation traces\n${rows.join("\n")}`);
    expect(rows.length).toBe(LEGS.length);
  });
});
