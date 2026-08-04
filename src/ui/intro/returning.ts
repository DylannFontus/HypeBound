/**
 * The returning sting: 880 milliseconds, every launch, forever.
 *
 * A player who likes this game will see this several hundred times. That single
 * fact decides everything about it, and it decides most of it by subtraction:
 *
 * - **It is shorter than the lobby takes to build.** 880ms end to end, and the
 *   whole thing is over before a player who reached for the mouse has clicked
 *   anything. Any input ends it in a fifth of that. A sting you have to skip is
 *   a sting somebody will come to hate; a sting that finishes before you could
 *   have skipped it is a sting you never think about.
 * - **It does not black the screen out.** There is no opaque backdrop in this
 *   sequence — the wash peaks at 0.22 and is gone by the halfway mark. The lobby
 *   is genuinely behind it the entire time, mounted, lit, running its own
 *   entrance. What the player sees is the room they are walking into, with the
 *   sign coming on over it. §3a's requirement that the space behind the UI be
 *   continuous does not stop applying because the frame happens to be the first
 *   one.
 * - **It is the same set as the first-run title.** Same shafts, same defocused
 *   city, same reveal along the same 45° axis, same floor. It reads as an
 *   abbreviation of something rather than as a second, cheaper thing — which is
 *   what a returning player should feel, because it is true.
 *
 * ## Why it ends by dispersing rather than by cutting
 *
 * The last 260ms lift the lockup very slightly, bloom it out and take the whole
 * picture to zero. Nothing cuts; the light on the lobby simply stops being
 * there. That is the difference between a sting that resolves into the game and
 * a video that ends and reveals a menu behind it, and it costs three lines.
 */

import { EASE } from "../motion";
import { LINEAR, mix, plateau, sequence, swell, type Beat, type Sequence } from "./timeline";
import type { IntroLook } from "./stage";

/** The settled frame, for the reduced-motion title card. */
export const RETURNING_REST = 500;

