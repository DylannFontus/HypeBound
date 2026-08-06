/**
 * What one card actually costs, and how much of a long task is not the card.
 *
 * The three heavy routes all show long tasks of 60–90ms arriving on a steady
 * cadence long after the screen has settled, and the obvious reading — "that is
 * a card rasterisation" — is a guess. `collectionScreen.paint` already stamps
 * `window.__cardMs` around its own `renderCardToCanvas` call, so the JS half of
 * the cost is already on the record; this reads it back beside the long-task
 * ledger so the *other* half — the style, layout and paint of inserting a canvas
 * into a live eight-thousand-pixel grid — can be named rather than assumed.
 *
 * Aimed at a line, not at a screen: if the card is 4ms and the task is 68ms then
 * chunking the rasterisation is fixing the wrong sixteenth of the problem.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const route = process.argv[2] ?? "collection";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
await page.waitForTimeout(1400);

await page.evaluate(
  ([hash]) => {
    const w = window;
    w.__cardMs = [];
    w.__long = [];
    w.__t0 = performance.now();
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__long.push([Math.round(e.startTime - w.__t0), Math.round(e.duration)]);
    });
    obs.observe({ entryTypes: ["longtask"] });
    location.hash = hash;
  },
  [`#${route}`]
);
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const w = window;
  const cards = w.__cardMs ?? [];
  const long = w.__long ?? [];
  const total = long.reduce((a, b) => a + b[1], 0);
  const canvases = document.querySelectorAll("#app > .screen canvas").length;
  return {
    cards: cards.length,
    cardTotal: cards.reduce((a, b) => a + b, 0),
    cardMax: Math.max(0, ...cards),
    cardList: cards.slice(0, 40),
    longCount: long.length,
    total,
    long: long.slice(0, 24),
    canvases,
    tiles: document.querySelectorAll("#app > .screen .card-cell, #app > .screen .pool-cell, #app > .screen .gal-tile")
      .length,
  };
});

console.log(`\n${route} @1600x900, 4s after the click`);
console.log(`  cards rasterised  ${out.cards}   total ${out.cardTotal}ms   worst ${out.cardMax}ms`);
console.log(`  per-card ms       ${out.cardList.join(" ")}`);
console.log(`  long tasks        ${out.longCount} / ${out.total}ms`);
console.log(`  ${out.long.map(([t, d]) => `${d}@${t}`).join("  ")}`);
console.log(`  canvases on screen ${out.canvases}   tiles ${out.tiles}`);
console.log(
  `  JS card time is ${out.total > 0 ? ((out.cardTotal / out.total) * 100).toFixed(0) : 0}% of all blocked thread\n`
);

await browser.close();
