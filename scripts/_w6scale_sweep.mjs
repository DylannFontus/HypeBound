/**
 * The 160% sweep: what actually breaks when a player turns the text up.
 *
 * The a11y screen advertises seven steps to 160%, so 160% is a shipped state and
 * every route has to survive it. Eyeballing forty-nine screenshots at three
 * scales and two viewports is 294 images and nobody reads 294 images, so this
 * asks the page four questions that a still cannot answer on its own:
 *
 *   hardClip   — an element whose bottom falls past the window with nothing in
 *                the chain able to scroll to it. The row is not truncated, it is
 *                gone, and no amount of scrolling brings it back.
 *   hiddenOverflow — a box whose content is taller/wider than itself while its
 *                own `overflow` is `hidden`. Same thing one level down.
 *   wordBreak  — a *single word* whose Range spans two client rects, i.e. it has
 *                been broken mid-word. "Achieve/ments" is this measurement.
 *   overlap    — two text-bearing elements, neither containing the other, whose
 *                ink boxes intersect by more than a rounding error.
 *
 * The scale is set by CLICKING the control, never by writing `--ui-scale` onto
 * the root: the setting also drives JS-side layout decisions, so a hand-set
 * custom property photographs a state the game never enters. That trap is
 * recorded in `_ic3_scale.mjs` and it stays recorded here.
 *
 * ## WHY THIS FILE WAS REWRITTEN: 39 clips of which one was real
 *
 * The wave-8 run of this sweep reported 39 hard clips and 38 overlaps at 100%
 * on a 1280x720 desktop. Roughly **one** of them was a defect — and it was the
 * mulligan's Confirm button, the most serious thing found in nine waves, sitting
 * unreadable in the middle of a list of things that were all working exactly as
 * designed. A sweep whose signal-to-noise buries a blocking bug is worse than no
 * sweep, because it launders "nobody looked" into "we checked".
 *
 * The noise had one root cause worth naming: **`getBoundingClientRect()` answers
 * a layout question, and this file was asking a rendering one.** Four things
 * have a real box and are not a defect, and each has a rule below:
 *
 *   1. **Not painted at all.** The Board Mirror and every `.sr-only` /
 *      `.icon-label` beside it: a 1x1 box with `clip: rect(0 0 0 0)`, which
 *      cannot be `display: none` because the assistive tree would lose it. Its
 *      children are full-size text clipped to nothing with no scroller above
 *      them — this file's exact definition of a hard clip. Alongside them, the
 *      contents of a **collapsed `<details>`**: measured on `#signin` and
 *      `#uikit`, the first leaf inside a closed disclosure reports 769x42 at
 *      y=622, and 87x11 at **y=3183**, 2,400 pixels below a 720px window.
 *      → `paintable()`, built on `Element.checkVisibility()` — which already
 *      knows about `display: none`, `visibility: hidden`, zero opacity and
 *      `content-visibility: hidden`, the last being how Chrome hides a closed
 *      disclosure. Plus one explicit walk for the clip-rect pattern, the single
 *      case `checkVisibility` answers "visible" to and a human answers "no".
 *      Written against computed style, never a list of class names: a filter
 *      that knows `.board-mirror` fixes one report and lets the next
 *      visually-hidden block reproduce the whole problem.
 *   2. **On a different plane.** Modal text "overlapping" the board behind its
 *      own scrim. Six of these on `#remix` alone, and every modal in the game
 *      would have produced the same list. → `separatedByAPlane()`, which reads
 *      the paint stack at the disputed pixel and asks whether anything between
 *      the two carries a fill of its own.
 *   3. **Deliberately truncated.** `-webkit-line-clamp` is the vertical
 *      `text-overflow: ellipsis`, and this file already forgave the horizontal
 *      one. `.ability-text` is clamped to two lines, so at 140% the third line
 *      of a leader ability was filed as unreachable content on both mulligan
 *      routes.
 *   4. **Decoration rather than a control.** Not filtered — *ranked*. Pixels
 *      lost is the wrong sort order: a reward thumbnail parked off the end of a
 *      carousel loses six hundred of them and costs nobody anything, while the
 *      mulligan's Confirm lost forty-four and stopped the game. Clipped
 *      controls sort first and print as `*** UNREACHABLE CONTROL ***`.
 *
 * Nothing was deleted to achieve this. Every one of the original four detectors
 * is untouched; the diff is filters and ordering laid on top.
 *
 * ## A filter that removes noise has to be shown not to remove signal
 *
 * Which is the other half of the rewrite, and it runs before every sweep. The
 * calibration plants five things on the live lobby and demands the right answer
 * to all five: an unreachable `<button>` (must report, and must report *as a
 * control*), a screen-reader decoy (must not), two colliding text runs (must
 * report), one text run under an opaque plate (must not), and a line-clamped
 * paragraph (must not). Any disagreement stops the run.
 *
 * `--injectcss <file>` goes further and is the end-to-end proof: reverting the
 * mulligan's pinned footer on the live page puts Confirm 48px below the fold,
 * and the de-noised sweep still reports it — `*** UNREACHABLE CONTROL x1 ***`,
 * `CONTROL y -48 of 44px button.btn.btn-primary "Confirm"`.
 *
 * A quiet sweep is only good news if it can still fail.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};

const ROUTES = String(
  arg(
    "routes",
    [
      "lobby",
      "play",
      "collection",
      "decks",
      "shop",
      "banner",
      "missions",
      "mastery",
      "pass",
      "achievements",
      "events",
      "inbox",
      "news",
      "patchnotes",
      "profile",
      "stats",
      "leaderboards",
      "settings",
      "a11y",
      "fairness",
      "privacy",
      "legal",
      "support",
      "replays",
      "gallery",
      "lab",
      "doomscroll",
      "remixhub",
      "starter",
      "uikit",
      "deckbuilder",
      "tour",
      "story",
      "gauntlet",
      "custom",
      "signin",
      "cloudsave",
      "queue",
      /*
       * The two routes that open a mulligan, and they are on this list because
       * the one genuine defect the wave-8 run found was on one of them. A sweep
       * that cannot reach the screen where it found the worst bug of the project
       * is not a sweep of the game. `seed=4` deals a six-card hand going second,
       * which is the taller of the two opening-hand sentences and therefore the
       * worst case the ordinary mulligan can produce.
       */
      "battle?seed=4",
      "remix",
    ].join(",")
  )
).split(",");

