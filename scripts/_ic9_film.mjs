/**
 * Film a set-piece at the compositor's own frame rate, and say what moved.
 *
 * §8.7 of the bar: a still cannot show motion, so capture bursts and look at
 * them in sequence. The obvious way to do that is a loop of `screenshot()` with
 * a sleep — and that is instrument eleven's shape. One capture costs ~90–130ms
 * even with `optimizeForSpeed`, so a "burst at 45ms" is really a burst at
 * ~150ms, and a 260ms transition is three frames of a thing that took eighteen.
 * Judging easing from three samples is judging easing from a still with extra
 * steps.
 *
 * `Page.startScreencast` has no such floor: the browser hands over every frame
 * it composites, with the compositor's own timestamp, and the encoding happens
 * off the critical path. A 300ms transition arrives as twenty-two frames rather
 * than three. The frames are JPEG and therefore useless for a *fine* colour
 * measurement — which is why nothing in this file measures colour. It measures
 * **when things moved, how much, and whether the movement had a shape**:
 *
 *   - the per-frame delta curve, so a linear ramp and an eased one are
 *     distinguishable (an ease has a fat middle; linear is flat)
 *   - the first and last frame that moved, which is the real duration against
 *     §3's tiers, rather than the CSS duration somebody wrote down
 *   - identical consecutive frames, which §8.7 says to fail outright
 *
 *   node scripts/_ic9_film.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
import { decodePng } from "./lib/png.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const DIR = "scripts/screenshots/w9/ic9-film";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

let reel = [];
let recording = false;
cdp.on("Page.screencastFrame", async (f) => {
  if (recording) reel.push({ t: f.metadata.timestamp * 1000, data: f.data });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

/**
 * A movement signature that grain cannot saturate.
 *
 * The first version of this file differenced the JPEG *bytes* and every curve it
 * drew came back flat at maximum — because a HYPEBOUND screen carries a grain
 * field that resamples every frame, and at byte level that swamps a card flying
 * across the board. Instrument ten in this project's list was an emptiness
 * metric fooled by exactly that overlay; this was the same mistake wearing a
 * different hat, and it was caught because a genuinely eased 300ms transition
 * cannot possibly produce a flat curve.
 *
 * So: decode the frame and average it into 8x8 blocks first. Grain is zero-mean
 * inside a block and averages to nothing; a moving object changes a block's mean
 * by tens of levels. What comes out is the motion, on a scale where an ease-out
 * has a fat front and a linear ramp is flat.
 */
function signature(pngBase64) {
  const img = decodePng(Buffer.from(pngBase64, "base64"));
  const bw = img.width >> 3;
  const bh = img.height >> 3;
  const out = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let s = 0;
      for (let y = 0; y < 8; y += 1) {
        const row = (by * 8 + y) * img.width;
        for (let x = 0; x < 8; x += 1) {
          const i = (row + bx * 8 + x) * img.channels;
          s += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
        }
      }
      out[by * bw + bx] = s / 64;
    }
  }
  return out;
}
function sigDelta(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

async function film(name, action, { after = 1400 } = {}) {
  reel = [];
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, 350));
  reel = [];
  recording = true;
  const t0 = Date.now();
  await action();
  await new Promise((r) => setTimeout(r, after));
  recording = false;
  await cdp.send("Page.stopScreencast");

  const frames = reel.slice();
  if (frames.length < 3) {
    console.log(`\n### ${name}: only ${frames.length} frame(s) — nothing to judge`);
    return;
  }
  const base = frames[0].t;
  const sigs = frames.map((f) => signature(f.data));
  const deltas = [];
  for (let i = 1; i < frames.length; i += 1) deltas.push({ t: frames[i].t - base, d: sigDelta(sigs[i - 1], sigs[i]), gap: frames[i].t - frames[i - 1].t });
  const peak = Math.max(...deltas.map((x) => x.d));
  const moving = deltas.filter((x) => x.d > peak * 0.08);
  const identical = deltas.filter((x) => x.d < 0.02).length;
  const gaps = deltas.map((x) => x.gap).sort((a, b) => a - b);
  console.log(`\n### ${name}`);
  console.log(
    `  ${frames.length} composited frames over ${(frames.at(-1).t - base).toFixed(0)}ms | frame gap median ${gaps[gaps.length >> 1].toFixed(1)}ms (max ${gaps.at(-1).toFixed(0)}ms) | ${identical} identical pair(s)`
  );
  if (moving.length) {
    console.log(`  movement from ${moving[0].t.toFixed(0)}ms to ${moving.at(-1).t.toFixed(0)}ms  = ${(moving.at(-1).t - moving[0].t).toFixed(0)}ms of motion`);
  } else {
    console.log(`  NOTHING MOVED`);
  }
  // the shape of it, one row of the curve
  const bars = deltas
    .filter((_, i) => i % Math.max(1, Math.ceil(deltas.length / 46)) === 0)
    .map((x) => " ▁▂▃▄▅▆▇█"[Math.min(8, Math.round((x.d / (peak || 1)) * 8))])
    .join("");
  console.log(`  ${bars}`);
  // keep a strip so the frames can be looked at, not only measured
  const keep = [0, Math.floor(frames.length * 0.15), Math.floor(frames.length * 0.3), Math.floor(frames.length * 0.5), Math.floor(frames.length * 0.7), frames.length - 1];
  keep.forEach((i, k) => writeFileSync(path.join(DIR, `${name}-${k}-t${Math.round(frames[i].t - base)}.png`), Buffer.from(frames[i].data, "base64")));
  console.log(`  peak ${peak.toFixed(2)} L/frame, quietest ${Math.min(...deltas.map((x) => x.d)).toFixed(3)}`);
}

