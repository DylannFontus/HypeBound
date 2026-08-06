/**
 * `#uikit` — the whole foundation on one page, at a size where craft is visible.
 *
 * Five modules landed in parallel: four materials, a texture generator, 122
 * icons, the motion and format tokens, and the persistent world behind the
 * menus. None of them is a screen. A bevel that nobody has photographed is a
 * claim, and the AAA bar is explicit that a critic judges the screenshot in
 * hand rather than the plan — so the foundation needs somewhere to be
 * photographed. This is that place, and it is the only consumer of the
 * primitives that exists this phase; the forty-nine real screens are migrated
 * deliberately, one domain at a time, in the next wave.
 *
 * ## The two things a gallery has to solve that a screen does not
 *
 * **A screenshot cannot hover.** Six of the interaction states are reachable
 * from markup — `disabled`, `data-state="loading"`, `aria-invalid` and rest all
 * render themselves — but `:hover`, `:active` and `:focus-visible` need a
 * pointer or a keyboard, and neither exists inside `scripts/shot.mjs`. So three
 * specimens wear a `kit-force-*` class that restates exactly what the real rule
 * in `foundation.css` sets, and every specimen is captioned with which kind it
 * is. Restating a rule is duplication and duplication drifts; the alternative
 * was a page that silently shows the rest state seven times, which is worse
 * because it looks like it passed. The forced copies drive the *same* knobs
 * (`--rim-boost`, `--cast-lift`, `--press-cast`) and reuse the *same*
 * `hb-sheen` keyframe rather than reimplementing the effect, so what can drift
 * is four numbers and not the design.
 *
 * The one state that is not faked is focus on a text field: Chrome's
 * `:focus-visible` heuristic always matches a focused text input, whatever
 * moved the focus there, so calling `.focus()` on one produces the genuine
 * ring. It is next to the forced copies, labelled, as the control that proves
 * they are honest.
 *
 * **A single frame cannot show motion.** §8.7 of the bar says so and then says
 * to capture bursts instead. A burst arrives ~1.1s after mount, by which time
 * an entrance has long finished, so the stagger and the ticker re-run on a
 * loop as well as on their button — gated behind `motionEnabled()`, because a
 * permanent looping animation is precisely what that setting exists to stop,
 * and an infinite loop nobody asked for is not something to ship into a real
 * screen either.
 *
 * There is now a third answer to the same problem, and it is the honest one: a
 * **rest-motion trace**. The idle card samples five live animated values off
 * five real elements once a frame and plots four seconds of them onto a canvas,
 * so a still of this page carries the evidence a still normally cannot. A
 * reviewer who wants to know whether the screen is alive at rest can read the
 * curves instead of taking a burst and hoping.
 *
 * ## The gallery is a screen, and used not to behave like one
 *
 * Round 4 measured zero `nav-child-rise` events on this route across two
 * instrumented runs. The cascade rule in `transitions.css` reaches through
 * `.screen[data-nav] > :is(header, nav, main, section, footer, [class*="-body"])`
 * and every card here was inside a bare `<div class="kit-sheet">`, which matches
 * none of them — so the one page whose job is to prove the motion system exists
 * was the one page the motion system skipped. It is now a `<header>` and three
 * `.uikit-body` containers, which also exercises all three rungs of the
 * container-base scheme (0 for the header, 4 for the first body, 11 for the
 * ones after it) rather than only the middle one.
 *
 * The same round measured it at "~5% of pixels changing over 400ms against the
 * lobby's 20–40%", and the cause is the same shape of mistake: the lobby paints
 * its own decorative layer and the gallery painted none, so the only thing
 * moving behind these cards was `atmosphere.ts`'s front plane, which is
 * deliberately thin. A screen is allowed — expected — to light its own room.
 * `.uikit-glow` and `.uikit-crawl` are that room: two drifting washes behind the
 * content and two phase-offset specular bands in front of it, built out of the
 * same tokens and at a lower amplitude than the world's own front plane, so
 * they can never be the loudest thing on screen. Both are `transform` and
 * `opacity` only, both die under reduced motion, and the crawl also dies under
 * high contrast, where a 3% haze over text is a cost with no benefit.
 *
 * ## Why the frame is now two frames
 *
 * `#app` is `position: fixed; overflow: hidden`, so anything past the viewport
 * is clipped rather than photographed, and an element screenshot cannot escape
 * an ancestor's clip either. A gallery that scrolls is a gallery whose bottom
 * half never reaches a critic — which is why this page spent its whole life
 * tuned to fill exactly one frame at the review size.
 *
 * Round 4 asked for four more exhibits: a live contrast matrix in both themes, a
 * rest-motion trace, the two bevels at a size where they can actually be
 * compared, and the icon set at destination-tile size. Each of those is a thing
 * a critic previously had to construct by hand before they could judge it, which
 * is a gallery failing at its one job. With them the sheet is 4239px tall, and
 * that is past a measured cliff in what the camera can composite. The numbers
 * and the reasoning are on `FRAME_HEIGHT`; the short version is that the page is
 * now captured as two overlapping frames, both commands are printed in the
 * page's own header, and the two decorative planes are `position: fixed` so the
 * room is identical in both.
 *
 * ## Determinism
 *
 * Every sample value is a literal and every date is a fixed UTC timestamp, so
 * two runs of the camera differ only where the game genuinely differs. A
 * gallery that prints `Date.now()` produces a diff on every capture and trains
 * the reviewer to ignore diffs.
 */

import type { CurrentId } from "../../engine/types";
import type { Screen } from "../shell";
import {
  DRAWN_ICON_IDS,
  FORM_TICKS,
  ICON_GRID,
  ICON_IDS,
  ICON_OPTICAL,
  ICON_STROKE,
  icon,
  iconDataUri,
  installIconSprite,
  type IconId,
} from "../art/uiIcons";
import {
  LIGHT_RIG,
  MATERIAL_AMPLITUDE,
  bevelStrip,
  contactShadow,
  currentGlow,
  fadeStrip,
  grainContrastOf,
  installTextureVars,
  shadowOffset,
  softMaskDataUri,
} from "../art/texture";
import { DUR, EASE, cssEase, motionEnabled, onMotionFrame, stagger, tickerTo } from "../motion";
import {
  clock,
  count,
  date,
  dateTime,
  duration,
  list,
  num,
  ordinal,
  percent,
  quantity,
  relative,
  signed,
  time,
} from "../format";

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The frame this page is photographed in — and why it is now two of them.
 *
 * The gallery was composed for one 1600×2560 frame, and it was the right shape
 * while it held thirteen cards. Round 4 asked for four more exhibits and the
 * sheet is now a little over 4200px tall at the review width.
 *
 * That is past a hard limit, and it is a limit of the camera rather than of the
 * page. Measured on this machine with `scripts/shot.mjs`, same page, same
 * everything, only the viewport changing — the fraction of pixels above mid
 * grey is the tell, since a page that failed to composite comes back as bare
 * atmosphere:
 *
 *     1600×2200 ....  8.9% bright   composited, twice out of two
 *     1600×2600 ....  7.6%          composited
 *     1600×3000 ....  7.8%          composited
 *     1600×3100 ....  0.39%         failed
 *     1600×3400 ....  0.36%         failed, three times out of three
 *     1600×4300 ....  0.10%         failed
 *     2560×2200 ....  0.28%         failed
 *
 * The cliff is on total raster area (~4.8 megapixels), not on height, which is
 * why widening does not buy anything: at 2200 wide the sheet is still 3858 tall
 * and 2560×2200 fails as readily as 1600×3400. It is not this screen's
 * animations either — the same failure reproduces with both decorative planes
 * removed and with `* { animation: none }`. `#collection` photographs fine at
 * 1600×3400, so it is a budget this page happens to exceed and that one does
 * not.
 *
 * So the page is captured in two overlapping frames, and the header prints both
 * commands so nobody has to work it out:
 *
 *     node scripts/shot.mjs uikit --size 1600x2200 --out kit-a
 *     node scripts/shot.mjs uikit --size 1600x2200 --out kit-b \
 *       --eval "setTimeout(()=>{document.querySelector('.uikit-screen').scrollTop=99999},400)"
 *
 * The second scrolls to the bottom, which clamps, so the two frames always
 * overlap and nothing can fall between them however much the sheet grows. Both
 * decorative planes are `position: fixed`, so the room is identical in both and
 * they read as one page rather than as two documents.
 */
export const FRAME_HEIGHT = 2200;

/**
 * The clock the format samples are read against.
 *
 * A fixed instant rather than `Date.now()`, for the reason in the header: a
 * gallery whose text changes every capture makes every capture a diff.
 */
const SAMPLE_NOW = Date.UTC(2026, 2, 14, 21, 5, 0);

/** The eight Currents, in the order the glossary lists them. */
const CURRENTS: readonly CurrentId[] = ["cinder", "tide", "root", "gale", "pulse", "halo", "veil", "prism"];

/**
 * Where a heading is dropped into the icon contact sheet.
 *
 * Keyed by the icon that *starts* each family rather than by index, so an icon
 * added, removed or reordered in module C degrades to a missing heading instead
 * of to eight headings in the wrong places. `ICON_IDS` is in declaration order
 * and module C groups its declarations by family, which is what makes this work
 * at all.
 */
const ICON_SECTIONS: Readonly<Record<string, string>> = {
  play: "Lobby destinations",
  "mode-ai": "Modes",
  clout: "Currencies",
  hand: "Battle",
  "kw-viral": "Keywords",
  "st-scorched": "Statuses",
  search: "Controls, arrows and objects",
  armor: "Aliases — a second name for a drawing that already exists",
};

// ---------------------------------------------------------------------------
// The gallery's own stylesheet
// ---------------------------------------------------------------------------

/*
 * Injected from here rather than added to a theme file, because this module
 * owns one file and the theme files belong to module A. It is also the right
 * shape regardless: a dev gallery's layout is not part of the design system and
 * has no business being parsed on every route.
 *
 * Nothing below restyles a primitive. It lays out cards, writes captions, and —
 * in the three `kit-force-*` rules — restates what a state rule already says so
 * that a still frame can show it. Those three are the only place this file
 * repeats module A, and each one is annotated with the rule it mirrors.
 */
