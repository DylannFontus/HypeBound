/**
 * The first-run title: the five seconds a player sees once, ever.
 *
 * This is the only moment in HYPEBOUND where the game is allowed to spend the
 * player's attention on nothing but itself, and it plays exactly once — to
 * somebody who has just downloaded a card game they have never heard of and is
 * deciding, in about four seconds, whether it looks like it was made by a studio.
 * Everything below is arranged around that one judgement.
 *
 * ## The shape
 *
 * ```
 *  0.0s  a dark room, lit only by a wash and a drifting field of defocused neon
 *  0.5s  the rig ignites — five shafts, 120ms apart, each with a strike and a
 *        settle, which is the stagger §3 asks for applied to light instead of tiles
 *  1.3s  the mark falls in from above and behind, growing as it comes
 *  2.1s  IMPACT: flash, anamorphic streak, shockwave through the haze, every
 *        beam jolts, the camera takes a hit, the whole room reacts at once
 *  2.2s  the wordmark is revealed along the key-light axis with the light of the
 *        reveal riding its leading edge
 *  2.7s  settle; the reflection arrives on the floor; the camera keeps pushing
 *  3.0s  hold, with a slow specular crawl across the lockup — never dead
 *  4.1s  the camera pushes through the mark, which blooms out of frame, and the
 *        game is already behind it
 * ```
 *
 * ## Why the impact is nine things on the same frame
 *
 * §3's "secondary motion" is named as the single biggest gap between animated
 * and alive, and an impact is where that gap is widest. One object landing with
 * one flash is a keyframe. The same object landing while the smoke moves, the
 * lamps flicker, the floor catches it, the lens streaks and the camera flinches
 * is an *event*, and the player cannot name any of the eight things they did not
 * consciously see. They all fire from one beat time so nothing is a fraction
 * late, and they all have different lengths so nothing ends together.
 *
 * ## Beats that share a property guard on `k`
 *
 * Every beat runs on every seek (see `timeline.ts`), which is what makes the
 * composition total — but two beats writing the same field means the later one
 * wins even when it is not running yet. Where that matters, the later beat only
 * speaks while `k` is strictly between 0 and 1. It is one `if` and it is the
 * difference between the sheen riding the wipe and the sheen being silently
 * zeroed by a crawl that has not started.
 */

import { DUR, EASE } from "../motion";
import { LINEAR, mix, plateau, sequence, swell, type Beat, type Sequence } from "./timeline";
import type { IntroLook } from "./stage";

/**
 * Where the sequence is fully settled and nothing is moving.
 *
 * `seek(FIRST_RUN_REST)` is the reduced-motion title card: the exact frame the
 * animated version arrives at, with no animation played to get there. Picked
 * inside the hold rather than at the end, because the end is the handoff and a
 * static frame of a logo halfway out of the frame is not a title card.
 */
export const FIRST_RUN_REST = 3400;

/**
 * The two moments the clock is allowed to stop and wait for artwork.
 *
 * The brand PNGs are 2.4 MB and take a second or two to arrive on a cold load,
 * and this sequence is the one that runs on a cold load by definition. Rather
 * than hold a black frame until both have landed — measured at 2.2s off the dev
 * server, which is a very long time to look at nothing — the room starts
 * immediately and the clock pauses here if the thing the next beat needs is not
 * there yet.
 *
 * They are placed a hair *before* the beat that first draws each asset: `mark`
 * sits just under the top of the fall, and `word` just under the start of the
 * reveal. The stall is invisible because the room's idle life runs on wall
 * time rather than on the sequence clock, so during a wait the shafts still
 * breathe, the city still drifts and the camera is still moving.
 */
export const FIRST_RUN_GATES = { mark: 1250, word: 2150 } as const;

