/**
 * The match card: who is playing whom, drawn on the curtain that covers the load.
 *
 * ## The measurement this exists to change
 *
 * Filmed with a CDP screencast on a real click of PLAY: the curtain closed by
 * t=150ms and the screen then held at mean luminance **12.5/255** for **6.7
 * seconds** — mean per-pair luminance delta 0.018, 0.3% of pixels moving, five
 * per cent of consecutive frame pairs identical to the JPEG's own noise floor —
 * and then cut to a settled board in 90ms. Six and a half seconds of a black
 * rectangle, on the single gesture the entire game is arranged around. The menu
 * veil, covering the Collection, manages 3.6% of pixels moving; the veil over a
 * *match* managed a twelfth of that.
 *
 * AAA bar §7 asks that loading be part of the world rather than a spinner, and
 * this was less than a spinner: a spinner at least tells you the machine is
 * alive. Hearthstone covers the identical wait with two lit hero portraits and a
 * coin. MTG Arena flies a camera through the environment the match is about to
 * happen in. Neither shows the player black, and neither has to, because both
 * know who is playing before the board exists.
 *
 * ## So does this, and that is the only interesting problem here
 *
 * The shell raises the curtain *before* it calls the route's factory — that
 * ordering is the whole of `shell.ts`, and it is not negotiable, because the
 * cover has to be on the compositor before the constructor takes the thread. So
 * at the moment the curtain is built, the battle screen does not exist and
 * nobody has chosen an opponent yet.
 *
 * The answer is a provider rather than a lookup. `main.ts` owns the content
 * index and every one of the ten battle routes' registrations, so it is the one
 * place that can answer "who would this hash deal?" without side effects;
 * `setMatchBillingProvider` is where it says so, and this module is content-free
 * and save-free by construction. A route that cannot be answered returns `null`
 * and gets a lit, roomed, grained veil with no billing on it — which is still an
 * enormous improvement on black, and is what the reduced-motion and
 * no-portrait-art paths land on too.
 *
 * ## Why the portraits are painted a beat late, on purpose
 *
 * `paintLeaderPortrait` downsamples a 4K painting. Doing that between
 * `raiseCurtain()` and the frame that first composites it would put a hundred
 * milliseconds of raster in the one window the whole file exists to keep clear,
 * and the curtain would cut instead of closing. So `dressMatchCurtain` is called
 * *after* the shell has confirmed the close is drawn, the plates are memoised by
 * `leaderPortrait.ts` (the lobby has almost always painted the player's own
 * leader already, so the common case is a cache hit), and the billing fades up
 * over the first 420ms of a hold that has six seconds in it. §7: nothing pops.
 *
 * The two halves are anchored to the seam rather than to their panels' outer
 * edges — the away leader stands just above the light, the home leader just
 * below it — so the seam is the horizon between them and the part is two
 * fighters being pulled away from each other rather than two rectangles sliding.
 */

import "./matchCurtain.css";

import type { CardDef } from "../../engine/types";
import { paintLeaderPortrait } from "../art/leaderPortrait";
import { icon } from "../art/uiIcons";
import { motionEnabled } from "../motion";

/** One side of the card. `card` is a leader; `label` is who they are to you. */
export interface MatchSide {
  card: CardDef;
  /** "YOUR LEADER", "RIVAL", "BOSS" — the role, not the name. */
  label: string;
  /** Optional second line: a deck name, an encounter title, a difficulty. */
  detail?: string;
}

export interface MatchBilling {
  /** The opponent, above the seam. */
  away: MatchSide | null;
  /** The player, below it. */
  home: MatchSide | null;
  /** What kind of match this is: "CASUAL MATCH", "TUTORIAL", "GAUNTLET". */
  mode: string;
}

export type MatchBillingProvider = (routeId: string, params: URLSearchParams) => MatchBilling | null;

let provider: MatchBillingProvider | null = null;

/**
 * Tell the curtain who is playing. Called once from `main.ts`.
 *
 * Deliberately a setter rather than an import: this module must not reach into
 * the save or the content index, and `main.ts` is the only file that already
 * holds both plus the exact deck-selection logic each battle route uses. A
 * second copy of "which leader would `#battle?tour=neon-idols` deal" is a second
 * copy that will be wrong within a month.
 */
export function setMatchBillingProvider(next: MatchBillingProvider | null): void {
  provider = next;
}

/**
 * How wide a portrait plate is asked for, in CSS pixels.
 *
 * Small on purpose. The plate is drawn behind a scrim, at roughly a third of the
 * viewport's height, and the expensive part of `paintLeaderPortrait` is the
 * downsample from the 4K source — so asking for 520 rather than 1120 is the
 * difference between about 40ms and about 150ms of raster inside a window where
 * the main thread is about to be needed for a battle screen.
 */
