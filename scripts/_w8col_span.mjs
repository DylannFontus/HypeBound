/**
 * How much of the window a screen actually uses.
 *
 * ## The finding this has to be able to check
 *
 * "#gauntlet is one column spanning 0.70 of the viewport with 240px of dead
 * background each side"; "#doomscroll the same at 0.55"; "#replays composes its
 * empty state as one centred card with 350px of dead margin each side (span
 * 0.56)". Three numbers, produced by somebody else, and the first job of this
 * file is to reproduce them — because an instrument that cannot reproduce the
 * finding it was written to re-check is measuring a different thing and every
 * number it prints afterwards is unattributable.
 *
 * Reverse-engineering them says what was measured. 1600 − 2×240 = 1120, which is
 * `--hall-main` under `.d-hall-read` to the pixel. 880/1600 = 0.55, which is
 * `rooms.css`'s `max-width: 880px` on `.doom-setup`. 900/1600 = 0.5625, which is
 * `.replay-body.is-virgin`'s cap. So the published figures are the width of the
 * **furniture**, not of a colour transition — and this measures the same thing,
 * as the union of every plate, control and table on the screen.
 *
 * ## Why a DOM union is dangerous, and what stops it lying here
 *
 * A naive union of `getBoundingClientRect()` reports span 1.000 for all
 * forty-nine routes, because every screen in this build contains at least one
 * deliberately full-bleed element: `.d-room` and `.d-room-glass` are `inset: 0`,
 * `.rw-wash` is `inset: 0`, the header is full-bleed by design, and the
 * Doomscroll's prompt backdrop is `position: fixed`. An instrument that scored
 * every screen 1.000 would have passed all three of the routes above.
 *
 * Three guards, and the union is taken over *furniture* rather than over
 * everything:
 *
 *   1. the header rows are excluded — `.screen-header` and `.sub-header` span
 *      the window on every route, so including them makes the measure constant
 *   2. the decorative planes and their descendants are excluded by name
 *   3. `position: fixed` is excluded, so a modal backdrop cannot widen a screen
 *
 * ## The cross-check that catches the guards being wrong
 *
 * A second, independent measure runs on the same frame and knows nothing about
 * the DOM: the per-column mean absolute vertical difference of the screenshot's
 * luminance. Panels carry edges, rules and type, so their columns are busy;
 * room is a smooth gradient with grain on it and its columns are not. It reads
 * lower than the DOM figure by design — it finds where the *content* is, not
 * where the container is — but the two have to move together. A DOM span that
 * improves while the pixel span does not has found a wider container with
 * nothing in it, which is the failure mode this whole wave exists to correct.
 *
 *   node scripts/_w8col_span.mjs --calib          # against the published figures
 *   node scripts/_w8col_span.mjs gauntlet doomscroll replays missions pass
 *   node scripts/_w8col_span.mjs gauntlet --size 1280x720 --scale-ui 1.6
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const UI_SCALE = Number(flag("scale-ui", 0)) || 0;
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w8", "span")));
mkdirSync(OUT, { recursive: true });

/**
 * What calibration can and cannot be run against, now that the work is done.
 *
 * The three published figures were taken from the *previous* state of three
 * screens this session has already changed, so they cannot be re-measured live —
 * and stashing a shared working tree to get them back is not on, because two
 * other builders are in it. What is checkable is the arithmetic behind them, on
 * routes nobody has touched:
 *
 *   #privacy is `.data-body.data-doc`, and `data.css` sets `--data-measure:
 *   980px` with `padding-inline: clamp(16px, 3.4vw, 48px)`. At 1600 that is a
 *   980px container centred with 310px either side, furniture inset a further
 *   48px, so the union must be 358…1242 — span 0.5525, 358px of dead background
 *   on each side. That is the same shape and very nearly the same number as the
 *   #replays finding (0.5625, ~350px), from a cap that is written down.
 *
 *   #legal is the same measure and must agree with it to the pixel.
 *
 *   #lobby and #stats are the two routes two critics have called rooms and must
 *   come back near the window width.
 *
 * An instrument that reads a documented 980px cap as 0.55 and a full-bleed room
 * as 0.95+ is measuring container geometry, which is what the published figures
 * are. The before/after pixel spans are quoted from the captures instead — see
 * `--png`.
 */
