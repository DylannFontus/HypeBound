/**
 * Which cards are alive, and why it is a question about attention rather than
 * about size.
 *
 * The rule this replaces was one line: animate a card if it is drawn at 220px or
 * more, up to eight at a time. It was defensible arithmetic and it produced a
 * dead game. Measured on a 168px collection tile, the mean per-channel change
 * over 4.2 seconds was **0.000** with a maximum of 2/255 — nothing on the
 * collection grid, the deck builder, the shop or the grand tour has ever moved,
 * because every one of those draws at 120–168px. The one screen where a card
 * did breathe was the detail view. So the game's headline cosmetic — a premium
 * foil, the thing the shop exists to sell — rendered as a static band in the
 * shop and shimmered only after you had already bought it.
 *
 * The size gate was answering the wrong question. A 150px foil in the shop is
 * small, but it is the object the player is *looking at*, and a 168px tile under
 * the pointer is the one tile on the grid whose motion anybody will notice. What
 * the cap actually needs to protect is the frame budget, and the frame budget
 * does not care how wide a card is — it cares how many repaints land in a frame.
 *
 * So the cap stays at eight and the *selection* changes: score every card that
 * is genuinely on screen, hand the eight slots to the ones being attended to,
 * and let the other two hundred and thirty-seven hold still.
 *
 * ## The scoring, in the order the numbers matter
 *
 * 1. **Hover wins outright.** A card under the pointer is being examined; it
 *    gets a slot no matter what else is on screen.
 * 2. **Premium next.** A foil that never shimmers is not a cosmetic, and the
 *    place it most needs to sell itself is the shop, at 150px.
 * 3. **Then proximity to the pointer**, falling off over roughly a card's width,
 *    because the eye is where the hand is.
 * 4. **Then size**, as the tie-break the old rule used as its only test.
 *
 * Everything off screen scores nothing and is skipped before any of that, which
 * is what makes a two-hundred-tile grid cost the same as a six-card hand.
 *
 * ## One observer, one listener, one clock
 *
 * There is a single `IntersectionObserver`, a single `pointermove` handler and a
 * single subscription to the shared frame loop, all created lazily on the first
 * registration and all torn down when the last card goes. Fifteen builders
 * starting fifteen rAF loops is the thing `motion.ts` exists to prevent, and a
 * per-canvas observer would have been the same mistake wearing a different hat.
 */

import { DUR, EASE, bezier, motionEnabled, onMotionFrame } from "../motion";

export interface CardSurface {
  canvas: HTMLCanvasElement;
  /** Repaint the card at this phase of the clock and this much hover. */
  paint: (state: { sheen: number; foil: number; hover: number }) => void;
  premium: boolean;
  /** Rendered CSS width, used only as the tie-break of last resort. */
  width: number;
}

interface Entry extends CardSurface {
  visible: boolean;
  /** 0–1, eased, so a hover lights the card rather than switching it on. */
  hover: number;
  hoverTarget: number;
  /** Extra phase added when the player hovers, so the sheen kicks rather than continues. */
  kick: number;
  active: boolean;
  /** Last phase actually painted, so a still card is not repainted for nothing. */
  paintedSheen: number;
  paintedHover: number;
}

/**
 * How many cards may repaint on one clock tick.
 *
 * A tile costs about a millisecond at tile finish and a detail card about three.
 * Eight of the expensive kind is 24ms, which is why they are spread across
 * frames rather than fired together — see `sliceOf`.
 */
const MAX_ANIMATED = 8;

/** Twelve repaints a second is well under the eye's threshold for a slow crawl. */
const IDLE_INTERVAL = 83;

/** The specular takes six seconds to cross a card; the foil, four. */
const SHEEN_PERIOD = 6000;
const FOIL_PERIOD = 4200;

/** Pointer proximity stops mattering beyond about a card and a half. */
const REACH = 320;

/** Re-score no more often than this: attention does not change every frame. */
const RESCORE_INTERVAL = 420;

const entries = new Set<Entry>();
const byCanvas = new WeakMap<HTMLCanvasElement, Entry>();

