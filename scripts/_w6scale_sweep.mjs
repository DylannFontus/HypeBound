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
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

  const all = [...screen.querySelectorAll("*")];
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
    const lost = Math.max(vertical, horizontal);
    const canReach = reachable(el, b, axis);
    /*
     * A row that has been scrolled entirely out of view is not a defect, it is a
     * list. Only a box that is *half* on screen is being sliced, and only that
     * one wants an edge treatment.
     */
    if (canReach && lost >= (axis === "y" ? b.height : b.width) - 1) continue;
    const row = {
      el: name(el),
      axis,
      lost: R(lost),
      of: R(axis === "y" ? b.height : b.width),
      text: text(el),
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

  return {
    docScrollW: document.documentElement.scrollWidth,
    vw: vpW,
    hardClip: hardClip.sort((a, b) => b.lost - a.lost).slice(0, 12),
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
await seedPlayedAccount(page, ORIGIN);

const report = {};
for (const pct of SCALES) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim());
  console.log(`\n===== ui-scale ${pct}% (root reports ${got}) @ ${vw}x${vh} =====`);

  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    const r = await page.evaluate(PROBE);
    report[`${pct}|${route}`] = r;
    const counts = r.error
      ? r.error
      : [
          r.docScrollW > r.vw + 2 ? `H-SCROLL ${r.docScrollW}>${r.vw}` : "",
          r.hardClip.length ? `clip:${r.hardClip.length}` : "",
          r.hiddenOverflow.length ? `hidden:${r.hiddenOverflow.length}` : "",
          r.wordBreak.length ? `wordbreak:${r.wordBreak.length}` : "",
          r.overlap.length ? `overlap:${r.overlap.length}` : "",
        ]
          .filter(Boolean)
          .join(" ") || "ok";
    console.log(`  ${route.padEnd(14)} ${counts}`);
    if (!r.error) {
      for (const c of r.hardClip.slice(0, 5)) console.log(`      CLIP ${c.axis} -${c.lost} of ${c.of}px  ${c.el}  "${c.text}"`);
      for (const c of r.hiddenOverflow.slice(0, 3)) console.log(`      EDGE ${c.axis} -${c.lost} of ${c.of}px  ${c.el}  "${c.text}"`);
      for (const c of r.wordBreak.slice(0, 4)) console.log(`      WORD "${c.word}" over ${c.lines} lines  ${c.el}`);
      for (const c of r.overlap.slice(0, 3))
        console.log(`      OVER ${c.ix}x${c.iy}  ${c.a} "${c.aText}"  X  ${c.b} "${c.bText}"`);
    }
    if (shots) await page.screenshot({ path: path.join(dir, `${route}-${pct}-${vw}x${vh}.png`) });
  }
}
writeFileSync(path.join(dir, `report-${vw}x${vh}.json`), JSON.stringify(report, null, 1));
console.log(`\nwrote ${path.join(dir, `report-${vw}x${vh}.json`)}`);
await browser.close();