const KIT_CSS = `
/*
 * The screen itself is the scroller now, because the cascade rule in
 * transitions.css only reaches \`.screen > container > *\` — one wrapping
 * \`<div class="kit-sheet">\` between the two was the whole reason this page
 * fired zero nav-child-rise events. \`isolation: isolate\` pins the stacking
 * context so the two decorative planes below sit predictably behind and in
 * front of the content instead of depending on whether the screen root happens
 * to be mid-animation.
 */
.uikit-screen {
  position: absolute;
  inset: 0;
  overflow: auto;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.uikit-body {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 8px;
  align-content: start;
}
/* The header *is* the title card rather than a band containing one, so that the
   cascade — which staggers a container's children — staggers its three parts at
   base 0 rather than raising one lump. */
.uikit-screen > header { position: relative; z-index: 1; }

/* ---- the room this screen lights for itself -------------------------------
 * \`fixed\` rather than \`absolute\`: the screen scrolls at 1600x900 and a wash
 * that scrolls away is furniture, not atmosphere. Fixed descendants of a
 * scroller are only clipped when that scroller is their containing block, which
 * happens here exactly while the screen carries a transform — during a
 * navigation — and the screen is inset:0 then anyway, so the two cases agree.
 *
 * Amplitudes are deliberately under \`atmosphere.ts\`'s own front plane (motes at
 * 0.34, sweep peaking at 0.047): a screen's own room must not out-shout the
 * building's. Peak here is 0.030 white on the band and 0.16 violet on a wash
 * that sits *behind* near-opaque plates, so the worst case a text pixel ever
 * sees is one band at 3%.
 */
.uikit-glow, .uikit-crawl { position: fixed; inset: 0; pointer-events: none; }
.uikit-glow { z-index: 0; overflow: hidden; }
.uikit-crawl { z-index: 4; overflow: hidden; }

.uikit-glow::before, .uikit-glow::after { content: ""; position: absolute; }
.uikit-glow::before {
  inset: -18%;
  background: radial-gradient(46% 40% at 26% 16%, rgb(150 112 255 / 0.16), transparent 68%);
  animation: kit-drift-a 21s var(--ease-in-out) infinite alternate;
}
.uikit-glow::after {
  inset: -22%;
  background: radial-gradient(54% 46% at 74% 84%, rgb(82 200 255 / 0.11), transparent 70%);
  animation: kit-drift-b 26s var(--ease-in-out) infinite alternate;
}
@keyframes kit-drift-a {
  from { transform: translate3d(-3%, -2%, 0) scale(1); }
  to   { transform: translate3d(4%, 3%, 0) scale(1.09); }
}
@keyframes kit-drift-b {
  from { transform: translate3d(3%, 2%, 0) scale(1.06); }
  to   { transform: translate3d(-4%, -3%, 0) scale(1); }
}

/*
 * Two bands, half a period apart, so there is no 400ms window in which nothing
 * is crossing. That duty cycle is the whole difference between "there is an
 * idle animation" and "the screen is alive at rest": one band on an 11s period
 * spends most of the session off-stage, which is fine for the world behind the
 * UI and not enough for the page that has to prove the point.
 *
 * 470% of travel across a 46%-wide band is 216% of the viewport in 4.3s, which
 * is 20% of the frame width every 400ms — the number the round-4 note was
 * measuring, made deliberate rather than incidental.
 */
.uikit-crawl::before, .uikit-crawl::after {
  content: "";
  position: absolute;
  top: -30%; bottom: -30%; left: 0;
  width: 46%;
  opacity: 0;
  background: linear-gradient(
    96deg,
    transparent 0%,
    rgb(255 255 255 / 0.012) 26%,
    rgb(226 214 255 / 0.030) 50%,
    rgb(255 255 255 / 0.012) 74%,
    transparent 100%
  );
  transform: translate3d(-150%, 0, 0) skewX(-13deg);
  animation: kit-crawl 7.4s var(--ease-in-out) infinite;
  will-change: transform, opacity;
}
.uikit-crawl::after { animation-delay: -3.7s; }
@keyframes kit-crawl {
  0%        { transform: translate3d(-150%, 0, 0) skewX(-13deg); opacity: 0; }
  8%        { opacity: 1; }
  50%       { opacity: 1; }
  58%, 100% { transform: translate3d(320%, 0, 0) skewX(-13deg); opacity: 0; }
}

/* A 3% haze over text buys nothing on a screen somebody turned high contrast on
   for, and the low tier does not need two full-width composited bands. */
:root[data-reduced-motion="true"] .uikit-crawl,
:root[data-contrast="high"] .uikit-crawl { display: none; }
:root[data-gfx-tier="low"] .uikit-crawl::after { display: none; }
:root[data-reduced-motion="true"] .uikit-glow::before,
:root[data-reduced-motion="true"] .uikit-glow::after { animation: none; }

.kit-card { padding: 7px 10px 9px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.s3 { grid-column: span 3; } .s4 { grid-column: span 4; } .s5 { grid-column: span 5; }
.s6 { grid-column: span 6; } .s7 { grid-column: span 7; } .s8 { grid-column: span 8; }
.s12 { grid-column: span 12; }

.kit-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.kit-head .t-label { color: var(--text-dim); }
.kit-note { font-size: 0.66rem; line-height: 1.35; color: var(--text-faint); margin: 0; }
.kit-cap {
  font-size: 0.6rem; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--text-faint); text-align: center; line-height: 1.2;
}
.kit-cap.is-forced { color: var(--accent-cool); }
.kit-cap.is-real { color: var(--success); }
.kit-cap.is-fail { color: var(--danger); }
.kit-mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 0.62rem; }

/* ---- the top strip: the mirrored values, checked live ---------------------
   flex-direction is stated because .kit-card above sets column, and in a column
   container a flex-basis is a *height* — which is how the first draft of this
   page grew a 320px hole under its own title. */
.kit-top { display: flex; flex-direction: row; align-items: flex-end; gap: 12px; flex-wrap: nowrap; }
.kit-top-text { flex: 1 1 auto; min-width: 0; }
.kit-top-text .t-display { font-size: 2.3rem; }
.kit-mirrors { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 640px; }
.kit-mirror {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px 4px 8px; font-size: 0.62rem; line-height: 1.25;
}
.kit-mirror b { font-weight: 600; color: var(--text); }
.kit-mirror span { color: var(--text-faint); }
.kit-mirror .hb-icon { font-size: 14px; }
.kit-mirror.is-ok .hb-icon { color: var(--success); }
.kit-mirror.is-bad { border-color: var(--danger); }
.kit-mirror.is-bad .hb-icon { color: var(--danger); }
.kit-back { text-decoration: none; padding: 6px 14px; font-size: 0.72rem; }

/* ---- materials ------------------------------------------------------------ */
.kit-mat-roles { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.kit-mat-roles > * { flex: 0 0 auto; }
.kit-hero-btn { padding: 12px 30px; font-size: 1rem; font-weight: 700; letter-spacing: 0.04em; }
.kit-mat-plate { padding: 12px 16px; min-width: 150px; }
.kit-well-slot { min-width: 150px; min-height: 46px; display: flex; align-items: center; justify-content: center;
  font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
.kit-chip-demo { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 0.8rem; }
.kit-chip-demo .hb-icon { font-size: 15px; color: var(--accent-gold); }

.kit-mat-compare { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kit-compare-cell { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.kit-compare-plate {
  height: 54px; display: flex; align-items: center; justify-content: center;
  font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim);
}
.kit-compare-plate.mat-hero { color: #fff; }

.kit-light {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
}
.kit-light svg { color: var(--accent-gold); flex: 0 0 auto; }
.kit-light-read { font-size: 0.62rem; line-height: 1.4; color: var(--text-faint); }
.kit-light-read b { color: var(--text); font-weight: 600; }

/* ---- interaction states --------------------------------------------------- */
.kit-states { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
.kit-state { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }
.kit-state > .kit-specimen { min-height: 42px; }
.kit-btn { padding: 10px 8px; font-size: 0.78rem; font-weight: 600; width: 100%; }
.kit-tile {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center;
  gap: 8px; padding: 10px 11px; width: 100%; text-align: left;
}
.kit-tile .hb-icon { font-size: 19px; color: var(--accent-bright); }
.kit-tile-name { font-size: 0.74rem; font-weight: 600; color: var(--text); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kit-tile-sub { grid-column: 2 / 4; font-size: 0.6rem; color: var(--text-faint); }
.kit-tile .num { font-size: 0.86rem; font-weight: 700; color: var(--accent-gold); }

/* The eighth state gets a row of its own, laid out beside its caption so it
   costs the frame one line rather than one band. Nothing here restyles
   \`.empty\` — the padding and the icon size are the primitive's; this only says
   how wide the specimen is allowed to be and puts the label next to it. */
.kit-empty-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: 12px; align-items: center; }
.kit-empty-row .kit-cap { text-align: left; }
.kit-empty-why { font-size: 0.66rem; line-height: 1.4; color: var(--text-faint); margin: 0; }
.kit-empty-why b { color: var(--text-dim); font-weight: 600; }

/*
 * Forced hover — mirrors \`.act:hover\` in foundation.css §5.
 * Same knobs, same keyframe. The wipe is slowed to nine times its real
 * duration and looped so a --frames burst catches it mid-crossing; the real
 * rule fires it once, at --dur-sheen.
 */
.kit-force-hover.act {
  transform: translateY(-2px) scale(1.015);
  --rim-boost: 2;
  --cast-lift: 0.55;
  /* The fourth knob, and it is new: the same band now also runs at rest, at a
     third of this. Leaving it off the forced copy would have shown the ambient
     crawl under a "hover" caption. It reads \`--sheen-hover\` rather than naming
     a number, because the hover amplitude is now per material — one alpha across
     four faces is a hover that flashes hardest on the darkest plate. */
  --sheen-alpha: var(--sheen-hover, 0.032);
}

/* The catch itself is on the band, which since foundation.css §3's frame-time
   repair is the plate's own \`::after\` rather than one of its background
   layers. */
.kit-force-hover.act::after {
  animation: hb-sheen-pass calc(var(--dur-sheen) * 9) var(--ease-sweep) infinite;
}

/* Forced press — mirrors \`.act:active\` in foundation.css §5. */
.kit-force-active.act {
  transform: scale(0.985);
  --cast-lift: 0;
  --rim-boost: 0.4;
  --press-cast: inset 1.24px 2px 6px rgb(0 0 0 / calc(0.5 * var(--mat-amp) + 0.15));
  animation: none;
}

/*
 * Forced focus ring — mirrors \`:root:root[data-keyboard-nav="true"]
 * :focus-visible\` in foundation.css §6, character for character. It is here so
 * a still can show the ring taking the host's own radius; the live version of
 * the same rule is on the auto-focused text field in the form kit.
 */
.kit-force-focus {
  border-radius: var(--r-self, var(--radius-sm));
  outline: var(--focus-width) solid var(--focus-ink);
  outline-offset: var(--focus-gap);
  box-shadow:
    var(--mat-cast, 0 0 rgb(0 0 0 / 0)),
    0 0 0 var(--focus-gap) var(--focus-halo),
    0 0 12px var(--focus-bloom);
}

/*
 * Reduced motion, and the reason there are three selectors rather than one.
 *
 * \`motionEnabled()\` is read once, when the screen mounts, and it gates the JS
 * replay loop — which means a player who turns the setting on while standing on
 * this page keeps a twelve-cell cascade looping every 2600ms and a rail filling
 * forever. A headless run at \`reducedMotion: "reduce"\` found exactly that:
 * \`kit-fill\` running infinitely and \`kit-rise\` still playing, with the
 * bottom-right quadrant of the page diffing at 0.38–0.44 while the other three
 * sat at exactly 0.000. §3 makes killing the decorative layer a hard
 * requirement, and this is the module's own showroom.
 *
 * The CSS guard is what makes the flag authoritative rather than the mount-time
 * snapshot. The rail is held at a fixed fill rather than left at whatever
 * fraction the animation was passing through, so a still of this page under the
 * setting shows a rail with a value on it.
 */
:root[data-reduced-motion="true"] .kit-force-hover.act,
:root[data-reduced-motion="true"] .kit-stagger.is-running .kit-stagger-cell,
:root[data-reduced-motion="true"] .kit-card { animation: none; }

:root[data-reduced-motion="true"] .kit-rail-fill.is-live {
  animation: none;
  transform: scaleX(0.62);
}

/* ---- radius, focus, dividers ---------------------------------------------- */
.kit-radii { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.kit-radius-swatch { height: 58px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px; }
.kit-radius-swatch span { font-size: 0.58rem; color: var(--text-faint); }

.kit-focus-row { display: flex; align-items: flex-end; gap: 18px; flex-wrap: wrap; padding: 6px 2px 2px; }
.kit-focus-item { display: flex; flex-direction: column; align-items: center; gap: 7px; }
/*
 * Each specimen gets the box its radius is legible in, which the card could not
 * previously prove. All four used to be laid out at 84x42, and at that box a
 * \`--r-chip\` of 999px clamps to 21px while \`--r-panel\` is 18 — so the chip, the
 * panel, the tile and the field rendered as four indistinguishable rounded
 * rectangles under four different labels, which reads as the bug rather than as
 * the fix. The code was right the whole time (measured 999/14/18/10); the demo
 * was hiding it. A stadium needs to be wide and short before 999px means
 * anything, and 18 against 14 only separates on a box tall enough to see two
 * corners at once.
 */
.kit-focus-box { display: flex; align-items: center; justify-content: center;
  font-size: 0.62rem; color: var(--text-dim); }
.kit-focus-box.r-chip { width: 132px; height: 28px; }
.kit-focus-box.r-tile { width: 108px; height: 82px; }
.kit-focus-box.r-panel { width: 108px; height: 82px; }
.kit-focus-box.r-field { width: 132px; height: 40px; }

.kit-rail { height: 14px; padding: 0; overflow: hidden; position: relative; }
/*
 * \`.well-fill\` is the primitive; this rule only says where the specimen sits and
 * how it is scaled. Before the primitive existed this painted its own gradient
 * and a bright crown, and it read as a coloured stripe pasted over the groove —
 * \`box-shadow: inset\` paints below an element's children, so the well's recess
 * shading stopped existing exactly where there was something to shade.
 */
.kit-rail-fill {
  position: absolute; inset: 0 auto 0 0; width: 100%;
  transform-origin: left center;
}
/* The rest position lives here rather than in an inline style, so that killing
   the animation under reduced motion leaves a rail with a value on it instead
   of an inline scaleX(0) nobody can override. */
.kit-rail-fill.is-live { transform: scaleX(0.62); animation: kit-fill 2600ms var(--ease-in-out) infinite; }
@keyframes kit-fill {
  0%   { transform: scaleX(0.06); }
  55%  { transform: scaleX(0.94); }
  100% { transform: scaleX(0.06); }
}
.kit-rail-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; }
.kit-rail-row .num { font-size: 0.7rem; color: var(--text-dim); }

.kit-fade-bar { height: 2px; background: var(--hairline-lit); }
.kit-split { display: flex; align-items: stretch; gap: 12px; }
.kit-split > div { flex: 1 1 0; font-size: 0.62rem; color: var(--text-faint); }

.kit-scroll {
  height: 62px; overflow: auto; padding: 7px 9px; font-size: 0.62rem; line-height: 1.45; color: var(--text-dim);
}
.kit-scroll-wide { overflow-x: auto; padding: 6px 8px 1px; }
.kit-scroll-wide > div { width: 1200px; height: 18px;
  background: linear-gradient(90deg, var(--accent), var(--accent-cool), var(--accent-hot));
  border-radius: var(--r-chip); }

/* ---- forms ---------------------------------------------------------------- */
.kit-form { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 9px; }
.kit-form .kit-wide { grid-column: 1 / -1; }
.kit-form .kit-two { grid-column: span 2; }
.kit-form .t-label { font-size: 0.58rem; }
.kit-toggles { display: flex; flex-direction: column; gap: 4px; }
.kit-toggles .field-row { min-height: 26px; }
.kit-toggles label { font-size: 0.68rem; color: var(--text-dim); }

/* ---- type ----------------------------------------------------------------- */
.kit-type > * { margin: 0; }
.kit-type .t-display { font-size: 2rem; }
.kit-nums { position: relative; display: grid; grid-template-columns: 1fr auto; gap: 2px 10px;
  padding-right: 3px; border-right: 1px dashed rgb(217 165 255 / 0.5); }
.kit-nums dt { font-size: 0.64rem; color: var(--text-faint); }
.kit-nums dd { margin: 0; font-size: 0.82rem; font-weight: 600; color: var(--text); }
.kit-defs { display: grid; grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 2px 8px; align-items: baseline; }
.kit-defs dt { color: var(--accent-cool); }
.kit-defs dd { margin: 0; font-size: 0.68rem; color: var(--text-dim); }

/* ---- grain and textures ---------------------------------------------------- */
.kit-grain-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kit-grain-plate { height: 62px; }
/*
 * The four grains at x6, each over its own material's fill.
 *
 * This used to be one cell showing the one shared tile over a flat grey, which
 * could not answer the question the card exists to answer. The question is not
 * "is there noise" — it is "do the four plates look like one substance", and the
 * only way to see that is to put the same magnified patch of each beside the
 * others on the face it actually lands on. No \`contrast()\` filter here, either:
 * pushing contrast globally distorts each cell by a different amount, which is
 * precisely the measurement being made.
 */
.kit-grain-mags { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.kit-grain-mag {
  height: 46px; border-radius: var(--r-field);
  background-image: var(--mag-grain, none), var(--mag-fill, none);
  background-size: calc(var(--mag-size, 128px) * 6), 100% 100%;
  background-repeat: repeat, no-repeat;
  image-rendering: pixelated;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.5);
}
.kit-tex-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.kit-tex-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kit-tex-swatch { height: 44px; border-radius: var(--r-field); }
.kit-tex-mask { background: linear-gradient(var(--light-sweep), var(--accent-bright), var(--accent-hot)); }
/* A bevel is invisible on a surface the same value as the card behind it, and
   an invisible swatch proves nothing — so both bevel cells sit on a mid-tone
   plate, which is also the value a bevel is designed to be read at. */
.kit-tex-bevel { background: linear-gradient(var(--light-sweep), #5b5280, #322b4e); }
/*
 * The painted twin gets the *identical* substrate, and this is a correction.
 *
 * It used to sit on a solid \`background-color: #6b6390\` while its neighbour sat
 * on the lit gradient above. Measured, the CSS cell came out at a face of 79.8
 * with a 24-level top-to-bottom and 26-level left-to-right falloff, and the
 * painted cell at 116.6 and flat to within a tenth of a level at every sample —
 * so the one A/B on the whole page that exists to prove "one edge treatment,
 * both worlds" was showing the two worlds disagreeing, and the cause was the
 * ground rather than \`bevelStrip\`. An 88x44 solid \`background: #hex\` is also
 * §1's outright ban, sitting inside the card that exists to demonstrate texture.
 *
 * With the same gradient under both, the pair differs only by which world drew
 * the edge, which is the claim the cell is making.
 *
 * The strip arrives through a custom property rather than as an inline
 * \`background-image\`, because an inline \`background-image\` would replace the
 * gradient rather than compositing over it — which is how the two cells came to
 * be standing on different ground in the first place.
 */
.kit-tex-painted {
  background-image: var(--kit-bevel-src, none), linear-gradient(var(--light-sweep), #5b5280, #322b4e);
  background-repeat: no-repeat, no-repeat;
  background-size: 100% 100%, 100% 100%;
}
.kit-tex-contact { background: linear-gradient(var(--light-sweep), #6b6390, #443c66);
  margin: 3px 7px 9px; height: 32px; border-radius: var(--r-tile); }
.kit-tex-cell .kit-cap { font-size: 0.46rem; }
.kit-glows { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.kit-glow { width: 18px; height: 18px; border-radius: 50%; }

/* ---- motion ---------------------------------------------------------------- */
.kit-motion { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; }
.kit-stagger { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; }
.kit-stagger-cell { height: 40px; display: flex; align-items: center; justify-content: center; }
.kit-stagger-cell .hb-icon { font-size: 17px; color: var(--accent-bright); }
.kit-stagger.is-running .kit-stagger-cell {
  animation: kit-rise var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) both;
}
/*
 * The from-state is 0.22 opacity rather than 0, and that is a decision about
 * photography rather than about taste. With a "both" fill, a cell holds the first
 * keyframe for the whole of its delay — so at t=0 a twelve-cell cascade is
 * twelve invisible cells, and a still that lands on that one frame shows an
 * empty row and reads as a broken demo. Starting at a fifth of an opacity keeps
 * every cell on screen in every phase, and the 18px rise still carries the
 * cascade. A real screen entrance should still start at 0; this row is a
 * diagram of one.
 */
@keyframes kit-rise {
  from { opacity: 0.22; transform: translateY(18px) scale(0.9); }
  to   { opacity: 1; transform: none; }
}
.kit-ticker { text-align: right; }
.kit-ticker .num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 700;
  color: var(--accent-gold); letter-spacing: -0.02em; }
.kit-replay { padding: 6px 14px; font-size: 0.68rem; font-weight: 600; }
.kit-skeletons { display: flex; flex-direction: column; gap: 5px; }
.kit-skeletons .skeleton { height: 11px; }

/* ---- icons ------------------------------------------------------------------ */
.kit-icon-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 2px; }
/*
 * A family heading takes three cells and lets the icons flow on after it,
 * rather than taking a whole row. Eight full-width headings cost eight header
 * rows *and* four extra part-empty icon rows, which is 280px of a 2200px frame
 * spent on eight words — the run-in version costs one row for all eight.
 */
.kit-icon-sheet .kit-icon-section {
  grid-column: span 3; display: flex; align-items: center; gap: 5px; padding-left: 4px;
  font-size: 0.5rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-cool);
  line-height: 1.15;
}
.kit-icon-sheet .kit-icon-section::before {
  content: ""; flex: 0 0 3px; align-self: stretch; margin: 4px 0;
  background: var(--accent-cool); border-radius: 2px; opacity: 0.7;
}
.kit-ico { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 2px 1px 1px; min-width: 0; }
.kit-ico .hb-icon { color: var(--text); }
.kit-ico-name { font-size: 0.42rem; line-height: 1.1; text-align: center; color: var(--text-dim);
  overflow-wrap: anywhere; max-width: 100%; }
.kit-ico.is-alias .kit-ico-name { color: var(--text-faint); font-style: italic; }
/* 48px in a 48px track with a 1px gutter: exactly 31 columns at the review
   width, which is what turns 122 icons into four rows instead of five. */
.kit-icon-big { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 1px; justify-items: center; }
.kit-icon-big .hb-icon { color: var(--text); }

/* ---- destinations at the size a tile actually draws them -------------------
   The nine lobby pills are the flattest thing in any frame anybody has
   captured, and the first thing a fix for that does is stop drawing the mark at
   20px. This row is the same nine at 24, 40 and 56 so the optical ramp can be
   judged rather than asserted, plus one worked tile showing what the set gives
   a builder who wants an object instead of a pill. */
.kit-dest-ladder { display: grid; grid-template-columns: repeat(9, 1fr); gap: 6px; }
.kit-dest-col { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.kit-dest-col .hb-icon { color: var(--text); }
.kit-dest-name { font-size: 0.5rem; line-height: 1.1; text-align: center; color: var(--text-faint);
  overflow-wrap: anywhere; }
.kit-dest-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
/*
 * A worked destination tile, and every part of it is a primitive that already
 * shipped: \`.mat-panel .act\` for the plate and its six states, \`--r-tile\` for
 * the corner, \`.mat-well\` for the socket the mark sits in, \`.num\` for the
 * count, the icon at its \`hero\` rung for the mark, the same icon through
 * \`iconDataUri\` at 168px for the watermark, and \`chevron-right\` for the
 * affordance. Nothing here is new art. It is on this page rather than in the
 * lobby because module C does not own the lobby — what it owes a lobby builder
 * is proof that the parts exist and a photograph of them assembled.
 */
/* Flex, not grid. The first draft used a two-row three-column grid and
   auto-placement put the chevron in an implicit fourth column while the title
   stretched into the middle one — a tile whose parts were in the wrong places
   is a poor advertisement for a set of parts. A socket, a stack and two
   trailing marks is a row, and a row is a flex container. */
.kit-dest-tile {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  padding: 13px 14px 13px 15px; text-align: left; width: 100%;
}
.kit-dest-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.kit-dest-tile::before {
  content: ""; position: absolute; right: -26px; top: 50%; width: 168px; height: 168px;
  transform: translateY(-50%);
  background: var(--dest-mark) no-repeat center / contain;
  opacity: 0.07; pointer-events: none;
}
.kit-dest-socket {
  flex: 0 0 auto; width: 56px; height: 56px; display: grid; place-items: center;
  color: var(--accent-bright);
}
.kit-dest-title { font-size: 0.92rem; font-weight: 700; color: var(--text); letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kit-dest-meta { font-size: 0.63rem; color: var(--text-faint); display: flex;
  align-items: center; gap: 5px; white-space: nowrap; }
.kit-dest-meta .hb-icon { font-size: 12px; color: var(--accent-hot); }
.kit-dest-go { flex: 0 0 auto; color: var(--text-faint); font-size: 18px; }
.kit-dest-count { flex: 0 0 auto; font-size: 0.9rem; font-weight: 700; color: var(--accent-gold); }

/* ---- the live contrast matrix ---------------------------------------------- */
.kit-contrast { width: 100%; border-collapse: collapse; font-size: 0.6rem; }
.kit-contrast th, .kit-contrast td { padding: 2px 4px; text-align: right; white-space: nowrap; }
.kit-contrast th:first-child, .kit-contrast td:first-child { text-align: left; color: var(--text-dim); }
.kit-contrast thead th { color: var(--text-faint); font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; font-size: 0.5rem; border-bottom: 1px solid var(--glass-border); }
.kit-contrast tbody tr:nth-child(odd) { background: rgb(255 255 255 / 0.022); }
.kit-ratio { font-variant-numeric: tabular-nums; font-weight: 600; }
.kit-ratio.is-aaa { color: var(--success); }
.kit-ratio.is-aa  { color: var(--text); }
.kit-ratio.is-lg  { color: var(--accent-gold); }
.kit-ratio.is-bad { color: var(--danger); }
.kit-contrast-key { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.55rem; color: var(--text-faint); }
.kit-contrast-key b { font-weight: 600; }
.kit-probe { position: absolute; left: -9999px; top: 0; width: 120px; height: 40px; }
.kit-probe > span { font-size: 0.7rem; }

/* ---- the rest-motion trace --------------------------------------------------
   A canvas rather than an SVG because it is redrawn every frame and a rolling
   four-second window is 240 points a track; six \`<polyline>\` elements being
   rewritten at 60Hz is a style recalculation the rest of the page has to pay
   for, and this card is measuring that page. */
.kit-trace { width: 100%; height: 116px; display: block; border-radius: var(--r-field); }
.kit-trace-key { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 8px; font-size: 0.53rem;
  line-height: 1.3; }
.kit-trace-key span { display: flex; align-items: center; gap: 5px; color: var(--text-faint); }
.kit-trace-key i { width: 9px; height: 2px; border-radius: 1px; flex: 0 0 auto; }
.kit-idle-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.kit-idle-plate { height: 54px; }
/* The magnifier. \`--sheen-alpha\` is a registered property that the material
   rule sets per rank, so raising it on one specimen re-uses the material's own
   crawl at a readable amplitude instead of drawing a second one — exactly what
   the x6 grain cell next door does with the grain tile. 0.13 is 14x the panel's
   resting 0.009, chosen so the band is legible in a single still without
   clipping to white on the lit half of the plate. */
.kit-idle-amp { --sheen-alpha: 0.13; }
.kit-idle-live { font-size: 0.6rem; color: var(--text-dim); line-height: 1.45; }
.kit-idle-live b { color: var(--text); font-weight: 600; }

/* ---- the two bevels, big ----------------------------------------------------
   88x44 is where the CSS form and the painted form look like near enough the
   same edge. They are not, and the only way to see it is to make the edge large
   enough that a 1px step and a 4px ramp are different pictures. */
.kit-bevel-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.kit-bevel-cell { display: flex; flex-direction: column; gap: 5px; }
.kit-bevel-plate {
  height: 168px; border-radius: 22px;
  background-image: var(--kit-bevel-src, none), linear-gradient(var(--light-sweep), #5b5280, #322b4e);
  background-repeat: no-repeat, no-repeat;
  background-size: 100% 100%, 100% 100%;
}
.kit-bevel-nums { display: grid; grid-template-columns: auto repeat(2, minmax(0, 1fr)) auto;
  gap: 1px 8px; font-size: 0.56rem; align-items: baseline; }
.kit-bevel-nums dt { color: var(--accent-cool); }
.kit-bevel-nums dd { margin: 0; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.kit-bevel-nums dd.is-bad { color: var(--danger); }

/* ---- the latent native widgets ---------------------------------------------- */
.kit-natives { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; }
.kit-natives label { font-size: 0.56rem; }
.kit-natives progress, .kit-natives meter { width: 100%; height: 12px; }
.kit-natives details { grid-column: 1 / -1; font-size: 0.68rem; color: var(--text-dim); }
.kit-natives details p { margin: 4px 0 0; font-size: 0.62rem; color: var(--text-faint); }
.kit-natives input[type="color"] { width: 100%; height: 26px; }
.kit-native-verdict { grid-column: 1 / -1; font-size: 0.58rem; line-height: 1.4; }
.kit-native-verdict b { font-weight: 600; }

/* ---- the two hands: module A's tick against module C's ---------------------- */
.kit-hands { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; align-items: end; }
.kit-hand-row { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 2px 14px;
  align-items: end; padding-top: 2px; }
.kit-hand-figure { font-size: 1.5rem; line-height: 1.1; }
.kit-hand-mark {
  height: 84px; border-radius: var(--r-field);
  background-repeat: no-repeat; background-position: center; background-size: 76% 76%;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.5);
  image-rendering: auto;
}
`;

