/**
 * The clock every animation in HYPEBOUND runs on, and the curves it runs along.
 *
 * Three separate problems forced this file into existence. None of them is
 * obvious from the outside, and all three get worse the more people are
 * building at once, which is exactly the situation.
 *
 * ## 1. A canvas cannot read a custom property
 *
 * `base.css` has had `--dur-med` and `--ease-out` for as long as the project
 * has existed, and the DOM screens use them properly. The battle board does
 * not, because it cannot: three.js and 2D canvas animate in JavaScript, where a
 * CSS variable is a string you would have to `getComputedStyle` for — a layout
 * read, once per frame, to fetch a constant. So every canvas animation in the
 * game picked its own numbers, and the board now eases differently from the
 * menu sitting on top of it. The tokens below are the same tokens, in the form
 * the other half of the renderer can actually use, and `foundation.css` mirrors
 * them back the other way so there is one set of values rather than two that
 * drift.
 *
 * ## 2. Fifteen builders means fifteen `requestAnimationFrame` loops
 *
 * Every ambient shimmer, mote field, ticker and specular sweep wants a frame
 * callback. Started independently, each one is its own rAF chain, each one
 * keeps running when the tab is in the background, and each one costs a
 * scheduler wake-up on a phone that is trying to hold 30fps. `onMotionFrame`
 * is one loop, shared, that stops dead when the page is hidden and hands every
 * subscriber a clamped delta so nothing teleports when it comes back.
 *
 * ## 3. Reduced motion has to mean the same thing in JS as it does in CSS
 *
 * The setting already works: `applySettings` writes `data-reduced-motion` onto
 * the root element and `base.css` keys off it. What did not exist was any way
 * for a canvas effect to ask the same question and get the same answer. A board
 * that keeps swirling while the DOM around it has gone still is arguably worse
 * than one that never respected the setting, because the player turned it on
 * and it half-worked.
 *
 * ## Units
 *
 * **Everything in this module is milliseconds.** `DUR` is milliseconds because
 * CSS is; the frame delta is milliseconds so that it sits next to `DUR` in the
 * same expression without a conversion nobody remembers. three.js callers who
 * want seconds divide by 1000 at the boundary — one visible division beats two
 * time units loose in the same file.
 */

import { animationScale, getSettings, settingsStore } from "../save/settings";
import { num } from "./format";

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

/** A CSS `cubic-bezier` as four control-point coordinates. */
export type Easing = readonly [number, number, number, number];

/**
 * The three durations, in milliseconds.
 *
 * Three, not seven, because the AAA bar's tiers are three: micro-feedback,
 * UI transition, set-piece. A fourth value always turns out to be one of these
 * with somebody's taste applied to it, and the cost of that taste is that two
 * adjacent panels animate at 240ms and 280ms and the screen feels slightly
 * out of time without anybody being able to point at why.
 *
 * Mirrored into `--dur-micro` / `--dur-ui` / `--dur-setpiece` by module A.
 */
export const DUR = { micro: 110, ui: 260, setpiece: 700 } as const;

/**
 * The three curves.
 *
 * - `arrive` — anything entering or settling. Fast out of the gate, long tail.
 * - `overshoot` — things the *player* caused. The tiny bounce past the target
 *   is what makes a click feel like it hit something. Never for ambient motion;
 *   an idle animation that overshoots reads as a glitch.
 * - `leave` — anything going away. Accelerating, because an exit that eases out
 *   is an exit the eye follows all the way, and you want it gone.
 *
 * Mirrored into `--ease-arrive` / `--ease-overshoot` / `--ease-leave`.
 */
