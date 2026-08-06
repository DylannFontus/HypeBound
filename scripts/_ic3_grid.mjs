/**
 * Is the Collection's slow fill a designed stagger or an unpainted canvas?
 *
 * They look identical in a still and are opposite defects: a stagger is §3a
 * working, an unpainted canvas is a card that has popped in with no entrance at
 * all. The difference is visible in the DOM — a staggered tile is at low opacity
 * with a full face behind it, an unpainted one is at opacity 1 with an empty
 * canvas — so this samples both, every 150ms, from the moment the route mounts.
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
// warm the route, come back, then measure the crossing a returning player gets
await page.evaluate(() => (location.hash = "#collection"));
await page.waitForTimeout(3200);
await page.evaluate(() => (location.hash = "#lobby"));
await page.waitForTimeout(2400);

await page.evaluate(() => {
  window.__t0 = performance.now();
  location.hash = "#collection";
});
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(150);
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const cells = [...document.querySelectorAll(".card-cell")].filter((e) => {
          const b = e.getBoundingClientRect();
          return b.top < window.innerHeight && b.bottom > 0 && b.width > 40;
        });
        let painted = 0;
        let blank = 0;
        let faded = 0;
        for (const c of cells) {
          const cv = c.querySelector("canvas");
          const op = parseFloat(getComputedStyle(c).opacity);
          if (op < 0.9) faded += 1;
          if (!cv || cv.width === 0) {
            blank += 1;
            continue;
          }
          const g = cv.getContext("2d", { willReadFrequently: true });
          let d;
          try {
            d = g.getImageData(Math.round(cv.width / 2), Math.round(cv.height / 2), 1, 1).data;
          } catch {
            painted += 1;
            continue;
          }
          if (d[3] < 8) blank += 1;
          else painted += 1;
        }
        return {
          t: Math.round(performance.now() - window.__t0),
          onScreenCells: cells.length,
          painted,
          blankCanvas: blank,
          belowFullOpacity: faded,
        };
      })
    )
  );
}
await browser.close();
