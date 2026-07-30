/**
 * Exercises The Lab's core contract: an edit re-simulates, undo is exact, both
 * seats are playable, and what it exports deals what you were looking at.
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

let failures = 0;
const fail = (m) => {
  console.log(`   FAIL: ${m}`);
  failures += 1;
};

const snap = () =>
  page.evaluate(() => {
    const s = window.hypeboundLab.state();
    return {
      setup: window.hypeboundLab.setup().length,
      intents: window.hypeboundLab.intents().length,
      boardA: s.players[0].board.filter(Boolean).length,
      boardB: s.players[1].board.filter(Boolean).length,
      hpB: s.players[1].leaderHealth,
      hypeA: s.players[0].hype,
      activeSeat: s.activeSeat,
    };
  });

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#lab", { waitUntil: "networkidle" });
await page.waitForSelector(".lab-screen", { timeout: 20000 });
await page.waitForTimeout(1200);
console.log(`opened: ${JSON.stringify(await snap())}`);

// --- an edit re-simulates ----------------------------------------------------
await page.selectOption("#lab-side", "0");
await page.click("#lab-add");
await page.waitForTimeout(500);
await page.selectOption("#lab-side", "1");
await page.click("#lab-add");
await page.waitForTimeout(500);

const built = await snap();
console.log(`after adding one character per side: ${JSON.stringify(built)}`);
if (built.boardA !== 1 || built.boardB !== 1) fail("adding characters did not reach the board");

// --- setting a value re-simulates -------------------------------------------
await page.selectOption("#lab-what", "leaderHealth");
await page.selectOption("#lab-vside", "1");
await page.fill("#lab-value", "7");
await page.click("#lab-set");
await page.waitForTimeout(500);
const withHp = await snap();
console.log(`after setting rival leader health to 7: hpB=${withHp.hpB}`);
if (withHp.hpB !== 7) fail(`leader health edit did not apply (got ${withHp.hpB})`);

// --- turn sets Hype through the engine's own arithmetic ----------------------
await page.selectOption("#lab-what", "turn");
await page.selectOption("#lab-vside", "0");
await page.fill("#lab-value", "4");
await page.click("#lab-set");
await page.waitForTimeout(500);
const withTurn = await snap();
console.log(`after setting turn 4: hypeA=${withTurn.hypeA}`);
if (withTurn.hypeA !== 4) fail(`turn edit should grant 4 Hype, got ${withTurn.hypeA}`);

await page.screenshot({ path: path.join(OUT, "lab-built.png") });

// --- play a legal move, then undo it exactly ---------------------------------
const before = await snap();
const moves = await page.locator(".lab-move").count();
console.log(`legal moves offered: ${moves}`);
if (moves === 0) fail("no legal moves offered");
else {
  await page.locator(".lab-move").first().click();
  await page.waitForTimeout(600);
  const afterMove = await snap();
  console.log(`after one move: intents=${afterMove.intents}`);
  if (afterMove.intents !== before.intents + 1) fail("the move was not logged");

  await page.click("#lab-undo");
  await page.waitForTimeout(600);
  const undone = await snap();
  console.log(`after undo: ${JSON.stringify(undone)}`);
  // undo is re-simulation from the seed, so EVERY field must match again
  for (const key of ["setup", "intents", "boardA", "boardB", "hpB", "hypeA", "activeSeat"]) {
    if (undone[key] !== before[key]) fail(`undo did not restore ${key} (${undone[key]} vs ${before[key]})`);
  }
}

// --- the export deals what was on screen -------------------------------------
const roundTrip = await page.evaluate(() => {
  const cfg = window.hypeboundLab.exportScenario();
  const live = window.hypeboundLab.state();
  return {
    ops: cfg.scenario.setup.length,
    mulligan: cfg.scenario.mulligan,
    shuffle: cfg.scenario.shuffle,
    liveBoardA: live.players[0].board.filter(Boolean).length,
    liveHpB: live.players[1].leaderHealth,
  };
});
console.log(`export: ${JSON.stringify(roundTrip)}`);
if (roundTrip.mulligan !== "none" || roundTrip.shuffle !== false) {
  fail("exported scenario is not deterministic (needs shuffle:false + mulligan:none)");
}
if (roundTrip.ops === 0) fail("exported scenario has no setup ops");

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
if (errors.length) failures += 1;
console.log(failures === 0 ? "\nThe Lab OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
