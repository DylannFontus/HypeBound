/**
 * Does the interface FIT — at every format anyone plays this in?
 *
 * This began as the responsive check for known gap 7 ("mobile is implemented and
 * nothing has ever confirmed it at a phone's real dimensions") and it still is
 * that. What changed is the shape of the question. The game now ships twice: a
 * browser build whose window is whatever the player's browser is, and a Tauri
 * `.exe` whose window the player **drags to any size they like**, including
 * fullscreen on a 21:9 monitor. "Responsive" stopped meaning "does it work on a
 * phone" and started meaning "is there any window shape in which a control is
 * unreachable, an image is squashed, or a word is snapped in half".
 *
 * So the four phone-shaped viewports became a **matrix**: eleven window shapes
 * from a 844x390 phone in landscape to a 3440x1440 ultrawide, crossed with the
 * three interface sizes an accessibility user actually picks (100%, 140%, 160%).
 * One instrument, one report. Two sweeps cannot disagree if there is only one.
 *
 * ## Why a screenshot is not allowed to be the evidence
 *
 * Three unreachable controls have been found in this project — the lobby's Inbox
 * badge, the deck builder's Save Deck, and the mulligan's Confirm — and **every
 * one of them rendered perfectly**. They were past an edge. A screenshot is a
 * photograph of the viewport, so the one thing it structurally cannot show you
 * is the thing that is outside the viewport. Every check below is a rectangle
 * enumeration, and the screenshots this writes are for a human to glance at,
 * never for the pass/fail.
 *
 * The same trap has a second mouth: `page.click()` calls
 * `scrollIntoViewIfNeeded` first, so Playwright reached the mulligan's Confirm
 * button for nine waves while a finger could not. Nothing here clicks to prove
 * reachability; it asks the geometry.
 *
 * ## The five questions, and why each is phrased the way it is
 *
 * 1. **Nothing scrolls sideways.** The single most common responsive failure and
 *    the one that makes a layout read as broken rather than cramped.
 * 2. **No control is unreachable.** Not "is it clipped" — clipping is often a
 *    list. The question is whether anything in the ancestor chain can *scroll*
 *    to the part being cut. `#app` is `position: fixed; overflow: hidden`, so a
 *    control past a screen's edge with no scroller above it is gone for good.
 * 3. **No control is buried.** A rectangle intersection is the wrong test — the
 *    hand deliberately fans, and overlapping cards are the design. The right
 *    test is functional: hit-test a grid of points inside the control's own box
 *    and ask whether *any* of them returns the control. If none does, the player
 *    cannot click it, whatever it looks like.
 * 4. **No image is stretched or squashed.** Compare the aspect the source
 *    actually has against the aspect it is being painted at — for `<img>`
 *    through `object-fit`, for CSS backgrounds through `background-size`, and
 *    for a `<canvas>` by comparing its backing store to its CSS box. Card art is
 *    512x680 and boards are 16:9; 21:9 is where a full-bleed layer distorts.
 * 5. **Text neither overflows nor snaps mid-word.** Ink cut by a box nothing in
 *    the chain can scroll is the overflow half — forgiving the two truncations
 *    that are stated design decisions, `text-overflow: ellipsis` and
 *    `-webkit-line-clamp`. A word whose Range spans two line boxes is the other
 *    half; "Achieve/ments" is that measurement.
 *
 * Plus the two rules that are about the pointer rather than the window: touch
 * targets clear 44 CSS pixels wherever a finger is the pointer, and portrait
 * raises the rotate overlay on a phone and — just as importantly — does *not* on
 * a tablet held upright.
 *
 * ## The control, because fourteen instruments have lied here
 *
 * Every filter below removes rows, and the failure mode of a de-noising pass is
 * that it de-noises the finding. So `calibrate()` runs before the sweep and
 * plants fourteen objects on the live lobby, then drops a sheet over them for a
 * second pass — **six** the sweep MUST report and **nine** it MUST NOT:
 *
 *   must see    a `<button>` positioned past the bottom of an `overflow:hidden`
 *               box — the mulligan Confirm's exact geometry
 *   must see    a button completely covered by an opaque plate
 *   must see    a 3:2 photograph painted into a 1:3 box with `object-fit: fill`
 *   must see    a `<canvas>` painted with `object-fit: fill` into a wrong box
 *   must see    a long word forced to break inside a narrow box
 *   must see    a sentence half-eaten by an `overflow: hidden` box
 *   must NOT    a screen-reader-only span (1x1, `clip: rect(0 0 0 0)`)
 *   must NOT    a button under a plate that is `pointer-events: none`
 *   must NOT    a button scrolled out of the right of a horizontal rail
 *   must NOT    the same photograph painted with `object-fit: cover`
 *   must NOT    the same canvas painted with `object-fit: cover`
 *   must NOT    a correctly-proportioned canvas inside a rotated parent
 *   must NOT    the same sentence with `text-overflow: ellipsis`
 *   must NOT    the same sentence inside a `-webkit-line-clamp`
 *   must NOT    a button under a full-window modal sheet — the second pass,
 *               because a sheet covers the other fourteen objects too, and the
 *               pass has to prove it still saw something before its silence
 *               counts as a pass
 *
 * Any disagreement stops the run with exit code 3 rather than publishing a clean
 * sheet. A quiet sweep is only good news if it has been shown, in the same run
 * and through the same code path, that it can still fail.
 *
 * **Four of those decoys are there because the first version of this sweep
 * failed them**, and each one would have been the fifteenth instrument to lie
 * in this project:
 *
 *   - Its hit-test grid was clamped with `Math.max(clip.left, box.left)`, which
 *     lands *inside the next control along* when the box is entirely past the
 *     clip — so five of the lobby's six destinations, sitting in the
 *     phone-landscape nav rail waiting to be scrolled to, were reported as
 *     "fully covered by Missions" at every touch viewport. 1,200 wrong rows.
 *   - It read `object-fit` on `<img>` and not on `<canvas>`, which is a replaced
 *     element and honours it identically — so the deck slots' cover art, a
 *     440x240 canvas cropped into a 274x165 box by an explicit
 *     `object-fit: cover`, was filed as a 1.1x squash.
 *   - It had no idea what a modal is, so the board's End Turn, both ability
 *     buttons, Concede, Emotes and Settings were buried controls on every route
 *     that opens a mulligan.
 *   - It took the aspect of an image from `getBoundingClientRect`, which is the
 *     box **after** transforms — so the hand's fan, which rotates every card,
 *     turned four perfectly-proportioned 76.4x101.4 cards into 101x119 boxes
 *     and reported a 1.14x squash on each.
 *
 * All four were caught by reading the report and disbelieving it, and a fifth —
 * a mode card reported as 7px out of its own container on four desktop formats
 * because Playwright had parked the mouse on it and it was in its hover state —
 * is answered by `settleEntrance` moving the pointer to the corner of the window
 * before every measurement. They are decoys now, so the next person does not
 * have to find them again.
 *
 * ## The settle, and the sixth instrument that lied
 *
 * This used to measure 250ms after the screen root appeared, which was fine
 * until the visual overhaul gave every screen the staggered entrance §3a of the
 * bar demands. `getBoundingClientRect` returns the *visual* box, so a row that
 * arrives from `scale: 0.985` scales its whole subtree — and a button sitting
 * exactly on the 44px floor measures 43.4 and is rounded to 43. Eight controls
 * on `#missions` and three on `#shop` were reported as under-size targets whose
 * resting boxes are 390x44; the reading was a photograph of an animation, not
 * of a control. Waiting cannot hide a genuine failure, because a `min-height`
 * that is too small is too small at rest as well.
 *
 * So it waits for the entrance to finish rather than for a fixed number of
 * milliseconds. `iterations !== Infinity` is the load-bearing half: the idle
 * layer — ambient drift, specular crawl, the breathing hero — never stops, and
 * waiting for zero animations would simply time out on every screen.
 *
 * ## The interface size is set by CLICKING, never by writing the property
 *
 * `--ui-scale` is written onto the root by `applySettings`, but the setting also
 * drives JS-side layout decisions, so a hand-set custom property photographs a
 * state the game never enters. That trap is recorded in `_ic3_scale.mjs` and it
 * stays recorded here: the scale is chosen through the accessibility screen's
 * own segmented control, and the root is then read back to confirm the click
 * landed. A scale that does not read back stops the run.
 *
 * ## Usage
 *
 *   node scripts/verify-mobile.mjs
 *   node scripts/verify-mobile.mjs --quick            (100% only, six viewports)
 *   node scripts/verify-mobile.mjs --viewports 3440x1440,844x390
 *   node scripts/verify-mobile.mjs --scales 160
 *   node scripts/verify-mobile.mjs --routes lobby,deckbuilder
 *   node scripts/verify-mobile.mjs --engine edge      (the .exe's own engine)
 *   node scripts/verify-mobile.mjs --injectcss <file>  (prove it can still fail)
 */