export const EASE = {
  arrive: [0.2, 0.8, 0.2, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
  leave: [0.4, 0, 1, 1],
} as const satisfies Record<string, Easing>;

/**
 * `cubic-bezier(0.2, 0.8, 0.2, 1)` — the CSS spelling of a curve.
 *
 * For the places that set a transition from JavaScript. Without it every
 * builder writes the same template literal, and one of them transposes two
 * digits and produces a curve that is *nearly* right, which is the hardest
 * kind of wrong to spot.
 */
export const cssEase = (curve: Easing): string =>
  `cubic-bezier(${curve[0]}, ${curve[1]}, ${curve[2]}, ${curve[3]})`;

// ---------------------------------------------------------------------------
// the bezier evaluator
// ---------------------------------------------------------------------------

/*
 * Why this is not four lines.
 *
 * A CSS cubic-bezier is not `y = f(x)`. It is a parametric curve: x and y are
 * both cubics in a hidden parameter, and "the eased value at 40% of the
 * duration" means *find the parameter where x is 0.4, then read y there*.
 * Solving that inversion is the entire job, and the naive version — treating
 * the input as the parameter — is wrong by up to 20% in the middle of the
 * curve, which is precisely where the eye is looking.
 *
 * The method is the one browsers use: eleven pre-computed samples of x to
 * bracket the answer, then Newton-Raphson from that bracket, falling back to
 * bisection wherever the curve is too flat for Newton to converge (which it is,
 * at both ends of every ease). The sample table is why the returned closure is
 * built once and cached — this gets called per frame by things that will not
 * think about it.
 */

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;
const SAMPLE_COUNT = 11;
const SAMPLE_STEP = 1 / (SAMPLE_COUNT - 1);

const coefficientA = (a1: number, a2: number): number => 1 - 3 * a2 + 3 * a1;
const coefficientB = (a1: number, a2: number): number => 3 * a2 - 6 * a1;
const coefficientC = (a1: number): number => 3 * a1;

/** The cubic itself, in Horner form. */
const cubic = (t: number, a1: number, a2: number): number =>
  ((coefficientA(a1, a2) * t + coefficientB(a1, a2)) * t + coefficientC(a1)) * t;

/** Its derivative, which is what Newton needs. */
const cubicSlope = (t: number, a1: number, a2: number): number =>
  3 * coefficientA(a1, a2) * t * t + 2 * coefficientB(a1, a2) * t + coefficientC(a1);

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function buildBezier(curve: Easing): (t: number) => number {
  /*
   * x has to stay inside [0, 1] or the curve doubles back on itself and there
   * is no single parameter for a given x. The CSS spec says the same thing, and
   * a browser silently clamps rather than rejecting the declaration, so we
   * clamp too — a curve that behaves differently here than in a stylesheet
   * would defeat the whole point of sharing the numbers. y is left alone, which
   * is what allows `overshoot` to pass 1 on its way to 1.
   */
  const x1 = clamp01(curve[0]);
  const y1 = curve[1];
  const x2 = clamp01(curve[2]);
  const y2 = curve[3];

  // A straight line needs none of the machinery below, and `linear` is a real
  // curve that real callers pass (progress bars, and nothing else).
  if (x1 === y1 && x2 === y2) return clamp01;

  const samples = new Float64Array(SAMPLE_COUNT);
  for (let i = 0; i < SAMPLE_COUNT; i += 1) samples[i] = cubic(i * SAMPLE_STEP, x1, x2);

  function tForX(x: number): number {
    // Walk the sample table to find the interval x falls in.
    let interval = 0;
    while (interval < SAMPLE_COUNT - 1 && samples[interval + 1]! <= x) interval += 1;
    interval = Math.min(interval, SAMPLE_COUNT - 2);

    const start = samples[interval]!;
    const end = samples[interval + 1]!;
    const span = end - start;
    const guessBase = interval * SAMPLE_STEP;
    // A flat interval means every t in it maps to the same x; take the left end.
    const guess = span === 0 ? guessBase : guessBase + ((x - start) / span) * SAMPLE_STEP;

    const slope = cubicSlope(guess, x1, x2);
    if (slope >= NEWTON_MIN_SLOPE) {
      let t = guess;
      for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
        const derivative = cubicSlope(t, x1, x2);
        if (derivative === 0) return t;
        t -= (cubic(t, x1, x2) - x) / derivative;
      }
      return t;
    }
    if (slope === 0) return guessBase;

    // Too flat for Newton — bisect, which is slower but cannot diverge.
    let low = guessBase;
    let high = guessBase + SAMPLE_STEP;
    let t = x;
    for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i += 1) {
      t = low + (high - low) / 2;
      const error = cubic(t, x1, x2) - x;
      if (error > 0) high = t;
      else low = t;
      if (Math.abs(error) < SUBDIVISION_PRECISION) break;
    }
    return t;
  }

  return (t: number): number => {
    /*
     * The endpoints are returned as exact literals rather than computed.
     * Newton lands on 0.9999999 often enough that a final frame written from
     * it leaves an element at 99.99999% of its transform — invisible, until it
     * is a `translateY` that never quite reaches zero and the panel sits half
     * a thousandth of a pixel low forever, on the wrong side of a subpixel
     * boundary on exactly one display scale.
     */
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return cubic(tForX(t), y1, y2);
  };
}

