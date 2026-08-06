/**
 * The pieces twenty-three screens were each inventing separately.
 *
 * Two audits of this domain agreed on the diagnosis: not that any one screen was
 * badly built, but that **nothing was shared**, so the same decision was made
 * differently nine times. Three page containers. Two active-chip styles in one
 * row. Four screens whose list rows were unfocusable `<li>` elements and a fifth
 * that had already done it correctly with `<button>`. Eleven `Intl` call sites
 * passing `undefined` and printing "jeu. 6 août 2026" inside an English
 * sentence. "Play ai" on one screen and "Practice" for the same mode on the next.
 *
 * So the fixes live here once and the screens call them. Everything in this file
 * is either a thin wrapper over a foundation primitive or a decision that had to
 * be made once — never a second implementation of something module A, B, C or D
 * already ships.
 *
 * ## What is here
 *
 *  - `esc` and the mode/economy label tables — the copy fixes
 *  - `row`, `tile`, `chip` — markup builders that emit the foundation's
 *    materials and interaction mixin rather than bespoke classes
 *  - `emptyState` — one designed empty state, on module A's `.empty`
 *  - `meter` — a `.mat-well` groove with a `.well-fill` object in it
 *  - `enter`, `countUp`, `rovingList`, `fadeOnScroll` — the behaviours
 *
 * ## Two rules the builders follow
 *
 * **Every interactive thing is a real `<button>`.** Not an `<li>` with a click
 * listener. Keyboard focus is a hard constraint, and the pattern was already in
 * the codebase — `replayScreen` had it right — it simply was not applied.
 *
 * **Every number a player reads is `.num`.** The class is module A's and carries
 * `tabular-nums` plus a reserved slot, so a counter does not shove the row along
 * when it ticks from 9 to 10.
 */

import { icon as drawIcon, type IconId } from "../../art/uiIcons";
import {
  count as fmtCount,
  date as fmtDate,
  dateTime as fmtDateTime,
  num as fmtNum,
  relative as fmtRelative,
} from "../../format";
import { DUR, motionEnabled, stagger, tickerTo } from "../../motion";
import {
  banner,
  crest,
  colourFor,
  cosmeticSwatch,
  ladderPlate,
  rankCrest,
  rewardTile,
  token,
  type RewardKind,
  type SwatchKind,
} from "./art";
import type { EmblemShape } from "../../cosmetics/emblem";
import "./data.css";
import "./rooms.css";
import "./hall.css";

export {
  crest,
  colourFor,
  banner,
  cosmeticSwatch,
  ladderPlate,
  rankCrest,
  rewardTile,
  emblemFor,
  token,
} from "./art";
export type { RewardKind, SwatchKind } from "./art";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A mode's name, as a player would say it.
 *
 * The event hub offered "Play ai", "Play boss" and "Play puzzle"; the match
 * history filter chips read "ai", "gauntlet", "story" in lowercase beside
 * properly titled faction chips; and the statistics screen one click away said
 * "Practice" for the same data, because `dashboard.ts` has had this table all
 * along and kept it private.
 *
 * It is restated here rather than exported from there because `dashboard.ts` is
 * another module's file. The two are checked against each other by eye and the
 * duplication is deliberate and small; the alternative was leaving nine screens
 * printing engine ids.
 */
const MODE_LABEL: Record<string, string> = {
  ai: "Practice",
  boss: "Weekly Boss",
  casual: "Casual",
  custom: "Custom",
  doomscroll: "The Doomscroll",
  draft: "Draft",
  gauntlet: "The Gauntlet",
  puzzle: "Puzzle Rush",
  ranked: "Ranked",
  remix: "Remix",
  story: "Story",
  tour: "Grand Tour",
  tutorial: "Tutorial",
};

/** What the *button* says, which is not always what the mode is called. */
const MODE_ACTION: Record<string, string> = {
  ai: "Practice match",
  boss: "Boss fight",
  puzzle: "Puzzle run",
  draft: "Draft a deck",
  story: "Story chapter",
  gauntlet: "Enter the Gauntlet",
  doomscroll: "Start a run",
};

/** `"ai-expert"` and `"ai"` are the same mode. */
export const baseModeOf = (mode: string): string => mode.split("-")[0] ?? mode;

export function modeName(modeId: string): string {
  return MODE_LABEL[baseModeOf(modeId)] ?? titleCase(modeId);
}

export function modeAction(modeId: string): string {
  const base = baseModeOf(modeId);
  return MODE_ACTION[base] ?? `Play ${MODE_LABEL[base] ?? titleCase(modeId)}`;
}

/** Difficulty ids are lowercase engine strings and were printed raw in a select. */
export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * `missions.match.winClout` → "Clout per win".
 *
 * The patch notes printed raw config paths in monospace beside six literal
 * "undefined"s. No reference game leaks a JS primitive or an internal key into
 * player copy; MTGA's notes say "Daily win reward", not `missions.match.winClout`.
 * Anything not in the table falls back to a de-camelised path, which is still
 * readable English rather than a key.
 */
const ECONOMY_LABEL: Record<string, string> = {
  "missions.aiDailyCapWins": "Practice wins that pay each day",
  "missions.dailyBonusDrops": "Merch Drops in the daily bonus",
  "missions.dailyBonusEvery": "Days between daily bonuses",
  "missions.dailyPuzzleClout": "Clout for the daily puzzle",
  "missions.match.lossClout": "Clout for a loss",
  "missions.match.winClout": "Clout for a win",
  "missions.match.drawClout": "Clout for a draw",
  "missions.weeklyClout": "Weekly mission Clout",
  "banner.legendaryRate": "Legendary odds",
  "banner.epicRate": "Epic odds",
  "banner.rareRate": "Rare odds",
  "banner.pityEpic": "Guaranteed Epic within",
  "banner.pityTarget": "Guaranteed Target Card within",
  "craft.legendary": "Signal to craft a Legendary",
  "craft.epic": "Signal to craft an Epic",
  "craft.rare": "Signal to craft a Rare",
  "craft.common": "Signal to craft a Common",
};