import { chromium, devices } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://localhost:5173";
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

/**
 * Which engine, and why it is a flag rather than a constant.
 *
 * The desktop build does not ship a browser: Tauri renders in **WebView2**,
 * which is the Chromium that Edge ships — `src-tauri/tauri.conf.json5` says so
 * in as many words, and says it was chosen over Electron precisely so that the
 * engine every visual measurement in this project runs against is the engine
 * the `.exe` runs on. That is a claim worth being able to *check* rather than
 * repeat, so `--engine edge` points this sweep at `msedge.exe`: a disagreement
 * between the two runs is a desktop-only layout bug that a browser-only sweep
 * could never see, and agreement is the evidence for the claim.
 */
const ENGINES = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
};
const ENGINE = String(arg("engine", "chrome")).toLowerCase();
const CHROME = [ENGINES[ENGINE], ...Object.values(ENGINES)].find((p) => p && existsSync(p));
const has = (name) => process.argv.includes(`--${name}`);

/**
 * Eleven window shapes, chosen to bracket what exists rather than to be pretty
 * numbers. `touch` is not decoration: the 44px floor is a **touch** rule and the
 * rotate overlay is a **phone** rule, and applying either to a desktop window
 * produces a confident wrong answer — a 44px filter chip on a mouse is a third
 * taller for nobody's benefit, and a rotate prompt on a window somebody chose
 * the shape of is a wall in front of a working game.
 */
const ALL_VIEWPORTS = [
  { name: "phone landscape", width: 844, height: 390, touch: true, dpr: 3 },
  { name: "iPhone SE landscape", width: 667, height: 375, touch: true, dpr: 2 },
  { name: "Pixel 7 landscape", width: 915, height: 412, touch: true, dpr: 2.6 },
  { name: "iPad landscape", width: 1080, height: 810, touch: true, dpr: 2 },
  /**
   * iPad Pro 11-inch, in Safari rather than standalone.
   *
   * 2420x1668 physical at 2x is 1210x834 points, and Safari's own chrome takes
   * roughly 74 of them, so the page gets about 1210x760. That is a viewport this
   * set did not cover: wider than the 1080 iPad and *shorter* than the 810 one,
   * which is the combination that catches a layout sized from vh. It is also a
   * device somebody actually intends to play this on, which the generic entries
   * above are not.
   */
  { name: "iPad Pro 11in landscape, Safari chrome", width: 1210, height: 760, touch: true, dpr: 2 },
  /**
   * The hard floor §9 of the bar names — and, exactly, the smallest window the
   * desktop build can ever be: `src-tauri/tauri.conf.json5` sets `minWidth:
   * 1280, minHeight: 720`, so this row *is* the bottom of the `.exe` matrix
   * rather than an approximation of it. Everything below this line is a browser
   * on a phone or a tablet; everything from here up is also a window somebody
   * can drag HYPEBOUND.exe to.
   */
  { name: "small laptop", width: 1280, height: 720, touch: false, dpr: 1 },
  /** The commonest laptop panel in the world, and 48px shorter than the floor. */
  { name: "common laptop", width: 1366, height: 768, touch: false, dpr: 1 },
  { name: "desktop 900p", width: 1600, height: 900, touch: false, dpr: 1 },
  { name: "desktop 1080p", width: 1920, height: 1080, touch: false, dpr: 1 },
  { name: "desktop 1440p", width: 2560, height: 1440, touch: false, dpr: 1 },
  /**
   * 21:9. This is the row the desktop build added: an `.exe` window dragged onto
   * an ultrawide is a shape no browser-only project ever had to survive, and it
   * is where a centred column strands and a full-bleed image distorts.
   */
  { name: "ultrawide 21:9", width: 3440, height: 1440, touch: false, dpr: 1 },
];

/** §13's target size, and the one every platform guideline agrees on. */
const MIN_TARGET = 44;

/**
 * The routes worth crossing with eleven shapes and three scales. Not all 49 —
 * that is `_w6scale_sweep.mjs`'s job at one viewport — but every layout family
 * the game has: a hub, a hero column, a virtualised grid, a two-pane builder, a
 * document, a settings form, a carousel, and the mulligan, which is where the
 * worst defect this project has found actually lived.
 */
const ALL_ROUTES = [
  { hash: "lobby", selector: ".lobby-screen" },
  { hash: "play", selector: ".play-screen" },
  { hash: "collection", selector: ".collection-screen" },
  { hash: "decks", selector: ".deck-slots-screen" },
  { hash: "deckbuilder", selector: ".builder-screen" },
  { hash: "shop", selector: ".shop-screen" },
  { hash: "missions", selector: ".missions-screen" },
  { hash: "profile", selector: ".profile-screen" },
  { hash: "gauntlet", selector: ".gauntlet-screen" },
  { hash: "events", selector: ".events-screen" },
  { hash: "a11y", selector: ".a11y-screen" },
  { hash: "settings", selector: ".settings-screen" },
  { hash: "mastery", selector: ".mastery-screen" },
  { hash: "achievements", selector: ".achievements-screen" },
  { hash: "gallery", selector: ".gallery-screen" },
  /** The mulligan. `seed=4` deals the six-card hand going second — the taller
   *  of the two opening sentences, and therefore the worst ordinary case. */
  { hash: "battle?seed=4", selector: ".battle-screen" },
];

const VIEWPORTS = (() => {
  const want = arg("viewports");
  if (!want) return has("quick") ? ALL_VIEWPORTS.filter((v) => [844, 1280, 1366, 1920, 2560, 3440].includes(v.width)) : ALL_VIEWPORTS;
  const wanted = String(want).split(",").map((s) => s.trim());
  return ALL_VIEWPORTS.filter((v) => wanted.includes(`${v.width}x${v.height}`) || wanted.includes(String(v.width)));
})();

const SCALES = String(arg("scales", has("quick") ? "100" : "100,140,160"))
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const ROUTES = (() => {
  const want = arg("routes");
  if (!want) return ALL_ROUTES;
  const wanted = String(want).split(",").map((s) => s.trim());
  return ALL_ROUTES.filter((r) => wanted.includes(r.hash) || wanted.includes(r.hash.split("?")[0]));
})();

// ---------------------------------------------------------------------------
// The probe. One function, evaluated in the page, answering every question from
// one walk of the tree — so the answers cannot come from different moments, and
// a layout that settled between two of them cannot be reported twice.
// ---------------------------------------------------------------------------