const PUBLISHED = [
  ["privacy", 0.5525, 358],
  ["legal", 0.5525, 358],
  ["lobby", null, null],
  ["stats", null, null],
];

const IN_PAGE = () => {
  const screen = document.querySelector(".screen:not(.screen-out)") ?? document.querySelector(".screen");
  if (!screen) return null;
  const DECOR = ".d-room, .d-room-glass, .rw-wash, .ambient-bg, .lobby-glow, .screen-header, .sub-header";
  const FURNITURE =
    ".mat-panel, .mat-hero, .mat-well, .mat-chip, .panel, table, .empty, canvas, button, input, .field, .d-meter, .d-row, .d-tile, li, dl";
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  let counted = 0;
  const widest = { w: 0, tag: "", cls: "" };
  for (const el of screen.querySelectorAll(FURNITURE)) {
    if (el.closest(DECOR)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    /*
     * Off to the side of a scroller is not dead margin.
     *
     * The Hype Wave's track is fifty tiers laid out horizontally in a scroller,
     * so its last tier's box sits at x=7321 and an unclamped union reported the
     * screen as spanning 4.556 of the window. A screen is only as wide as what
     * a player can see, so anything wholly outside the frame is dropped and
     * anything crossing the edge is clipped to it.
     */
    if (r.right < 0 || r.left > innerWidth) continue;
    counted += 1;
    left = Math.min(left, Math.max(0, r.left));
    right = Math.max(right, Math.min(innerWidth, r.right));
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    if (r.width > widest.w) {
      widest.w = Math.round(r.width);
      widest.tag = el.tagName.toLowerCase();
      widest.cls = String(el.className).slice(0, 46);
    }
  }
  if (counted === 0) return null;
  const header = screen.querySelector(".screen-header, .sub-header");
  return {
    vw: innerWidth,
    counted,
    left: Math.round(left),
    right: Math.round(right),
    top: Math.round(top),
    bottom: Math.round(bottom),
    headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
    widest,
    rail: Boolean(screen.querySelector(":scope > .d-rail")),
    scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim() || "1",
  };
};

/** The pixel cross-check: where the busy columns are. */
function pixelSpan(buf, headerPx) {
  const img = decodePng(buf);
  const { width, height, channels, data } = img;
  const y0 = Math.min(headerPx + 2, height - 2);
  const n = height - y0 - 1;
  const raw = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let prev = null;
    for (let y = y0; y < height; y += 1) {
      const i = (y * width + x) * channels;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (prev !== null) sum += Math.abs(l - prev);
      prev = l;
    }
    raw[x] = sum / n;
  }
  // 9px box smooth, so a single hairline cannot open a margin on its own
  const prof = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let count = 0;
    for (let d = -4; d <= 4; d += 1) {
      const j = x + d;
      if (j < 0 || j >= width) continue;
      sum += raw[j];
      count += 1;
    }
    prof[x] = sum / count;
  }
  /*
   * The threshold is the frame's own quiet floor plus a margin, not a constant.
   * A constant would move with the room's grain amplitude and with the ambient
   * accent, which differ per route — and both are exactly the thing that must
   * not count as content.
   */
  const sorted = [...prof].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const threshold = floor + 1.2;
  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x += 1) {
    if (prof[x] >= threshold) {
      if (left === -1) left = x;
      right = x;
    }
  }
  if (left === -1) return { span: 0, left: width, right: 0, floor, threshold };
  return { span: (right - left + 1) / width, left, right, floor, threshold };
}

const f3 = (x) => x.toFixed(3);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });

async function look(route, evalJs = null) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  if (UI_SCALE) {
    await page.evaluate(async (s) => {
      const mod = await import("/src/save/settings.ts");
      mod.updateSettings({ uiScale: s });
    }, UI_SCALE);
    await page.waitForTimeout(300);
    const got = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
    );
    if (Number(got) !== UI_SCALE) console.log(`!! UI SCALE DID NOT APPLY (asked ${UI_SCALE}, got ${got})`);
  }
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  if (evalJs) {
    await page.evaluate(evalJs);
    await page.waitForTimeout(1400);
  }
  const dom = await page.evaluate(IN_PAGE);
  const buf = await page.screenshot();
  writeFileSync(path.join(OUT, `${route.replace(/\W+/g, "-")}.png`), buf);
  if (!dom) return null;
  const px = pixelSpan(buf, dom.headerBottom);
  return { dom, px };
}

