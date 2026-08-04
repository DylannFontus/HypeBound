/**
 * Photograph the deck builder mid-drag.
 *
 * The ghost, the drop-zone rim and the row that parts to receive the card only
 * exist between pointerdown and pointerup, so an ordinary screenshot of the
 * builder contains none of them and every review of drag feedback made from one
 * was a review of a screen with nothing being dragged. This holds the pointer
 * over the deck panel, then over the pool (the remove direction), then off both.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const outDir = path.join(HERE, "screenshots", "w3", "collection");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
for (let i = 0; i < 6; i++) {
  try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); }
}
await page.goto(`${ORIGIN}/#deckbuilder`, { waitUntil: "networkidle" });
await page.waitForSelector(".pool-cell canvas");
await page.waitForTimeout(2200);

// a full 30/30 deck refuses every add, which is its own state — shoot that first
{
  const full = await page.locator(".pool-cell").nth(3).boundingBox();
  const side = await page.locator(".builder-side").boundingBox();
  await page.mouse.move(full.x + full.width / 2, full.y + full.height / 2);
  await page.mouse.down();
  await page.mouse.move(full.x + full.width / 2 + 40, full.y - 20, { steps: 6 });
  await page.mouse.move(side.x + side.width / 2, side.y + 320, { steps: 12 });
  await page.waitForTimeout(300);
  console.log("refused ghost:", await page.evaluate(() => Boolean(document.querySelector(".hb-drag-ghost.is-refused"))));
  console.log("deny zone:", await page.evaluate(() => document.querySelectorAll(".hb-drop-deny-over").length));
  await page.screenshot({ path: path.join(outDir, "43-drag-refused.png") });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

// make room, so the legal path can be photographed too
await page.locator(".deck-row").first().click();
await page.waitForTimeout(600);

// a card that is genuinely addable, or the "legal" capture is another refusal
const from = await page.locator(".pool-cell:not(.at-limit):not(.unowned)").first().boundingBox();
const panel = await page.locator(".builder-side").boundingBox();
const pool = await page.locator(".pool-grid").boundingBox();

await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
// past the 7px threshold, then onto the deck panel
await page.mouse.move(from.x + from.width / 2 + 40, from.y + from.height / 2 - 20, { steps: 6 });
await page.mouse.move(panel.x + panel.width / 2, panel.y + 320, { steps: 12 });
await page.waitForTimeout(320);
console.log("ghost present:", await page.evaluate(() => Boolean(document.querySelector(".hb-drag-ghost"))));
console.log(
  "zone lit:",
  await page.evaluate(() => ({
    live: document.querySelectorAll(".hb-drop-live").length,
    over: document.querySelectorAll(".hb-drop-over").length,
    source: Boolean(document.querySelector(".hb-dragging")),
  }))
);
await page.screenshot({ path: path.join(outDir, "40-drag-over-deck.png") });

// and off every target, which must read as "this will not do anything"
await page.mouse.move(pool.x + pool.width / 2, pool.y - 60, { steps: 10 });
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(outDir, "41-drag-outside.png") });
await page.mouse.up();
await page.waitForTimeout(700);
console.log("ghost cleared:", await page.evaluate(() => !document.querySelector(".hb-drag-ghost")));

// the other direction: a deck row dragged out of the list
const row = await page.locator(".deck-row").first().boundingBox();
if (row) {
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x - 60, row.y + 30, { steps: 8 });
  await page.mouse.move(pool.x + pool.width / 2, pool.y + 200, { steps: 12 });
  await page.waitForTimeout(320);
  console.log("row drag ghost:", await page.evaluate(() => Boolean(document.querySelector(".hb-drag-ghost"))));
  await page.screenshot({ path: path.join(outDir, "42-drag-row-out.png") });
  await page.mouse.up();
}
await browser.close();
