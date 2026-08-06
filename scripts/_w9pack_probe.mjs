/**
 * The pack room, measured rather than described — and measured with a clock that
 * says what it actually sampled.
 *
 * Eleven instruments have lied in this project and number eleven is the reason
 * this file exists in the shape it does: `_w7rw_probe.mjs::idle` sampled with
 * `screenshot()` and then `waitForTimeout(200)`, when one 1600x900 screenshot
 * costs about 620ms — so it published an ~830ms grid wearing a 200ms label.
 * Nothing here waits a nominal interval and then claims it. Two rules:
 *
 * 1. **Every sample carries the wall clock it was taken at**, read immediately
 *    before and after the read itself, and every mode prints the realised grid
 *    (min / median / max gap) beside its result. A cadence claim with no
 *    realised grid printed next to it is not a measurement.
 * 2. **Film comes from `Page.startScreencast`**, not from a loop of
 *    `screenshot()`. The browser timestamps each frame itself and pushes it when
 *    the compositor produces it, so the interval is whatever the page did rather
 *    than whatever the script asked for. `metadata.timestamp` is seconds of
 *    epoch, so it is converted once here and never inferred.
 *
 * Modes:
 *   shots            stills at the four beats: closed, mid-tear, dealt, revealed
 *   cadence          when each slot turns over, with the realised sample grid
 *   shadow <png>     is there a cast under the pack / under a card? Measured as
 *                    the luminance profile straight down through the object's
 *                    own centre line, so a shadow is a dip and its absence is a
 *                    flat line. A DOM node existing proves nothing.
 *   seam <png>       the wall/floor join: how straight, how graduated, how far
 *                    it runs uninterrupted
 *   film             CDP screencast of the whole set-piece, with real frame times
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { suppressHmrReload } from "./lib/nohmr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "shots";
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w9", "pack")));
const TAG = String(flag("tag", "base"));
mkdirSync(OUT, { recursive: true });

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/* ------------------------------------------------------------- pixel modes */

/**
 * A contact shadow is a *dip in luminance under the object*, and the only way to
 * be sure one is on screen is to walk down through it and watch the number fall
 * and come back. This reads the column band under a given box and prints the
 * profile, plus the depth of the dip against the floor either side of it.
 */
/**
 * Is there a cast under the object, or only under the *idea* of one?
 *
 * A paired comparison, because an absolute luminance says nothing on a floor
 * whose brightness is a gradient: the same scanlines are read directly beneath
 * each object and in the gaps beside it, and a real cast makes the first darker
 * than the second. It is immune to the two ways this measurement usually goes
 * wrong — a dark room reading as "shadow everywhere", and a caption chip sitting
 * in the band and reading as "no shadow" — because both land on the two sides of
 * the pair equally, and the caption is dodged by sampling the object's outer
 * quarters rather than its middle.
 *
 * Boxes come in as `--boxes x,y,w,h;x,y,w,h;…`, straight from the DOM read that
 * `shots` prints, so the probe never guesses where the subject is.
 */
