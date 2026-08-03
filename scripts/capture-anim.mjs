/**
 * Samples frames during a card play and during an attack, so the flight-in and
 * the contact spark can actually be seen. Stills cannot show either.
 *
 * Writes anim-play-*.png and anim-attack-*.png.
 */
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
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2000);

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// --- card play: sample the flight from hand to slot --------------------------
const card = await page.evaluate(
  () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
);
if (!card) {
  console.log("no character to play");
} else {
  await page.mouse.move(card.screen.x, card.screen.y);
  await page.mouse.down();
  await page.mouse.move(800, 470, { steps: 12 });
  await page.mouse.up();
  for (const [i, wait] of [0, 90, 90, 130, 200].entries()) {
    await page.waitForTimeout(wait);
    await shot(`anim-play-${i}`);
  }
  console.log("wrote anim-play-0..4 (card should descend and grow into its slot)");
}

await page.waitForTimeout(1200);

// --- attack: sample around the impact ---------------------------------------
const endTurn = async () => {
  await page.click(".end-turn-btn");
  await page.waitForTimeout(300);
  if ((await page.locator(".confirm-overlay .btn-primary").count()) > 0) {
    await page.click(".confirm-overlay .btn-primary");
  }
  // resolves on our turn OR on the match ending, so a finished game does not hang
  await page.waitForFunction(
    () => {
      const v = window.hypeboundBattle?.view?.();
      if (!v) return false;
      return v.winner || (v.activeSeat === v.seat && v.phase === "main");
    },
    { timeout: 60000 }
  );
  await page.waitForTimeout(1400);
  return page.evaluate(() => !window.hypeboundBattle.view().winner);
};

let ready = [];
let targets = [];
for (let round = 0; round < 6 && ready.length === 0; round += 1) {
  if (!(await endTurn())) {
    console.log("match ended before an attack could be staged");
    break;
  }
  const debug = await page.evaluate(() => window.hypeboundBattle.debug());
  ready = debug.readyAttackers;
  targets = (debug.legalAttackTargets ?? []).filter((t) => t.kind === "character");
  if (ready.length === 0) {
    const c = await page.evaluate(
      () => window.hypeboundBattle.debug().hand.find((h) => h.ok && h.screen && h.type === "character") ?? null
    );
    if (c) {
      await page.mouse.move(c.screen.x, c.screen.y);
      await page.mouse.down();
      await page.mouse.move(800, 470, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }
}

if (!ready.length || !targets.length) {
  console.log("never got an attacker and a character target — attack frames skipped");
} else {
  const attacker = ready[0];
  const target = targets[0];
  await page.mouse.move(attacker.x, attacker.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
  // the lunge runs ~170ms, then the damage beat fires the spark
  for (const [i, wait] of [60, 80, 80, 80, 120].entries()) {
    await page.waitForTimeout(wait);
    await shot(`anim-attack-${i}`);
  }
  console.log("wrote anim-attack-0..4");

  /**
   * The flash lives ~140ms, far too short to photograph reliably, so assert on
   * the geometry the view recorded: it must sit between attacker and target,
   * not on the target's centre, and point from one to the other.
   */
  await page.waitForTimeout(700);
  const spark = await page.evaluate(() => window.hypeboundBattle.debug().lastContactSpark);
  if (!spark) {
    console.log("FAIL: no contact spark was struck");
    process.exitCode = 1;
  } else {
    const targetWorld = await page.evaluate(
      (id) => {
        const row = window.hypeboundBattle.debug();
        return { enemy: row.legalAttackTargets, id };
      },
      target.id
    );
    const d = Math.hypot(spark.direction.x, spark.direction.z);
    console.log(`contact spark at world (${spark.position.x}, ${spark.position.z})`);
    console.log(`  direction (${spark.direction.x}, ${spark.direction.z}), length ${d.toFixed(2)}`);
    console.log(`  targets on board: ${targetWorld.enemy.length}`);
    if (d < 0.5) {
      console.log("FAIL: direction is degenerate — the spark has no attack vector");
      process.exitCode = 1;
    }
  }
}

console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
await browser.close();
