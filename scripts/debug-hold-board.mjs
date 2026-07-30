/** Verify press-and-hold on a BOARD card inspects it instead of starting an attack. */
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
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("response", (r) => r.status() === 404 && errors.push(`404 ${r.url()}`));

await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2000);

/** Play characters and pass turns until something friendly is ready to attack. */
const playOne = async () => {
  const card = await page.evaluate(
    () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
  );
  if (!card) return false;
  await page.mouse.move(card.screen.x, card.screen.y);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 14 }); // into the friendly row
  await page.mouse.up();
  await page.waitForTimeout(700);
  return true;
};

const endTurn = async () => {
  await page.click(".end-turn-btn");
  // ending with hype and playable cards left raises a "sure?" confirmation
  await page.waitForTimeout(300);
  if ((await page.locator(".confirm-overlay .btn-primary").count()) > 0) {
    await page.click(".confirm-overlay .btn-primary");
  }
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, {
    timeout: 40000,
  });
  await page.waitForTimeout(1600);
};

/**
 * Get a friendly card onto the board and let it lose summoning sickness, so the
 * hold is competing with a live attack drag — that is the case worth proving.
 */
let row = [];
let ready = [];
for (let round = 0; round < 6 && ready.length === 0; round += 1) {
  for (let i = 0; i < 3; i += 1) if (!(await playOne())) break;
  await endTurn();
  const debug = await page.evaluate(() => window.hypeboundBattle.debug());
  row = debug.friendlyRowX;
  ready = debug.readyAttackers;
  // readiness only means anything on our own main phase — report it, so a zero
  // here is not mistaken for characters being unable to attack
  console.log(
    `round ${round}: board=${row.length} readyAttackers=${ready.length} ` +
      `(active=${debug.activeSeat} us=${debug.seat} phase=${debug.phase})`
  );
}

const target = ready[0] ?? (row[0] ? { ...row[0].screen, cardId: row[0].id } : null);

if (!target) {
  console.log("FAIL: never got a friendly card onto the board");
  process.exitCode = 1;
} else {
  const healthBefore = await page.evaluate(() => window.hypeboundBattle.view().opponent.leaderHealth);

  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(700); // hold without moving
  const overlay = await page.locator(".detail-overlay").count();
  await page.screenshot({ path: path.join(OUT, "hold-inspect-board.png") });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const healthAfter = await page.evaluate(() => window.hypeboundBattle.view().opponent.leaderHealth);
  const dragState = await page.evaluate(() => window.hypeboundBattle.debug().drag);

  console.log(`held on board card ${target.cardId} (could attack: ${ready.length > 0})`);
  console.log(`detail overlay open during hold: ${overlay > 0}`);
  console.log(`drag after release: ${JSON.stringify(dragState)} (must be null: the hold cancels the attack drag)`);
  console.log(`enemy leader health ${healthBefore} -> ${healthAfter} (must be unchanged)`);
}

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
await browser.close();
