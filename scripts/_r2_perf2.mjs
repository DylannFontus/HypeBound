/** Control: the same frame-time probe on screens this round did and did not touch. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const run = async (hash, label) => {
  await page.goto(`http://localhost:5173/#${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.evaluate((h) => {
    if (location.hash !== `#${h}`) location.hash = `#${h}`;
  }, hash);
  await page.waitForTimeout(3000);
  const s = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
          if (gaps.length >= 240) {
            gaps.sort((a, b) => a - b);
            resolve({
              median: +gaps[120].toFixed(1),
              p95: +gaps[227].toFixed(1),
              worst: +gaps[239].toFixed(1),
              over33: gaps.filter((g) => g > 33).length,
            });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
  console.log(label.padEnd(14), JSON.stringify(s));
};

await run("lobby", "lobby");
await run("collection", "collection");
await run("deck-builder", "deck-builder");
await browser.close();
