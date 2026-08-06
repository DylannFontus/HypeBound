/**
 * Can a finger start a match — asked by an instrument that shares no code with
 * the one that fixed it.
 *
 * Wave 8 found the mulligan's Confirm button 32px below the fold at 844x390 /
 * 160%, inside an `overflow: hidden` ancestor, and found that nine waves of
 * automated checks had passed it because Playwright's `.click()` calls
 * `scrollIntoViewIfNeeded` before dispatching. A builder then repaired it and
 * wrote `_w9mull_gesture.mjs` to prove the repair. This file exists because a
 * repair proven only by its author's own instrument is proven by one instrument,
 * and this project has been lied to by eleven.
 *
 * So: independent detector, independent geometry, independent dispatch path.
 * Where `_w9mull_gesture.mjs` polls `.mulligan-overlay` for the class `leaving`,
 * this one asks a different question entirely — **is the player's hand on the
 * board and is it their turn** — because a mulligan overlay that is merely gone
 * is not the same claim as a match that has started. An overlay can be removed
 * by an error boundary.
 *
 * ## The three controls, and why none of them is optional
 *
 * POSITIVE  1280x720 at 100%, where nobody has ever claimed the button is out of
 *           reach. If the raw tap cannot start a match there, this harness cannot
 *           dispatch and every negative below is a fact about the script.
 * NEGATIVE  the same tap at coordinates 200px BELOW the button's own centre,
 *           inside the panel and away from every screen edge (Chrome arbitrates
 *           an edge touch into a back-swipe, which reads as "advanced"). The
 *           match must not start. If it does, the harness is advancing by some
 *           route other than the button.
 * OFFSCREEN the same tap at the coordinates the button *would* have if it were
 *           past the fold — deliberately below `innerHeight`. Chrome must refuse
 *           it. This is the control that proves an off-screen coordinate really
 *           is a miss and not silently clamped into the viewport.
 *
 * ## The grid
 *
 * The detector is one `page.evaluate` returning a small object. The wall-clock
 * gap between consecutive polls is recorded and printed, because instrument
 * eleven in this project measured an ~830ms sample interval against a floor
 * written for 200ms and never timed itself. `--settle` is 6s — far longer than
 * the mulligan exit plus the board build — so a slow machine cannot be mistaken
 * for an unreachable button.
 *
 *   node scripts/_ic9_finger.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const SETTLE = Number(arg("settle", 6000));
const POLL = Number(arg("poll", 60));
const TRIALS = Number(arg("trials", 3));
const DIR = "scripts/screenshots/w9/ic9-finger";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  hasTouch: true,
  isMobile: false,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

await seedPlayedAccount(page, ORIGIN);

/** Set the interface size through the accessibility screen's own control. */
async function setScale(scale) {
  const pct = `${Math.round(scale * 100)}%`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: new RegExp(`^${pct.replace(/[.]/g, "\\.")}$`) }).first().click();
  await page.waitForTimeout(400);
  const got = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
  );
  if (Math.abs(Number(got) - scale) > 0.001) throw new Error(`scale did not take: asked ${scale}, root says ${got}`);
}

/**
 * Where Confirm is, measured from the element the *player* would press.
 *
 * Deliberately found by text rather than by the class the repair touched, so a
 * repair that renamed the button rather than moving it cannot pass this.
 */
const GEOM = () => {
  const buttons = [...document.querySelectorAll(".mulligan-overlay button, .mulligan-panel button")];
  const btn = buttons.find((b) => /confirm|keep|mulligan|start|ready/i.test(b.textContent ?? "")) ?? buttons.at(-1);
  if (!btn) return { error: "no button in the mulligan" };
  const r = btn.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const el = document.elementFromPoint(cx, cy);
  return {
    label: (btn.textContent ?? "").trim().slice(0, 40),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    height: Math.round(r.height),
    cx,
    cy,
    vh: window.innerHeight,
    vw: window.innerWidth,
    below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    // the fraction of the button's own height that is actually on screen
    visibleFraction: Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / (r.height || 1),
    hit: el ? `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0] ?? ""}` : null,
    hitIsButton: el ? btn.contains(el) || el === btn : false,
    scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
  };
};

/**
 * Has a MATCH started — not merely "has an overlay left".
 *
 * A mulligan overlay can vanish because the screen threw. The question the
 * player cares about is whether there is a hand, a board and a turn, so that is
 * what is asked: cards in the hand bar, a live board root, and no mulligan.
 */
const PLAYING = () => {
  const mull = document.querySelector(".mulligan-overlay:not(.leaving)");
  const hand = document.querySelectorAll(".hand-bar .hand-card, .hand-card").length;
  const board = document.querySelector(".battle-board, .board-root, canvas");
  return { mulligan: Boolean(mull), hand, board: Boolean(board), playing: !mull && hand > 0 && Boolean(board) };
};

async function waitPlaying(ms, poll) {
  const t0 = Date.now();
  const gaps = [];
  let last = null;
  let streak = 0;
  let final = null;
  while (Date.now() - t0 < ms) {
    const at = Date.now();
    if (last !== null) gaps.push(at - last);
    last = at;
    let s;
    try {
      s = await page.evaluate(PLAYING);
    } catch {
      s = { playing: false, lostContext: true };
    }
    final = s;
    streak = s.playing ? streak + 1 : 0;
    if (streak >= 2) return { playing: true, ms: Date.now() - t0, gaps, final };
    await new Promise((r) => setTimeout(r, poll));
  }
  return { playing: false, ms: Date.now() - t0, gaps, final };
}

