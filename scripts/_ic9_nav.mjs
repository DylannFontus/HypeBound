/**
 * What does a navigation cost, measured in frames that actually reached the
 * screen.
 *
 * Wave 8 left this open: entering the three heavy children ran at 11.5–28.8fps
 * against §9's 30fps floor, and the legs measured 473–944ms against §3a's
 * 260–420ms budget. Builders have since worked on it. Verifying that needs an
 * instrument that can see two things the previous ones could not.
 *
 * **rAF gap traces cannot see a compositor curtain.** It is recorded in the
 * project's own notes and it cuts both ways: rAF runs on the main thread, so it
 * reports blocking whether or not the player saw anything, and it *also* cannot
 * tell you whether the frames it thinks it produced were ever presented. So the
 * frame clock here is `Page.startScreencast`, which is the browser's own
 * pipeline: one message per frame actually composited, each carrying the
 * compositor's timestamp. Frames the player never saw are not in it.
 *
 * **A veil is not a fix and must be measured separately.** `shell.ts` covers any
 * build over `HEAVY_BUILD_MS` with a title card, and a covered leg can be as
 * slow as it likes without a critic noticing — that is precisely how wave 3's
 * lowered threshold hid four of the five most-travelled legs and measured
 * *darker* than the transition it was hiding. So every row reports whether the
 * leg was veiled, and the veiled ones are judged on cost rather than on looks.
 *
 * The long-task total is taken from the page's own `PerformanceObserver`, which
 * is the honest companion number: it says how much of the leg the main thread
 * spent unable to answer a click.
 *
 *   node scripts/_ic9_nav.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push(f.metadata.timestamp * 1000);
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

await page.addInitScript(() => {
  /*
   * The curtain is torn down again by the time a post-hoc `querySelector` runs,
   * so asking afterwards always answers "not veiled" — which is the flattering
   * answer and the wrong one. Watch for it instead, and record how long it was
   * actually on screen.
   */
  window.__veil = { seen: false, ms: 0 };
  window.__long = [];
  let up = 0;
  // `document.documentElement` is null at init-script time on the first pass and
  // `observe(null)` throws, which silently aborted the rest of this script and
  // left `__long` undefined — an instrument that broke itself while looking fine.
  const armVeil = () => {
    new MutationObserver(() => {
      const el = document.querySelector(".nav-curtain");
      if (el && !up) {
        up = performance.now();
        window.__veil.seen = true;
      } else if (!el && up) {
        window.__veil.ms = Math.max(window.__veil.ms, performance.now() - up);
        up = 0;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) armVeil();
  else document.addEventListener("readystatechange", () => document.documentElement && armVeil(), { once: true });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* the browser without longtask support is not the one we ship to */
  }
});

const LEGS = [
  ["lobby", "collection"],
  ["collection", "lobby"],
  ["lobby", "deckbuilder"],
  ["deckbuilder", "lobby"],
  ["lobby", "gallery"],
  ["gallery", "lobby"],
  ["lobby", "shop"],
  ["lobby", "stats"],
  ["lobby", "play"],
];

console.log("leg                       settle   frames  median  worst   fps   longtask  veiled");
const rows = [];
for (const [from, to] of LEGS) {
  await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    window.__long.length = 0;
    window.__veil = { seen: false, ms: 0 };
  });
  frames.length = 0;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 20, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  frames.length = 0;

  const t0 = await page.evaluate(
    (to) => {
      const t = performance.now();
      location.hash = `#${to}`;
      return t;
    },
    to
  );
  // Settled = the outgoing screen is gone and the incoming one has stopped
  // animating in. Not "the element exists" — that is true before a pixel moves.
  const settled = await page
    .waitForFunction(
      () =>
        document.querySelectorAll(".screen-out").length === 0 &&
        document.querySelectorAll(".screen-in, [data-entering]").length === 0,
      null,
      { timeout: 15000 }
    )
    .then(() => page.evaluate(() => performance.now()))
    .catch(() => page.evaluate(() => performance.now()));
  await page.waitForTimeout(700);
  await cdp.send("Page.stopScreencast");

  const veil = await page.evaluate(() => window.__veil ?? { seen: false, ms: 0 });
  const veiled = veil.seen;
  const long = await page.evaluate(() => window.__long ?? []);
  const inLeg = long.filter((l) => l.start >= 0);
  const longMs = inLeg.reduce((s, l) => s + l.dur, 0);

  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) gaps.push(frames[i] - frames[i - 1]);
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)] ?? 0;
  const worst = gaps.at(-1) ?? 0;
  const dur = settled - t0;
  rows.push({ leg: `${from} -> ${to}`, dur, n: frames.length, med, worst, longMs, veiled });
  console.log(
    `${`${from} -> ${to}`.padEnd(24)} ${dur.toFixed(0).padStart(6)}ms ${String(frames.length).padStart(6)} ` +
      `${med.toFixed(0).padStart(6)}ms ${worst.toFixed(0).padStart(6)}ms ${(1000 / (med || 1)).toFixed(0).padStart(5)} ` +
      `${longMs.toFixed(0).padStart(8)}ms  ${veiled ? `VEILED ${veil.ms.toFixed(0)}ms` : ""}`
  );
}

const over = rows.filter((r) => r.dur > 420);
const slowFrames = rows.filter((r) => r.worst > 33.4);
console.log(`\n§3a budget 260-420ms: over on ${over.length}/${rows.length} — ${over.map((r) => `${r.leg} ${r.dur.toFixed(0)}ms`).join(", ") || "none"}`);
console.log(
  `§9 30fps floor: a frame longer than 33ms on ${slowFrames.length}/${rows.length} — ${slowFrames.map((r) => `${r.leg} worst ${r.worst.toFixed(0)}ms`).join(", ") || "none"}`
);
await browser.close();
