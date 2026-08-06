/**
 * Can a CDP screencast see a compositor-driven animation while the main thread
 * is blocked?
 *
 * This is the eighth instrument in this project and it exists to interrogate the
 * seventh. Every film of a veiled navigation, before and after this pass, shows
 * a 250–290ms window in which `Page.screencastFrame` delivers nothing — and that
 * window has been read, twice by two different reviews, as "the compositor emits
 * no frame at all". It is the single most damning number in the criticism this
 * work is answering, and it is a claim about **the browser**, not about the
 * game, so it is testable without the game.
 *
 * The page below contains one element with one `transform` animation and nothing
 * else. A button blocks the main thread in a `while` loop for a named number of
 * milliseconds. If the screencast keeps delivering frames through the block, the
 * compositor is drawing and the game's veil is genuinely dead. If it goes silent
 * for exactly the length of the block, the gap in every previous film is the
 * instrument blinking, and every conclusion drawn from it has to be withdrawn.
 *
 *   node scripts/_w7leg_castproof.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { decodePng, luminance } from "./lib/png.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const PAGE = `<!doctype html><meta charset="utf-8"><style>
  html,body { margin:0; background:#0a0714; height:100%; overflow:hidden; }
  #bar { position:fixed; left:0; top:40%; width:40%; height:20%;
         background:linear-gradient(90deg,#ff5fa2,#52c8ff);
         animation: slide 1.2s linear infinite; will-change: transform; }
  @keyframes slide { from { transform: translate3d(0,0,0); } to { transform: translate3d(150%,0,0); } }
</style><div id="bar"></div>`;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
await page.setContent(PAGE, { waitUntil: "load" });
await page.waitForTimeout(900);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 320, maxHeight: 180 });

await page.waitForTimeout(500);
const blockMs = 400;
const t0 = await page.evaluate((ms) => {
  const start = performance.timeOrigin + performance.now();
  // a genuine main-thread block: no yielding, no timers, no rAF
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* spin */
  }
  return start;
}, blockMs);
await page.waitForTimeout(900);
await session.send("Page.stopScreencast");
await session.detach().catch(() => {});
await browser.close();

const frames = shots
  .map((s) => ({ t: Math.round(s.t * 1000 - t0), png: decodePng(Buffer.from(s.data, "base64")) }))
  .map((f) => ({ t: f.t, lum: luminance(f.png) }));

let inBlock = 0;
let worstInBlock = 0;
let previous = null;
let lastT = null;
console.log(`  a compositor-only animation, with the main thread blocked for ${blockMs}ms at t=0`);
console.log(`      t(ms)   gap   mean-delta   where`);
for (const f of frames) {
  let delta = 0;
  if (previous) {
    let sum = 0;
    for (let i = 0; i < f.lum.length; i += 1) sum += Math.abs(f.lum[i] - previous[i]);
    delta = sum / f.lum.length;
  }
  const gap = lastT === null ? 0 : f.t - lastT;
  const where = f.t < 0 ? "before" : f.t <= blockMs ? "DURING THE BLOCK" : "after";
  if (where === "DURING THE BLOCK") {
    inBlock += 1;
    worstInBlock = Math.max(worstInBlock, gap);
  }
  if (f.t > -400 && f.t < blockMs + 400) {
    console.log(
      `  ${String(f.t).padStart(7)} ${String(gap).padStart(5)} ${delta.toFixed(3).padStart(12)}   ${where}`
    );
  }
  previous = f.lum;
  lastT = f.t;
}

console.log(
  `\n  frames delivered during the ${blockMs}ms block: ${inBlock}\n` +
    (inBlock <= 1
      ? `  VERDICT: the screencast is MAIN-THREAD BOUND. A gap in a film is a blocked thread,\n` +
        `           not proof that the compositor stopped drawing. Every "no composited frame"\n` +
        `           reading taken from a screencast has to be withdrawn.`
      : `  VERDICT: the screencast keeps sampling through a blocked main thread, so a gap in a\n` +
        `           film is a real compositor stall and the readings stand.`)
);