export function firstRunSequence(look: IntroLook): Sequence {
  const beats: Beat[] = [];
  const beat = (at: number, ms: number, play: Beat["play"], ease?: Beat["ease"]): void => {
    beats.push(ease ? { at, ms, ease, play } : { at, ms, play });
  };

  /**
   * `flash` is the one field no beat ever assigns — every contributor adds to
   * it, because half a dozen separate events all put light on the lens and they
   * have to sum rather than fight. That makes it the one field that has to be
   * cleared at the top of every seek, or it accumulates across frames until the
   * screen is permanently white. Zero-length, so it fires the instant the
   * sequence starts and is held at 1 forever after — which for an assignment
   * means "always".
   */
  beat(0, 0, () => {
    look.flash = 0;
  });

  // --- 1. the room ----------------------------------------------------------

  beat(0, 900, (k) => {
    look.wash = k;
  });
  beat(0, 700, (k) => {
    look.vignette = k * 0.95;
  });
  beat(220, 520, (k) => {
    look.grain = k * 0.45;
  });
  beat(140, 1400, (k) => {
    look.haze = k;
  });
  beat(300, 1500, (k) => {
    look.bokeh = k;
  });
  /**
   * A long, slow push that never stops.
   *
   * Started before anything is on screen and still running under the hold. A
   * camera that arrives at its mark and then locks off is the tell that a
   * cinematic is a sequence of states; one that is still moving when the title
   * settles is a camera.
   */
  beat(0, 2600, (k) => {
    look.dolly = mix(5.5, 0, k);
  });

  // --- 2. the rig ignites ---------------------------------------------------

  const IGNITE_AT = 520;
  const IGNITE_STEP = 120;
  for (let i = 0; i < 5; i++) {
    const at = IGNITE_AT + i * IGNITE_STEP;
    beat(at, 420, (k) => {
      look.beams[i] = k * 0.58;
    });
    // The strike: a hard overshoot that is gone in a quarter of a second, added
    // on top of the level the lamp settles at. Linear in, because `swell` is
    // already the curve — see the note on `LINEAR`.
    beat(at, 300, (k) => {
      look.beams[i] = (look.beams[i] ?? 0) + swell(k, 0.1) * 0.7;
    }, LINEAR);
  }

  // --- 3. the mark falls ----------------------------------------------------

  const LAND_AT = 2080;
  const FALL_MS = 780;
  beat(LAND_AT - FALL_MS, FALL_MS, (k) => {
    look.markOpacity = Math.min(1, k * 3.2);
    look.markRise = mix(1.15, 0, k);
    look.markPush = mix(-7, 0, k);
    look.markScale = mix(1.22, 1, k);
    look.markTilt = mix(-0.075, 0, k);
    look.markGlow = k * 0.85;
  });

  // --- 4. impact ------------------------------------------------------------

  beat(LAND_AT - 40, 520, (k) => {
    look.flash += swell(k, 0.07) * 0.95;
  }, LINEAR);
  beat(LAND_AT - 40, 700, (k) => {
    const s = swell(k, 0.04);
    look.streak = 0.06 + s * 0.94;
    look.streakOpacity = s;
  }, LINEAR);
  beat(LAND_AT - 30, 1000, (k) => {
    look.ring = mix(0.25, 3, k);
    look.ringOpacity = swell(k, 0.05) * 0.8;
  }, LINEAR);
  beat(LAND_AT - 30, 320, (k) => {
    look.shake = swell(k, 0.04) * 0.24;
  }, LINEAR);
  beat(LAND_AT - 30, 400, (k) => {
    const jolt = swell(k, 0.06) * 0.75;
    for (let i = 0; i < look.beams.length; i++) look.beams[i] = (look.beams[i] ?? 0) + jolt;
  }, LINEAR);
  beat(LAND_AT - 30, 800, (k) => {
    look.bokeh += swell(k, 0.08) * 0.8;
  }, LINEAR);
  beat(LAND_AT - 30, 900, (k) => {
    look.haze += swell(k, 0.1) * 0.9;
  }, LINEAR);
  beat(LAND_AT - 30, 780, (k) => {
    look.markGlow += swell(k, 0.04) * 1.3;
  }, LINEAR);

  // --- 5. the wordmark is revealed -----------------------------------------

  const WIPE_AT = LAND_AT + 100;
  const WIPE_MS = DUR.ui + 200;
  beat(WIPE_AT, WIPE_MS, (k) => {
    look.wipe = k;
    look.wordOpacity = Math.min(1, k * 5);
    look.wordGlow = Math.min(1, k * 2) * 0.85;
    look.wordScale = mix(1.035, 1, k);
    look.wordRise = mix(0.16, 0, k);
  });
  // The light on the leading edge of the reveal. Same axis, same band, tracked
  // to the wipe — see the note in `stage.ts` about these being one mechanism.
  beat(WIPE_AT, WIPE_MS + 60, (k) => {
    if (k <= 0 || k >= 1) return;
    look.sheen = k;
    look.sheenOpacity = plateau(k, 0.14) * 0.95;
  });
  beat(WIPE_AT + 120, 700, (k) => {
    look.reflection = k;
  });

  // --- 6. the hold, which is not still --------------------------------------

  beat(2500, 2100, (k) => {
    look.dolly += mix(0, -1.5, k);
  });
  /** The idle specular crawl. Slow, low, and the only thing moving. */
  beat(3000, 1150, (k) => {
    if (k <= 0 || k >= 1) return;
    look.sheen = k;
    look.sheenOpacity = plateau(k, 0.3) * 0.4;
  }, EASE.leave);

  // --- 7. the handoff -------------------------------------------------------

  /**
   * The camera goes *through* the mark rather than the mark growing.
   *
   * Two things about this. First, a cross-fade from a title card to a menu is
   * the transition you use when you have nothing to say about the relationship
   * between them — which is what §3a bans between two menus, and it is no more
   * excusable here. The relationship is that the game is on the other side of
   * the logo, so the camera flies through it.
   *
   * Second, it is the *camera* and not a scale on the mark, and the first
   * version got that wrong. Inflating one object to 3.8× magnifies its texture
   * past its own resolution and leaves a soft pink blob in the middle of a
   * frame where everything else has stayed exactly where it was — one thing
   * growing rather than a room being entered. Moving the camera brings the
   * shafts, the haze and the whole defocused city past the lens with it, which
   * is what a push-in is, and the mark stays at its native resolution until it
   * is bigger than the frame.
   *
   * Accelerating, so it reads as being pulled in rather than as a lift.
   */
  /**
   * The two exit beats guard on `k > 0`, and the reason is the one trap this
   * timeline model has.
   *
   * Every beat runs on every seek — that is what makes the composition total —
   * so a beat that *assigns* is also asserting its value for all the time before
   * it starts. `wordOpacity = 1 - k` is 1 at `k = 0`, which is a beat at the
   * four-second mark quietly declaring the wordmark fully visible from frame
   * zero. It shipped that way for one round and the photograph at 350ms had the
   * badge hanging in an empty room a second before it was due to fall.
   *
   * Guarding on `k > 0` says "this beat has nothing to say until it starts", and
   * deliberately does *not* guard `k >= 1`: once it has ended its final value is
   * the truth and must keep being written.
   */
  const EXIT_AT = 4050;
  beat(EXIT_AT - 30, 280, (k) => {
    if (k <= 0) return;
    look.wordOpacity = 1 - k;
    look.wordGlow = (1 - k) * 0.85;
    look.wordRise = mix(0, -0.16, k);
    look.reflection = 1 - k;
  }, EASE.leave);
  beat(EXIT_AT, 820, (k) => {
    if (k <= 0) return;
    look.dolly += mix(0, -23, k);
    look.lift = k;
    /**
     * The halo dies with the mark, and that is not a detail.
     *
     * The glow layers are *blurred copies of the artwork*, so a halo that
     * outlives the thing it belongs to is a soft violet smear of a logo filling
     * the frame — which is exactly what the last second looked like for a round.
     * Tying both to one `presence` means the badge stays sharp right up to the
     * point it stops existing, and what is left behind it is the flash: light,
     * not a blurred picture of a logo.
     */
    const presence = 1 - Math.max(0, (k - 0.5) / 0.5) ** 1.3;
    look.markOpacity = presence;
    look.markGlow = (Math.max(look.markGlow, 0.85) + k) * presence;
  }, EASE.leave);
  beat(EXIT_AT + 260, 600, (k) => {
    look.flash += swell(k, 0.45);
  }, LINEAR);
  beat(EXIT_AT + 150, 620, (k) => {
    look.wash *= 1 - k;
    look.bokeh *= 1 - k;
    look.haze *= 1 - k;
    for (let i = 0; i < look.beams.length; i++) look.beams[i] = (look.beams[i] ?? 0) * (1 - k);
  }, EASE.leave);
  beat(EXIT_AT + 560, DUR.ui + 40, (k) => {
    look.master = 1 - k;
  }, EASE.leave);

  return sequence(beats);
}
