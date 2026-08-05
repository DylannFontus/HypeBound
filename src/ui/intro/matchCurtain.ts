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

function sideElement(side: MatchSide, role: "away" | "home"): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `match-side is-${role}`;

  /**
   * The art bleeds off three edges and stands on the seam.
   *
   * `fadeBottom` on the away side and `fadeTop` on the home side, so neither
   * figure ends at a straight line where the light is — the razor edge across a
   * portrait is the defect `leaderPortrait.ts` was written to delete, and it is
   * at its most obvious when the cut lands next to the brightest thing on
   * screen. `oval` takes the remaining two corners off.
   */
  const plate = paintLeaderPortrait(side.card, {
    width: PLATE_W,
    aspect: 1.02,
    bias: role === "away" ? 0.2 : 0.16,
    scrim: role === "away" ? 0.1 : 0.22,
    fadeLeft: 0.16,
    fadeRight: 0.16,
    ...(role === "away" ? { fadeBottom: 0.14, fadeTop: 0.26 } : { fadeTop: 0.14, fadeBottom: 0.26 }),
    oval: 3,
    resolution: 1,
    className: "match-portrait",
  });
  wrap.appendChild(plate);

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
  wrap.appendChild(plateBox);
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
   * The mode plate rides the seam.
   *
   * On the curtain rather than inside either panel, because the panels travel
   * in opposite directions and a label that splits in half is not a label. It
   * gets its own exit in `matchCurtain.css`, tied to `[data-phase="open"]`, so
   * it lifts away as the light does.
   */
  const vs = document.createElement("div");
  vs.className = "match-vs";
  vs.innerHTML =
    `<span class="match-vs-rule" aria-hidden="true"></span>` +
    `<span class="match-vs-mark">${icon("mode-casual", { size: 16, class: "match-vs-icon" })}` +
    `<span class="t-label match-vs-text"></span></span>` +
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
  armBilling(curtain);
  return true;
}

/**
 * How long the entrance will wait for a frame worth arriving on, measured from
 * the first frame anybody actually saw.
 *
 * From the first *observed* frame rather than from the call, and that is the
 * whole trick. A wall-clock deadline set here is consumed by the very block it
 * exists to survive — the 737ms task this is dressed in front of would expire
 * it before a single frame had been drawn, and the entrance would arm on the
 * frame with the most raster still outstanding, which is precisely the failure.
 */
const BILLING_PATIENCE_MS = 900;

/** A frame the page could afford to draw. The same 34ms `shell.ts` uses. */
const CALM_FRAME_MS = 34;

/**
 * Start the card assembling on a frame that can carry it.
 *
 * ## What was measured
 *
 * Warm entry, CDP screencast: at t=1423 the frame held the two names and no
 * portraits (mean 27.7, sd 16.3); at t=1451 it held both portraits at full
 * strength (mean 39.6, sd 37.1). A twenty-eight millisecond step, on a card
 * whose entrance is authored as a 640ms stagger. Cold entry did the same thing
 * with the names arriving about 140ms before their faces.
 *
 * The entrances were not missing. They were *spent*: `dressMatchCurtain` is
 * called two frames after the curtain is raised and the battle constructor
 * takes the thread immediately afterwards for 737ms warm and 3,175ms cold. A
 * CSS animation's clock runs in real time, so the 620ms portrait fade elapsed
 * entirely inside the block, and the first frame drawn afterwards showed a
 * finished animation over a canvas the compositor had only just rasterised.
 * The type arrived first because type is cheap to raster and a downsampled 4K
 * painting is not.
 *
 * So the DOM is built now — that part genuinely does want to happen before the
 * block, so the raster is already queued — and the *entrance* is armed on the
 * first two on-time frames after it. Two rather than one for the reason
 * `shell.ts` gives at `quietFrame`: the first frame after a long task is the
 * gap between two expensive ones, and a card that starts assembling into a
 * dropped frame has not assembled in front of anybody.
 */
function armBilling(curtain: HTMLElement): void {
  if (typeof requestAnimationFrame !== "function") {
    curtain.dataset["billing"] = "live";
    return;
  }
  const clock = (): number =>
    typeof performance === "object" && typeof performance.now === "function" ? performance.now() : Date.now();
  let previous = clock();
  let deadline = Infinity;
  let seen = 0;
  let calm = 0;
  const step = (): void => {
    // Abandoned: the player left, or the shell dropped the veil under us.
    if (!curtain.isConnected || curtain.dataset["billing"] !== undefined) return;
    const stamp = clock();
    const delta = stamp - previous;
    previous = stamp;
    seen += 1;
    if (seen === 1) deadline = stamp + BILLING_PATIENCE_MS;
    calm = delta <= CALM_FRAME_MS ? calm + 1 : 0;
    if (calm >= 2 || stamp >= deadline) {
      curtain.dataset["billing"] = "live";
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
