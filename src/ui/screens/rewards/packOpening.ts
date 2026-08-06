/**
 * The reward moment.
 *
 * This file exists because the domain review scored these five screens 3/10 —
 * the lowest in the game — and named one cause: *the reward moment does not
 * exist as a moment.* Opening a five-card Merch Drop was a 180ms opacity
 * cross-fade of five 150px thumbnails inside a small dialog floating in a dimmed
 * void, over in about 1.2 seconds, with **no player input at all**. A ten-pull
 * on the gacha banner — the single most celebrated interaction in the genre —
 * rendered as a wrapped row of 24px text chips below the fold, in which a
 * Legendary was the same size as the nine commons beside it.
 *
 * What the reference games do, and what this rebuilds:
 *
 * - **Hearthstone** hands you a physical pack, you tear it, five illustrated
 *   backs fan onto the table, each one flips on *your* click, a rarity gem
 *   cracks and a legendary flashes the room.
 * - **MTG Arena** rotates each card in on a Y axis behind a specular sweep.
 * - **Gwent's** keg shatters.
 *
 * ## The beats, and their budget
 *
 * §3 puts a set-piece at 500–900ms *per beat*, which is the number this is built
 * against. A pack opening is allowed to take its time; each beat is not.
 *
 * | beat | what happens | ms |
 * |------|--------------|----|
 * | 0 anticipation | the pack floats, breathes and catches the light; nothing advances until the player acts | until input |
 * | 1 tear | the pack flares and blows apart; the cards deal out from where it was, face down, 55ms apart | 560 + 55n |
 * | 2 reveal | one card at a time turns on a real 3D rotateY, rarity escalating: aura, burst, rays, room flash | 480 each |
 * | 3 summary | the footer rises, the counts ticker, the actions arm | 260 |
 *
 * ## Two decisions worth defending
 *
 * **The face-down card is identical for every rarity.** The old screen put the
 * gold glow on `.reveal-back` and then set `opacity: 0` on it the instant the
 * card turned — so the game told you what you had before you flipped, and gave
 * the revealed Legendary nothing at all. That is exactly backwards, and it
 * deletes the only tension the mechanic has. Every rarity treatment in here
 * lands on `.reveal-slot.shown` and not one pixel of it before.
 *
 * **The best card is held for last.** Sorted ascending by rarity, so a pull
 * escalates rather than peaking at card two and then showing you four commons.
 * Every gacha in the genre does this and it costs one comparator.
 *
 * ## The legacy hooks are load-bearing
 *
 * `.shop-reveal`, `.reveal-cards`, `.reveal-slot`, `.reveal-slot.shown`,
 * `.reveal-front canvas`, `.reveal-tag` and `#reveal-done` are what
 * `scripts/verify-shop.mjs` drives in a real browser, and that check is part of
 * the contract. They are kept on the rebuilt elements deliberately: the browser
 * check should be able to prove that a *rebuilt* screen still charges the right
 * price and delivers the right cards, which is the whole point of having it.
 *
 * One consequence shapes the markup: the check clicks the centre of
 * `.reveal-cards`, so the pack has to be a **descendant** of that element rather
 * than a sibling floating over it, or the click is intercepted and a rebuild
 * that works perfectly fails its own verification.
 */

import type { CardDef, ContentIndex, Rarity } from "../../../engine/types";
import type { CardBackStyle } from "../../cosmetics/emblem";
import { renderCardToCanvas } from "../../cardRenderer/renderCard";
import { audio } from "../../../audio/audio";
import { icon, type IconId } from "../../art/uiIcons";
import { DUR, motionEnabled, scaledDuration, tickerTo } from "../../motion";
import { num as formatNumber } from "../../format";
import {
  COIN,
  HOUSE_BACK,
  cardBackThumb,
  esc,
  syncWallets,
  type CoinKind,
} from "./rewardKit";
import { installRewardsTheme } from "./rewardsTheme";

/* -------------------------------------------------------------------------
   the room the reveal happens in
   ------------------------------------------------------------------------- */

/**
 * A reveal is a set-piece, and a set-piece owns the screen.
 *
 * Photographed over the shop with five cards turning, the screen behind this
 * overlay was still being read: "The Second Funeral", "Full probability
 * disclosures" and "Open a free Drop — 5 left" were all legible through it.
 * Measured off the capture, the shop's headings came back at a luminance of
 * 4.4–11.2 against a veil of 23.0 — small in absolute terms and *plainly* visible,
 * because near black is where the eye's contrast sensitivity is highest and
 * every one of those shapes was still sharp.
 *
 * Two things were wrong and only one of them was the number.
 *
 * 1. **The veil was 97.2% opaque, not opaque.** `rgb(3 1 8 / 0.972)` lets 2.8%
 *    of a 232-luminance heading through, which is a value of about six — and six
 *    on three reads as text. There is nothing behind a pack opening that anybody
 *    needs, so there is no argument for the remaining 2.8%.
 * 2. **`backdrop-filter: blur(26px)` was not blurring anything.** If it were,
 *    the bleed-through would be a smear rather than words; it is words. `.rw-open`
 *    animates its own opacity, which makes it a backdrop root in Blink, and a
 *    backdrop root is exactly the thing that empties a descendant's backdrop. So
 *    the sheet was paying for a full-screen blur every frame of the set-piece and
 *    getting a no-op for it. It is switched off here rather than fixed, because an
 *    opaque field has no backdrop worth filtering.
 *
 * What replaced it was a *room* rather than a darker sheet — and, measured, that
 * room was still a void.
 *
 * ## The second correction: three gradients on one element is not a place
 *
 * The first version of this was three `background` layers on `.rw-open-room`: a
 * vignette, a vertical ramp and a 315° wash, all of them dark on dark. Every one
 * of §1's boxes was ticked and the screen still photographed as black. The
 * integration critic put it exactly right — "no midground plane at all — no
 * table, no light pool, no room. Two of §2's four planes are missing" — and the
 * capture agrees with him: the frame resolved to a single dark mass with the
 * cards floating in it, which is the §6 value-structure failure, and the contact
 * shadow under each card was landing on nothing, so it read as a smudge rather
 * than as contact.
 *
 * The difference between a gradient and a place is that a place has **planes
 * that meet**. `screens.css` already proved this on the shop, where the still
 * pack stands in an alcove — a back wall, a floor, and a two-pixel lit join
 * where they meet — and the note there names the load-bearing pixel: *without a
 * line where two planes meet they read as one gradient and the pack goes back to
 * floating.* So this is that alcove at room scale, deliberately in the same
 * language, because tearing the pack should put the player **in the same room**
 * they were just looking into rather than in a different, emptier one.
 *
 * Five elements, one job each:
 *
 * | element | plane (§2) | what it is |
 * |---|---|---|
 * | `.rw-room-wall`  | atmosphere | the back wall, lit from 315°, with a broad pool behind where the cards stand, dissolving at its own top edge rather than ending at one |
 * | `.rw-room-floor` | midground  | the table, from the horizon down, with the lit join across its back edge and a near edge that dissolves |
 * | `.rw-room-beam`  | atmosphere | the key light itself, a shaft descending from the top-left onto the cards |
 * | `.rw-room-pool`  | midground  | the light the cards stand in, in whatever the best card so far is worth |
 * | `.rw-room-sweep` | midground  | one soft specular crawling the floor on an 11s period |
 * | `.rw-room-motes` | atmosphere | dust in the beam, two layers on different periods |
 *
 * ## The third correction: a room with no light *above* the subject is a band of void
 *
 * Photographed at 1600×900 and measured off the pixels — per scanline, the 99th
 * percentile of luminance, so that module B's grain cannot be mistaken for
 * content — **43.9% of the frame had nothing in it brighter than 24% grey**, and
 * 218 of those rows were one unbroken band immediately under the title. The
 * cause was two decisions that were each right on their own. `.rw-room-wall`
 * masks its own top 30% to *fully* transparent, so that a wall lit from 315°
 * does not draw a bright hard line across the ceiling; and its only source, the
 * pool, sits at `50% 104%` — below the wall's own bottom edge. Between them the
 * upper third of the room was mathematically black.
 *
 * A room lit from below its own back wall is also the wrong picture. §0 of the
 * foundation contract puts the key at 315° everywhere, and here that light is
 * *in shot* — so it is drawn: a shaft entering top-left, descending at 45° and
 * landing where the cards stand, with the pool underneath it as the place it
 * lands and the motes already in the air to catch it. The dead band stops being
 * dead because the thing filling it is the same light every surface in the game
 * claims to be lit by.
 *
 * The horizon is **measured, never guessed**, for the reason `shopScreen.ts`
 * spells out about `--pack-base`: the card grid is sized from the viewport by
 * `fit()`, so where its base lands moves with the window, with the interface
 * scale, and with whether the pull is five cards or ten. A join line at a fixed
 * percentage is right at 1600×900 and draws itself across the middle of the
 * cards at 844×390. `layoutRoom()` writes the real number.
 *
 * ## Why this sheet still lives here and not in `rewardsTheme.ts`
 *
 * It landed here originally because that file belonged to somebody else that
 * wave. Both are in one pair of hands now, so the note that said "fold it in
 * whenever they are" has come due — except that the reason to keep it separate
 * turned out to be better than the reason to merge it: this sheet has to
 * out-specify two rules in the theme (`:root[data-gfx-tier="low"]
 * .rw-open-veil` is (0,3,0)), and it does that by *ordering* rather than by
 * `!important`, because it is appended to the head after `installRewardsTheme()`
 * has run. Merging it would mean re-deciding those specificities by hand for no
 * gain a player can see.
 */
