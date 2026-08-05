/**
 * Does a screen have a *composition*, or is it a column of slabs?
 *
 * The census counts class names. That is exactly why it could report "every one
 * of 49 routes uses the material system" while a critic looked at eleven of them
 * and saw documents: correct materials, wrong composition. A material is a
 * property of a surface; a composition is a property of the arrangement, and no
 * amount of counting `.mat-panel` can see the difference.
 *
 * So this measures the arrangement, and only the arrangement:
 *
 *   cols     distinct vertical columns, found by clustering the x-centres of the
 *            screen's *layout children* — the first descendants that are wide or
 *            tall enough to be furniture rather than text. Two panels side by
 *            side is two columns; eleven panels stacked is one.
 *   span     the horizontal extent of all content, as a fraction of the viewport.
 *            The previous critic's claim was "one ~1100px column on 240-360px of
 *            empty background either side" — that is span ≈ 0.69 with ~0.15 dead
 *            on each edge. A composed screen puts furniture near both edges.
 *   deadL/R  the actual dead margin in px on each side, which is the half of the
 *            claim that a span alone hides: content can span 90% and still be
 *            centred badly.
 *
 * ## Why the x-centre and not the box
 *
 * A full-width header rail spans the viewport and belongs to no column; a probe
 * that clustered *edges* would count it as two. Clustering centres puts the rail
 * in the middle and side-by-side panels in their own clusters, which is what the
 * eye does. Rails and anything spanning >85% of the content width are excluded
 * from the column count for the same reason and counted separately.
 *
 * ## Why "layout children" are found by descent rather than by selector
 *
 * Every screen nests differently — some put their columns under `.screen`, some
 * under a `.data-room` wrapper, some two levels down. A hard-coded selector would
 * measure whichever screens happened to match and silently report one column for
 * the rest, which is the census's own failure mode wearing a different hat. So
 * this descends from `.screen` through any single-child or full-width wrapper
 * until it reaches a node whose children actually differ in x, and reports the
 * depth it had to go so the reading can be checked rather than trusted.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const argv = process.argv.slice(2);
const SIZE = (argv.find((a) => a.startsWith("--size=")) ?? "--size=1600x900").split("=")[1];
const [VW, VH] = SIZE.split("x").map(Number);
const routes = argv.filter((a) => !a.startsWith("--"));

function survey() {
  const screen = document.querySelector(".screen");
  if (!screen) return { err: "no .screen" };
  const vw = window.innerWidth;

  /**
   * Decoration is not layout, and the first version of this probe could not tell
   * the difference.
   *
   * `room()` injects `.d-room` — an `aria-hidden`, `position:absolute`,
   * pointer-transparent stack of alcove/wall/floor/dust planes that deliberately
   * overhangs the viewport so its gradients have somewhere to come from. It is
   * the *first* child of most screens. The probe descended into it, found one
   * child, and reported every recomposed screen as `cols=1 span=2.20
   * deadL=-1450` — a confident wrong answer of exactly the kind this project
   * keeps collecting. Worse, it was wrong in the direction that would have
   * confirmed the previous critic's complaint, so it would have been believed.
   *
   * A node counts as layout only if it is in flow, visible, hit-testable and not
   * hidden from the accessibility tree. That single filter is what separates the
   * furniture from the lighting.
   */
  const isLayout = (e) => {
    if (e.hasAttribute("aria-hidden")) return false;
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (cs.position === "absolute" || cs.position === "fixed") return false;
    if (cs.pointerEvents === "none") return false;
    const b = e.getBoundingClientRect();
    return b.width > 40 && b.height > 24;
  };

  /**
   * The header is not the composition, and descending found it every time.
   *
   * The second version of this probe walked down from `.screen` until it met a
   * node whose children differed in x. On every route in the game that node is
   * the header — a Back button on the left, a title in the middle, a count on
   * the right — so the probe measured the *title bar* of eleven screens and
   * reported `span 0.53, deadR 707`, which reads as "one narrow column floating
   * in dead space" and is a description of a Back button. It agreed with the
   * complaint it was built to test, which is the most dangerous way for an
   * instrument to be wrong.
   *
   * So there is no descent now. Every route's header is located and excluded by
   * geometry rather than by class name, and the composition is taken from the
   * **outermost content blocks below it**: any in-flow box big enough to be
   * furniture that has no other qualifying box as an ancestor. That is the set
   * the eye sees as "the panels on this screen", independent of how many
   * wrappers a given screen happens to nest them in.
   */
  const headerBottom = (() => {
    const h = screen.querySelector(".screen-header, .sub-header, header");
    return h ? h.getBoundingClientRect().bottom : 0;
  })();

  const MIN_W = 150;
  const MIN_H = 80;
  const qualifies = (e) => {
    if (!isLayout(e)) return false;
    const b = e.getBoundingClientRect();
    if (b.width < MIN_W || b.height < MIN_H) return false;
    if (b.top < headerBottom - 4) return false; // header row, or above it
    if (b.bottom < 0 || b.top > window.innerHeight * 3) return false;
    return true;
  };

  const all = [...screen.querySelectorAll("*")].filter(qualifies);
  /** Keep only the outermost: a panel inside a panel is not another column. */
  const outer = all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
  if (!outer.length) return { err: "no content blocks below the header" };

  const boxes = outer.map((e) => {
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, w: b.width, c: b.left + b.width / 2, cls: String(e.className).slice(0, 28) };
  });
  const depth = 0;
  const host = screen;

  const contentW = Math.max(...boxes.map((b) => b.r)) - Math.min(...boxes.map((b) => b.l));
  const rails = boxes.filter((b) => b.w > contentW * 0.85);
  const cells = boxes.filter((b) => b.w <= contentW * 0.85);

  /** Cluster centres; anything within 80px is the same column. */
  const centres = cells.map((b) => b.c).sort((a, b) => a - b);
  let cols = 0;
  let last = -Infinity;
  for (const c of centres) {
    if (c - last > 80) cols += 1;
    last = c;
  }

  const left = Math.min(...boxes.map((b) => b.l));
  const right = Math.max(...boxes.map((b) => b.r));
  return {
    depth,
    host: String(host.className).slice(0, 24),
    n: boxes.length,
    rails: rails.length,
    cols: cols || (rails.length ? 1 : 0),
    span: (right - left) / vw,
    deadL: Math.round(left),
    deadR: Math.round(vw - right),
  };
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
await seedPlayedAccount(page, ORIGIN);

console.log(`\n=== composition @ ${VW}x${VH} ===`);
console.log(`route         cols rails  span  deadL deadR  host`);
for (const route of routes) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(1300);
  const r = await page.evaluate(survey);
  if (r.err) {
    console.log(`${route.padEnd(13)} ${r.err}`);
    continue;
  }
  console.log(
    `${route.padEnd(13)} ${String(r.cols).padStart(4)} ${String(r.rails).padStart(5)}  ` +
      `${r.span.toFixed(2)}  ${String(r.deadL).padStart(5)} ${String(r.deadR).padStart(5)}  ` +
      `d${r.depth} .${r.host}`
  );
}
await browser.close();
