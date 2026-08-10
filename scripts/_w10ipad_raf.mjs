/**
 * Does `requestAnimationFrame` run at all in this headless WebKit?
 *
 * The nav probe's calibration said no — one second of idle produced zero frames
 * — and a metric computed over zero samples is instrument fourteen. This asks
 * the question directly, in headless and in headed, so the answer is a reading
 * rather than a guess about why.
 */

import { webkit, chromium } from "playwright-core";
import { existsSync } from "node:fs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));

async function check(label, type, launch) {
  const browser = await type.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);
  const out = await page.evaluate(async () => {
    const stamps = [];
    let timeouts = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        stamps.push(performance.now());
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
      const poll = setInterval(() => {
        timeouts++;
        if (performance.now() - t0 > 1200) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });
    return {
      visibility: document.visibilityState,
      hidden: document.hidden,
      rafFrames: stamps.length,
      timeoutTicks: timeouts,
      elapsed: Math.round(performance.now() - t0),
      atmPaused: document.querySelector(".atmosphere")?.dataset.paused ?? null,
      /** Is anything actually animating? A count the engine has to answer for. */
      animations: document.getAnimations ? document.getAnimations().length : -1,
    };
  });
  await browser.close();
  console.log(label.padEnd(26), JSON.stringify(out));
}

await check("chromium headless", chromium, { headless: true, executablePath: CHROME ?? undefined });
await check("webkit headless", webkit, { headless: true });
await check("webkit headed", webkit, { headless: false });