const ROOM_STYLE_ID = "hb-reveal-room";

const ROOM_CSS = `
/* Opaque. Written at three specificities because the theme sheet lowers the
   alpha again for the low tier, and that rule is (0,3,0). */
.rw-open-veil,
:root .rw-open-veil,
:root[data-gfx-tier="low"] .rw-open-veil {
  background-color: var(--bg-void);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/*
 * The room. Everything in it is positioned off --rw-horizon, which is the
 * distance from the top of the overlay to the line the cards stand on, written
 * by layoutRoom() from the grid's own measured box.
 */
.rw-open-room {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  --rw-horizon: 62%;
  /* The vignette, and nothing else. The wall and the floor are elements now,
     because two planes that meet need an edge between them and a background
     layer has no edge to give.

     It is deliberately heavy. §6 asks the screen to resolve into a light mass
     and a dark mass when squinted at, and the first cut of this room failed
     that in the other direction from the void it replaced: a broad mid-purple
     wash top to bottom, everything the same value, nothing reading. The corners
     go to black so the pool behind the cards has something to be brighter
     *than*. */
  background: radial-gradient(118% 84% at 50% 50%, transparent 16%, rgb(0 0 0 / 0.55) 62%, rgb(0 0 0 / 0.9) 100%);
}

.rw-open-room > span { position: absolute; left: 0; right: 0; display: block; }

/* The back wall. Its pool is centred behind the cards and sits low, which is
   what makes the room read as lit from in front of the player rather than from
   nowhere; the 315° ramp over the top of it is the same key light every other
   surface in the game carries. */
.rw-room-wall {
  top: 0;
  bottom: calc(100% - var(--rw-horizon));
  /* The pool is tight and the wall around it is nearly black: a broad soft
     light on a broad soft wall is fog, and fog has no planes in it.
     Above it, the lamp — a broad fall from the top-left corner, which is where
     the beam below enters and the only place on this wall §0 permits a source
     to be. It is a third of the pool's strength and four times its area, so it
     lifts the ceiling out of black without competing with the thing the cards
     are standing in. */
  background:
    radial-gradient(40% 66% at 50% 104%, rgb(from var(--rw-accent, #b56cff) r g b / 0.34), rgb(from var(--rw-accent, #b56cff) r g b / 0) 76%),
    radial-gradient(58% 52% at 10% -6%, rgb(from var(--rw-accent, #b56cff) r g b / 0.26), rgb(from var(--rw-accent, #b56cff) r g b / 0) 78%),
    linear-gradient(var(--light-sweep, 135deg), rgb(34 24 62 / 0.42) 0%, rgb(6 3 14 / 0.86) 74%);
  /* A wall with a hard line across its top is a second panel — but a mask that
     runs all the way to zero deletes the ceiling rather than softening it, and
     measured, that erasure *was* the 218px dead band. It ramps from a third
     instead: enough to kill the ramp's own bright top edge, not enough to make
     the upper room a hole. */
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.34) 0%, rgb(0 0 0 / 0.78) 16%, #000 34%);
  -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.34) 0%, rgb(0 0 0 / 0.78) 16%, #000 34%);
  transition: background 620ms var(--ease-arrive, ease-out);
}

/*
 * The key light itself.
 *
 * A single soft shaft, entering at the top-left and descending to the right at
 * 45° — which is 315° stated as a direction of travel rather than as a gradient
 * angle, and therefore the same light the rim on every panel in the game claims.
 * It is drawn as one diagonal band across an oversized child rather than as a
 * clipped trapezoid, because a clip-path has hard edges and a shaft of light has
 * none; the blur is what makes it air rather than a shape.
 *
 * \`linear-gradient(45deg, …)\` puts its axis towards the top-right, so its bands
 * of constant colour run top-left to bottom-right. That is the one detail worth
 * stating, because the intuitive angle is the perpendicular one and picking it
 * points the light the wrong way across the room.
 *
 * The whole element is masked at both ends: it must not draw a line along the
 * ceiling, and it must die *before* the horizon rather than crossing it, or the
 * shaft continues through the table it is supposed to be landing on.
 */
.rw-room-beam {
  top: 0;
  bottom: calc(100% - var(--rw-horizon));
  overflow: hidden;
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.45) 0%, #000 26%, #000 72%, rgb(0 0 0 / 0) 100%);
  -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.45) 0%, #000 26%, #000 72%, rgb(0 0 0 / 0) 100%);
}

.rw-room-beam::before {
  content: "";
  position: absolute;
  inset: -34% -18%;
  background: linear-gradient(
    45deg,
    rgb(from var(--rw-accent, #b56cff) r g b / 0) 30%,
    rgb(from var(--rw-accent, #b56cff) r g b / 0.20) 41%,
    rgb(255 255 255 / 0.15) 48%,
    rgb(from var(--rw-accent, #b56cff) r g b / 0.20) 55%,
    rgb(from var(--rw-accent, #b56cff) r g b / 0) 66%
  );
  /* Static, so the blur is one paint into a layer the compositor then owns —
     the animation below moves and fades that layer and never re-blurs it.
     18 rather than 26: at the wider radius the shaft stopped being a shaft and
     became an even lift across the top of the room, which is fog again — §6's
     value structure needs the light to have an edge somewhere. */
  filter: blur(18px);
  animation: rw-room-beam 13s var(--ease-sweep, ease-in-out) infinite;
}

/* Air moving through a beam, on a period long enough that nothing in it is ever
   the thing the eye is following. */
@keyframes rw-room-beam {
  0%, 100% { opacity: 0.7; transform: translate3d(-1.4%, 0, 0) scaleX(0.98); }
  50%      { opacity: 1; transform: translate3d(1.4%, 0, 0) scaleX(1.05); }
}

/* The floor. It runs past the bottom of the overlay rather than stopping at it,
   so the surface recedes under the footer instead of ending at a second edge. */
.rw-room-floor {
  top: var(--rw-horizon);
  bottom: -14%;
  background:
    /* the light the wall bounces onto the floor, strongest at the back */
    linear-gradient(to bottom, rgb(from var(--rw-accent, #b56cff) r g b / 0.15) 0%, rgb(0 0 0 / 0) 54%),
    linear-gradient(var(--light-sweep, 135deg), rgb(30 21 54 / 0.72) 0%, rgb(5 3 12 / 0.86) 100%);
  mask-image: linear-gradient(to bottom, #000 34%, transparent 98%);
  -webkit-mask-image: linear-gradient(to bottom, #000 34%, transparent 98%);
  transition: background 620ms var(--ease-arrive, ease-out);
}

/* The join: two hairlines, dark over lit, fading at both ends per §7. This is
   the single most load-bearing pixel in the room — it is the difference between
   two planes meeting and one gradient. */
.rw-room-floor::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background-image:
    linear-gradient(90deg, transparent, var(--hairline-dark) 18%, var(--hairline-dark) 82%, transparent),
    linear-gradient(90deg, transparent, var(--hairline-lit) 18%, var(--hairline-lit) 82%, transparent);
  background-repeat: no-repeat;
  background-size: 100% 1px, 100% 1px;
  background-position: 0 0, 0 100%;
}

/* The pool the cards stand in, in whatever the best card so far is worth — it
   reads --rw-accent, which \`flip\` re-points at the rarity ink, so a legendary
   lights the floor as well as the room. An ellipse rather than a circle because
   the floor is seen at a shallow angle, and wider than the grid because a light
   three metres up says so. */
.rw-room-pool {
  left: 50%;
  right: auto;
  top: var(--rw-horizon);
  width: min(78%, 1080px);
  height: min(24vh, 190px);
  /* Two thirds of it on the floor rather than half. This is the light the cards
     are standing *in*, and it is what the contact shadows underneath them are
     subtracted from — on a floor with no light on it a black ellipse is a
     smudge, which is the note screens.css already makes about the shop's pack. */
  translate: -50% -34%;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    rgb(from var(--rw-accent, #b56cff) r g b / 0.46) 0%,
    rgb(from var(--rw-accent, #b56cff) r g b / 0.17) 46%,
    rgb(from var(--rw-accent, #b56cff) r g b / 0) 80%
  );
  filter: blur(16px);
  transition: background 620ms var(--ease-arrive, ease-out);
  animation: rw-room-pool 7.4s var(--ease-sweep, ease-in-out) infinite;
}

/*
 * §3: idle is never dead. Measured on the finished reveal before any of this
 * existed, the screen came back at a median delta of **0.282 per 200ms** against
 * a Hearthstone floor of 1.71 and a floor *minimum* of 0.50 — the moment a card
 * game is built around, more frozen than the reference at its quietest. Three
 * things move, all on the compositor, all on periods between 7 and 27 seconds so
 * that none of them competes with the cards.
 */
@keyframes rw-room-pool {
  0%, 100% { transform: scale(0.94); opacity: 0.74; }
  50%      { transform: scale(1.08); opacity: 1; }
}

/* The specular crawling the floor. One wide soft band on an 11s traverse: a
   large area at a low amplitude, which is how a room breathes without anything
   in it appearing to move. */
.rw-room-sweep {
  top: var(--rw-horizon);
  bottom: -14%;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
  -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
}

.rw-room-sweep::before {
  content: "";
  position: absolute;
  inset: -20% -60%;
  background: linear-gradient(
    76deg,
    rgb(255 255 255 / 0) 34%,
    rgb(from var(--rw-accent, #e6d7ff) r g b / 0.15) 50%,
    rgb(255 255 255 / 0) 66%
  );
  animation: rw-room-sweep 11s linear infinite;
}

@keyframes rw-room-sweep {
  0%   { transform: translate3d(-46%, 0, 0); }
  100% { transform: translate3d(46%, 0, 0); }
}

/*
 * Dust in the beam. Two layers on different periods so the field never visibly
 * repeats, drawn as radial-gradient dots on one element each and moved with
 * transform — never background-position, which is the paint-per-frame mistake
 * that halved the lobby's frame rate across twenty-one plates.
 */
.rw-room-motes {
  top: -30%;
  bottom: -30%;
  opacity: 0.55;
  background-image:
    radial-gradient(1.4px 1.4px at 12% 22%, rgb(226 205 255 / 0.5), transparent 100%),
    radial-gradient(1.2px 1.2px at 31% 68%, rgb(226 205 255 / 0.38), transparent 100%),
    radial-gradient(1.6px 1.6px at 47% 12%, rgb(255 255 255 / 0.42), transparent 100%),
    radial-gradient(1.2px 1.2px at 63% 54%, rgb(226 205 255 / 0.44), transparent 100%),
    radial-gradient(1.5px 1.5px at 78% 31%, rgb(255 255 255 / 0.34), transparent 100%),
    radial-gradient(1.3px 1.3px at 88% 76%, rgb(226 205 255 / 0.42), transparent 100%),
    radial-gradient(1.2px 1.2px at 22% 88%, rgb(226 205 255 / 0.3), transparent 100%),
    radial-gradient(1.4px 1.4px at 55% 84%, rgb(255 255 255 / 0.3), transparent 100%);
  animation: rw-room-motes-a 19s linear infinite;
}

.rw-room-motes::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(1.1px 1.1px at 8% 58%, rgb(226 205 255 / 0.34), transparent 100%),
    radial-gradient(1.3px 1.3px at 38% 34%, rgb(255 255 255 / 0.3), transparent 100%),
    radial-gradient(1.1px 1.1px at 68% 18%, rgb(226 205 255 / 0.36), transparent 100%),
    radial-gradient(1.2px 1.2px at 84% 62%, rgb(226 205 255 / 0.28), transparent 100%),
    radial-gradient(1.1px 1.1px at 94% 40%, rgb(255 255 255 / 0.26), transparent 100%);
  animation: rw-room-motes-b 27s linear infinite;
}

@keyframes rw-room-motes-a {
  0%   { transform: translate3d(0, 8%, 0); }
  100% { transform: translate3d(-2%, -8%, 0); }
}

@keyframes rw-room-motes-b {
  0%   { transform: translate3d(0, -7%, 0); }
  100% { transform: translate3d(3%, 7%, 0); }
}

/* Module B's tile, not a second grain generator. §1: 2–6% so the field is not
   mathematically smooth. */
.rw-open-room::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--tex-grain-hero, none);
  background-size: var(--tex-grain-hero-size, auto);
  opacity: 0.5;
}

:root[data-contrast="high"] .rw-open-room::after { opacity: 0; }

/*
 * High contrast wants the room *quieter*, not gone. Deleting it puts the cards
 * back in a void, which is the defect this whole block exists to answer — so the
 * wall and the floor keep their planes and their join, and lose only the
 * coloured light between them.
 */
:root[data-contrast="high"] .rw-room-wall {
  background: linear-gradient(var(--light-sweep, 135deg), #16102c 0%, #0a0618 100%);
}
:root[data-contrast="high"] .rw-room-floor {
  background: linear-gradient(var(--light-sweep, 135deg), #120d24, #06040e);
}
:root[data-contrast="high"] .rw-room-pool,
:root[data-contrast="high"] .rw-room-motes,
:root[data-contrast="high"] .rw-room-beam,
:root[data-contrast="high"] .rw-room-sweep { display: none; }

/*
 * Reduced motion keeps the room and stops the drift, per §3's hard requirement
 * that the decorative layer dies and the functional one survives. The pool holds
 * at its own mid-point rather than at whichever end of a keyframe the engine
 * happens to sample, so the light does not change when the setting does.
 */
:root[data-reduced-motion="true"] .rw-room-pool,
:root[data-reduced-motion="true"] .rw-room-sweep::before,
:root[data-reduced-motion="true"] .rw-room-beam::before,
:root[data-reduced-motion="true"] .rw-room-motes,
:root[data-reduced-motion="true"] .rw-room-motes::after {
  animation: none;
}
:root[data-reduced-motion="true"] .rw-room-pool { transform: scale(1.01); opacity: 0.9; }
/* Held at the drift's own mid-point, like the pool, so switching the setting
   does not change how lit the room is. */
:root[data-reduced-motion="true"] .rw-room-beam::before { opacity: 0.86; }

/*
 * The low tier drops the two effects that each cost a full-screen composited
 * layer and keeps both planes, the join and the pool. A phone that cannot afford
 * dust can still afford a table.
 *
 * The beam stays, and loses its blur. It is the light the room is lit by rather
 * than an ornament on it — deleting it is what put the 218px of void back — and
 * a 26px blur over a full-width layer is the one part of it a low tier cannot
 * afford. The gradient's own stops are soft enough to survive without it; what
 * goes is the last few pixels of falloff at the shaft's edges.
 */
:root[data-gfx-tier="low"] .rw-room-motes,
:root[data-gfx-tier="low"] .rw-room-sweep { display: none; }
:root[data-gfx-tier="low"] .rw-room-beam::before { filter: none; }

/* -------------------------------------------------------------------------
   things standing on the floor
   ------------------------------------------------------------------------- */

/*
 * Every object in the room casts onto it.
 *
 * A drop shadow attached to a card travels with the card and says "this is a
 * picture with a shadow filter on it". A cast lying on the floor stays where the
 * light puts it, and that is the whole difference: when the pack bobs on its
 * 5.2s float the cast underneath it does **not** bob, it swells and softens,
 * which is §3's secondary motion — "when the main thing moves, something small
 * moves because of it".
 */
.rw-pack-cast {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 50%;
  /* Cut from the pack's own width rather than from the viewport a second time.
     The two used to be independent min() expressions against different limits,
     which meant the shadow was the right size for the object at exactly one
     window height and drifted apart everywhere else. */
  width: calc(var(--rw-pack-w, min(34vh, 320px)) * 1.15);
  height: calc(var(--rw-pack-w, min(34vh, 320px)) * 0.238);
  translate: -50% 0;
  margin-top: calc(var(--rw-pack-w, min(34vh, 320px)) * 0.52);
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.74) 0%, rgb(0 0 0 / 0.32) 46%, rgb(0 0 0 / 0) 78%);
  filter: blur(9px);
  animation: rw-pack-cast 5.2s var(--ease-sweep, ease-in-out) infinite;
}

/* Counter-phase to rw-pack-float: the pack is highest when the cast is widest
   and faintest, which is what a shadow does when its object lifts. */
@keyframes rw-pack-cast {
  0%, 100% { transform: scale(1.07); opacity: 0.7; }
  50%      { transform: scale(0.89); opacity: 1; }
}

.rw-pack-cast.rw-torn {
  animation: rw-cast-out 380ms var(--ease-leave) both;
}

@keyframes rw-cast-out {
  from { opacity: 1; }
  to   { opacity: 0; transform: scale(1.5); }
}

:root[data-reduced-motion="true"] .rw-pack-cast { animation: none; }

/*
 * And the cards. \`.reveal-slot::before\` is the rarity aura, so the contact
 * shadow takes \`::after\` — the only pseudo-element left on the slot, and it
 * wants to be one, because a real element here would have to survive both the
 * deal animation's transform and the flip's 3D context.
 *
 * It is drawn from the frame the card lands rather than on \`.shown\`, unlike
 * everything else rarity does in this component: a face-down card standing on a
 * table is still standing on a table, and a shadow that appeared at the moment
 * of the flip would announce the flip. What escalates with rarity is the pool,
 * not the cast.
 */
.reveal-slot::after {
  content: "";
  position: absolute;
  z-index: -2;
  left: 50%;
  bottom: -7%;
  width: 116%;
  height: 15%;
  translate: -50% 0;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.68) 0%, rgb(0 0 0 / 0.28) 50%, rgb(0 0 0 / 0) 78%);
  filter: blur(6px);
  opacity: 0;
  transition: opacity 320ms var(--ease-arrive);
}

/* It arrives with the card and not before — a slot that has not been dealt yet
   is not standing anywhere. */
.reveal-slot:not(.rw-pending)::after { opacity: 1; }

/*
 * And once they are face up, the cards themselves breathe.
 *
 * This is the difference between the finished reveal measuring 0.70 and 1.7 per
 * 200ms, and the reason is arithmetic rather than taste: the room's own drift is
 * a low-amplitude change over a dark field, and dark pixels moving slightly are
 * a small number. The cards are the brightest, highest-contrast objects on the
 * screen, so four pixels of travel on their edges is worth more than everything
 * the wall can do. It is also the honest picture — the player is looking at
 * *these*, and a reveal that ends by freezing the five cards it just handed over
 * is the moment the set-piece stops being one.
 *
 * The keyframes carry \`--rar-lift\` themselves because \`.reveal-slot.shown\`
 * expresses the rarity lift as a transform, and an animation on the same
 * property replaces it outright — a legendary that lost its 1.09 the moment it
 * started idling would be a downgrade delivered by an ambient effect.
 *
 * The delay is the flip's own length, so the transition owns the turn and the
 * animation takes over from exactly the value the transition landed on. No fill
 * mode, deliberately: \`backwards\` would apply the 0% frame during the delay and
 * fight the flip.
 *
 * The **period** is what differs per card, not the delay. A stagger written as
 * delay would leave the last card of a ten-pull motionless for two seconds after
 * it turned — the one card in the pull the player is actually looking at. Giving
 * each slot its own duration instead means every card starts breathing the
 * moment it settles and the field decoheres by itself within a few cycles, which
 * is what stops five cards nodding in unison like a row of metronomes.
 */
.reveal-slot.shown {
  animation: rw-card-rest var(--rw-rest-dur, 6.4s) var(--ease-sweep, ease-in-out) 700ms infinite;
}

@keyframes rw-card-rest {
  0%, 100% {
    transform: scale(var(--rar-lift, 1)) translate3d(0, 0, 0);
    filter: brightness(1);
  }
  50% {
    transform: scale(calc(var(--rar-lift, 1) * 1.014)) translate3d(0, -5px, 0);
    filter: brightness(1.05);
  }
}

/* The cast does not rise with the card it belongs to — it spreads and softens,
   which is the same secondary-motion rule the pack's cast follows. Only scale
   and opacity here: the -50% centring is on the \`translate\` property, which
   composes ahead of \`transform\`, so repeating it would move the shadow a whole
   width to the left. */
.reveal-slot.shown::after {
  animation: rw-card-cast var(--rw-rest-dur, 6.4s) var(--ease-sweep, ease-in-out) 700ms infinite;
}

@keyframes rw-card-cast {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.12); opacity: 0.7; }
}

:root[data-reduced-motion="true"] .reveal-slot.shown,
:root[data-reduced-motion="true"] .reveal-slot.shown::after { animation: none; }

/*
 * The low tier keeps the movement and loses the light.
 *
 * A ten-pull is ten cards each running two infinite animations, and one of them
 * declares \`filter\`. Transform and opacity are free — the compositor already
 * owns the layer — but a filter is a per-frame pass over the card's own pixels,
 * and ten of those at 512x680 is the shape of effect §9 calls a bug rather than
 * a feature on a phone. The travel is what reads as life anyway; the 5%
 * brightness was the part nobody could name.
 */
:root[data-gfx-tier="low"] .reveal-slot.shown {
  animation-name: rw-card-rest-flat;
}

@keyframes rw-card-rest-flat {
  0%, 100% { transform: scale(var(--rar-lift, 1)) translate3d(0, 0, 0); }
  50%      { transform: scale(calc(var(--rar-lift, 1) * 1.014)) translate3d(0, -5px, 0); }
}
`;