if (mode === "cast") {
  const file = path.resolve(argv[1]);
  const img = decodePng(readFileSync(file));
  const { width, height, channels, data } = img;
  const boxes = String(flag("boxes", ""))
    .split(";")
    .filter(Boolean)
    .map((s) => s.split(",").map(Number));
  const drop = Number(flag("drop", 6));
  const depth = Number(flag("depth", 30));
  const patch = (x0, x1, y0, y1) => {
    let s = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1)
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
        s += lum(data, (y * width + x) * channels);
        n += 1;
      }
    return n ? s / n : 0;
  };
  console.log(`[cast] ${path.basename(file)}  band = base+${drop}..base+${drop + depth}`);
  let worst = 0;
  for (const [i, [bx, by, bw, bh]] of boxes.entries()) {
    const base = by + bh;
    const y0 = base + drop;
    const y1 = base + drop + depth;
    // Outer quarters of the object's own footprint, dodging any caption chip.
    const under = (patch(bx + 4, bx + Math.round(bw * 0.28), y0, y1) + patch(bx + Math.round(bw * 0.72), bx + bw - 4, y0, y1)) / 2;
    /*
     * Both neighbouring gaps, averaged, not one of them.
     *
     * The floor is lit by a pool centred on the room, so its brightness has a
     * strong left-right gradient: sampling only the gap to the right compares an
     * object against a patch of floor that is systematically brighter on the
     * left half of the row and darker on the right. Averaging the gaps either
     * side cancels any gradient that is locally linear, which this one is over
     * the width of one card, and it is the difference between a reading that
     * measures a shadow and one that measures the pool.
     */
    const prev = boxes[i - 1];
    const next = boxes[i + 1];
    const sides = [];
    // ±2px of inset, because the grid gap between two cards is 18px at
    // 1600x900 and a 6px inset each side left 6px, which the old 8px minimum
    // then threw away — three of five rows reported "beside L=0.00".
    const right = [bx + bw + 2, next ? next[0] - 2 : bx + bw + 46];
    const left = [prev ? prev[0] + prev[2] + 2 : bx - 46, bx - 2];
    for (const [a, b] of [left, right]) if (b - a >= 6) sides.push(patch(a, b, y0, y1));
    const beside = sides.reduce((s, v) => s + v, 0) / Math.max(1, sides.length);
    const ratio = beside / Math.max(0.5, under);
    worst = Math.max(worst, ratio);
    console.log(
      `       #${i} base y=${base}  under L=${under.toFixed(2)}  beside L=${beside.toFixed(2)}  ` +
        `beside/under = ${ratio.toFixed(2)}:1  ${ratio >= 1.35 ? "CAST" : "no cast"}`
    );
  }
  console.log(`[cast] strongest cast on the row: ${worst.toFixed(2)}:1 (>=1.35 reads as a shadow)`);
  process.exit(0);
}