const SCALES = String(arg("scales", "100,140,160")).split(",");
const [vw, vh] = String(arg("size", "1280x720")).split("x").map(Number);
const dir = String(arg("dir", "scripts/screenshots/w6/scale/sweep"));
const shots = process.argv.includes("--shots");
mkdirSync(dir, { recursive: true });

/** Run inside the page. Kept as one string so it can be re-declared per route. */
const PROBE = () => {
  const screen = document.querySelector(".screen");
  if (!screen) return { error: "no .screen" };

  const R = (n) => Math.round(n);
  const name = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
  };
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 44);

  /**
   * Is this element actually being painted?
   *
   * `checkVisibility` covers `display: none`, `visibility: hidden`, zero opacity
   * and — the one that matters most here — `content-visibility: hidden`, which
   * is how Chrome hides the contents of a closed `<details>`. Those contents
   * keep a real `getBoundingClientRect()`: measured at 769x42 on `#signin` and
   * 87x11 at y=3183 on `#uikit`, both of which this sweep used to file as hard
   * clips.
   *
   * The clip-rect walk is separate because it is the one case the platform
   * answers "yes, visible" to and a human answers "no": the screen-reader
   * pattern is a genuinely rendered 1x1 box with `clip: rect(0 0 0 0)`, and its
   * children are full-size text clipped to nothing with no scroller above them.
   * `.board-mirror`, `.board-mirror-live`, `.sr-only` and `.icon-label` are all
   * that shape. Matched on computed style rather than on those four selectors,
   * because a filter that knows four class names is a filter that will be wrong
   * about the fifth.
   */
  const EMPTY_CLIP = /^rect\(0px,? 0px,? 0px,? 0px\)$/;
  const paintable = (el) => {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
        return false;
      }
    }
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (EMPTY_CLIP.test(cs.clip)) return false;
      if (cs.clipPath === "inset(50%)") return false;
      // the same pattern written without `clip`: a 1px window with the overflow
      // shut. Two pixels of slack so a hairline is not mistaken for one.
      if (cs.overflow !== "visible") {
        const b = n.getBoundingClientRect();
        if (b.width <= 2 && b.height <= 2) return false;
      }
      n = n.parentElement;
    }
    return true;
  };

  const all = [...screen.querySelectorAll("*")].filter(paintable);
  const vpH = window.innerHeight;
  const vpW = window.innerWidth;

  // --- can the page itself scroll? -----------------------------------------
  const pageScrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 2;

  /**
   * Can the player get to the part of `rect` that is being cut?
   *
   * The first version of this walked up and gave up at the first ancestor with
   * `overflow: hidden`, which is the wrong question and produced the wrong
   * answer for the whole starter screen: every faction plate declares
   * `overflow: hidden` so its gradient stays inside its own radius, so the walk
   * stopped one element up and reported eleven unreachable rows in a list that
   * scrolls perfectly well. A box that clips *nothing* is not a clip.
   *
   * So: find the nearest ancestor that actually cuts this rectangle on this
   * axis, and ask that one. A scroller with room to move is reachable; a hidden
   * box is not.
   */
  const reachable = (el, rect, axis /* "y" | "x" */) => {
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

  /**
   * `scrollHeight > clientHeight` is not "content is being cut", and believing
   * it was cost this sweep its first two reports.
   *
   * An absolutely positioned decorative layer counts toward a box's scroll size.
   * `.rw-shop-hero::before` is inset **-10%** — a deliberate bleed so a drifting
   * gradient never walks its own edge into view — and the shop therefore came
   * back "-90px of content hidden in an 858px box" on every route that has a
   * lit alcove. Nothing was hidden; the light is meant to run past the wall.
   *
   * The honest question is about the ink: take each element that carries text or
   * is a picture, intersect its own rectangle with the clip rectangle of every
   * ancestor that clips, and see how much of it survives. That is what a player
   * can see. Whether the loss matters then depends on one further question —
   * can anything in the chain scroll to it — which separates a row that needs a
   * fade at its edge from a row that is simply gone.
   */
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

  const hardClip = [];
  const hiddenOverflow = [];
  const seenClip = new Set();

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const isInk =
      (el.children.length === 0 && (el.textContent || "").trim().length > 0) ||
      tag === "canvas" ||
      tag === "img";
    if (!isInk) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 6 || b.height < 6) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.15) continue;
    if (el.closest("[hidden], [aria-hidden='true']")) continue;

    const clip = clipChain(el);
    const lostTop = Math.max(0, clip.top - b.top);
    const lostBottom = Math.max(0, b.bottom - clip.bottom);
    const lostLeft = Math.max(0, clip.left - b.left);
    const lostRight = Math.max(0, b.right - clip.right);
    if (lostTop + lostBottom + lostLeft + lostRight < 2) continue;
    // an intentional single-line ellipsis is a design decision, not a defect
    if (cs.textOverflow === "ellipsis" && lostTop + lostBottom < 2) continue;

    const vertical = lostTop + lostBottom;
    const horizontal = lostLeft + lostRight;
    const axis = vertical >= horizontal ? "y" : "x";
    /*
     * A line clamp is the vertical `text-overflow: ellipsis`, and this file
     * already forgives the horizontal one two lines up.
     *
     * `.ability-text` is `-webkit-line-clamp: 2` — a leader ability's reminder
     * text, deliberately held to two lines inside a 79px button. At 140% the
     * third line exists in layout and is clipped away by design, so the sweep
     * filed `strong "Scorched"` as content nobody can reach, on both mulligan
     * routes, at two scales. Whether two lines is enough room at 160% is a
     * question for whoever owns the ability rail; it is not this instrument's
     * business to report a stated intent as an accident.
     */
    if (axis === "y") {
      let n = el;
      let clamped = false;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") { clamped = true; break; }
        n = n.parentElement;
      }
      if (clamped) continue;
    }
    const lost = Math.max(vertical, horizontal);
    const canReach = reachable(el, b, axis);
    /*
     * A row that has been scrolled entirely out of view is not a defect, it is a
     * list. Only a box that is *half* on screen is being sliced, and only that
     * one wants an edge treatment.
     */
    if (canReach && lost >= (axis === "y" ? b.height : b.width) - 1) continue;
    /*
     * Is the thing being cut something the player has to *use*?
     *
     * This is the axis the wave-8 report was missing, and it is why its one
     * real finding drowned. Twenty-five rows of clipped decoration and one
     * clipped button were printed in the same typeface, sorted by how many
     * pixels were lost — and pixels lost is the wrong ranking, because a
     * reward thumbnail parked off the end of a carousel loses six hundred of
     * them and costs nobody anything, while the mulligan's Confirm lost
     * forty-four and stopped the game.
     *
     * A clipped control is always a defect. A clipped image may be a design.
     * Both still get reported; only one gets shouted about.
     */
    const control = el.closest("button, a[href], input, select, textarea, [tabindex], [role='button'], [role='link'], [role='tab'], [role='menuitem']");
    const row = {
      el: name(el),
      axis,
      lost: R(lost),
      of: R(axis === "y" ? b.height : b.width),
      text: text(el),
      control: control ? `${control.tagName.toLowerCase()}${control.id ? "#" + control.id : ""}` : null,
    };
    const key = `${name(el)}|${axis}|${R(lost)}`;
    if (seenClip.has(key)) continue;
    seenClip.add(key);
    (canReach ? hiddenOverflow : hardClip).push(row);
  }

  // --- a single word broken across two lines --------------------------------
  const wordBreak = [];
  const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) continue;
    const host = node.parentElement;
    if (!host) continue;
    // Same filter as the clip pass: a word "broken over two lines" inside a
    // collapsed disclosure or a screen-reader mirror is not broken, it is not
    // on screen.
    if (!paintable(host)) continue;
    const hb = host.getBoundingClientRect();
    if (hb.width < 4 || hb.height < 4) continue;
    if (getComputedStyle(host).visibility === "hidden") continue;
    const re = /[^\s\u00a0]+/g;
    let m;
    while ((m = re.exec(raw))) {
      const word = m[0];
      if (word.length < 4) continue;
      // words that legitimately carry a break opportunity
      if (/[-\/\u2013\u2014]/.test(word)) continue;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + word.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (rects.length < 2) continue;
      // two rects on the SAME line is just a nested span, not a break
      const tops = new Set(rects.map((r) => Math.round(r.top)));
      if (tops.size < 2) continue;
      wordBreak.push({ el: name(host), word, lines: tops.size });
    }
  }

  /* --- two ink boxes on top of each other ------------------------------------
   *
   * Two corrections, both of which the first version of this probe got wrong and
   * both of which produced confident nonsense:
   *
   * 1. **Compare line boxes, not bounding boxes.** `<strong>…</strong> <span>…`
   *    inside one wrapped paragraph have bounding rects that cover the same
   *    block, because a bounding rect of a multi-line inline is the union of its
   *    lines. Every policy screen in the game came back "overlap:7" for text
   *    that is simply a sentence. `getClientRects()` returns the line boxes
   *    themselves, which is what the ink actually occupies.
   *
   * 2. **Clip against every scrolling ancestor.** A deck row eleven rows down a
   *    scroller has a rect below the scroller's own box, and that rect crosses
   *    the pinned footer — so the deck builder reported "Backup Dancer over Save
   *    Deck" while the player was looking at neither. Nothing outside the
   *    scroller's clip rect is on screen and nothing on screen can collide with
   *    it.
   */
  const clipRectOf = (el) => {
    let r = { left: 0, top: 0, right: vpW, bottom: vpH };
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== "visible" || cs.contain.includes("paint")) {
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
  const clampTo = (rect, clip) => {
    const left = Math.max(rect.left, clip.left);
    const top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.right, clip.right);
    const bottom = Math.min(rect.bottom, clip.bottom);
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };

  const overlap = [];
  const leaves = [];
  for (const el of all) {
    if (el.children.length > 0) continue;
    if (!(el.textContent || "").trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.15) continue;
    if (el.closest("[hidden], [aria-hidden='true']")) continue;
    const clip = clipRectOf(el);
    const boxes = [...el.getClientRects()]
      .filter((r) => r.width > 6 && r.height > 6)
      .map((r) => clampTo(r, clip))
      .filter(Boolean);
    if (boxes.length === 0) continue;
    leaves.push({ el, boxes });
  }
  /*
   * 3. **Two things on different planes are not colliding.**
   *
   * The de-noised sweep's first run reported six overlaps on `#remix`, every
   * one of them the mulligan sheet's own text against the *board underneath
   * it* — "DJ Last Call" crossing "Everything Is Content" through an opaque
   * plate and a 0.76 scrim and a 12px backdrop blur. Geometrically true, and
   * about as relevant as a complaint that page two of a book overlaps page
   * three. Every modal in the game would have produced the same list.
   *
   * The honest question is not "do the rectangles intersect" but "can the
   * player see both". `elementsFromPoint` answers it exactly: it returns the
   * paint stack at a pixel, topmost first, so if anything strictly between the
   * two carries a fill of its own — a background colour, a background image, or
   * a backdrop filter — the lower one is not on screen at that pixel and there
   * is nothing for a reader to trip over.
   *
   * Deliberately not a selector list. `.battle-overlay`, `.overlay` and
   * `.card-detail-overlay` would have covered today's modals and missed the
   * next one.
   */
  const separatedByAPlane = (a, b, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const ia = stack.findIndex((e) => e === a || e.contains(a));
    const ib = stack.findIndex((e) => e === b || e.contains(b));
    if (ia === -1 || ib === -1) return false;
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    for (let k = lo + 1; k < hi; k++) {
      const cs = getComputedStyle(stack[k]);
      if (cs.backdropFilter !== "none" && cs.backdropFilter !== "") return true;
      if (cs.backgroundImage !== "none") return true;
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      if (m) {
        const parts = m[1].split(/[ ,/]+/).filter(Boolean);
        const alpha = parts.length > 3 ? Number(parts[3]) : 1;
        if (alpha > 0.35) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const c = leaves[j];
      if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
      let best = null;
      for (const ra of a.boxes) {
        for (const rc of c.boxes) {
          const ix = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
          const iy = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
          if (ix <= 2 || iy <= 2) continue;
          const mx = (Math.max(ra.left, rc.left) + Math.min(ra.right, rc.right)) / 2;
          const my = (Math.max(ra.top, rc.top) + Math.min(ra.bottom, rc.bottom)) / 2;
          if (separatedByAPlane(a.el, c.el, mx, my)) continue;
          if (!best || ix * iy > best.ix * best.iy) best = { ix, iy };
        }
      }
      if (!best || best.ix * best.iy < 40) continue;
      overlap.push({
        a: name(a.el),
        b: name(c.el),
        aText: text(a.el),
        bText: text(c.el),
        area: R(best.ix * best.iy),
        ix: R(best.ix),
        iy: R(best.iy),
      });
    }
  }
  overlap.sort((x, y) => y.area - x.area);

  // Controls first, then by how much is missing. See the note on `control`.
  hardClip.sort((a, b) => (b.control ? 1 : 0) - (a.control ? 1 : 0) || b.lost - a.lost);

  return {
    docScrollW: document.documentElement.scrollWidth,
    vw: vpW,
    unreachableControls: hardClip.filter((c) => c.control).length,
    hardClip: hardClip.slice(0, 12),
    hiddenOverflow: hiddenOverflow.sort((a, b) => b.lost - a.lost).slice(0, 8),
    wordBreak: wordBreak.slice(0, 12),
    overlap: overlap.slice(0, 8),
  };
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });

