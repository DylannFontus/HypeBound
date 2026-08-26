/**
 * One stylesheet for the five reward screens, injected rather than authored in
 * `screens.css`.
 *
 * ## Why this file is a string of CSS and not a `.css` file
 *
 * `theme/screens.css` and `theme/base.css` belong to other people. Five builders
 * are inside this repository at the same time and the surface-level rule of the
 * foundation contract is that no module edits another module's files — so the
 * reward domain either gets its own sheet or it gets nothing, and "nothing" is
 * how the domain ended up with six independently invented progress bars in the
 * first place. Vite would happily bundle a sibling `.css` import, but a plain
 * import lands in the global cascade at whatever position the bundler chooses,
 * which is the one thing that makes a shared stylesheet dangerous. A `<style>`
 * appended at mount is always *after* `base.css` and its `@import`, so the
 * override order is a property of the DOM rather than of the build graph, and it
 * is removed from the equation entirely on any page that never opens a reward
 * screen.
 *
 * Everything here is prefixed `rw-`, or is a legacy class this domain already
 * owned (`.reveal-slot`, `.pass-row`, `.ach-row`, `.mission`). Nothing else is
 * touched, and no selector in here can reach a screen outside the five.
 *
 * ## The trap it exists to avoid
 *
 * The recon on this domain counted **six** progress bars, **six** opacity-only
 * reward states and four different ways of writing a quantity, all invented
 * independently by five screens that never looked at each other. Every visual
 * primitive the domain shares is therefore declared exactly once, here, and the
 * screens compose class names. A screen that wants a different bar changes this
 * file and changes all five.
 *
 * The colours, radii, durations, easings, materials and type roles all come from
 * `foundation.css`. There is not one hard-coded hex in this sheet that is not a
 * neutral, and every gradient runs along `--light-sweep` because the key light
 * is at 315° everywhere, forever.
 */

import { createStyleElement } from "../../styleSheet";

const STYLE_ID = "hb-rewards-theme";

/* -------------------------------------------------------------------------
   The sheet
   ------------------------------------------------------------------------- */