const PLATE_W = 520;

function billingFor(routeId: string, params: URLSearchParams): MatchBilling | null {
  if (provider === null) return null;
  try {
    return provider(routeId, params);
  } catch (error) {
    // A billing card is decoration. A provider that throws must not be able to
    // stop somebody entering a match.
    console.warn("[matchCurtain] billing provider threw", error);
    return null;
  }
}

/**
 * One fighter: a framed portrait with its name plate bolted to the bottom of it.
 *
 * ## What this looked like before, and why a critic called it the worst surface
 * in the game
 *
 * "Two unframed portrait cut-outs on a flat purple radial gradient, with the
 * deck subtitle printed raw over hair." Every clause is a section of the bar.
 * The portraits were feathered to nothing on all four edges and cut to an oval,
 * which meant there was no object anywhere on the card — §1 wants an edge
 * treatment and there were no edges. The name plates were absolutely positioned
 * over the art with a text-shadow doing the whole job, and on the home side the
 * plate sat over the *top* of the portrait, which is where the head is: filmed
 * at 1600×900, "DJ Kilowatt" was set across bright orange hair and could not be
 * read. §4 says text over imagery gets a scrim, a shadow or a plate, and a
 * shadow that only works when the pixel behind it happens to be dark is not one
 * of the three.
 *
 * ## What it is now
 *
 * The two things Hearthstone's own versus screen is made of. Each leader is a
 * **framed medallion** — a lacquered bezel with the 315° key on it, the art
 * recessed inside it behind a lip, and a real cast underneath — with a **name
 * plate** directly below, same width, its own material, carrying the role, the
 * name and the deck line on a surface rather than on a face. Frame and plate are
 * one flex column pinned to the seam, so the name can never land on a hairline
 * again: it is not over the art at all.
 *
 * The paint options change with the frame. The four edge feathers and the oval
 * are gone, because a frame is the edge treatment and feathering the art inside
 * one produces a soft blob floating in a hard bezel; what is left is the crop
 * bias that keeps heads in shot and a deeper floor scrim, which now serves the
 * frame's inner shadow rather than a name plate that is no longer standing on
 * the art.
 */
function sideElement(side: MatchSide, role: "away" | "home"): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `match-side is-${role}`;

  const portrait = paintLeaderPortrait(side.card, {
    width: PLATE_W,
    aspect: 1.14,
    bias: role === "away" ? 0.2 : 0.16,
    /* Deeper than the old 0.1/0.22 because the floor of the frame is now a
       recess with a lip falling across it, and art that stays bright right down
       to the bezel is art sitting on top of the frame rather than inside it. */
    scrim: 0.32,
    resolution: 1,
    className: "match-portrait",
  });

  /**
   * The breathe lives on a wrapper, and the extra element is load-bearing.
   *
   * The entrance and the idle both animate `opacity` and `transform`, and Blink
   * will not run *either* on the compositor while two animations on one element
   * claim the same property — it drops both back to the main thread, which is
   * the one thread that is guaranteed to be inside a battle constructor for the
   * whole of this card's life. Filmed with them stacked: the portraits opened
   * at their first keyframe and then crept, reaching about 40% by t=1.8s and
   * full strength only when the build let go.
   *
   * One animation each, on three elements now — figure breathes, frame arrives,
   * plate arrives — and every one of them is composited.
   */
  const figure = document.createElement("div");
  figure.className = `match-figure is-${role}`;

  const billing = document.createElement("div");
  billing.className = "match-billing";

  const frame = document.createElement("div");
  frame.className = "match-frame";
  const art = document.createElement("div");
  art.className = "match-frame-art";
  art.appendChild(portrait);
  frame.appendChild(art);
  billing.appendChild(frame);

  const plateBox = document.createElement("div");
  plateBox.className = "match-plate";
  const eyebrow = document.createElement("div");
  eyebrow.className = "t-label match-role";
  eyebrow.textContent = side.label;
  const name = document.createElement("div");
  name.className = "t-heading match-name";
  name.textContent = side.card.name;
  plateBox.append(eyebrow, name);
  if (side.detail !== undefined && side.detail !== "") {
    const detail = document.createElement("div");
    detail.className = "t-body match-detail";
    detail.textContent = side.detail;
    plateBox.appendChild(detail);
  }
  billing.appendChild(plateBox);

  figure.appendChild(billing);
  wrap.appendChild(figure);
  return wrap;
}

/**
 * Put the match on the curtain. Safe to call on any curtain, any number of
 * times; a second call replaces the first.
 *
 * Returns whether anything was drawn, so the shell can tell the difference
 * between "there is a billing up" and "this is a plain lit veil" — which is the
 * difference between the two exit shapes in `transitions.css`.
 */
