/**
 * Does the trend sparkline actually paint, now that it is not made of pips?
 *
 * `verify:screens` counts `.stats-pip` elements and finds none, because the
 * thirty-match strip of identical 10×18 rectangles — recon's MAJOR defect 6,
 * signalled by background colour alone — was replaced by a drawn sparkline. A
 * stale assertion and a chart that renders nothing produce the same zero, and
 * this project has already been lied to five times by an instrument that
 * confidently measured the wrong thing.
 *
 * So this does not count elements. It reads the pixels inside `#stats-trend`
 * and reports how many are painted and how many distinct colours are present —
 * a canvas that draws a flat wash and a canvas that draws a line are different
 * numbers, and a canvas that draws nothing is zero.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page);

// three real records, so the trend has something to draw
await page.evaluate(async () => {
  const { recordMatch } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const storage = await import("/src/save/storage.ts");
  const content = getContent();
  for (const outcome of ["win", "loss", "win"]) {
    recordMatch(
      { config: { seed: 7, decks: [], firstSeat: 0 }, intents: [], result: { winner: outcome === "win" ? 0 : 1, turns: 6 }, state: {} },
      outcome,
      { deckName: "Trend", leaderCardId: "idols-lumi-starcall", opponentLeaderCardId: "goth-leader-alaric-thornheart", mode: "ai-casual", content },
    );
  }
  storage.flushAllStores();
});

await page.goto("http://localhost:5173/#stats", { waitUntil: "load" });
await page.waitForSelector(".stats-screen", { timeout: 20000 });
await page.waitForTimeout(2000);

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const host = document.querySelector("#stats-trend");
      if (!host) return { host: null };
      const canvas = host.querySelector("canvas");
      const svg = host.querySelector("svg");
      const box = host.getBoundingClientRect();
      const result = {
        hostTag: host.tagName,
        box: [Math.round(box.width), Math.round(box.height)],
        canvas: Boolean(canvas),
        svg: Boolean(svg),
        childHtmlLength: host.innerHTML.length,
      };
      if (canvas) {
        const ctx = canvas.getContext("2d");
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let painted = 0;
        const colours = new Set();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 8) {
            painted += 1;
            colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          }
        }
        result.canvasSize = [canvas.width, canvas.height];
        result.paintedPixels = painted;
        result.distinctColours = colours.size;
      }
      return result;
    }),
    null,
    1,
  ),
);
await browser.close();