const bezierCache = new Map<string, (t: number) => number>();

/**
 * The evaluator for a curve: `bezier(EASE.arrive)(0.4)`.
 *
 * Give it a progress in 0–1 and it returns the eased value — usually in 0–1,
 * deliberately outside it for `overshoot`. This is the function that lets a
 * three.js tween and a CSS transition describe the same movement, which is the
 * only reason `EASE` is exported as numbers rather than as strings.
 *
 * Memoised per curve, so calling it inside a frame loop is a `Map` lookup and
 * not eleven cubic evaluations.
 */
export function bezier(curve: Easing): (t: number) => number {
  const key = `${curve[0]},${curve[1]},${curve[2]},${curve[3]}`;
  let fn = bezierCache.get(key);
  if (!fn) {
    fn = buildBezier(curve);
    bezierCache.set(key, fn);
  }
  return fn;
}

// ---------------------------------------------------------------------------
// the reduced-motion guard
// ---------------------------------------------------------------------------

interface MotionSettings {
  reduced: boolean;
  scale: number;
}

let cachedSettings: MotionSettings | null = null;
let watchingSettings = false;

/**
 * The settings read, done once and then invalidated rather than repeated.
 *
 * There is an ordering trap here worth writing down. `updateSettings` calls
 * `settingsStore.set` — which notifies subscribers — and only *then* calls
 * `applySettings`, which writes the root element's attributes. So this listener
 * fires while the DOM still says the old thing. It therefore only ever drops
 * the cache; it never recomputes. The next caller recomputes, by which time
 * `applySettings` has run and both sources agree.
 */
function motionSettings(): MotionSettings {
  if (!watchingSettings) {
    watchingSettings = true;
    const off = settingsStore.subscribe(() => {
      cachedSettings = null;
    });
    void off; // kept for the lifetime of the page, deliberately
  }
  cachedSettings ??= { reduced: getSettings().reducedMotion, scale: animationScale() };
  return cachedSettings;
}

/**
 * What the document is currently telling CSS, or `null` if it has not been told.
 *
 * Cheap — an attribute read, no layout — and it is checked on every query
 * rather than cached, because it is the value the stylesheet is *actually*
 * obeying this frame. If the store and the root element could ever disagree,
 * the element has to win: a canvas that keeps moving while the DOM beside it
 * has stopped is the exact failure this guard exists to prevent.
 */
function rootReducedMotion(): boolean | null {
  if (typeof document === "undefined") return null;
  const flag = document.documentElement.dataset["reducedMotion"];
  if (flag === "true") return true;
  if (flag === "false") return false;
  return null;
}

/**
 * Should decorative motion happen at all?
 *
 * This is a question about *existence*, not speed. Ask it before starting an
 * ambient drift, a mote field, a specular sweep, a parallax response — anything
 * whose absence costs the player nothing. Do **not** ask it before a functional
 * animation: a progress bar still has to fill and a timer still has to run
 * down under reduced motion. Those use {@link scaledDuration}, which shortens
 * them instead of removing them.
 */
export function motionEnabled(): boolean {
  return !(rootReducedMotion() ?? motionSettings().reduced);
}

/** One frame at 60fps. Below this an animation is a single-frame jump anyway. */
const MIN_VISIBLE_MS = 16;

/**
 * A duration with the player's animation-speed preference applied.
 *
 * Wraps `animationScale()` — the same multiplier the battle presenter already
 * uses — so that "Fast" and "Instant" mean the same thing in a menu as they do
 * on the board, and reduced motion compresses a transition to a quarter rather
 * than deleting it. That quarter is not a number invented here: it is what
 * `base.css` already does to `--dur-med` under `data-reduced-motion`.
 *
 * Returns 0 when the result is under a frame, which callers should treat as
 * "just set the final value".
 */