const FIT_PROBE = (minTarget) => {
  const screen = document.querySelector(".screen") ?? document.body;
  const R = (n) => Math.round(n);
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  const name = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
  };
  const text = (el) => (el.getAttribute?.("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 34);

  /**
   * Is this element actually being painted?
   *
   * `checkVisibility` covers `display: none`, `visibility: hidden`, zero opacity
   * and — the one that matters most here — `content-visibility: hidden`, which
   * is how Chrome hides the contents of a closed `<details>`. Those contents
   * keep a real `getBoundingClientRect()`: 87x11 at y=3183 on `#uikit`, which an
   * earlier sweep filed as a hard clip 2,400 pixels below a 720px window.
   *
   * The clip-rect walk is separate because it is the one case the platform
   * answers "yes, visible" to and a human answers "no": the screen-reader
   * pattern is a genuinely rendered 1x1 box with `clip: rect(0 0 0 0)`, and its
   * children are full-size text clipped to nothing. Matched on computed style
   * rather than on a list of class names, because a filter that knows four class
   * names is a filter that will be wrong about the fifth.
   */
  const EMPTY_CLIP = /^rect\(0px,? 0px,? 0px,? 0px\)$/;
  const paintable = (el) => {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    }
    if (el.closest("[hidden], [aria-hidden='true'], [inert]")) return false;
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (EMPTY_CLIP.test(cs.clip)) return false;
      if (cs.clipPath === "inset(50%)") return false;
      if (cs.overflow !== "visible") {
        const b = n.getBoundingClientRect();
        if (b.width <= 2 && b.height <= 2) return false;
      }
      n = n.parentElement;
    }
    return true;
  };

  const pageScrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 2;

  /**
   * Can the player get to the part of `rect` that is being cut?
   *
   * The naive version walks up and gives up at the first `overflow: hidden`,
   * which is the wrong question: every faction plate on the starter screen
   * declares `overflow: hidden` so its gradient stays inside its own radius, so
   * the walk stopped one element up and reported eleven unreachable rows in a
   * list that scrolls perfectly well. **A box that clips nothing is not a clip.**
   *
   * So: find the nearest ancestor that actually cuts this rectangle on this
   * axis, and ask that one. A scroller with room to move is reachable; a hidden
   * box is not.
   */
  const reachable = (el, rect, axis) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const ov = axis === "y" ? cs.overflowY : cs.overflowX;
      if (ov !== "visible") {
        const b = n.getBoundingClientRect();
        const cuts =
          axis === "y" ? rect.top < b.top - 1 || rect.bottom > b.bottom + 1 : rect.left < b.left - 1 || rect.right > b.right + 1;
        if (cuts) {
          if (ov === "hidden" || ov === "clip") return false;
          return axis === "y" ? n.scrollHeight > n.clientHeight + 2 : n.scrollWidth > n.clientWidth + 2;
        }
      }
      n = n.parentElement;
    }
    return axis === "y" ? pageScrolls : document.documentElement.scrollWidth > vpW + 2;
  };

  /** The rectangle every clipping ancestor leaves of this element. */
  const clipChain = (el) => {
    let r = { left: 0, top: 0, right: vpW, bottom: vpH };
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== "visible") {
        const b = n.getBoundingClientRect();
        r = {
          left: Math.max(r.left, b.left),
          top: Math.max(r.top, b.top),
          right: Math.min(r.right, b.right),
          bottom: Math.min(r.bottom, b.bottom),
        };
      }
      n = n.parentElement;
    }
    return r;
  };

  // --- controls -------------------------------------------------------------

  const CONTROL_SELECTOR =
    "button, a[href], input, select, textarea, summary, [role='button'], [role='link'], [role='switch'], " +
    "[role='radio'], [role='checkbox'], [role='tab'], [role='menuitem'], [role='option'], [tabindex]:not([tabindex='-1'])";

  const controls = [...screen.querySelectorAll(CONTROL_SELECTOR)].filter((el) => {
    if (!paintable(el)) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  });

  const small = [];
  const unreachable = [];
  const buried = [];

  /**
   * Is the thing on top of this control a **sheet** rather than a neighbour?
   *
   * The board's End Turn, its two ability buttons, Concede, Emotes and Settings
   * are all covered while the mulligan is open, and every one of them came back
   * as a buried control on the first run. Geometrically true, and about as
   * relevant as a complaint that page two of a book covers page three: a modal
   * is *supposed* to cover the screen behind it. Every dialog in the game would
   * have produced the same list.
   *
   * The discriminator is not a class name — `.battle-overlay`, `.overlay` and
   * `.card-detail-overlay` would have covered today's modals and missed the next
   * one. It is the shape of the tree: walk from the coverer up to the nearest
   * ancestor it shares with the control, and ask whether anything on that branch
   * fills most of the window. A modal sheet does. A button that has collided
   * with its neighbour because the layout collapsed does not, because the walk
   * stops at the row they are both inside.
   */
  const behindASheet = (control, coverer) => {
    let common = coverer.parentElement;
    while (common && !common.contains(control)) common = common.parentElement;
    let n = coverer;
    while (n && n !== common && n !== document.documentElement) {
      const b = n.getBoundingClientRect();
      if (b.width * b.height >= vpW * vpH * 0.7) return true;
      n = n.parentElement;
    }
    return false;
  };

  for (const el of controls) {
    const b = el.getBoundingClientRect();
    const label = text(el) || el.id || name(el);

    // 1. is it big enough for a finger?
    if (b.width < minTarget || b.height < minTarget) small.push({ label, w: R(b.width), h: R(b.height) });

    // 2. can the player reach it at all?
    const clip = clipChain(el);
    const lostTop = Math.max(0, clip.top - b.top);
    const lostBottom = Math.max(0, b.bottom - clip.bottom);
    const lostLeft = Math.max(0, clip.left - b.left);
    const lostRight = Math.max(0, b.right - clip.right);
    const vertical = lostTop + lostBottom;
    const horizontal = lostLeft + lostRight;
    if (vertical + horizontal >= 2) {
      const axis = vertical >= horizontal ? "y" : "x";
      const lost = Math.max(vertical, horizontal);
      const of = axis === "y" ? b.height : b.width;
      if (!reachable(el, b, axis)) {
        unreachable.push({
          el: name(el),
          label,
          axis,
          lost: R(lost),
          of: R(of),
          gone: lost >= of - 1,
          where: axis === "y" ? (lostBottom > lostTop ? `${R(lostBottom)}px below the edge` : `${R(lostTop)}px above it`) : lostRight > lostLeft ? `${R(lostRight)}px past the right` : `${R(lostLeft)}px past the left`,
        });
        continue;
      }
    }

    /*
     * 3. is it buried?
     *
     * A rectangle intersection is the wrong test. The hand fans deliberately,
     * every card overlapping its neighbour, and a geometric overlap test files
     * the whole hand. The honest question is functional: is there **any** point
     * inside this control's own box at which a click lands on it? Nine points on
     * a 3x3 inset grid.
     *
     * `elementFromPoint` already ignores `pointer-events: none`, which is what
     * makes this quiet: a decorative sheen laid over a button is not a defect
     * and does not appear here, while an opaque plate laid over it is and does.
     *
     * ## The grid is laid inside the ON-SCREEN part, and that is instrument work
     *
     * The first version clamped the grid with `Math.max(clip.left, b.left)`,
     * which is not a clamp at all when the box is entirely past the clip: for
     * the lobby's `Mastery` tile, sitting at x=957 in a horizontal snap rail on
     * an 844px phone, it produced points at 959, 900 and 842 — the first two
     * outside the window and the third **inside the neighbouring tile**. So the
     * sweep reported five of the lobby's six destinations as "fully covered by
     * Missions" at every touch viewport, which is 1,200 confident wrong rows
     * across the matrix and would have been the fifteenth instrument to lie
     * here. A row scrolled out of a scroller is a list, not a defect; the
     * reachability question above is the one that decides whether it is a
     * defect, and it has already been asked. So the grid is laid inside
     * `visible` — the box intersected with its own clip chain and the window —
     * and a control with no on-screen area is not asked at all.
     */
    const visible = {
      left: Math.max(0, clip.left, b.left),
      top: Math.max(0, clip.top, b.top),
      right: Math.min(vpW, clip.right, b.right),
      bottom: Math.min(vpH, clip.bottom, b.bottom),
    };
    if (visible.right - visible.left < 6 || visible.bottom - visible.top < 6) continue;
    const px = [visible.left + 2, (visible.left + visible.right) / 2, visible.right - 2];
    const py = [visible.top + 2, (visible.top + visible.bottom) / 2, visible.bottom - 2];
    let hits = 0;
    let cover = null;
    for (const x of px) {
      for (const y of py) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) hits += 1;
        else if (!cover) cover = hit;
      }
    }
    if (hits === 0 && cover && !behindASheet(el, cover)) {
      buried.push({ el: name(el), label, under: name(cover), w: R(b.width), h: R(b.height) });
    }
  }

  // --- images ---------------------------------------------------------------

  /**
   * Stretched, squashed or letterboxed.
   *
   * The number that matters is the ratio between the aspect the source has and
   * the aspect it is painted at. `object-fit: cover` crops and `contain` letters
   * — neither distorts — so only `fill` and `scale-down`-into-a-smaller-box can
   * squash an `<img>`, and only an explicit two-value `background-size` can
   * squash a CSS background. A `<canvas>` distorts when its backing store's
   * aspect and its CSS box's aspect disagree, which is the bug that makes a 3D
   * board look subtly wrong on an ultrawide and looks like nothing on a still.
   */
  const distorted = [];
  const letterbox = [];
  const noteAspect = (el, natural, box, fit) => {
    if (!(natural > 0) || !(box > 0)) return;
    const skew = natural > box ? natural / box : box / natural;
    if (skew > 1.02) distorted.push({ el: name(el), fit, natural: Number(natural.toFixed(3)), painted: Number(box.toFixed(3)), skew: Number(skew.toFixed(2)) });
  };

  /*
   * `<canvas>` is a replaced element and honours `object-fit` exactly as `<img>`
   * does, and forgetting that is how the first run of this sweep filed the deck
   * slots' cover art — a 440x240 canvas in a 274x165 box with an explicit
   * `object-fit: cover`, which crops and cannot distort — as a 1.1x squash at
   * every touch viewport. So the two share one routine. The distinction that
   * matters is not the tag, it is the fit: `fill` (the initial value) is the
   * only one that stretches, `cover` crops, `contain` letterboxes, `none` and
   * `scale-down` clip or shrink. Only `fill` is a defect.
   */
  const measureReplaced = (el, natural, kind) => {
    /*
     * The **layout** box, not the visual one.
     *
     * `getBoundingClientRect()` returns the axis-aligned bounding box of the
     * element *after* transforms, and the hand is a fan: every card carries
     * `rotate(var(--tilt))`, so a card whose layout box is a perfect
     * 76.4x101.4 measures 101x119 once it is tilted. That is a 1.14x "squash"
     * on a card that is not squashed at all, and this sweep reported it on four
     * cards on every battle route before this line existed. The used width and
     * height from `getComputedStyle` are the box the image is painted into, and
     * a rotation does not touch them.
     */
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    if (!(w > 0) || !(h > 0)) return;
    const box = w / h;
    const fit = cs.objectFit;
    if (fit === "fill") noteAspect(el, natural, box, kind);
    else if (fit === "contain") {
      const waste = 1 - Math.min(natural, box) / Math.max(natural, box);
      if (waste > 0.34) letterbox.push({ el: name(el), waste: Number((waste * 100).toFixed(0)), natural: Number(natural.toFixed(2)), painted: Number(box.toFixed(2)) });
    }
  };

  for (const img of screen.querySelectorAll("img")) {
    if (!paintable(img)) continue;
    if (!img.naturalWidth || !img.naturalHeight) continue;
    const b = img.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) continue;
    measureReplaced(img, img.naturalWidth / img.naturalHeight, "img object-fit");
  }

  for (const canvas of screen.querySelectorAll("canvas")) {
    if (!paintable(canvas)) continue;
    if (!canvas.width || !canvas.height) continue;
    const b = canvas.getBoundingClientRect();
    if (b.width < 24 || b.height < 24) continue;
    measureReplaced(canvas, canvas.width / canvas.height, "canvas backing store");
  }

  /**
   * CSS backgrounds. Collected here and resolved outside the probe, because the
   * intrinsic size of a background image needs a decode and this function is
   * synchronous. Only `url()` layers with an explicit two-value
   * `background-size` can distort; `cover`, `contain` and `auto` cannot, and a
   * gradient has no intrinsic aspect to violate.
   */
  const backgrounds = [];
  for (const el of screen.querySelectorAll("*")) {
    if (!paintable(el)) continue;
    const cs = getComputedStyle(el);
    if (!cs.backgroundImage.includes("url(")) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 24 || b.height < 24) continue;
    const layers = cs.backgroundImage.split(/,(?![^(]*\))/);
    const sizes = cs.backgroundSize.split(/,(?![^(]*\))/);
    layers.forEach((layer, i) => {
      const m = /url\("?([^")]+)"?\)/.exec(layer.trim());
      if (!m) return;
      const url = m[1];
      if (url.startsWith("data:")) return;
      const size = (sizes[i] ?? sizes[0] ?? "auto").trim();
      const parts = size.split(/\s+/);
      if (parts.length !== 2) return;
      if (parts.some((p) => p === "auto")) return;
      const w = parts[0].endsWith("%") ? (parseFloat(parts[0]) / 100) * b.width : parseFloat(parts[0]);
      const h = parts[1].endsWith("%") ? (parseFloat(parts[1]) / 100) * b.height : parseFloat(parts[1]);
      if (!(w > 0) || !(h > 0)) return;
      backgrounds.push({ el: name(el), url, painted: w / h });
    });
  }

  // --- text -----------------------------------------------------------------

  /**
   * Text the player cannot get to.
   *
   * The control pass above asks the same question of buttons; this asks it of
   * the sentence. It is deliberately the *narrow* version of that question —
   * "is any ink cut by a box that nothing in the chain can scroll" — and not
   * "does anything overflow", because overflow is usually a list and a sweep
   * that cannot tell the two apart buries its own findings. Three forgivenesses
   * are load-bearing, and all three were learnt the expensive way in
   * `_w6scale_sweep.mjs`:
   *
   *   - a single-line `text-overflow: ellipsis` is a stated design decision;
   *   - so is `-webkit-line-clamp`, which is the vertical version of it —
   *     `.ability-text` is clamped to two lines, so at 140% the third line
   *     exists in layout and is cut away on purpose;
   *   - a row scrolled entirely out of a scroller is a list, not a defect.
   *
   * What is left is a sentence half-eaten by an `overflow: hidden` ancestor
   * that no gesture moves, which is a defect at any window size.
   */
  const cutText = [];
  for (const el of screen.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    if (!(el.textContent || "").trim()) continue;
    if (!paintable(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) continue;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 0.15) continue;

    const clip = clipChain(el);
    const lostTop = Math.max(0, clip.top - b.top);
    const lostBottom = Math.max(0, b.bottom - clip.bottom);
    const lostLeft = Math.max(0, clip.left - b.left);
    const lostRight = Math.max(0, b.right - clip.right);
    const vertical = lostTop + lostBottom;
    const horizontal = lostLeft + lostRight;
    if (vertical + horizontal < 2) continue;
    const axis = vertical >= horizontal ? "y" : "x";
    if (axis === "x" && cs.textOverflow === "ellipsis") continue;
    if (axis === "y") {
      let n = el;
      let clamped = false;
      while (n && n !== document.documentElement) {
        const s = getComputedStyle(n);
        if (s.webkitLineClamp && s.webkitLineClamp !== "none") { clamped = true; break; }
        n = n.parentElement;
      }
      if (clamped) continue;
    }
    const lost = Math.max(vertical, horizontal);
    const of = axis === "y" ? b.height : b.width;
    if (reachable(el, b, axis)) continue;
    if (lost < 4) continue;
    cutText.push({ el: name(el), axis, lost: R(lost), of: R(of), text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) });
  }

  /** A word whose Range spans two line boxes has been snapped in half. */
  const wordBreak = [];
  const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) continue;
    const host = node.parentElement;
    if (!host || !paintable(host)) continue;
    const hb = host.getBoundingClientRect();
    if (hb.width < 4 || hb.height < 4) continue;
    const re = /[^\s\u00a0]+/g;
    let m;
    while ((m = re.exec(raw))) {
      const word = m[0];
      if (word.length < 4) continue;
      /* words that legitimately carry a break opportunity */
      if (/[-\/\u2013\u2014\u00ad]/.test(word)) continue;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + word.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (rects.length < 2) continue;
      const tops = new Set(rects.map((r) => Math.round(r.top)));
      if (tops.size < 2) continue;
      wordBreak.push({ el: name(host), word, lines: tops.size });
    }
  }

  /**
   * Text below the legibility floor — measured, not rounded.
   *
   * This used to round the computed size before comparing it, which is how
   * `base.css` describes the rule beside `--fs-micro` ("counts anything that
   * rounds below 11px") and which quietly forgives every literal between 10.5
   * and 11. `0.66rem` is 10.56px at 100% and sat in the battle log's turn
   * markers; rounding called it 11 and passed it. A floor that forgives the
   * pixel below it is not a floor.
   *
   * The strict form was measured before it was adopted, because a stricter rule
   * that floods is worse than a loose one: `scripts/_fit/tiny.mjs` walks all
   * sixteen routes at 1280x720 asking the unrounded question, and across the
   * whole game exactly **two** elements sit between 10.5 and 11, both the same
   * declaration. So this costs one genuine finding and no noise.
   *
   * **Known limit, stated rather than hidden.** The `> 3` below is inherited and
   * means a text run of three characters or fewer is never measured at all. That
   * is right for stray punctuation and wrong for a number: `.rw-tile-qty` prints
   * a reward quantity at 10.88px on `#missions` and `#achievements`, and this
   * channel cannot see it, because the quantity is "100". `tiny.mjs` has no such
   * filter and is what to run when the question is specifically about type size.
   * Widening it here changes what a shipped check reports on every route, so the
   * finding is handed to whoever owns `rewardsTheme.ts` rather than the filter
   * being changed in passing by somebody who cannot fix what it would report.
   */
  const tiny = [...screen.querySelectorAll("p, li, td, span, div, button, a, strong, em, small, label")]
    .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 3 && paintable(el))
    .map((el) => ({ size: Number(parseFloat(getComputedStyle(el).fontSize).toFixed(2)), el: name(el) }))
    .filter((e) => e.size > 0 && e.size < 11);

  const dedupe = (rows, key) => {
    const seen = new Set();
    return rows.filter((r) => {
      const k = key(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return {
    vw: vpW,
    vh: vpH,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    controls: controls.length,
    small: dedupe(small, (r) => `${r.label}|${r.w}x${r.h}`).slice(0, 12),
    unreachable: dedupe(unreachable, (r) => `${r.el}|${r.label}|${r.axis}`).slice(0, 12),
    buried: dedupe(buried, (r) => `${r.el}|${r.label}|${r.under}`).slice(0, 12),
    distorted: dedupe(distorted, (r) => `${r.el}|${r.skew}`).slice(0, 12),
    letterbox: dedupe(letterbox, (r) => `${r.el}|${r.waste}`).slice(0, 8),
    backgrounds: dedupe(backgrounds, (r) => `${r.el}|${r.url}`).slice(0, 30),
    cutText: dedupe(cutText, (r) => `${r.el}|${r.axis}|${r.lost}`).slice(0, 12),
    wordBreak: dedupe(wordBreak, (r) => `${r.el}|${r.word}`).slice(0, 12),
    tiny: dedupe(tiny, (r) => `${r.el}|${r.size}`).slice(0, 12),
  };
};

/**
 * Resolve the intrinsic aspect of every CSS background the probe collected, and
 * report the ones being painted at a different one. Runs as its own async pass
 * because a decode cannot happen inside the synchronous walk above.
 */
const RESOLVE_BACKGROUNDS = async (rows) => {
  const out = [];
  for (const row of rows) {
    const natural = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0);
      img.onerror = () => resolve(0);
      img.src = row.url;
    });
    if (!natural) continue;
    const skew = natural > row.painted ? natural / row.painted : row.painted / natural;
    if (skew > 1.02) {
      out.push({
        el: row.el,
        fit: "background-size",
        url: row.url.split("/").pop(),
        natural: Number(natural.toFixed(3)),
        painted: Number(row.painted.toFixed(3)),
        skew: Number(skew.toFixed(2)),
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  /* `--hide-scrollbars` erases the styled scrollbar and has already convinced
     one review that forty lines of CSS were dead. It stays off. */
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const injectPath = arg("injectcss");
const injectedCss = injectPath ? readFileSync(String(injectPath), "utf8") : null;
if (injectedCss) console.log(`--injectcss ${injectPath}: the page is being altered for this run.\n`);

const newPage = async (viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
  });
  if (injectedCss) {
    await context.addInitScript((source) => {
      const apply = () => {
        const style = document.createElement("style");
        style.id = "fit-injected";
        style.textContent = source;
        document.head.appendChild(style);
      };
      if (document.head) apply();
      else window.addEventListener("DOMContentLoaded", apply);
    }, injectedCss);
  }
  const page = await context.newPage();
  return { context, page };
};

/**
 * Hold until every finite animation has finished; see the note at the top.
 *
 * ...and get the pointer out of the picture first, which is instrument work
 * rather than tidiness. Playwright leaves the mouse wherever it last clicked,
 * and this sweep clicks an interface-size button on `#a11y` before every scale.
 * Navigate to `#play` and that coordinate lands on a mode card, which then sits
 * in its `:hover` state: `scale(1.015)` and `translateY(-2px)`, which on a 660px
 * tile puts its visual top **7px above** its own container. The sweep filed that
 * as an unreachable control on the play screen at four desktop formats. The card
 * is not unreachable; the player is pointing at it.
 *
 * `mouse.move(0, 0)` is the corner of the window, where nothing lives on any
 * screen in this game. Every measurement below is therefore of the rest state,
 * which is the state a layout has to be correct in — and a hover that breaks a
 * layout would still be caught, because the lift is a fixed 2px and the report
 * would name the same box at every viewport rather than only where the pointer
 * happened to land.
 */
const settleEntrance = async (page) => {
  await page.mouse.move(0, 0).catch(() => {});
  await page
    .waitForFunction(
      () =>
        document.getAnimations().filter((a) => {
          if (a.playState !== "running") return false;
          const timing = a.effect?.getTiming?.();
          return Boolean(timing) && timing.iterations !== Infinity;
        }).length === 0,
      null,
      { timeout: 6000 }
    )
    .catch(() => {});
  await page.waitForTimeout(220);
};

const run = async (page) => {
  const raw = await page.evaluate(FIT_PROBE, MIN_TARGET);
  const bg = await page.evaluate(RESOLVE_BACKGROUNDS, raw.backgrounds);
  raw.distorted = [...raw.distorted, ...bg].slice(0, 14);
  delete raw.backgrounds;
  return raw;
};

let failures = 0;
const findings = new Map();
const fail = (kind, detail, where) => {
  failures += 1;
  const key = `${kind}\u0000${detail}`;
  if (!findings.has(key)) findings.set(key, { kind, detail, where: [] });
  findings.get(key).where.push(where);
};

/**
 * Reported, not failed.
 *
 * A letterbox is what `object-fit: contain` does when a box is not the shape of
 * the thing in it, and `foundation.css` §11 makes `contain` the default for
 * every replaced element in the game precisely so that a squash becomes a
 * letterbox. That is the right trade — a visible bar beats an invisible
 * distortion — but it means a bar is now the *symptom* of a box whose shape is
 * wrong, and the run has to say where they are without calling a deliberate
 * pillarbox a failure. So they get their own list, under the findings.
 */
const notes = new Map();
const note = (kind, detail, where) => {
  const key = `${kind}|${detail}`;
  if (!notes.has(key)) notes.set(key, { kind, detail, where: [] });
  notes.get(key).where.push(where);
};

// ---------------------------------------------------------------------------
// CALIBRATION — can this sweep still fail?
// ---------------------------------------------------------------------------

/**
 * Seven planted objects, four the sweep must see and three it must not. A
 * disagreement in either direction stops the run: a filter that removes noise
 * has to be shown not to remove signal, and it has to be shown *here*, in this
 * run, through this code path — not in a comment.
 */
async function calibrate() {
  const { context, page } = await newPage({ width: 1280, height: 720, touch: false, dpr: 1 });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForSelector(".lobby-screen", { timeout: 20000 });
  await settleEntrance(page);

  await page.evaluate(() => {
    const screen = document.querySelector(".screen");
    const rig = document.createElement("div");
    rig.id = "fit-calibration";
    rig.style.cssText = "position:absolute;left:20px;top:20px;width:420px;height:260px;z-index:9;";

    /* 1 — must see: a control past the bottom of an overflow:hidden box. This is
           the mulligan Confirm's exact geometry. */
    const shutter = document.createElement("div");
    shutter.style.cssText = "position:absolute;left:0;top:0;width:240px;height:110px;overflow:hidden;";
    const bait = document.createElement("button");
    bait.textContent = "CALIB UNREACHABLE";
    bait.style.cssText = "position:absolute;left:6px;top:140px;width:200px;height:44px;font-size:15px;color:#fff;background:#333;";
    /* 2 — must NOT see: the screen-reader pattern, which is a genuine 1x1 box. */
    const decoy = document.createElement("span");
    decoy.textContent = "CALIB SR DECOY";
    decoy.style.cssText = "position:absolute;left:6px;top:6px;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
    shutter.append(bait, decoy);

    /* 3 — must see: a control completely covered by an opaque plate. */
    const buriedBtn = document.createElement("button");
    buriedBtn.textContent = "CALIB BURIED";
    buriedBtn.style.cssText = "position:absolute;left:250px;top:0;width:150px;height:44px;font-size:15px;color:#fff;background:#333;";
    const plate = document.createElement("div");
    plate.style.cssText = "position:absolute;left:246px;top:-4px;width:158px;height:52px;background:#101018;";

    /* 4 — must NOT see: the same, under a plate that takes no pointer events. */
    const sheenBtn = document.createElement("button");
    sheenBtn.textContent = "CALIB SHEEN";
    sheenBtn.style.cssText = "position:absolute;left:250px;top:60px;width:150px;height:44px;font-size:15px;color:#fff;background:#333;";
    const sheen = document.createElement("div");
    sheen.style.cssText = "position:absolute;left:246px;top:56px;width:158px;height:52px;background:#101018;pointer-events:none;";

    /* 5 — must see: a 3:2 photograph painted into a 1:3 box with object-fit:fill.
           6 — must NOT see: the same source painted with object-fit:cover. */
    const src =
      "data:image/svg+xml;base64," +
      btoa('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#4a2"/></svg>');
    const squashed = document.createElement("img");
    squashed.id = "calib-squashed";
    squashed.src = src;
    squashed.style.cssText = "position:absolute;left:0;top:120px;width:60px;height:180px;object-fit:fill;";
    const cropped = document.createElement("img");
    cropped.id = "calib-cropped";
    cropped.src = src;
    cropped.style.cssText = "position:absolute;left:70px;top:120px;width:60px;height:180px;object-fit:cover;";

    /* 7 — must see: a long word forced to break inside a narrow box. */
    const snapped = document.createElement("p");
    snapped.textContent = "CALIBWORDBREAKAGE";
    snapped.style.cssText = "position:absolute;left:150px;top:120px;width:44px;font-size:15px;overflow-wrap:break-word;color:#fff;";

    /* 8 — must NOT see, in EITHER channel: a control scrolled out of a
           horizontal scroller. This is the lobby's phone-landscape nav rail,
           and it is here because the first version of this sweep reported five
           of the lobby's six destinations as "fully covered by Missions" at
           every touch viewport. A row scrolled out of a list is a list. */
    const rail = document.createElement("div");
    rail.style.cssText = "position:absolute;left:0;top:210px;width:180px;height:44px;overflow-x:auto;white-space:nowrap;";
    for (const label of ["CALIB RAIL NEAR", "CALIB RAIL FAR"]) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = "display:inline-block;width:170px;height:40px;font-size:14px;color:#fff;background:#333;";
      rail.appendChild(btn);
    }

    /* 9 — must NOT see: a canvas cropped by `object-fit: cover`. A canvas is a
           replaced element and honours object-fit exactly as an <img> does; the
           first run of this sweep forgot that and filed the deck slots' cover
           art, a 440x240 canvas in a 274x165 box, as a 1.1x squash.
       10 — must see: the same canvas painted with `object-fit: fill`. */
    const paint = (id, fit) => {
      const c = document.createElement("canvas");
      c.id = id;
      c.width = 300;
      c.height = 200;
      const g = c.getContext("2d");
      g.fillStyle = "#24a";
      g.fillRect(0, 0, 300, 200);
      c.style.cssText = `position:absolute;left:${id.endsWith("cover") ? 200 : 260}px;top:120px;width:50px;height:170px;object-fit:${fit};`;
      return c;
    };

    /* 11 — must NOT see: a correctly-proportioned canvas inside a rotated
            parent. This is the hand's fan, and it is a decoy because the first
            version of this sweep measured `getBoundingClientRect` and filed
            four un-squashed cards per battle route. */
    const tilted = document.createElement("div");
    tilted.style.cssText = "position:absolute;left:330px;top:120px;transform:rotate(14deg);";
    const straight = paint("calib-canvas-tilted", "fill");
    straight.style.cssText = "display:block;width:60px;height:40px;object-fit:fill;";
    tilted.appendChild(straight);

    /* 12 — must see: a sentence half-eaten by an `overflow: hidden` box.
       13 — must NOT: the same sentence with `text-overflow: ellipsis`.
       14 — must NOT: the same sentence inside a `-webkit-line-clamp`. */
    const cutBox = document.createElement("div");
    cutBox.style.cssText = "position:absolute;left:0;top:262px;width:90px;height:20px;overflow:hidden;white-space:nowrap;";
    cutBox.innerHTML = '<span style="font-size:14px;color:#fff">CALIB CUT SENTENCE RUNS PAST</span>';
    const ellipsised = document.createElement("div");
    ellipsised.style.cssText = "position:absolute;left:100px;top:262px;width:90px;height:20px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;";
    ellipsised.innerHTML = '<span style="font-size:14px;color:#fff;text-overflow:ellipsis;overflow:hidden;display:block;white-space:nowrap">CALIB ELLIPSIS SENTENCE RUNS PAST</span>';
    const clamped = document.createElement("div");
    clamped.style.cssText = "position:absolute;left:200px;top:262px;width:90px;height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;";
    clamped.innerHTML = '<span style="font-size:14px;color:#fff">CALIB CLAMPED SENTENCE THAT GOES ON FOR SEVERAL LINES INDEED</span>';

    rig.append(shutter, buriedBtn, plate, sheenBtn, sheen, squashed, cropped, snapped, rail, paint("calib-canvas-cover", "cover"), paint("calib-canvas-fill", "fill"), tilted, cutBox, ellipsised, clamped);
    screen.appendChild(rig);
  });
  /* the SVG data URI has to have decoded before aspect can be asked about it */
  await page.waitForFunction(() => {
    const a = document.getElementById("calib-squashed");
    const b = document.getElementById("calib-cropped");
    return Boolean(a?.naturalWidth && b?.naturalWidth);
  }, null, { timeout: 5000 });

  const r = await run(page);
  const verdict = [
    ["unreachable control", r.unreachable.some((u) => u.label.includes("CALIB UNREACHABLE")), true],
    ["screen-reader decoy", JSON.stringify(r).includes("CALIB SR DECOY"), false],
    ["buried control", r.buried.some((b) => b.label.includes("CALIB BURIED")), true],
    ["control under a pointer-events:none sheen", r.buried.some((b) => b.label.includes("CALIB SHEEN")), false],
    ["squashed image", r.distorted.some((d) => d.el.includes("calib-squashed")), true],
    ["cropped image (object-fit: cover)", r.distorted.some((d) => d.el.includes("calib-cropped")), false],
    ["broken word", r.wordBreak.some((w) => w.word.includes("CALIBWORDBREAKAGE")), true],
    ["a control scrolled out of a horizontal rail", JSON.stringify([r.buried, r.unreachable]).includes("CALIB RAIL FAR"), false],
    ["squashed canvas", r.distorted.some((d) => d.el.includes("calib-canvas-fill")), true],
    ["cropped canvas (object-fit: cover)", r.distorted.some((d) => d.el.includes("calib-canvas-cover")), false],
    ["an un-squashed canvas inside a rotated parent", r.distorted.some((d) => d.el.includes("calib-canvas-tilted")), false],
    ["a sentence cut by an overflow:hidden box", r.cutText.some((c) => c.text.includes("CALIB CUT SENTENCE")), true],
    ["...the same sentence with text-overflow: ellipsis", r.cutText.some((c) => c.text.includes("CALIB ELLIPSIS")), false],
    ["...the same sentence inside a -webkit-line-clamp", r.cutText.some((c) => c.text.includes("CALIB CLAMPED")), false],
  ];

  /**
   * ...and one more, which has to be its own pass because a modal covers the
   * other ten objects as well.
   *
   * Drop a full-window sheet over the rig and re-probe. The control planted
   * under it must go quiet, and so must the opaque-plate control the first pass
   * just reported — a dialog buries the screen behind it and that is what a
   * dialog is for. Without this rule the board's End Turn, both ability buttons,
   * Concede, Emotes and Settings are filed as buried on every route that opens
   * a mulligan.
   */
  await page.evaluate(() => {
    const sheet = document.createElement("div");
    sheet.id = "fit-calibration-sheet";
    sheet.style.cssText = "position:fixed;inset:0;z-index:60;background:rgb(4 2 10 / 0.92);";
    document.querySelector(".screen").appendChild(sheet);
  });
  const covered = await run(page);
  verdict.push(
    ["a control under a full-window modal sheet", covered.buried.some((b) => b.label.includes("CALIB BURIED")), false],
    /* ...and the second pass has to be shown to have measured anything at all,
       or "went quiet under a sheet" is indistinguishable from "did not run". */
    ["the second pass still sees the unreachable control", covered.unreachable.some((u) => u.label.includes("CALIB UNREACHABLE")), true]
  );

  console.log("CONTROL — fourteen planted objects on the live lobby at 1280x720, plus one sheet:");
  for (const [label, got, want] of verdict) {
    console.log(`   ${got === want ? "ok  " : "WRONG"} ${label}: ${got ? "reported" : "not reported"} (want ${want ? "reported" : "silent"})`);
  }
  await context.close();
  if (verdict.some(([, got, want]) => got !== want)) {
    console.log("\nCALIBRATION FAILED — this sweep cannot be trusted to see a real defect. Stopping.\n");
    await browser.close();
    process.exit(3);
  }
  console.log("   the instrument sees all six defects and none of the nine decoys.\n");
}

await calibrate();

// ---------------------------------------------------------------------------
// THE MATRIX
// ---------------------------------------------------------------------------

console.log(
  `THE MATRIX — ${VIEWPORTS.length} window shape(s) x ${SCALES.length} interface size(s) x ${ROUTES.length} route(s) ` +
    `= ${VIEWPORTS.length * SCALES.length * ROUTES.length} measurements\n`
);

const errors = [];
const started = Date.now();

for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.name} — ${viewport.width}x${viewport.height}${viewport.touch ? ", touch" : ", mouse"}`);
  const { context, page } = await newPage(viewport);
  page.on("console", (m) => m.type() === "error" && errors.push(`${viewport.name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${viewport.name}: ${e.message}`));

  await seedPlayedAccount(page, ORIGIN);

  for (const pct of SCALES) {
    /*
     * Set the interface size through the app's own control. Writing `--ui-scale`
     * onto the root photographs a state the game never enters, because the
     * setting also drives JS-side layout decisions. Then read it back: a click
     * that did not land would otherwise report the 100% matrix three times.
     */
    if (pct !== 100 || SCALES.length > 1) {
      await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
      await page.waitForSelector(".a11y-screen", { timeout: 20000 });
      await settleEntrance(page);
      await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
      await page.waitForTimeout(320);
      const got = Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()));
      if (Math.abs(got * 100 - pct) > 0.5) {
        console.log(`   INSTRUMENT: asked for ${pct}% and the root reports ${got * 100}%. Stopping.`);
        await context.close();
        await browser.close();
        process.exit(3);
      }
    }

    const line = [];
    for (const route of ROUTES) {
      let r;
      try {
        await page.goto(`${ORIGIN}/?nointro#${route.hash}`, { waitUntil: "networkidle" });
        await page.waitForSelector(route.selector, { timeout: 25000 });
        await page
          .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
          .catch(() => {});
        await settleEntrance(page);
        r = await run(page);
      } catch (error) {
        fail("route never rendered", `#${route.hash}: ${String(error).split("\n")[0].slice(0, 90)}`, `${viewport.width}x${viewport.height}@${pct}%`);
        line.push(`${route.hash}:THREW`);
        continue;
      }

      const where = `${viewport.width}x${viewport.height}@${pct}% #${route.hash}`;
      const marks = [];

      if (r.overflowX > 2) {
        fail("sideways scroll", `#${route.hash} overflows by ${r.overflowX}px`, where);
        marks.push(`h-scroll ${r.overflowX}`);
      }
      for (const u of r.unreachable) {
        fail("UNREACHABLE CONTROL", `#${route.hash} ${u.el} "${u.label}" — ${u.where}, ${u.lost} of ${u.of}px`, where);
        marks.push("UNREACHABLE");
      }
      for (const b of r.buried) {
        fail("BURIED CONTROL", `#${route.hash} ${b.el} "${b.label}" fully covered by ${b.under}`, where);
        marks.push("BURIED");
      }
      for (const d of r.distorted) {
        fail("distorted image", `#${route.hash} ${d.el} (${d.fit}) painted at ${d.painted}:1, source is ${d.natural}:1 — ${d.skew}x skew`, where);
        marks.push(`skew ${d.skew}x`);
      }
      for (const c of r.cutText) {
        fail("TEXT NOBODY CAN SCROLL TO", `#${route.hash} ${c.el} "${c.text}" — ${c.lost} of ${c.of}px cut on ${c.axis}`, where);
        marks.push("cut-text");
      }
      for (const w of r.wordBreak) {
        fail("word broken mid-word", `#${route.hash} ${w.el} "${w.word}" across ${w.lines} lines`, where);
        marks.push("wordbreak");
      }
      for (const t of r.tiny) {
        fail("text under 11px", `#${route.hash} ${t.el} at ${t.size}px`, where);
        marks.push(`${t.size}px`);
      }
      /* The 44px floor is a TOUCH rule. On a mouse a 44px filter chip is a third
         taller for nobody's benefit, so it is counted and not failed. */
      if (r.small.length > 0 && viewport.touch) {
        for (const s of r.small) fail("touch target under 44px", `#${route.hash} "${s.label}" is ${s.w}x${s.h}`, where);
        marks.push(`small x${r.small.length}`);
      }
      for (const l of r.letterbox) {
        note("letterboxed", `#${route.hash} ${l.el} holds a ${l.natural}:1 picture in a ${l.painted}:1 box — ${l.waste}% of it is bar`, where);
        marks.push(`letterbox ${l.waste}%`);
      }
      line.push(marks.length ? `${route.hash}[${marks.join(" ")}]` : null);
    }

    const dirty = line.filter(Boolean);
    console.log(`   ${String(pct + "%").padEnd(5)} ${dirty.length === 0 ? "clean" : dirty.join("  ")}`);
  }

  /*
   * Portrait. §13 enforces landscape on a phone and must NOT on a tablet held
   * upright — a rotate prompt on a device that is perfectly usable is a wall in
   * front of a working game. A fresh context, portrait from the start, which is
   * the case that matters: somebody opening the game on a phone they are already
   * holding. Resizing the existing page tested the resize listener instead and
   * reported a failure the app did not have.
   */
  if (viewport.touch || viewport.width <= 1366) {
    const portraitPair = await newPage({ ...viewport, width: viewport.height, height: viewport.width });
    await portraitPair.page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
    await portraitPair.page.waitForTimeout(400);
    /*
     * Retried once, because `#lobby` on a fresh profile can bounce to the
     * starter picker while the evaluate is in flight and "Execution context was
     * destroyed" then kills the whole sweep on its ninth viewport. A run that
     * cannot finish cannot be compared to the last one.
     */
    const readPortrait = () =>
      portraitPair.page.evaluate(() => {
        const overlay = document.getElementById("rotate-overlay");
        return { exists: Boolean(overlay), shown: overlay ? !overlay.hidden : false, w: window.innerWidth, h: window.innerHeight, min: Math.min(window.innerWidth, window.innerHeight) };
      });
    const portrait = await readPortrait().catch(async () => {
      await portraitPair.page.waitForTimeout(800);
      return readPortrait();
    });
    const shouldPrompt = portrait.h > portrait.w && portrait.min < 820;
    if (!portrait.exists) fail("rotate overlay", "there is no rotate overlay at all", `${viewport.height}x${viewport.width}`);
    else if (portrait.shown !== shouldPrompt) {
      fail(
        "rotate overlay",
        `at ${portrait.w}x${portrait.h} it is ${portrait.shown ? "shown" : "hidden"}; the rule (portrait, short side under 820px) says ${shouldPrompt ? "shown" : "hidden"}`,
        `${viewport.height}x${viewport.width}`
      );
    }
    await portraitPair.context.close();
  }

  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await settleEntrance(page);
  await page.screenshot({ path: path.join(OUT, `fit-${viewport.width}x${viewport.height}.png`) });
  await context.close();
}

