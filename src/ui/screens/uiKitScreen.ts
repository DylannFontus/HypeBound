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
 * ## Why everything is sized to one 1600×2200 frame
 *
 * `#app` is `position: fixed; overflow: hidden`, so anything past the viewport
 * is clipped rather than photographed, and an element screenshot cannot escape
 * an ancestor's clip either. A gallery that scrolls is a gallery whose bottom
 * half never reaches a critic. So the sheet is a twelve-column grid tuned to
 * fill exactly one frame at the review size, and it keeps `overflow: auto` only
 * as a safety net for a browser that measures type slightly differently.
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
  ICON_GRID,
  ICON_IDS,
  ICON_STROKE,
  icon,
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
  installTextureVars,
  shadowOffset,
  softMaskDataUri,
} from "../art/texture";
import { DUR, EASE, cssEase, motionEnabled, stagger, tickerTo } from "../motion";
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
.uikit-screen { position: absolute; inset: 0; overflow: hidden; }

.kit-sheet {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 8px;
  align-content: start;
}

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
  height: 66px; display: flex; align-items: center; justify-content: center;
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

/*
 * Forced hover — mirrors \`.act:hover\` in foundation.css §5.
 * Same four knobs, same keyframe. The wipe is slowed to nine times its real
 * duration and looped so a --frames burst catches it mid-crossing; the real
 * rule fires it once, at --dur-sheen.
 */
.kit-force-hover.act {
  transform: translateY(-2px) scale(1.015);
  --rim-boost: 2;
  --cast-lift: 0.55;
  border-color: rgb(255 255 255 / calc(0.18 * var(--mat-amp) + 0.1));
  animation: hb-sheen calc(var(--dur-sheen) * 9) var(--ease-arrive) infinite;
}

/* Forced press — mirrors \`.act:active\` in foundation.css §5. */
.kit-force-active.act {
  transform: scale(0.985);
  --cast-lift: 0;
  --rim-boost: 0.4;
  --press-cast: inset 0 2px 6px rgb(0 0 0 / calc(0.5 * var(--mat-amp) + 0.15));
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
    0 0 0 calc(var(--focus-width) + var(--focus-gap) + 2px) var(--focus-halo);
}

:root[data-reduced-motion="true"] .kit-force-hover.act { animation: none; }

