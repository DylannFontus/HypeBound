/**
 * Plays each puzzle in the browser: solves the first, then deliberately fails
 * it to prove the retry loop deals a fresh board rather than stranding you on
 * a lost one.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

let failures = 0;
const fail = (m) => {
  console.log(`   FAIL: ${m}`);
  failures += 1;
};

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const ack = async () => {
  for (let i = 0; i < 6; i++) {
    const clicked = await page
      .evaluate(() => {
        const b = document.querySelector(".coach-ack");
        if (!b || b.hidden) return false;
        b.click();
        return true;
      })
      .catch(() => false);
    if (!clicked) return;
    await page.waitForTimeout(400);
  }
};

const snapshot = () =>
  page.evaluate(() => {
    const v = window.hypeboundBattle.view();
    const s = window.hypeboundBattle.stage?.() ?? null;
    return {
      stageId: s?.stageId ?? null,
      enemyHp: v.opponent.leaderHealth,
      turn: v.turn,
      winner: v.winner,
      hype: v.you.hype,
      board: v.you.board.filter(Boolean).length,
    };
  });

// --- P1: solve it the intended way ------------------------------------------
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#puzzle?n=1&try=1", { waitUntil: "networkidle" });
await page.waitForSelector(".battle-screen", { timeout: 20000 });
await page.waitForTimeout(2400);
await ack();
await page.waitForTimeout(600);

const opened = await snapshot();
console.log(`P1 opened: ${JSON.stringify(opened)}`);
if (opened.stageId !== "p1-ratio-required") fail("P1 did not load");
if (opened.hype !== 2) fail(`P1 should open on 2 Hype (the "turn" setup op), got ${opened.hype}`);

// Gale 2/1 kills the Root wall via the Current bonus, then the Cinder 3/2 finishes.
const solveP1 = async () => {
  const info = await page.evaluate(() => {
    const d = window.hypeboundBattle.debug();
    return { ready: d.readyAttackers, targets: d.legalAttackTargets };
  });
  const small = info.ready.find((r) => r.cardId === "meme-first-poster");
  const wall = info.targets.find((t) => t.kind === "character");
  if (!small || !wall) return false;
  await page.mouse.move(small.x, small.y);
  await page.mouse.down();
  await page.mouse.move(wall.x, wall.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1400);

  const after = await page.evaluate(() => {
    const d = window.hypeboundBattle.debug();
    return { ready: d.readyAttackers, targets: d.legalAttackTargets };
  });
  const big = after.ready.find((r) => r.cardId === "viral-drama-channel");
  const leader = after.targets.find((t) => t.kind === "leader");
  if (!big || !leader) return false;
  await page.mouse.move(big.x, big.y);
  await page.mouse.down();
  await page.mouse.move(leader.x, leader.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  return true;
};

if (!(await solveP1())) fail("could not execute P1's line");
const solved = await snapshot();
console.log(`P1 after the line: ${JSON.stringify(solved)}`);
await page.screenshot({ path: path.join(OUT, "puzzle-01-solved.png") });
if (solved.enemyHp > 0 && solved.stageId === "p1-ratio-required") {
  fail(`P1's intended line did not win (enemy on ${solved.enemyHp})`);
}

// --- P1 again: fail on purpose, and check retry deals a fresh board ----------
await page.goto("http://localhost:5173/#puzzle?n=1&try=1", { waitUntil: "networkidle" });
await page.waitForSelector(".battle-screen", { timeout: 20000 });
await page.waitForTimeout(2400);
await ack();
await page.waitForTimeout(500);

await page.locator(".end-turn-btn").click({ force: true }).catch(() => {});
await page.waitForTimeout(3000);

const afterFail = await snapshot();
console.log(`P1 after deliberately passing: ${JSON.stringify(afterFail)}`);
await page.screenshot({ path: path.join(OUT, "puzzle-02-retry.png") });
// the retry must have re-dealt: full enemy health and the opening Hype back
if (afterFail.enemyHp !== 3) fail(`retry did not re-deal the board (enemy on ${afterFail.enemyHp}, expected 3)`);
if (afterFail.hype !== 2) fail(`retry did not restore the opening Hype (got ${afterFail.hype})`);

// --- every puzzle opens, and deals the board its data says -------------------
/**
 * Division of labour, deliberately.
 *
 * The unit suite already proves every puzzle's SOLUTION by re-simulation, and
 * asserts the plausible wrong line fails — that is where the rules live and it
 * needs no browser. What only a browser can show is that each puzzle renders,
 * opens, acknowledges its brief and is playable without a console error.
 *
 * Doing that for all of them matters because the check above only ever opened
 * P1: five puzzles could have been dealing an empty board, or throwing on their
 * first frame, and this script would still have printed "Puzzles OK".
 */
const puzzleData = JSON.parse(
  await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "encounters", "puzzles.json"), "utf8")
);

console.log(`\nopening all ${puzzleData.stages.length} puzzles:`);
for (const [index, stage] of puzzleData.stages.entries()) {
  const before = errors.length;
  await page.goto(`http://localhost:5173/#puzzle?n=${index + 1}&try=1`, { waitUntil: "networkidle" });
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForTimeout(1800);
  await ack();
  await page.waitForTimeout(400);

  const shot = await snapshot();
  const setup = stage.scenario?.setup ?? [];
  const authored = {
    enemyHp: setup.find((op) => op.op === "leaderHealth" && op.seat === 1)?.value ?? null,
    // Hype is derived from the seat's turn counter, never set directly
    hype: setup.find((op) => op.op === "turn" && op.seat === 0)?.value ?? null,
    board: setup.filter((op) => op.op === "board" && op.seat === 0).length,
  };

  const problems = [];
  if (shot.stageId !== stage.id) problems.push(`loaded ${shot.stageId}`);
  if (authored.enemyHp !== null && shot.enemyHp !== authored.enemyHp) {
    problems.push(`enemy on ${shot.enemyHp}, data says ${authored.enemyHp}`);
  }
  if (authored.hype !== null && shot.hype !== authored.hype) {
    problems.push(`${shot.hype} Hype, the turn op implies ${authored.hype}`);
  }
  if (shot.board !== authored.board) problems.push(`${shot.board} characters, data places ${authored.board}`);
  const fresh = errors.slice(before);
  if (fresh.length) problems.push(fresh.join(" | "));

  if (problems.length) fail(`${stage.id}: ${problems.join("; ")}`);
  else console.log(`  ok   ${stage.title} — ${stage.teaches.split(" — ")[0]}`);
}

console.log(errors.length ? `\nconsole errors: ${errors.join(" | ")}` : "\nno console errors");
if (errors.length) failures += 1;
console.log(failures === 0 ? "\nPuzzles OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
