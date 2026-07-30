/** Screenshot a single board card at 3x so its stat gems can be judged. */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 3 });
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2000);

// play a character so there is a friendly board card to inspect
for (let i = 0; i < 2; i += 1) {
  const card = await page.evaluate(
    () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
  );
  if (!card) break;
  await page.mouse.move(card.screen.x, card.screen.y);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
await page.mouse.move(20, 20); // park the pointer away from the board
await page.waitForTimeout(600);

const row = await page.evaluate(() => window.hypeboundBattle.debug().friendlyRowX);
if (!row.length) {
  console.log("no friendly board card to zoom");
} else {
  const { x, y } = row[0].screen;
  const clip = { x: Math.max(0, x - 90), y: Math.max(0, y - 115), width: 180, height: 230 };
  await page.screenshot({ path: path.join(OUT, "board-card-zoom.png"), clip });
  console.log(`wrote board-card-zoom.png around (${Math.round(x)}, ${Math.round(y)})`);
}

// and one enemy card, which is the row you read across to plan trades
const targets = await page.evaluate(() => window.hypeboundBattle.debug().legalAttackTargets ?? []);
const enemy = targets.find((t) => t.kind === "character");
if (enemy) {
  const clip = { x: Math.max(0, enemy.x - 90), y: Math.max(0, enemy.y - 115), width: 180, height: 230 };
  await page.screenshot({ path: path.join(OUT, "board-card-zoom-enemy.png"), clip });
  console.log("wrote board-card-zoom-enemy.png");
}

await browser.close();
