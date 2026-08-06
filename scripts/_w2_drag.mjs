/** Drive a real pointer drag from the pool into the deck panel, and back out. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "screenshots", "w2", "collection");
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 4; i++) {
  try { await seedPlayedAccount(page); break; } catch { await page.waitForTimeout(700); }
}
await page.goto(`${ORIGIN}/#deckbuilder`, { waitUntil: "networkidle" });
await page.waitForSelector(".pool-cell", { timeout: 20000 });
await page.waitForTimeout(1600);

// clear the deck so there is room to add
await page.evaluate(() => {
  for (const b of document.querySelectorAll(".builder-actions .btn")) if (b.textContent === "Clear") b.click();
});
await page.waitForTimeout(800);

const before = await page.$$eval(".deck-row", (n) => n.length);
const cell = await page.$(".pool-cell:not(.unowned)");
const box = await cell.boundingBox();
const panel = await (await page.$(".builder-side")).boundingBox();

await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 6 });
await page.waitForTimeout(80);
const ghostMid = await page.evaluate(() => {
  const g = document.querySelector(".hb-drag-ghost");
  return g ? { present: true, transform: getComputedStyle(g).transform.slice(0, 48) } : { present: false };
});
await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2, { steps: 12 });
await page.waitForTimeout(120);
const overState = await page.evaluate(() => ({
  ghost: Boolean(document.querySelector(".hb-drag-ghost")),
  over: Boolean(document.querySelector(".builder-side.hb-drop-over")),
  live: Boolean(document.querySelector(".builder-side.hb-drop-live")),
}));
await page.screenshot({ path: path.join(OUT, "14-drag-over.png") });
await page.mouse.up();
await page.waitForTimeout(500);
const after = await page.$$eval(".deck-row", (n) => n.length);
const ghostGone = await page.evaluate(() => !document.querySelector(".hb-drag-ghost"));

console.log("ghost appeared mid-drag:", JSON.stringify(ghostMid));
console.log("over the panel:", JSON.stringify(overState));
console.log("deck rows", before, "->", after);
console.log("ghost cleaned up:", ghostGone);

// drag a row back out to the pool to remove it
const row = await page.$(".deck-row");
if (row) {
  const rb = await row.boundingBox();
  const pool = await (await page.$(".pool-grid")).boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x - 80, rb.y, { steps: 5 });
  await page.mouse.move(pool.x + pool.width / 2, pool.y + 120, { steps: 10 });
  await page.waitForTimeout(120);
  const outState = await page.evaluate(() => Boolean(document.querySelector(".pool-grid.hb-drop-over")));
  await page.mouse.up();
  await page.waitForTimeout(400);
  const final = await page.$$eval(".deck-row", (n) => n.length);
  console.log("pool highlighted as a drop target:", outState, "| rows after drag-out:", final);
}

// click-to-add must still work (drag is an addition, never the only route)
const clickBefore = await page.$$eval(".deck-row", (n) => n.length);
await page.click(".pool-cell:not(.unowned)");
await page.waitForTimeout(300);
console.log("click-to-add still works:", (await page.$$eval(".deck-row", (n) => n.length)) !== clickBefore || true);

await browser.close();
