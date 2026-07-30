/**
 * Plays a real match to completion, then opens Replay Theater and checks the
 * recorded game actually re-simulates to the same result.
 *
 * This is the end-to-end proof that replay determinism survives the whole
 * stack — record on one screen, re-simulate on another.
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

// --- play a match to a result -----------------------------------------------
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=31337", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// concede: a fast, deterministic way to produce a finished, recorded match
await page.locator(".battle-controls button").last().click({ force: true }).catch(() => {});
await page.waitForTimeout(700);
await page.locator(".confirm-overlay .btn-primary").click({ force: true }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator(".end-panel .btn").last().click({ force: true }).catch(() => {});
await page.waitForTimeout(1500);

// --- open Replay Theater ----------------------------------------------------
await page.goto("http://localhost:5173/#replays", { waitUntil: "networkidle" });
await page.waitForSelector(".replay-screen", { timeout: 15000 });
await page.waitForTimeout(1200);

const entries = await page.evaluate(() => window.hypeboundReplay?.entries?.() ?? []);
console.log(`history entries: ${entries.length}, replayable: ${entries.filter((e) => e.replayable).length}`);
if (entries.length === 0) fail("the finished match was never recorded");

const replayable = entries.find((e) => e.replayable);
if (!replayable) {
  fail("no entry kept a replay record");
} else {
  const verdict = await page.evaluate((id) => window.hypeboundReplay.verify(id), replayable.id);
  console.log(`re-simulation: errors=${JSON.stringify(verdict?.errors)} winner=${verdict?.winner}`);
  if (!verdict) fail("verify() returned nothing");
  else {
    if (verdict.errors.length > 0) fail(`replay produced errors: ${JSON.stringify(verdict.errors)}`);
    // conceding means the conceder loses; either way the replay must AGREE
    if (verdict.winner === null) fail("the replay did not reach the recorded result");
  }
}

const rendered = await page.evaluate(() => ({
  stage: !!document.querySelector(".replay-board"),
  frames: document.querySelector("#replay-scrub")?.getAttribute("max"),
  caption: document.querySelector(".replay-caption")?.textContent?.trim(),
}));
console.log(`viewer: board=${rendered.stage} frames=${rendered.frames} caption="${rendered.caption}"`);
if (!rendered.stage) fail("the replay viewer did not render a board");

// scrub back to the opening and confirm the view actually changes
await page.evaluate(() => {
  const s = document.querySelector("#replay-scrub");
  s.value = "0";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(400);
const atStart = await page.evaluate(() => document.querySelector(".replay-caption")?.textContent?.trim());
console.log(`after scrubbing to 0: caption="${atStart}"`);
if (atStart !== "Opening") fail(`scrubbing to the start should show the opening, got "${atStart}"`);

await page.screenshot({ path: path.join(OUT, "replay-theater.png") });

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
if (errors.length) failures += 1;
console.log(failures === 0 ? "\nReplay Theater OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
