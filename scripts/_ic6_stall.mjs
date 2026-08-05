/**
 * Is the quiet window after a click a *blocked* thread, or merely an unanimated one?
 *
 * The film says nothing on screen changes for 180-265ms after every navigation
 * click. That is two very different defects wearing the same face. If the main
 * thread is blocked, the game has the navigation stall back and the whole world
 * — atmosphere, motes, specular sweep — stops with it. If the thread is free and
 * the screen simply has no exit animation yet, it is a §3a omission and cheaper
 * to fix.
 *
 * So this measures both halves at once, on the same click:
 *
 *   longtask   PerformanceObserver — real main-thread blocks, with start offsets
 *   rAF gap    the largest hole between animation frames
 *   ambient    whether the persistent world kept drifting, sampled by reading
 *              a compositor-driven transform rather than by asking the thread
 *
 * The state document warns that an rAF trace cannot see a compositor curtain.
 * That is true and is why the film exists; this is the complementary instrument,
 * not a replacement for it. Neither is believed on its own.
 *
 *   node scripts/_ic6_stall.mjs lobby collection [more...]
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
const legs = [];
for (let i = 0; i + 1 < argv.length; i += 2) legs.push([argv[i], argv[i + 1]]);
if (!legs.length) legs.push(["lobby", "collection"], ["lobby", "play"], ["lobby", "settings"], ["lobby", "shop"]);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

for (const [from, to] of legs) {
  await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1600);

  const result = await page.evaluate(
    ([hash]) =>
      new Promise((resolve) => {
        const tasks = [];
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) tasks.push([Math.round(e.startTime - t0), Math.round(e.duration)]);
        });
        obs.observe({ entryTypes: ["longtask"] });
        const frames = [];
        let running = true;
        const t0 = performance.now();
        const tick = (t) => {
          frames.push(Math.round(t - t0));
          if (running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        location.hash = `#${hash}`;
        setTimeout(() => {
          running = false;
          obs.disconnect();
          const gaps = [];
          for (let i = 1; i < frames.length; i += 1) gaps.push([frames[i - 1], frames[i] - frames[i - 1]]);
          gaps.sort((a, b) => b[1] - a[1]);
          resolve({
            tasks,
            frames: frames.length,
            worstGaps: gaps.slice(0, 5),
            firstFrameAfter: frames.find((f) => f > 0) ?? null,
          });
        }, 2600);
      }),
    [to]
  );

  const blocked = result.tasks.filter((t) => t[0] >= -20 && t[0] < 400);
  console.log(
    `\n#${from} -> #${to}\n` +
      `  frames in 2.6s: ${result.frames}  (75fps would be ~195)\n` +
      `  worst rAF gaps: ${result.worstGaps.map(([at, d]) => `${d}ms@${at}`).join("  ")}\n` +
      `  long tasks:     ${result.tasks.length ? result.tasks.map(([at, d]) => `${d}ms@${at}`).join("  ") : "none"}\n` +
      `  blocking in first 400ms: ${blocked.reduce((s, t) => s + t[1], 0)}ms across ${blocked.length}`
  );
}

await browser.close();