if (mode === "shadow" || mode === "seam") {
  const file = path.resolve(argv[1] ?? path.join(OUT, `${TAG}-dealt.png`));
  const img = decodePng(readFileSync(file));
  const { width, height, channels, data } = img;
  const rowMean = (y, x0, x1) => {
    let s = 0;
    let n = 0;
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      s += lum(data, (y * width + x) * channels);
      n += 1;
    }
    return n ? s / n : 0;
  };

  if (mode === "shadow") {
    // Band and rows come from the caller, because where the object is depends on
    // the layout and guessing it is how a probe measures the wrong thing.
    const x0 = Number(flag("x0", Math.round(width * 0.42)));
    const x1 = Number(flag("x1", Math.round(width * 0.58)));
    const y0 = Number(flag("y0", Math.round(height * 0.45)));
    const y1 = Number(flag("y1", Math.round(height * 0.95)));
    console.log(`[shadow] ${path.basename(file)} band x=${x0}..${x1}`);
    const profile = [];
    for (let y = y0; y < y1; y += 1) profile.push([y, rowMean(y, x0, x1)]);
    const values = profile.map((p) => p[1]);
    const peak = Math.max(...values);
    const trough = Math.min(...values);
    const troughY = profile[values.indexOf(trough)][0];
    console.log(`         rows ${y0}..${y1}: peak L=${peak.toFixed(1)} trough L=${trough.toFixed(1)} at y=${troughY}`);
    console.log(`         contrast peak/trough = ${(peak / Math.max(0.5, trough)).toFixed(2)}:1`);
    for (let i = 0; i < profile.length; i += Math.max(1, Math.round(profile.length / 26))) {
      const [y, v] = profile[i];
      console.log(`         y=${String(y).padStart(4)}  L=${v.toFixed(1).padStart(6)}  ${"#".repeat(Math.round(v / 2))}`);
    }
    process.exit(0);
  }

  /**
   * The join, as an edge-detection problem rather than as an opinion.
   *
   * `--x0/--x1` restrict the columns, because the strongest vertical step in a
   * column that has a card in it is the card's own base, and a seam measurement
   * taken through the subject measures the subject.
   *
   * For every column, the row in the search band with the biggest vertical
   * luminance step is that column's idea of where the seam is. Three numbers
   * come out of it: how much of the width agrees on one row (dead-straight), how
   * big the step is (a line rather than a graduation), and how far the strongest
   * run goes without being interrupted by something standing on it.
   */
  const y0 = Number(flag("y0", Math.round(height * 0.45)));
  const y1 = Number(flag("y1", Math.round(height * 0.92)));
  const cx0 = Number(flag("x0", 0));
  const cx1 = Number(flag("x1", width));
  const edges = [];
  for (let x = cx0; x < cx1; x += 1) {
    let best = 0;
    let bestY = -1;
    for (let y = y0 + 2; y < y1 - 2; y += 1) {
      const above = (lum(data, ((y - 2) * width + x) * channels) + lum(data, ((y - 3) * width + x) * channels)) / 2;
      const below = (lum(data, ((y + 2) * width + x) * channels) + lum(data, ((y + 3) * width + x) * channels)) / 2;
      const step = Math.abs(above - below);
      if (step > best) {
        best = step;
        bestY = y;
      }
    }
    edges.push([x, bestY, best]);
  }
  const counts = new Map();
  for (const [, y] of edges) counts.set(y, (counts.get(y) ?? 0) + 1);
  const [modeY, modeN] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  // How many columns put the seam within two pixels of the modal row: that is
  // the fraction of the width that is one dead-straight horizontal line.
  const onLine = edges.filter(([, y]) => Math.abs(y - modeY) <= 2).length;
  let run = 0;
  let bestRun = 0;
  for (const [, y] of edges) {
    if (Math.abs(y - modeY) <= 2) {
      run += 1;
      bestRun = Math.max(bestRun, run);
    } else run = 0;
  }
  const steps = edges.map((e) => e[2]).sort((a, b) => a - b);
  const span = cx1 - cx0;
  console.log(`[seam] ${path.basename(file)} ${width}x${height} search y=${y0}..${y1} x=${cx0}..${cx1}`);
  console.log(`       modal seam row y=${modeY} claimed by ${modeN} columns`);
  console.log(
    `       columns within 2px of it: ${onLine}/${span} (${((onLine / span) * 100).toFixed(1)}%)  ` +
      `longest uninterrupted run ${bestRun}px (${((bestRun / span) * 100).toFixed(1)}% of the span)`
  );
  console.log(`       step size across the join: median ${steps[Math.floor(steps.length / 2)].toFixed(1)} L, max ${steps.at(-1).toFixed(1)} L`);
  // And how graduated it is: the luminance either side, four bands out.
  for (const d of [-40, -20, -8, -3, 0, 3, 8, 20, 40]) {
    const y = Math.min(height - 1, Math.max(0, modeY + d));
    console.log(`       y=${String(y).padStart(4)} (${d >= 0 ? "+" : ""}${d})  L=${rowMean(y, 0, width).toFixed(2)}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ browser */

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("!! pageerror", e.message));
page.on("console", (m) => m.type() === "error" && console.log("!! console", m.text()));

const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});

/**
 * Open the shop and buy, which is the only path that produces a real pull.
 *
 * HMR is neutered first. Four builders share this dev server and a save that is
 * not hot-acceptable calls `location.reload()`; caught mid-run it produced a
 * capture of the boot plate and a `castdiff` that reported "0 slots" on a screen
 * that was working perfectly. That is the same class of silent-miss as every
 * other instrument on this project's list, and `lib/nohmr.mjs` exists for it.
 */
async function toReveal() {
  await suppressHmrReload(page);
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
  await settled();
  await page.waitForTimeout(1200);
  await page.locator("#shop-buy").click({ timeout: 8000 });
  await page.waitForSelector(".rw-open", { timeout: 8000 });
  await page.waitForTimeout(1600);
}

/**
 * Click the pack the way a finger does.
 *
 * `locator.click()` waits for stability and the pack floats on a 5.2s loop for
 * as long as it exists, so it retries until the element detaches and then
 * reports a timeout on a screen that was working perfectly. That mistake is
 * already written up in `_w8rw_probe.mjs`; this is the same fix.
 */
async function tearPack() {
  const box = await page.locator("#rw-pack").boundingBox();
  if (!box) throw new Error("#rw-pack has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

try {
  if (mode === "shots") {
    await toReveal();
    await page.screenshot({ path: path.join(OUT, `${TAG}-closed.png`) });
    await tearPack();
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT, `${TAG}-tearing.png`) });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: path.join(OUT, `${TAG}-dealt.png`) });
    // Let the paced reveal run itself: the first auto flip is 1.8s after the
    // tear and each one after that 620ms, so five cards is about 4.3s.
    await page.waitForTimeout(5600);
    await page.screenshot({ path: path.join(OUT, `${TAG}-revealed.png`) });
    const geo = await page.evaluate(() => {
      const b = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      };
      const slots = [...document.querySelectorAll(".reveal-slot")].map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      });
      const room = document.querySelector(".rw-open-room");
      return {
        horizonPct: room && getComputedStyle(room).getPropertyValue("--rw-horizon").trim(),
        horizonPx:
          room &&
          Math.round(
            (parseFloat(getComputedStyle(room).getPropertyValue("--rw-horizon")) / 100) *
              room.getBoundingClientRect().height
          ),
        grid: b(".reveal-cards"),
        slots,
        shown: document.querySelectorAll(".reveal-slot.shown").length,
      };
    });
    console.log("[shots]", JSON.stringify(geo));
    for (const n of ["closed", "tearing", "dealt", "revealed"]) console.log(path.join(OUT, `${TAG}-${n}.png`));
  }

  if (mode === "cadence") {
    await toReveal();
    /**
     * The clock is the page's own, and the grid it realised is printed.
     *
     * Each sample records `performance.now()` inside the page *and* the count,
     * in one evaluate, so the timestamp belongs to the same tick as the reading.
     * The loop asks for 60ms and gets whatever it gets; what is reported is what
     * it got.
     */
    await page.evaluate(() => {
      window.__t0 = performance.now();
    });
    const t0 = Date.now();
    await tearPack();
    /**
     * `--click <n>` answers the other half of the brief's claim: that "the
     * per-card click has nothing to click". A real mouse click at the measured
     * centre of slot n, 900ms after the tear — after the deal has landed and
     * well before the first auto-flip at ~1.9s — and then the sampler reports
     * which index turned and when.
     */
    const clickIndex = flag("click", null);
    if (clickIndex !== null) {
      await page.waitForTimeout(900);
      const box = await page.locator(`.reveal-slot[data-index="${clickIndex}"]`).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    const samples = [];
    for (let i = 0; i < 160; i += 1) {
      samples.push(
        await page.evaluate(() => ({
          t: Math.round(performance.now() - window.__t0),
          shown: document.querySelectorAll(".reveal-slot.shown").length,
          which: [...document.querySelectorAll(".reveal-slot.shown")].map((e) => e.dataset.index).join(""),
          dealt: document.querySelectorAll(".reveal-slot:not(.rw-pending)").length,
          pack: document.querySelector("#rw-pack") ? 1 : 0,
          done: document.querySelector("#reveal-done")?.disabled === false ? 1 : 0,
        }))
      );
      if (samples.at(-1).shown >= 5 && samples.at(-1).done) break;
      await page.waitForTimeout(60);
    }
    const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t).sort((a, b) => a - b);
    console.log(
      `[cadence] realised sample grid: min ${gaps[0]}ms  median ${gaps[Math.floor(gaps.length / 2)]}ms  ` +
        `max ${gaps.at(-1)}ms over ${samples.length} samples (asked for 60ms)`
    );
    let last = -1;
    for (const s of samples) {
      if (s.shown !== last) {
        console.log(`          t=${String(s.t).padStart(5)}ms  dealt=${s.dealt}  shown=${s.shown} [${s.which}]  pack=${s.pack}  done=${s.done}`);
        last = s.shown;
      }
    }
    console.log(`[cadence] wall clock for the whole run: ${Date.now() - t0}ms`);
  }

  /**
   * The only unarguable way to ask whether a shadow is on screen: take the
   * picture, switch the shadow off, take it again, and subtract.
   *
   * Every indirect version of this question has a hole in it. An absolute
   * luminance under the object says nothing on a floor that is itself a
   * gradient. A paired reading against the gap beside the object fails the
   * moment the casts are wider than the gap — which they are here, five cards
   * eighteen pixels apart, so the "unshadowed" reference patch is in shadow too;
   * measured that way, a row with obvious shadows under it came back at 1.06:1.
   * Differencing has neither problem, because the two frames differ in exactly
   * one property and every other thing on screen is pinned.
   *
   * Animations are paused first, at a fixed offset, so the two frames are the
   * same instant of every loop in the room.
   */
  if (mode === "castdiff") {
    await toReveal();
    // `--closed` measures the pack instead of the cards: it is the hero object
    // of the moment and the one the brief names, and once torn it is gone.
    const closed = argv.includes("--closed");
    if (!closed) {
      await tearPack();
      await page.waitForTimeout(Number(flag("ms", 6400)));
    }
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-play-state: paused !important; animation-delay: -1200ms !important; transition: none !important; }`,
    });
    await page.waitForTimeout(260);
    const withCast = await page.screenshot();
    await page.addStyleTag({ content: `.reveal-slot::after, .rw-pack-cast { opacity: 0 !important; }` });
    await page.waitForTimeout(260);
    const without = await page.screenshot();
    const a = decodePng(withCast);
    const b = decodePng(without);
    const boxes = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)].map((e) => {
          const r = e.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        }),
      closed ? "#rw-pack" : ".reveal-slot"
    );
    const drop = Number(flag("drop", 2));
    const depth = Number(flag("depth", 34));
    console.log(`[castdiff] ${boxes.length} slots, band base+${drop}..base+${drop + depth}`);
    let total = 0;
    for (const [i, [bx, by, bw, bh]] of boxes.entries()) {
      let sa = 0;
      let sb = 0;
      let n = 0;
      for (let y = by + bh + drop; y < by + bh + drop + depth; y += 1)
        for (let x = bx; x < bx + bw; x += 1) {
          const p = (y * a.width + x) * a.channels;
          sa += 0.2126 * a.data[p] + 0.7152 * a.data[p + 1] + 0.0722 * a.data[p + 2];
          sb += 0.2126 * b.data[p] + 0.7152 * b.data[p + 1] + 0.0722 * b.data[p + 2];
          n += 1;
        }
      const withL = sa / n;
      const noL = sb / n;
      total += noL - withL;
      console.log(
        `           #${i}  floor without cast L=${noL.toFixed(2)}  with cast L=${withL.toFixed(2)}  ` +
          `the cast removes ${(noL - withL).toFixed(2)} L (${(((noL - withL) / Math.max(0.5, noL)) * 100).toFixed(1)}%)`
      );
    }
    console.log(`[castdiff] mean darkening under a card: ${(total / boxes.length).toFixed(2)} L`);
    writeFileSync(path.join(OUT, `${TAG}-castdiff-on.png`), withCast);
    writeFileSync(path.join(OUT, `${TAG}-castdiff-off.png`), without);
  }

  if (mode === "film") {
    await toReveal();
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    cdp.on("Page.screencastFrame", async (f) => {
      frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    await tearPack();
    await page.waitForTimeout(Number(flag("ms", 7000)));
    await cdp.send("Page.stopScreencast");
    const dir = path.join(OUT, `${TAG}-film`);
    mkdirSync(dir, { recursive: true });
    const base = frames[0]?.ts ?? 0;
    const gaps = frames.slice(1).map((f, i) => f.ts - frames[i].ts).sort((a, b) => a - b);
    for (const [i, f] of frames.entries()) {
      writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}-${Math.round(f.ts - base)}ms.jpg`), Buffer.from(f.data, "base64"));
    }
    console.log(
      `[film] ${frames.length} frames over ${Math.round((frames.at(-1)?.ts ?? 0) - base)}ms — ` +
        `realised grid min ${gaps[0]?.toFixed(1)}ms median ${gaps[Math.floor(gaps.length / 2)]?.toFixed(1)}ms max ${gaps.at(-1)?.toFixed(1)}ms`
    );
    console.log(`[film] ${dir}`);
  }
} finally {
  await browser.close();
}