export function economyLabel(path: string): string {
  const known = ECONOMY_LABEL[path];
  if (known) return known;
  const leaf = path.split(".").pop() ?? path;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Strip a design-document citation out of a sentence meant for a player.
 *
 * "These are the others §4.5.3 describes" and "§4.2.3's faction and Current
 * filter appears when…" both shipped. The paragraphs behind them are honest and
 * worth keeping; the citation is the fastest possible way for a viewer to
 * identify the indie project, because no shipped game prints its own spec
 * references as flavour text.
 */
export function unspec(text: string): string {
  /*
   * The citation is the *subject*, so deleting it leaves a sentence with none.
   *
   * The first version removed the reference and capitalised whatever followed,
   * which turned "§4.4.3 asks for a leaderboard tab per event" into "Asks for a
   * leaderboard tab per event" — a dangling verb shipped on the events hub — and
   * "These are the others §4.5.3 describes" into "These are the others
   * describes". Every one of these paragraphs is a sentence *about the design*,
   * so the design is what the citation is standing in for. Substituting it keeps
   * the grammar and loses only the number, which is the part no player wants.
   */
  return text
    .replace(/§\s*[\d.]+(?:\.\d+)*('s)?/g, (_match, possessive: string | undefined) =>
      possessive ? "the design's" : "the design"
    )
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*([a-z])/, (_m, c: string) => c.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Formatting — every one of these is `format.ts`, pinned to en-GB
// ---------------------------------------------------------------------------

export const num = fmtNum;
export const count = fmtCount;

/** "6 August 2026" — authored calendar dates, in UTC, in English. */
export const longDate = (at: number | Date): string =>
  fmtDate(at, { day: "numeric", month: "long", year: "numeric" });

/** "6 Aug" — a list row's date, where the year is noise. */
export const shortDate = (at: number | Date): string => fmtDate(at, { day: "numeric", month: "short" });

/** "Thu 6 Aug 2026, 20:00" — a deadline, which has to be unambiguous. */
export const stamp = (at: number | Date): string =>
  fmtDateTime(at, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * "30 Jul, 21:58" — a match record.
 *
 * `year: undefined` is doing real work and is not a redundant key. `dateTime`
 * merges over a base that includes `year: "numeric"`, and passing a component as
 * `undefined` is how `Intl` is told to drop it — so without this line the helper
 * documented as "30 Jul, 21:58" actually rendered **"30 Jul 2026, 21:58"**.
 * Five characters, on the most cramped row in the domain: the Match History
 * list, where that line shares a 400px track with the deck name and ellipsised
 * because of them.
 */
export const logStamp = (at: number | Date): string =>
  fmtDateTime(at, { day: "numeric", month: "short", year: undefined, hour: "2-digit", minute: "2-digit" });

/** "1 turn" / "2 turns". The domain shipped "1 turns" in two places. */
export const quantify = (value: number, one: string, many = `${one}s`): string =>
  `${fmtCount(value)} ${value === 1 ? one : many}`;

/**
 * "3 hours ago", "yesterday", "just now" — `format.ts`'s, not a second one.
 *
 * The cloud-save screen kept a private `new Intl.RelativeTimeFormat(LOCALE, …)`
 * with its own three-rung unit ladder, which is `format.ts::relative` written
 * again with fewer rungs: anything older than a day came out as "14 days ago"
 * rather than "2 weeks ago", and anything older than a year the same way. A
 * second implementation of a formatter is exactly the drift this module exists
 * to stop, and re-exporting it is the whole fix.
 */
export const ago = fmtRelative;

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * The icon set, at a size.
 *
 * Re-exported through here so a screen never reaches for a Unicode glyph again.
 * `◈ ✦ ◆ ⏮ ◀ ▶ ⏭ ✉` were all in this domain's markup, rendering in whatever font
 * the OS happens to have, at the wrong weight, and becoming tofu wherever the
 * code point is missing.
 */
export function icon(id: IconId, size = 16, className = ""): string {
  return drawIcon(id, { size, class: className || undefined });
}

/** The currency marks, at their real size, from the one icon set. */
export const cloutIcon = (size = 15): string => icon("clout", size, "d-ink-clout");
export const shardsIcon = (size = 15): string => icon("shards", size, "d-ink-shards");

// ---------------------------------------------------------------------------
// Markup builders
// ---------------------------------------------------------------------------

export interface RowOptions {
  id?: string;
  title: string;
  /** One line under the title. Already-escaped HTML is not accepted. */
  sub?: string;
  meta?: string;
  /** Right-hand column — a chip, a badge, a value. Raw HTML, caller's job to escape. */
  trailing?: string;
  /** Left-hand column — a crest, a reward tile, a result pip. Raw HTML. */
  leading?: string;
  unread?: boolean;
  open?: boolean;
  accent?: string;
  disabled?: boolean;
  /** Extra classes on the button. */
  className?: string;
  /** `data-*` pairs, already safe keys. */
  data?: Record<string, string>;
  /** Screen-reader-only prefix, e.g. "Unread". */
  srPrefix?: string;
}

/**
 * One list row, as a focusable button on a real material.
 *
 * `mat-panel act` is the foundation's raised surface plus its six-state
 * interaction mixin, so hover moves and lights the row, press sinks it and
 * focus-visible draws the designed double ring — none of which any of the eight
 * row types in this domain had.
 */
export function row(options: RowOptions): string {
  const classes = [
    "d-row",
    "mat-panel",
    "act",
    "d-enter",
    options.unread ? "is-unread" : "",
    options.open ? "is-open" : "",
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const data = Object.entries(options.data ?? {})
    .map(([key, value]) => ` data-${key}="${esc(value)}"`)
    .join("");

  return `
    <button type="button" class="${classes}"${data}
            ${options.id ? `id="${esc(options.id)}"` : ""}
            ${options.open ? 'aria-current="true"' : ""}
            ${options.disabled ? "disabled" : ""}
            ${options.accent ? `style="--row-accent:${esc(options.accent)}"` : ""}>
      ${options.srPrefix ? `<span class="sr-only">${esc(options.srPrefix)}</span>` : ""}
      ${options.leading ?? '<span class="d-dot" aria-hidden="true"></span>'}
      <span class="d-row-body">
        <span class="d-row-title">${esc(options.title)}</span>
        ${options.sub ? `<span class="d-row-sub">${esc(options.sub)}</span>` : ""}
        ${options.meta ? `<span class="d-row-meta">${options.meta}</span>` : ""}
      </span>
      ${options.trailing ?? "<span></span>"}
    </button>`;
}

export interface MeterOptions {
  /** 0–1. Clamped, because a claimed rank can report more XP than the rank needs. */
  value: number;
  /** Tick marks. 0 removes them — a percentage bar has no rungs. */
  steps?: number;
  colour?: string;
  /** Start the fill at zero and let CSS transition it in on the next frame. */
  animate?: boolean;
  className?: string;
}

/**
 * A groove with something in it.
 *
 * The old bars were `background: var(--accent)` on `rgba(255,255,255,0.09)` —
 * a flat ribbon lying on a flat track, one purple for all ten factions. This is
 * `.mat-well` with `.well-fill` inside it, which is module A's answer to exactly
 * that, tinted by the faction and ticked at the rank boundaries so it says how
 * many more rather than only how far.
 */
export function meter(options: MeterOptions): string {
  const value = Math.max(0, Math.min(1, Number.isFinite(options.value) ? options.value : 0));
  const steps = options.steps ?? 0;
  /*
   * `--meter-hue` travels with the fill because an *empty* track is tinted by
   * whatever will fill it — see the long note on `.d-meter` in `data.css`. A
   * gradient cannot be `color-mix`ed, so the flat colour has to be passed too.
   */
  const fill = options.colour
    ? `--meter-hue:${options.colour};--fill-meter:linear-gradient(var(--light-sweep), color-mix(in srgb, ${options.colour} 82%, #fff) 0%, ${options.colour} 58%, color-mix(in srgb, ${options.colour} 62%, #000) 100%);`
    : "";
  /* Unitless: the fill is a `scaleX`, not a width. §3a bans the width. */
  const scale = options.animate && motionEnabled() ? 0 : value;
  return `<span class="d-meter mat-well ${steps > 1 ? "" : "is-tickless"} ${options.className ?? ""}"
                style="--meter-steps:${steps};--meter-scale:${scale.toFixed(4)};${fill}"
                data-meter="${value.toFixed(4)}"
                role="progressbar" aria-valuemin="0" aria-valuemax="100"
                aria-valuenow="${Math.round(value * 100)}"><i><b class="well-fill"></b></i></span>`;
}

export interface EmptyOptions {
  icon: IconId;
  headline: string;
  body: string;
  /** A single primary action. The id is wired by the caller. */
  actionId?: string;
  actionLabel?: string;
}

/**
 * The one empty state.
 *
 * "Nothing yet." appeared three times side by side in three panels on the
 * statistics screen; match history showed an 1100×730 box containing the
 * sentence "Pick a match on the left." §5 says an empty state is a moment to be
 * charming rather than a blank grid, and module A ships `.empty` — a lit recess
 * with a place something is meant to go — so this is a thin wrapper that makes
 * the wording and rhythm identical on all twenty-three screens.
 */
export function emptyState(options: EmptyOptions): string {
  return `
    <div class="empty d-enter">
      ${drawIcon(options.icon, { size: 40 })}
      <h3 class="t-heading">${esc(options.headline)}</h3>
      <p class="t-body">${esc(options.body)}</p>
      ${
        options.actionLabel
          ? `<button type="button" class="mat-hero act r-chip" ${options.actionId ? `id="${esc(options.actionId)}"` : ""}>${esc(
              options.actionLabel
            )}</button>`
          : ""
      }
    </div>`;
}

// ---------------------------------------------------------------------------
// The form kit — module A's controls, in the shapes this domain asks for
// ---------------------------------------------------------------------------

export interface ToggleRowOptions {
  label: string;
  /** One line under the label saying what it does. Optional but nearly always wanted. */
  hint?: string;
  on: boolean;
  /** Read back off `dataset.toggle` in the caller's `change` handler. */
  key: string;
  disabled?: boolean;
}

/**
 * A labelled switch, from module A's `.switch` rather than from a fourth copy.
 *
 * Settings and Accessibility each carried their own `<button role="switch">`
 * with a `<span class="setting-knob">` inside it and a `.setting-toggle.on`
 * rule in `screens.css` — a hand-rolled 48×26 pill that fills with the flat
 * accent and translates a white circle 24px. `foundation.css` §8 ships a switch
 * that is a *lit object*: a recessed track on the well fill, a knob with its own
 * radial highlight, the hero gradient when it is on, an overshoot on the travel
 * and all six of A4's states including a disabled skin that changes the fill and
 * the border rather than the opacity. Two screens were opting out of all of it.
 *
 * It is a real `<input type="checkbox">` now, wrapped in its own `<label>`, so
 * the whole row is a hit target and the label is the accessible name without an
 * `aria-label` restating it. Space toggles it because it is a checkbox; the old
 * one needed a keydown handler nobody had written.
 */
export function toggleRow(options: ToggleRowOptions): string {
  return `
    <label class="d-set-row d-set-toggle${options.disabled ? " is-off" : ""}">
      <span class="d-set-text">
        <span class="d-set-label">${esc(options.label)}</span>
        ${options.hint ? `<span class="d-set-hint">${esc(options.hint)}</span>` : ""}
      </span>
      <input type="checkbox" class="switch" data-toggle="${esc(options.key)}"
             ${options.on ? "checked" : ""} ${options.disabled ? "disabled" : ""} />
    </label>`;
}

export interface SegmentOptions<T extends string> {
  label: string;
  hint?: string;
  /** Read back off `dataset.key`; the chosen option lands in `dataset.value`. */
  key: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  /** Set when the values are numbers, so the caller can `Number()` them safely. */
  numeric?: boolean;
}

/**
 * A segmented picker: one recessed track, N raised chips, one lit.
 *
 * `screens.css`'s `.setting-choices` was `background: rgba(0,0,0,0.35)` with
 * `.setting-choice.active { background: var(--accent); color: #fff }` — a flat
 * fill on a flat fill, no light source, no rim, no press, and a `transition:
 * all` that includes the properties §3a bans. It is also the third selection
 * treatment in the domain, after `.d-chip` and the row's lit left edge.
 *
 * This is `.mat-well` for the track and `.mat-chip act` for the segments, which
 * is the same pair the meter uses and the same interaction mixin every other
 * clickable object in the game wears. The selected one takes the hero fill, so
 * "on" is the brightest mass in the row rather than a different flat purple.
 */
export function segmented<T extends string>(options: SegmentOptions<T>): string {
  return `
    <div class="d-set-row d-set-choice">
      <span class="d-set-text">
        <span class="d-set-label">${esc(options.label)}</span>
        ${options.hint ? `<span class="d-set-hint">${esc(options.hint)}</span>` : ""}
      </span>
      <div class="d-seg mat-well" role="radiogroup" aria-label="${esc(options.label)}">
        ${options.options
          .map(
            (option) => `
              <button type="button" class="d-seg-opt mat-chip act${option.value === options.value ? " is-on" : ""}"
                      role="radio" aria-checked="${option.value === options.value}"
                      data-key="${esc(options.key)}"
                      data-${options.numeric ? "number" : "value"}="${esc(option.value)}"
                      ${option.hint ? `title="${esc(option.hint)}"` : ""}>${esc(option.label)}</button>`
          )
          .join("")}
      </div>
    </div>`;
}

export interface ChipOptions {
  label: string;
  value: string;
  active: boolean;
  count?: number;
  /** The attribute the caller reads back in its click handler. */
  key?: string;
  accent?: string;
}

/** One chip component, one active state, everywhere in the domain. */
export function chip(options: ChipOptions): string {
  return `<button type="button" class="d-chip mat-chip act" role="radio"
                  aria-checked="${options.active}" aria-pressed="${options.active}"
                  data-${options.key ?? "value"}="${esc(options.value)}"
                  ${options.accent ? `style="--row-accent:${esc(options.accent)}"` : ""}>
            ${esc(options.label)}
            ${options.count === undefined ? "" : `<span class="d-chip-count num">${fmtCount(options.count)}</span>`}
          </button>`;
}

/**
 * A crest, ready to drop into a row or a tile.
 *
 * **The drawing is always the same size and CSS does the scaling.** That is not
 * laziness, it is the whole performance story of this module: a crest keyed by
 * its display size is a *different cache entry* per screen, so the profile's
 * 34px track marks, the mastery grid's 52px tiles, the story rows' 46px and the
 * match-history list's 34px were four full sets of ten drawings rather than one.
 * Measured cold on the software rasteriser, one set costs ~110ms of blocked main
 * thread; four sets is the difference between a cascade that plays and a screen
 * that hitches on arrival. One canonical size, drawn once per faction per
 * session, scaled by the browser's own bilinear filter — which at these sizes is
 * indistinguishable from redrawing.
 *
 * 96, and the number is a measurement rather than a round figure. The largest
 * consumer is the Mastery detail header at 64, so 96 is 1.5x it — enough that a
 * standard display never upscales and a retina one softens a flat hexagonal
 * plate with one emblem on it by an amount no reviewer has been able to find in
 * a 1:1 crop. It was 128, which is 2x the largest consumer and looked like the
 * safe choice; measured, ten of them cost 137ms of blocked main thread against
 * 38ms at 96, and that difference lands squarely inside the frame the Mastery
 * grid's entrance cascade is trying to play on.
 */
const CREST_PX = 96;

/** The rank crest, likewise: one drawing per (tier, colour), scaled by CSS. */
export const RANK_PX = 176;

/**
 * ...and a second canonical rank size, for the marks that are worn small.
 *
 * The one-size rule above is about *cache keys*, and it still holds. What it does
 * not license is drawing a 176px plate for a 30px chip: the Mastery grid renders
 * ten of them at 30px in the tile footer, which is 34 times the pixels the screen
 * can show, and every one of those pixels is paid for twice — once rasterising
 * and once in the PNG encode, which is the expensive half. Two sizes, chosen by
 * what wears the mark rather than by each caller's taste, keeps the key count at
 * two per (tier, colour) and takes the grid's encode down by an order of
 * magnitude.
 *
 * 64 because the largest small consumer is the match-history header at 56, which
 * is 112 on a 2x display — and a crest is a plate with a gem on it rather than
 * fine linework, so a half-pixel of bilinear softening at 2x costs nothing a
 * viewer can find.
 */
export const RANK_MARK_PX = 64;

/**
 * A reward, drawn as the object it is. One canonical size, for the same reason —
 * and 88 rather than 112 for the same measurement, the largest consumer being a
 * milestone rung at 54.
 */
const REWARD_PX = 88;

/**
 * A wearable cosmetic, drawn as the object it is. One canonical size, scaled.
 *
 * The locker asks for it at 40px and the picker at 34px; keying the drawing by
 * either would be two full sets of five for a difference no eye can resolve. See
 * `CREST_PX` for the measurement that argument comes from.
 */
const SWATCH_PX = 96;

/**
 * An event currency's struck token, at a display size.
 *
 * One drawing per (shape, accent) — the events hub wants the same mark at 15px
 * beside a balance, 18px on a mission reward and 34px inside the countdown ring,
 * and keying by display size would draw it three times for no visible gain. See
 * `CREST_PX` for the measurement that argument comes from.
 */
const TOKEN_PX = 96;

// ---------------------------------------------------------------------------
// Deferred art
// ---------------------------------------------------------------------------

/**
 * Why the pictures are no longer drawn while the markup is being written.
 *
 * Every generator in `art.ts` ends in `canvas.toDataURL("image/png")`, which is
 * a synchronous rasterise-and-encode. Inlining the result into a `style`
 * attribute means the whole set is produced *inside* the `innerHTML` assignment,
 * on the one frame the screen is being mounted — which is the same frame the
 * entrance cascade is supposed to start on.
 *
 * Measured with a `PerformanceObserver` on `longtask`, navigating lobby → route
 * with a cold cache:
 *
 *     mastery ....... 512ms of blocked main thread
 *     events ........ 385ms
 *     news .......... 277ms (59 + 218)
 *     profile ....... 127ms
 *     stats .......... 54ms
 *
 * Half a second of frozen compositor on arrival at the Mastery grid. The cascade
 * was correct — thirteen `d-rise` starts spread across 453ms, confirmed by
 * `animationstart` — and a player saw none of it, because nothing painted until
 * it was over. §9's "a beautiful effect that drops frames is a bug" and §3a's
 * "no transition drops frames" both land on this, and it is invisible in a still.
 *
 * So a mark now ships as a **recipe** — `data-art="crest|idols|1"` — and
 * `paintArt` resolves it after the first frame, in chunks with a time budget, on
 * the shared rAF. The generators and their memo are unchanged: a warm cache
 * resolves the whole screen in well under a millisecond and nobody sees a
 * pending state at all; a cold one fills the marks in over a few frames while
 * the cascade plays, which is loading that is part of the world rather than a
 * hitch.
 *
 * The separator is `|` because no argument here can contain one — they are
 * slugs, hex colours and integers — and the whole payload goes through `esc`.
 */
const ART_RECIPES: Record<string, { prop: string; make: (args: readonly string[]) => string }> = {
  crest: {
    prop: "--crest",
    make: ([factionId, lit]) => crest(factionId ?? "", { size: CREST_PX, lit: lit === "1" ? 1 : 0.45 }),
  },
  reward: {
    prop: "--reward-art",
    make: ([kind, colour]) => rewardTile((kind ?? "locked") as RewardKind, colour ?? "#6a6382", REWARD_PX),
  },
  swatch: {
    prop: "--swatch",
    make: ([kind, colour, emblem, lit]) =>
      cosmeticSwatch(
        (kind ?? "badge") as SwatchKind,
        colour ?? "#8d86a8",
        (emblem ?? "diamond") as EmblemShape,
        SWATCH_PX,
        lit === "1"
      ),
  },
  token: {
    prop: "--token",
    make: ([emblem, accent]) => token((emblem ?? "diamond") as EmblemShape, accent ?? "#b56cff", TOKEN_PX),
  },
  rank: {
    prop: "--rank-art",
    make: ([tier, tiers, colour, px]) =>
      rankCrest({
        size: Number(px) || RANK_PX,
        tier: Number(tier) || 0,
        tiers: Number(tiers) || 20,
        colour: colour || undefined,
      }),
  },
  key: {
    prop: "--key-art",
    make: ([accent, w, h, seed, emblem, radius, alpha]) =>
      banner(accent ?? "#b56cff", {
        width: Number(w) || 640,
        height: Number(h) || 360,
        seed: seed ?? "",
        emblem: (emblem || "diamond") as EmblemShape,
        radius: Number(radius) || 0,
        patternAlpha: alpha === undefined || alpha === "" ? 0.06 : Number(alpha),
      }),
  },
  ladder: {
    // `--key-art` rather than a name of its own: a ladder plate is key art, and
    // two consumers already mount it on `.d-key`. One property means a recipe can
    // be moved between elements without also moving a custom property nobody
    // remembers is load-bearing — which is exactly the bug that shipped a blank
    // top half on the empty Match History plate.
    prop: "--key-art",
    make: ([w, h, accent]) => ladderPlate(Number(w) || 960, Number(h) || 320, accent || "#b56cff"),
  },
};

/**
 * The attribute form, for a picture that lands on an element a screen already
 * owns — an event banner on its own header, the ladder plate on a panel.
 */
export function artAttr(recipe: keyof typeof ART_RECIPES, args: readonly (string | number)[]): string {
  return `data-art="${esc([recipe, ...args.map(String)].join("|"))}"`;
}

/** The element form, for the marks that are their own little object. */
function artMark(
  className: string,
  sizeVar: string,
  size: number,
  recipe: keyof typeof ART_RECIPES,
  args: readonly (string | number)[]
): string {
  return `<span class="${className} d-art" aria-hidden="true" style="${sizeVar}:${size}px" ${artAttr(
    recipe,
    args
  )}></span>`;
}

/** Two lit states, not a continuum — see `CREST_PX` for why the key matters. */
export function crestMark(factionId: string, size = 44, lit = 1): string {
  return artMark("d-crest", "--crest-size", size, "crest", [factionId, lit >= 0.9 ? 1 : 0]);
}

export function rewardMark(kind: RewardKind, colour: string, size = 44): string {
  return artMark("d-reward-tile", "--reward-size", size, "reward", [kind, colour]);
}

export function swatchMark(kind: SwatchKind, colour: string, emblem: EmblemShape, size = 40, lit = true): string {
  return artMark(`d-swatch${lit ? "" : " is-dim"}`, "--swatch-size", size, "swatch", [
    kind,
    colour,
    emblem,
    lit ? 1 : 0,
  ]);
}

export function tokenMark(emblem: EmblemShape, accent: string, size = 16): string {
  return artMark("d-token", "--token-size", size, "token", [emblem, accent]);
}

/**
 * The rank object at a display size, drawn from whichever canonical plate suits.
 *
 * `RANK_MARK_PX` under 64 display pixels and `RANK_PX` above it, so the profile's
 * 96px medallion and the Mastery grid's 30px chip do not share a 176px encode.
 * The value inside it — the rank number — is the caller's, because it is type
 * rather than art and belongs in the DOM where a screen reader can reach it.
 */
export function rankMark(
  options: { tier: number; tiers: number; colour?: string },
  size = 44,
  inner = ""
): string {
  const px = size > 64 ? RANK_PX : RANK_MARK_PX;
  return `<span class="d-rank d-art" style="--rank-size:${size}px" ${artAttr("rank", [
    options.tier,
    options.tiers,
    options.colour ?? "",
    px,
  ])}>${inner}</span>`;
}

/**
 * Resolve every pending recipe under `root`, off the frame that mounted it.
 *
 * The drain lives in `deferPaint` below and so does the reasoning for its two
 * gates — one mark per frame, and not until the transition has landed. This is
 * only the recipe half: turn `data-art="crest|idols|1"` into a custom property
 * holding a `data:` URI.
 */
export function paintArt(root: ParentNode): () => void {
  const queue = [...root.querySelectorAll<HTMLElement>("[data-art]")];
  if (queue.length === 0) return () => {};

  const apply = (node: HTMLElement): void => {
    const payload = node.dataset["art"];
    if (payload === undefined) return;
    node.removeAttribute("data-art");
    const [name, ...args] = payload.split("|");
    const recipe = name === undefined ? undefined : ART_RECIPES[name];
    if (!recipe) return;
    let url = "";
    try {
      url = recipe.make(args);
    } catch {
      // A picture is decoration. A malformed payload leaves the socket empty
      // rather than taking the screen it decorates down with it.
      return;
    }
    if (url === "") return;
    node.style.setProperty(recipe.prop, `url('${url}')`);
  };

  return deferPaint(queue, apply);
}

/**
 * Every expensive picture in the domain, painted where it does no harm.
 *
 * Every generator in `art.ts` ends in a synchronous rasterise-and-encode, and
 * `renderCardToCanvas` is heavier still. Done inline, the whole set is produced
 * *inside* the `innerHTML` assignment — on the one frame the screen is being
 * mounted, which is the same frame the entrance cascade and the shell's descend
 * are supposed to start on. Measured with a `PerformanceObserver` on `longtask`:
 *
 *     tour ......... 727 + 202 + 187 + 106 = 1,222ms, first animation at t=1147ms
 *     mastery ...... 512ms
 *     events ....... 385ms
 *     news ......... 277ms
 *     profile ...... 127ms
 *
 * A second of frozen compositor on arrival at the Grand Tour. The cascade was
 * correct — the starts were spread across 453ms, confirmed by `animationstart` —
 * and a player saw none of it, because nothing painted until it was over.
 *
 * Three gates, and the domain needed all three.
 *
 * **One item per frame.** A time budget alone is not enough, because it measures
 * the generator and not what the browser does afterwards: setting a
 * `background-image` to a fresh `data:` URI makes the engine base64-decode and
 * PNG-decode the bitmap during the next style-and-paint pass, and that work is
 * attributed to the frame rather than to the loop that queued it. Measured with
 * a 4ms budget alone, twenty-five marks resolved in three bites and the middle
 * one produced a **252ms** long task.
 *
 * **Not until the transition has landed.** Spreading the queue fixed the shape
 * of the cost and not its placement: the first drawing still arrived on frame
 * three, inside §3a's 260–420ms window, and a 135ms encode there is a dropped
 * descend. `after` defaults to that window.
 *
 * **Only what is on screen.** Six of the Grand Tour's ten stops are visible at
 * 1600×900, so four of its ten card renders are work for a scroll position
 * nobody is at. An `IntersectionObserver` with 400px of margin paints the rest
 * as the list arrives at them.
 *
 * Returns a teardown, because these screens re-render on every click and a queue
 * still draining into a detached tree is wasted main thread at best.
 */
export function deferPaint<T extends HTMLElement>(
  nodes: Iterable<T>,
  paint: (node: T) => void,
  options: { after?: number } = {}
): () => void {
  const all = [...nodes];
  if (all.length === 0) return () => {};

  const ready: T[] = [];
  let cancelled = false;
  let frame = 0;
  let draining = false;

  const drain = (): void => {
    frame = 0;
    if (cancelled) return;
    const node = ready.shift();
    if (node && node.isConnected) {
      try {
        paint(node);
        node.classList.add("d-art-in");
      } catch {
        // A picture is decoration; a broken one leaves its socket empty rather
        // than taking the screen it decorates down with it.
      }
    }
    if (ready.length > 0) frame = requestAnimationFrame(drain);
    else draining = false;
  };

  const kick = (): void => {
    if (cancelled || draining || ready.length === 0) return;
    draining = true;
    frame = requestAnimationFrame(drain);
  };

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer?.unobserve(entry.target);
              ready.push(entry.target as T);
            }
            if (started) kick();
          },
          { rootMargin: "400px" }
        )
      : null;

  let started = false;
  const begin = (): void => {
    if (cancelled) return;
    started = true;
    if (!observer) ready.push(...all);
    kick();
  };

  if (observer) for (const node of all) observer.observe(node);
  const timer = setTimeout(() => requestAnimationFrame(begin), options.after ?? DUR.ui);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * Nothing. Deliberately, and this comment is the whole of what is left.
 *
 * This function used to return the seven layers of the room plus a grain plane
 * over the content, and eleven screens called it. That is exactly eleven more
 * than the number of screens that should have to. Measured with
 * `scripts/_w7rw_probe.mjs` — the calibrated one, whose metric reproduces the
 * Hearthstone reference at n=203, min 0.501, median 1.713 — the eleven callers
 * idled at 0.88–1.89 and the thirty-eight non-callers at 0.18–0.71, with minima
 * down at 0.067. The room was real; the opt-in was the bug. A screen that is
 * alive because somebody remembered a call is a screen that will be dead the
 * next time somebody does not, and the front door was already one of them.
 *
 * So the room moved to the two places a screen cannot avoid: the layers are in
 * `theme/transitions.css` §1.9, which `atmosphere.ts` imports at boot and which
 * is therefore loaded on every route rather than only on the twenty-three that
 * pull in this file; and the element is put there by `shell.ts::dressScreen`,
 * on the detached tree at mount, next to `markCascade`. The per-route accent
 * comes from the same `ROOMS` table that already decides which of the ten
 * lighting setups the world behind the screen is in, so the Collection and the
 * Deck Builder are lit as one workshop without either of them saying so.
 *
 * The signature survives, returning `""`, for one reason: the eleven call sites
 * live in files owned by other people this wave, and a function that quietly
 * emits nothing is a smaller and much more reviewable change than eleven
 * simultaneous edits to eleven screens. It is a deprecation, not a design —
 * `tests/every-screen-is-a-room.test.ts` fails if a *twelfth* call appears, so
 * the next person to reach for it is told where the room actually lives instead
 * of finding out from a screenshot.
 */
export function room(_options: { accent?: string; lit?: number } = {}): string {
  return "";
}

/**
 * A card standing against the rail's wall.
 *
 * `<section>` rather than `<div>`, and that is not pedantry about landmarks: the
 * rail itself is a `<section>` so `markCascade` indexes it as a body container
 * and staggers what is in it, and a rail of `<div>`s would still stagger but a
 * rail of sections reads correctly to a screen reader that is listing regions.
 * The label is optional because two of the eleven rails hold a single hero
 * action and a heading over one button is furniture nobody asked for.
 */
export function railCard(options: { label?: string; body: string; className?: string; tone?: "hero" | "panel" }): string {
  const material = options.tone === "hero" ? "mat-hero" : "mat-panel";
  return `<section class="d-rail-card ${material} d-enter ${options.className ?? ""}">
      ${options.label ? `<h2 class="d-rail-label">${esc(options.label)}</h2>` : ""}
      ${options.body}
    </section>`;
}

// ---------------------------------------------------------------------------
// Behaviours
// ---------------------------------------------------------------------------

/**
 * Give a freshly-rendered list its cascade.
 *
 * Called after `innerHTML`, on the container. `stagger` is module D's and is a
 * no-op under reduced motion; the keyframe it feeds is in `data.css` §8.
 */
export function enter(root: ParentNode, selector = ".d-enter", step = 38): () => void {
  stagger(root.querySelectorAll(selector), { step, max: DUR.setpiece });
  // Every screen in the domain already calls this after writing its markup, so
  // it is also the one place the deferred pictures can be kicked off without
  // twenty-three screens each having to remember. The teardown is returned for
  // the screens that re-render often enough to care; most simply drop it, and a
  // queue whose nodes are all detached costs nothing but its own observer.
  return paintArt(root);
}

/**
 * Count every `[data-count]` up to its value, and run every meter in.
 *
 * §3a: "Numbers count up. Currency, XP, records, mission progress — animated to
 * their value, not printed." The meters are here too because both are the same
 * idea and both have to happen on the frame *after* the markup lands, or the
 * transition has nothing to transition from.
 */
export function countUp(root: ParentNode): void {
  const numbers = root.querySelectorAll<HTMLElement>("[data-count]");
  const meters = root.querySelectorAll<HTMLElement>("[data-meter]");
  if (numbers.length === 0 && meters.length === 0) return;

  if (!motionEnabled()) {
    for (const node of numbers) node.textContent = fmtNum(Number(node.dataset["count"] ?? 0));
    for (const node of meters) node.style.setProperty("--meter-scale", node.dataset["meter"] ?? "0");
    return;
  }

  for (const node of numbers) node.textContent = fmtNum(0);
  requestAnimationFrame(() => {
    for (const node of numbers) {
      const target = Number(node.dataset["count"] ?? 0);
      tickerTo(node, Number.isFinite(target) ? target : 0, DUR.setpiece);
    }
    for (const node of meters) node.style.setProperty("--meter-scale", node.dataset["meter"] ?? "0");
  });
}

/**
 * Roving tabindex over a list of rows.
 *
 * Twenty ladder rungs as twenty tab stops is technically accessible and
 * practically unusable — a keyboard player has to press Tab twenty times to
 * leave the list. One tab stop, arrows to move, Home/End to jump: the pattern
 * every reference game's controller navigation implements and the one the WAI
 * listing pattern asks for.
 *
 * Returns a teardown, because these screens re-render on every interaction and a
 * listener on a detached node is a leak nobody ever notices.
 */
export function rovingList(container: HTMLElement | null, selector = ".d-row, .d-tile"): () => void {
  if (!container) return () => {};
  const items = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(selector)].filter((n) => !n.hidden);

  const sync = (): void => {
    const list = items();
    if (list.length === 0) return;
    const current = list.findIndex((node) => node.getAttribute("aria-current") === "true");
    const focusIndex = current >= 0 ? current : 0;
    list.forEach((node, i) => {
      node.tabIndex = i === focusIndex ? 0 : -1;
    });
  };
  sync();

  const onKey = (event: KeyboardEvent): void => {
    const list = items();
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const at = active ? list.indexOf(active) : -1;
    if (at === -1) return;

    let next = at;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (at + 1) % list.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (at - 1 + list.length) % list.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = list.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    for (const node of list) node.tabIndex = -1;
    list[next]!.tabIndex = 0;
    list[next]!.focus();
  };

  container.addEventListener("keydown", onKey);
  return () => container.removeEventListener("keydown", onKey);
}

/**
 * Draw a canvas at the width of the box it is going into — which is not the
 * width it had when the markup was written.
 *
 * `shell.ts` builds a screen on a **detached** tree, so `host.clientWidth` at
 * render time is `0` and every caller's `|| 760` fallback wins. Measured on
 * `#stats` with a 34-match history:
 *
 *     viewport      host    drawn   short by
 *     1600×900      1064      760        304
 *     1280×720      1073      760        313
 *     844×390        736      760        -24  (scaled down, i.e. blurred)
 *
 * The win-rate curve is the centrepiece of the Statistics screen and it was
 * drawn to a constant on every desktop, leaving 300px of empty panel to its
 * right, and *upscaled* on a phone so its labels softened. A canvas laid out by
 * CSS and drawn at a guessed width is the classic way to ship a blurry chart,
 * and this domain was shipping it twice on one screen.
 *
 * So the draw waits for a width. `ResizeObserver` fires once as soon as the host
 * is connected and laid out, and again whenever the box changes — which also
 * makes both charts respond to the window, to `--ui-scale`, and to the panel
 * growing when a filter chip wraps. The redraw is gated on a *changed* integer
 * width so a scroll-driven sub-pixel report cannot start a redraw loop.
 *
 * Returns a teardown; these screens re-render on every click.
 */
export function drawSized(
  host: HTMLElement | null,
  make: (width: number) => HTMLCanvasElement | null
): () => void {
  if (!host) return () => {};

  let last = -1;
  const paint = (): void => {
    const width = Math.round(host.clientWidth);
    if (width < 1 || width === last) return;
    last = width;
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = make(width);
    } catch {
      // A chart is decoration for a screen that also prints every figure as
      // text. A generator that throws leaves the socket empty rather than
      // taking the panel down.
      return;
    }
    if (canvas) host.replaceChildren(canvas);
  };

  if (typeof ResizeObserver !== "function") {
    // No observer: draw on the next frame, by which time the tree is attached.
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }
  const observer = new ResizeObserver(paint);
  observer.observe(host);
  return () => observer.disconnect();
}

/**
 * Switch the top and bottom fade of a scrolling pane on and off.
 *
 * A permanent bottom fade dims the last line of a list that has already ended,
 * which is worse than no fade: it says "there is more" when there is not. This
 * watches the scroll position and writes `--fade-a` / `--fade-b`, so the ramp
 * appears exactly when the content really does continue.
 */
export function fadeOnScroll(pane: HTMLElement | null): () => void {
  if (!pane) return () => {};
  pane.classList.add("d-fade");
  const update = (): void => {
    const overflow = pane.scrollHeight - pane.clientHeight;
    if (overflow <= 2) {
      pane.style.setProperty("--fade-a", "1");
      pane.style.setProperty("--fade-b", "1");
      return;
    }
    pane.style.setProperty("--fade-a", pane.scrollTop > 4 ? "0" : "1");
    pane.style.setProperty("--fade-b", pane.scrollTop < overflow - 4 ? "0" : "1");
  };
  update();
  pane.addEventListener("scroll", update, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
  observer?.observe(pane);
  return () => {
    pane.removeEventListener("scroll", update);
    observer?.disconnect();
  };
}

/**
 * Everything a screen has to undo, collected.
 *
 * These screens re-render by replacing `innerHTML`, so every helper above that
 * attaches a listener has to be torn down first or the same screen accumulates
 * one more of each per click.
 */
export function disposeBag(): { add: (teardown: () => void) => void; run: () => void } {
  let teardowns: (() => void)[] = [];
  return {
    add: (teardown) => teardowns.push(teardown),
    run: () => {
      for (const teardown of teardowns) teardown();
      teardowns = [];
    },
  };
}