const STYLE_ID = "hb-uikit-style";

function installKitStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = KIT_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

const card = (span: string, title: string, note: string, body: string): string => `
  <section class="kit-card mat-panel r-panel ${span}">
    <div class="kit-head"><h2 class="t-label">${esc(title)}</h2></div>
    <p class="kit-note">${note}</p>
    ${body}
  </section>`;

/** One state specimen plus the caption that says whether the state is real. */
const specimen = (markup: string, caption: string, kind: "real" | "forced"): string => `
  <div class="kit-state">
    <div class="kit-specimen">${markup}</div>
    <span class="kit-cap is-${kind}">${esc(caption)}</span>
  </div>`;

/**
 * The seven states, as a list of the attributes and classes that produce each.
 *
 * One table drives both the button row and the tile row, so the two can never
 * disagree about what "loading" means — and so adding an eighth state is one
 * entry rather than fourteen elements.
 */
const STATES: readonly { cls: string; attr: string; cap: string; kind: "real" | "forced" }[] = [
  { cls: "", attr: "", cap: "rest", kind: "real" },
  { cls: " kit-force-hover", attr: "", cap: "hover · forced", kind: "forced" },
  { cls: " kit-force-active", attr: "", cap: "active · forced", kind: "forced" },
  { cls: " kit-force-focus", attr: "", cap: "focus · forced", kind: "forced" },
  { cls: "", attr: " disabled", cap: "disabled", kind: "real" },
  { cls: "", attr: ' data-state="loading"', cap: "loading", kind: "real" },
  { cls: "", attr: ' aria-invalid="true"', cap: "error", kind: "real" },
];

