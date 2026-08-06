/**
 * A cinematic as a set of overlapping beats, evaluated at a time rather than
 * played forward.
 *
 * The obvious way to write an opening sequence is a chain of callbacks and
 * timers: fade the room up, *then* ignite the rig, *then* drop the mark. It is
 * also the way that produces a slideshow. AAA bar §3 asks for the opposite —
 * "everything overlaps", sequential animations that wait for each other read as
 * slow even when they are fast — and a chain of timers cannot overlap without
 * becoming a chain of timers inside timers.
 *
 * So a sequence here is a flat list of `Beat`s, each with a start, a length and
 * a curve, and `seek(t)` composes **all of them** at once. Beats before `t` are
 * held at 1, beats after it are held at 0, and beats straddling it are eased.
 * Two beats may freely overlap; where they write the same property, later in the
 * array wins, which is the same rule a compositor uses and needs no explanation
 * at the call site.
 *
 * ## The reason it is a `seek` and not a `tick`
 *
 * Three separate requirements collapse into one line of code once a timeline is
 * a pure function of time:
 *
 * - **Reduced motion.** The requirement is a "near-instant, non-animated title
 *   card that still reads". That is `seek(restPoint)` and one render — the exact
 *   composition the animated version settles into, with nothing moving and no
 *   frame loop started at all. No second layout, no separate static build to
 *   keep in step with the animated one.
 * - **`shot.mjs --freeze`.** A reviewer pinning the sequence at 1.4s gets the
 *   frame that is genuinely at 1.4s.
 * - **A dropped frame costs nothing.** Progress comes from accumulated frame
 *   deltas rather than from counting frames, so a 90ms hitch skips forward
 *   instead of playing the whole sequence 90ms late.
 *
 * ## Every beat runs on every seek, deliberately
 *
 * Calling a beat that has not started yet with `k = 0` looks wasteful and is the
 * thing that makes the composition total: seek backwards, or seek to an
 * arbitrary point, and every property is written by somebody rather than left
 * holding whatever the last forward pass happened to put there. A cinematic with
 * fifty beats is fifty closures a frame, which is nothing, and the alternative —
 * tracking which beats have "fired" — is the bookkeeping that makes scrubbing
 * impossible.
 */

import { bezier, EASE, type Easing } from "../motion";

export interface Beat {
  /** Milliseconds from the top of the sequence. */
  at: number;
  /** How long the beat takes. Zero-length beats snap at `at`. */
  ms: number;
  /** Defaults to {@link EASE.arrive}. */
  ease?: Easing;
  /**
   * The beat itself, handed its own eased progress in 0–1 (or slightly outside
   * it, for `overshoot`). Called on **every** seek — see the module header.
   */
  play: (k: number) => void;
}

export interface Sequence {
  /** Total length in milliseconds, including the last beat's tail. */
  readonly duration: number;
  /** Compose every beat at this time. Safe to call with any value. */
  seek(ms: number): void;
}

/**
 * Build a sequence from beats. The array order is the compositing order.
 *
 * `duration` is derived rather than declared, so adding a beat that runs past
 * the end lengthens the cinematic instead of being cut off by a number somebody
 * forgot to update.
 */
export function sequence(beats: readonly Beat[]): Sequence {
  const curves = beats.map((beat) => bezier(beat.ease ?? EASE.arrive));
  let duration = 0;
  for (const beat of beats) duration = Math.max(duration, beat.at + beat.ms);

  return {
    duration,
    seek(ms: number): void {
      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i]!;
        const raw = beat.ms <= 0 ? (ms >= beat.at ? 1 : 0) : (ms - beat.at) / beat.ms;
        const clamped = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
        // The endpoints skip the evaluator: it is exact there anyway, and a
        // held beat is the common case by a wide margin.
        beat.play(clamped === 0 || clamped === 1 ? clamped : curves[i]!(clamped));
      }
    },
  };
}

/** Linear interpolation, for beats that read better as `mix(from, to, k)`. */
export const mix = (from: number, to: number, k: number): number => from + (to - from) * k;

/**
 * No curve at all, and the one place it is mandatory.
 *
 * A beat that shapes its own output — {@link swell}, {@link plateau} — has
 * already decided what the value does over its length, and running its input
 * through `arrive` first eases an easing. Measured, that is not a subtlety: a
 * flash authored to peak at 9% of its beat and be gone by 40% instead peaked at
 * 30% and was still burning at the end, so the impact of the title landed as a
 * vague brightening rather than as a hit. `bezier` recognises this as the
 * identity and returns the clamp, so it costs a comparison rather than a curve
 * evaluation.
 */
export const LINEAR: Easing = [0, 0, 1, 1];

/**
 * A one-shot swell: 0 → 1 → 0 across a beat, peaking at `peakAt`.
 *
 * Impacts, flashes and light stabs all want this shape and all of them get it
 * wrong when written as two beats — the rise and the fall end up with a
 * one-frame notch between them where the value passes through whatever the
 * second beat's `k = 0` happens to be. One beat, one curve, no seam.
 *
 * The rise uses the caller's easing and the fall is always eased *out* of the
 * peak, because light decays fast and then lingers; a symmetric swell reads as
 * a pulsing lamp rather than as something being struck.
 */
export function swell(k: number, peakAt = 0.18): number {
  if (k <= 0 || k >= 1) return 0;
  if (k < peakAt) return k / peakAt;
  const fall = (k - peakAt) / (1 - peakAt);
  // Cubic decay: 63% gone by the first third of the tail.
  return (1 - fall) ** 3;
}

/**
 * A held value with soft ends: 0 → 1 over the first `edge` of the beat, 1 → 0
 * over the last `edge`, and flat in between.
 *
 * What a specular sweep wants. `swell` is wrong for it — a sweep is at full
 * brightness for the whole of its travel and only its arrival and departure are
 * ramped, whereas a swell peaks a fifth of the way in and is dying for the rest
 * of the beat, which reads as the light going out halfway across the object.
 */
export function plateau(k: number, edge = 0.2): number {
  if (k <= 0 || k >= 1) return 0;
  if (edge <= 0) return 1;
  return Math.min(1, k / edge, (1 - k) / edge);
}
