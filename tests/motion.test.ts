/**
 * Motion tokens, the easing solver and the one shared frame loop —
 * `docs/FOUNDATION-CONTRACT.md` §D1.
 *
 * Two of these deserve an explanation for why they are tested at all.
 *
 * **The bezier evaluator** is the only genuinely tricky arithmetic in the
 * foundation, and it fails quietly. A CSS `cubic-bezier` is a parametric curve,
 * so "the eased value at 40% of the duration" means solving for the parameter
 * where x is 0.4 and reading y there. The tempting shortcut — feeding the input
 * straight into the y cubic — is wrong by up to 20% in the middle of a curve and
 * still produces something that eases, starts at 0, ends at 1 and looks broadly
 * plausible in a screen recording. Nobody catches that by eye. So the test does
 * not check "it eases": it compares against an independent solver written a
 * different way (bisection over the Bernstein form, to a precision the fast path
 * has no chance of reaching by accident) at forty points along every curve.
 *
 * **The frame loop** is tested with a hand-driven `requestAnimationFrame`
 * because the interesting behaviour is all in the edges: a delta clamped after a
 * pause, a subscriber that removes itself mid-frame, one that throws sixty times
 * a second. None of those are visible in a browser until they have already
 * broken somebody else's screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUR,
  EASE,
  bezier,
  cssEase,
  motionEnabled,
  onMotionFrame,
  resetMotion,
  scaledDuration,
  stagger,
  tickerTo,
  tween,
  type Easing,
} from "../src/ui/motion";
import { updateSettings } from "../src/save/settings";

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/**
 * `requestAnimationFrame` does not exist in Node, and we would not want the
 * real one anyway — the point is to control the clock exactly.
 */
const globals = globalThis as unknown as {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

let pending: FrameRequestCallback | null = null;
let handles = 0;

/**
 * Run the scheduled frame at a given timestamp.
 *
 * Driving the first frame at 0 is deliberate: the loop seeds its clock from
 * `performance.now()`, which in Node is some way above zero, so frame 0 produces
 * a negative raw delta and proves the loop clamps it to nothing rather than
 * handing a subscriber a negative `dt`. Every frame after that has an exact,
 * chosen delta.
 */
function frame(at: number): void {
  const callback = pending;
  pending = null;
  if (!callback) throw new Error("nothing was scheduled for the next frame");
  callback(at);
}

function setMotion(reduced: boolean): void {
  updateSettings({ reducedMotion: reduced, animationSpeed: "full" });
  resetMotion();
}

beforeEach(() => {
  pending = null;
  globals.requestAnimationFrame = (callback) => {
    pending = callback;
    handles += 1;
    return handles;
  };
  globals.cancelAnimationFrame = () => {
    pending = null;
  };
  setMotion(false);
});

afterEach(() => {
  resetMotion();
  setMotion(false);
});

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

describe("the tokens", () => {
  it("holds the three durations the contract names", () => {
    expect(DUR).toEqual({ micro: 110, ui: 260, setpiece: 700 });
  });

  it("holds the three curves the contract names", () => {
    expect(EASE.arrive).toEqual([0.2, 0.8, 0.2, 1]);
    expect(EASE.overshoot).toEqual([0.34, 1.56, 0.64, 1]);
    expect(EASE.leave).toEqual([0.4, 0, 1, 1]);
  });

  it("prints a curve the way CSS spells it", () => {
    expect(cssEase(EASE.arrive)).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(cssEase(EASE.overshoot)).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
  });
});

// ---------------------------------------------------------------------------
// the bezier evaluator
// ---------------------------------------------------------------------------

/**
 * The independent check: bisect x over the Bernstein form of the cubic.
 *
 * Deliberately written a different way from the implementation — no coefficient
 * expansion, no Newton, no sample table, no shared helpers — so that a mistake
 * in the algebra cannot be present in both. Eighty bisections is well past what
 * a double can represent, which is what makes a 1e-6 agreement meaningful.
 */
function referenceBezier(curve: Easing, x: number): number {
  const [x1, y1, x2, y2] = curve;
  const at = (p: number, c1: number, c2: number): number =>
    3 * c1 * p * (1 - p) ** 2 + 3 * c2 * p ** 2 * (1 - p) + p ** 3;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (at(mid, x1, x2) < x) low = mid;
    else high = mid;
  }
  return at((low + high) / 2, y1, y2);
}