let observer: IntersectionObserver | null = null;
let stopFrames: (() => void) | null = null;
let pointerBound = false;
let pointerX = -1e6;
let pointerY = -1e6;
let sinceTick = 0;
let sinceScore = RESCORE_INTERVAL;
let clock = 0;
let slice = 0;

/**
 * Resolved on first use, not at module scope.
 *
 * `settings.ts` imports `renderCard.ts` for the Rules Lens, `renderCard.ts`
 * imports this file, and this file imports `motion.ts`, which imports
 * `settings.ts` — so at the moment this module is evaluated `EASE` may not
 * exist yet. Reading it inside a function is the difference between a working
 * import graph and a `Cannot read properties of undefined` on boot.
 */
let hoverCurve: ((t: number) => number) | null = null;
const easeHover = (t: number): number => (hoverCurve ??= bezier(EASE.arrive))(t);

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === "undefined") return null;
  observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        const entry = byCanvas.get(record.target as HTMLCanvasElement);
        if (entry) entry.visible = record.isIntersecting;
      }
      // a scroll that brings new cards in should not wait out the score interval
      sinceScore = RESCORE_INTERVAL;
    },
    // a little margin, so a card lights up just before it is fully on screen
    { rootMargin: "120px" }
  );
  return observer;
}

function bindPointer(): void {
  if (pointerBound || typeof window === "undefined") return;
  pointerBound = true;
  window.addEventListener(
    "pointermove",
    (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    },
    { passive: true }
  );
}

/**
 * How badly this card wants one of the eight slots.
 *
 * Deliberately unnormalised: the bands are far enough apart that a hovered card
 * always outranks a premium one and a premium one always outranks a large one,
 * so the sort never has to reason about how a 300px common compares to a 150px
 * foil.
 */
function score(entry: Entry): number {
  if (!entry.visible) return -1;
  let value = entry.width * 0.01;
  if (entry.premium) value += 100;
  if (entry.hoverTarget > 0) value += 1000;

  if (pointerX > -1e5) {
    const box = entry.canvas.getBoundingClientRect();
    const dx = Math.max(box.left - pointerX, 0, pointerX - box.right);
    const dy = Math.max(box.top - pointerY, 0, pointerY - box.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < REACH) value += 60 * (1 - distance / REACH);
  }
  return value;
}

function rescore(): void {
  const live: Entry[] = [];
  for (const entry of entries) {
    if (!entry.canvas.isConnected) {
      release(entry);
      continue;
    }
    entry.active = false;
    if (entry.visible) live.push(entry);
  }
  live.sort((a, b) => score(b) - score(a));
  for (let i = 0; i < Math.min(MAX_ANIMATED, live.length); i++) live[i]!.active = true;
}

/**
 * Which of the active cards repaint on this tick.
 *
 * Eight repaints landing on one frame is a stall five times a second on the
 * screen that can least afford it. The active set is walked two at a time, so
 * each card still gets its update inside a quarter of a second and no frame ever
 * carries more than a couple of milliseconds of card painting.
 */
function sliceOf(active: Entry[]): Entry[] {
  if (active.length <= 2) return active;
  const size = 2;
  const start = (slice * size) % active.length;
  slice += 1;
  const out: Entry[] = [];
  for (let i = 0; i < size; i++) out.push(active[(start + i) % active.length]!);
  return out;
}

/**
 * Cards whose hover is between its two ends, so the frame loop has one small set
 * to walk instead of two hundred and forty-five.
 */
const easing = new Set<Entry>();

function phaseOf(entry: Entry, period: number): number {
  const phase = clock + entry.kick;
  return (((phase % period) + period) % period) / period;
}

function repaint(entry: Entry): void {
  if (!entry.canvas.isConnected) {
    release(entry);
    return;
  }
  const sheen = phaseOf(entry, SHEEN_PERIOD);
  entry.paintedSheen = sheen;
  entry.paintedHover = entry.hover;
  entry.paint({ sheen, foil: phaseOf(entry, FOIL_PERIOD), hover: easeHover(entry.hover) });
}

