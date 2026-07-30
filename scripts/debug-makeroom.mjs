/** Verify the board opens a gap while a character is dragged over the row. */
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

const myTurn = async () => {
  await page.waitForFunction(
    () => document.querySelector(".end-turn-btn:not([disabled])") !== null || document.querySelector(".end-overlay"),
    { timeout: 40000 }
  );
};

const playChars = async (n) => {
  for (let i = 0; i < n; i++) {
    const c = await page.evaluate(
      () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.type === "character" && h.screen) ?? null
    );
    if (!c) return;
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(c.screen.x, c.screen.y);
    await page.waitForTimeout(140);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
};

void playChars;

// Seed a row deterministically through the engine hook. Dragging cards in by
// hand burns turns and the AI runs away with the game before a row exists.
await myTurn();
await page.evaluate(async () => {
  const api = window.hypeboundBattle;
  for (let i = 0; i < 3; i++) {
    const view = api.view();
    const card = view.you.hand.find((c) => {
      const def = window.hypebound.content.cards[c.cardId];
      return def && def.type === "character";
    });
    if (!card) break;
    // grant enough Hype so the play is always legal, then play it
    const state = api.state();
    state.players[view.seat].hype = 10;
    await api.submit({ type: "playCard", seat: view.seat, instanceId: card.instanceId, slot: i });
  }
});
await page.waitForTimeout(1200);

const positionsOf = () =>
  page.evaluate(() =>
    window.hypeboundBattle
      .debug()
      .legalAttackTargets.filter((t) => t.kind === "character")
      .map((t) => Math.round(t.x))
  );

const rowX = async () =>
  page.evaluate(() => {
    const api = window.hypeboundBattle;
    void api;
    return null;
  });
void rowX;
void positionsOf;

await myTurn();
const before = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
console.log(`friendly characters on board: ${before}`);

// now pick up a character card and hold it over the row without releasing
const candidate = await page.evaluate(
  () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.type === "character" && h.screen) ?? null
);
if (!candidate) {
  console.log("no playable character to drag — cannot demonstrate make-room");
} else {
  const box = await page.locator("canvas").first().boundingBox();
  await page.screenshot({ path: path.join(OUT, "makeroom-before.png") });

  await page.mouse.move(candidate.screen.x, candidate.screen.y);
  await page.waitForTimeout(140);
  await page.mouse.down();
  // hover over the LEFT end of the player's row so the gap opens at index 0
  const rowBefore = await page.evaluate(() => window.hypeboundBattle.debug().friendlyRowX);
  console.log("row x before drag:", JSON.stringify(rowBefore));

  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.47, { steps: 14 });
  await page.waitForTimeout(700); // let the row slide apart
  await page.screenshot({ path: path.join(OUT, "makeroom-during.png") });

  const during = await page.evaluate(() => {
    const d = window.hypeboundBattle.debug();
    return { externalDrag: d.externalDrag, makeRoomIndex: d.makeRoomIndex, rowX: d.friendlyRowX };
  });
  console.log("during drag:", JSON.stringify(during));

  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "makeroom-after.png") });
  console.log("wrote makeroom-before/during/after.png");
}

await browser.close();
