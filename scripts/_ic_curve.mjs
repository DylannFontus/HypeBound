/**
 * Is the deck builder's Hype Curve blank because it measured itself detached?
 *
 * The chart sets each bar's `scaleY` from `curveBarsHost.clientHeight`, read
 * inside the constructor. `shell.ts` now builds screens on a detached tree, so
 * that read is 0, `filled / 0` is `Infinity`, and the CSSOM silently drops the
 * declaration — leaving the stylesheet's rest value of `scaleY(0)` in place.
 * The test is simply whether provoking a second render, once the screen is
 * attached and has a height, makes bars appear.
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
await page.goto(`${ORIGIN}/?nointro#deckbuilder`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
  .catch(() => {});
await page.waitForTimeout(1500);

const read = () =>
  page.evaluate(() => {
    const bars = [...document.querySelectorAll(".curve-bar")];
    return {
      host: document.querySelector(".curve-bars")?.clientHeight ?? null,
      inline: bars.map((b) => b.querySelector(".curve-fill").getAttribute("style") || ""),
      painted: bars.map((b) => +b.querySelector(".curve-fill").getBoundingClientRect().height.toFixed(1)),
      counts: bars.map((b) => b.querySelector(".curve-count")?.getAttribute("style") || ""),
    };
  });

console.log("AT MOUNT:", JSON.stringify(await read(), null, 1));

// Provoke a second render while attached: remove one copy of a card from the deck.
await page.evaluate(() => {
  const row = document.querySelector(".deck-row [data-act='dec'], .deck-row button");
  if (row instanceof HTMLElement) row.click();
});
await page.waitForTimeout(900);
console.log("\nAFTER ONE DECK EDIT:", JSON.stringify(await read(), null, 1));

await browser.close();