/**
 * Idempotent by id and not by a module-level flag, for the same reason
 * `installRewardsTheme` is: a hot reload replaces the module and not the
 * document, and two copies of a sheet is two copies of everything in it.
 */
function installRevealRoom(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(ROOM_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ROOM_STYLE_ID;
  style.textContent = ROOM_CSS;
  doc.head.append(style);
}

/* -------------------------------------------------------------------------
   the shape of a reveal
   ------------------------------------------------------------------------- */

export interface RevealEntry {
  cardId: string;
  rarity: Rarity;
  isNew?: boolean | undefined;
  convertedToSignal?: number | undefined;
  featured?: boolean | undefined;
  wishlisted?: boolean | undefined;
  /** the pity guarantee fired for this card */
  guaranteed?: boolean | undefined;
}

export interface PackSummaryItem {
  label: string;
  value?: number | undefined;
  coin?: CoinKind | undefined;
  icon?: IconId | undefined;
}

export interface PackOpeningOptions {
  content: ContentIndex;
  cards: readonly RevealEntry[];
  /** the small caps line above the title */
  eyebrow: string;
  /** the display line: "Five cards", "Ten pulls" */
  title: string;
  /** what the pack is called on its hint, in the imperative */
  tearLabel?: string;
  /** the room's light, as a hex; the banner passes its own palette */
  accent?: string;
  /** the object the player tears, and the back every card wears */
  back?: CardBackStyle;
  summary?: readonly PackSummaryItem[];
  /** a sentence under the summary — cosmetics granted, conversions explained */
  note?: string;
  onCollection?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** wallet chips to count up once the reveal is over */
  walletHost?: ParentNode | undefined;
}

export interface PackOpening {
  /** turn everything face up now */
  revealAll: () => void;
  close: () => void;
  readonly element: HTMLElement;
}

/* -------------------------------------------------------------------------
   rarity
   ------------------------------------------------------------------------- */

const RARITY_RANK: Readonly<Record<Rarity, number>> = { common: 0, rare: 1, epic: 2, legendary: 3 };

const RARITY_INK: Readonly<Record<Rarity, string>> = {
  common: "#c9c3dc",
  rare: "#4d9fff",
  epic: "#c168ff",
  legendary: "#ffb43d",
};

/** How hard the room reacts to a card of each rarity, 0–1. */
const RARITY_GLOW: Readonly<Record<Rarity, number>> = { common: 0, rare: 0.22, epic: 0.55, legendary: 1 };

/**
 * The sting, per rarity, on the frame the face becomes visible.
 *
 * There are exactly two pack sounds in the manifest and there is no budget for
 * more, so the tiering is done with gain and playback rate rather than with four
 * files: a Legendary is the same cue slowed to 0.82 and played at full, which
 * lands lower and longer than the Rare's 1.12. A chime on every common would
 * make the rare reveal mean nothing, which is the opposite of what the sound is
 * for — so a common gets the UI tick and not the pack cue at all.
 */
function sting(rarity: Rarity): void {
  switch (rarity) {
    case "common":
      audio.play("sfx.ui.click", { volume: 0.3 });
      return;
    case "rare":
      audio.play("sfx.pack.rareReveal", { volume: 0.55, rate: 1.12 });
      return;
    case "epic":
      audio.play("sfx.pack.rareReveal", { volume: 0.8, rate: 0.98 });
      return;
    case "legendary":
      audio.play("sfx.pack.rareReveal", { volume: 1, rate: 0.82 });
  }
}

/* -------------------------------------------------------------------------
   timing
   ------------------------------------------------------------------------- */

/**
 * How much room a card's caption needs below it, in pixels.
 *
 * `.reveal-tag` hangs at `bottom: -26px` and stands about 18px tall, so it lives
 * entirely outside its own slot. This is both the height `fit()` reserves per
 * row and the `row-gap` the grid is given, written from one place because they
 * are the same fact.
 */
const CAPTION_LANE = 46;

const DEAL_STEP = 55;
const DEAL_MS = 560;
const FLIP_MS = 480;
/** How long the player is given before the reveal starts playing itself. */
const IDLE_BEFORE_AUTO = 1800;
/** And how fast it goes once it has: overlapping, never a queue. */
const AUTO_STEP = 620;
/** A "reveal all" cascade is faster than the auto one — it was asked for. */
const RUSH_STEP = 110;

/* -------------------------------------------------------------------------
   the component
   ------------------------------------------------------------------------- */

let openInstance: PackOpening | null = null;

/**
 * Open a pack. One at a time, always on `document.body`.
 *
 * On the body rather than inside the screen because every claim and purchase
 * path in this domain re-renders its screen with `innerHTML`, and an overlay
 * inside that tree is destroyed mid-animation. It is also the honest home for
 * §2's overlay plane: this is the only thing on screen, and everything behind it
 * is blurred and darkened rather than merely covered.
 */
export function openPack(options: PackOpeningOptions): PackOpening {
  installRewardsTheme();
  // ...and then the room, which has to land after the sheet it out-specifies.
  installRevealRoom();
  openInstance?.close();

  const cards = orderForDrama(options.cards);
  const accent = options.accent ?? "#b56cff";
  const back = options.back ?? HOUSE_BACK;
  const backArt = cardBackThumb(back, 0.55);
  const columns = Math.min(5, Math.max(1, cards.length));
  const rows = Math.ceil(cards.length / columns);

  const overlay = document.createElement("div");
  overlay.className = "rw-open shop-reveal";
  overlay.id = "shop-reveal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${options.eyebrow} — ${options.title}`);
  overlay.style.setProperty("--rw-accent", accent);

  overlay.innerHTML =
    `<div class="rw-open-veil"></div>` +
    `<div class="rw-open-room" aria-hidden="true">` +
    `<span class="rw-room-wall"></span>` +
    `<span class="rw-room-floor"></span>` +
    `<span class="rw-room-beam"></span>` +
    `<span class="rw-room-pool"></span>` +
    `<span class="rw-room-sweep"></span>` +
    `<span class="rw-room-motes"></span>` +
    `</div>` +
    `<div class="rw-open-glow"></div>` +
    `<header class="rw-open-head">` +
    `<div class="rw-open-title">` +
    `<span class="t-label">${esc(options.eyebrow)}</span>` +
    /* The size is a stylesheet's job, not an inline one: on a 390px-tall phone
       the masthead has to be able to shrink, and an inline font-size cannot be
       out-specified by a media query without `!important`. */
    `<h2 class="t-display rw-open-name">${esc(options.title)}</h2>` +
    `</div>` +
    `<div class="rw-open-count" aria-hidden="true">` +
    cards.map(() => `<span class="rw-pip"></span>`).join("") +
    `</div>` +
    `</header>` +
    `<div class="rw-stage">` +
    `<div class="reveal-cards" style="--rw-cols:${columns};--rw-row-gap:${CAPTION_LANE}px">` +
    cards.map((entry, index) => slotMarkup(options.content, entry, index, cards.length, backArt)).join("") +
    packMarkup(backArt, options.tearLabel ?? "Tear it open") +
    `</div>` +
    /*
     * One line under the cards, and it says whichever of the two things there is
     * to say. The instruction and the result are the same beat of the
     * composition — the reveal ends by answering the question the hint asked —
     * so they share a grid cell rather than living in two different strips with
     * a band of floor between them. See `.rw-open-msg`.
     */
    `<div class="rw-open-msg">` +
    hintMarkup(options.tearLabel ?? "Tear it open") +
    `<div class="rw-open-summary">${summaryMarkup(options)}</div>` +
    `</div>` +
    `</div>` +
    `<footer class="rw-open-foot mat-panel">` +
    `<div class="rw-open-actions">` +
    `<button class="mat-panel act rw-back" id="reveal-all" type="button">${icon("skip-end")}<span>Reveal all</span></button>` +
    (options.onCollection
      ? `<button class="mat-panel act rw-back" id="reveal-collection" type="button">${icon("collection")}<span>Collection</span></button>`
      : "") +
    `<button class="mat-hero act rw-back" id="reveal-done" type="button" disabled>${icon("check")}<span>Done</span></button>` +
    `</div>` +
    `</footer>`;

  document.body.append(overlay);

  const stage = overlay.querySelector<HTMLElement>(".rw-stage")!;
  const grid = overlay.querySelector<HTMLElement>(".reveal-cards")!;
  const glow = overlay.querySelector<HTMLElement>(".rw-open-glow")!;
  const foot = overlay.querySelector<HTMLElement>(".rw-open-foot")!;
  const room = overlay.querySelector<HTMLElement>(".rw-open-room")!;
  const pack = overlay.querySelector<HTMLElement>(".rw-pack");
  const packCast = overlay.querySelector<HTMLElement>(".rw-pack-cast");
  const hint = overlay.querySelector<HTMLElement>(".rw-pack-hint");
  const message = overlay.querySelector<HTMLElement>(".rw-open-msg");
  const pips = [...overlay.querySelectorAll<HTMLElement>(".rw-pip")];
  const slots = [...overlay.querySelectorAll<HTMLElement>(".reveal-slot")];
  const doneButton = overlay.querySelector<HTMLButtonElement>("#reveal-done")!;
  const allButton = overlay.querySelector<HTMLButtonElement>("#reveal-all")!;

  const returnFocus = document.activeElement as HTMLElement | null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => {
    const id = globalThis.setTimeout(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, ms));
    timers.add(id);
  };

  let torn = false;
  let closed = false;
  let best = -1;
  const shown = new Set<number>();
  let autoTimer: ReturnType<typeof setTimeout> | null = null;

  /* --- layout ----------------------------------------------------------- */

  /**
   * How big a card can be here.
   *
   * Both axes, because the height is what actually binds: at 844×390 — a phone
   * in landscape, which every screen has to work at — five cards across is
   * limited by 390px of viewport minus the header, the footer and the room the
   * captions need under each card, not by width. Sizing on width alone produces
   * a grid that is beautiful at 1600×900 and clipped on a phone.
   *
   * ## What was wrong with it, measured
   *
   * The result of this function was clamped to **212px**, and at 1600×900 the
   * two real constraints were 282 (width) and 443 (height) — so on the frame
   * this set-piece is designed against, the size of the most important object in
   * the game was decided by a magic number rather than by the room. Photographed,
   * five cards occupied a hull of 1,134×289: **22.8% of the frame**, with 312px
   * of nothing above them and 299 below. The cap is gone. Both constraints stay,
   * because both are real, and between them there is no viewport where a card
   * can grow past what the grid can hold.
   *
   * The gap is read rather than assumed for the same reason. The stylesheet says
   * `clamp(6px, 1.1vw, 18px)`, which is 17.6px at 1600 and 14.08 at 1280; this
   * arithmetic hard-coded 14 and therefore over-estimated the room available on
   * every viewport above 1,273px wide.
   */
  const fit = (): void => {
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 14;
    const width = stage.clientWidth || overlay.clientWidth || 1280;
    /*
     * The message is a row of the stage, not an overlay on it, so the grid gets
     * the stage minus whatever that row is currently occupying — measured rather
     * than assumed, because it is two lines while the pack is closed, two
     * different lines during the reveal, and a summary that may wrap to three on
     * a phone once the pull is over.
     *
     * It is the *row* that is measured and not the hint inside it. The hint used
     * to be the row, and it used to be removed outright when the summary
     * arrived — which changed the stage's height at the one moment the cards are
     * standing still and being looked at.
     */
    const messageBox = message?.isConnected ? message.getBoundingClientRect().height : 0;
    const height = (stage.clientHeight || 420) - messageBox;
    const byWidth = (width - gap * (columns - 1) - 24) / columns;
    /*
     * `CAPTION_LANE` is subtracted once per row *and* published as the grid's
     * own `row-gap`, so the space this arithmetic reserves is the space the
     * layout actually leaves. They used to be two numbers — 34 here, and the
     * column gap in the stylesheet for the rows as well — which is how a
     * ten-pull ended up drawing the first row's captions underneath the second
     * row's cards while `fit()` believed it had made room for them.
     */
    const byHeight = ((height - CAPTION_LANE * (rows - 1) - CAPTION_LANE * rows) / rows) * (512 / 680);
    const size = Math.max(66, Math.floor(Math.min(byWidth, byHeight)));
    grid.style.setProperty("--rw-card-w", `${size}px`);
  };

  /**
   * Where the wall meets the floor, in overlay pixels, measured.
   *
   * The horizon has to be the line the cards' own bases stand on, and where that
   * is depends on the viewport, the interface scale, whether the pull is five
   * cards or ten, and what `fit()` decided a card could be — four inputs, none
   * of which a percentage in a stylesheet can see. `shopScreen.ts` learned the
   * same lesson on `--pack-base`: a join drawn at a fixed fraction was right at
   * one window size and cut the object in half at the next.
   *
   * Before the tear it follows the *pack*, because the pack is the only thing
   * standing in the room; afterwards it follows the grid. The transition on
   * `top` is deliberately absent — the wall and the floor animate their fill,
   * not their geometry, so the horizon moving is a layout change and wants to
   * land with the deal rather than lag behind it.
   */
  const layoutRoom = (): void => {
    const overlayBox = overlay.getBoundingClientRect();
    if (overlayBox.height <= 0) return;
    const subject = torn || !pack?.isConnected ? grid : pack;
    const box = subject.getBoundingClientRect();
    if (box.height <= 0) return;
    /*
     * A few pixels *below* the base, not level with it. A shadow needs somewhere
     * to fall, and a card whose bottom edge sits exactly on the join reads as
     * inserted into the table rather than standing on it.
     */
    const base = box.bottom - overlayBox.top + Math.min(26, box.height * 0.07);
    const pct = Math.max(34, Math.min(86, (base / overlayBox.height) * 100));
    room.style.setProperty("--rw-horizon", `${pct.toFixed(2)}%`);
  };

  fit();
  layoutRoom();
  const onResize = (): void => {
    fit();
    layoutRoom();
  };
  globalThis.addEventListener("resize", onResize);
  /*
   * A ResizeObserver as well as a resize listener, and for the same two reasons
   * the shop's alcove has one: the first read happens while the tree is still
   * settling and returns a box that is about to change, and the interface scale
   * moves this number without dispatching anything at all.
   */
  const roomObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => layoutRoom());
  roomObserver?.observe(grid);
  roomObserver?.observe(stage);

  /* --- the faces, drawn once -------------------------------------------- */

  /*
   * Every face is rendered up front, while the pack is still closed and the
   * player is looking at it. The previous implementation rewrote the overlay's
   * `innerHTML` on each of the five steps, which re-rendered every
   * already-revealed card from scratch — fifteen `renderCardToCanvas` passes for
   * a five-card pack — and, worse, structurally prevented per-card animation,
   * because each tick destroyed and recreated the DOM of every card that had
   * already turned. Nothing here is ever rebuilt; the only thing that changes on
   * a flip is one class.
   */
  const cardWidth = Number.parseInt(grid.style.getPropertyValue("--rw-card-w"), 10) || 168;

  /**
   * How wide the *bitmap* is, which is not the same question as how wide the
   * card is.
   *
   * The 1.15 is oversampling, and it was affordable when the cap held a slot to
   * 212px. Lifting the cap makes a 1600×900 slot 282, and 1.15 of that is 324 —
   * against 244 before, which is 1.77× the pixels. Measured with a `longtask`
   * observer across the anticipation beat, the old size cost five long tasks at
   * a peak of 146ms; area alone would put the new peak around 260, and a 260ms
   * task is a quarter of a second of frozen room on the beat whose entire job is
   * to look alive.
   *
   * `renderCardToCanvas` already multiplies by `devicePixelRatio`, so the
   * oversample is a second copy of the same idea: at dpr 2, a 288px render on a
   * 282px slot is a 576px backing store for 564 device pixels, which is already
   * sharp. The ceiling therefore costs nothing visible and holds the paint cost
   * to about 1.5× rather than 1.8× — and below it, on the small viewports where
   * `fit()` still returns 212 or less, the 1.15 is untouched.
   *
   * The `max` is the floor under the ceiling, and it matters for exactly one
   * shape: the banner's ×1 pull. One card is bound by height rather than by
   * width, so it is 410px wide at 1600×900 — and a flat cap of 300 would draw a
   * bitmap smaller than the object it is stretched across, on the one reveal
   * where the card *is* the whole composition. It is a single card, so paying
   * full size for it costs one paint.
   */
  const renderWidth = Math.round(Math.min(cardWidth * 1.15, Math.max(300, cardWidth)));

  const paintFace = (index: number): void => {
    const entry = cards[index];
    const card = entry ? (options.content.cards[entry.cardId] as CardDef | undefined) : undefined;
    const face = slots[index]?.querySelector<HTMLElement>(".reveal-front");
    if (!entry || !card || !face || face.childElementCount > 0) return;
    const canvas = renderCardToCanvas(card, renderWidth, {
      premium: entry.rarity === "legendary",
    });
    /*
     * `renderCardToCanvas` writes an inline `style.width` and `style.height`,
     * and an inline style beats a stylesheet rule — so `.reveal-front > canvas
     * { width: 100% }` was silently losing and every card was drawn 15% larger
     * than the slot holding it, overflowing its own caption. Overriding the
     * inline value is the only fix that does not involve `!important`.
     */
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    face.append(canvas);
  };

  /*
   * One card per frame, not five in one go.
   *
   * Measured with a `longtask` observer: rendering all five faces inside the
   * click handler produced a **440ms** task — a visible freeze on the frame the
   * player pressed Buy, which is the worst possible frame to drop. Split across
   * animation frames it is five tasks of about ninety milliseconds, spent during
   * the anticipation beat while the player is looking at a pack that has not
   * moved yet. The first face is painted synchronously so a reveal that is
   * skipped immediately still has something behind it.
   */
  /*
   * Not even the first face is drawn on the click frame.
   *
   * It used to be, with the reasoning that a reveal skipped immediately needs
   * something behind the back — but `flip` already paints on demand for exactly
   * that case, so the synchronous call was insurance against a thing that cannot
   * happen. Measured with a longtask observer, it cost **254ms** on the frame the
   * player pressed Buy, which is the single worst frame in the sequence to drop:
   * the button has depressed, the sound has fired and the screen has not moved.
   * Deferred, the same click costs about ninety, and the face is ready long
   * before the pack has been torn.
   */
  let painting = 0;
  /*
   * Measured: one face at this size costs 150–250ms of main thread, and five in
   * one task came to 440ms. A frame-per-card chain was no better — it simply
   * moved five long tasks into the deal, which is the one beat that must not
   * stutter. So the queue is *slower than the animation*: a card every 320ms,
   * always at least one ahead of the reveal, and `flip` paints on demand for the
   * case where the player skips to the end faster than the queue can run.
   *
   * 320 and not the 260 it was, because a card is bigger than it was: the space
   * between two paints has to stay longer than a paint, or the tasks stack and
   * the room stops breathing for the whole beat rather than for a frame of it.
   * The reveal cannot outrun it — the first auto-flip is 1,800ms after the tear
   * and the tear cannot happen before the player acts.
   */
  const paintQueue = (): void => {
    if (closed || painting >= cards.length) return;
    paintFace(painting);
    painting += 1;
    later(paintQueue, 320);
  };
  /*
   * 300ms, not 30. The overlay fades in over DUR.ui, and a 200ms card render
   * landing inside that window is a long task on the entrance itself — measured
   * at 211ms starting 66ms after the click, which is the fade. Nothing needs a
   * face until the pack is torn, and the pack cannot be torn until the player
   * acts, so the queue waits for the entrance to finish and then runs through
   * the anticipation beat where there is no deadline at all.
   */
  later(paintQueue, 300);

  /* --- beat 1: the tear -------------------------------------------------- */

  const tear = (): void => {
    if (torn || closed) return;
    torn = true;
    audio.play("sfx.pack.open");
    /*
     * The hint changes job rather than vanishing. Between the deal landing and
     * the first auto-flip there is about a second of stillness that is there on
     * purpose — it is the player's turn — and a stage with nothing on it saying
     * so reads as a hang rather than as an invitation.
     */
    if (hint) hint.innerHTML = `<span class="t-label">Turn them over</span><span class="rw-quiet" style="font-size:var(--fs-xs)">Click a card, or wait and they turn themselves</span>`;

    /*
     * The cast goes with the object that was standing on it. It leaves on its
     * own curve rather than on the pack's — a shadow does not fly up and
     * brighten, it spreads and fades — but it has to *start* leaving on the same
     * frame, or the room is briefly lit by a pack that is no longer there.
     */
    if (packCast) {
      packCast.classList.add("rw-torn");
      later(() => packCast.remove(), scaledDuration(380) + 40);
    }

    if (pack) {
      const from = pack.getBoundingClientRect();
      pack.classList.add("rw-torn");
      later(() => pack.remove(), scaledDuration(480) + 40);
      flash(0.14);
      dealFrom(from);
    } else {
      dealFrom(grid.getBoundingClientRect());
    }
    // The horizon was following the pack; from here it follows the cards, and it
    // moves on the same frame they start travelling towards it.
    layoutRoom();
    queueAuto(IDLE_BEFORE_AUTO);
  };

  /** Hand every slot the vector from the pack to its own resting place. */
  const dealFrom = (origin: DOMRect): void => {
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    for (const [index, slot] of slots.entries()) {
      const box = slot.getBoundingClientRect();
      const dx = cx - (box.left + box.width / 2);
      const dy = cy - (box.top + box.height / 2);
      slot.style.setProperty("--rw-from-x", `${Math.round(dx)}px`);
      slot.style.setProperty("--rw-from-y", `${Math.round(dy)}px`);
      slot.style.setProperty("--rw-from-r", `${(index - (slots.length - 1) / 2) * 5}deg`);
      slot.style.setProperty("--rw-deal-delay", `${index * DEAL_STEP}ms`);
      slot.classList.remove("rw-pending");
      slot.classList.add("rw-dealing");
    }
    later(() => {
      for (const slot of slots) slot.classList.remove("rw-dealing");
    }, scaledDuration(DEAL_MS) + DEAL_STEP * slots.length + 60);
  };

  /* --- beat 2: the reveal ------------------------------------------------ */

  const flip = (index: number, manual: boolean): void => {
    if (closed || !torn || shown.has(index)) return;
    paintFace(index);
    const slot = slots[index];
    const entry = cards[index];
    if (!slot || !entry) return;
    shown.add(index);
    slot.classList.add("shown");
    const flipper = slot.querySelector<HTMLElement>(".rw-flip");
    flipper?.setAttribute("aria-pressed", "true");
    flipper?.setAttribute("tabindex", "-1");

    /*
     * The sound and the light land on the frame the face becomes visible, which
     * is the halfway point of the rotation and not its start. §7: "sound and
     * visual land on the same frame" — a sting fired at the beginning of a
     * 480ms rotation is a sting for a card the player cannot see yet.
     */
    const half = Math.round(scaledDuration(FLIP_MS) / 2);
    later(() => {
      if (closed) return;
      sting(entry.rarity);
      burst(slot, entry.rarity);
      const rank = RARITY_RANK[entry.rarity];
      if (rank >= 2) flash(entry.rarity === "legendary" ? 0.32 : 0.18);
      const pip = pips[index];
      if (pip) {
        pip.style.setProperty("--rar-key", RARITY_INK[entry.rarity]);
        pip.dataset["on"] = "1";
      }
      if (rank > best) {
        best = rank;
        overlay.style.setProperty("--rw-accent", RARITY_INK[entry.rarity]);
        glow.style.setProperty("--rw-glow", String(RARITY_GLOW[entry.rarity]));
      }
    }, half);

    if (shown.size === slots.length) {
      later(finish, half + 260);
      return;
    }
    queueAuto(manual ? IDLE_BEFORE_AUTO : AUTO_STEP);
  };

  const nextHidden = (): number => slots.findIndex((_, index) => !shown.has(index));

  const queueAuto = (ms: number): void => {
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    if (closed) return;
    autoTimer = globalThis.setTimeout(() => {
      autoTimer = null;
      const index = nextHidden();
      if (index >= 0) flip(index, false);
    }, Math.max(60, scaledDuration(ms) || 60));
  };

  /**
   * Turn everything still face down, fast.
   *
   * A cascade rather than one frame, because ten cards appearing simultaneously
   * is the failure this whole file exists to correct — even when the player has
   * asked to skip, the escalation is what makes the last card the best one.
   */
  const revealAll = (): void => {
    if (!torn) tear();
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    autoTimer = null;
    let step = 0;
    for (const [index] of slots.entries()) {
      if (shown.has(index)) continue;
      later(() => flip(index, false), scaledDuration(RUSH_STEP) * step);
      step += 1;
    }
  };

  /* --- beat 3: the summary ----------------------------------------------- */

  const finish = (): void => {
    if (closed) return;
    /*
     * The hint crosses out and the summary crosses in, in the same grid cell.
     *
     * It used to be `hint.remove()`, which changed the stage's row heights at
     * the exact moment the cards had settled and were being looked at: the grid
     * moved, and with it the line the cards were standing on. Nothing is removed
     * now, so nothing reflows — what changes is two opacities and the
     * `aria-hidden` that stops a screen reader announcing an instruction the
     * player has already carried out.
     */
    hint?.setAttribute("aria-hidden", "true");
    overlay.classList.add("rw-summed");
    /* Belt and braces: a summary that wraps to a taller line than the hint on a
       narrow viewport still moves the row, and the join has to follow it. */
    layoutRoom();
    foot.classList.add("rw-ready");
    doneButton.disabled = false;
    allButton.disabled = true;
    for (const counter of overlay.querySelectorAll<HTMLElement>("[data-count]")) {
      tickerTo(counter, Number(counter.dataset["count"] ?? "0"), DUR.setpiece);
    }
    if (document.activeElement === document.body || overlay.contains(document.activeElement)) {
      doneButton.focus({ preventScroll: true });
    }
  };

  /* --- effects ----------------------------------------------------------- */

  const burst = (slot: HTMLElement, rarity: Rarity): void => {
    if (!motionEnabled() || rarity === "common") return;
    const spark = document.createElement("div");
    spark.className = "rw-burst";
    if (RARITY_RANK[rarity] >= 2) spark.dataset["rays"] = "1";
    slot.append(spark);
    later(() => spark.remove(), 780);
  };

  const flash = (alpha: number): void => {
    if (!motionEnabled()) return;
    const sheet = document.createElement("div");
    sheet.className = "rw-flash";
    sheet.style.setProperty("--rw-flash-a", String(alpha));
    overlay.append(sheet);
    later(() => sheet.remove(), 260);
  };

  /* --- input ------------------------------------------------------------- */

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    for (const id of timers) globalThis.clearTimeout(id);
    timers.clear();
    globalThis.removeEventListener("resize", onResize);
    roomObserver?.disconnect();
    document.removeEventListener("focusin", onFocusIn, true);
    overlay.classList.add("rw-closing");
    globalThis.setTimeout(() => overlay.remove(), 220);
    if (openInstance?.element === overlay) openInstance = null;
    if (options.walletHost) syncWallets(options.walletHost);
    returnFocus?.focus?.({ preventScroll: true });
    options.onClose?.();
  };

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".rw-open-actions")) return;
    if (!torn) {
      tear();
      return;
    }
    const slot = target.closest<HTMLElement>(".reveal-slot");
    if (slot) {
      flip(slots.indexOf(slot), true);
      return;
    }
    /*
     * Anywhere else means "get on with it" — and once there is nothing left to
     * get on with, it means "done".
     *
     * This used to be `revealAll()` unconditionally, which is a no-op after the
     * last card has turned. Measured at 844x390, the footer was 1,057px wide
     * inside an 844px viewport and both `Done` and `Collection` sat entirely
     * off-screen: with the veil inert, a touch player who opened a pack on a
     * phone had **no pointer route out of the modal at all**. The footer is
     * fixed below, and this is the second lock on the same door — a modal whose
     * only exit is one button is one layout bug away from being a trap.
     */
    if (shown.size === slots.length) {
      close();
      return;
    }
    revealAll();
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (shown.size === slots.length) close();
      else revealAll();
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return; // a real button handles its own keys
    event.preventDefault();
    if (!torn) {
      tear();
      return;
    }
    const slot = target.closest<HTMLElement>(".reveal-slot");
    flip(slot ? slots.indexOf(slot) : nextHidden(), true);
  });

  /**
   * A focus trap, and the smallest one that is honest.
   *
   * This is a modal over the whole game; tabbing out of it lands the keyboard on
   * a screen the player cannot see. Rather than enumerate focusable descendants
   * and wrap them — which goes wrong the moment the markup changes — it watches
   * for focus arriving anywhere outside and sends it back to the first control
   * inside. Same guarantee, no list to maintain.
   */
  function onFocusIn(event: FocusEvent): void {
    if (closed) return;
    const target = event.target as Node | null;
    if (target && overlay.contains(target)) return;
    const first = overlay.querySelector<HTMLElement>("button:not([disabled]), [tabindex='0']");
    first?.focus({ preventScroll: true });
  }
  document.addEventListener("focusin", onFocusIn, true);

  allButton.addEventListener("click", () => revealAll());
  doneButton.addEventListener("click", () => close());
  overlay.querySelector("#reveal-collection")?.addEventListener("click", () => {
    close();
    options.onCollection?.();
  });

  /*
   * Reduced motion still opens a pack — it simply stops being a performance.
   * The player keeps the input that starts it and the summary that ends it; what
   * goes is the float, the deal, the bursts and the pauses between cards.
   */
  if (!motionEnabled()) {
    later(() => {
      tear();
      revealAll();
    }, 30);
  }

  (pack ?? overlay).focus?.({ preventScroll: true });

  const instance: PackOpening = { revealAll, close, element: overlay };
  openInstance = instance;
  return instance;
}