/**
 * `--injectcss <file>` runs the whole sweep with an extra stylesheet applied.
 *
 * It exists so a repair can be un-done on the live page and the sweep re-run
 * against the defect it is supposed to catch — the strongest available proof
 * that a de-noising pass has not quietly de-noised the finding. Three lines
 * reverting the mulligan's pinned footer put its Confirm button back 48px below
 * the fold, and the sweep has to say so.
 */
const injectPath = arg("injectcss", null);
if (injectPath) {
  const css = readFileSync(String(injectPath), "utf8");
  await page.addInitScript((source) => {
    const apply = () => {
      const style = document.createElement("style");
      style.id = "sweep-injected";
      style.textContent = source;
      document.head.appendChild(style);
    };
    if (document.head) apply();
    else window.addEventListener("DOMContentLoaded", apply);
  }, css);
  console.log(`--injectcss ${injectPath}: the page is being altered for this run.`);
}

await seedPlayedAccount(page, ORIGIN);

/**
 * CALIBRATION: can this sweep still fail?
 *
 * Every filter added above removes rows, and the failure mode of a de-noising
 * pass is that it de-noises the finding as well. A quiet report is only worth
 * reading if the instrument that produced it has been shown to shout at
 * something it should shout at, in the same run, through the same code path.
 *
 * So: plant one control on the live lobby — a real button, with real text, at a
 * real size, positioned deliberately past the bottom of an `overflow: hidden`
 * box, which is the exact geometry the mulligan's Confirm had. If `PROBE` does
 * not file it as a hard clip, the run stops rather than publishing a clean
 * sheet. And plant one decoy beside it wearing the screen-reader pattern the
 * filter is *supposed* to swallow, so the calibration proves both directions at
 * once: the sweep must see the first and must not see the second.
 */