async function openMulligan(route, w, h) {
  await page.setViewportSize({ width: w, height: h });
  const sep = route.includes("?") ? "&" : "?";
  await page.goto(`${ORIGIN}/?nointro#${route}${sep}r=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".mulligan-panel").length === 1, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
  await page.waitForTimeout(900);
}

/** Raw hardware tap. No locator, no scrollIntoViewIfNeeded, nothing nudged. */
async function tap(x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 14, radiusY: 14, force: 1 }],
  });
  await new Promise((r) => setTimeout(r, 70));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const allGaps = [];
const report = [];

// ---- POSITIVE CONTROL -------------------------------------------------------
await setScale(1);
await openMulligan("battle?seed=11", 1280, 720);
const pg = await page.evaluate(GEOM);
await tap(pg.cx, pg.cy);
const pos = await waitPlaying(SETTLE, POLL);
allGaps.push(...pos.gaps);
console.log(
  `POSITIVE  battle 1280x720 @100%  button "${pg.label}" at (${pg.cx},${pg.cy}) hit=${pg.hit} -> playing=${pos.playing} in ${pos.ms}ms  ${JSON.stringify(pos.final)}`
);
if (!pos.playing) {
  console.log("HARNESS CANNOT DISPATCH — every result below would be void.");
  await browser.close();
  process.exit(2);
}

// ---- OFFSCREEN CONTROL ------------------------------------------------------
// Prove that a coordinate past the fold really is a miss, and is not clamped.
await openMulligan("battle?seed=12", 1280, 720);
const og = await page.evaluate(GEOM);
await tap(og.cx, og.vh + 120);
const off = await waitPlaying(1800, POLL);
allGaps.push(...off.gaps);
console.log(
  `OFFSCREEN tap at (${og.cx},${og.vh + 120}) — 120px below the viewport -> playing=${off.playing} (MUST be false)`
);

const CASES = [
  { route: "battle?seed=21", w: 844, h: 390, scale: 1.6, name: "battle 844x390 @160%" },
  { route: "battle?seed=22", w: 844, h: 390, scale: 1.4, name: "battle 844x390 @140%" },
  { route: "battle?seed=23", w: 1280, h: 720, scale: 1.6, name: "battle 1280x720 @160%" },
  { route: "remix", w: 1280, h: 720, scale: 1, name: "remix 1280x720 @100%" },
  { route: "remix", w: 844, h: 390, scale: 1.6, name: "remix 844x390 @160%" },
];

let currentScale = 1;
for (const c of CASES) {
  if (c.scale !== currentScale) {
    await setScale(c.scale);
    currentScale = c.scale;
  }
  const trials = [];
  for (let t = 0; t < TRIALS; t += 1) {
    await openMulligan(c.route, c.w, c.h);
    const g = await page.evaluate(GEOM);
    if (t === 0) {
      await page.screenshot({ path: path.join(DIR, `${c.name.replace(/\W+/g, "-")}.png`) });
    }
    await tap(g.cx, g.cy);
    const r = await waitPlaying(SETTLE, POLL);
    allGaps.push(...r.gaps);
    trials.push({ g, r });
  }
  // NEGATIVE: same gesture, 200px lower than the button, still inside the sheet
  await openMulligan(c.route, c.w, c.h);
  const ng = await page.evaluate(GEOM);
  const nx = Math.round(ng.vw / 2);
  const ny = Math.max(24, Math.min(ng.vh - 24, ng.cy - Math.round(ng.vh * 0.45)));
  await tap(nx, ny);
  const neg = await waitPlaying(2000, POLL);
  allGaps.push(...neg.gaps);

  const worst = trials.find((t) => !t.r.playing) ?? trials.reduce((a, b) => (b.g.below > a.g.below ? b : a));
  report.push({ name: c.name, worst, trials, neg: { nx, ny, playing: neg.playing } });
  console.log(`\n=== ${c.name} ===`);
  console.log(
    `  root --ui-scale ${worst.g.scale}  viewport ${worst.g.vw}x${worst.g.vh}  button "${worst.g.label}" top ${worst.g.top} bottom ${worst.g.bottom} (h ${worst.g.height})`
  );
  console.log(
    `  below the fold ${worst.g.below}px   visible ${(worst.g.visibleFraction * 100).toFixed(0)}%   hit at centre ${worst.g.hit} (isButton ${worst.g.hitIsButton})`
  );
  console.log(
    `  RAW TAP -> ${trials.map((t) => `[below ${t.g.below}px ${t.r.playing ? "PLAYING" : "STUCK"} ${t.r.ms}ms]`).join(" ")}`
  );
  console.log(`  NEGATIVE tap at (${nx},${ny}) -> playing=${neg.playing} (MUST be false)`);
}

allGaps.sort((a, b) => a - b);
console.log(
  `\nsampler grid: ${allGaps.length} polls, gap min ${allGaps[0]}ms / median ${allGaps[Math.floor(allGaps.length / 2)]}ms / max ${allGaps.at(-1)}ms  (asked ${POLL}ms sleep, window ${SETTLE}ms)`
);
const bad = report.filter((r) => r.trials.some((t) => !t.r.playing));
const negBad = report.filter((r) => r.neg.playing);
console.log(`\nSTUCK configurations: ${bad.length ? bad.map((r) => r.name).join(", ") : "none"}`);
console.log(`NEGATIVE control fired on: ${negBad.length ? negBad.map((r) => r.name).join(", ") : "none — clean"}`);
console.log(`OFFSCREEN control: ${off.playing ? "FIRED — off-screen taps are being clamped, run is void" : "clean"}`);
if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(" | ")}`);
await browser.close();