export function scaledDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const scaled = Math.round(ms * motionSettings().scale);
  return scaled < MIN_VISIBLE_MS ? 0 : scaled;
}

// ---------------------------------------------------------------------------
// the shared frame loop
// ---------------------------------------------------------------------------

/**
 * A frame callback. Both arguments are **milliseconds**.
 *
 * `dt` is the time since this subscriber's previous frame, clamped; `elapsed`
 * is the total it has accumulated since subscribing. `elapsed` is per
 * subscriber rather than global so that an effect starting on the fortieth
 * screen of a session begins its cycle at zero instead of at twenty minutes.
 */
export type MotionFrameCallback = (dt: number, elapsed: number) => void;

/**
 * The largest delta any subscriber is ever handed.
 *
 * Three frames at 30fps. A long GC pause, a blocking layout or a tab that has
 * been throttled rather than hidden can all produce a delta of several hundred
 * milliseconds, and anything integrating position from it jumps across the
 * screen in one frame. Clamping trades a moment of slow motion — which nobody
 * notices — for a teleport, which everybody does.
 */
const MAX_FRAME_DELTA = 100;

const subscribers = new Map<MotionFrameCallback, number>();
const alreadyReported = new WeakSet<MotionFrameCallback>();
let frameHandle: number | null = null;
let lastFrameAt = 0;
let visibilityBound = false;

const canAnimate = (): boolean => typeof globalThis.requestAnimationFrame === "function";

const pageHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

function runFrame(now: number): void {
  frameHandle = null;

  const raw = now - lastFrameAt;
  lastFrameAt = now;
  const dt = Math.min(Math.max(raw, 0), MAX_FRAME_DELTA);

  /*
   * Snapshot before iterating. A callback that unsubscribes itself mid-frame is
   * ordinary (a tween finishing), and a callback that subscribes another one is
   * not rare either — the copy means the first cannot skip a later subscriber
   * and the second does not get a frame it was not present for.
   */
  const frame = [...subscribers.keys()];
  for (const callback of frame) {
    const previous = subscribers.get(callback);
    if (previous === undefined) continue; // unsubscribed by an earlier callback this frame
    const elapsed = previous + dt;
    subscribers.set(callback, elapsed);
    try {
      callback(dt, elapsed);
    } catch (error) {
      /*
       * One broken effect must not stop the other fourteen. Reported once per
       * callback rather than every frame, because sixty identical stack traces
       * a second buries whatever else the console was trying to say — and the
       * effect is left subscribed, since the usual cause is an asset that has
       * not finished loading and will work on the next frame.
       */
      if (!alreadyReported.has(callback)) {
        alreadyReported.add(callback);
        console.error("[motion] frame callback failed; further failures suppressed", error);
      }
    }
  }

  schedule();
}

function schedule(): void {
  if (frameHandle !== null || subscribers.size === 0 || pageHidden() || !canAnimate()) return;
  frameHandle = globalThis.requestAnimationFrame(runFrame);
}

function stop(): void {
  if (frameHandle === null) return;
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(frameHandle);
  frameHandle = null;
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (pageHidden()) {
      stop();
      return;
    }
    /*
     * Reset the clock before restarting. Browsers already throttle rAF in a
     * background tab, but "throttled" is not "stopped": the first frame after
     * an hour away can carry an hour-long delta. `MAX_FRAME_DELTA` would catch
     * it, and this makes sure there is nothing to catch.
     */
    lastFrameAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    schedule();
  });
}

/**
 * Subscribe to the one shared frame loop. Returns an unsubscribe.
 *
 * There is exactly one `requestAnimationFrame` chain in this game and this is
 * the door to it. It runs only while something is subscribed and only while the
 * page is visible, so an idle lobby in a background tab costs nothing at all.
 *
 * The loop makes no judgement about reduced motion — a match timer is driven
 * from here as legitimately as a shimmer is. Ask {@link motionEnabled} yourself
 * before subscribing something decorative.
 *
 * The returned function is safe to call more than once, and safe to call from
 * inside the callback.
 */
