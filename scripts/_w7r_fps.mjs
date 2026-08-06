/**
 * Does the glass plane cost frames?
 *
 * `hall.css` adds a full-viewport repeating-image layer that translates forever,
 * on eleven routes. That is exactly the shape of change that buys a review score
 * and loses the 60fps floor, and AAA bar §9 is explicit that an effect which
 * drops frames is a bug rather than a feature.
 *
 * The measurement is rAF interval, and the reason that is allowed here — when
 * this project's own history lists "an fps probe that measured itself" among the
 * instruments that lied — is that the earlier probe ran inside a **long-lived**
 * `page.evaluate`, which keeps a promise open across thousands of frames and
 * makes the renderer service the CDP channel on every one of them. It reported
 * 9-19fps on a page running at 75. This one runs for two seconds, collects the
 * timestamps into an array with no awaiting in between, and returns once.
 *
 * It is also always run as an A/B in one process: the same page, the same
 * warmth, with and without the layer under test. An absolute frame rate from a
 * headless browser is worth very little; a difference between two of them taken
 * thirty seconds apart is worth a great deal.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

const routes = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, "http://localhost:5173");

/** One short burst. No awaiting inside; the whole trace comes back in one go. */
const trace = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        const stop = performance.now() + 2000;
        const tick = (t) => {
          times.push(t);
          if (t < stop) requestAnimationFrame(tick);
          else {
            const gaps = [];
            for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
            gaps.sort((a, b) => a - b);
            resolve({
              frames: times.length,
              medianGap: gaps[gaps.length >> 1] ?? 0,
              p95Gap: gaps[Math.floor(gaps.length * 0.95)] ?? 0,
              worst: gaps.at(-1) ?? 0,
            });
          }
        };
        requestAnimationFrame(tick);
      })
  );

for (const route of routes) {
  await page.goto(`http://localhost:5173/?nointro#${route}`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await trace(); // warm
  const on = await trace();
  await page.evaluate(() => document.querySelectorAll(".d-room-glass").forEach((n) => n.remove()));
  await page.waitForTimeout(600);
  await trace(); // warm
  const off = await trace();
  const fps = (g) => (g.medianGap > 0 ? 1000 / g.medianGap : 0);
  console.log(
    `#${route.padEnd(14)} with glass ${fps(on).toFixed(1).padStart(5)}fps (p95 gap ${on.p95Gap.toFixed(1)}ms, worst ${on.worst.toFixed(1)})` +
      `   without ${fps(off).toFixed(1).padStart(5)}fps (p95 ${off.p95Gap.toFixed(1)}ms, worst ${off.worst.toFixed(1)})`
  );
}

await browser.close();
