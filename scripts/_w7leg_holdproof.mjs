/**
 * Does the menu veil keep drawing while the main thread is gone?
 *
 * `_w7leg_castproof.mjs` established that a CDP screencast *can* see a
 * compositor-driven animation through a 400ms main-thread block — thirty frames
 * at a steady 13ms cadence, mean delta 0.45 the whole way. So the 250–290ms
 * silences in every film of a veiled navigation are not the camera blinking.
 * They are one of two things, and they are opposite in what they demand:
 *
 *   the veil is composited and simply has nothing moving in that window
 *   the veil is *not* composited, so its motion dies with the thread
 *
 * This asks directly. It raises the veil for real, waits until it is shut, and
 * then blocks the main thread with a spin loop for a named number of
 * milliseconds — no DOM work, nothing invalidated, the layer tree untouched. If
 * the film keeps moving through the spin the veil is on the compositor; if it
 * goes flat, every animation on that cover is being driven by the thread it
 * exists to cover for, which is the whole defect in one sentence.
 *
 *   node scripts/_w7leg_holdproof.mjs [--route collection] [--block 400]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { decodePng, luminance } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const route = String(flag("route", "collection"));
const blockMs = Number(flag("block", 400));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 640, maxHeight: 360 });

/**
 * The hold is pinned open for the length of the test.
 *
 * `partCurtain` waits for two on-time frames and then reveals, which on a warm
 * machine is a handful of frames — far too short to fit a block inside. So the
 * element is detached from the shell's bookkeeping by cloning it: the clone is
 * a real `.nav-curtain[data-phase="close"]` with the same animations, and the
 * shell will never touch it because it is not the one it is holding.
 */
const timeline = await page.evaluate(
  async ([hash, ms]) => {
    const marks = {};
    const stamp = () => performance.timeOrigin + performance.now();
    location.hash = hash;
    // wait for the shell to build one, then keep a copy of our own
    const start = performance.now();
    while (performance.now() - start < 4000) {
      const live = document.querySelector(".nav-curtain");
      if (live) {
        const clone = live.cloneNode(true);
        document.getElementById("app").appendChild(clone);
        marks.cloned = stamp();
        break;
      }
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    // let the close finish and the delayed idle animations get going
    await new Promise((r) => setTimeout(r, 700));
    marks.blockFrom = stamp();
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* spin — no DOM work, nothing invalidated */
    }
    marks.blockTo = stamp();
    await new Promise((r) => setTimeout(r, 700));
    return marks;
  },
  [`#${route}`, blockMs]
);

await session.send("Page.stopScreencast");
await session.detach().catch(() => {});
await browser.close();

const frames = shots.map((s) => {
  const png = decodePng(Buffer.from(s.data, "base64"));
  return { t: s.t * 1000 - timeline.blockFrom, lum: luminance(png) };
});

let previous = null;
let lastT = null;
const during = [];
const before = [];
/**
 * The 200ms column is the only one comparable to `hearthstone_frames/`, which is
 * sampled 0.2s apart. Its 0.6-1.3 "idle floor" is a figure per *200ms*, and
 * reading a 15ms screencast delta against it directly is a unit error -- one
 * that flatters fast motion and, worse, hides *periodic* motion that returns to
 * where it started between two adjacent samples.
 */
const at200 = (index) => {
  const want = frames[index].t - 200;
  let best = -1;
  let bestGap = Infinity;
  for (let i = index - 1; i >= 0; i -= 1) {
    const gap = Math.abs(frames[i].t - want);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
    if (frames[i].t < want - 60) break;
  }
  return bestGap <= 70 ? best : -1;
};
console.log(`  ${route}: the veil held open, main thread blocked for ${blockMs}ms at t=0`);
console.log(`      t(ms)   gap   mean-delta   d/200ms   where`);
for (const [index, f] of frames.entries()) {
  let delta = 0;
  if (previous) {
    let sum = 0;
    for (let i = 0; i < f.lum.length; i += 1) sum += Math.abs(f.lum[i] - previous[i]);
    delta = sum / f.lum.length;
  }
  let wide = -1;
  const back = at200(index);
  if (back >= 0) {
    let sum = 0;
    for (let k = 0; k < f.lum.length; k += 1) sum += Math.abs(f.lum[k] - frames[back].lum[k]);
    wide = sum / f.lum.length;
  }
  const t = Math.round(f.t);
  const gap = lastT === null ? 0 : t - lastT;
  const where = t < 0 ? "before" : t <= blockMs ? "DURING THE BLOCK" : "after";
  if (t > -420 && t < blockMs + 300) {
    if (where === "DURING THE BLOCK") during.push({ gap, delta, wide });
    if (where === "before") before.push({ gap, delta, wide });
    console.log(
      `  ${String(t).padStart(7)} ${String(gap).padStart(5)} ${delta.toFixed(3).padStart(12)} ${(wide < 0
        ? "-"
        : wide.toFixed(3)
      ).padStart(9)}   ${where}`
    );
  }
  previous = f.lum;
  lastT = t;
}

const mean = (list, pick) => (list.length === 0 ? 0 : list.reduce((a, b) => a + pick(b), 0) / list.length);
const wideOnly = (list) => list.filter((d) => d.wide >= 0);
console.log(
  `
  frames in the 400ms before the block: ${before.length}   mean delta ${mean(before, (d) => d.delta).toFixed(
    3
  )}   mean d/200ms ${mean(wideOnly(before), (d) => d.wide).toFixed(2)}` +
    `
  frames during the ${blockMs}ms block:    ${during.length}   mean delta ${mean(during, (d) => d.delta).toFixed(
      3
    )}   mean d/200ms ${mean(wideOnly(during), (d) => d.wide).toFixed(2)}` +
    `
  ${
      during.length >= 4
        ? "VERDICT: the veil keeps drawing without the main thread. It is composited."
        : "VERDICT: the veil STOPS when the thread does. Its motion is main-thread driven, so the " +
          "cover is dead for exactly the window it exists to cover."
    }`
);