export function onMotionFrame(callback: MotionFrameCallback): () => void {
  if (subscribers.size === 0) lastFrameAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  subscribers.set(callback, 0);
  bindVisibility();
  schedule();

  let live = true;
  return () => {
    if (!live) return;
    live = false;
    subscribers.delete(callback);
    if (subscribers.size === 0) stop();
  };
}

// ---------------------------------------------------------------------------
// stagger
// ---------------------------------------------------------------------------

export interface StaggerOptions {
  /** Milliseconds between one element's entrance and the next. */
  step?: number;
  /** Delay given to the first element, for cascades that follow their container in. */
  from?: number;
  /**
   * Ceiling on the delay handed to the *last* element.
   *
   * The reason this exists: a collection grid holds two hundred tiles, and two
   * hundred tiles at 45ms is a nine-second entrance during which the player is
   * looking at an empty page. Past a couple of dozen items the step compresses
   * so the whole cascade still lands inside a set-piece, which turns a queue
   * into a wave — which is what a big grid wants anyway.
   */
  max?: number;
}

/**
 * Write an entrance delay onto each element, in reading order.
 *
 * Sets `--enter-delay`, which the entrance keyframes in module A and module E
 * consume as their `animation-delay`. It deliberately does not start, name or
 * own the animation — that is the stylesheet's job, and a screen that wants a
 * different entrance changes its CSS rather than its TypeScript.
 *
 * Under reduced motion the cascade collapses: every element is given `0ms`.
 * Written rather than skipped, because the case that matters is a list being
 * re-rendered *after* the player turns the setting on, where leaving the
 * property alone would preserve delays from before the change.
 */
export function stagger(
  nodes: Iterable<Element> | ArrayLike<Element>,
  options: StaggerOptions = {},
): void {
  // `Array.from` copes with both halves of that union at runtime; TypeScript
  // cannot choose an overload from a union, which is what the assertion is for.
  const elements = Array.from(nodes as Iterable<Element>);
  if (elements.length === 0) return;

  const cascade = motionEnabled();
  const step = options.step ?? 45;
  const from = options.from ?? 0;
  const max = options.max ?? DUR.setpiece;

  /*
   * `step` is what you asked for; `effective` is what fits. With one element
   * there is no gap to divide, so the request is irrelevant and only `from`
   * applies.
   */
  const room = Math.max(0, max - from);
  const effective = elements.length > 1 ? Math.min(step, room / (elements.length - 1)) : 0;

  for (const [index, node] of elements.entries()) {
    // Not every `Element` carries an inline style — a bare `Element`, an
    // `SVGDefsElement`, a test double. Skipping one is right; throwing is not.
    const style = (node as Partial<HTMLElement>).style;
    if (!style) continue;
    style.setProperty("--enter-delay", cascade ? `${Math.round(from + index * effective)}ms` : "0ms");
  }
}

// ---------------------------------------------------------------------------
// tweening
// ---------------------------------------------------------------------------

export interface TweenOptions {
  from?: number;
  to?: number;
  /** Unscaled duration; the player's animation-speed preference is applied for you. */
  ms?: number;
  ease?: Easing;
  onUpdate: (value: number, progress: number) => void;
  onDone?: () => void;
}

/**
 * Animate a single number on the shared loop. Returns a cancel function.
 *
 * The primitive under {@link tickerTo}, exported because the alternative is
 * fifteen private copies of the same eight lines — and the interesting parts
 * are the ones a private copy gets wrong: the first value being written
 * synchronously so there is no stale frame, the last value being written
 * exactly rather than as whatever the easing rounded to, and the whole thing
 * collapsing to a single assignment when the player has asked for less motion.
 *
 * Progress accumulates from the frame delta rather than from wall-clock time,
 * so a tween that was mid-flight when the tab was hidden resumes where it
 * stopped instead of finding itself finished.
 *
 * Cancelling does not call `onDone`. `onDone` means "reached the target".
 */
