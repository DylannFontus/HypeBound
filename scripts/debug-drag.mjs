/** Focused diagnostic for hand interaction. Not part of the test suite. */
import { chromium } from "playwright-core";

const BASE = "http://localhost:5173";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
});

await page.goto(`${BASE}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });

// build some Hype so several cards are castable
for (let i = 0; i < 3; i++) {
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
  await page.click(".end-turn-btn");
  const confirm = page.locator(".confirm-panel .btn-primary");
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(1500);
}
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(800);

// what does the engine think is playable?
const playable = await page.evaluate(() => {
  const api = window.hypeboundBattle;
  const view = api.view();
  return {
    hype: view.you.hype,
    phase: view.phase,
    activeSeat: view.activeSeat,
    seat: view.seat,
    hand: view.you.hand.map((c) => c.cardId),
  };
});
console.log("engine view:", JSON.stringify(playable, null, 2));

// sweep the lower screen and report where a card is actually pickable
const box = await page.locator("canvas").first().boundingBox();
console.log("canvas box:", box);

const dbg = await page.evaluate(() => window.hypeboundBattle.debug());
console.log("\n--- playable characters in hand ---");
const playableChars = dbg.hand.filter((c) => c.ok && c.type === "character");
console.log(JSON.stringify(playableChars, null, 1));

if (playableChars.length === 0) {
  console.log("!! no playable character in hand — cannot test the board-drop path");
  await browser.close();
  process.exit(0);
}

// drag the first playable character from its ACTUAL screen position
const pick = playableChars[0];
const startX = pick.screen.x;
const startY = pick.screen.y;
console.log(`\ndragging ${pick.cardId} from (${Math.round(startX)}, ${Math.round(startY)})`);
await page.mouse.move(startX, startY);
await page.waitForTimeout(250);
console.log("\ncursor before down:", await page.evaluate(() => document.querySelector("canvas").style.cursor));

await page.mouse.down();
await page.waitForTimeout(150);
console.log("drag after down:", JSON.stringify((await page.evaluate(() => window.hypeboundBattle.debug())).drag));

await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 12 });
await page.waitForTimeout(150);
console.log("drag mid-move:", JSON.stringify((await page.evaluate(() => window.hypeboundBattle.debug())).drag));

const beforeBoard = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
await page.mouse.up();
await page.waitForTimeout(1200);

const after = await page.evaluate(() => ({
  board: window.hypeboundBattle.view().you.board.filter(Boolean).length,
  chooserOpen: document.querySelector(".chooser-panel") !== null,
  toast: document.querySelector(".toast")?.textContent ?? null,
}));
console.log(`\nboard before=${beforeBoard} after=${after.board}`);
console.log("chooser open:", after.chooserOpen, "| toast:", after.toast);

// ---------------------------------------------------------------- ATTACK ----
console.log("\n=== attack path ===");
for (let i = 0; i < 2; i++) {
  await page.waitForFunction(
    () => document.querySelector(".end-turn-btn:not([disabled])") !== null || document.querySelector(".end-overlay") !== null,
    { timeout: 40000 }
  );
  if (await page.locator(".end-overlay").count()) break;
  await page.click(".end-turn-btn").catch(() => {});
  const c = page.locator(".confirm-panel .btn-primary");
  if (await c.count()) await c.click();
  await page.waitForTimeout(1600);
}

const atk = await page.evaluate(() => {
  const d = window.hypeboundBattle.debug();
  return { ready: d.readyAttackers, targets: d.legalAttackTargets, phase: d.phase, active: d.activeSeat, seat: d.seat };
});
console.log("phase:", atk.phase, "active:", atk.active, "seat:", atk.seat);
console.log("ready attackers:", JSON.stringify(atk.ready));
console.log("legal targets:", JSON.stringify(atk.targets));

if (atk.ready?.length && atk.targets?.length) {
  const a = atk.ready[0];
  const t = atk.targets[0];
  const durability = () =>
    page.evaluate(() => {
      const v = window.hypeboundBattle.view();
      return v.opponent.leaderHealth + v.opponent.board.filter(Boolean).reduce((s, c) => s + c.health, 0);
    });
  const before = await durability();

  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(150);
  console.log("drag after down:", JSON.stringify((await page.evaluate(() => window.hypeboundBattle.debug())).drag));

  await page.mouse.move(t.x, t.y, { steps: 12 });
  await page.waitForTimeout(250);
  console.log("drag over target:", JSON.stringify((await page.evaluate(() => window.hypeboundBattle.debug())).drag));

  await page.mouse.up();
  await page.waitForTimeout(1600);
  const afterD = await durability();
  console.log(`durability ${before} -> ${afterD}`);
  console.log("toast:", await page.evaluate(() => document.querySelector(".toast")?.textContent ?? null));
}

await browser.close();