export function dressMatchCurtain(curtain: HTMLElement, routeId: string, params: URLSearchParams): boolean {
  for (const stale of curtain.querySelectorAll(".match-side, .match-vs")) stale.remove();
  const billing = billingFor(routeId, params);
  if (billing === null) return false;

  const top = curtain.querySelector<HTMLElement>(".nav-curtain-panel.is-top");
  const bottom = curtain.querySelector<HTMLElement>(".nav-curtain-panel.is-bottom");
  if (top === null || bottom === null) return false;

  let drew = false;
  try {
    if (billing.away) {
      top.appendChild(sideElement(billing.away, "away"));
      drew = true;
    }
    if (billing.home) {
      bottom.appendChild(sideElement(billing.home, "home"));
      drew = true;
    }
  } catch (error) {
    // A painting that fails is a painting; it is not a reason to refuse to
    // start a match. Whatever landed stays, the rest does not.
    console.warn("[matchCurtain] could not paint a leader", error);
  }
  if (!drew) return false;

  /**
   * The mark on the seam, and it is a medallion now rather than a caption.
   *
   * On the curtain rather than inside either panel, because the panels travel
   * in opposite directions and a label that splits in half is not a label. It
   * gets its own exit in `matchCurtain.css`, tied to `[data-phase="open"]`, so
   * it lifts away as the light does.
   *
   * What changed is what it *says*. A 5×14 pill reading "CASUAL MATCH" is a
   * status line; the thing between two fighters on a versus card is the word
   * that makes it a versus card. So the middle of the seam is a struck disc with
   * VS on it, lit from 315° like every other object in the game, with a ring
   * turning slowly round it while the match loads — and the mode goes into a
   * chip underneath, where a caption belongs. Hearthstone puts a coin here for
   * exactly the same reason: the wait needs a subject.
   */
  const vs = document.createElement("div");
  vs.className = "match-vs";
  vs.innerHTML =
    `<span class="match-vs-rule" aria-hidden="true"></span>` +
    `<span class="match-vs-mark">` +
    `<span class="match-vs-medal" aria-hidden="true">` +
    `<span class="match-vs-ring"></span>` +
    `<span class="match-vs-orbit"></span>` +
    `<span class="match-vs-glyph">VS</span>` +
    `</span>` +
    `<span class="match-vs-mode">${icon("mode-casual", { size: 14, class: "match-vs-icon" })}` +
    `<span class="t-label match-vs-text"></span></span>` +
    `</span>` +
    `<span class="match-vs-rule" aria-hidden="true"></span>`;
  const text = vs.querySelector<HTMLElement>(".match-vs-text");
  if (text) text.textContent = billing.mode;
  curtain.appendChild(vs);

  /**
   * Reduced motion gets the card and not the assembly. The attribute gates every
   * entrance in the stylesheet at once rather than each of them checking, so
   * there is exactly one place where "does this animate" is decided.
   */
  if (!motionEnabled()) {
    curtain.dataset["billing"] = "still";
    return true;
  }
  /**
   * ## Armed here, synchronously, and the deferral it replaces was the defect
   *
   * This used to call `armBilling`, which waited for two consecutive on-time
   * frames before setting the attribute — on the reasoning that a CSS
   * animation's clock runs in real time, so an entrance declared in front of a
   * 737ms constructor is an entrance nobody sees.
   *
   * That is true of an animation the *main thread* has to drive and false of
   * this one, which is the same distinction `shell.ts` §2.0 turns on. Every
   * keyframe below is `opacity` and `transform` on an element the compositor
   * owns the moment an animation is running on it, so once the layer has been
   * rasterised the entrance plays through a blocked thread exactly as the
   * curtain's own `translate3d` always has. What it cannot survive is not being
   * *declared*: `animation-fill-mode: both` holds the backwards fill — opacity
   * 0 — for as long as the attribute is missing, and during a battle build the
   * page has no calm frames at all, so the wait for two of them was a wait for
   * the constructor to finish.
   *
   * Filmed at 1600×900, cold, before this change: the panels closed at t=170ms
   * and the card was **not on screen at all** until t≈3.4s of a 5.4-second hold,
   * at which point it faded up over the last two seconds and the portraits
   * barely arrived before the mulligan did. The handsomest thing in the game,
   * drawn correctly, into a frame nobody was shown.
   *
   * The two frames the entrance needs to be composited on are the caller's:
   * `shell.ts` follows a `true` return with `await twoFrames()` for exactly this
   * reason, and the note there says so.
   */
  curtain.dataset["billing"] = "live";
  return true;
}

