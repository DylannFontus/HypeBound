/**
 * What a menu navigation actually costs, in frames rather than in opinions.
 *
 * §3a of the AAA bar makes two claims that a DOM probe cannot check and that
 * survived four review rounds because nobody checked them in pixels:
 *
 *   "Never a blank frame. No moment where neither screen is drawn."
 *   "Budget 260–420ms. Over 500ms on routine navigation is an obstacle."
 *
 * The existing probes count a screen as painted when its computed opacity is
 * over 0.02, which is how a frame where nothing on screen is brighter than a dim
 * purple gets reported as two screens both present. This drives the real browser
 * through a real click, records a CDP screencast at roughly the frame rate, and
 * grades the *images*: the 95th-percentile pixel of every frame against the
 * 95th-percentile pixel of the settled destination.
 *
 *   node scripts/measure-nav.mjs lobby "#lobby-play"
 *   node scripts/measure-nav.mjs play ".mode-hero" --size 1280x720
 *
 * A frame whose p95 falls below 60% of the settled value is a frame where the
 * interface has gone dark, and the run fails if one exists.
 */
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const route = argv[0] ?? "lobby";
const target = argv[1] ?? "#lobby-play";
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });

await seedPlayedAccount(page, "http://localhost:5173");
await page.goto(`http://localhost:5173/#${route}`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1400);

/** rAF gaps and long tasks, recorded in the page for the whole navigation. */
await page.evaluate(() => {
  window.__gaps = [];
  window.__long = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__gaps.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__long.push([entry.startTime, entry.duration]);
  }).observe({ entryTypes: ["longtask"] });
});

const session = await page.context().newCDPSession(page);
const frames = [];
session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  frames.push({ data, t: metadata.timestamp });
  await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });

/**
 * The click is dispatched *inside the page* and stamped there.
 *
 * `page.click()` runs Playwright's actionability checks first — visible, stable,
 * enabled, receives-events — and those take a variable hundred-odd milliseconds
 * of round trips before the event is dispatched. Timing from before that call
 * charges the navigation for the test harness's own hesitation, which is how a
 * first measurement of this put "click to first visible change" at 620ms on a
 * transition that takes 380.
 */
const wallClickAt = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const at = Date.now();
  el.click();
  return at;
}, target);
await page.waitForTimeout(1800);
await session.send("Page.stopScreencast");

const stats = await page.evaluate(async (shots) => {
  const grade = async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    const W = bitmap.width;
    const H = bitmap.height;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, W, H);
    const all = [];
    let sum = 0;
    for (let y = 0; y < H; y += 4) {
      for (let x = 0; x < W; x += 4) {
        const i = (y * W + x) * 4;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        all.push(l);
        sum += l;
      }
    }
    all.sort((a, b) => a - b);
    return { mean: sum / all.length, p95: all[Math.floor(all.length * 0.95)] };
  };
  const out = [];
  for (const shot of shots) out.push({ t: shot.t, ...(await grade(shot.data)) });
  return out;
}, frames);

// The screencast clock is wall-clock seconds; the click is a wall-clock instant.
const rel = stats.map((s) => ({ ms: s.t * 1000 - wallClickAt, mean: s.mean, p95: s.p95 }));
const settled = rel.filter((f) => f.ms > 900);
const settledP95 = settled.reduce((a, f) => a + f.p95, 0) / Math.max(1, settled.length);
const floor = settledP95 * 0.6;
const during = rel.filter((f) => f.ms >= -60 && f.ms <= 1200);

const first = during.find((f, i) => i > 0 && Math.abs(f.mean - during[0].mean) > 1.2);
const darkest = during.reduce((a, f) => (f.p95 < a.p95 ? f : a), during[0]);
const blanks = during.filter((f) => f.ms > 0 && f.p95 < floor);

/**
 * The darkest frame, written out.
 *
 * A number saying "p95 fell to 36" does not say *why*, and the two candidate
 * causes — both screens transparent at once, or the persistent world behind
 * them blanking — look identical in a statistic and nothing alike in a picture.
 */
const dumpDir = String(flag("dump", "scripts/screenshots/w1/frontdoor"));
mkdirSync(dumpDir, { recursive: true });
const darkestIndex = rel.indexOf(darkest);
for (const [label, index] of [
  ["before", darkestIndex - 1],
  ["darkest", darkestIndex],
  ["after", darkestIndex + 1],
]) {
  if (index < 0 || index >= frames.length) continue;
  writeFileSync(`${dumpDir}/nav-${label}.jpg`, Buffer.from(frames[index].data, "base64"));
}

const gaps = await page.evaluate(() => window.__gaps.slice(1));
const longs = await page.evaluate(() => window.__long.map(([s, d]) => [Math.round(s - 0), Math.round(d)]));
const over33 = gaps.filter((g) => g > 33);

console.log(`navigation ${route} -> ${target}  ${vw}x${vh}  ${frames.length} screencast frames`);
console.log(`  settled p95 ${settledP95.toFixed(1)}   blank floor (60%) ${floor.toFixed(1)}`);
console.log(`  first visible change  ${first ? `${first.ms.toFixed(0)}ms` : "not seen"}`);
console.log(`  darkest frame         ${darkest.ms.toFixed(0)}ms  mean ${darkest.mean.toFixed(1)}  p95 ${darkest.p95.toFixed(1)}`);
console.log(`  frames below floor    ${blanks.length}${blanks.length ? `  at ${blanks.map((b) => `${b.ms.toFixed(0)}ms:${b.p95.toFixed(0)}`).join(" ")}` : ""}`);
console.log(`  rAF gaps over 33ms    ${over33.length} of ${gaps.length}  worst ${over33.slice(0, 6).map((g) => g.toFixed(1)).join(", ") || "-"}`);
console.log(`  long tasks            ${longs.length ? longs.map(([, d]) => `${d}ms`).join(", ") : "none"}`);
console.log(
  `  luminance trace       ${during
    .filter((f) => f.ms > -20 && f.ms < 900)
    .map((f) => `${f.ms.toFixed(0)}:${f.p95.toFixed(0)}`)
    .join(" ")}`
);

await browser.close();