describe("bezier", () => {
  const curves: ReadonlyArray<readonly [string, Easing]> = [
    ["arrive", EASE.arrive],
    ["overshoot", EASE.overshoot],
    ["leave", EASE.leave],
    ["a steep custom curve", [0.9, 0.05, 0.95, 0.1]],
    ["a shallow custom curve", [0.05, 0.9, 0.1, 0.95]],
  ];

  for (const [name, curve] of curves) {
    it(`matches an independent solver across ${name}`, () => {
      const solve = bezier(curve);
      for (let step = 0; step <= 40; step += 1) {
        const t = step / 40;
        expect(Math.abs(solve(t) - referenceBezier(curve, t))).toBeLessThan(1e-6);
      }
    });
  }

  it("returns the endpoints exactly, not to seven decimal places", () => {
    // A final frame written from 0.9999999 leaves an element a fraction of a
    // pixel short of where it was going, forever.
    for (const [, curve] of curves) {
      expect(bezier(curve)(0)).toBe(0);
      expect(bezier(curve)(1)).toBe(1);
    }
  });

  it("clamps a progress outside 0-1 rather than extrapolating", () => {
    const arrive = bezier(EASE.arrive);
    expect(arrive(-0.5)).toBe(0);
    expect(arrive(1.5)).toBe(1);
  });

  it("front-loads arrive and back-loads leave", () => {
    // The distinction the naive implementation loses: both of these are close
    // to 0.5 if you use the input as the parameter instead of solving for it.
    expect(bezier(EASE.arrive)(0.5)).toBeGreaterThan(0.9);
    expect(bezier(EASE.leave)(0.5)).toBeLessThan(0.4);
  });

  it("lets overshoot actually overshoot", () => {
    // y is deliberately not clamped — passing 1 on the way to 1 is the point.
    expect(bezier(EASE.overshoot)(0.5)).toBeGreaterThan(1);
  });

  it("rises monotonically for the curves that should", () => {
    for (const curve of [EASE.arrive, EASE.leave]) {
      const solve = bezier(curve);
      let previous = -1;
      for (let step = 0; step <= 100; step += 1) {
        const value = solve(step / 100);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("treats a linear curve as the identity", () => {
    const linear = bezier([0, 0, 1, 1]);
    expect(linear(0.25)).toBeCloseTo(0.25, 10);
    expect(linear(0.5)).toBeCloseTo(0.5, 10);
  });

  it("hands back the same closure for the same curve", () => {
    expect(bezier(EASE.arrive)).toBe(bezier([0.2, 0.8, 0.2, 1]));
  });
});

// ---------------------------------------------------------------------------
// the reduced-motion guard
// ---------------------------------------------------------------------------

describe("motionEnabled", () => {
  it("is on by default and off under reduced motion", () => {
    expect(motionEnabled()).toBe(true);
    setMotion(true);
    expect(motionEnabled()).toBe(false);
  });

  it("notices a change to the setting rather than serving a stale read", () => {
    // The cache is the whole reason this could break: read once, then drop it
    // when the store says so.
    expect(motionEnabled()).toBe(true);
    updateSettings({ reducedMotion: true });
    expect(motionEnabled()).toBe(false);
    updateSettings({ reducedMotion: false });
    expect(motionEnabled()).toBe(true);
  });
});

describe("scaledDuration", () => {
  it("passes a duration through untouched at full speed", () => {
    expect(scaledDuration(DUR.ui)).toBe(DUR.ui);
    expect(scaledDuration(DUR.setpiece)).toBe(DUR.setpiece);
  });

  it("shortens rather than removes under reduced motion", () => {
    // A progress bar still has to fill. The quarter matches what base.css
    // already does to --dur-med under data-reduced-motion.
    setMotion(true);
    expect(scaledDuration(DUR.setpiece)).toBe(175);
  });

  it("collapses anything under a frame to zero", () => {
    expect(scaledDuration(10)).toBe(0);
    expect(scaledDuration(0)).toBe(0);
    expect(scaledDuration(-5)).toBe(0);
    expect(scaledDuration(Number.NaN)).toBe(0);
  });

  it("honours the instant animation speed", () => {
    updateSettings({ animationSpeed: "instant" });
    resetMotion();
    expect(scaledDuration(DUR.setpiece)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stagger
// ---------------------------------------------------------------------------

interface StaggerProbe {
  node: Element;
  delay: () => string | undefined;
}

function staggerProbe(): StaggerProbe {
  const properties = new Map<string, string>();
  const node = {
    style: {
      setProperty(name: string, value: string): void {
        properties.set(name, value);
      },
    },
  };
  return { node: node as unknown as Element, delay: () => properties.get("--enter-delay") };
}

describe("stagger", () => {
  it("writes an increasing --enter-delay in order", () => {
    const probes = [staggerProbe(), staggerProbe(), staggerProbe(), staggerProbe()];
    stagger(probes.map((probe) => probe.node));
    expect(probes.map((probe) => probe.delay())).toEqual(["0ms", "45ms", "90ms", "135ms"]);
  });

  it("takes a custom step and a starting offset", () => {
    const probes = [staggerProbe(), staggerProbe(), staggerProbe()];
    stagger(
      probes.map((probe) => probe.node),
      { step: 30, from: 120 },
    );
    expect(probes.map((probe) => probe.delay())).toEqual(["120ms", "150ms", "180ms"]);
  });

  it("keeps a big grid's cascade inside a set-piece AND still visible", () => {
    const probes = Array.from({ length: 200 }, () => staggerProbe());
    stagger(probes.map((probe) => probe.node));
    const ms = (i: number) => Number.parseInt(probes[i]!.delay(), 10);

    expect(probes[0]!.delay()).toBe("0ms");

    // 200 tiles at the nominal 45ms would be 8,955ms of entrance, so the whole
    // cascade still has to land inside a set-piece.
    expect(ms(199)).toBeLessThanOrEqual(DUR.setpiece);

    /*
     * ...but landing in time is only half the promise, and this assertion is
     * the half that was missing. The old rule divided the budget by the element
     * count, which satisfied the ceiling by handing 200 tiles a 3.5ms step —
     * under a quarter of a frame, so every tile arrived together and the
     * cascade was real only in the arithmetic. A review had to measure the
     * delays off a live grid (0,1,2,3,5,6,7,8,9,10ms) to notice.
     *
     * So: consecutive leading elements must be far enough apart to be seen as
     * separate. A frame is 16.7ms; anything under that is one entrance.
     */
    expect(ms(1) - ms(0)).toBeGreaterThanOrEqual(20);
    expect(ms(5) - ms(4)).toBeGreaterThanOrEqual(20);

    // The tail shares the final slot rather than compressing everyone — that is
    // what buys the leading elements a visible step.
    expect(ms(199)).toBe(ms(150));
  });

  it("respects a custom ceiling", () => {
    const probes = [staggerProbe(), staggerProbe(), staggerProbe(), staggerProbe(), staggerProbe()];
    stagger(
      probes.map((probe) => probe.node),
      { step: 45, max: 100 },
    );
    expect(probes.map((probe) => probe.delay())).toEqual(["0ms", "25ms", "50ms", "75ms", "100ms"]);
  });

  it("gives a lone element the offset and no cascade", () => {
    const probe = staggerProbe();
    stagger([probe.node], { from: 60 });
    expect(probe.delay()).toBe("60ms");
  });

  it("collapses the cascade to nothing under reduced motion", () => {
    setMotion(true);
    const probes = [staggerProbe(), staggerProbe(), staggerProbe()];
    stagger(probes.map((probe) => probe.node));
    // Written rather than skipped: a list re-rendered after the player turned
    // the setting on would otherwise keep the delays it was given before.
    expect(probes.map((probe) => probe.delay())).toEqual(["0ms", "0ms", "0ms"]);
  });

  it("survives an empty list and an element with no inline style", () => {
    expect(() => stagger([])).not.toThrow();
    expect(() => stagger([{} as unknown as Element])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// the shared frame loop
// ---------------------------------------------------------------------------

describe("onMotionFrame", () => {
  it("schedules exactly one frame however many subscribers there are", () => {
    const seen: string[] = [];
    onMotionFrame(() => seen.push("a"));
    onMotionFrame(() => seen.push("b"));
    onMotionFrame(() => seen.push("c"));

    frame(0);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("hands out a delta and a running total, both in milliseconds", () => {
    const frames: Array<[number, number]> = [];
    onMotionFrame((dt, elapsed) => frames.push([dt, elapsed]));

    frame(0);
    frame(16);
    frame(32);
    expect(frames).toEqual([
      [0, 0],
      [16, 16],
      [16, 32],
    ]);
  });

  it("clamps a huge delta so nothing teleports after a stall", () => {
    const deltas: number[] = [];
    onMotionFrame((dt) => deltas.push(dt));

    frame(0);
    frame(5_000);
    // Three frames at 30fps, not five seconds.
    expect(deltas).toEqual([0, 100]);
  });

  it("counts elapsed from when each subscriber joined, not from boot", () => {
    const early: number[] = [];
    const late: number[] = [];
    onMotionFrame((_dt, elapsed) => early.push(elapsed));
    frame(0);
    frame(16);

    onMotionFrame((_dt, elapsed) => late.push(elapsed));
    frame(32);

    expect(early).toEqual([0, 16, 32]);
    expect(late).toEqual([16]);
  });

  it("stops delivering once unsubscribed, and stops scheduling once empty", () => {
    const seen: number[] = [];
    const off = onMotionFrame(() => seen.push(1));

    frame(0);
    expect(pending).not.toBeNull();

    off();
    expect(pending).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("survives a subscriber removing itself mid-frame", () => {
    const seen: string[] = [];
    let offSelf: (() => void) | null = null;
    offSelf = onMotionFrame(() => {
      seen.push("self");
      offSelf?.();
    });
    onMotionFrame(() => seen.push("other"));

    frame(0);
    frame(16);
    // The one that left is gone; the one after it in the list still ran.
    expect(seen).toEqual(["self", "other", "other"]);
  });

  it("does not give a frame to a subscriber that joined during it", () => {
    const seen: string[] = [];
    onMotionFrame(() => {
      if (seen.length === 0) onMotionFrame(() => seen.push("late"));
      seen.push("first");
    });

    frame(0);
    expect(seen).toEqual(["first"]);
    frame(16);
    expect(seen).toEqual(["first", "first", "late"]);
  });

  it("unsubscribing twice is harmless", () => {
    const off = onMotionFrame(() => {});
    off();
    expect(() => off()).not.toThrow();
  });

  it("keeps the loop alive when one callback throws, and only says so once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const survivor: number[] = [];
    onMotionFrame(() => {
      throw new Error("a texture that is not ready yet");
    });
    onMotionFrame(() => survivor.push(1));

    frame(0);
    frame(16);
    frame(32);

    // Fourteen other effects do not stop because one of them is mid-load.
    expect(survivor).toHaveLength(3);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// tween
// ---------------------------------------------------------------------------

describe("tween", () => {
  it("writes the starting value synchronously, so there is no stale frame", () => {
    const values: number[] = [];
    tween({ from: 10, to: 20, ms: 100, onUpdate: (value) => values.push(value) });
    expect(values).toEqual([10]);
  });

  it("lands exactly on the target and then calls onDone", () => {
    const values: number[] = [];
    const done = vi.fn();
    tween({ from: 0, to: 100, ms: 100, onUpdate: (value) => values.push(value), onDone: done });

    frame(0);
    frame(50);
    expect(done).not.toHaveBeenCalled();
    frame(100);

    expect(values.at(-1)).toBe(100);
    expect(done).toHaveBeenCalledTimes(1);
    expect(pending).toBeNull(); // and it let go of the loop
  });

  it("eases rather than moving linearly", () => {
    const values: number[] = [];
    tween({ from: 0, to: 100, ms: 100, ease: EASE.arrive, onUpdate: (value) => values.push(value) });
    frame(0);
    frame(50);
    // arrive is heavily front-loaded; halfway through the clock is not halfway
    // through the distance.
    expect(values.at(-1)).toBeGreaterThan(90);
  });

  it("snaps when the scaled duration is under a frame, without touching the loop", () => {
    const values: number[] = [];
    const done = vi.fn();
    tween({ from: 0, to: 100, ms: 5, onUpdate: (value) => values.push(value), onDone: done });

    expect(values).toEqual([100]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(pending).toBeNull();
  });

  it("snaps under the instant animation speed", () => {
    updateSettings({ animationSpeed: "instant" });
    resetMotion();
    const values: number[] = [];
    tween({ from: 0, to: 100, ms: DUR.setpiece, onUpdate: (value) => values.push(value) });
    expect(values).toEqual([100]);
  });

  it("cancelling stops the updates and does not call onDone", () => {
    const values: number[] = [];
    const done = vi.fn();
    const cancel = tween({ from: 0, to: 100, ms: 100, onUpdate: (value) => values.push(value), onDone: done });

    frame(0);
    const seen = values.length;
    cancel();

    expect(pending).toBeNull();
    expect(values).toHaveLength(seen);
    expect(done).not.toHaveBeenCalled();
  });

  it("resumes where it stopped rather than skipping ahead after a pause", () => {
    const values: number[] = [];
    tween({ from: 0, to: 1000, ms: 1000, ease: [0, 0, 1, 1], onUpdate: (value) => values.push(value) });
    frame(0);
    frame(100);
    // Five minutes hidden. Progress accumulates from the clamped frame delta,
    // so the tween picks up roughly where it was instead of finding itself over.
    frame(300_000);
    expect(values.at(-1)).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// tickerTo
// ---------------------------------------------------------------------------

function numberNode(initial: string): { raw: { textContent: string | null; style: { fontVariantNumeric: string } }; element: HTMLElement } {
  const raw = { textContent: initial, style: { fontVariantNumeric: "" } };
  return { raw, element: raw as unknown as HTMLElement };
}

describe("tickerTo", () => {
  it("counts up to the value and prints it grouped", () => {
    const { raw, element } = numberNode("0");
    tickerTo(element, 12340, 100);

    frame(0);
    frame(50);
    const midway = raw.textContent;
    frame(100);

    expect(midway).not.toBe("0");
    expect(midway).not.toBe("12,340");
    expect(raw.textContent).toBe("12,340");
  });

  it("makes the digits tabular so the number does not jitter as it counts", () => {
    const { raw, element } = numberNode("0");
    tickerTo(element, 100, 100);
    expect(raw.style.fontVariantNumeric).toBe("tabular-nums");
  });

  it("starts from what the element already shows, separators and all", () => {
    const { raw, element } = numberNode("12,340");
    tickerTo(element, 12590, 100);
    // The first synchronous write is the starting value, re-formatted.
    expect(raw.textContent).toBe("12,340");
    frame(0);
    frame(100);
    expect(raw.textContent).toBe("12,590");
  });

  it("counts up from zero when the element holds a placeholder", () => {
    const { raw, element } = numberNode("—");
    tickerTo(element, 40, 100);
    expect(raw.textContent).toBe("0");
    frame(0);
    frame(100);
    expect(raw.textContent).toBe("40");
  });

  it("counts down as readily as up", () => {
    const { raw, element } = numberNode("100");
    tickerTo(element, 40, 100);
    frame(0);
    frame(100);
    expect(raw.textContent).toBe("40");
  });

  it("re-targeting mid-count picks up from what is on screen, not from the old target", () => {
    const { raw, element } = numberNode("0");
    tickerTo(element, 100, 100);
    frame(0);
    frame(50);
    const partway = raw.textContent;

    tickerTo(element, 200, 100);
    // No flicker back to zero, and no second tween fighting the first.
    expect(raw.textContent).toBe(partway);
    frame(0);
    frame(100);
    expect(raw.textContent).toBe("200");
    expect(pending).toBeNull();
  });

  it("prints only whole numbers when the target is whole", () => {
    const { raw, element } = numberNode("0");
    tickerTo(element, 7, 100);
    frame(0);
    frame(50);
    expect(raw.textContent).toMatch(/^\d+$/);
  });

  it("sets the value outright under reduced motion", () => {
    setMotion(true);
    const { raw, element } = numberNode("0");
    tickerTo(element, 12340, 10);
    expect(raw.textContent).toBe("12,340");
  });

  it("treats a non-finite target as zero rather than printing NaN", () => {
    const { raw, element } = numberNode("50");
    tickerTo(element, Number.NaN, 0);
    expect(raw.textContent).toBe("0");
  });
});