/** Whether a pack is on screen right now — the screens use it to stay quiet. */
export const packIsOpen = (): boolean => openInstance !== null;

/* -------------------------------------------------------------------------
   markup
   ------------------------------------------------------------------------- */

/**
 * Commons first, the best card last.
 *
 * `sort` is stable in every engine this ships to, so cards of equal rarity keep
 * the order the roll produced them in — which matters because the pity
 * guarantee's card should still be where the algorithm put it among its peers.
 */
function orderForDrama(cards: readonly RevealEntry[]): RevealEntry[] {
  return [...cards].sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
}

function slotMarkup(
  content: ContentIndex,
  entry: RevealEntry,
  index: number,
  total: number,
  backArt: string,
): string {
  const name = content.cards[entry.cardId]?.name ?? entry.cardId;
  const tags: string[] = [];
  if (entry.convertedToSignal !== undefined) {
    /*
     * "+15 Signal", not "Converted · +15 Signal".
     *
     * The tag is centred under a card and does not wrap, so its width is set by
     * its longest word rather than by the slot. At 844x390 — a phone in
     * landscape, which every screen has to work at — five cards are 100px wide
     * and the long form measured 150, so five tags overlapped into one
     * unreadable band across the bottom of the reveal. The word the player
     * needs is the number; "converted" is what the summary line under it and
     * the tooltip both say.
     */
    tags.push(
      `<span class="reveal-converted mat-chip" title="Converted to Signal — you were already at the cap">` +
        /*
         * The word survives for a screen reader — and for verify-shop.mjs, which
         * reads `.reveal-tag`'s textContent and asserts on /Converted/ to prove
         * the duplicate rule fired. A rebuild that quietly deletes the word a
         * browser check is asserting on has broken the check rather than passed
         * it.
         */
        `<span class="rw-sr">Converted · </span>` +
        `+${formatNumber(entry.convertedToSignal)} Signal</span>`,
    );
  } else if (entry.isNew) {
    tags.push(`<span class="reveal-new mat-chip">New</span>`);
  } else {
    tags.push(`<span class="reveal-dupe mat-chip">Second copy</span>`);
  }
  if (entry.guaranteed) tags.push(`<span class="reveal-converted mat-chip">Encore</span>`);
  else if (entry.wishlisted) tags.push(`<span class="reveal-converted mat-chip">Wishlist</span>`);

  return (
    /*
     * The rarity is a data- attribute and **never a class**.
     *
     * screens.css still carries `.reveal-slot.legendary .reveal-back { box-shadow:
     * 0 0 26px gold }` — the old screen's spoiler, which lit the *face-down* card
     * gold and then deleted the glow at the moment of the flip. Putting the rarity
     * on as a class brought it straight back, and a ten-pull photographed with one
     * back haloed in gold before anything had been turned over. Everything rarity
     * does in this component keys off `[data-rarity]` together with `.shown`.
     */
    /*
     * `--rw-rest-dur` is the card's own idle period. Prime-ish spacing rather
     * than a round step, so five or ten of them do not come back into phase on
     * any short multiple — see the note on `rw-card-rest`.
     */
    `<div class="reveal-slot rw-pending" data-index="${index}" data-rarity="${entry.rarity}" ` +
    `style="--rw-rest-dur:${(5.9 + index * 0.37).toFixed(2)}s">` +
    `<div class="rw-flip" role="button" tabindex="0" aria-pressed="false" ` +
    `aria-label="Turn over card ${index + 1} of ${total}: ${esc(name)}">` +
    `<div class="reveal-back">${backArt ? `<img src="${backArt}" alt="" draggable="false">` : ""}</div>` +
    `<div class="reveal-front" data-card="${esc(entry.cardId)}"></div>` +
    `</div>` +
    `<div class="reveal-tag">${tags.join("")}</div>` +
    `</div>`
  );
}