export function tween(options: TweenOptions): () => void {
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  const ms = scaledDuration(options.ms ?? DUR.ui);
  const curve = bezier(options.ease ?? EASE.arrive);

  if (ms <= 0 || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
    options.onUpdate(to, 1);
    options.onDone?.();
    return () => {};
  }

  options.onUpdate(from, 0);

  let elapsed = 0;
  const stopFrames = onMotionFrame((dt) => {
    elapsed += dt;
    if (elapsed >= ms) {
      stopFrames();
      options.onUpdate(to, 1);
      options.onDone?.();
      return;
    }
    const progress = elapsed / ms;
    options.onUpdate(from + (to - from) * curve(progress), progress);
  });

  return stopFrames;
}

// ---------------------------------------------------------------------------
// the number ticker
// ---------------------------------------------------------------------------

/** The in-flight count for an element, so a second call replaces rather than races. */
const tickerCancels = new WeakMap<Element, () => void>();

/** Everything that is not a digit, a dot or a minus, so "12,340 Clout" parses. */
const NON_NUMERIC = /[^\d.-]/g;

/** How many decimal places a value wants, so counting to 12.5 does not print 12.5000001. */
function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0;
  const text = String(value);
  if (text.includes("e")) return 0; // 1e-7 and friends: there is nothing here to count
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 4);
}

/**
 * Where the count should start: whatever the element is showing right now.
 *
 * Reading it back out of the DOM rather than tracking it in a map means the
 * caller never has to hold the previous value, *and* it does the right thing
 * when a count is re-targeted halfway through — the partial number on screen is
 * exactly where the new count should begin.
 *
 * This only works because `format.ts` pins the locale. Stripping everything
 * that is not a digit, a dot or a minus turns "12,340" back into 12340 in
 * en-GB; in a locale where the group separator is a full stop it would turn it
 * into 12.340 and the counter would start from twelve. Reversing a formatter is
 * only safe when you know which one ran.
 */
function startValue(element: Element): number {
  const parsed = Number.parseFloat((element.textContent ?? "").replace(NON_NUMERIC, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Count an element's text up to a value.
 *
 * The AAA bar asks for this on currency, XP, records and mission progress:
 * rewards that are *printed* rather than counted are the difference between a
 * reward and a receipt. It writes the whole `textContent`, so the element must
 * hold the number and nothing else — put the icon and the label in siblings.
 *
 * Two details it handles that a hand-rolled version usually does not:
 *
 * - **The digits are tabular.** A proportional 1 is narrower than a 0, so an
 *   uncounted number jitters horizontally the whole way up, which looks worse
 *   than not animating it at all. Set inline rather than by adding module A's
 *   `.num` class: that class is a *type role*, carrying weight and colour as
 *   well, and stamping it onto an element whose role somebody already chose
 *   would restyle it as a side effect of animating it. Reserving the fixed
 *   *slot* so the layout does not reflow as the number gains a digit is that
 *   class's job, and is deliberately still that class's job.
 * - **Calling it again replaces the count in progress.** Two tweens writing the
 *   same `textContent` produce a number that flickers between two values, and
 *   whichever finishes last wins, which is not necessarily the one that was
 *   asked for last.
 */
export function tickerTo(element: HTMLElement, value: number, ms: number = DUR.setpiece): void {
  tickerCancels.get(element)?.();
  tickerCancels.delete(element);

  element.style.fontVariantNumeric = "tabular-nums";

  const target = Number.isFinite(value) ? value : 0;
  const from = startValue(element);
  const places = decimalPlaces(target);
  const write = (at: number): void => {
    const rounded = places === 0 ? Math.round(at) : Number(at.toFixed(places));
    element.textContent = num(rounded);
  };

  const cancel = tween({
    from,
    to: target,
    ms,
    ease: EASE.arrive,
    onUpdate: write,
    onDone: () => tickerCancels.delete(element),
  });
  tickerCancels.set(element, cancel);
}

// ---------------------------------------------------------------------------
// test seam
// ---------------------------------------------------------------------------

/**
 * Drop every subscriber and every cached read.
 *
 * For tests, which share a module registry across cases: a frame callback left
 * behind by one test runs inside the next one, and a cached settings read
 * survives the change the next test just made. Matches `resetIconStyles` in
 * `art/iconAssets.ts`.
 */
export function resetMotion(): void {
  stop();
  subscribers.clear();
  cachedSettings = null;
  bezierCache.clear();
}
