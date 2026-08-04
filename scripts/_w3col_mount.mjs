/** How long the collection's own construction blocks, separate from painting. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 5; i++) { try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); } }
for (const route of ["collection", "deckbuilder", "gallery", "decks"]) {
  await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(async (r) => {
    const t0 = performance.now();
    location.hash = "#" + r;
    // the shell mounts on the next frame; block-measure until the first tile exists
    let cells = 0;
    while (performance.now() - t0 < 5000) {
      await new Promise((res) => requestAnimationFrame(res));
      cells = document.querySelectorAll(".card-cell, .pool-cell, .gallery-cell, .deck-socket").length;
      if (cells > 0) break;
    }
    return { at: Math.round(performance.now() - t0), cells };
  }, route);
  console.log(route.padEnd(12), "first tile in the DOM at", out.at, "ms;", out.cells, "tiles");
}
await browser.close();