/**
 * The pack itself, and it is a *descendant of the grid*.
 *
 * `scripts/verify-shop.mjs` clicks the centre of `.reveal-cards`; if the pack
 * were a sibling floating over it, Playwright would report the click as
 * intercepted and a rebuild that works perfectly would fail its own check.
 *
 * ## The id is not decoration, and it is here because its absence cost a wave
 *
 * This element had a class and no id. `scripts/_ic6_journey.mjs` — the harness
 * that produced this wave's brief — drives the reveal with
 * `page.locator("#rw-pack").click()`, wrapped in a `.catch()` that prints the
 * failure and carries on. So the click never happened, the 3.8 seconds of film
 * that followed were film of a page nobody had touched, and the finding written
 * from it was **"clicking the pack does nothing — the primary affordance of the
 * primary reward screen is dead to the mouse"**. Re-measured here with a real
 * `mouse.click()` at the element's own centre and a capture listener proving the
 * event landed: peak frame delta **24.55 at 340ms**, the pack tears, all five
 * cards deal and turn. The affordance was never dead; the selector was.
 *
 * Adding the id does not make the click work — it already worked. It makes the
 * *instrument* work, which is the thing that was actually broken, and it costs
 * eleven characters. A hook that a script in this repository is already reaching
 * for should exist.
 */
