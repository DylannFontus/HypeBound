/**
 * Sanity-plays every scripted tutorial stage.
 *
 * A stage can parse perfectly and still be unfinishable — the wrong card in
 * hand, a leader on too much health, a gate that permits nothing useful. This
 * loads each stage, follows its beats using only what the gate allows, and
 * reports whether the objective can actually be reached.
 *
 * Stage 7 is a real match against the AI and is only smoke-checked (it loads
 * and reaches a playable state); its outcome is not scripted.
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

let failures = 0;
const fail = (msg) => {
  console.log(`   FAIL: ${msg}`);
  failures += 1;
};

/** Click through any coach line that is waiting for acknowledgement. */
async function ack(page) {
  for (let i = 0; i < 8; i++) {
    // Clicked in-page rather than through Playwright's actionability checks:
    // the panel animates in, and a visibility race would silently skip the
    // acknowledgement, leaving a dialogue beat waiting for input forever.
    const clicked = await page
      .evaluate(() => {
        const button = document.querySelector(".coach-ack");
        if (!button || button.hidden) return false;
        button.click();
        return true;
      })
      .catch(() => false);
    if (!clicked) return;
    await page.waitForTimeout(500);
  }
}

/**
 * Do whatever the current beat permits, once. Returns what it did.
 *
 * Beat-aware on purpose: the gate refuses anything the lesson has not reached,
 * so choosing by legality alone just repeats a refused move until the step
 * budget runs out. This asks the runner what is allowed and obeys it — which is
 * also what a player following the coach would do.
 */
async function actOnce(page) {
  const snapshot = await page.evaluate(() => {
    const d = window.hypeboundBattle.debug();
    const v = window.hypeboundBattle.view();
    const s = window.hypeboundBattle.stage?.() ?? null;
    return {
      hand: d.hand.filter((h) => h.ok && h.screen),
      ready: d.readyAttackers ?? [],
      targets: d.legalAttackTargets ?? [],
      board: v.you.board.filter(Boolean).length,
      turn: v.turn,
      ended: v.winner !== null,
      allow: s?.allow ?? null,
      beat: s?.beat ?? null,
    };
  });
  if (snapshot.ended) return "ended";

  // `null` allow means the beat permits anything legal
  const permits = (intent, target) => {
    if (!snapshot.allow) return true;
    return snapshot.allow.some((m) => {
      if (m.intent === "any") return true;
      if (m.intent !== intent) return false;
      if (intent === "attack" && m.target && m.target !== "any") return m.target === target;
      return true;
    });
  };

  // 1. attack a character if anything can
  const character = snapshot.targets.find((t) => t.kind === "character");
  if (permits("attack", "character") && snapshot.ready.length > 0 && character) {
    const a = snapshot.ready[0];
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(character.x, character.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1100);
    return "attacked-character";
  }
  // 2. otherwise attack the leader
  const leader = snapshot.targets.find((t) => t.kind === "leader");
  if (permits("attack", "leader") && snapshot.ready.length > 0 && leader) {
    const a = snapshot.ready[0];
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(leader.x, leader.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1100);
    return "attacked-leader";
  }
  // 3. play a card
  if (permits("playCard") && snapshot.hand.length > 0) {
    const card = snapshot.hand[0];
    await page.mouse.move(card.screen.x, card.screen.y);
    await page.mouse.down();
    await page.mouse.move(800, 470, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1100);
    return "played";
  }
  // 4. fire a confluence if one is lit
  if (permits("activateConfluence") && (await page.locator(".confluence-btn").count()) > 0) {
    await page.locator(".confluence-btn").first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    // a confluence may open a chooser
    await page.locator(".chooser-list .btn, .chooser-list button").first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    return "confluence";
  }
  // 5. use a leader ability
  if (permits("useFixation") && (await page.locator(".ability-bar button:not([disabled])").count()) > 0) {
    // last = the Ultimate, which is the one the Obsession stage asks for
    await page.locator(".ability-bar button:not([disabled])").last().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.locator(".chooser-list button").first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    return "ability";
  }
  // 6. fall back to ending the turn
  if (permits("endTurn")) {
    await page.locator(".end-turn-btn").click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    return "ended-turn";
  }
  // nothing the beat permits is currently possible — report it rather than
  // silently spinning, because that is exactly what an unfinishable stage looks like
  return `blocked(${snapshot.beat ?? "?"})`;
}

for (const stageNumber of [1, 2, 3, 4, 5, 6, 7]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await seedPlayedAccount(page);
  await page.goto(`http://localhost:5173/#tutorial?stage=${stageNumber}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForTimeout(2200);

  const title = await page.evaluate(() => window.hypeboundBattle?.view() !== undefined);
  if (!title) {
    console.log(`stage ${stageNumber}: FAILED TO LOAD`);
    failures += 1;
    await page.close();
    continue;
  }

  // stage 7 opens on a real mulligan
  if ((await page.locator(".mulligan-panel").count()) > 0) {
    await page.click(".mulligan-actions .btn-primary").catch(() => {});
    await page.waitForTimeout(1800);
  }

  await ack(page);
  const stageId = await page.evaluate(() => window.hypeboundBattle?.stage?.()?.stageId ?? null);

  const trace = [];
  let complete = false;
  let blockedRuns = 0;
  for (let step = 0; step < 22 && !complete; step++) {
    await ack(page);
    const did = await actOnce(page);
    trace.push(did);
    // three consecutive blocked steps means the lesson cannot proceed; keep
    // going a little in case an animation was mid-flight, then stop
    blockedRuns = did.startsWith("blocked") ? blockedRuns + 1 : 0;
    if (blockedRuns >= 3) break;
    /**
     * Completing a stage navigates to the NEXT one, which mounts another
     * battle screen — so "the screen went away" never fires. Watch the runner's
     * own flag and the stage id instead.
     */
    complete = await page
      .evaluate((expected) => {
        const s = window.hypeboundBattle?.stage?.() ?? null;
        const v = window.hypeboundBattle?.view?.();
        if (s?.finished) return true;
        if (s && s.stageId !== expected) return true;
        return v ? v.winner !== null : true;
      }, stageId)
      .catch(() => true);
    if (did === "ended") break;
  }

  const state = await page
    .evaluate(() => {
      const v = window.hypeboundBattle.view();
      return { turn: v.turn, winner: v.winner, board: v.you.board.filter(Boolean).length, enemyHp: v.opponent.leaderHealth };
    })
    .catch(() => null);

  const scripted = stageNumber <= 6;
  const label = scripted ? (complete ? "COMPLETED" : "STUCK") : complete ? "resolved" : "playable";
  console.log(`stage ${stageNumber}: ${label}  ${JSON.stringify(state)}  trace=${trace.join(",")}`);
  if (scripted && !complete) fail(`stage ${stageNumber} could not be completed by following its own beats`);
  if (errors.length) fail(`stage ${stageNumber} console errors: ${errors.slice(0, 2).join(" | ")}`);

  await page.screenshot({ path: path.join(OUT, `tutorial-stage-${stageNumber}.png`) });
  await page.close();
}

console.log(failures === 0 ? "\nAll stages OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