function tick(dt: number): void {
  /**
   * The idle crawl is decoration and the hover light is a state, so the setting
   * that turns decoration off stops the clock and leaves the state alone. A card
   * at rest under `prefers-reduced-motion` is byte-identical frame to frame,
   * which is what the measurement asks for and what the loop below guarantees by
   * never advancing `clock`.
   */
  const animate = motionEnabled();

  // hover eases on its own budget, not the clock's: §5 wants it inside 120ms
  for (const entry of [...easing]) {
    const step = dt / DUR.micro;
    const raw = entry.hover + (entry.hoverTarget > entry.hover ? step : -step);
    entry.hover = Math.max(0, Math.min(1, raw));
    if (entry.hover === entry.hoverTarget) easing.delete(entry);
    repaint(entry);
  }

  if (!animate) return;

  clock += dt;
  sinceScore += dt;
  sinceTick += dt;

  if (sinceScore >= RESCORE_INTERVAL) {
    sinceScore = 0;
    rescore();
  }

  if (sinceTick < IDLE_INTERVAL) return;
  sinceTick = 0;

  const active: Entry[] = [];
  for (const entry of entries) if (entry.active) active.push(entry);
  for (const entry of sliceOf(active)) {
    if (!easing.has(entry)) repaint(entry);
  }
}

function ensureClock(): void {
  if (stopFrames) return;
  stopFrames = onMotionFrame((dt) => {
    if (entries.size === 0) {
      stopFrames?.();
      stopFrames = null;
      return;
    }
    tick(dt);
  });
}

function release(entry: Entry): void {
  entries.delete(entry);
  easing.delete(entry);
  byCanvas.delete(entry.canvas);
  observer?.unobserve(entry.canvas);
  if (entries.size === 0) {
    stopFrames?.();
    stopFrames = null;
  }
}

/**
 * Enrol a card canvas in the shared clock. Returns an unsubscribe.
 *
 * Safe to call for every card on a two-hundred-tile grid: an entry that is off
 * screen costs one observer record and nothing else, and one that never makes it
 * into the document is dropped the first time the clock looks at it.
 *
 * Under reduced motion the card is still registered — hover is a *state*, not
 * decoration, and §5 asks for it to be designed at every setting — but the idle
 * crawl never advances, so a card at rest is byte-identical frame to frame.
 */
export function registerCardSurface(surface: CardSurface): () => void {
  const entry: Entry = {
    ...surface,
    visible: false,
    hover: 0,
    hoverTarget: 0,
    kick: 0,
    active: false,
    paintedSheen: -1,
    paintedHover: 0,
  };
  entries.add(entry);
  byCanvas.set(surface.canvas, entry);
  ensureObserver()?.observe(surface.canvas);
  bindPointer();
  // under reduced motion there is nothing for the loop to do until somebody
  // hovers, and two hundred idle registrations should not cost a frame callback
  if (motionEnabled()) ensureClock();
  return () => release(entry);
}

/**
 * Tell a card it is being looked at.
 *
 * Two things happen and they are deliberately different in kind. The rim light
 * eases up over one micro-beat, which is the hover state §5 asks for and which
 * happens whatever the motion setting — a state that only exists while an
 * animation is running is not a state. The **kick** is the decorative half: the
 * specular jumps most of a period forward so a sweep crosses the card as it
 * lifts, rather than the player catching whatever phase the clock happened to be
 * at. That one is motion, so reduced motion does not get it.
 */
export function setCardHover(canvas: HTMLCanvasElement, on: boolean): void {
  const entry = byCanvas.get(canvas);
  if (!entry || entry.hoverTarget === (on ? 1 : 0)) return;
  entry.hoverTarget = on ? 1 : 0;
  if (on && motionEnabled()) {
    entry.kick += SHEEN_PERIOD * 0.62;
    entry.visible = true;
    entry.active = true;
    sinceScore = RESCORE_INTERVAL;
  }
  easing.add(entry);
  ensureClock();
}

/** For the tests and the perf probes: how many cards are currently animating. */
export const animatedCardCount = (): number => {
  let n = 0;
  for (const entry of entries) if (entry.active) n += 1;
  return n;
};