function packMarkup(backArt: string, tearLabel: string): string {
  return (
    /*
     * The cast is a sibling and not a child, because `.rw-pack` sets
     * `overflow: hidden` on itself to clip its own travelling sheen (see the
     * note on that rule) — a shadow inside it would be clipped to the pack's
     * own silhouette, which is precisely the shape a cast shadow must not be.
     */
    `<div class="rw-pack-cast" aria-hidden="true"></div>` +
    `<button class="rw-pack" id="rw-pack" type="button" aria-label="${esc(tearLabel)}">` +
    (backArt ? `<img src="${backArt}" alt="" draggable="false">` : "") +
    `</button>`
  );
}

/** The hint belongs to the stage, so it can sit clear of the card grid. */
function hintMarkup(tearLabel: string): string {
  return (
    `<div class="rw-pack-hint">` +
    `<span class="t-label">${esc(tearLabel)}</span>` +
    `<span class="rw-quiet" style="font-size:var(--fs-xs)">Click the pack, or press Space</span>` +
    `</div>`
  );
}

function summaryMarkup(options: PackOpeningOptions): string {
  const items = options.summary ?? [];
  const parts = items.map((item) => {
    const mark = item.coin ? COIN[item.coin].icon : (item.icon ?? "sparkle");
    const ink = item.coin ? COIN[item.coin].ink : "var(--accent-bright)";
    const value =
      item.value === undefined
        ? ""
        : `<span class="num" data-count="${item.value}" style="min-width:0">0</span>`;
    return (
      `<span class="rw-sum"><span style="color:${ink};display:inline-flex">${icon(mark, { size: 17 })}</span>` +
      `${value}<span>${esc(item.label)}</span></span>`
    );
  });
  if (options.note) parts.push(`<span class="rw-sum rw-quiet">${esc(options.note)}</span>`);
  return parts.join("");
}