async function calibrate() {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const screen = document.querySelector(".screen");
    const box = document.createElement("div");
    box.id = "sweep-calibration";
    box.style.cssText =
      "position:absolute;left:40px;top:40px;width:260px;height:120px;overflow:hidden;";
    const bait = document.createElement("button");
    bait.textContent = "UNREACHABLE CONTROL";
    bait.style.cssText =
      "position:absolute;left:8px;top:150px;width:220px;height:44px;font-size:16px;color:#fff;background:#333;";
    const decoy = document.createElement("span");
    decoy.textContent = "SCREEN READER ONLY DECOY";
    decoy.style.cssText =
      "position:absolute;left:8px;top:8px;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
    box.appendChild(bait);
    box.appendChild(decoy);
    screen.appendChild(box);

    /*
     * ...and the same both-directions proof for the overlap channel, because
     * the occlusion rule added with it is the one most likely to swallow a real
     * finding. `COLLIDE ALPHA` and `COLLIDE BETA` sit on top of each other with
     * nothing between them and must be reported; `PLATED UNDER` sits beneath an
     * opaque plate and must not.
     */
    const pair = document.createElement("div");
    pair.id = "sweep-calibration-pair";
    /*
     * Opaque, because the control has to be isolated from the screen it is
     * planted on. Without it, at 844x390 and 160% the planted text landed on
     * top of the lobby's own labels and produced *genuine* collisions with
     * them — which the sweep correctly reported and the calibration then
     * mis-read as its plate rule having failed. A control that collides with
     * the thing it is measuring is measuring itself.
     */
    pair.style.cssText =
      "position:absolute;left:12px;top:12px;width:320px;height:200px;background:#0b0812;z-index:99;";
    const alpha = document.createElement("span");
    alpha.textContent = "COLLIDE ALPHA";
    alpha.style.cssText = "position:absolute;left:0;top:0;font-size:18px;color:#fff;";
    const beta = document.createElement("span");
    beta.textContent = "COLLIDE BETA";
    beta.style.cssText = "position:absolute;left:6px;top:2px;font-size:18px;color:#fff;";
    const under = document.createElement("span");
    under.textContent = "PLATED UNDER";
    under.style.cssText = "position:absolute;left:0;top:100px;font-size:18px;color:#fff;";
    const plate = document.createElement("div");
    plate.style.cssText = "position:absolute;left:0;top:90px;width:300px;height:60px;background:#101018;";
    const over = document.createElement("span");
    over.textContent = "PLATED OVER";
    over.style.cssText = "position:absolute;left:0;top:104px;font-size:18px;color:#fff;";
    // ...and one clamped block, which must be forgiven: two lines of a
    // four-line paragraph, held by `-webkit-line-clamp`, exactly as the ability
    // rail does it.
    const clamp = document.createElement("p");
    clamp.textContent = "CLAMPED PARAGRAPH " + "with a great deal more text than two lines can hold ".repeat(6);
    clamp.style.cssText =
      "position:absolute;left:0;top:160px;width:280px;font-size:14px;line-height:1.3;color:#fff;" +
      "overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;";
    pair.append(alpha, beta, under, plate, over, clamp);
    screen.appendChild(pair);
  });
  await page.waitForTimeout(300);
  const r = await page.evaluate(PROBE);
  // The bait is a <button>, so it has to come back flagged as a control and not
  // merely as a clip — the ranking is as much a part of this instrument as the
  // detection, and an unranked list is what buried the finding last time.
  const sawBait = r.hardClip.some((c) => c.text.includes("UNREACHABLE CONTROL") && c.control === "button");
  const sawDecoy = [...r.hardClip, ...r.hiddenOverflow].some((c) => c.text.includes("DECOY"));
  const sawCollide = r.overlap.some(
    (o) => `${o.aText}${o.bText}`.includes("COLLIDE ALPHA") && `${o.aText}${o.bText}`.includes("COLLIDE BETA")
  );
  const sawPlated = r.overlap.some(
    (o) => `${o.aText}${o.bText}`.includes("PLATED UNDER") && `${o.aText}${o.bText}`.includes("PLATED OVER")
  );
  const sawClamp = [...r.hardClip, ...r.hiddenOverflow].some((c) => c.text.includes("CLAMPED PARAGRAPH"));
  await page.evaluate(() => {
    document.getElementById("sweep-calibration")?.remove();
    document.getElementById("sweep-calibration-pair")?.remove();
  });
  const verdict = [
    ["planted hard clip", sawBait, true],
    ["screen-reader decoy", sawDecoy, false],
    ["planted overlap", sawCollide, true],
    ["overlap through an opaque plate", sawPlated, false],
    ["line-clamped paragraph", sawClamp, false],
  ];
  console.log(
    "calibration: " + verdict.map(([n, got, want]) => `${n} ${got ? "YES" : "NO"} (want ${want ? "YES" : "NO"})`).join("; ")
  );
  if (verdict.some(([, got, want]) => got !== want)) {
    console.log("CALIBRATION FAILED — this sweep cannot be trusted to see a real defect. Stopping.");
    await browser.close();
    process.exit(3);
  }
}
await calibrate();