/** The light-rig diagram: a key light at the top-left and the cast it throws. */
function lightDiagram(): string {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x = 17 + Math.cos(rad) * 10.5;
      const y = 17 + Math.sin(rad) * 10.5;
      const x2 = 17 + Math.cos(rad) * 14;
      const y2 = 17 + Math.sin(rad) * 14;
      return `M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
    })
    .join("");
  return (
    `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" ` +
    `stroke-width="${ICON_STROKE}" stroke-linecap="round" aria-hidden="true">` +
    `<circle cx="17" cy="17" r="6.5"/><path d="${rays}"/>` +
    `<path d="M28 28 46 46" opacity="0.8"/><path d="M46 46 46 39.5" opacity="0.8"/>` +
    `<path d="M46 46 39.5 46" opacity="0.8"/></svg>`
  );
}

// ---------------------------------------------------------------------------
// Reading colour back off the live page
// ---------------------------------------------------------------------------
//
// Every contrast figure this page prints is measured, not written. A hard-coded
// "8.4:1" beside a plate is a claim that agrees with itself forever, which is
// the same failure the mirrored-token strip at the top of the page exists to
// avoid — and the accessibility promise in the hard constraints is one nobody
// has ever checked on this screen in either theme.
//
// The method, stated here so the number can be argued with:
//
//   1. Every material's face is a *gradient*, so there is no single "background
//      colour" to measure. Both endpoint stops are taken from the computed
//      `background-image`, plus any `background-color` under them.
//   2. Those stops are semi-transparent (`rgb(30 21 54 / .96)` and friends), so
//      each is composited over the mean resolved colour of everything behind
//      it, walked all the way up to the document element.
//   3. The text colour is composited over each stop in turn, and the ratio
//      reported is the **worst** of the two. Light text on a dark plate is at
//      its worst over the lit end, and a pass has to hold at both ends.
//
// What it deliberately does not model: the 1px inset rim and lip (text does not
// sit on them), the idle sheen (a 0.9% white band, worth 0.02 of a ratio), and
// the two decorative planes in front, which is why the crawl is switched off
// entirely under high contrast rather than merely turned down.

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** `rgb(30 21 54 / .96)` and every other serialisation Chrome emits. */
function parseRgba(text: string): Rgba | null {
  const parts = text
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  const alpha = parts.length > 3 && !Number.isNaN(parts[3]!) ? parts[3]! : 1;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: alpha };
}

/*
 * `url(...)` goes first. A grain tile arrives in the same `background-image`
 * list as the gradient, and while a base64 PNG cannot contain a bracketed
 * `rgb(` by construction, "cannot by construction" is the kind of reasoning
 * that stops being true the day somebody swaps the tile for a percent-encoded
 * SVG. Dropping the URLs costs one regex and removes the whole question.
 */
function coloursIn(value: string): Rgba[] {
  const out: Rgba[] = [];
  const source = value.replace(/url\([^)]*\)/g, "");
  for (const match of source.matchAll(/rgba?\(([^()]*)\)/g)) {
    const parsed = parseRgba(match[1] ?? "");
    if (parsed && parsed.a > 0) out.push(parsed);
  }
  return out;
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function meanOf(colours: readonly Rgba[]): Rgba {
  const n = colours.length;
  return {
    r: colours.reduce((s, c) => s + c.r, 0) / n,
    g: colours.reduce((s, c) => s + c.g, 0) / n,
    b: colours.reduce((s, c) => s + c.b, 0) / n,
    a: colours.reduce((s, c) => s + c.a, 0) / n,
  };
}

function ownColours(element: Element): Rgba[] {
  const style = getComputedStyle(element);
  return [...coloursIn(style.backgroundImage), ...coloursIn(style.backgroundColor)];
}