export function returningSequence(look: IntroLook): Sequence {
  const beats: Beat[] = [];
  const beat = (at: number, ms: number, play: Beat["play"], ease?: Beat["ease"]): void => {
    beats.push(ease ? { at, ms, ease, play } : { at, ms, play });
  };

  /** See the note on the same beat in `firstRun.ts`: `flash` only ever adds. */
  beat(0, 0, () => {
    look.flash = 0;
  });

  // --- the room, briefly ----------------------------------------------------

  /**
   * Three of the five shafts, all struck together rather than staggered.
   *
   * The first-run title stages its ignition over 600ms because it has 600ms to
   * spend. Here the whole sequence is 880ms and a stagger would read as three
   * lamps failing to switch on at once. They are still individually pitched and
   * tinted, so it is the same rig.
   */
  for (let i = 0; i < 3; i++) {
    beat(0, 200, (k) => {
      look.beams[i] = k * 0.5;
    });
    beat(0, 340, (k) => {
      look.beams[i] = (look.beams[i] ?? 0) + swell(k, 0.08) * 0.75;
    }, LINEAR);
  }

  beat(0, 640, (k) => {
    look.wash = swell(k, 0.16) * 0.3;
  }, LINEAR);
  beat(0, 300, (k) => {
    look.vignette = k * 0.55;
  });
  beat(0, 240, (k) => {
    look.grain = k * 0.35;
  });
  beat(0, 720, (k) => {
    look.haze = swell(k, 0.2) * 0.9;
  }, LINEAR);
  beat(0, 340, (k) => {
    look.bokeh = k * 0.9;
  });
  /**
   * The city, as light only.
   *
   * The stage multiplies the towers by the wash and leaves the wet street
   * additive (see the note in `stage.ts`), so what this dial actually buys here
   * is half a second of neon reflection washing across the bottom of the lobby
   * while the sign comes on. The player never resolves it as a skyline and is
   * not meant to; it is the same room as the title, seen for a moment through
   * the lights the game is already wearing.
   */
  beat(0, 420, (k) => {
    look.city = k * 0.62;
  });
  beat(520, 300, (k) => {
    if (k <= 0) return;
    look.city *= 1 - k;
  }, EASE.leave);
  beat(0, 880, (k) => {
    look.dolly = mix(2.2, -0.5, k);
  });

  // --- the stamp ------------------------------------------------------------

  /**
   * `overshoot` here and `arrive` in the first-run fall, deliberately.
   *
   * The long version has the mark travelling a distance under something like
   * gravity, and gravity does not bounce. This one has no travel to speak of —
   * it is a stamp, 260ms, and the small pass beyond the target is the whole
   * reason it lands rather than appears.
   */
  beat(0, 260, (k) => {
    look.markOpacity = Math.min(1, k * 5);
    look.markScale = mix(1.28, 1, k);
    look.markRise = mix(0.2, 0, k);
    look.markPush = mix(-3, 0, k);
    look.markGlow = Math.min(1, k * 1.6);
  }, EASE.overshoot);

  beat(0, 280, (k) => {
    look.flash += swell(k, 0.06) * 0.6;
  }, LINEAR);
  beat(0, 420, (k) => {
    const s = swell(k, 0.035);
    look.streak = 0.05 + s * 0.95;
    look.streakOpacity = s * 0.9;
  }, LINEAR);
  beat(30, 560, (k) => {
    look.ring = mix(0.3, 2.5, k);
    look.ringOpacity = swell(k, 0.05) * 0.5;
  }, LINEAR);
  beat(20, 180, (k) => {
    look.shake = swell(k, 0.05) * 0.12;
  }, LINEAR);

  // --- the reveal -----------------------------------------------------------

  const WIPE_AT = 90;
  const WIPE_MS = 250;
  beat(WIPE_AT, WIPE_MS, (k) => {
    look.wipe = k;
    look.wordOpacity = Math.min(1, k * 5);
    look.wordGlow = Math.min(1, k * 2) * 0.8;
    look.wordScale = mix(1.02, 1, k);
  });
  beat(WIPE_AT, WIPE_MS + 40, (k) => {
    if (k <= 0 || k >= 1) return;
    look.sheen = k;
    look.sheenOpacity = plateau(k, 0.12) * 0.95;
  });
  /*
   * No reflection. The sting has no visible floor — it barely has a wash — and
   * a mirrored wordmark hanging in the middle of a lobby is not a reflection,
   * it is a second wordmark. `look.reflection` stays at zero, which also takes
   * the floor highlight with it.
   */

  // --- the handover ---------------------------------------------------------

  /**
   * The sting does not end. It puts the wordmark where the lobby keeps it.
   *
   * The first version bloomed the lockup out and took the picture to zero, and
   * it was fine — but "fine" here means the player watched a logo evaporate and
   * then noticed a smaller copy of the same logo sitting in the header rail
   * where it had been the whole time. That is two objects, and §3a is explicit
   * that when two screens contain the same object it must not blink out of
   * existence and reappear somewhere else. It is the difference between a video
   * that ends and a room the player has walked into.
   *
   * So the lockup flies to the header and shrinks to exactly the size the header
   * draws it at. The real wordmark is underneath at full opacity the entire
   * time, so the last frame of the cinematic and the first frame of the lobby
   * are the same picture — there is no cut, and nothing to cross-fade.
   *
   * `arrive` rather than `leave`, because this is an arrival. The lockup
   * decelerates into its parking space; it is not being thrown away.
   */
  const EXIT_AT = 560;
  const FLIGHT = 300;
  beat(EXIT_AT, FLIGHT, (k) => {
    if (k <= 0) return;
    look.dock = k;
  }, EASE.arrive);
  /**
   * The badge leaves first and the word lands.
   *
   * There is no mark in the lobby's header — only the wordmark — so the badge
   * has nowhere to arrive. Fading it out over the first two thirds of the
   * flight, while it still travels with the word, means it reads as part of one
   * shrinking lockup rather than as an object that was deleted.
   */
  beat(EXIT_AT, FLIGHT * 0.55, (k) => {
    if (k <= 0) return;
    look.markOpacity = 1 - k;
    look.markGlow = (1 - k) * 0.9;
  }, EASE.arrive);
  /** The room goes out well before the lockup does; only the brand travels. */
  beat(EXIT_AT - 40, 260, (k) => {
    if (k <= 0) return;
    look.wash *= 1 - k;
    look.haze *= 1 - k;
    look.bokeh *= 1 - k;
    look.vignette *= 1 - k;
    for (let i = 0; i < look.beams.length; i++) look.beams[i] = (look.beams[i] ?? 0) * (1 - k);
  }, EASE.leave);
  /**
   * The last sixty milliseconds, and only the last sixty.
   *
   * Everything above has already parked the wordmark on top of the lobby's own,
   * so this is a crossfade between two identical bitmaps in the same place at
   * the same size. It is invisible, which is the entire point — a longer fade
   * would be a visible double exposure of the brand against itself.
   */
  beat(EXIT_AT + FLIGHT - 60, 100, (k) => {
    if (k <= 0) return;
    look.master = 1 - k;
  }, EASE.leave);

  return sequence(beats);
}
