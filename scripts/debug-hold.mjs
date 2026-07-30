/** Verify press-and-hold on a hand card opens the detail view, not a play. */
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2200);

const boardCount = () => page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
const playableCharacter = () =>
  page.evaluate(
    () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
  );

// --- A: hold still, then release. A look, not a play. ------------------------
{
  const before = await boardCount();
  const card = await playableCharacter();
  if (!card) throw new Error("no playable character to hold");

  await page.mouse.move(card.screen.x, card.screen.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(700); // hold, without moving
  const duringHold = await page.locator(".detail-overlay").count();
  await page.screenshot({ path: path.join(OUT, "hold-inspect.png") });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const afterRelease = await page.locator(".detail-overlay").count();
  const after = await boardCount();
  console.log(`A: peek open while held: ${duringHold > 0} (expect true)`);
  console.log(`A: peek closed on release: ${afterRelease === 0} (expect true)`);
  console.log(`A: board ${before} -> ${after} (must be unchanged: holding looks, it does not play)`);
}

/**
 * B is the regression that matters: pausing before you drag must not cost you
 * the play. The peek opens mid-press and then the pointer moves — the card has
 * to land on the board exactly as if the pause never happened.
 */
{
  const before = await boardCount();
  const card = await playableCharacter();
  if (!card) throw new Error("no playable character left for the hold-then-drag case");

  await page.mouse.move(card.screen.x, card.screen.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(600); // hold long enough that the peek definitely opened
  const peeked = await page.locator(".detail-overlay").count();
  await page.mouse.move(800, 450, { steps: 14 }); // ...then change your mind and drag
  await page.waitForTimeout(200);
  const peekDismissed = (await page.locator(".detail-overlay").count()) === 0;
  await page.mouse.up();
  await page.waitForTimeout(900);

  const after = await boardCount();
  console.log(`B: peek opened during the pause: ${peeked > 0} (expect true)`);
  console.log(`B: peek dismissed once dragging: ${peekDismissed} (expect true)`);
  console.log(`B: board ${before} -> ${after} (must increase: pausing before a drag still plays the card)`);
  if (after <= before) process.exitCode = 1;
}

await browser.close();
