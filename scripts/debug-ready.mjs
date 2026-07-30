/** Explain, per friendly character, why it can or cannot attack right now. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

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

/** Block until it is genuinely our main phase with no animation running. */
const ourTurn = async () => {
  await page.waitForFunction(
    () => {
      const v = window.hypeboundBattle?.view?.();
      return v && v.activeSeat === v.seat && v.phase === "main" && !v.winner;
    },
    { timeout: 60000 }
  );
  await page.waitForTimeout(1400);
};

const playCharacters = async () => {
  for (let i = 0; i < 3; i += 1) {
    const card = await page.evaluate(
      () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
    );
    if (!card) return;
    await page.mouse.move(card.screen.x, card.screen.y);
    await page.mouse.down();
    await page.mouse.move(800, 450, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
};

const endTurn = async () => {
  await page.click(".end-turn-btn");
  await page.waitForTimeout(300);
  if ((await page.locator(".confirm-overlay .btn-primary").count()) > 0) {
    await page.click(".confirm-overlay .btn-primary");
  }
};

await ourTurn();

for (let round = 0; round < 5; round += 1) {
  const snapshot = await page.evaluate(() => {
    const view = window.hypeboundBattle.view();
    const debug = window.hypeboundBattle.debug();
    return {
      turn: view.turn,
      globalTurn: view.globalTurnCounter,
      ready: debug.readyAttackers.length,
      board: view.you.board.filter(Boolean).map((c) => ({
        id: c.instanceId,
        cardId: c.cardId,
        atk: c.attack,
        hp: c.health,
        used: c.attacksUsedThisTurn,
        maxAttacks: c.maxAttacksPerTurn,
        summonedOn: c.summonedOnTurn,
        frozen: c.frozen ?? null,
        cannotAttack: c.cannotAttack ?? null,
      })),
    };
  });
  console.log(`turn ${snapshot.turn} (global ${snapshot.globalTurn}) ready=${snapshot.ready}`);
  for (const c of snapshot.board) console.log(`   ${JSON.stringify(c)}`);
  if (snapshot.board.length > 0) break;

  await playCharacters();
  await endTurn();
  await ourTurn();
}

await browser.close();
