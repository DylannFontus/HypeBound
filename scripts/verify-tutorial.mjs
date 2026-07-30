/**
 * Plays tutorial stage 1 the way a person would: read the coach, drag the card
 * it asks for, end turns, and confirm the gate actually refuses what the lesson
 * has not reached yet.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

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
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const fail = (message) => {
  console.log(`FAIL: ${message}`);
  process.exitCode = 1;
};

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#tutorial", { waitUntil: "networkidle" });
await page.waitForSelector(".battle-screen", { timeout: 20000 });
await page.waitForTimeout(2500);

// --- the coach should be speaking, and the board gated -----------------------
const coachVisible = await page.locator(".coach-panel").isVisible().catch(() => false);
console.log(`coach panel visible: ${coachVisible}`);
if (!coachVisible) fail("the coach never spoke");

const firstLine = await page.locator(".coach-text").textContent().catch(() => "");
console.log(`first line: ${(firstLine ?? "").slice(0, 70)}...`);

await page.screenshot({ path: path.join(OUT, "tutorial-01-intro.png") });

// progressive reveal: hype and end turn are introduced in stage 1
const revealed = await page.evaluate(() => {
  const el = document.querySelector(".battle-screen");
  return { active: el?.classList.contains("tutorial-active"), classes: [...(el?.classList ?? [])].join(" ") };
});
console.log(`tutorial-active: ${revealed.active}`);
if (!revealed.active) fail("progressive reveal never engaged");

// --- acknowledge the intro ---------------------------------------------------
await page.locator(".coach-ack").click();
await page.waitForTimeout(1200);

const beatAfterIntro = await page.locator(".coach-text").textContent().catch(() => "");
console.log(`after ack: ${(beatAfterIntro ?? "").slice(0, 70)}...`);
await page.locator(".coach-ack").click().catch(() => {});
await page.waitForTimeout(900);

// --- the gate must refuse ending the turn before the card is played ----------
const boardBefore = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
await page.locator(".end-turn-btn").click({ force: true }).catch(() => {});
await page.waitForTimeout(900);
const turnAfterBlockedEnd = await page.evaluate(() => window.hypeboundBattle.view().turn);
const toast = await page.locator(".toast-layer").textContent().catch(() => "");
console.log(`gate refusal toast: ${(toast ?? "").trim().slice(0, 70)}`);
if (turnAfterBlockedEnd !== 1) fail(`gate let the turn end early (turn ${turnAfterBlockedEnd})`);
// a lesson must never stack a confirmation on top of a gate: if one appeared,
// the modal would swallow every later click and the stage would be unfinishable
if (await page.locator(".confirm-overlay").count()) {
  fail("a confirmation dialog opened during a gated lesson step");
  await page.locator(".confirm-overlay .btn-ghost").click().catch(() => {});
}
await page.screenshot({ path: path.join(OUT, "tutorial-02-gated.png") });

// --- play the card the lesson asks for --------------------------------------
const card = await page.evaluate(
  () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen) ?? null
);
if (!card) {
  fail("no playable card in hand — the scripted hand did not deal");
} else {
  await page.mouse.move(card.screen.x, card.screen.y);
  await page.mouse.down();
  await page.mouse.move(800, 470, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(1400);

  const boardAfter = await page.evaluate(() => window.hypeboundBattle.view().you.board.filter(Boolean).length);
  console.log(`board ${boardBefore} -> ${boardAfter} (the lesson's card should be down)`);
  if (boardAfter <= boardBefore) fail("the card the lesson asked for could not be played");
  await page.screenshot({ path: path.join(OUT, "tutorial-03-played.png") });
}

// --- and now ending the turn should be permitted -----------------------------
await page.locator(".coach-ack").click().catch(() => {});
await page.waitForTimeout(700);
await page.locator(".end-turn-btn").click({ force: true }).catch(() => {});
await page.waitForTimeout(2200);
const turnAfterAllowedEnd = await page.evaluate(() => window.hypeboundBattle.view().turn);
console.log(`turn after the lesson permits ending: ${turnAfterAllowedEnd}`);
if (turnAfterAllowedEnd < 2) fail("the turn never advanced once the beat allowed it");
await page.screenshot({ path: path.join(OUT, "tutorial-04-turn2.png") });

/**
 * Progression, in ONE page.
 *
 * This is the case the per-stage harness cannot see, because it opens each
 * stage at its own URL. Finishing a stage navigates #tutorial -> #tutorial?stage=2,
 * and a router that compares only the route id treats that as "already here" —
 * leaving the player stranded on a finished board forever.
 */
{
  const stageNow = () => page.evaluate(() => window.hypeboundBattle?.stage?.()?.stageId ?? null);
  const before = await stageNow();
  console.log(`progression: starting on ${before}`);

  const ack = async () => {
    for (let i = 0; i < 8; i++) {
      const clicked = await page
        .evaluate(() => {
          const b = document.querySelector(".coach-ack");
          if (!b || b.hidden) return false;
          b.click();
          return true;
        })
        .catch(() => false);
      if (!clicked) return;
      await page.waitForTimeout(450);
    }
  };

  // finish stage 1: get three characters down, ending turns as needed
  for (let step = 0; step < 16; step++) {
    await ack();
    if ((await stageNow()) !== before) break;
    const card = await page.evaluate(
      () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen) ?? null
    );
    if (card) {
      await page.mouse.move(card.screen.x, card.screen.y);
      await page.mouse.down();
      await page.mouse.move(800, 470, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    } else {
      await page.locator(".end-turn-btn").click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  await ack();
  await page.waitForTimeout(1500);

  const after = await stageNow();
  console.log(`progression: now on ${after}`);
  if (after === before || after === null) {
    fail(`finishing a stage did not advance to the next one (still ${after})`);
  }
  await page.screenshot({ path: path.join(OUT, "tutorial-05-next-stage.png") });
}

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
if (errors.length) process.exitCode = 1;
await browser.close();
