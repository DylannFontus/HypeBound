/**
 * Film the versus card through a main thread that is genuinely gone.
 *
 * `_w3nav_film.mjs` films a real navigation, which is the honest test and is
 * useless on a warm dev machine: the battle route builds in about two hundred
 * milliseconds here, so the card is on screen for a dozen frames and the whole
 * question — "does the hold have anything happening in it" — cannot be asked.
 * The critic's machine held it for 2.8 seconds and that is the case that matters.
 *
 * So this one reproduces the condition rather than waiting for it: the hash
 * changes, and a task posted immediately afterwards spins the renderer's main
 * thread for `--stall` milliseconds. That is exactly what a slow constructor
 * does, and it is also the only way to prove the claim every animation in
 * `matchCurtain.css` rests on — that a composited `transform` keeps running when
 * the thread that declared it is not available. `page.screenshot` cannot sample
 * a stall, because it round-trips through the renderer; a CDP screencast is
 * produced by the compositor and delivered by the browser process, so it can.
 *
 *   node scripts/_w4vs_film.mjs --stall 3200 --dir scripts/screenshots/w4/vs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const dir = String(flag("dir", "scripts/screenshots/w4/vs"));
const stall = Number(flag("stall", 3200));
const route = String(flag("route", "battle?ai=1"));
const every = Number(flag("every", 2));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
await page.waitForTimeout(1400);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: every, maxWidth: vw, maxHeight: vh });

const clickWall = Date.now();
await page.evaluate(
  ([hash, ms, after, rm]) => {
    // `motionEnabled()` reads the root attribute before the saved setting, so
    // this is the whole of what the accessibility switch does from the curtain's
    // point of view — and it is what decides `data-billing="still"`.
    if (rm) document.documentElement.dataset["reducedMotion"] = "true";
    location.hash = hash;
    /**
     * The delay before the spin is not slack, it is the dressing window.
     *
     * `shell.ts` raises the curtain, calls `dressMatchCurtain`, and then spends
     * two frames getting the result composited before it hands the thread to
     * the battle factory. Spinning inside that window films an empty veil —
     * which the first run of this script did, and which is a perfectly accurate
     * picture of a case nobody is trying to fix. The spin therefore starts
     * after the card is up, which is where a real constructor's cost lands too.
     */
    setTimeout(() => {
      const until = performance.now() + ms;
      while (performance.now() < until) {
        /* spin */
      }
    }, after);
  },
  [`#${route}`, stall, Number(flag("after", 340)), argv.includes("--rm")]
);
await page.waitForTimeout(stall + 1400);
await session.send("Page.stopScreencast");
await session.detach().catch(() => {});

mkdirSync(dir, { recursive: true });
let written = 0;
for (const shot of shots) {
  const t = Math.round(shot.t * 1000 - clickWall);
  if (t < -60) continue;
  writeFileSync(`${dir}/t${String(Math.max(0, t)).padStart(5, "0")}.jpg`, Buffer.from(shot.data, "base64"));
  written += 1;
}
console.log(`${written} frames -> ${dir}`);
await browser.close();