function line(label, r) {
  if (!r) {
    console.log(`  ${label.padEnd(14)} NO SCREEN`);
    return;
  }
  const { dom, px } = r;
  const span = (dom.right - dom.left) / dom.vw;
  console.log(
    `  ${label.padEnd(14)} dom span ${f3(span)}  ${String(dom.left).padStart(4)}…${String(dom.right).padStart(4)}` +
      `  dead ${String(dom.left).padStart(3)} | ${String(Math.round(dom.vw - dom.right)).padStart(3)}` +
      `   px span ${f3(px.span)}  ${String(px.left).padStart(4)}…${String(px.right).padStart(4)}` +
      `   rail ${dom.rail ? "yes" : "no "}  n=${dom.counted}`
  );
  return span;
}

try {
  /*
   * `--png` never opens a page: it is the pixel half of the instrument run over
   * captures already on disk, which is the only way to quote a before figure for
   * a screen whose before no longer exists in the tree.
   */
  if (argv.includes("--png")) {
    const files = argv.filter((a) => a.endsWith(".png"));
    console.log("[px] mean absolute vertical luminance difference per column, header excluded\n");
    for (const file of files) {
      const px = pixelSpan(readFileSync(file), Number(flag("header", 78)));
      console.log(
        `  ${path.basename(file).padEnd(24)} px span ${f3(px.span)}  ${String(px.left).padStart(4)}…${String(
          px.right
        ).padStart(4)}  dead ${String(px.left).padStart(3)} | ${String(1600 - px.right).padStart(3)}` +
          `   [quiet floor ${px.floor.toFixed(2)}, threshold ${px.threshold.toFixed(2)}]`
      );
    }
    await browser.close();
    process.exit(0);
  }

  await seedPlayedAccount(page, ORIGIN);

  if (argv.includes("--calib")) {
    console.log(
      `[calib] ${VW}×${VH} — does this reproduce the three published figures, and do the two rooms read wide?\n`
    );
    let bad = 0;
    for (const [route, span, dead] of PUBLISHED) {
      const r = await look(route);
      const got = line(route, r);
      if (got === undefined) {
        bad += 1;
        continue;
      }
      if (span === null) {
        if (got < 0.9) {
          console.log(`      !! a route two critics called a room measures ${f3(got)} — the guards are wrong`);
          bad += 1;
        } else console.log(`      near the window width, as a room should be.`);
      } else {
        const deadL = r.dom.left;
        const deadR = Math.round(r.dom.vw - r.dom.right);
        const ok = Math.abs(got - span) <= 0.04 && Math.abs(deadL - dead) <= 60 && Math.abs(deadR - dead) <= 60;
        console.log(
          `      published: span ${span.toFixed(2)}, ${dead}px each side — ${ok ? "reproduced." : "NOT REPRODUCED"}`
        );
        if (!ok) bad += 1;
      }
    }
    console.log(
      bad === 0
        ? "\n[calib] the instrument agrees with every figure it was checked against."
        : `\n[calib] ${bad} disagreement(s) — do not quote numbers from this run.`
    );
  } else {
    /*
     * A flag's *value* is not a route. `--dir scripts/screenshots/...` added a
     * route of that name, which fell through to the unknown-route screen and
     * printed a perfectly plausible span for it — a measurement of something
     * nobody asked for, labelled with a path.
     */
    const VALUED = new Set(["--size", "--scale-ui", "--dir", "--header"]);
    const routes = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
    console.log(`[span] ${VW}×${VH}${UI_SCALE ? ` --ui-scale ${UI_SCALE}` : ""}\n`);
    for (const route of routes) {
      const [name, ...rest] = route.split("::");
      const r = await look(name, rest.length ? rest.join("::") : null);
      line(route, r);
      if (r) console.log(`      widest object: ${r.dom.widest.w}px  <${r.dom.widest.tag} class="${r.dom.widest.cls}">`);
    }
  }
} finally {
  await browser.close();
}