const click = async (x, y) => {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 45));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const centre = (sel, i = 0) =>
  page.evaluate(
    ({ sel, i }) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    },
    { sel, i }
  );

// ---- menus ------------------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await film("lobby-idle", async () => page.waitForTimeout(2600), { after: 0 });
await film("nav-lobby-to-collection", async () => page.evaluate(() => (location.hash = "#collection")), { after: 1500 });
await page.waitForTimeout(1600);
await film("nav-collection-to-lobby", async () => page.evaluate(() => (location.hash = "#lobby")), { after: 1500 });
await page.waitForTimeout(1400);
const playBtn = await centre(".lobby-play, .btn-play, .mat-hero");
if (playBtn) {
  await film("lobby-hero-hover", async () => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: playBtn.x, y: playBtn.y, button: "none", clickCount: 0 });
    await page.waitForTimeout(600);
  }, { after: 200 });
}

// ---- the board --------------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#battle?seed=77&difficulty=casual`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await page.waitForTimeout(1100);
const conf = await centre(".mulligan-actions .btn-primary");
await film("match-curtain", async () => click(conf.x, conf.y), { after: 2600 });
await page.waitForFunction(() => document.querySelectorAll(".hand-card").length > 0, null, { timeout: 25000 });
await page.waitForTimeout(2200);

await film("board-idle", async () => page.waitForTimeout(2600), { after: 0 });

const card = await centre(".hand-card", 2);
if (card) {
  await film("hand-card-hover", async () => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: card.x, y: card.y - 20, button: "none", clickCount: 0 });
    await page.waitForTimeout(700);
  }, { after: 200 });
}

// a real drag-and-play
const target = await page.evaluate(() => {
  const el = document.querySelector(".battle-stage, canvas");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.62) };
});
const src = await centre(".hand-card", 1);
if (src && target) {
  await film("card-play", async () => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: src.x, y: src.y, button: "none", clickCount: 0 });
    await new Promise((r) => setTimeout(r, 80));
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: src.x, y: src.y, button: "left", clickCount: 1 });
    for (let s = 1; s <= 10; s += 1) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(src.x + ((target.x - src.x) * s) / 10),
        y: Math.round(src.y + ((target.y - src.y) * s) / 10),
        button: "left",
        clickCount: 0,
      });
      await new Promise((r) => setTimeout(r, 20));
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  }, { after: 2000 });
}

const et = await centre(".end-turn-btn");
if (et) {
  await film("turn-change", async () => {
    await click(et.x, et.y);
    await new Promise((r) => setTimeout(r, 400));
    const c = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".confirm-overlay button")].find((x) => /^end turn$/i.test((x.textContent ?? "").trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (c) await click(c.x, c.y);
  }, { after: 3200 });
}

// ---- the pack ---------------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
await page.waitForTimeout(1700);
const buy = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /open a .*drop/i.test(x.textContent ?? ""));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (buy) {
  await click(buy.x, buy.y);
  await page.waitForTimeout(1800);
  const pack = await centre(".rw-pack");
  if (pack) {
    await film("pack-tear", async () => click(pack.x, pack.y), { after: 2600 });
    await page.waitForTimeout(400);
    const slot = await centre(".rw-flip", 4);
    if (slot) await film("pack-flip-last", async () => click(slot.x, slot.y), { after: 1600 });
  }
}

console.log(`\nstrips in ${DIR}`);
await browser.close();