/**
 * The board, at the smallest supported size.
 *
 * Every check above is about rectangles. A card game whose rectangles are
 * perfect and which then cannot deal a hand on a phone has not been checked.
 */
console.log("\nThe battle board at 667x375");
{
  const { context, page } = await newPage({ width: 667, height: 375, touch: true, dpr: 2 });
  page.on("pageerror", (e) => errors.push(`board: ${e.message}`));
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/#battle?difficulty=casual`, { waitUntil: "networkidle" });
  try {
    await page.waitForSelector(".battle-screen", { timeout: 25000 });
    await page.waitForTimeout(3000);
    const board = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const doc = document.documentElement;
      return {
        canvas: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight, bw: canvas.width, bh: canvas.height } : null,
        overflow: doc.scrollWidth - doc.clientWidth,
        hand: document.querySelectorAll(".hand-card, .hand .card").length,
      };
    });
    if (!board.canvas) fail("battle board", "the board rendered no canvas at 667x375", "667x375");
    else if (board.canvas.w < 300) fail("battle board", `the board canvas is only ${board.canvas.w}px wide`, "667x375");
    else console.log(`   ok: the board fills ${board.canvas.w}x${board.canvas.h} and deals${board.hand ? ` (${board.hand} in hand)` : ""}`);
    if (board.overflow > 2) fail("battle board", `the board scrolls sideways by ${board.overflow}px`, "667x375");
    await page.screenshot({ path: path.join(OUT, "fit-battle-667x375.png") });
  } catch (error) {
    fail("battle board", `the board never rendered at 667x375: ${String(error).slice(0, 120)}`, "667x375");
  }
  await context.close();
}