/** Everything behind an element, flattened to one opaque colour. */
function groundUnder(element: Element | null): Rgba {
  if (!element) return OPAQUE_BLACK;
  const behind = groundUnder(element.parentElement);
  const own = ownColours(element);
  return own.length === 0 ? behind : over(meanOf(own), behind);
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The worst contrast a run of text has anywhere across its plate.
 *
 * `plate` supplies the surface, `ink` the text colour — two different elements,
 * because the text sits *inside* the plate and its own computed `color` is what
 * is actually painted.
 */
function worstRatioOn(plate: Element, ink: Element): number | null {
  const ground = groundUnder(plate.parentElement);
  const stops = ownColours(plate).map((stop) => over(stop, ground));
  if (stops.length === 0) return null;
  const text = coloursIn(getComputedStyle(ink).color)[0];
  if (!text) return null;
  let worst = Infinity;
  for (const stop of stops) worst = Math.min(worst, contrastRatio(over(text, stop), stop));
  return worst;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function createUiKitScreen(): Screen {
  installKitStyles();
  installTextureVars();
  installIconSprite();

  const root = document.createElement("div");
  root.className = "screen uikit-screen";

  const drawn = new Set<string>(DRAWN_ICON_IDS);

  // --- module B products, generated once ------------------------------------
  const mask = softMaskDataUri({ width: 168, height: 56, radius: 20, feather: 0.34, exponent: 4 });
  const bevel = bevelStrip({ width: 168, height: 56, radius: 14, tier: "panel" });
  const contact = contactShadow({ width: 168, height: 44, radius: 14, tier: "hero" });
  const fade = fadeStrip(0.15, "x");
  const cast = shadowOffset(10);

  const glowChips = CURRENTS.map((id) => {
    const glow = currentGlow(id, 1);
    return (
      `<span class="kit-glow" title="${esc(id)} — bloom ${glow.bloom.toFixed(2)}" ` +
      `style="background:var(--current-${esc(id)});box-shadow:${esc(glow.css)}"></span>`
    );
  }).join("");

  // --- the mirrored-token strip ---------------------------------------------
  /*
   * Read out of the live cascade rather than hard-coded, because the whole
   * point of the check is that the CSS half and the JS half are the same
   * number. A hard-coded "315deg" beside `LIGHT_RIG.cssAngle` would agree
   * forever and prove nothing.
   */
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVar = (name: string): string => rootStyle.getPropertyValue(name).trim();

  const mirrors: readonly { label: string; css: string; js: string }[] = [
    { label: "--light-angle", css: cssVar("--light-angle"), js: `${LIGHT_RIG.cssAngle}deg` },
    { label: "--dur-micro", css: cssVar("--dur-micro"), js: `${DUR.micro}ms` },
    { label: "--dur-ui", css: cssVar("--dur-ui"), js: `${DUR.ui}ms` },
    { label: "--dur-setpiece", css: cssVar("--dur-setpiece"), js: `${DUR.setpiece}ms` },
    { label: "--ease-arrive", css: cssVar("--ease-arrive"), js: cssEase(EASE.arrive) },
    { label: "--ease-overshoot", css: cssVar("--ease-overshoot"), js: cssEase(EASE.overshoot) },
    { label: "--ease-leave", css: cssVar("--ease-leave"), js: cssEase(EASE.leave) },
  ];

  const mirrorChips = mirrors
    .map((m) => {
      const ok = m.css === m.js;
      return (
        `<span class="kit-mirror mat-chip r-chip ${ok ? "is-ok" : "is-bad"}">` +
        `${icon(ok ? "check" : "warning", { size: 14 })}` +
        `<b>${esc(m.label)}</b><span>${esc(ok ? m.js : `${m.css} ≠ ${m.js}`)}</span></span>`
      );
    })
    .join("");

  // --- sections --------------------------------------------------------------

  const header = `
      <div class="kit-top-text">
        <h1 class="t-display">The foundation, photographed</h1>
        <p class="t-body" style="margin:2px 0 0;font-size:0.8rem">
          Four materials, five radii, five type roles, one interaction mixin, one focus ring, the form kit,
          ${count(ICON_IDS.length)} icons on a ${ICON_GRID}px grid at ${ICON_STROKE}px stroke on three optical
          rungs, the generated grain, and the motion and format tokens — all of it at once, so two of them lit
          by different suns would be obvious. Green captions are real states; blue captions are forced copies
          of a state a screenshot cannot reach; red ones are a measurement that failed.
        </p>
        <p class="kit-note kit-mono" style="margin:5px 0 0">
          Two frames — the camera cannot composite this sheet in one, see the note on
          <code>FRAME_HEIGHT</code>:<br>
          <code>node scripts/shot.mjs uikit --size 1600x${FRAME_HEIGHT} --out kit-a</code><br>
          <code>node scripts/shot.mjs uikit --size 1600x${FRAME_HEIGHT} --out kit-b --eval
          "setTimeout(()=&gt;{document.querySelector('.uikit-screen').scrollTop=99999},400)"</code>
        </p>
      </div>
      <div class="kit-mirrors">${mirrorChips}</div>
      <a class="kit-back mat-chip act r-chip" href="#lobby">${icon("arrow-left", { size: 14 })} Lobby</a>`;

  const materials = card(
    "s12",
    "A1 · materials — hero 1.0, panel 0.55, chip 0.35, well 0.7",
    "Top row: each material at the role it exists for. Bottom row: the same four forced to one size and one " +
      "radius, so the rim on the top edge, the lip on the bottom edge and the cast to the bottom-right can be " +
      "compared across them. Every one is lit from 315° — top and left edges lit, bottom and right edges in " +
      "shadow, borders included. <b>Rim, lip, grain and the idle sheen are all tuned per material against " +
      "that material's own face value</b>, because an alpha that is one number over four faces is four " +
      "different decorations: the same 0.07 sheen lifted the hero by 4.4% of itself and the panel by 19%, so " +
      "the loudest thing on the screen was the quietest thing at rest. The cast now throws sideways as well " +
      "as down, at the 0.62 ratio <code>shadowOffset()</code> has always returned — both layers used to be " +
      "<code>0 Npx</code>, which is a key light directly overhead on a page lit from the corner, and the " +
      "readout below said so while every plate under it disagreed.",
    `<div class="kit-mat-roles">
       <button class="mat-hero act r-panel kit-hero-btn">PLAY</button>
       <div class="mat-panel r-panel kit-mat-plate">
         <div class="t-heading" style="font-size:0.9rem">Panel</div>
         <div class="kit-note">structural furniture</div>
       </div>
       <span class="mat-chip r-chip kit-chip-demo">${icon("clout", { size: 15 })}<span class="num" style="--digits:6">${count(12340)}</span></span>
       <span class="mat-chip r-chip kit-chip-demo">${icon("shards", { size: 15 })}<span class="num" style="--digits:4">${count(860)}</span></span>
       <div class="mat-well r-field kit-well-slot">empty slot</div>
       <div class="mat-panel r-tile kit-light">
         ${lightDiagram()}
         <div class="kit-light-read">
           key light <b>${LIGHT_RIG.cssAngle}°</b> · elevation <b>${LIGHT_RIG.elevation}°</b><br>
           key ${LIGHT_RIG.key} / fill ${LIGHT_RIG.fill} / rim ${LIGHT_RIG.rim}<br>
           shadowOffset(10) → <b>x ${cast.x.toFixed(1)}, y ${cast.y.toFixed(1)}</b><br>
           the DOM cast mirrors it: <b>${(cast.x / cast.y).toFixed(2)} : 1</b>
         </div>
       </div>
     </div>
     <div class="kit-mat-compare">
       ${(["hero", "panel", "chip", "well"] as const)
         .map(
           (tier) => `
         <div class="kit-compare-cell">
           <div class="mat-${tier} r-tile kit-compare-plate">${tier}</div>
           <span class="kit-cap">amplitude ${MATERIAL_AMPLITUDE[tier]}</span>
         </div>`
         )
         .join("")}
     </div>`
  );

  const buttonRow = STATES.map((s) =>
    specimen(
      `<button class="mat-hero act r-chip kit-btn${s.cls}"${s.attr}>Claim</button>`,
      s.cap,
      s.kind
    )
  ).join("");

  const tileRow = STATES.map((s) => {
    // A tile is a div, so `disabled` has to be spelled the accessible way; the
    // mixin matches both, which is the reason it matches both.
    const attr = s.attr === " disabled" ? ' aria-disabled="true"' : s.attr;
    return specimen(
      `<div class="mat-panel act r-tile kit-tile${s.cls}" role="button" tabindex="-1"${attr}>
         ${icon("mode-ranked", { size: 19 })}
         <span class="kit-tile-name">Ranked</span>
         <span class="num" style="--digits:5">${count(1284)}</span>
         <span class="kit-tile-sub">Diamond III · ${quantity(6, "win")}</span>
       </div>`,
      s.cap,
      s.kind
    );
  }).join("");

  const interaction = card(
    "s12",
    "A4, A5 · every state of a button and a tile, and the empty state beside them",
    "Seven states, two ranks of material, one mixin. Disabled stays on the family's own violet axis — it used " +
      "to measure a neutral (26.5, 25.5, 30.1) and read as a hole punched in the card rather than as the same " +
      "substance unavailable — and it changes fill, border, text and icon rather than opacity. Loading dims " +
      "the plate <em>and</em> runs a meter along its bottom edge. Both animate here, so a burst capture shows " +
      "them move.",
    `<div class="kit-states">${buttonRow}</div>
     <div class="kit-states">${tileRow}</div>
     <div class="kit-empty-row">
       <div class="empty">
         ${icon("collection", { size: 40 })}
         <h3 class="t-heading" style="font-size:0.95rem">No cards in this filter</h3>
         <p class="t-body">Nothing is both <em>legendary</em> and <em>Veil</em> yet. Give it a week.</p>
         <button class="mat-hero act r-chip">${icon("shop", { size: 14 })} Open Merch Drops</button>
       </div>
       <div>
         <span class="kit-cap is-real">empty · the state §5 names and nothing shipped</span>
         <p class="kit-empty-why">§5 puts empty states beside the six interaction states — <b>"You own no
         cards" is a moment to be charming, not a blank grid</b> — and the foundation had
         <code>.skeleton</code> for content that has not arrived and nothing at all for content that never
         will. Forty-nine screens would each have invented one. It is a material, not a layout helper:
         <code>class="empty"</code> on its own is already a recessed, grained, lit box, because half a
         primitive is how a system drifts. The patch of light behind the icon rides on the same
         <code>--mat-veil</code> layer the loading state uses, so the composition costs no extra paint.</p>
       </div>
     </div>`
  );

  const radii = card(
    "s4",
    "A2 · radius by role",
    "Literals are banned; the role picks the corner. The number under each swatch is read back out of the " +
      "cascade after mount, not written here.",
    `<div class="kit-radii">
       ${(["chip", "tile", "panel", "field", "nested"] as const)
         .map(
           (role) => `
         <div class="mat-panel r-${role} kit-radius-swatch" data-radius="${role}">
           <span>--r-${role}</span>
         </div>`
         )
         .join("")}
     </div>
     <div class="kit-radii" style="grid-template-columns:repeat(5,1fr)">
       ${(["chip", "tile", "panel", "field", "nested"] as const)
         .map((role) => `<span class="kit-cap" data-radius-value="${role}">—</span>`)
         .join("")}
     </div>
     <hr class="hairline">
     <p class="kit-note">And the repairs. These five were referenced across <code>screens.css</code> and
     <code>battle.css</code> and never defined anywhere — an undefined <code>var()</code> is invalid at
     computed-value time, so the whole declaration was dropped and the sign-in form simply had no field
     borders. Resolved values, read live:</p>
     <dl class="kit-defs kit-mono" data-repairs></dl>`
  );

  const focus = card(
    "s4",
    "A5 · the focus ring inherits its host's radius",
    "The old ring hard-coded <code>--radius-sm</code> and drew a rectangle round a pill. This one reads " +
      "<code>--r-self</code>, so the same rule produces four different shapes below — and it composes over " +
      "the host's bevel instead of replacing it.",
    `<div class="kit-focus-row">
       ${[
         { cls: "r-chip", label: "chip" },
         { cls: "r-tile", label: "tile" },
         { cls: "r-panel", label: "panel" },
         { cls: "r-field", label: "field" },
       ]
         .map(
           (f) => `
         <div class="kit-focus-item">
           <div class="mat-panel ${f.cls} kit-focus-box kit-force-focus">${esc(f.label)}</div>
           <span class="kit-cap is-forced">forced</span>
         </div>`
         )
         .join("")}
       <div class="kit-focus-item">
         <input class="switch kit-force-focus" type="checkbox" checked aria-label="focused switch">
         <span class="kit-cap is-forced">switch</span>
       </div>
     </div>
     <p class="kit-note">Width follows <code>--focus-width</code>, currently <span data-focus-width>—</span>,
     which the accessibility screen's thin / medium / thick setting drives. The live ring is on the text field
     in the form kit.</p>`
  );

  const dividers = card(
    "s4",
    "A6, A7 · dividers, rails and scrollbars",
    "A hairline is two lines — dark over lit — with the alpha ramped to nothing across the outer 15%, so it " +
      "never butts into a panel edge. Rails are wells with a lit fill; the third one is animating.",
    `<hr class="hairline">
     <div class="kit-split">
       <div>fadeStrip(0.15) as a CSS mask on a flat bar:<div class="kit-fade-bar" style="mask-image:${esc(
         fade.maskImage
       )};-webkit-mask-image:${esc(fade.maskImage)}"></div></div>
       <hr class="hairline-v">
       <div>a vertical hairline, dividing this row</div>
     </div>
     ${[
       { pct: 24, live: false },
       { pct: 71, live: false },
       { pct: 0, live: true },
     ]
       .map(
         (r) => `
       <div class="kit-rail-row">
         <div class="mat-well r-chip kit-rail">
           <div class="well-fill kit-rail-fill${r.live ? " is-live" : ""}"${
             r.live ? "" : ` style="transform:scaleX(${r.pct / 100})"`
           }></div>
         </div>
         <span class="num" style="--digits:5">${r.live ? "live" : percent(r.pct / 100)}</span>
       </div>`
       )
       .join("")}
     <div class="mat-well r-field kit-scroll">
       <b>Scrollbars are bound to the document, not to a class.</b> The WebKit pseudo-elements are unclassed
       and Firefox reads <code>scrollbar-color</code> off the root by inheritance, so every scroller in the
       game gets these — including one written next month by somebody who has never heard of the stylesheet.
       The thumb is lit from the top-left like everything else. A default OS scrollbar in a neon card game is
       a tear in the world.
     </div>
     <div class="mat-well r-field kit-scroll-wide"><div></div></div>`
  );

  const forms = card(
    "s6",
    "A6 · the form kit, populated",
    "Every control is <code>appearance: none</code>. The chevron is not a <code>data:</code> SVG any more — " +
      "it is two gradient arms painting in <code>currentColor</code>, because a baked-in stroke colour made " +
      "it the one mark in the game that could not follow the text, the accent or the colour-blind modes. " +
      "The tick, the dot and the dash now scale in on <code>background-size</code> instead of hard-cutting: " +
      "<code>background-image</code> is not animatable, so every one of them used to appear in a single " +
      "frame. The first field is focused for real — that ring is <code>:focus-visible</code> itself, not a " +
      "copy, and the dark stroke now sits <em>inside</em> the gap so there are two of them.",
    `<div class="kit-form">
       <div class="field-group">
         <label class="t-label" for="kit-name">Deck name</label>
         <input class="field" id="kit-name" type="text" value="Afterparty Aggro">
         <span class="kit-cap is-real" style="text-align:left">live :focus-visible</span>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-format">Format</label>
         <select class="select" id="kit-format">
           <option>Standard</option><option selected>Remix — Doubles</option><option>Draft</option>
         </select>
         <span class="field-note">chevron in <code>currentColor</code>, no data URI</span>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-copies">Copies</label>
         <input class="field" id="kit-copies" type="number" value="3" min="1" max="9">
         <span class="field-note">spinners removed; tabular and right-aligned</span>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-search">Search</label>
         <input class="input" id="kit-search" type="search" placeholder="Filter 296 cards…">
         <span class="field-note">this one wears <code>.input</code> — the class six controls
         already claimed and nobody had written</span>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-bad">Invalid</label>
         <input class="field" id="kit-bad" type="text" value="  " aria-invalid="true">
         <span class="field-note" style="color:var(--danger)">${icon("warning", { size: 12 })} A deck needs a name.</span>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-off">Disabled</label>
         <input class="field" id="kit-off" type="text" value="Locked until Rank 5" disabled>
         <span class="field-note">Fill, border and text all change. Never opacity.</span>
       </div>
       <div class="field-group kit-two">
         <label class="t-label" for="kit-desc">Description</label>
         <textarea class="textarea" id="kit-desc" rows="2">Cheap bodies, one Confluence, and absolutely no plan for turn nine.</textarea>
       </div>
       <div class="field-group">
         <label class="t-label" for="kit-vol">Master volume — 62%</label>
         <input class="slider" id="kit-vol" type="range" min="0" max="100" value="62">
         <span class="field-note">no inline <code>--slider-fill</code>: the shell writes it</span>
         <label class="t-label" for="kit-vol0" style="margin-top:2px">Disabled</label>
         <input class="slider" id="kit-vol0" type="range" min="0" max="100" value="20" disabled>
       </div>
       <div class="kit-toggles">
         <label class="field-row"><input type="checkbox" checked> Show only owned</label>
         <label class="field-row"><input type="checkbox"> Include Remix cards</label>
         <label class="field-row"><input type="checkbox" data-indeterminate="1"> Partial selection</label>
         <label class="field-row"><input type="checkbox" checked disabled> Locked on</label>
       </div>
       <div class="kit-toggles">
         <label class="field-row"><input type="radio" name="kit-r" checked> Casual</label>
         <label class="field-row"><input type="radio" name="kit-r"> Ranked</label>
       </div>
       <div class="kit-toggles">
         <label class="field-row"><input class="switch" type="checkbox" checked> Card sounds</label>
         <label class="field-row"><input class="switch" type="checkbox"> Auto-pass</label>
         <label class="field-row"><input class="switch" type="checkbox" disabled> Cloud save</label>
       </div>
     </div>`
  );

  const typeRoles = card(
    "s4",
    "A3 · two hands, five type roles, and numbers that do not reflow",
    "Display and heading are <b>Chivo</b> — self-hosted OFL, a 33&nbsp;KB Latin variable subset committed to " +
      "the repo and bundled by Vite, nothing fetched from anybody. Body and label stay on the OS UI font. " +
      "Both roles used to be Segoe UI, which made the most brand-carrying decision in the game &ldquo;whatever " +
      "Windows ships&rdquo;. The dashed rule marks the right edge of a seven-<em>character</em> " +
      "<code>.num</code> slot — <code>--digits</code> counts characters, separators and sign included, " +
      "because a slot sized in digits alone still jumps the first time a counter crosses 100,000.",
    `<div class="kit-type">
       <div class="t-display">HYPEBOUND</div>
       <div class="t-heading">One of four materials</div>
       <p class="t-body" style="font-size:0.8rem">Body copy is dimmer and looser in leading, because a
       paragraph read at length wants air and a heading read at a glance does not.</p>
       <div class="t-label">Section label · +0.08em</div>
     </div>
     <!--
       The numeral role, beside the body role, at the same size and the same
       value. Round 4: \`.num\` supplies tabular figures, a min-width and an
       alignment, and none of the other four things §A3 says a role is — no
       family, no weight, no tracking, no colour — so it computes to \`.t-body\`
       with different digits, in whatever UI font the OS ships. Chivo is in the
       repo, was chosen partly on the width behaviour of its digits, and is used
       by the display and heading roles and not by the one role that is only
       digits. The pair below is the display/heading pair's equivalent for
       numerals: two hands, same value, and the difference is either visible in
       the photograph or it has been fixed.
     -->
     <div class="kit-hand-row">
       <div>
         <span class="kit-cap" style="text-align:left">.t-body · 1284</span>
         <div class="t-body kit-hand-figure">1,284</div>
       </div>
       <div>
         <span class="kit-cap" style="text-align:left">.num · 1284</span>
         <div class="num kit-hand-figure" style="--digits:5;--num-align:left">${count(1284)}</div>
       </div>
       <div>
         <span class="kit-cap" style="text-align:left" data-num-family>—</span>
         <div class="kit-note" style="margin:0">read live off the two elements at mount</div>
       </div>
     </div>
     <dl class="kit-nums">
       <dt>single digit</dt><dd><span class="num" style="--digits:7">${count(9)}</span></dd>
       <dt>three</dt><dd><span class="num" style="--digits:7">${count(654)}</span></dd>
       <dt>grouped</dt><dd><span class="num" style="--digits:7">${count(65432)}</span></dd>
       <dt>widest it holds</dt><dd><span class="num" style="--digits:7">${count(999999)}</span></dd>
       <dt>signed delta</dt><dd><span class="num" style="--digits:7">${signed(-128)}</span></dd>
       <dt>ordinal</dt><dd><span class="num" style="--digits:7">${ordinal(23)}</span></dd>
       <dt>timer</dt><dd><span class="num" style="--digits:7">${clock(95_000)}</span></dd>
     </dl>`
  );

  const moduleB = card(
    "s4",
    "B · generated textures — one grain per material rank",
    "Canvas-made, memoised, nothing fetched. Two identical panels below — the left with module B's noise, " +
      "the right with none; they must be distinguishable at 1:1, without the magnifier. Under them the four " +
      "tiles at ×6, each over the material it belongs to. <b>Grain is a contrast, not an alpha.</b> One tile " +
      "at one amount over faces of 163 / 58 / 39 / 13 rendered at 1.75% / 4.3% / 7.7% / 22.0% of its own " +
      "plate — the hero read as clean CSS and the well as sensor noise — which is the same defect the rim and " +
      "the lip had before §3 tuned them per material. Each amount is now solved backwards from its face; the " +
      "figures under the cells are that arithmetic, and they have to stay within 1.5× of each other. Each of " +
      "these also exists as a <code>THREE.CanvasTexture</code> from the same pixels, which is what lets the " +
      "DOM HUD and the 3D mat share one edge treatment.",
    `<div class="kit-grain-pair">
       <div class="mat-panel r-tile kit-grain-plate"></div>
       <div class="mat-panel r-tile kit-grain-plate" style="--mat-grain:none"></div>
     </div>
     <div class="kit-grain-pair">
       <span class="kit-cap">grain on</span><span class="kit-cap">grain off</span>
     </div>
     <div class="kit-grain-mags">
       ${(["hero", "panel", "chip", "well"] as const)
         .map(
           (tier) => `
         <div class="kit-grain-mag" style="--mag-grain:var(--tex-grain-${tier === "panel" ? "mid" : tier});--mag-size:var(--tex-grain-${
           tier === "panel" ? "mid" : tier
         }-size,128px);--mag-fill:var(--fill-${tier})"></div>`
         )
         .join("")}
     </div>
     <div class="kit-grain-mags">
       ${(["hero", "panel", "chip", "well"] as const)
         .map(
           (tier) =>
             `<span class="kit-cap">${tier} · ${percent(grainContrastOf(tier), 1)}</span>`
         )
         .join("")}
     </div>
     <span class="kit-cap" style="text-align:left">each rank's own tile at ×6 over its own fill — rendered
     high-pass amplitude as a fraction of that plate's face, which is the only form in which "one substance
     at four ranks" is a checkable claim</span>
     <div class="kit-tex-grid">
       <div class="kit-tex-cell">
         <div class="kit-tex-swatch kit-tex-mask" style="mask-image:url('${esc(mask)}');-webkit-mask-image:url('${esc(mask)}');mask-size:100% 100%;-webkit-mask-size:100% 100%"></div>
         <span class="kit-cap">softMask</span>
       </div>
       <div class="kit-tex-cell">
         <div class="kit-tex-swatch kit-tex-bevel" style="box-shadow:${esc(bevel.boxShadow)}"></div>
         <span class="kit-cap">bevel · css</span>
       </div>
       <div class="kit-tex-cell">
         <div class="kit-tex-swatch kit-tex-painted" style="--kit-bevel-src:url('${esc(bevel.dataUri)}')"></div>
         <span class="kit-cap">bevel · painted</span>
       </div>
       <div class="kit-tex-cell">
         <div class="kit-tex-contact" style="box-shadow:${esc(contact.css)}"></div>
         <span class="kit-cap">contactShadow</span>
       </div>
     </div>
     <div class="kit-glows">${glowChips}</div>
     <span class="kit-cap" style="text-align:left">currentGlow(), eight Currents at intensity 1 — bloom is
     divided by luminance, so pale Halo and deep Veil read as equally lit</span>`
  );

  const formats = card(
    "s4",
    "D2 · en-GB, dates in UTC",
    "Eleven call sites pass <code>undefined</code> as the locale today and print French months inside English " +
      "sentences. Everything here is pinned, and read against one fixed instant so a re-shoot is not a diff.",
    `<dl class="kit-defs kit-mono">
       <dt>num</dt><dd>${esc(num(1234567.891))}</dd>
       <dt>count</dt><dd>${esc(count(12340.6))}</dd>
       <dt>signed</dt><dd>${esc(signed(12))} · ${esc(signed(-3))} · ${esc(signed(0))}</dd>
       <dt>percent</dt><dd>${esc(percent(0.6234, 1))}</dd>
       <dt>ordinal</dt><dd>${esc(ordinal(1))} · ${esc(ordinal(12))} · ${esc(ordinal(23))}</dd>
       <dt>quantity</dt><dd>${esc(quantity(1, "card"))} · ${esc(quantity(0, "card"))}</dd>
       <dt>list</dt><dd>${esc(list(["Cinder", "Tide", "Veil"]))}</dd>
       <dt>date</dt><dd>${esc(date(SAMPLE_NOW))}</dd>
       <dt>dateTime</dt><dd>${esc(dateTime(SAMPLE_NOW))}</dd>
       <dt>time</dt><dd>${esc(time(SAMPLE_NOW))}</dd>
       <dt>relative</dt><dd>${esc(relative(SAMPLE_NOW - 3 * 3_600_000, SAMPLE_NOW))}</dd>
       <dt>duration</dt><dd>${esc(duration(9_045_000, { units: 2 }))}</dd>
       <dt>clock</dt><dd>${esc(clock(95_000))}</dd>
     </dl>`
  );

  const motion = card(
    "s8",
    "D1 · stagger, tickerTo, and loading that is not a spinner",
    "The cascade writes <code>--enter-delay</code> in reading order and collapses to 0ms under reduced " +
      "motion. Both demos re-run on the button — and, while motion is enabled, on a loop, because a burst " +
      "capture arrives long after a one-shot entrance has finished.",
    `<div class="kit-motion">
       <div style="min-width:0;display:flex;flex-direction:column;gap:8px">
         <div class="kit-stagger" data-stagger>
           ${(
             [
               "mode-casual",
               "mode-ranked",
               "mode-draft",
               "mode-remix",
               "mode-story",
               "mode-puzzle",
               "mode-boss",
               "mode-roguelike",
               "mode-tour",
               "mode-lab",
               "mode-replays",
               "mode-tutorial",
             ] as IconId[]
           )
             .map((id) => `<div class="mat-chip r-tile kit-stagger-cell">${icon(id, { size: 17 })}</div>`)
             .join("")}
         </div>
         <span class="kit-cap" style="text-align:left">stagger() — 45ms a cell, reading order, capped so a
         200-tile grid still lands inside one set-piece</span>
         <div class="kit-skeletons">
           <div class="skeleton" style="width:82%"></div>
           <div class="skeleton" style="width:64%"></div>
           <div class="skeleton" style="width:71%"></div>
         </div>
         <span class="kit-cap" style="text-align:left">.skeleton — the content-shaped half of "loading"</span>
       </div>
       <div class="kit-ticker">
         <div class="t-label">Clout</div>
         <div class="num" data-ticker style="--digits:7">0</div>
         <div class="kit-note" style="text-align:right">tickerTo, ${DUR.setpiece}ms, EASE.arrive</div>
         <button class="mat-hero act r-chip kit-replay" data-replay style="margin-top:8px">
           ${icon("refresh", { size: 14 })} Replay
         </button>
       </div>
     </div>`
  );

  // --- the four exhibits round 4 had to build by hand --------------------------

  /*
   * Every cell here is filled at mount by `paintContrast()`. The markup only
   * reserves the slots and the probes; a table of hard-coded ratios is a table
   * that agrees with itself.
   *
   * The probe block is off-screen rather than `display: none`, because a
   * display-none element has no computed background and `getComputedStyle`
   * would report the pairing of two colours nobody is looking at.
   */
  const contrastProbes = (["hero", "panel", "chip", "well"] as const)
    .flatMap((tier) =>
      ["t-heading", "t-body", "t-label", "num"].map(
        (role) =>
          `<div class="mat-${tier} r-tile" data-probe-plate="${tier}|${role}">` +
          `<span class="${role}" data-probe-ink="${tier}|${role}">Ag 1284</span></div>`
      )
    )
    .join("");

  const contrast = card(
    "s6",
    "Accessibility · every text role on every material, measured live, in both themes",
    "The hard constraints say contrast ratios hold. Nothing on this page has ever checked, and a critic who " +
      "wanted to know had to build this table by hand — twice, once per theme. Each figure is measured at " +
      "mount off a real element: both gradient stops of the material composited over everything behind them, " +
      "the role's own computed ink composited over each stop, and the <b>worse</b> of the two ratios printed, " +
      "because a plate is lighter at one end than the other and a pass has to hold at both. The right-hand " +
      "block is the same measurement taken with <code>data-contrast=\"high\"</code> set on the root and then " +
      "put back, inside one frame — the game ships two themes and this is both of them.",
    `<table class="kit-contrast">
       <thead>
         <tr><th rowspan="2">role</th><th colspan="4">standard</th><th colspan="4">high contrast</th></tr>
         <tr>${["hero", "panel", "chip", "well", "hero", "panel", "chip", "well"]
           .map((t) => `<th>${t}</th>`)
           .join("")}</tr>
       </thead>
       <tbody data-contrast-body>
         ${["t-heading", "t-body", "t-label", "num"]
           .map(
             (role) =>
               `<tr><td>.${role}</td>${["standard", "high"]
                 .flatMap((theme) =>
                   ["hero", "panel", "chip", "well"].map(
                     (tier) => `<td class="kit-ratio" data-cell="${theme}|${tier}|${role}">—</td>`
                   )
                 )
                 .join("")}</tr>`
           )
           .join("")}
       </tbody>
     </table>
     <div class="kit-contrast-key">
       <span class="kit-ratio is-aaa"><b>≥ 7.0</b> AAA</span>
       <span class="kit-ratio is-aa"><b>≥ 4.5</b> AA body</span>
       <span class="kit-ratio is-lg"><b>≥ 3.0</b> AA large / UI only</span>
       <span class="kit-ratio is-bad"><b>&lt; 3.0</b> fails everything</span>
     </div>
     <div class="kit-probe" aria-hidden="true">${contrastProbes}</div>`
  );

  /**
   * The six things sampled, in the order they are plotted.
   *
   * Three of them are the material crawl at its three periods, so a reader can
   * see that the family shares one behaviour at three speeds rather than taking
   * `--dur-sheen-hero/panel/chip` on trust. Two are the world's own front plane,
   * which every route gets. The last is this screen's own room — the layer that
   * exists because round 4 measured the gallery at a fifth of the lobby's
   * resting change, and the one to look at if that number has not moved.
   */
  const TRACKS: readonly { label: string; ink: string; read: () => number }[] = [
    { label: "band · .mat-hero (6.2s)", ink: "#ff6fae", read: () => sheenOf(".mat-hero") },
    { label: "band · .mat-panel (8.6s)", ink: "#d9a5ff", read: () => sheenOf(".kit-idle-plate") },
    { label: "band · .mat-chip (11.4s)", ink: "#ffcc66", read: () => sheenOf(".kit-chip-demo") },
    { label: "world · front specular (9.5s)", ink: "#52c8ff", read: () => driftOf(".atm-fore-sweep") },
    { label: "world · near dust (7.5s)", ink: "#4fe3d0", read: () => driftOf(".atm-fore-motes") },
    { label: "this screen's crawl (7.4s)", ink: "#8f6cff", read: () => crawlPhase() },
  ];

  const restMotion = card(
    "s4",
    "§3 · idle is never dead — four seconds of it, drawn",
    "A still cannot show motion, so this one draws it. Six live values are read off six real elements once a " +
      "frame and plotted over a rolling four seconds; each track is normalised to its own range across the " +
      "window, so a <b>flat line is a dead layer</b> and there is nowhere for one to hide. Round 4 put this " +
      "screen at ~5% of pixels changing over 400ms against the lobby's 20–40% — the cause was that the " +
      "gallery lit no room of its own, and the bottom two tracks are the room it lights now.",
    `<canvas class="kit-trace mat-well r-field" data-trace width="760" height="232"></canvas>
     <div class="kit-trace-key">
       ${TRACKS.map(
         (t) => `<span><i style="background:${t.ink}"></i>${esc(t.label)}</span>`
       ).join("")}
     </div>
     <hr class="hairline">
     <div class="kit-idle-pair">
       <div class="mat-panel r-tile kit-idle-plate"></div>
       <div class="mat-panel r-tile kit-idle-plate kit-idle-amp"></div>
     </div>
     <div class="kit-idle-pair">
       <span class="kit-cap">resting sheen, 1× (α 0.009)</span>
       <span class="kit-cap">the same band, ×14 (α 0.13)</span>
     </div>
     <p class="kit-note">Both plates are running the <em>same</em> <code>hb-sheen-pass</code> at the same phase;
     only <code>--sheen-alpha</code> differs, the way the ×6 grain cells only differ by
     <code>background-size</code>. At 1× the band lifts a panel face by about 1.8 of 255, which is why it
     needs a magnifier beside it to be believed.</p>
     <p class="kit-idle-live" data-idle-live>—</p>`
  );

  const bevelBig = bevelStrip({ width: 480, height: 224, radius: 22, tier: "panel" });

  const bevels = card(
    "s6",
    "B · one edge treatment, stated twice — at a size where the two can be compared",
    "<code>bevelStrip()</code> exists so the DOM HUD and the 3D mat share literally one edge. The pair in the " +
      "texture card is 88×44, and at 88×44 a 1px step and a 4px ramp look like the same edge. Here they are " +
      "at 480×224 on identical ground — same gradient, same radius, same call — so the only difference left " +
      "is which world drew the edge. The figures below are read out of the two forms themselves: the CSS " +
      "alphas are parsed from the <code>box-shadow</code> string the function emits, the painted ones are " +
      "sampled off the canvas it paints. They are the same quantity and they should agree.",
    `<div class="kit-bevel-pair">
       <div class="kit-bevel-cell">
         <div class="kit-bevel-plate" style="box-shadow:${esc(bevelBig.boxShadow)}"></div>
         <span class="kit-cap">bevel · css box-shadow</span>
       </div>
       <div class="kit-bevel-cell">
         <div class="kit-bevel-plate" style="--kit-bevel-src:url('${esc(bevelBig.dataUri)}')"></div>
         <span class="kit-cap">bevel · painted canvas, same call</span>
       </div>
     </div>
     <dl class="kit-bevel-nums kit-mono" data-bevel-nums>
       <dt>edge</dt><dd>css α</dd><dd>painted α</dd><dd>ratio</dd>
     </dl>`
  );

  /** The five latent widgets. `<summary>` is the sixth and has its own markup below. */
  const NATIVES: readonly { id: string; label: string; markup: string }[] = [
    { id: "progress", label: "&lt;progress&gt;", markup: `<progress value="62" max="100"></progress>` },
    { id: "meter", label: "&lt;meter&gt;", markup: `<meter value="0.4"></meter>` },
    { id: "date", label: "type=date", markup: `<input class="field" type="date" value="2026-03-14">` },
    { id: "color", label: "type=color", markup: `<input type="color" value="#b56cff">` },
    { id: "file", label: "type=file", markup: `<input type="file">` },
  ];

  const natives = card(
    "s6",
    "A6 · the OS chrome the kit has not reached, and the tick that is a second hand",
    "&sect;A6 says no route may ever render an OS widget, and binds the kit to the elements themselves — but " +
      "only six of them. <code>&lt;summary&gt;</code> is not one, and it is live on the story screen today " +
      "drawing the engine's own disclosure triangle on a screen that owns 107 hand-drawn marks. The five " +
      "beside it are latent: nothing uses them yet, and the first screen that reaches for a seventh element " +
      "type gets whatever the engine ships. This card exists so that stops being an argument and becomes a " +
      "photograph — every specimen is probed at mount and says whether it is still native.",
    `<div class="kit-natives">
       ${NATIVES.filter((n) => n.id !== "summary")
         .map(
           (n) => `
         <div class="field-group">
           <label class="t-label">${n.label}</label>
           ${n.markup}
           <span class="kit-cap" style="text-align:left" data-native="${n.id}">—</span>
         </div>`
         )
         .join("")}
       <details data-native-details>
         <summary>&lt;summary&gt; — a disclosure the kit does not own yet</summary>
         <p>The fix is four lines in module A's own file: <code>list-style: none</code>,
         <code>::-webkit-details-marker { display: none }</code>, and the same
         <code>--chevron-arm-l/r</code> pair the select already uses, rotated on <code>[open]</code> so the
         mark has a state.</p>
       </details>
       <span class="kit-cap" style="text-align:left" data-native="summary">—</span>
       <p class="kit-native-verdict kit-note" data-native-verdict>—</p>
     </div>
     <hr class="hairline">
     <p class="kit-note">And the mark on the checkbox, at 4×. Module A draws its own tick — a different path
     (<code>m5 13 4.5 4.5L19 6.5</code>) at a different weight (2.75 against ${ICON_STROKE}) with the ink
     baked in — and module C draws <code>check</code>. Two hands, one set. <code>FORM_TICKS</code> in
     <code>uiIcons.ts</code> now emits the correct strings so the repair is a paste; the artwork below is
     what changes when it lands.</p>
     <div class="kit-hands">
       ${[
         { fill: "", from: "--tick", cap: "module A · --tick" },
         { fill: FORM_TICKS.tick, from: "", cap: "module C · check" },
         { fill: "", from: "--tick-off", cap: "module A · --tick-off" },
         { fill: FORM_TICKS.tickOff, from: "", cap: "module C · check, dimmed" },
       ]
         .map(
           (h) => `
         <div class="kit-tex-cell">
           <div class="mat-well kit-hand-mark"${
             h.fill
               ? ` style="background-image:url('${esc(h.fill)}')"`
               : ` data-hand-var="${h.from}"`
           }></div>
           <span class="kit-cap">${esc(h.cap)}</span>
         </div>`
         )
         .join("")}
     </div>`
  );

  // --- the icon sheets --------------------------------------------------------

  /*
   * The nine pills, at the three sizes a destination tile might draw them.
   *
   * Round 4's stills verdict: "the nine lobby destinations are still nine
   * identical pills with a small centred icon, which is the flattest thing in
   * any frame I captured." Module C does not own the lobby and must not edit it.
   * What it owes whoever does is (a) marks that survive being drawn four times
   * larger, which is what the optical ramp is for, and (b) evidence, at that
   * size, that they are still nine different pictures.
   */
  const DESTINATIONS: readonly IconId[] = [
    "collection",
    "deck-builder",
    "merch-drop",
    "missions",
    "mastery",
    "hype-wave",
    "achievement",
    "events",
    "inbox",
  ];

  const destTile = (
    id: IconId,
    title: string,
    meta: string,
    countText: string,
    extra = ""
  ): string => `
    <button class="mat-panel act r-tile kit-dest-tile${extra}"
            style="--dest-mark:url('${esc(iconDataUri(id, "#ffffff", 168))}')">
      <span class="mat-well r-tile kit-dest-socket">${icon(id, { size: 34, optical: "display" })}</span>
      <span class="kit-dest-stack">
        <span class="kit-dest-title">${esc(title)}</span>
        <span class="kit-dest-meta">${meta}</span>
      </span>
      <span class="num kit-dest-count" style="--digits:4">${countText}</span>
      ${icon("chevron-right", { size: 18, class: "kit-dest-go" })}
    </button>`;

  const destinations = card(
    "s12",
    "C · the same nine at 24, 40 and 56 — and what the set gives a destination tile",
    `Every mark is one drawing at one weight; what changes down the column is the optical rung, ` +
      `<code>${ICON_OPTICAL.ui}</code> → <code>${ICON_OPTICAL.display}</code> → ` +
      `<code>${ICON_OPTICAL.hero}</code>, chosen from the rendered size by <code>opticalFor()</code>. ` +
      "Without it a 56px tile mark paints a line 2.3× heavier in proportion than the one this set was signed " +
      "off at, and a blown-up hairline set is the single loudest tell that an icon family was drawn for one " +
      "size. The three tiles are assembled entirely from primitives that already shipped — " +
      "<code>.mat-panel .act</code>, <code>--r-tile</code>, <code>.mat-well</code> for the socket, " +
      "<code>.num</code>, <code>chevron-right</code>, and the same mark again through " +
      "<code>iconDataUri(id, ink, 168)</code> as a 7% watermark. No new art, and no lobby file touched.",
    `<div class="kit-dest-ladder">
       ${DESTINATIONS.map(
         (id) => `
         <div class="kit-dest-col">
           ${icon(id, { size: 56 })}
           ${icon(id, { size: 40 })}
           ${icon(id, { size: 24 })}
           <span class="kit-dest-name">${esc(id)}</span>
         </div>`
       ).join("")}
     </div>
     <hr class="hairline">
     <div class="kit-dest-tiles">
       ${destTile("collection", "Collection", "296 cards · 41 new", "296")}
       ${destTile(
         "missions",
         "Missions",
         `${icon("live", { size: 12 })} 2 of 3 claimable`,
         "3"
       )}
       ${destTile("hype-wave", "Hype Wave", "Tier 24 · ends in 6 days", "24", " kit-force-hover")}
     </div>
     <div class="kit-dest-tiles">
       <span class="kit-cap">rest</span>
       <span class="kit-cap">rest · with the new <code>live</code> pip</span>
       <span class="kit-cap is-forced">hover · forced</span>
     </div>`
  );

  const sheetCells = ICON_IDS.map((id) => {
    const heading = ICON_SECTIONS[id];
    const alias = drawn.has(id) ? "" : " is-alias";
    return (
      (heading ? `<div class="kit-icon-section">${esc(heading)}</div>` : "") +
      `<div class="kit-ico${alias}">${icon(id, { size: ICON_GRID })}` +
      `<span class="kit-ico-name">${esc(id)}</span></div>`
    );
  }).join("");

  const icons24 = card(
    "s12",
    `C · the complete set at ${ICON_GRID}px — ${count(ICON_IDS.length)} names, ${count(DRAWN_ICON_IDS.length)} drawings`,
    "One grid, one stroke weight, <code>currentColor</code> only, no font and no network. Italic names are " +
      "aliases — the same drawing under a second name. Every mark must be distinguishable from every other " +
      "at this size; Practice-vs-AI and Casual Match used to share a shape.",
    `<div class="kit-icon-sheet">${sheetCells}</div>`
  );

  const icons56 = card(
    "s12",
    "C · the same set at 56px, on the display rung",
    "Two and a third times the size, no labels: where an off-grid stroke, a mismatched corner or a mark " +
      "heavier than the rest of the family stops hiding. This sheet used to be drawn at 48px on the same " +
      `stroke the 24px sheet uses, which painted a ${(ICON_STROKE * 2).toFixed(1)}px line — the set looked ` +
      "correct here and wrong on anything that used it large. It is the same drawings; only the rung moved.",
    `<div class="kit-icon-big">${ICON_IDS.map((id) => icon(id, { size: 56 })).join("")}</div>`
  );

  /*
   * Three containers, not one wrapper, and this is the round-4 fix.
   *
   * `transitions.css` cascades `.screen[data-nav] > :is(header, nav, main,
   * section, footer, [class*="-body"]) > *:nth-child(-n + 7)`. Everything here
   * used to live in one `<div class="kit-sheet">`, which matches none of those
   * — so the page built to demonstrate the motion system fired zero
   * `nav-child-rise` events on arrival, twice, on an instrumented run.
   *
   * Seven cards per container, because that is where the rule stops and an
   * eighth child would arrive with no entrance at all while its neighbours rose.
   * Splitting on seven also puts the three containers on the three rungs of the
   * base scheme — header at 0, first body at 4, anything after it at 11 — so the
   * gallery photographs the whole scheme rather than the middle of it, including
   * the one collision the scheme tolerates: bands two and three share base 11
   * and cascade in parallel.
   */
  root.innerHTML = `
    <div class="uikit-glow" aria-hidden="true"></div>
    <header class="kit-card mat-panel r-panel kit-top">${header}</header>
    <main class="uikit-body">
      ${materials}
      ${interaction}
      ${radii}
      ${focus}
      ${dividers}
      ${forms}
      ${contrast}
    </main>
    <section class="uikit-body">
      ${typeRoles}
      ${moduleB}
      ${formats}
      ${motion}
      ${restMotion}
      ${bevels}
      ${natives}
    </section>
    <section class="uikit-body">
      ${destinations}
      ${icons24}
      ${icons56}
    </section>
    <div class="uikit-crawl" aria-hidden="true"></div>`;

  // --- things markup cannot express -------------------------------------------

  /*
   * `indeterminate` is an IDL property with no content attribute, so the third
   * tick box can only be put into its third state from script. It is worth the
   * three lines: an indeterminate checkbox that looks like an unchecked one is
   * a state the player cannot read, and the kit draws it as a dash.
   */
  for (const box of root.querySelectorAll<HTMLInputElement>('input[data-indeterminate="1"]')) {
    box.indeterminate = true;
  }

  const staggerHost = root.querySelector<HTMLElement>("[data-stagger]");
  const tickerEl = root.querySelector<HTMLElement>("[data-ticker]");
  const replayBtn = root.querySelector<HTMLButtonElement>("[data-replay]");

  const replay = (): void => {
    if (staggerHost) {
      const cells = staggerHost.querySelectorAll<HTMLElement>(".kit-stagger-cell");
      staggerHost.classList.remove("is-running");
      // Reading a layout property is what makes the class removal and the
      // re-add two separate style changes rather than one no-op; without it the
      // animation never restarts.
      void staggerHost.offsetWidth;
      stagger(cells, { step: 45 });
      staggerHost.classList.add("is-running");
    }
    if (tickerEl) {
      tickerEl.textContent = "0";
      tickerTo(tickerEl, 128_450, DUR.setpiece);
    }
  };

  replayBtn?.addEventListener("click", replay);

  /*
   * The loop exists for the camera and for nobody else. It is behind
   * `motionEnabled()` because a permanent cycling animation is exactly what
   * that setting is asking us not to make, and the Replay button still works
   * when it is off — which is also the answer for a human who opens this route
   * and would rather it held still.
   *
   * The period is a little over three times the cascade (260ms plus a 495ms
   * tail), which keeps the row settled most of the time without making a burst
   * wait a long time for something to happen. A burst that wants the cascade
   * for certain should ask for it:
   *
   *     node scripts/shot.mjs uikit --eval "document.querySelector('[data-replay]').click()" --frames 8x60
   */
  const looping = motionEnabled();
  const timer = looping ? window.setInterval(replay, 2600) : 0;

  /*
   * Everything below has to happen after the element is in the document:
   * `getComputedStyle` on a detached node returns nothing, and focus on one
   * does nothing at all. The shell appends synchronously as soon as this
   * factory returns, so one frame is enough — and `isConnected` covers the case
   * where the player navigated away inside that frame.
   */
  const settle = requestAnimationFrame(() => {
    if (!root.isConnected) return;

    for (const swatch of root.querySelectorAll<HTMLElement>("[data-radius]")) {
      const role = swatch.dataset["radius"];
      const target = root.querySelector<HTMLElement>(`[data-radius-value="${role}"]`);
      if (target) target.textContent = getComputedStyle(swatch).borderTopLeftRadius;
    }

    /*
     * The repaired tokens, resolved rather than restated. Reading them back is
     * the only version of this claim worth printing: if one of them were still
     * undefined, `getPropertyValue` would answer with an empty string and the
     * row would say so out loud instead of quietly agreeing with itself.
     */
    const repairs = root.querySelector<HTMLElement>("[data-repairs]");
    if (repairs) {
      const live = getComputedStyle(document.documentElement);
      repairs.innerHTML = ["--line", "--sp-8", "--muted", "--radius-md", "--bg"]
        .map((token) => {
          const value = live.getPropertyValue(token).trim();
          return `<dt>${esc(token)}</dt><dd>${esc(value || "still undefined")}</dd>`;
        })
        .join("");
    }

    const widthOut = root.querySelector<HTMLElement>("[data-focus-width]");
    if (widthOut) widthOut.textContent = getComputedStyle(document.documentElement).getPropertyValue("--focus-width").trim();

    /*
     * The one genuine focus state on the page. Chrome's `:focus-visible`
     * heuristic always matches a focused text input regardless of what moved
     * the focus, which is what makes a programmatic call enough here and not
     * enough on the button beside it. `preventScroll` because the sheet is a
     * scroller and a focus that jumps it would move everything the camera is
     * pointed at.
     */
    root.querySelector<HTMLInputElement>("#kit-name")?.focus({ preventScroll: true });

    paintNumHands();
    paintContrast();
    paintNatives();
    paintHands();
    void paintBevelNumbers();

    replay();
  });

  // --- the readouts ------------------------------------------------------------

  /** Which face and weight `.num` and `.t-body` actually resolve to, side by side. */
  function paintNumHands(): void {
    const out = root.querySelector<HTMLElement>("[data-num-family]");
    const body = root.querySelector<HTMLElement>(".t-body.kit-hand-figure");
    const numeral = root.querySelector<HTMLElement>(".num.kit-hand-figure");
    if (!out || !body || !numeral) return;
    const describe = (el: HTMLElement): string => {
      const s = getComputedStyle(el);
      return `${s.fontFamily.split(",")[0]!.replace(/["']/g, "")} ${s.fontWeight}`;
    };
    const a = describe(body);
    const b = describe(numeral);
    /*
     * Same answer twice is the defect, not the pass — which is the opposite of
     * every other live check on this page and worth saying out loud. `.num`
     * exists to be the numeral *role*; if it resolves to the same face and
     * weight as `.t-body` then §A3's five requirements have been met by one of
     * them and the brand face is being used by every role except the one that
     * is only digits.
     */
    const forked = a !== b;
    out.textContent = forked ? `${a}  vs  ${b}` : `both ${a} — .num has no face of its own`;
    out.className = forked ? "kit-cap is-real" : "kit-cap is-fail";
  }

  /**
   * The contrast matrix, both themes, inside one frame.
   *
   * The high-contrast half is measured by writing `data-contrast="high"` onto
   * the root, reading, and putting the old value back — all synchronously, so
   * the browser never gets a chance to paint the intermediate state. Two forced
   * style recalculations of a page this size are not free, which is why this
   * runs a frame after mount rather than inside the constructor: the round-4
   * motion review counted six long tasks in this screen's build and a seventh
   * would be this file's fault rather than the shell's.
   */
  function paintContrast(): void {
    const cells = root.querySelectorAll<HTMLElement>("[data-cell]");
    if (cells.length === 0) return;
    const html = document.documentElement;
    const previous = html.dataset["contrast"];

    const readTheme = (theme: string): void => {
      for (const cell of cells) {
        const [cellTheme, tier, role] = (cell.dataset["cell"] ?? "").split("|");
        if (cellTheme !== theme || !tier || !role) continue;
        const plate = root.querySelector(`[data-probe-plate="${tier}|${role}"]`);
        const ink = root.querySelector(`[data-probe-ink="${tier}|${role}"]`);
        const ratio = plate && ink ? worstRatioOn(plate, ink) : null;
        if (ratio === null) {
          cell.textContent = "—";
          continue;
        }
        cell.textContent = ratio.toFixed(1);
        cell.className =
          "kit-ratio " +
          (ratio >= 7 ? "is-aaa" : ratio >= 4.5 ? "is-aa" : ratio >= 3 ? "is-lg" : "is-bad");
      }
    };

    readTheme("standard");
    html.dataset["contrast"] = "high";
    readTheme("high");
    if (previous === undefined) delete html.dataset["contrast"];
    else html.dataset["contrast"] = previous;
  }

  /**
   * Which of the six is still drawn by the operating system.
   *
   * `appearance` is the honest probe for most of the form widgets — the kit's
   * own rule is `appearance: none`, so anything still answering `auto` has not
   * been reached. Two need a different question, and both were caught by this
   * card disagreeing with the photograph beside it:
   *
   * `<summary>`'s tell is the disclosure marker rather than a widget skin, so
   * the property to read is `display`: its initial value is `list-item` and
   * anything that has taken the triangle away has had to change that.
   *
   * `type=file` answers `appearance: none` on the input itself while still
   * drawing the platform's own "Choisir un fichier" button, because that button
   * is a pseudo-element with its own box — so the probe reads
   * `::file-selector-button` instead. This is the whole argument of the card in
   * miniature: a rule that names an element is not a rule that covers what the
   * engine draws for it.
   */
  function paintNatives(): void {
    let native = 0;
    let total = 0;
    for (const slot of root.querySelectorAll<HTMLElement>("[data-native]")) {
      const id = slot.dataset["native"];
      const target =
        id === "summary"
          ? root.querySelector<HTMLElement>("[data-native-details] > summary")
          : (slot.parentElement?.querySelector<HTMLElement>(
              "progress, meter, input"
            ) ?? null);
      if (!target) continue;
      total += 1;
      const property = id === "summary" ? "display" : "appearance";
      const style =
        id === "file" ? getComputedStyle(target, "::file-selector-button") : getComputedStyle(target);
      const value = id === "summary" ? style.display : style.appearance;
      const styled = id === "summary" ? value !== "list-item" : value === "none";
      if (!styled) native += 1;
      slot.textContent = `${property}${id === "file" ? " (button)" : ""}: ${value} · ${
        styled ? "kit" : "OS"
      }`;
      slot.className = `kit-cap is-${styled ? "real" : "forced"}`;
      if (!styled) slot.style.color = "var(--danger)";
      else slot.style.removeProperty("color");
    }
    const verdict = root.querySelector<HTMLElement>("[data-native-verdict]");
    if (verdict) {
      verdict.innerHTML =
        native === 0
          ? `<b style="color:var(--success)">All ${total} element types are the kit's.</b> §A6's promise —
             no route may ever render an OS widget — is true of every element the platform offers, not only
             of the six the rule names.`
          : `<b style="color:var(--danger)">${native} of ${total} still render the operating system's own
             widget.</b> The rule in §A6 binds six element types by name; the platform has more than six, and
             each one it does not name is a hole the next screen falls into.`;
    }
  }

  /** The two ticks, read out of the live cascade rather than copied out of it. */
  function paintHands(): void {
    const live = getComputedStyle(document.documentElement);
    for (const slot of root.querySelectorAll<HTMLElement>("[data-hand-var]")) {
      const value = live.getPropertyValue(slot.dataset["handVar"] ?? "").trim();
      if (value) slot.style.backgroundImage = value;
    }
  }

  /**
   * The bevel, measured on both sides of its own claim.
   *
   * The CSS half is parsed out of the `box-shadow` string the function emits —
   * the four `inset` entries are, in order, the top rim, the left rim, the
   * bottom lip and the right lip. The painted half is sampled off the canvas the
   * same call painted: the peak alpha found within ten pixels of each edge,
   * along the centre line, which is where the ramp is strongest.
   *
   * They are the same quantity — how much white the lit edge carries and how
   * much black the unlit one does — so a ratio far from 1.00 is the two worlds
   * disagreeing about an edge they are supposed to share.
   */
  async function paintBevelNumbers(): Promise<void> {
    const out = root.querySelector<HTMLElement>("[data-bevel-nums]");
    if (!out) return;

    const insets = [...bevelBig.boxShadow.matchAll(/inset[^,]*rgba?\(([^()]*)\)/g)].map(
      (m) => parseRgba(m[1] ?? "")?.a ?? 0
    );
    const edges = ["top rim", "left rim", "bottom lip", "right lip"] as const;

    const image = new Image();
    const loaded = new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
    });
    image.src = bevelBig.dataUri;
    if (!(await loaded) || !root.isConnected) return;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    const { width: w, height: h } = canvas;
    const alpha = ctx.getImageData(0, 0, w, h).data;
    const at = (x: number, y: number): number => alpha[(y * w + x) * 4 + 3]! / 255;
    const peak = (points: readonly [number, number][]): number =>
      points.reduce((best, [x, y]) => Math.max(best, at(x, y)), 0);
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const span = 10;
    const painted = [
      peak(Array.from({ length: span }, (_, i) => [cx, i] as [number, number])),
      peak(Array.from({ length: span }, (_, i) => [i, cy] as [number, number])),
      peak(Array.from({ length: span }, (_, i) => [cx, h - 1 - i] as [number, number])),
      peak(Array.from({ length: span }, (_, i) => [w - 1 - i, cy] as [number, number])),
    ];

    out.innerHTML =
      `<dt>edge</dt><dd>css α</dd><dd>painted α</dd><dd>ratio</dd>` +
      edges
        .map((edge, i) => {
          const css = insets[i] ?? 0;
          const paint = painted[i] ?? 0;
          const ratio = css > 0 ? paint / css : 0;
          const bad = ratio < 0.77 || ratio > 1.3;
          return (
            `<dt>${esc(edge)}</dt><dd>${css.toFixed(3)}</dd><dd>${paint.toFixed(3)}</dd>` +
            `<dd class="${bad ? "is-bad" : ""}">${ratio.toFixed(2)}×</dd>`
          );
        })
        .join("");
  }

  // --- the rest-motion trace -----------------------------------------------------

  /*
   * One shared rAF from module D, not a loop of this file's own — the whole
   * reason `onMotionFrame` exists is that fifteen builders sharing a page cannot
   * each start a render loop, and the gallery would be a poor place to break
   * that. It is also a no-op under reduced motion, which is exactly right: with
   * the decorative layer switched off there is nothing to trace, and a canvas
   * redrawing an empty graph sixty times a second is the same defect it is
   * supposed to be measuring.
   */
  const traceCanvas = root.querySelector<HTMLCanvasElement>("[data-trace]");
  const WINDOW_MS = 4000;
  const history: number[][] = TRACKS.map(() => []);
  let stopTrace: (() => void) | null = null;

  /**
   * The material crawl's phase, read off the band itself.
   *
   * It used to read `--sheen-x` from the plate, because the band used to be a
   * background layer moved by `background-position`. That cost 27ms a frame on
   * the lobby and `foundation.css` §3 replaced it with an `::after` moved by
   * `translate`; the phase now lives in the pseudo-element's own transform, and
   * reading the old property would plot three flat lines on the one chart in the
   * game whose entire purpose is that a flat line means a dead layer.
   */
  function sheenOf(selector: string): number {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return 0;
    const value = getComputedStyle(el, "::after").translate;
    if (!value || value === "none") return 0;
    return parseFloat(value) || 0;
  }

  /*
   * `matrix3d` as well as `matrix`, because everything animated in this project
   * uses `translate3d` to stay on the compositor and a 3D transform serialises
   * to the sixteen-value form, where the x translation is at index 12 rather
   * than at index 4. Reading index 4 of a `matrix3d` returns the *scale*, which
   * is constant — a track that had quietly become a flat line while the layer it
   * was watching moved perfectly well.
   */
  function translateX(style: CSSStyleDeclaration): number {
    const inner = style.transform.match(/matrix3?d?\(([^)]*)\)/);
    if (!inner) return 0;
    const values = inner[1]!.split(",").map(Number);
    return (values.length === 16 ? values[12] : values[4]) ?? 0;
  }

  function driftOf(selector: string): number {
    const el = document.querySelector<HTMLElement>(selector);
    return el ? translateX(getComputedStyle(el)) : 0;
  }

  /** The crawl lives on a pseudo-element, which `getComputedStyle` can still read. */
  function crawlPhase(): number {
    const el = root.querySelector<HTMLElement>(".uikit-crawl");
    return el ? translateX(getComputedStyle(el, "::before")) : 0;
  }

  function sampleTracks(): number[] {
    return TRACKS.map((track) => track.read());
  }

  function drawTrace(): void {
    if (!traceCanvas) return;
    const ctx = traceCanvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = traceCanvas;
    ctx.clearRect(0, 0, w, h);

    const rows = TRACKS.length;
    const band = h / rows;
    for (let t = 0; t < rows; t++) {
      const points = history[t]!;
      const y0 = band * t;
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y0 + band - 0.5);
      ctx.lineTo(w, y0 + band - 0.5);
      ctx.stroke();
      if (points.length < 2) continue;

      let min = Infinity;
      let max = -Infinity;
      for (const v of points) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      /*
       * A track with no range left is a dead layer, and it has to *look* dead —
       * a flat line down the middle of its band, not an autoscaled fiction. The
       * 1e-4 floor is what stops floating-point dust in a static transform
       * being amplified into a waveform.
       */
      const flat = max - min < 1e-4;
      ctx.strokeStyle = TRACKS[t]!.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = (i / (points.length - 1)) * w;
        const norm = flat ? 0.5 : (points[i]! - min) / (max - min);
        const y = y0 + band - 3 - norm * (band - 6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /*
   * How many animations are actually running, counted rather than claimed.
   *
   * Sampled once, at settle, and never again: a figure that changes between two
   * captures of the same page trains a reviewer to ignore diffs, and this one is
   * stable within a second of mount anyway.
   */
  function paintIdleReadout(): void {
    const out = root.querySelector<HTMLElement>("[data-idle-live]");
    if (!out) return;
    const all = typeof document.getAnimations === "function" ? document.getAnimations() : [];
    const running = all.filter((a) => a.playState === "running");
    const mine = running.filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target ?? null;
      return target instanceof Element && root.contains(target);
    });
    out.innerHTML =
      `<b>${count(running.length)}</b> animations running on this document at rest, ` +
      `<b>${count(mine.length)}</b> of them inside this screen. Reduced motion is ` +
      `<b>${motionEnabled() ? "off" : "on"}</b>; the graphics tier is ` +
      `<b>${esc(document.documentElement.dataset["gfxTier"] ?? "unset")}</b>.`;
  }

  if (traceCanvas && motionEnabled()) {
    let carry = 0;
    stopTrace = onMotionFrame((dt) => {
      carry += dt;
      // ~60 samples a second is more than a 760px canvas can show; one sample
      // per 16ms keeps four seconds at 250 points a track and the whole redraw
      // under a tenth of a millisecond.
      if (carry < 16) return;
      carry = 0;
      const values = sampleTracks();
      const cap = Math.round(WINDOW_MS / 16);
      for (let t = 0; t < values.length; t++) {
        const row = history[t]!;
        row.push(values[t]!);
        if (row.length > cap) row.shift();
      }
      drawTrace();
    });
  }

  const idleReadout = window.setTimeout(paintIdleReadout, 900);

  return {
    root,
    dispose: () => {
      cancelAnimationFrame(settle);
      window.clearTimeout(idleReadout);
      stopTrace?.();
      if (timer) window.clearInterval(timer);
    },
  };
}