/* ---- radius, focus, dividers ---------------------------------------------- */
.kit-radii { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.kit-radius-swatch { height: 58px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px; }
.kit-radius-swatch span { font-size: 0.58rem; color: var(--text-faint); }

.kit-focus-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 6px 2px 2px; }
.kit-focus-item { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.kit-focus-box { width: 84px; height: 42px; display: flex; align-items: center; justify-content: center;
  font-size: 0.62rem; color: var(--text-dim); }

.kit-rail { height: 12px; padding: 0; overflow: hidden; position: relative; }
.kit-rail-fill {
  position: absolute; inset: 0 auto 0 0; width: 100%;
  transform-origin: left center;
  border-radius: inherit;
  background-image:
    linear-gradient(var(--light-sweep), var(--accent-bright) 0%, var(--accent) 55%, var(--accent-hot) 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -1px 0 rgb(0 0 0 / 0.35);
}
.kit-rail-fill.is-live { animation: kit-fill 2600ms var(--ease-in-out) infinite; }
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
.kit-grain-mag {
  height: 52px; border-radius: var(--r-field);
  background-color: #6f6a80;
  background-image: var(--tex-grain, none);
  background-size: calc(var(--tex-grain-size, 128px) * 6);
  image-rendering: pixelated;
  filter: contrast(2.4);
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
.kit-tex-painted { background-color: #6b6390; background-size: 100% 100%; }
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
    <section class="kit-card mat-panel r-panel s12 kit-top">
      <div class="kit-top-text">
        <h1 class="t-display">The foundation, photographed</h1>
        <p class="t-body" style="margin:2px 0 0;font-size:0.8rem">
          Four materials, five radii, five type roles, one interaction mixin, one focus ring, the form kit,
          ${count(ICON_IDS.length)} icons on a ${ICON_GRID}px grid at ${ICON_STROKE}px stroke, the generated
          grain, and the motion and format tokens — all of it at once, so two of them lit by different suns
          would be obvious. Green captions are real states; blue captions are forced copies of a state a
          screenshot cannot reach.
        </p>
      </div>
      <div class="kit-mirrors">${mirrorChips}</div>
      <a class="kit-back mat-chip act r-chip" href="#lobby">${icon("arrow-left", { size: 14 })} Lobby</a>
    </section>`;

  const materials = card(
    "s12",
    "A1 · materials — hero 1.0, panel 0.55, chip 0.35, well 0.7",
    "Top row: each material at the role it exists for. Bottom row: the same four forced to one size and one " +
      "radius, so the rim on the top edge, the lip on the bottom edge and the cast to the bottom-right can be " +
      "compared across them. Every one is lit from 315°; if any plate disagrees, this row is where it shows.",
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
           shadowOffset(10) → <b>x ${cast.x.toFixed(1)}, y ${cast.y.toFixed(1)}</b>
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
         <span class="num" style="--digits:4">${count(1284)}</span>
         <span class="kit-tile-sub">Diamond III · ${quantity(6, "win")}</span>
       </div>`,
      s.cap,
      s.kind
    );
  }).join("");

  const interaction = card(
    "s12",
    "A4 · every state of a button and a tile",
    "Seven states, two ranks of material, one mixin. Disabled changes fill, border, text and icon saturation " +
      "rather than opacity; loading is a looped specular wipe rather than a spinner — both are animating in " +
      "this frame, so a burst capture shows them move.",
    `<div class="kit-states">${buttonRow}</div>
     <div class="kit-states">${tileRow}</div>`
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
           <div class="kit-rail-fill${r.live ? " is-live" : ""}" style="transform:scaleX(${r.pct / 100})"></div>
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
    "Every control is <code>appearance: none</code>; the chevron and the tick are inline <code>data:</code> " +
      "SVGs on module C's grid, so the dropdown arrow and the icons are the same hand. The first field is " +
      "focused for real — that ring is <code>:focus-visible</code> itself, not a copy.",
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
         <span class="field-note">appearance: none, chevron drawn on C's grid</span>
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
         <input class="slider" id="kit-vol" type="range" min="0" max="100" value="62" style="--slider-fill:62%">
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
    "s3",
    "A3 · five type roles, and numbers that do not reflow",
    "Each role has its own size, weight, tracking and colour. The dashed rule marks the right edge of a " +
      "six-digit <code>.num</code> slot: every value below lands on it, including the one counting up in the " +
      "motion panel.",
    `<div class="kit-type">
       <div class="t-display">HYPEBOUND</div>
       <div class="t-heading">One of four materials</div>
       <p class="t-body" style="font-size:0.8rem">Body copy is dimmer and looser in leading, because a
       paragraph read at length wants air and a heading read at a glance does not.</p>
       <div class="t-label">Section label · +0.08em</div>
     </div>
     <dl class="kit-nums">
       <dt>single digit</dt><dd><span class="num" style="--digits:6">${count(9)}</span></dd>
       <dt>three</dt><dd><span class="num" style="--digits:6">${count(654)}</span></dd>
       <dt>grouped</dt><dd><span class="num" style="--digits:6">${count(65432)}</span></dd>
       <dt>signed delta</dt><dd><span class="num" style="--digits:6">${signed(-128)}</span></dd>
       <dt>ordinal</dt><dd><span class="num" style="--digits:6">${ordinal(23)}</span></dd>
       <dt>timer</dt><dd><span class="num" style="--digits:6">${clock(95_000)}</span></dd>
     </dl>`
  );

  const moduleB = card(
    "s3",
    "B · generated textures",
    "Canvas-made, memoised, nothing fetched. Two identical panels below — the left with module B's noise at " +
      "5%, the right with none — then the same tile at ×6 with the contrast pushed, so the structure is " +
      "checkable rather than merely believable. Each of these also exists as a " +
      "<code>THREE.CanvasTexture</code> from the same pixels, which is what lets the DOM HUD and the 3D mat " +
      "share one edge treatment.",
    `<div class="kit-grain-pair">
       <div class="mat-panel r-tile kit-grain-plate"></div>
       <div class="mat-panel r-tile kit-grain-plate" style="--mat-grain:none"></div>
     </div>
     <div class="kit-grain-pair">
       <span class="kit-cap">grain on</span><span class="kit-cap">grain off</span>
     </div>
     <div class="kit-grain-mag"></div>
     <span class="kit-cap">the 128px tile at ×6, contrast ×2.4</span>
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
         <div class="kit-tex-swatch kit-tex-painted" style="background-image:url('${esc(bevel.dataUri)}')"></div>
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

  // --- the icon sheets --------------------------------------------------------

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

  const icons48 = card(
    "s12",
    "C · the same set at 48px",
    "Twice the size, no labels: where an off-grid stroke, a mismatched corner or a mark heavier than the rest " +
      "of the family stops hiding.",
    `<div class="kit-icon-big">${ICON_IDS.map((id) => icon(id, { size: 48 })).join("")}</div>`
  );

  root.innerHTML = `<div class="kit-sheet">
    ${header}
    ${materials}
    ${interaction}
    ${radii}
    ${focus}
    ${dividers}
    ${forms}
    ${typeRoles}
    ${moduleB}
    ${formats}
    ${motion}
    ${icons24}
    ${icons48}
  </div>`;

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

    replay();
  });

  return {
    root,
    dispose: () => {
      cancelAnimationFrame(settle);
      if (timer) window.clearInterval(timer);
    },
  };
}