// ---------------------------------------------------------------------------
// THE REPORT — grouped by defect, not by viewport
// ---------------------------------------------------------------------------

/**
 * A rule-level defect shows up at nine viewports and three scales. Printing it
 * twenty-seven times turns one fix into twenty-seven lines of report and buries
 * whatever is genuinely local — which is the exact failure mode `_w6scale_sweep`
 * was rewritten to escape. So findings are keyed by what is wrong and carry the
 * list of formats they appear at.
 */
const ORDER = [
  "UNREACHABLE CONTROL",
  "BURIED CONTROL",
  "TEXT NOBODY CAN SCROLL TO",
  "route never rendered",
  "sideways scroll",
  "distorted image",
  "word broken mid-word",
  "text under 11px",
  "touch target under 44px",
  "rotate overlay",
  "battle board",
];
const rows = [...findings.values()].sort(
  (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.where.length - a.where.length
);

console.log(`\n\n${"=".repeat(78)}\nFINDINGS — ${rows.length} distinct, ${failures} occurrence(s), ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
let lastKind = null;
for (const row of rows) {
  if (row.kind !== lastKind) {
    console.log(`\n${row.kind.toUpperCase()}`);
    lastKind = row.kind;
  }
  const formats = [...new Set(row.where.map((w) => w.split(" ")[0]))];
  console.log(`   ${row.detail}`);
  console.log(`      at ${formats.length} format(s): ${formats.slice(0, 8).join(", ")}${formats.length > 8 ? ` +${formats.length - 8}` : ""}`);
}

const noteRows = [...notes.values()].sort((a, b) => b.where.length - a.where.length);
if (noteRows.length > 0) {
  console.log(`\n\nREPORTED, NOT FAILED — ${noteRows.length} box(es) that are not the shape of what is in them\n`);
  for (const row of noteRows) {
    const formats = [...new Set(row.where.map((w) => w.split(" ")[0]))];
    console.log(`   ${row.detail}`);
    console.log(`      at ${formats.length} format(s): ${formats.slice(0, 8).join(", ")}${formats.length > 8 ? ` +${formats.length - 8}` : ""}`);
  }
}

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
}

console.log(`\n   saved screenshots/fit-*.png`);
console.log(
  failures === 0
    ? `\nPASS — ${VIEWPORTS.length * SCALES.length * ROUTES.length} measurements, nothing clipped, buried, squashed or snapped. Real hardware is still untested.\n`
    : `\n${rows.length} DISTINCT FAILURE(S) across ${failures} occurrence(s)\n`
);
await browser.close();
void devices;
process.exit(failures === 0 ? 0 : 1);