const report = {};
for (const pct of SCALES) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim());
  console.log(`\n===== ui-scale ${pct}% (root reports ${got}) @ ${vw}x${vh} =====`);

  for (const route of ROUTES) {
    /*
     * A route that throws must cost one line, not the run.
     *
     * The wave-8 run died on `gallery` with "Execution context was destroyed",
     * thirty routes short of the end, and the twenty-nine it had already
     * measured went unreported because the summary is written at the bottom.
     * A sweep that cannot finish cannot be compared to the last one.
     */
    let r;
    try {
      await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
      await page
        .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      r = await page.evaluate(PROBE);
    } catch (e) {
      r = { error: `THREW: ${String(e).split("\n")[0].slice(0, 90)}` };
    }
    report[`${pct}|${route}`] = r;
    const counts = r.error
      ? r.error
      : [
          r.unreachableControls ? `*** UNREACHABLE CONTROL x${r.unreachableControls} ***` : "",
          r.docScrollW > r.vw + 2 ? `H-SCROLL ${r.docScrollW}>${r.vw}` : "",
          r.hardClip.length ? `clip:${r.hardClip.length}` : "",
          r.hiddenOverflow.length ? `hidden:${r.hiddenOverflow.length}` : "",
          r.wordBreak.length ? `wordbreak:${r.wordBreak.length}` : "",
          r.overlap.length ? `overlap:${r.overlap.length}` : "",
        ]
          .filter(Boolean)
          .join(" ") || "ok";
    console.log(`  ${route.padEnd(16)} ${counts}`);
    if (!r.error) {
      for (const c of r.hardClip.slice(0, 5)) {
        console.log(
          `      ${c.control ? "CONTROL" : "CLIP   "} ${c.axis} -${c.lost} of ${c.of}px  ${c.el}` +
            `${c.control ? ` inside <${c.control}>` : ""}  "${c.text}"`
        );
      }
      for (const c of r.hiddenOverflow.slice(0, 3)) console.log(`      EDGE ${c.axis} -${c.lost} of ${c.of}px  ${c.el}  "${c.text}"`);
      for (const c of r.wordBreak.slice(0, 4)) console.log(`      WORD "${c.word}" over ${c.lines} lines  ${c.el}`);
      for (const c of r.overlap.slice(0, 3))
        console.log(`      OVER ${c.ix}x${c.iy}  ${c.a} "${c.aText}"  X  ${c.b} "${c.bText}"`);
    }
    if (shots) {
      // `battle?seed=4` is a legal route and an illegal Windows filename.
      const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      await page.screenshot({ path: path.join(dir, `${slug}-${pct}-${vw}x${vh}.png`) });
    }
  }
}
writeFileSync(path.join(dir, `report-${vw}x${vh}.json`), JSON.stringify(report, null, 1));
console.log(`\nwrote ${path.join(dir, `report-${vw}x${vh}.json`)}`);
await browser.close();