const CSS = `
/* =========================================================================
   0. The room wash
   =========================================================================
   These screens used to paint .ambient-bg, an opaque full-viewport plate at
   z-index -1 — which is a photograph laid over atmosphere.ts, the persistent
   world the whole of module E exists to build. Two depth planes where the bar
   asks for four. This replaces it: translucent light with a direction, a
   vignette, and nothing else, so the drifting grid, the motes and the specular
   crawl of the room are visible *through* the screen rather than behind it. */

/*
 * The domain's quiet ink.
 *
 * --text-faint (#7e759e) measures 3.9:1 against the panel fill and 4.4:1
 * against the darkest one — under the 4.5:1 floor, on labels a player reads to
 * decide what to chase. This is the same colour two steps brighter: 6.6:1 on the
 * panel, and it still reads as the quiet member of the hierarchy.
 */
:root {
  --rw-faint: #a79eca;
}

:root[data-contrast="high"] {
  --rw-faint: var(--text);
}

.rw-wash {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(120% 90% at 12% -8%, rgb(126 84 196 / 0.20) 0%, transparent 58%),
    radial-gradient(90% 70% at 92% 108%, rgb(255 95 162 / 0.10) 0%, transparent 62%),
    linear-gradient(var(--light-sweep), rgb(12 7 24 / 0.42) 0%, rgb(4 2 10 / 0.72) 100%);
}

.rw-wash::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(112% 88% at 50% 42%, transparent 46%, rgb(2 1 6 / 0.62) 100%);
}

:root[data-contrast="high"] .rw-wash {
  background: linear-gradient(var(--light-sweep), #0b0716 0%, #05030b 100%);
}

/* =========================================================================
   1. Currency chips
   =========================================================================
   Four currencies across five screens, previously four different spans with a
   Unicode lozenge standing in for the icon and a toLocaleString() that
   printed French group separators inside English copy. One chip, one drawing
   per currency from the shared icon set, one tabular numeral slot so the count
   cannot reflow the header while it is running. */

.rw-wallet {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.rw-coin {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 5px 12px 5px 9px;
  min-height: 32px;
}

.rw-coin > .hb-icon {
  width: 17px;
  height: 17px;
  flex: none;
  color: var(--coin-ink, var(--accent-bright));
  filter: drop-shadow(0 0 6px rgb(from var(--coin-ink, #b56cff) r g b / 0.4));
}

.rw-coin > .num {
  font-size: var(--fs-sm);
  color: var(--text);
  min-width: var(--coin-slot, 4ch);
}

.rw-coin[data-coin="clout"]    { --coin-ink: var(--accent-hot); }
.rw-coin[data-coin="shards"]   { --coin-ink: var(--accent); }
.rw-coin[data-coin="glimmer"]  { --coin-ink: var(--accent-gold); }
.rw-coin[data-coin="token"]    { --coin-ink: var(--accent-cool); }

/* The landing. A reward that flew here has to be *received* — §3's secondary
   motion — so the chip lights, lifts and settles on the frame the flight ends. */
.rw-coin.rw-hit {
  animation: rw-coin-hit 420ms var(--ease-overshoot) both;
}

@keyframes rw-coin-hit {
  0%   { transform: scale(1); --rim-boost: 1; }
  26%  { transform: scale(1.14); --rim-boost: 3; }
  100% { transform: scale(1); --rim-boost: 1; }
}

.rw-coin.rw-hit > .hb-icon {
  animation: rw-coin-flare 420ms var(--ease-arrive) both;
}

@keyframes rw-coin-flare {
  0%   { filter: drop-shadow(0 0 6px rgb(from var(--coin-ink) r g b / 0.4)); }
  22%  { filter: drop-shadow(0 0 16px rgb(from var(--coin-ink) r g b / 0.95)) brightness(1.6); }
  100% { filter: drop-shadow(0 0 6px rgb(from var(--coin-ink) r g b / 0.4)); }
}

/* The thing in flight. Body-level, so it survives the screen re-rendering
   underneath it — which is precisely what killed every previous attempt at a
   claim animation on this domain. */
.rw-flyer {
  position: fixed;
  z-index: 960;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-chip);
  pointer-events: none;
  color: var(--coin-ink, var(--accent-bright));
  /* See the note on the transparent keyword under §5 — the far stop repeats the
     relative colour at zero alpha rather than naming transparent, or the falloff
     is a hard-edged disc instead of a glow. */
  background: radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.5), rgb(from var(--coin-ink, #b56cff) r g b / 0.25) 52%, rgb(from var(--coin-ink, #b56cff) r g b / 0) 72%);
  filter: drop-shadow(0 0 12px rgb(from var(--coin-ink, #b56cff) r g b / 0.7));
}

.rw-flyer > .hb-icon { width: 22px; height: 22px; }

/* =========================================================================
   2. The one progress rail
   =========================================================================
   It replaces six: the shop's 4px pity counter, the mission bar, the Encore
   Meter, the season bar and two achievement bars, each with its own height,
   radius and track colour, none of them visible at 0%.

   A rail is a groove with an object in it. The groove is .mat-well, which
   already inverts the bevel; the object is .well-fill, which module A built
   for exactly this and which carries its own lit crown so a filled rail reads
   as a bar *in* a channel rather than a stripe painted on one. What this adds
   is the three things a reward meter needs and a generic meter does not: a
   specular that crawls the filled portion, tick marks at the promises, and a
   numeral that is legible at 0%. */

.rw-rail {
  position: relative;
  height: var(--rail-h, 12px);
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  overflow: visible;
  /* A well's default fill is near-transparent black, which on a near-black
     panel leaves only its 1px rim visible — measured, a 10px rail photographed
     as a 3px hairline and read as a stray divider. That is the exact defect the
     recon logged six times ("invisible at 0%"), so the groove gets its own
     lighter floor: an empty rail has to be legible as an empty rail. */
  --fill-well: linear-gradient(var(--light-sweep), rgb(6 3 14 / 0.94) 0%, rgb(46 34 78 / 0.94) 100%);
  --rim-a: 0.16;
  --lip-a: 0.9;
}

.rw-rail-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--rw-fill, 0%);
  min-width: var(--rw-fill-min, 0px);
  border-radius: inherit;
  overflow: hidden;
  transition: width var(--dur-setpiece) var(--ease-arrive);
}

/* The crawl. transform only — a background-position animation across
   twenty-one plates is what halved the lobby's frame rate, and a rail is the
   easiest place in the game to repeat that mistake. */
.rw-rail-fill::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(
    var(--light-sweep),
    transparent 0%,
    rgb(255 255 255 / 0.42) 50%,
    transparent 100%
  );
  translate: -60% 0;
  animation: rw-rail-crawl 3.4s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-rail-crawl {
  0%   { translate: -60% 0; opacity: 0; }
  16%  { opacity: 1; }
  70%  { opacity: 1; }
  100% { translate: 300% 0; opacity: 0; }
}

.rw-rail-tick {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  border-radius: 2px;
  translate: -1px 0;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.42), rgb(255 255 255 / 0.12));
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
}

.rw-rail-tick[data-kind="promise"] {
  background: linear-gradient(180deg, var(--accent-gold), rgb(255 204 102 / 0.35));
  box-shadow: 0 0 8px rgb(255 204 102 / 0.6), 0 0 0 1px rgb(0 0 0 / 0.55);
}

.rw-meter {
  display: grid;
  gap: var(--sp-2);
}

.rw-meter-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}

.rw-meter-head .num { font-size: var(--fs-sm); }

/* =========================================================================
   3. The four-state reward token
   =========================================================================
   locked / available / claimable / claimed, and the binding rule is that the
   fill, the border, the icon *and* the label all change together. Six places in
   this domain signalled state with opacity: 0.42, which is both illegible —
   dim text at 42% alpha measures well under 4.5:1 — and unreadable in the other
   sense: a faded thing could equally be disabled, loading, or a rendering bug.
   Nothing here touches alpha. */

.rw-tok {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 5px 11px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.rw-tok > .hb-icon { width: 14px; height: 14px; flex: none; }

.rw-tok[data-state="locked"] {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(30 24 46 / 0.96) 0%, rgb(13 9 22 / 0.98) 100%);
  --rim-a: 0.05;
  --lip-a: 0.6;
  color: #c2b9dc;
  border-color: rgb(255 255 255 / 0.05) rgb(0 0 0 / 0.4) rgb(0 0 0 / 0.7) rgb(255 255 255 / 0.03);
}

.rw-tok[data-state="available"] {
  color: var(--text-dim);
}

.rw-tok[data-state="claimable"] {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(120 74 196 / 0.95) 0%, rgb(72 34 124 / 0.96) 100%);
  --rim-a: 0.2;
  color: #fbf5ff;
}

.rw-tok[data-state="claimed"] {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(52 58 62 / 0.95) 0%, rgb(24 27 30 / 0.96) 100%);
  color: #cfe6d6;
}

.rw-tok[data-state="claimed"] > .hb-icon { color: var(--success); }

/*
 * The breathe is an opacity animation on a pseudo-element, not a box-shadow
 * animation on the plate.
 *
 * A shadow is a paint property. Fifty claimable tiers on the Hype Wave breathing
 * at once would be fifty full repaints a frame, which is precisely the mistake
 * that halved the lobby's frame rate when a sheen animated background-position
 * across twenty-one plates. Opacity on a layer the compositor already owns costs
 * nothing at any count.
 */
.rw-tok[data-state="claimable"]::before,
.pass-cell.claimable::before,
.checkin-step.next::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 16px rgb(217 165 255 / 0.4),
    0 0 16px rgb(217 165 255 / 0.34);
  animation: rw-breathe 4s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-breathe {
  0%, 100% { opacity: 0.18; }
  50%      { opacity: 1; }
}

/* =========================================================================
   3b. The specular band's own edges
   =========================================================================
   A defect in foundation.css, mitigated here because that file belongs to
   module A and this domain cannot ship around it.

   Every raised material carries a specular crawl on its ::after: a box 40% of
   the plate's width, full height, painted with a 315-degree ramp that runs
   transparent to white to transparent *along the diagonal*. On a chip that is
   invisible. On a large panel it is not, and the reason is geometry: a diagonal
   ramp inside a tall narrow box reaches its transparent ends at the box's top
   and bottom corners, so a horizontal cut through the middle leaves the band at
   roughly half alpha where its own left and right edges are. The result is two
   hard vertical seams down every big surface in the game.

   Measured on the shop's hero: a 1,090px panel with a full-height edge at x=115
   and another at x=557, present in every frame and moving with the crawl.
   Photographed, it reads as a rendering error rather than as light.

   The fix costs nothing and keeps the effect: mask the band along its own
   horizontal axis so its edges are as soft as its ends. Scoped to this domain's
   five bodies and its overlay; the same three lines belong on the material
   itself, which is module A's call to make.

   The same applies to a relative colour ramping into the transparent keyword —
   see the note on .rw-burst. Both are the same underlying lesson: a gradient's
   *end* has to be transparent everywhere the shape ends, not only where the
   gradient's axis happens to run out. */

.rw-shop-body .mat-panel::after,
.rw-banner-body .mat-panel::after,
.rw-pass-body .mat-panel::after,
.rw-missions-body .mat-panel::after,
.rw-ach-body .mat-panel::after,
.rw-open .mat-panel::after {
  mask-image: linear-gradient(90deg, transparent 0%, #000 26%, #000 74%, transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 26%, #000 74%, transparent 100%);
}

/* And the specular comes *off* the objects there are a hundred and fifty of.
   Every material carries an infinite sweep on its own ::after, which is right
   for a panel and wrong for a rail of fifty tiers with two lanes and a
   medallion each: profiled on lobby -> pass, the browser spent 168ms of the
   arrival inside getAnimations({subtree:true}) enumerating them, and the same
   list has to be walked by the animation engine on every frame thereafter. It
   is also the §9 rule the lobby already learned the hard way — a sheen crossing
   twenty-one plates halved its frame rate — and it is noise besides: a track
   where every one of a hundred and fifty objects has its own travelling
   highlight has no highlight at all. What still moves is the one lit medallion,
   the claimable breathe and the rail crawl, which are the three things that
   mean something. */
.pass-cell::after,
.pass-node::after,
.checkin-step::after,
.rw-tile-qty::after,
.banner-pill::after { animation: none; }

/* =========================================================================
   3c. Content reacts, and it arrives in order
   =========================================================================
   Two §3a failures with one cause: the six-state interaction mixin and the
   entrance cascade were both applied to *buttons and top-level panels only*.

   Measured at rest and hovered, .pass-cell, .mission, .ach-row and
   .checkin-step returned byte-identical transform, filter, box-shadow and
   border-colour — four of the five screens' entire content area was inert under
   the pointer. On the pass that compounds the census problem: the tile shows an
   object and pointing at it told you nothing more about it. MTG Arena's Mastery
   Pass lights and names every node you point at; Gwent's rows lift.

   Half amplitude, on purpose. A content tile is not a button: -1px and a rim
   that doubles reads as "this is live" where a button's -2px and 1.015 reads as
   "press me", and a grid of forty things that each jump two pixels is a
   twitching page. Only transform and filter animate; the rim is a custom
   property the material already composes, so nothing here paints. */

.pass-cell,
.mission,
.ach-row,
.ach-milestone,
.checkin-step,
.banner-card.act {
  transition:
    transform var(--dur-micro) var(--ease-arrive),
    filter var(--dur-micro) var(--ease-arrive),
    border-color var(--dur-micro) var(--ease-arrive);
}

@media (hover: hover) {
  .pass-cell:hover,
  .mission:hover,
  .ach-row:hover,
  .ach-milestone:hover,
  .checkin-step:hover {
    transform: translateY(-1px);
    filter: brightness(1.09);
    --rim-boost: 2;
    z-index: 2;
  }

  .pass-cell:hover .rw-tile-art,
  .checkin-step:hover .rw-tile-art {
    filter: brightness(1.14) saturate(1.08);
  }
}

/* A keyboard user gets the same read as a pointer — §5 lists focus-visible
   beside hover rather than under it. */
.pass-cell:focus-within,
.mission:focus-within,
.ach-row:focus-within,
.checkin-step:focus-within {
  --rim-boost: 2;
}

/* On the rail the tile *is* a picture, and its name is clamped to a line and a
   half inside a 9.2em lane — so pointing at a tier has to be able to say what
   the thing is. The caption lifts out of the cell as a plate rather than
   growing inside it, because the lane height is what keeps the rail line at
   exactly 50% of every row and a cell that grows on hover would move the track.

   Single-reward cells only: a milestone tier pays two, and two plates anchored
   to the same edge would stack on each other. Those keep the title. */
.rw-track .pass-cell[data-rewards="1"]:hover,
.rw-track .pass-cell[data-rewards="1"]:focus-within {
  overflow: visible;
}

.rw-track .pass-cell[data-rewards="1"]:hover .pass-reward,
.rw-track .pass-cell[data-rewards="1"]:focus-within .pass-reward {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 7px);
  translate: -50% 0;
  z-index: 8;
  width: max-content;
  max-width: 15em;
  padding: 6px 10px;
  border-radius: var(--r-field);
  -webkit-line-clamp: 3;
  line-clamp: 3;
  color: var(--text);
  background: linear-gradient(var(--light-sweep), rgb(46 32 78 / 0.99) 0%, rgb(14 9 27 / 0.99) 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.18),
    0 10px 22px rgb(0 0 0 / 0.7);
  animation: rw-pop 160ms var(--ease-arrive) both;
}

/*
 * The cascade, one level lower than the shell can reach.
 *
 * transitions.css staggers .screen[data-nav] > container > *:nth-child(-n+7),
 * which is exactly right for panels and cannot see inside them. Measured
 * nav-child-rise starts: shop 451/451/451/519/525ms, pass 648x5/678/719ms —
 * five to seven elements, after which the ten check-in tiles, the nine mission
 * cards, the eight achievement rows and the hundred-and-seven pass tiles all
 * arrived in one block. §3a calls that the single biggest perceived-quality gap
 * between a hobby menu and a shipped one.
 *
 * --enter-delay is what motion.ts::stagger writes, and stagger caps the
 * tail so the pass does not run a two-second wave. The class is added for the
 * first render after a mount and taken off again once the cascade has landed,
 * because a claim re-renders the whole screen and a list that re-cascades every
 * time you press Claim is worse than one that never did.
 */
.rw-rise {
  animation: rw-rise 300ms var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}

@keyframes rw-rise {
  from { opacity: 0.15; translate: 0 12px; scale: 0.985; }
  to   { opacity: 1; translate: none; scale: 1; }
}

/* =========================================================================
   4. The reward tile
   =========================================================================
   One component for every reward in the domain — pass tiers, check-in steps,
   achievement payouts, milestone cosmetics. Before it there were four ways of
   writing a quantity in a single ten-cell row: ◈50, 20 Signal, 2 reroll
   tokens and a two-line wrap. Now: a picture of the thing, and a tabular
   number under it, every time. */

.rw-tile {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  gap: 6px;
  padding: var(--sp-2);
  min-width: var(--tile-w, 92px);
  text-align: center;
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

/* The plate is the brightest object on the panel, and that is a correction.
   Measured by squinting at the Hype Wave: the track resolved to a purple field
   with a grid of black holes in it, because the tile ramped from 34% ink to
   near-black while the plate holding it sat at rgb(26 21 40). The reward is the
   thing the player is deciding about — §6 says the most saturated thing on
   screen should be the thing that matters most — and in Hearthstone's Rewards
   Track the chests are the *lightest* objects on the rail. So the ramp is a lit
   metal now: two thirds ink at the top-left, a mid tone at the bottom, and a
   milled ring round the outside so it reads as struck rather than printed. */
.rw-tile-art {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--tile-art, 46px);
  height: var(--tile-art, 46px);
  border-radius: var(--r-field);
  color: var(--tile-ink, var(--accent-bright));
  background:
    radial-gradient(circle at 32% 24%, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0) 58%),
    linear-gradient(var(--light-sweep), rgb(from var(--tile-ink, #b56cff) r g b / 0.72) 0%, rgb(from var(--tile-ink, #b56cff) r g b / 0.2) 54%, rgb(20 13 36 / 0.94) 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.28),
    inset 0 0 0 1px rgb(255 255 255 / 0.07),
    inset 0 -1px 0 rgb(0 0 0 / 0.62),
    0 3px 8px rgb(0 0 0 / 0.55);
}

/* The picture is its own layer inside the plate, because the plate also holds
   the quantity chip and the deferred painter swaps the picture's children when
   the drawing lands. See rewardKit::rewardTileHtml. */
.rw-art {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: inherit;
  overflow: hidden;
}

.rw-art > .hb-icon {
  width: 58%;
  height: 58%;
  /* Struck into the plate rather than laid on it: a light edge on the 315° side
     and a shadow on the other is the two-pixel version of an emboss, and it is
     the difference between an icon and a coin. */
  color: #fff;
  filter:
    drop-shadow(0 1px 0 rgb(0 0 0 / 0.55))
    drop-shadow(0 -1px 0 rgb(255 255 255 / 0.3))
    drop-shadow(0 0 7px rgb(from var(--tile-ink, #b56cff) r g b / 0.75));
}

.rw-art > img,
.rw-art > canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: inherit;
}

/* Nothing pops in — §7. A picture that arrived from the queue crossfades over
   the icon that was standing in for it. */
.rw-art-in { animation: rw-art-in var(--dur-ui) var(--ease-arrive) both; }

@keyframes rw-art-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}

.rw-tile-qty {
  position: absolute;
  z-index: 4;
  right: -4px;
  bottom: -4px;
  padding: 1px 6px;
  font-size: 0.68rem;
  line-height: 1.5;
  min-width: 0;
  --r-self: var(--r-chip);
}

.rw-tile-name {
  font-size: 0.7rem;
  line-height: 1.25;
  letter-spacing: 0.02em;
  color: var(--text-dim);
  max-width: 11ch;
  overflow-wrap: anywhere;
}

.rw-tile[data-state="claimed"] .rw-tile-art {
  filter: saturate(0.18) brightness(0.82);
}

/* Both state seals hang off the *art*, not off the tile.
   A bare tile — the Hype Wave's, which has no caption — is wider than the plate
   inside it, so a seal anchored to the tile floated free in the corner of the
   cell: photographed across a lane, it read as a row of nine padlocks lying on
   the panel rather than as nine locked objects. The seal belongs to the thing it
   qualifies. Locked and claimed are mutually exclusive, so they share a corner,
   which also keeps them clear of the quantity chip at bottom-right. */
/* z-index, because the picture is now a positioned layer of its own and a
   later-painted positioned sibling wins on equal footing: without it the
   darkening scrim and both seals were drawn *under* the drawing they qualify. */
.rw-tile[data-state="claimed"] .rw-tile-art::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: -6px auto auto -6px;
  width: 18px;
  height: 18px;
  border-radius: var(--r-chip);
  background: var(--success) var(--tick) center / 13px 13px no-repeat;
  box-shadow: 0 2px 5px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.4);
}

/* A locked reward keeps its colour, and this is the correction that makes the
   rail readable at all.

   grayscale(0.7) brightness(0.82) was the state design working exactly against
   the screen it was on: on a new account every one of a hundred tiers is locked,
   so the entire Hype Wave rendered as a grid of grey holes in a purple field —
   which is the §6 value-structure failure the review named, caused by the §5
   state design meant to fix a different one. Hearthstone's un-earned chests are
   full-colour, bright and desirable with a gold padlock struck across them; the
   thing you are being asked to grind for is the last thing that should be
   drained. What says "locked" is the seal, the darker plate under it and the
   word on .rw-sr — three signals, none of them alpha, and none of them the
   object's own colour. */
.rw-tile[data-state="locked"] .rw-tile-art {
  filter: saturate(0.86) brightness(0.94);
}

.rw-tile[data-state="locked"] .rw-tile-art::before {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0;
  border-radius: inherit;
  background: rgb(4 2 10 / 0.14);
}

/* The padlock is *struck on the object*, the way the tick is, rather than
   spelled out in a word beside it.
   Twenty tiers of the Hype Wave in one viewport used to print the word LOCKED
   twenty times down the rail, and the Highlight Reel printed it six times down
   a column — a repeated grey word is a database column, not a state design, and
   it is exactly what §5 is written to catch. The word survives for a screen
   reader on .rw-sr; what the eye gets is a mark on the thing itself, which is
   what Hearthstone's gold padlock plate and Xbox's greyed badge both do. */
.rw-tile[data-state="locked"] .rw-tile-art::after {
  content: "";
  position: absolute;
  z-index: 3;
  /* Top-left, not bottom-centre.
     A bare tile — the Hype Wave's, which has no caption under it — is nothing
     but the art plate, so a mark centred on its bottom edge sat squarely across
     the drawing it was qualifying: photographed at 134px, a locked Clout tier
     read as a coin with a padlock stamped through the middle of it and a "75"
     hanging off the same corner. The quantity chip already owns bottom-right, so
     the seal takes the opposite corner, which is also the lit one. */
  inset: -6px auto auto -6px;
  width: 18px;
  height: 18px;
  border-radius: var(--r-chip);
  background:
    var(--rw-lockmark) center / 12px 12px no-repeat,
    linear-gradient(var(--light-sweep), rgb(74 66 96 / 0.98) 0%, rgb(26 22 38 / 0.98) 100%);
  box-shadow: 0 2px 5px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.22);
}

/* The one padlock drawing, traced from uiIcons' own lock at its 24 grid, as
   something a CSS background can paint. icon() returns markup and a ::after
   cannot hold markup, so the alternative was the Unicode padlock character —
   which renders in whatever font the OS has, at the wrong weight, and is
   exactly the tell the icon contract exists to delete. Declared at the root and
   namespaced, because a locked tile turns up on all five of these screens and
   enumerating their containers is a list that will go out of date. */
:root {
  --rw-lockmark: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23d6d0e6'%20stroke-width='1.9'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Crect%20x='4.4'%20y='10.4'%20width='15.2'%20height='10.2'%20rx='2.2'/%3E%3Cpath%20d='M8%2010.4%20V7.4%20A4%204%200%200%201%2016%207.4%20V10.4'/%3E%3C/svg%3E");
}

/* Screen-reader-only, and it has to be clip-path rather than display: none:
   a hidden state word that is not announced is not an accessible state. */
.rw-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* =========================================================================
   5. The pack opening
   =========================================================================
   The set-piece the whole domain was scored 3/10 for not having. Read
   packOpening.ts for the beats; this is only their surface.

   Every animated property in this block is transform, opacity or filter.
   Ten cards flipping at once on a low-tier phone is the worst frame this domain
   can produce, and a single box-shadow transition in here would be the thing
   that loses it. */

.rw-open {
  position: fixed;
  inset: 0;
  z-index: 950;
  display: grid;
  grid-template-rows: auto 1fr auto;
  align-items: center;
  padding: clamp(var(--sp-3), 2.4vh, var(--sp-6)) clamp(var(--sp-3), 3vw, var(--sp-7));
  gap: clamp(var(--sp-2), 1.4vh, var(--sp-4));
  overflow: hidden;
  animation: rw-open-in var(--dur-ui) var(--ease-arrive) both;
  /* The pack's size, declared once, because three things are cut from it: the
     object, the shadow it stands in and how far below its own centre that
     shadow lies. They were three independent \`min()\` expressions and they only
     agreed at one viewport height. */
  --rw-pack-w: min(34vh, 320px);
}

.rw-open[hidden] { display: none; }

@keyframes rw-open-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.rw-open.rw-closing {
  animation: rw-open-out 200ms var(--ease-leave) both;
}

@keyframes rw-open-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* The backdrop is its own element so it can be blurred and darkened without
   blurring the cards — §2: separation is carried by blur and desaturation, not
   by z-index alone. */
.rw-open-veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(78% 62% at 50% 46%, rgb(from var(--rw-accent, #b56cff) r g b / 0.18) 0%, rgb(from var(--rw-accent, #b56cff) r g b / 0) 64%),
    radial-gradient(120% 100% at 50% 120%, rgb(255 95 162 / 0.1) 0%, transparent 60%),
    rgb(3 1 8 / 0.972);
  /* 26px and half the saturation, not 16 and 0.7. Measured against the shop:
     at the old values the panel headings behind the pack were still legible
     enough to be read, which puts the screen the player has left in competition
     with the cards they just opened. §2 asks for separation carried by blur and
     desaturation; the overlay plane is the one place it can be spent freely,
     because there is nothing behind it anybody needs. */
  backdrop-filter: blur(26px) saturate(0.42) brightness(0.72);
  -webkit-backdrop-filter: blur(26px) saturate(0.42) brightness(0.72);
}

/* Light behind the stage that grows as the pull gets better. Driven from JS by
   --rw-glow, so a legendary lights the whole room and five commons do not. */
.rw-open-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--rw-glow, 0);
  background: radial-gradient(58% 46% at 50% 48%, rgb(from var(--rw-accent, #b56cff) r g b / 0.5) 0%, rgb(from var(--rw-accent, #b56cff) r g b / 0) 68%);
  transition: opacity 620ms var(--ease-arrive);
  mix-blend-mode: screen;
}

/*
 * A masthead, not two corners.
 *
 * This was \`justify-content: space-between\` on a full-width row, which at
 * 1600x900 put "MERCH DROP / 5 cards" at x=48 and the five progress pips at
 * x=1478 with fourteen hundred pixels of nothing between them — the two ends of
 * a rail with no rail. Photographed, the title read as a caption somebody had
 * left in the corner of a black frame rather than as the name of the moment.
 *
 * Centred, and the pips directly under the title they are counting, it is one
 * composed object at the top of the shot — which is also what the shaft below
 * is pointing at, so the light has something to arrive on before it reaches the
 * cards. The \`--sp-4\` gap that used to separate the two ends becomes the space
 * between a title and its own counter.
 */
.rw-open-head {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
}

.rw-open-title { display: grid; gap: 2px; justify-items: center; }
.rw-open-title .t-label { color: var(--accent-bright); }

/* Tied to the viewport's height rather than its width, because the masthead
   competes with the cards for the one axis a phone in landscape has none of. */
.rw-open-name { font-size: clamp(1.15rem, 3.4vh, var(--fs-xl)); line-height: 1.15; }

.rw-open-count {
  display: flex;
  align-items: center;
  gap: 7px;
}

/*
 * On a short viewport the masthead collapses back into one centred line.
 *
 * Stacked, it is three rows — eyebrow, display line, pips — and at 844x390 that
 * measured 110px, or 28% of the entire viewport, spent on the name of a thing
 * whose five cards were 93px wide underneath it. Centred as a single row it is
 * about thirty, and \`fit()\` spends the difference on the cards, which is the
 * whole point of the exercise. It is still one composed object rather than two
 * opposite corners, which is what the change was for.
 */
@media (max-height: 560px) {
  .rw-open-head { flex-direction: row; flex-wrap: wrap; gap: var(--sp-3); }
  .rw-open-title { grid-auto-flow: column; align-items: baseline; gap: var(--sp-2); }
}

.rw-pip {
  width: 9px;
  height: 9px;
  border-radius: var(--r-chip);
  background: rgb(255 255 255 / 0.14);
  box-shadow: inset 0 1px 0 rgb(0 0 0 / 0.6);
  transition: background var(--dur-micro) var(--ease-arrive), transform var(--dur-micro) var(--ease-overshoot);
}

.rw-pip[data-on="1"] {
  background: var(--rar-key, var(--accent-bright));
  transform: scale(1.34);
  box-shadow: 0 0 9px var(--rar-key, var(--accent-bright)), inset 0 1px 0 rgb(255 255 255 / 0.4);
}

/* --- the stage ---------------------------------------------------------- */

/* Two rows, and the hint is the second of them rather than a thing floating on
   the first. Absolutely positioned at the stage's bottom edge it sat *inside*
   the card grid's own box: on a ten-pull the second row's "Converted" captions
   land at exactly that height, so the middle card's caption and the words
   "Click a card, or wait" occupied the same pixels for the two seconds between
   the fifth flip and the tenth. A row cannot overlap a row. */
.rw-stage {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  place-items: center;
  min-height: 0;
  height: 100%;
}

/* .reveal-cards is the legacy hook the shop's browser check clicks on, and it
   is also the grid. Both jobs, one element, so the check keeps passing against
   a screen that has been rebuilt underneath it. */
/* position: relative, because the pack is a *descendant* of this element
   rather than a sibling floating over it — see the note in packOpening.ts about
   the browser check that clicks this element's centre. */
.rw-stage > .reveal-cards {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--rw-cols, 5), auto);
  gap: clamp(6px, 1.1vw, 18px);
  /*
   * Rows are further apart than columns, because a row has a caption hanging
   * below it and a column does not.
   *
   * .reveal-tag sits at bottom: -26px and is about 18px tall, so a card's
   * caption occupies 44px *outside* its own slot. At a ten-pull — two rows of
   * five, which is the banner's headline interaction — a 17px gap put every
   * caption in the first row underneath the cards in the second: photographed
   * at 1600x900, "+38 SIGNAL" was sliced in half by the card below it, on the
   * one line of text that says what the player actually got.
   *
   * The number is not a new guess. packOpening.ts::fit has always subtracted a
   * caption lane per row when it decides how big a card can be, and it writes
   * that same constant here as --rw-row-gap so the two cannot drift apart.
   */
  row-gap: var(--rw-row-gap, 46px);
  justify-content: center;
  align-content: center;
  /* Centred in the stage, not merely centred *within itself*. fit() sizes the
     card from the stage but never re-centred the grid, so at 844x390 the ten
     pull sat at x=357-724 — 43% of the width, with the entire left half of the
     overlay empty beside it. */
  justify-self: center;
  margin-inline: auto;
  max-width: 100%;
}

/* The perspective is per card, not on the grid. A single vanishing point at the
   grid's centre skews the outer cards of a row of five as they rotate, because
   they are 400px off-axis; one perspective each turns every card towards the
   player instead of towards the middle. */
.reveal-slot {
  position: relative;
  width: var(--rw-card-w, 168px);
  aspect-ratio: 512 / 680;
  perspective: 1100px;
  transition: transform 420ms var(--ease-arrive), filter 420ms var(--ease-arrive);
}

/* Face down and not yet dealt. The slots exist from the first frame so the grid
   never reflows when the pack tears — and so the shop's browser check can count
   five of them before anything has been touched. */
.reveal-slot.rw-pending { opacity: 0; }

/* The deal-out. Each slot is handed the vector from the pack to its own
   position as two custom properties and travels it once. */
.reveal-slot.rw-dealing {
  animation: rw-deal 560ms var(--ease-arrive) var(--rw-deal-delay, 0ms) both;
}

@keyframes rw-deal {
  0% {
    transform: translate3d(var(--rw-from-x, 0px), var(--rw-from-y, 0px), 60px) rotate(var(--rw-from-r, 0deg)) scale(0.62);
    opacity: 0;
  }
  14% { opacity: 1; }
  100% {
    transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
    opacity: 1;
  }
}

.rw-flip {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transition: transform 480ms var(--ease-overshoot);
  cursor: pointer;
}

.reveal-slot.shown .rw-flip { transform: rotateY(180deg); }

.reveal-back,
.reveal-front {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 4.5%;
  display: grid;
  place-items: center;
}

.reveal-back > img,
.reveal-back > canvas,
.reveal-front > canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.reveal-front { transform: rotateY(180deg); }

/* The face-down card is identical for every rarity, on purpose. Putting the
   gold glow on the *back* — which is what this screen used to do — tells the
   player what they got before they turn it over and deletes the only tension
   the mechanic has. */
.reveal-back {
  filter: drop-shadow(0 10px 18px rgb(0 0 0 / 0.6));
}

.rw-flip:hover .reveal-back { filter: drop-shadow(0 14px 22px rgb(0 0 0 / 0.65)) brightness(1.14); }

.reveal-slot:not(.shown) .rw-flip:hover { transform: rotateY(-9deg) translateZ(14px); }
.reveal-slot:not(.shown) .rw-flip:active { transform: rotateY(-4deg) translateZ(4px) scale(0.98); }

/* --- rarity, all of it on the revealed face ----------------------------- */

.reveal-slot[data-rarity="common"]    { --rar-key: #c9c3dc; --rar-lift: 1; }
.reveal-slot[data-rarity="rare"]      { --rar-key: var(--rarity-rare); --rar-lift: 1.02; }
.reveal-slot[data-rarity="epic"]      { --rar-key: var(--rarity-epic); --rar-lift: 1.05; }
.reveal-slot[data-rarity="legendary"] { --rar-key: var(--rarity-legendary); --rar-lift: 1.09; }

.reveal-slot.shown { transform: scale(var(--rar-lift, 1)); }

/* The aura, behind the card, only once it is face up. */
.reveal-slot::before {
  content: "";
  position: absolute;
  inset: -18%;
  z-index: -1;
  border-radius: 22%;
  opacity: 0;
  pointer-events: none;
  /* A relative colour never fades into the transparent keyword — see the note
     below on .rw-burst. The legendary's aura was a hard-edged disc because of
     it, which is the one glow in the domain that had to be a glow. */
  background: radial-gradient(closest-side, rgb(from var(--rar-key, #b56cff) r g b / 0.62) 0%, rgb(from var(--rar-key, #b56cff) r g b / 0) 74%);
  transition: opacity 520ms var(--ease-arrive);
}

.reveal-slot.shown[data-rarity="rare"]::before      { opacity: 0.42; }
.reveal-slot.shown[data-rarity="epic"]::before      { opacity: 0.72; }
.reveal-slot.shown[data-rarity="legendary"]::before { opacity: 1; animation: rw-aura 3.6s var(--ease-sweep, ease-in-out) infinite; }

@keyframes rw-aura {
  0%, 100% { opacity: 0.78; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.05); }
}

/* The burst, one shot, on the frame the face turns.
 *
 * ## Never fade a relative colour into the transparent keyword
 *
 * Every glow in this sheet starts from a relative colour — rgb(from var(...) r g
 * b / a) — because the hue is a rarity or a faction and is only known at
 * runtime. Ending that ramp on the transparent keyword does not give a falloff:
 * transparent is transparent *black*, the ramp darkens on its way out, and where
 * it lands the eye reads a hard edge rather than a glow. Measured on the banner
 * hero, where a 46%-wide accent wash drew a visible vertical seam straight down
 * the middle of the panel; the same mistake was in six places in this sheet,
 * including the legendary aura and this burst, which are the two effects the
 * whole domain exists to deliver.
 *
 * The fix is to repeat the same relative colour at zero alpha. Both stops are
 * then the same hue, only the alpha moves, and the falloff is smooth.
 */
.rw-burst {
  position: absolute;
  inset: -30%;
  z-index: 2;
  pointer-events: none;
  border-radius: 50%;
  opacity: 0;
  background:
    radial-gradient(closest-side, rgb(255 255 255 / 0.9) 0%, rgb(from var(--rar-key, #b56cff) r g b / 0.55) 34%, rgb(from var(--rar-key, #b56cff) r g b / 0) 70%);
  animation: rw-burst 640ms var(--ease-arrive) both;
}

@keyframes rw-burst {
  0%   { opacity: 0; transform: scale(0.34); }
  18%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1.5); }
}

/* Rays, for epic and legendary only — the escalation the recon asked for is
   carried by *more layers*, not by a bigger version of the same one. */
.rw-burst[data-rays="1"]::after {
  content: "";
  position: absolute;
  inset: 6%;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg, rgb(255 255 255 / 0.75) 4deg, transparent 8deg,
    transparent 45deg, rgb(255 255 255 / 0.5) 48deg, transparent 52deg,
    transparent 90deg, rgb(255 255 255 / 0.75) 94deg, transparent 98deg,
    transparent 135deg, rgb(255 255 255 / 0.5) 138deg, transparent 142deg,
    transparent 180deg, rgb(255 255 255 / 0.75) 184deg, transparent 188deg,
    transparent 225deg, rgb(255 255 255 / 0.5) 228deg, transparent 232deg,
    transparent 270deg, rgb(255 255 255 / 0.75) 274deg, transparent 278deg,
    transparent 315deg, rgb(255 255 255 / 0.5) 318deg, transparent 322deg
  );
  mask-image: radial-gradient(closest-side, transparent 22%, #000 46%, transparent 82%);
  animation: rw-rays 720ms var(--ease-arrive) both;
}

@keyframes rw-rays {
  0%   { opacity: 0; transform: scale(0.5) rotate(-24deg); }
  22%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1.7) rotate(18deg); }
}

/* The room flash. One 90ms frame of light on the whole overlay, on the same
   frame as the sting, for epic and above. */
.rw-flash {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: rgb(255 255 255 / var(--rw-flash-a, 0.2));
  mix-blend-mode: screen;
  animation: rw-flash 220ms var(--ease-leave) both;
}

@keyframes rw-flash {
  0%   { opacity: 0; }
  12%  { opacity: 1; }
  100% { opacity: 0; }
}

/* --- the card's own caption --------------------------------------------- */

.reveal-tag {
  position: absolute;
  left: 50%;
  bottom: -26px;
  translate: -50% 0;
  display: flex;
  gap: 5px;
  white-space: nowrap;
  max-width: 100%;
  opacity: 0;
  transition: opacity var(--dur-ui) var(--ease-arrive) 220ms;
}

.reveal-slot.shown .reveal-tag { opacity: 1; }

.reveal-tag > span {
  padding: 2px 8px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  --r-self: var(--r-chip);
  /* A tag can never be wider than the card it belongs to, whatever it says: two
     of them side by side that each overhang their slot meet in the middle and
     become one illegible band. Truncation is the failure mode we want. */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reveal-new      { color: #0a0614; --mat-fill: linear-gradient(var(--light-sweep), #8ef0b4 0%, #35c97e 100%); }
.reveal-dupe     { color: var(--text-dim); }
.reveal-converted{ color: var(--accent-bright); }

/* --- the pack ------------------------------------------------------------ */

.rw-pack {
  position: absolute;
  z-index: 4;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  display: grid;
  place-items: center;
  /* Bigger than it was, and for the same reason the cards are: measured, the
     anticipation beat had 44.7% of its scanlines carrying nothing brighter than
     24% grey, with a 260px object alone in the middle of a 1600x900 frame. The
     pack is the only thing on screen during that beat and it has to be worth
     looking at. */
  width: var(--rw-pack-w, min(34vh, 320px));
  aspect-ratio: 512 / 680;
  border: 0;
  padding: 0;
  background: none;
  border-radius: 4.5%;
  cursor: pointer;
  animation: rw-pack-float 5.2s var(--ease-sweep, ease-in-out) infinite;
  filter: drop-shadow(0 26px 40px rgb(0 0 0 / 0.7));
  /* The sheen below translates by ±40% of its own box, and without a clip it
     leaves the pack entirely: photographed, it read as a large soft rectangle
     drifting across the empty half of the panel — a rendering artefact, not a
     specular. mask-image does not fix it, because a mask is applied in the
     element's own space and then transformed along with it. The parent has to
     do the clipping. filter is applied after the clip, so the drop shadow is
     unaffected. */
  overflow: hidden;
}

@keyframes rw-pack-float {
  0%, 100% { transform: translateY(-5px) rotate(-0.7deg); }
  50%      { transform: translateY(5px) rotate(0.7deg); }
}

.rw-pack > canvas,
.rw-pack > img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 4.5%;
}

/* The seal: a band across the lower third of the pack that reads as something to
   break, with a perforation down its middle. Deliberately *not* across the
   centre — the card back's medallion is the most valuable-looking thing on the
   object and covering it to add a ribbon would be a poor trade. */
.rw-pack::before {
  content: "";
  position: absolute;
  /* Flush to the pack's edges rather than overhanging it: the parent clips now
     (see the note on .rw-pack), so an overhang would only be a band with two
     cut ends. */
  inset: 66% 0 auto 0;
  height: 11%;
  border-radius: 2px;
  background:
    linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.34) 0%, transparent 42%),
    repeating-linear-gradient(90deg, rgb(0 0 0 / 0.34) 0 3px, transparent 3px 9px) 0 50% / 100% 2px no-repeat,
    linear-gradient(180deg, rgb(from var(--rw-accent, #b56cff) r g b / 0.95), rgb(from var(--rw-accent, #b56cff) r g b / 0.55));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.45),
    inset 0 -1px 0 rgb(0 0 0 / 0.55),
    0 5px 14px rgb(0 0 0 / 0.6);
}

.rw-pack::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 4.5%;
  pointer-events: none;
  background: linear-gradient(
    var(--light-sweep),
    transparent 34%,
    rgb(255 255 255 / 0.26) 50%,
    transparent 66%
  );
  mask-image: linear-gradient(#000, #000);
  animation: rw-pack-sheen 4.4s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-pack-sheen {
  0%   { opacity: 0; transform: translate3d(-40%, -40%, 0); }
  30%  { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; transform: translate3d(40%, 40%, 0); }
}

@media (hover: hover) {
  .rw-pack:hover { animation-play-state: paused; transform: scale(1.045) translateY(-6px); transition: transform var(--dur-micro) var(--ease-overshoot); }
}

.rw-pack:active { transform: scale(0.975); }

.rw-pack.rw-torn {
  animation: rw-tear 480ms var(--ease-leave) both;
  pointer-events: none;
}

@keyframes rw-tear {
  0%   { transform: scale(1); opacity: 1; filter: brightness(1); }
  32%  { transform: scale(1.16) rotate(-2deg); opacity: 1; filter: brightness(2.1); }
  100% { transform: scale(1.6) rotate(2deg); opacity: 0; filter: brightness(3); }
}

.rw-pack-hint {
  position: relative;
  z-index: 4;
  /* The row above owns the lead-in now — see .rw-open-msg. Keeping it here as
     well offset the hint three pixels against the summary it is stacked with,
     which is exactly the sort of drift a cross-fade in one grid cell exposes. */
  display: grid;
  justify-items: center;
  gap: 4px;
  text-align: center;
  white-space: nowrap;
  animation: rw-hint 2.6s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-hint {
  0%, 100% { opacity: 0.62; transform: translateY(0); }
  50%      { opacity: 1; transform: translateY(-3px); }
}

/* --- the summary and the actions ---------------------------------------- */

/* The footer is present from the first frame — "Reveal all" has to be reachable
   while the reveal is still running, and a keyboard user needs somewhere to be.
   It is the *summary* that arrives, once there is something to summarise. */
/*
 * The actions, and nothing else on the plate.
 *
 * This used to hold the summary too, on a \`space-between\` row — which sounds
 * like it cannot leave a gap on a \`fit-content\` plate, and did: the summary is
 * laid out from the first frame and only its *opacity* changes, so for the whole
 * of the reveal, the beat the player is actually watching, the footer measured
 * 846px wide with **462px of empty plate on the left** and its three buttons
 * jammed into the last 385 on the right. \`.rw-open-actions\` sat at x=839 inside
 * a footer that started at x=377.
 *
 * The summary moved up to \`.rw-open-msg\`, where it belongs — it is the answer to
 * the hint's question and the two now share one line — and what is left here is a
 * plate the size of its buttons. A pill of three controls, centred: 52px of plate
 * either side of them rather than 462 and 17.
 */
.rw-open-foot {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: center;
  padding: var(--sp-2) var(--sp-3);
  /* A grid item's automatic minimum size is its min-content size, and
     width: max-content is not a definite length, so it cannot clamp it: the
     footer resolved to **1,057px inside an 844px viewport**, which put
     #reveal-collection at x=819 and #reveal-done at x=957 — both entirely
     off-screen, on the only pointer route out of a modal. min-width: 0
     releases that floor and fit-content is min(max-content, available) by
     definition, which is what max-content + max-width: 100% was trying and
     failing to express. */
  min-width: 0;
  /* Shrink-wrapped and centred, not full-bleed. A slab the width of the viewport
     with three buttons huddled at one end and eleven hundred empty pixels at the
     other is a lot of pale furniture at the moment the player is looking
     hardest at the cards. */
  margin-inline: auto;
  width: fit-content;
  max-width: 100%;
}

/*
 * The line under the cards, and it holds both things that can be said there.
 *
 * Before this the reveal had three separate strips stacked down the bottom third
 * of the frame — the captions, a floating hint, and a footer whose first row was
 * an invisible summary — with a band of unlit floor between each pair. Measured
 * at 1600x900, 67 of those rows were inside the footer's own plate and had
 * nothing on them at all.
 *
 * Both children are placed in the same grid cell, so the row is as tall as the
 * taller of them and neither one arriving or leaving can move the cards above
 * it. That is the whole reason for the stack: the summary lands at the moment
 * the player is looking hardest at what they just got, and a layout that shifts
 * on that frame is the worst possible time to shift.
 */
.rw-open-msg {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 0;
  padding-top: 6px;
}

.rw-open-msg > * { grid-area: 1 / 1; }

.rw-open-summary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  text-align: center;
  opacity: 0;
  translate: 0 12px;
  pointer-events: none;
  transition: opacity var(--dur-ui) var(--ease-arrive), translate var(--dur-ui) var(--ease-arrive);
}

.rw-open.rw-summed .rw-open-summary { opacity: 1; translate: 0 0; pointer-events: auto; }

/* The instruction leaves on a sharper curve than the answer arrives on — §3's
   "a sharper ease-in for things leaving" — so the two do not read as a
   cross-fade of equals. It keeps its box, because its box is what stops the row
   changing height. */
.rw-open.rw-summed .rw-pack-hint {
  opacity: 0;
  animation: none;
  transition: opacity 160ms var(--ease-leave);
  pointer-events: none;
}

/* On a phone the summary is the thing that wraps, and it is allowed to: the
   actions row is the one that must never be wider than the viewport, and it is
   already centred by the grid above. */
@media (max-width: 900px) {
  .rw-open-foot { padding: 7px var(--sp-2); }
  .rw-open-msg { padding-top: 2px; }
  .rw-open-summary { gap: var(--sp-2); font-size: var(--fs-xs); }
}

.rw-sum {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
}

.rw-sum > .num { color: var(--text); font-size: var(--fs-md); }

.rw-open-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: center; }

/* =========================================================================
   6. Shop
   ========================================================================= */

/* The whole screen fits the viewport and the *pack* is what gives way.
   At 1280x720 a fixed-height hero pushed the buy button 60px below the fold —
   on the one screen whose entire job is that button. The disclosure column
   scrolls, the hero never does, and the pack is sized from the height left
   over, so the price and the counter are on screen at every size the game
   supports down to a phone in landscape. */
.rw-shop-body {
  display: grid;
  grid-template-columns: minmax(320px, 28%) 1fr;
  gap: var(--sp-4);
  align-items: stretch;
  padding: var(--sp-4) clamp(var(--sp-4), 3vw, var(--sp-6)) var(--sp-5);
  min-height: 0;
  overflow: hidden;
}

.rw-shop-left {
  display: grid;
  gap: var(--sp-4);
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

/* The hero: the pack itself, at scale, filling the column that used to end at
   44% of the viewport height with nothing under it. */
/* The hero is a lit alcove with an object standing in it, which means the panel
   has to be *darker* than the rest of the screen, not lighter. Squint at the
   first attempt and it resolved into one pale mass filling two thirds of the
   frame — §6's value structure failing at the largest possible scale. */
.rw-shop-hero {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--sp-3);
  padding: var(--sp-5);
  min-height: 0;
  overflow: hidden;
  --mat-fill: linear-gradient(var(--light-sweep), rgb(40 28 70 / 0.96) 0%, rgb(9 6 19 / 0.98) 62%, rgb(14 9 27 / 0.98) 100%);
}

/* A pool of light on the back wall, behind where the pack stands, plus the
   vignette that makes it a pool rather than a wash. */
/* Inset negatively, because the drift translates and scales this layer inside
   an overflow: hidden panel — at inset: 0 the movement walked the gradient's
   own edge into view as a hard vertical seam down the middle of the hero. */
.rw-shop-hero::before {
  content: "";
  position: absolute;
  inset: -10%;
  pointer-events: none;
  background:
    radial-gradient(34% 42% at 50% 46%, rgb(181 108 255 / 0.3) 0%, transparent 72%),
    radial-gradient(120% 90% at 50% 50%, transparent 42%, rgb(2 1 6 / 0.6) 100%);
  animation: rw-hero-drift 13s var(--ease-sweep, ease-in-out) infinite;
}

.rw-shop-pack {
  position: relative;
  display: grid;
  place-items: center;
  /* min-height:0 lets the row give way; the grid row it sits in is the 1fr of
     .rw-shop-hero, and it is the row that has to win when the type grows. */
  min-height: 0;
  /* not overflow: hidden: the pack floats a few pixels and casts a 34px
     shadow, and clipping the box clips both */
  padding: 6px 0 14px;
}

.rw-shop-pack > .rw-pack-still {
  position: relative;
  /* Sized from the row it is in, capped by the viewport — not the other way
     round. height: min(36vh, 330px) alone is a *fixed* height that ignores
     the space actually available, and at --ui-scale 1.4 / 1280x720 the row
     resolved to 183px while the pack drew 259px inside it: the pity meter and
     the Buy button were painted over the pack's bottom seventy pixels, the
     label read "LEGENDARY G" with the rest covered, and the button's text
     wrapped across the artwork.

     max-height: 100% rather than height: 100%, deliberately: against an
     indefinite containing block a percentage *max*-height computes to none,
     so this degrades to exactly the old behaviour on any layout where the row
     is not definite, where height: 100% would collapse the pack to nothing.
     A responsive rule must never be able to delete the object it is sizing. */
  height: min(36vh, 330px);
  max-height: 100%;
  width: auto;
  max-width: 100%;
  aspect-ratio: 512 / 680;
  animation: rw-pack-float 6.4s var(--ease-sweep, ease-in-out) infinite;
  filter: drop-shadow(0 22px 34px rgb(0 0 0 / 0.66));
  /* Clips the specular, which otherwise walks 40% of the pack's width out into
     the hero's empty half. See the note on .rw-pack. */
  overflow: hidden;
  border-radius: 4.5%;
}

/* The contact shadow on the floor. An object with a soft drop and no contact is
   a sticker; this is the two-pixel version at pack scale. */
.rw-shop-pack::after {
  content: "";
  position: absolute;
  bottom: 4%;
  left: 50%;
  translate: -50% 0;
  width: min(34vh, 260px);
  max-width: 88%;
  height: 26px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.75) 0%, transparent 78%);
  animation: rw-pack-shadow 6.4s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-pack-shadow {
  0%, 100% { opacity: 0.75; transform: scaleX(0.94); }
  50%      { opacity: 1; transform: scaleX(1.05); }
}

.rw-shop-pack .rw-pack-still img,
.rw-shop-pack .rw-pack-still canvas { width: 100%; height: 100%; border-radius: 4.5%; display: block; }

/* The socket the pack stands in until the pack is drawn.
   §3a: "loading is part of the world. No spinner." The card back is rasterised
   off the navigation frame, so for a beat there is a card-shaped alcove here
   rather than a card — and an alcove is a thing, where an empty box is a bug. */
.rw-shop-pack .rw-pack-still {
  background:
    radial-gradient(70% 60% at 34% 22%, rgb(181 108 255 / 0.22), rgb(181 108 255 / 0) 70%),
    linear-gradient(var(--light-sweep), rgb(38 26 66 / 0.9) 0%, rgb(8 5 17 / 0.95) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), inset 0 -1px 0 rgb(0 0 0 / 0.6);
}

.rw-shop-pack .rw-pack-still::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 4.5%;
  background: linear-gradient(var(--light-sweep), transparent 36%, rgb(255 255 255 / 0.22) 50%, transparent 64%);
  animation: rw-pack-sheen 5.8s var(--ease-sweep, ease-in-out) infinite;
}

.rw-shop-buyrow {
  display: grid;
  gap: var(--sp-3);
  justify-items: center;
}

.rw-buy {
  width: min(100%, 420px);
  min-height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 800;
  letter-spacing: 0.01em;
  padding: 0 var(--sp-5);
}

.rw-buy > .hb-icon { width: 20px; height: 20px; }

.rw-odds-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.rw-odds-table th {
  text-align: left;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rw-faint);
  padding-bottom: var(--sp-2);
}

.rw-odds-table td { padding: 5px 0; }
.rw-odds-table tr + tr td { border-top: 1px solid var(--hairline-dark); }
.rw-odds-table td:last-child { text-align: right; }

.rw-odds-name { display: inline-flex; align-items: center; gap: var(--sp-2); }

.rw-rarity-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--r-chip);
  background: var(--rar-key, var(--rarity-common));
  box-shadow: 0 0 8px var(--rar-key, var(--rarity-common)), inset 0 1px 0 rgb(255 255 255 / 0.5);
}

.rw-rules { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }

.rw-rules > li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: var(--sp-2);
  align-items: start;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.45;
}

.rw-rules > li > .hb-icon { width: 15px; height: 15px; margin-top: 3px; color: var(--accent); }

/* =========================================================================
   7. Banner
   ========================================================================= */

/* screens.css caps these bodies at 1100-1180px and centres them, which is right
   for a column of prose and wrong for a horizontal track and a hero: the recon
   measured 55% of the frame empty on four of the five screens. The rail fills
   the width by construction, so the cap comes off where the content is wide and
   stays, generously, where the content is a list of sentences. */
.rw-banner-body {
  max-width: none;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--sp-3);
  padding: var(--sp-3) clamp(var(--sp-4), 3vw, var(--sp-6)) 0;
  min-height: 0;
}

/* Block layout, not grid.
   A grid in a definite-height scroller resolved its auto rows *to fit* rather
   than overflowing, and the hero — an overflow: hidden panel, so its automatic
   minimum size is zero — was the row that gave way: measured at 67px against a
   263px card inside it, clipped to a sliver. Block boxes cannot be compressed by
   their parent, which is exactly the guarantee a scrolling column needs. */
.rw-banner-scroll {
  display: block;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: var(--sp-4);
  min-height: 0;
  /* The spotlight row is taller than the space under the hero, so the scroller's
     bottom edge cuts a row of cards in half against the pull rail. A hard cut
     reads as a broken layout; a fade reads as "there is more", which is what
     §7's rule about dividers fading rather than butting is really about. The
     taper is only on the last 34px, so nothing a player is reading is dimmed. */
  mask-image: linear-gradient(180deg, #000 calc(100% - 34px), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 34px), transparent 100%);
}

.rw-banner-scroll > * + * { margin-top: var(--sp-4); }

.rw-banner-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
}

/* Two columns, and the reason is a measurement rather than a preference.
   Stacked, the scroller held 952px of content in 570px of box at the shipped
   1600x900 — so the "also spotlighted" row was permanently sliced in half by
   the pull rail's top edge, which reads as a broken layout rather than as an
   invitation to scroll, and the hero's right-hand third was empty while it
   happened. Side by side, the six spotlights are the thing that fills that
   third: one grid, nothing clipped, and the hero grows into the height the
   taller column sets rather than being capped by what has to fit under it. */
@media (min-width: 1100px) {
  .rw-banner-scroll {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr);
    gap: var(--sp-4);
    /* stretch, not start: the pull rail is pinned to the bottom of the body, so
       anything the columns do not use is a band of empty page between the
       content and the furniture. Letting the row take the height puts the space
       inside the panels, where it reads as air around an object rather than as
       a gap somebody forgot to fill. */
    align-content: stretch;
  }
  .rw-banner-scroll > * + * { margin-top: 0; }
  /* Everything that is not the hero or the spotlight column — the itemised
     pull, the four disclosure panels — is prose, and prose spans. */
  .rw-banner-scroll > * { grid-column: 1 / -1; }
  .rw-banner-scroll > .rw-hero { grid-column: 1; grid-row: 1; }
  .rw-banner-scroll > .rw-spot-panel { grid-column: 2; grid-row: 1; }
  /* Three across, always. auto-fit would give four narrow tiles at 1600 and two
     at 1280, so the same screen would have two different rhythms. */
  .rw-spot-panel .rw-spotlight { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); }
  .rw-spot-panel { align-content: start; }
}

/* The hero. In every gacha in the genre the featured unit is more than half the
   screen; here it was card one of seven in an equal-weight flex row, so the
   screen had nothing to look at first. */
.rw-hero {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: clamp(var(--sp-4), 3vw, var(--sp-6));
  align-items: center;
  padding: clamp(var(--sp-4), 2.4vh, var(--sp-5)) clamp(var(--sp-4), 3vw, var(--sp-6));
  overflow: hidden;
}

/* The banner's own colour, bled behind the card as an atmosphere plane. */
.rw-hero::before {
  content: "";
  position: absolute;
  inset: -10%;
  pointer-events: none;
  background:
    radial-gradient(56% 120% at 22% 46%, rgb(from var(--rw-accent, #b56cff) r g b / 0.34) 0%, rgb(from var(--rw-accent, #b56cff) r g b / 0) 72%),
    radial-gradient(70% 90% at 92% 8%, rgb(255 95 162 / 0.14) 0%, transparent 60%);
  animation: rw-hero-drift 11s var(--ease-sweep, ease-in-out) infinite;
}

@keyframes rw-hero-drift {
  0%, 100% { opacity: 0.8; transform: translate3d(0, 0, 0) scale(1); }
  50%      { opacity: 1; transform: translate3d(1.6%, -1.2%, 0) scale(1.035); }
}

/* The art box is the thing that clips and the thing that casts, in that order.
   overflow applies before filter on the same element, so the shadow is cast
   by the clipped shape — which lets the specular below travel its full sweep
   without leaving the card. It used to be a plain ::after on .banner-card
   with nothing containing it, and a 40% translation carried a soft white
   rectangle out over the empty half of the panel. */
.rw-hero .banner-card-art {
  position: relative;
  overflow: hidden;
  border-radius: 4.5%;
  filter: drop-shadow(0 22px 30px rgb(0 0 0 / 0.66));
}

.rw-hero .banner-card-art > canvas {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 4.5%;
}

/* The slow specular crawl across the face — §3, idle is never dead. */
.rw-hero .banner-card-art::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 4.5%;
  pointer-events: none;
  background: linear-gradient(var(--light-sweep), transparent 38%, rgb(255 255 255 / 0.2) 50%, transparent 62%);
  animation: rw-pack-sheen 6.8s var(--ease-sweep, ease-in-out) infinite;
}

.rw-hero-copy { display: grid; gap: var(--sp-2); min-width: 0; align-content: center; }
.rw-hero-copy .t-display { font-size: clamp(1.5rem, 3.1vw, var(--fs-2xl)); }

/* Every child of the copy column has to release its own minimum too, not just
   the column. At --ui-scale 1.4 / 1280x720 the hero's children measured a right
   edge of 773 against a host clipping at 764 — nine pixels of overflow, which
   sliced the rate-up chip and the Legendary's name flat against the panel's
   overflow: hidden. min-width: 0 on the column alone does not reach a flex
   row inside it, and .rw-hero-meta is a flex row of two chips. */
.rw-hero-copy > * { min-width: 0; }

.rw-hero-meta { display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center; min-width: 0; }
.rw-hero-meta > .rw-tok { min-width: 0; max-width: 100%; }
.rw-hero-meta > .rw-tok > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.rw-spotlight {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--sp-3);
}

.banner-card {
  position: relative;
  display: grid;
  gap: var(--sp-2);
  justify-items: center;
  padding: var(--sp-3) var(--sp-2) var(--sp-2);
  margin: 0;
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

.banner-card-art { width: 100%; display: grid; place-items: center; }
.banner-card-art > canvas { width: 100%; height: auto; display: block; border-radius: 4.5%; }

/*
 * The socket a banner card is drawn into — and the last seven flat fills in the
 * game, which were not this domain's and were not a scrim.
 *
 * The census counts an element as a flat fill when it has a background *colour*,
 * no background image and no shadow. Seven came back on #banner, all of them
 * \`div.banner-card-art\`, all at \`rgba(0, 0, 0, 0.22)\` — and an earlier review
 * cleared them as scrims laid over card art, which would have made them exempt:
 * §1 bans a solid fill on a *surface*, not a tint over a photograph.
 *
 * They are not scrims. The rule is \`[data-art] { background-color: rgb(0 0 0 /
 * 0.22) }\` in \`screens/data/data.css\`, written unscoped for the data screens'
 * deferred painter, and this screen uses the same \`data-art\` attribute as its
 * own hook — so an unrelated domain's socket colour was landing behind seven
 * cards here. It is *behind* the picture rather than over it, which is the whole
 * difference, and it is on screen for a real window: each card is a sized empty
 * canvas until the render queue reaches it, and then the finished card fades in
 * over \`--dur-ui\` from \`opacity: 0\`. For that beat the flat rectangle is the
 * only thing drawn.
 *
 * So it gets the recess it was always standing in for: a 315° ramp, the accent
 * falling across the top-left where the key is, a lit rim, an unlit lip and the
 * inner shadow of a real socket — the same treatment \`.rw-card-slot\` already
 * gives the placeholder canvas that sits inside it, so the two agree instead of
 * one being a hole behind the other. The \`background\` shorthand is deliberate:
 * it resets \`background-color\` to transparent, which takes the borrowed fill
 * out of the cascade rather than painting over it.
 */
.banner-card .banner-card-art {
  border-radius: 4.5%;
  background:
    radial-gradient(72% 50% at 30% 18%, rgb(from var(--rw-accent, #b56cff) r g b / 0.20), rgb(from var(--rw-accent, #b56cff) r g b / 0) 74%),
    linear-gradient(var(--light-sweep), rgb(40 28 68 / 0.92) 0%, rgb(9 6 19 / 0.96) 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.09),
    inset 0 2px 6px rgb(0 0 0 / 0.45),
    inset 0 -1px 0 rgb(0 0 0 / 0.62);
}

/* The card-shaped alcove a spotlight stands in until its card is drawn.
   The seven cards on this screen are rendered off the navigation frame, which
   is what unfroze the route; for a beat there is a socket here rather than a
   card, and a socket is a thing where an empty gap is a bug. Nothing moves when
   the picture lands, because the slot is already exactly its size. */
.banner-card-art > canvas.rw-card-slot {
  background:
    radial-gradient(72% 50% at 32% 20%, rgb(from var(--rw-accent, #b56cff) r g b / 0.24), rgb(0 0 0 / 0) 72%),
    linear-gradient(var(--light-sweep), rgb(38 27 64 / 0.9) 0%, rgb(9 6 19 / 0.95) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), inset 0 -1px 0 rgb(0 0 0 / 0.6);
}

.banner-card figcaption { display: grid; gap: 5px; justify-items: center; text-align: center; width: 100%; }
.banner-card figcaption > strong { font-size: var(--fs-sm); line-height: 1.2; }

.rw-wish {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rw-wish > .hb-icon { width: 13px; height: 13px; }
.rw-wish[aria-pressed="true"] { color: var(--accent-gold); --rim-a: 0.14; }
.rw-wish[aria-pressed="true"] > .hb-icon { color: var(--accent-gold); }

/* In the side column the wishlist toggle is a mark struck onto the card's own
   corner rather than a labelled button under it. Two lines of chrome per tile
   across six tiles is 90px of column height spent on a control the player uses
   once, and the height is the whole reason the column exists. The word survives
   as the button's accessible name, and the state is carried by the star's shape
   — filled against outline — so it is not signalled by colour alone. */
.rw-spot-panel .banner-card { padding: var(--sp-2) var(--sp-2) 7px; gap: 6px; }
.rw-spot-panel .banner-card figcaption { gap: 1px; }
.rw-spot-panel .banner-card figcaption > strong {
  font-size: var(--fs-xs);
  line-height: 1.15;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  overflow: hidden;
}
.rw-spot-panel .banner-card figcaption > .rw-note { font-size: 0.62rem; line-height: 1.2; }

.rw-spot-panel .rw-wish {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 2;
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
  --r-self: var(--r-chip);
  border-radius: var(--r-chip);
}

.rw-spot-panel .rw-wish > span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.rw-spot-panel .rw-wish > .hb-icon { width: 14px; height: 14px; }

/* The pull rail. Pinned, because the pull buttons — the entire point of the
   screen — used to begin 124px below the fold at the shipped viewport. */
.rw-pullrail {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: clamp(var(--sp-3), 2vw, var(--sp-5));
  align-items: center;
  padding: var(--sp-3) clamp(var(--sp-4), 2.4vw, var(--sp-5));
  margin: 0 calc(clamp(var(--sp-4), 3vw, var(--sp-6)) * -1);
  border-radius: var(--r-panel) var(--r-panel) 0 0;
  --r-self: var(--r-panel);
  /* A top contact shadow, so the rail reads as furniture the content scrolls
     under rather than a panel that happens to be at the bottom. */
  box-shadow:
    var(--mat-cast),
    0 -18px 34px -12px rgb(0 0 0 / 0.75),
    0 -1px 0 rgb(255 255 255 / 0.06);
}

.rw-pull-side { display: grid; justify-items: end; gap: 7px; }
.rw-pull-actions { display: flex; align-items: stretch; gap: var(--sp-3); }

.rw-pull-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-xs);
  text-align: right;
}

.rw-pull-note > .hb-icon { flex: none; color: var(--accent-gold); }

.rw-pull1 {
  min-height: 48px;
  padding: 0 var(--sp-4);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-weight: 700;
}

.rw-pull10 {
  min-height: 64px;
  padding: 0 clamp(var(--sp-4), 2vw, var(--sp-6));
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 800;
}

.rw-pull10 > .hb-icon { width: 24px; height: 24px; }
.rw-pull1 > .hb-icon { width: 17px; height: 17px; }

.rw-pull-price { display: inline-flex; align-items: center; gap: 5px; }

.rw-seg {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  --r-self: var(--r-chip);
  /* inline-flex is not enough: as a grid item it is still stretched to the
     column, and on the banner's pull rail that drew a 1,120px recessed well
     holding four labels in its left third — a groove with nothing in most of
     it, which reads as a control that failed to load. */
  justify-self: start;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  /* The well's own fill is tuned to sit inside a panel; on the pull rail, which
     is already a raised panel, it disappeared and the four labels read as loose
     text floating on the furniture. A control the player is meant to press has
     to look like a control at rest, not only when one of its segments is on. */
  background-color: rgb(0 0 0 / 0.34);
  box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.6), inset 0 -1px 0 rgb(255 255 255 / 0.06);
}

.rw-seg > button {
  padding: 6px 13px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
  background: none;
  border: 0;
  border-radius: var(--r-chip);
  cursor: pointer;
  transition: color var(--dur-micro) var(--ease-arrive), background var(--dur-micro) var(--ease-arrive);
}

.rw-seg > button[aria-pressed="true"] {
  color: var(--text);
  background: linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.13) 0%, rgb(255 255 255 / 0.04) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.5);
}

.rw-summary-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
}

.banner-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  font-size: var(--fs-xs);
  --r-self: var(--r-chip);
  color: var(--text-dim);
}

.banner-pill.rarity-rare      { color: var(--rarity-rare); }
.banner-pill.rarity-epic      { color: var(--rarity-epic); }
.banner-pill.rarity-legendary { color: var(--rarity-legendary); }

/* =========================================================================
   8. The Hype Wave track
   =========================================================================
   Fifty near-identical table rows of text became a horizontal rail of tier
   nodes with a continuous meter running through them, free lane above and
   Backstage lane below — which is what all three reference games do, and it is
   also the only layout in which fifty tiers fit on a phone. */

.rw-pass-body {
  max-width: none;
  display: grid;
  grid-template-rows: auto auto auto auto;
  align-content: start;
  gap: var(--sp-3);
  padding: var(--sp-3) clamp(var(--sp-4), 3vw, var(--sp-6)) var(--sp-4);
  min-height: 0;
  overflow-y: auto;
}

.rw-pass-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: clamp(var(--sp-3), 2vw, var(--sp-5));
  align-items: center;
  padding: var(--sp-4) clamp(var(--sp-4), 2.4vw, var(--sp-5));
}

.rw-tier-badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  --r-self: 22px;
  border-radius: 22px;
}

.rw-tier-badge > .num {
  font-family: var(--font-display);
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
  min-width: 0;
}

.rw-tier-badge > .t-label { font-size: 0.6rem; color: var(--rw-faint); }

.rw-pace {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pass-pacing-ahead   { color: var(--success); }
.pass-pacing-on-pace { color: var(--accent-bright); }
.pass-pacing-rebound { color: var(--accent-gold); }

/* The track's own box, declared here rather than inline on the element, so the
   lane height and the height it needs are one calculation instead of two that
   drift.

   min-height: 0 used to be set inline on this element, and at 844x390 — a
   phone in landscape, which every screen has to work at — it let the outer grid
   squeeze the whole rail to **two pixels**: the screen rendered its header, a
   lane key, a two-pixel line, and the footnote. A track that can be compressed
   out of existence is worse than one that scrolls. */
.pass-track {
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 0;
  --lane-h: 9.2em;
}

.rw-track {
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
  /* two lanes, the medallion between them, and the padding above and below */
  min-height: calc(var(--lane-h, 9.2em) * 2 + 3.25em + var(--sp-3) + var(--sp-4));
}

.pass-rows {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 8.6em;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
  align-items: center;
  /* --lane-h is declared on .pass-track, not here, so the scroller above can
     compute the height it needs from the same number. It is in em so it grows
     with --ui-scale: at 1.4 a fixed 146px lane clipped the second reward off
     every tier that pays two. */
}

/* grid-template-columns is restated because screens.css lays a .pass-row out
   as 48px 1fr 1fr — three table columns — and a rule that only sets *rows*
   leaves that in place, which stacks the medallion on top of the free lane. */
.pass-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  /* Explicit, not 1fr. An fr track inside an auto-height grid resolves against
     max-content and produced 280px lanes that pushed the medallion off the
     bottom of the track — the layout has to be deterministic here because the
     rail line is positioned at exactly 50% of the row. */
  grid-template-rows: var(--lane-h, 9.2em) 3.25em var(--lane-h, 9.2em);
  gap: var(--sp-2);
  justify-items: center;
  align-items: stretch;
  scroll-snap-align: center;
  padding: 0 2px;
  border-bottom: 0;
  border-left: 0;
}

/* The rail runs *through* the medallions rather than beside them, so fifty
   tiers read as one continuous track instead of fifty separate cards. */
.pass-row::before {
  content: "";
  position: absolute;
  left: -6px;
  right: -6px;
  top: 50%;
  height: 10px;
  translate: 0 -50%;
  border-radius: var(--r-chip);
  background: linear-gradient(180deg, rgb(0 0 0 / 0.62) 0%, rgb(14 9 26 / 0.86) 62%, rgb(255 255 255 / 0.05) 100%);
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.7), inset 0 -1px 0 rgb(255 255 255 / 0.05);
}

.pass-row.unlocked::before {
  background: linear-gradient(180deg, rgb(255 255 255 / 0.24) 0%, var(--accent) 40%, var(--accent-hot) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35), 0 0 14px rgb(181 108 255 / 0.42);
}

.pass-row.pace::after {
  content: "";
  position: absolute;
  left: -7px;
  top: 6%;
  bottom: 6%;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, transparent, var(--accent-gold) 22%, var(--accent-gold) 78%, transparent);
  box-shadow: 0 0 9px rgb(255 204 102 / 0.7);
}

.pass-node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 3.25em;
  height: 3.25em;
  --r-self: var(--r-chip);
  border-radius: var(--r-chip);
}

.pass-node > .num {
  font-family: var(--font-display);
  font-size: var(--fs-md);
  font-weight: 800;
  min-width: 0;
  color: var(--text-dim);
}

.pass-row.unlocked .pass-node > .num { color: var(--text); }

.pass-row.unlocked .pass-node {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(150 100 232 / 0.98) 0%, rgb(86 40 148 / 0.98) 100%);
  --rim-a: 0.24;
}

.pass-node[data-milestone="1"] {
  width: 3.8em;
  height: 3.8em;
  --mat-fill: linear-gradient(var(--light-sweep), rgb(255 214 140 / 0.3) 0%, rgb(58 38 12 / 0.95) 100%);
}

.pass-node[data-milestone="1"] > .num { color: var(--accent-gold); }

/* The tier being worked on. Ring, glow and a slow breathe — opacity on a
   pseudo-element the compositor already owns, never a shadow transition, and
   there is exactly one of these on the track so the cost is one layer. */
.pass-row[data-next="1"] .pass-node {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(196 148 255 / 0.98) 0%, rgb(104 48 184 / 0.98) 100%);
  --rim-a: 0.36;
  scale: 1.08;
}

.pass-row[data-next="1"] .pass-node > .num { color: #fff; }

/* An outline rather than a pseudo-element, and this is not a stylistic
   preference: .mat-chip's specular band *is* its ::after, so a ring drawn there
   deletes the material's own highlight and inherits the band's width and
   translate — photographed, it came out as a pale crescent hanging off the left
   of the medallion. Outline follows border-radius in Chromium and is free. */
.pass-row[data-next="1"] .pass-node {
  outline: 2px solid rgb(217 165 255 / 0.72);
  outline-offset: 4px;
  box-shadow: 0 0 22px rgb(181 108 255 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.36);
}

/* The plates either side of it lift out of the uniform grey with it, so the
   focal point is a tier rather than a bead on a wire. */
.pass-row[data-next="1"] .pass-cell:not(.locked) {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(74 50 128 / 0.95) 0%, rgb(28 16 56 / 0.96) 100%);
  --rim-a: 0.18;
}

.pass-cell {
  position: relative;
  display: grid;
  gap: 5px;
  justify-items: center;
  justify-content: center;
  align-items: center;
  /* Centred, not pushed away from the rail. The lane is a fixed 9.2em because
     the rail line is drawn at exactly 50% of the row; content pinned to the far
     edge of it left forty pixels of bare plate against the medallions on both
     sides, so twenty tiers across a viewport read as a row of mostly-empty
     boxes. A centred object in a plate reads as a plate holding an object. */
  align-content: center;
  width: 100%;
  padding: var(--sp-2) 6px;
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.pass-cell.claimable {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(120 74 196 / 0.9) 0%, rgb(56 26 100 / 0.95) 100%);
  --rim-a: 0.2;
}

.pass-cell.claimed {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(44 50 54 / 0.92) 0%, rgb(20 23 26 / 0.95) 100%);
}

.pass-cell.locked {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(26 21 40 / 0.96) 0%, rgb(11 8 19 / 0.98) 100%);
  --lip-a: 0.72;
}

/* Every tenth tier is a milestone, and a rail of fifty identical plates has no
   rhythm to read — the eye needs somewhere to land while it is scrolling. The
   medallion already goes gold here; the plate follows it, warm rather than
   violet, so the track has a beat every ten tiers the way Hearthstone's rewards
   track puts a chest at each landmark. */
.pass-cell[data-milestone="1"] {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(70 54 30 / 0.95) 0%, rgb(19 13 8 / 0.98) 100%);
  --rim-a: 0.2;
}

.pass-cell[data-milestone="1"]:not(.locked)::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgb(255 200 110 / 0.24);
}

.pass-rewards { display: grid; gap: 4px; justify-items: center; flex-wrap: nowrap; }

/* A lane is one fixed height for every tier, because the rail line is drawn at
   exactly 50% of the row and a variable lane would put it somewhere different
   on every tier. Milestone tiers pay two rewards into that same box, and at
   full size the second one's caption was clipped by the cell's own overflow. So
   a two-reward cell draws smaller: the constraint is the rail, and the rail is
   worth more than forty pixels of plate. */
.pass-cell:not([data-rewards="1"]) .rw-tile-art { width: 2.4em; height: 2.4em; }
.pass-cell:not([data-rewards="1"]) .rw-tile { padding: 2px; }
.pass-cell:not([data-rewards="1"]) .pass-reward {
  -webkit-line-clamp: 1;
  line-clamp: 1;
  font-size: 0.62rem;
}

.pass-reward {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  /* screens.css sets nowrap on this class, which silently defeats the clamp
     and turns every two-word cosmetic name into an ellipsis. */
  white-space: normal;
  gap: 4px;
  font-size: 0.68rem;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.25;
  max-width: 16ch;
}

.pass-reward.deferred { position: relative; padding-right: 8px; }

.pass-reward.deferred::after { position: absolute; right: 0; top: 6px; }

/* A dotted underline reads as a spelling error, not as a deferral. A note mark
   and a real title attribute reads as a footnote, which is what it is. */
.pass-reward.deferred { color: var(--text-dim); }

.pass-reward.deferred::after {
  content: "";
  width: 4px;
  height: 4px;
  border-radius: var(--r-chip);
  background: var(--warning);
  box-shadow: 0 0 5px rgb(255 176 32 / 0.8);
  flex: none;
}

.pass-claim {
  padding: 3px 10px;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.pass-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  /* --text-dim, not --text-faint. A locked tier is the thing a player is
     deciding whether to chase; it has to clear 4.5:1, and the old track put it
     at 42% alpha over a dark plate. */
  color: var(--text-dim);
}

.pass-state > .hb-icon { width: 12px; height: 12px; }
.pass-state[data-state="claimed"] { color: #a9d9bb; }
.pass-state[data-state="claimed"] > .hb-icon { color: var(--success); }

.pass-choices {
  position: absolute;
  left: 50%;
  top: calc(100% + 6px);
  translate: -50% 0;
  z-index: 6;
  display: grid;
  gap: 5px;
  padding: var(--sp-3);
  width: max-content;
  max-width: 260px;
  animation: rw-pop 220ms var(--ease-overshoot) both;
}

@keyframes rw-pop {
  from { opacity: 0; transform: translateY(-8px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.pass-lane-key {
  display: flex;
  gap: var(--sp-4);
  align-items: center;
  flex-wrap: wrap;
  padding: 0 var(--sp-4) var(--sp-2);
}

.rw-lane-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rw-faint);
}

.rw-lane-tag > .hb-icon { width: 14px; height: 14px; }

/* The list view, kept for keyboard and screen-reader users and for anybody who
   simply wants to read fifty rows. A rail must never be the only way in.

   This state shipped broken and had clearly never been photographed. One click
   on LIST at 1600x900 collapsed all fifty tiers to 8px slivers laid out
   *horizontally*, burst every panel past the right edge of the viewport and
   took the WAVE REBOUND chip, the Backstage CTA, Skip a tier and the toggle
   itself off-screen with it. The cause is one missing override: the rule below
   restyled .pass-row, but the <ul class="pass-rows"> *between* the scroller
   and the rows kept grid-auto-flow: column; grid-auto-columns: 8.6em from the
   rail — so fifty list rows were laid out as fifty 8.6em columns and every row
   was squeezed to a track. A container that changes what its rows mean has to
   restate the flow, and it has to contain its own overflow the way .rw-track
   does or the whole page scrolls sideways instead. */
.rw-pass-list {
  display: grid;
  gap: 4px;
  padding: var(--sp-3) var(--sp-4);
  min-width: 0;
  max-height: min(56vh, 620px);
  overflow-x: hidden;
  overflow-y: auto;
}

.rw-pass-list .pass-rows {
  grid-auto-flow: row;
  grid-auto-columns: auto;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  min-width: 0;
  gap: 4px;
}

.rw-pass-list .pass-row {
  grid-template-rows: none;
  grid-template-columns: 44px minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  justify-items: stretch;
  gap: var(--sp-3);
  padding: 5px 0;
}

.rw-pass-list .pass-row::before,
.rw-pass-list .pass-row::after { display: none; }
.rw-pass-list .pass-cell {
  min-height: 0;
  min-width: 0;
  height: auto;
  grid-auto-flow: column;
  grid-template-columns: minmax(0, 1fr) auto;
  justify-content: space-between;
  align-items: center;
  padding: 6px var(--sp-3);
}
.rw-pass-list .pass-rewards { grid-auto-flow: column; justify-content: start; align-items: center; gap: var(--sp-2); min-width: 0; }
.rw-pass-list .pass-node { width: 40px; height: 40px; }
/* A row is a row: the rail's 3.6em tile is a picture you scroll past, and in a
   document it is a bullet beside a sentence. */
.rw-pass-list .rw-tile-art { width: 2.2em !important; height: 2.2em !important; }
.rw-pass-list .pass-reward {
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--fs-xs);
  max-width: none;
  text-align: left;
}

/* =========================================================================
   9. Missions
   ========================================================================= */

.rw-missions-body {
  display: grid;
  gap: var(--sp-4);
  align-content: start;
  padding: var(--sp-4) clamp(var(--sp-4), 3vw, var(--sp-6)) var(--sp-6);
}

.rw-panel-pad { padding: clamp(var(--sp-4), 2vh, var(--sp-5)); }

.rw-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  margin-bottom: var(--sp-3);
}

.rw-section-title {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
}

.rw-section-title > .hb-icon { width: 19px; height: 19px; color: var(--accent-bright); }

/* auto-fit, not auto-fill. The list is always exactly three items and
   auto-fill manufactured empty tracks, abandoning six hundred pixels. */
.missions-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Flex column, not grid, and the reason is one line further down: the actions
   row carries an auto top margin so it sits on the card's bottom edge whatever
   is above it. In a grid with align-content: start that margin does nothing —
   the rows pack at the top and the auto margin has no free space to eat — so a
   two-objective weekly pushed its Reroll button forty pixels below the buttons
   either side of it, in a row of cards the grid had already stretched to equal
   height. In a flex column the same declaration works. */
.mission {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

.mission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.mission-name { font-weight: 700; font-size: var(--fs-md); line-height: 1.25; }
.mission-reward { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.mission-text { margin: 0; font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.45; }
.mission-part { display: grid; gap: 5px; }
.mission-part-label { display: flex; justify-content: space-between; gap: var(--sp-2); font-size: var(--fs-xs); }
.mission-actions { display: flex; gap: var(--sp-2); margin-top: auto; padding-top: var(--sp-2); }
.mission-actions > * { flex: 1; }

.mission.done {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(74 52 130 / 0.95) 0%, rgb(30 18 58 / 0.96) 100%);
  --rim-a: 0.14;
}

.checkin-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.checkin-step {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 5px;
  padding: var(--sp-3) 6px var(--sp-2);
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

.checkin-index {
  position: absolute;
  top: 5px;
  left: 7px;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--text-dim);
}

.checkin-step.next {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(126 78 206 / 0.95) 0%, rgb(60 28 108 / 0.96) 100%);
  --rim-a: 0.22;
  transform: scale(1.035);
}

.checkin-step.claimed {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(44 50 54 / 0.92) 0%, rgb(20 23 26 / 0.95) 100%);
}

.rw-restock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  padding: var(--sp-3) var(--sp-4);
  margin-top: var(--sp-3);
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

/* =========================================================================
   10. Achievements
   ========================================================================= */

.rw-ach-body {
  max-width: 1480px;
  display: grid;
  gap: var(--sp-4);
  align-content: start;
  padding: var(--sp-4) clamp(var(--sp-4), 3vw, var(--sp-6)) var(--sp-6);
}

.rw-ach-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: clamp(var(--sp-4), 3vw, var(--sp-6));
  align-items: center;
  padding: clamp(var(--sp-4), 2vh, var(--sp-5));
}

.ach-score { display: grid; justify-items: center; gap: 2px; }

.ach-score-value {
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 5vw, 3.4rem);
  font-weight: 800;
  line-height: 1;
  color: var(--accent-bright);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 26px rgb(217 165 255 / 0.4);
}

.ach-milestones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ach-milestone {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-3);
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

.ach-milestone-body { display: grid; gap: 6px; min-width: 0; }
.ach-milestone-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.ach-milestone-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); flex-wrap: wrap; }

.ach-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ach-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--sp-3);
  align-items: center;
  padding: var(--sp-3);
  --r-self: var(--r-tile);
  border-radius: var(--r-tile);
}

/* A slot, not an image. The badge is struck off the navigation frame, so this
   has to be the right size and the right shape while it is empty — a socket the
   plate drops into, rather than a hole that appears and then fills. */
.ach-badge {
  position: relative;
  width: 58px;
  height: 58px;
  flex: none;
  display: grid;
  place-items: center;
  overflow: visible;
  image-rendering: auto;
}

.ach-badge > img { width: 100%; height: 100%; display: block; object-fit: contain; }

.ach-badge-num {
  display: grid;
  place-items: center;
  width: 78%;
  height: 78%;
  border-radius: 26%;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 0.9rem;
  color: var(--rw-faint);
  background: linear-gradient(var(--light-sweep), rgb(46 38 68 / 0.9) 0%, rgb(12 8 22 / 0.95) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12), inset 0 -1px 0 rgb(0 0 0 / 0.6);
}

.ach-row-body { display: grid; gap: 6px; min-width: 0; }
.ach-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
.ach-name { font-size: var(--fs-md); }
.ach-rewards { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.ach-reward.rw-tile { min-width: 0; padding: 4px; }
.ach-text { margin: 0; font-size: var(--fs-sm); line-height: 1.4; }
.ach-progress { display: flex; justify-content: space-between; font-size: var(--fs-xs); }
.ach-deferred { margin: 0; font-size: var(--fs-sm); color: var(--warning); }
/* The payout stacked over the state, centred against the row rather than pinned
   to its top: reward, then whether you can have it, read top to bottom in one
   column. */
.ach-action {
  position: relative;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 7px;
}
/* A locked row's action cell holds nothing but a screen-reader word, and an
   empty track still costs a gap. */
.ach-action:empty, .ach-row:not(.unlocked):not(.claimed) .ach-action { gap: 0; }

.ach-row.claimed  { --mat-fill: linear-gradient(var(--light-sweep), rgb(44 50 54 / 0.9) 0%, rgb(19 22 25 / 0.94) 100%); }
.ach-row.unlocked:not(.claimed) { --mat-fill: linear-gradient(var(--light-sweep), rgb(78 56 132 / 0.95) 0%, rgb(30 18 58 / 0.96) 100%); --rim-a: 0.13; }

.ach-category-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  flex-wrap: wrap;
  margin-bottom: var(--sp-3);
}

.ach-category-pct {
  margin-left: auto;
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  font-weight: 800;
  color: var(--accent-bright);
  font-variant-numeric: tabular-nums;
}

/* =========================================================================
   11. Shared furniture
   ========================================================================= */

.rw-tabs { display: flex; gap: var(--sp-2); flex-wrap: wrap; }

.rw-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 15px;
  font-size: var(--fs-sm);
  font-weight: 700;
}

.rw-tab[aria-selected="true"] {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(132 84 214 / 0.95) 0%, rgb(66 32 118 / 0.96) 100%);
  --rim-a: 0.2;
  color: #fbf5ff;
}

.rw-badge {
  display: inline-grid;
  place-items: center;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-invert);
  background: linear-gradient(var(--light-sweep), var(--accent-bright) 0%, var(--accent-hot) 100%);
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5), 0 1px 4px rgb(0 0 0 / 0.6);
}

.rw-note {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.5;
}

.rw-quiet { color: var(--rw-faint); }

.rw-row { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
.rw-spread { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
.rw-stack { display: grid; gap: var(--sp-3); }
.rw-stack-tight { display: grid; gap: var(--sp-2); }

.rw-back {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 15px;
  font-weight: 700;
}

.rw-back > .hb-icon { width: 16px; height: 16px; }

/* =========================================================================
   11b. Undoing the old domain
   =========================================================================
   screens.css still carries the previous version of all five screens, and it is
   not this module's file to edit. Nine class names are kept on the rebuilt
   markup on purpose — they are what the five browser checks in scripts/ drive,
   and a check that can still prove a *rebuilt* shop charges the right price is
   worth more than a tidy selector. The cost is this block.

   Two kinds of rule are neutralised here, and only two:

   1. **The six opacity-only states.** .pass-cell.claimed { opacity: .55 },
      .pass-cell.locked { .42 }, .ach-row.claimed { .66 },
      .ach-milestone.claimed { .62 }, .checkin-step.claimed { .5 }. Dim text
      at 42% alpha measures far under 4.5:1 — the locked Hype Wave rewards, the
      ones a player is deciding whether to chase, were the least readable thing
      on the screen. Every one of those states is redrawn above with a different
      fill, border, icon and label, so the alpha has to go rather than stack.
   2. **Rules that out-specify this sheet.** Same-specificity rules lose to this
      file by source order; these three do not, so they are answered directly. */

.pass-cell.claimed,
.pass-cell.locked,
.pass-cell.claimable,
.ach-row.claimed,
.ach-row.unlocked,
.ach-milestone.claimed,
.ach-milestone.unlocked,
.checkin-step.claimed,
.checkin-step.next,
.mission.done,
.rw-tok,
.rw-tile { opacity: 1; }

.pass-reward.deferred { text-decoration: none; }

/* The old reveal was a 180ms opacity cross-fade of five 150px thumbnails, and
   three of its rules carry a class-plus-class specificity this sheet cannot
   reach from a single class. Without these the card back vanishes the instant
   the flip starts, and the face un-rotates to flat at the end of it. */
.rw-open.shop-reveal {
  position: fixed;
  background: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  align-items: center;
  justify-items: stretch;
}

.rw-open .reveal-slot { display: block; gap: 0; }
.rw-open .reveal-front { opacity: 1; transition: none; }
.rw-open .reveal-slot.shown .reveal-front { opacity: 1; transform: rotateY(180deg); }
.rw-open .reveal-slot.shown .reveal-back { opacity: 1; }
.rw-open .reveal-back { background: none; border: 0; box-shadow: none; }

/* Belt and braces on the spoiler. Even if a rarity class ever finds its way back
   onto a slot, the face-down card stays anonymous — telling the player what they
   have before they turn it over removes the only tension the mechanic has. */
.rw-open .reveal-slot.legendary .reveal-back,
.rw-open .reveal-slot.epic .reveal-back { box-shadow: none; border-color: transparent; }
.rw-open .reveal-tag { min-height: 0; text-transform: none; letter-spacing: 0; }
.rw-open .reveal-cards { flex-wrap: nowrap; }

/* The old track was a list; the choices popover was laid out for a table row. */
.pass-row .pass-choices { display: grid; grid-column: auto; padding: var(--sp-3); }

/* The old tiles painted their own glass, which would sit on top of the
   material's fill and delete its bevel. */
.rw-spotlight .banner-card,
.rw-hero .banner-card,
.checkin-step,
.mission,
.ach-row,
.ach-milestone,
.ach-tabs .mastery-tab,
.pass-cell,
.banner-pill,
.rw-tok { background-color: transparent; }

/* The achievements tabs keep .mastery-tab because the browser check counts
   them by that name; the styling comes from .rw-tab. */
.ach-tabs .mastery-tab { border-width: 1px; padding: 8px 15px; }

.banner-pill.rarity-rare,
.banner-pill.rarity-epic,
.banner-pill.rarity-legendary,
.pass-cell.claimable,
.ach-row.unlocked,
.ach-milestone.unlocked,
.checkin-step.next,
.mission.done { border-color: rgb(255 255 255 / calc(var(--rim-a) * var(--rim-boost))) rgb(0 0 0 / calc(var(--lip-a) * 0.55)) rgb(0 0 0 / var(--lip-a)) rgb(255 255 255 / calc(var(--rim-a) * 0.5 * var(--rim-boost))); }

/* The hero is one of the seven featured cards — the browser check counts them —
   so it keeps the class and loses the tile. */
.rw-hero .banner-card {
  position: relative;
  display: block;
  padding: 0;
  margin: 0;
  border: 0;
  box-shadow: none;
  background: none;
  /* The recon asked for 380–420px against a 150px original. The ceiling used to
     be the hero panel's share of a scroller that had to show the spotlight row
     underneath it; now the spotlights are the column beside it, and the height
     the hero may spend is whatever that column sets. 39vh is 351px at 900 and
     444px at 1080, and the clamp's floor is what keeps a phone in landscape from
     handing the card the whole viewport. */
  width: clamp(200px, 43vh, 420px);
}

.rw-hero .banner-card-art { width: 100%; }
.rw-hero .banner-card figcaption { display: none; }

/* =========================================================================
   12. Small viewports
   ========================================================================= */

@media (max-width: 1120px) {
  /* One column, and it has to *scroll* — the two-column layout is the only one
     that can afford to clip, because on it nothing is ever below the fold.

     grid-auto-rows: max-content is what makes it actually scroll. Without it
     the stacked rows were squeezed into the remaining viewport instead of
     overflowing it: measured at 844x390, the left column was handed a **nine
     pixel** row, spilled its two panels out of it, and the hero painted
     straight over the headliner. */
  .rw-shop-body {
    grid-template-columns: 1fr;
    grid-auto-rows: max-content;
    align-content: start;
    overflow-y: auto;
  }
  .rw-shop-left { overflow: visible; }
  .rw-shop-hero { min-height: 62vh; }
  .rw-shop-pack > .rw-pack-still { height: auto; width: min(34vh, 200px); }
  .rw-hero { grid-template-columns: 1fr; justify-items: center; text-align: center; }
  .rw-hero-copy { justify-items: center; }
  .rw-ach-summary { grid-template-columns: 1fr; }
  .rw-pass-head { grid-template-columns: auto minmax(0, 1fr); }
  .rw-pass-head > :last-child { grid-column: 1 / -1; }
}

/* A phone in landscape: 844×390. Everything above has to survive 390px of
   height, which is the constraint that kills a fixed-height hero. */
@media (max-height: 800px) {
  .pass-track { --lane-h: 7.4em; }
}

@media (max-height: 620px) {
  /* 6.4em, not 5.2: a lane has to hold a 40px tile, a gap and two lines of
     caption, and at 5.2em (83px) the cell's own overflow: hidden cut the second
     line off every two-word cosmetic on the track. The body scrolls; the lane
     does not get to lie about what is in it. */
  .pass-track { --lane-h: 6.4em; }
  .pass-cell { padding: 5px; }
  .pass-node { width: 2.6em; height: 2.6em; }
  .rw-pass-head { padding: var(--sp-3); }
  /* The two purchase buttons side by side rather than stacked: on a phone in
     landscape the header was eating two thirds of 390px of viewport before the
     track had drawn a single tier. */
  .rw-pass-head > :last-child { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }
}

@media (max-height: 460px) {
  /* A phone in landscape has 390px of height and the banner was spending 194 of
     it on furniture before the hero drew a pixel: header, a wrapped tab row, and
     a pull rail carrying four stacked things. What survives is what the screen
     is for — the meter, the price and the two buttons — and the sentence under
     the bar goes, because the tabular "0 / 50" directly above it says the same
     thing in three characters. */
  .rw-banner-topbar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  #banner-meter-label { display: none; }
  .rw-pullrail { padding: 8px 12px; gap: var(--sp-3); }
  .rw-pull-note { display: none; }
  .rw-hero { padding: var(--sp-3); }
  .rw-hero .banner-card { width: min(46vh, 156px); }
  .rw-open { grid-template-rows: auto 1fr auto; gap: 6px; padding: 8px 12px; }
  .rw-open-head .t-display { font-size: var(--fs-md); }
  .rw-pack { width: min(38vh, 150px); }
  .reveal-tag { bottom: -19px; }
  .reveal-tag > span { font-size: 0.58rem; padding: 1px 5px; }
  .rw-shop-pack > .rw-pack-still { width: min(30vh, 130px); }
  .rw-tier-badge { width: 62px; height: 62px; }
  .rw-tier-badge > .num { font-size: 1.5rem; }
  .rw-pull10 { min-height: 50px; font-size: var(--fs-md); }
  .rw-pull1 { min-height: 42px; }
}

@media (max-width: 700px) {
  .rw-stage > .reveal-cards { --rw-cols: 3 !important; }
  .rw-pullrail { grid-template-columns: 1fr; }
  .rw-pull-actions > * { flex: 1; }
  .ach-row { grid-template-columns: auto minmax(0, 1fr); }
  .ach-action { grid-column: 1 / -1; justify-items: start; }
}

/* =========================================================================
   13. Reduced motion
   =========================================================================
   §3's hard requirement: the decorative layer goes, the functional layer stays.
   A pack still opens, cards still turn over, the count still lands on the right
   number — they simply stop being a performance. */

:root[data-reduced-motion="true"] .rw-rail-fill::after,
:root[data-reduced-motion="true"] .rw-pack::after,
:root[data-reduced-motion="true"] .rw-hero-card::after,
:root[data-reduced-motion="true"] .rw-shop-pack .rw-pack-still::after,
:root[data-reduced-motion="true"] .rw-burst,
:root[data-reduced-motion="true"] .rw-flash {
  display: none;
}

/* Enumerating them was the mistake, and it is why two survived: rw-pack-shadow
   on .rw-shop-pack::after and rw-hero-drift on .rw-shop-hero::before were
   both still running under prefers-reduced-motion: reduce, so the shop showed
   a completely static pack standing over a contact shadow that kept pulsing and
   scaling underneath it — worse than either state on its own. Nothing this
   domain owns is exempt, so the rule is now everything under a rewards body and
   everything in the overlay, with the entrance cascade named back in because a
   backwards-filled animation that never runs would leave its element at 20%
   opacity forever. */
:root[data-reduced-motion="true"] .rw-shop-body *,
:root[data-reduced-motion="true"] .rw-shop-body *::before,
:root[data-reduced-motion="true"] .rw-shop-body *::after,
:root[data-reduced-motion="true"] .rw-banner-body *,
:root[data-reduced-motion="true"] .rw-banner-body *::before,
:root[data-reduced-motion="true"] .rw-banner-body *::after,
:root[data-reduced-motion="true"] .rw-pass-body *,
:root[data-reduced-motion="true"] .rw-pass-body *::before,
:root[data-reduced-motion="true"] .rw-pass-body *::after,
:root[data-reduced-motion="true"] .rw-missions-body *,
:root[data-reduced-motion="true"] .rw-missions-body *::before,
:root[data-reduced-motion="true"] .rw-missions-body *::after,
:root[data-reduced-motion="true"] .rw-ach-body *,
:root[data-reduced-motion="true"] .rw-ach-body *::before,
:root[data-reduced-motion="true"] .rw-ach-body *::after,
:root[data-reduced-motion="true"] .rw-open *,
:root[data-reduced-motion="true"] .rw-open *::before,
:root[data-reduced-motion="true"] .rw-open *::after,
:root[data-reduced-motion="true"] .rw-pack,
:root[data-reduced-motion="true"] .rw-shop-pack > .rw-pack-still,
:root[data-reduced-motion="true"] .rw-shop-pack::after,
:root[data-reduced-motion="true"] .rw-shop-hero::before,
:root[data-reduced-motion="true"] .rw-pack-hint,
:root[data-reduced-motion="true"] .rw-hero::before,
:root[data-reduced-motion="true"] .checkin-step.next::before,
:root[data-reduced-motion="true"] .pass-cell.claimable::before,
:root[data-reduced-motion="true"] .rw-tok[data-state="claimable"]::before,
:root[data-reduced-motion="true"] .reveal-slot.shown[data-rarity="legendary"]::before {
  animation: none;
}

/* Nothing is excepted, and nothing needs to be: every entrance in this domain
   is authored backwards or both, which fills only while the animation
   exists — an element whose animation never runs simply renders at its own
   resting style. The functional half of the claim survives regardless, because
   the counter is tickerTo, which reads the same setting in JavaScript and
   writes the final number in one assignment. */

:root[data-reduced-motion="true"] .rw-flip { transition-duration: 90ms; }
:root[data-reduced-motion="true"] .reveal-slot.rw-dealing { animation-duration: 90ms; animation-delay: 0ms; }
:root[data-reduced-motion="true"] .rw-rail-fill { transition-duration: 120ms; }

/* The low tier gets the same treatment for the two effects that are measurably
   expensive rather than merely decorative: a backdrop blur over the whole
   viewport, and a conic gradient animating on ten elements at once. */
:root[data-gfx-tier="low"] .rw-open-veil { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgb(3 1 8 / 0.96); }
:root[data-gfx-tier="low"] .rw-burst[data-rays="1"]::after { display: none; }

/* =========================================================================
   14. High contrast
   =========================================================================
   The one setting that is allowed to remove atmosphere, because atmosphere over
   a paragraph is exactly what it exists to remove. */

:root[data-contrast="high"] .rw-tile-name,
:root[data-contrast="high"] .pass-reward,
:root[data-contrast="high"] .rw-note { color: var(--text); }

:root[data-contrast="high"] .rw-open-veil { backdrop-filter: none; -webkit-backdrop-filter: none; background: #05030b; }
:root[data-contrast="high"] .rw-hero::before,
:root[data-contrast="high"] .rw-shop-hero::before { display: none; }
`;

/* -------------------------------------------------------------------------
   Installation
   ------------------------------------------------------------------------- */

/**
 * Put the sheet in the document, once.
 *
 * Every reward screen calls this in its constructor. It is idempotent by id
 * rather than by a module-level boolean, because a hot reload replaces the
 * module and not the document — and two copies of this sheet is two copies of
 * every keyframe, which is the kind of thing that only shows up as a mysterious
 * extra 200KB in a profile six weeks later.
 */
export function installRewardsTheme(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = createStyleElement(doc);
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** For tests, which share one document across cases. */
export function resetRewardsTheme(doc: Document | undefined = globalThis.document): void {
  doc?.getElementById(STYLE_ID)?.remove();
}
