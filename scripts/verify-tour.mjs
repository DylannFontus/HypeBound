/**
 * The Grand Tour, in a real browser.
 *
 * The unit suite proves the rules against the real card pool. What only a
 * browser can prove is the part the design's sentence actually promises: that
 * **winning a match with a borrowed deck hands you that deck**. Nothing short of
 * playing one to a win exercises the route, the deck handoff, the result screen
 * and the grant together.
 *
 * So this plays a loaner match for real, start to finish. The player's side is
 * driven by the game's own AI, imported from `/src/ai/ai.ts` — the alternative
 * was a greedy policy written here, which would be a second, worse opponent
 * model whose losses would read as tour bugs. Both sides are pure functions of
 * the match, so a fixed seed makes the whole walk deterministic: it wins on the
 * same attempt every run, or it fails every run. A verification that passes or
 * fails by luck teaches you to re-run until green.
 *
 * It also checks the two things the reward must never do — pay for a loss, and
 * pay twice.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "screenshots");
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
const ok = (m) => console.log(`   ok: ${m}`);

const settleOn = async (selector) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
};
const profile = () => page.evaluate(() => JSON.parse(localStorage.getItem("hypebound:profile") ?? "{}").data ?? {});
const cardCount = (p) => Object.values(p.collection ?? {}).reduce((a, b) => a + b, 0);

/**
 * Take the mulligan the AI would take, through the real panel.
 *
 * Clicking Confirm with nothing selected is not "no mulligan" — it is *throwing
 * the mulligan away*, while the opponent takes theirs. The first version of this
 * script did exactly that and then reported the loaner deck losing, which read
 * as a balance finding and was a handicap the harness had applied to itself.
 * The cards are clicked rather than the intent submitted, so the panel's own
 * selection path is exercised.
 */
const mulliganWell = async () => {
  await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
  const replaceIndexes = await page.evaluate(async () => {
    const ai = await import("/src/ai/ai.ts");
    const profiles = await import("/src/ai/profiles.ts");
    const battle = window.hypeboundBattle;
    const decision = ai.chooseIntent(battle.state(), battle.content(), 0, profiles.getAiProfile("expert"));
    if (!decision || decision.intent.type !== "mulligan") return [];
    const hand = battle.view().you.hand.map((card) => card.instanceId);
    return decision.intent.replaceInstanceIds.map((id) => hand.indexOf(id)).filter((index) => index >= 0);
  });
  for (const index of replaceIndexes) await page.locator(".mulligan-card").nth(index).click();
  await page.click(".mulligan-actions .btn-primary");
  return replaceIndexes.length;
};

/**
 * Play one loaner match to its end, with the game's own AI on the player's side.
 * Returns "win" | "loss" | "draw".
 */
const playLoaner = async (factionId, difficulty, seed) => {
  await page.goto(`http://localhost:5173/#battle?tour=${factionId}&difficulty=${difficulty}&seed=${seed}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await mulliganWell();

  for (let step = 0; step < 400; step++) {
    const over = await page.evaluate(() => document.querySelector(".end-overlay") !== null);
    if (over) break;

    const gotTurn = await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
      .then(() => true)
      .catch(() => false);
    if (!gotTurn) break;

    /**
     * "Decided to end the turn" and "had nothing to decide" are different, and
     * conflating them ends the turn twice — the second `endTurn` lands on the
     * turn after and the player skips it. That bug lost every seed while looking
     * exactly like a loaner deck too weak to win.
     */
    const decided = await page.evaluate(async () => {
      const ai = await import("/src/ai/ai.ts");
      const profiles = await import("/src/ai/profiles.ts");
      const battle = window.hypeboundBattle;
      const state = battle.state();
      if (state.winner !== null || state.activeSeat !== 0) return null;
      // the strongest profile on the player's side: this is a harness, not a
      // fairness test, and a loaner deck that cannot beat a Beginner even when
      // played well is a finding rather than a flake
      const decision = ai.chooseIntent(state, battle.content(), 0, profiles.getAiProfile("expert"));
      if (!decision || decision.intent.type === "concede") return null;
      await battle.submit(decision.intent);
      return decision.intent.type;
    });
    if (decided === null) {
      await page.evaluate(() => window.hypeboundBattle.submit({ type: "endTurn", seat: 0 }));
    }
    await page.waitForTimeout(120);
  }

  await page.waitForSelector(".end-overlay", { timeout: 60000 });
  const outcome = await page.evaluate(() => {
    const winner = window.hypeboundBattle.state().winner;
    return winner === 0 ? "win" : winner === 1 ? "loss" : "draw";
  });

  /**
   * Leave through the result screen's own button, because that is where the
   * match is banked: `onExit` is what records the match and pays the unlock.
   *
   * Reading `winner` and navigating away instead looks equivalent and is not —
   * the first version of this script did exactly that, reported "won on attempt
   * 2", and then found the faction still locked. The grant is deliberately on
   * the way out rather than the moment the last point of damage lands, because
   * the result screen is where the player is *told*, and this project's rule is
   * that an invisible grant is worse than none.
   */
  await page.locator(".end-actions .btn-ghost").click();
  await settleOn(".tour-screen");
  return outcome;
};

// --- 0. a new account arrives with one faction and nine to earn --------------
console.log("\n0. Where a new account starts");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("hypebound:profile"));
await page.reload({ waitUntil: "networkidle" });
await settleOn(".starter-screen");
await page.locator(".starter-option").first().click();
await page.locator("#starter-confirm").click();
await settleOn(".lobby-screen");

const started = await profile();
if (started.unlockedFactions?.length !== 1) fail(`a new account starts with ${started.unlockedFactions?.length} factions`);
else ok(`one faction unlocked (${started.starterFaction}), nine to earn`);

// --- 1. the tour is reachable and counts honestly ----------------------------
console.log("\n1. Reaching the tour");
await page.goto("http://localhost:5173/#play", { waitUntil: "networkidle" });
await settleOn(".play-screen");
const modeStatus = await page
  .locator(".mode-card", { hasText: "The Grand Tour" })
  .locator(".mode-status")
  .innerText();
// innerText is what is *rendered*, and the mode status is upper-cased in CSS
if (!/1 of 10 unlocked/i.test(modeStatus)) fail(`the mode card reads "${modeStatus}"`);
else ok(`the mode card counts: "${modeStatus}"`);

await page.locator(".mode-card", { hasText: "The Grand Tour" }).click();
await settleOn(".tour-screen");

const stops = await page.locator(".tour-stop").count();
const locked = await page.locator(".tour-stop.locked").count();
if (stops !== 10) fail(`the tour shows ${stops} stops, expected 10`);
else ok("all ten stops are drawn, including the ones not yet won");
if (locked !== 9) fail(`${locked} stops are locked, expected 9`);
else ok("nine of them are still to win");

/**
 * The published reward has to be on the screen before the first match — and the
 * numbers on it have to be the numbers in `balance.json`. Compared as *numbers*
 * rather than as the string "1,000", because the panel formats with
 * `toLocaleString` and a French-locale browser prints "1 000" with a narrow
 * no-break space. The first version of this check failed for that reason and the
 * screen was right.
 */
const intro = await page.locator(".tour-intro").innerText();
const promised = [...intro.matchAll(/[\d][\d\s,  ]*/g)].map((m) => Number(m[0].replace(/[^\d]/g, "")));
const published = await page.evaluate(() => window.hypeboundTour.progress().reward);
for (const [label, value] of Object.entries(published)) {
  if (!promised.includes(value)) fail(`the tour never promises the published ${label} (${value}): "${intro}"`);
}
for (const word of ["Clout", "Merch Drops", "Legendary"]) {
  if (!intro.includes(word)) fail(`the tour never names ${word}`);
}
ok(`the completion reward is printed up front, from balance.json (${JSON.stringify(published)})`);
await page.screenshot({ path: path.join(OUT, "tour-screen.png") });

/** The deck it lends must be the deck it pays out — not an auto-build. */
const target = await page.evaluate(() => {
  const progress = window.hypeboundTour.progress();
  const next = progress.stops.find((stop) => !stop.unlocked);
  const loaner = window.hypeboundTour.loaner(next.factionId);
  return { factionId: next.factionId, deckName: next.deckName, leaderCardId: next.leaderCardId, loaner };
});
if (target.loaner.leaderCardId !== target.leaderCardId) fail("the loaner uses a different Leader from the deck it pays");
else if (target.loaner.cards.length !== 30) fail(`the loaner holds ${target.loaner.cards.length} cards`);
else ok(`the loaner is ${target.factionId}'s own 30-card list, led by ${target.leaderCardId}`);

// --- 2. a loss unlocks nothing -----------------------------------------------
console.log("\n2. Losing the loaner match");
const beforeLoss = await profile();
await page.goto(`http://localhost:5173/#battle?tour=${target.factionId}&difficulty=beginner&seed=4242`, {
  waitUntil: "networkidle",
});
await mulliganWell();
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 });
await page.evaluate(() => window.hypeboundBattle.submit({ type: "concede", seat: 0 }));
await page.waitForSelector(".end-overlay", { timeout: 40000 });
/**
 * Leave the same way a win does. Skipping this would make the check vacuous:
 * `onExit` is the only thing that can grant, so a test that never triggers it
 * passes whether or not a loss unlocks — the same shape as the eleven puzzles
 * that "passed" by completing before the player touched them.
 */
await page.locator(".end-actions .btn-ghost").click();
await settleOn(".tour-screen");

const afterLoss = await profile();
if (afterLoss.unlockedFactions.length !== beforeLoss.unlockedFactions.length) {
  fail("conceding a loaner match unlocked the faction anyway");
} else if (afterLoss.decks.length !== beforeLoss.decks.length) {
  fail("conceding a loaner match handed over a deck");
} else {
  ok("a conceded loaner match unlocks nothing — the deck stays borrowed");
}

// --- 3. winning one, for real ------------------------------------------------
console.log("\n3. Winning the loaner match");
/**
 * Fixed seeds, tried in order. Both sides are deterministic, so this wins on the
 * same attempt every run — the Doomscroll walk's lesson about typing a fixed run
 * seed rather than taking the random default.
 */
const SEEDS = [101, 202, 303, 404, 505];
let outcome = "loss";
let attempts = 0;
for (const seed of SEEDS) {
  attempts += 1;
  outcome = await playLoaner(target.factionId, "beginner", seed);
  if (outcome === "win") break;
}
if (outcome !== "win") {
  fail(`the loaner deck did not win in ${attempts} attempts — a starter deck that cannot beat a Beginner is a finding`);
} else {
  ok(`won on attempt ${attempts} (seed ${SEEDS[attempts - 1]})`);
}
await page.screenshot({ path: path.join(OUT, "tour-won.png") });

const afterWin = await profile();
const starterSize = target.loaner.cards.length;
if (!afterWin.unlockedFactions.includes(target.factionId)) fail(`${target.factionId} did not unlock on a win`);
else ok(`${target.factionId} is unlocked, permanently`);
if (afterWin.decks.length !== afterLoss.decks.length + 1) fail(`the account has ${afterWin.decks.length} decks`);
else ok(`the deck arrived: "${afterWin.decks.at(-1).name}"`);
if (afterWin.decks.at(-1).cards.join() !== target.loaner.cards.join()) {
  fail("the deck handed over is not the deck that was played");
} else {
  ok("it is card-for-card the deck the match was won with");
}
if (afterWin.activeDeckIndex !== afterLoss.activeDeckIndex) fail("winning silently changed the active deck");
else ok("the active deck was left alone");
const grew = cardCount(afterWin) - cardCount(afterLoss);
if (grew <= 0 || grew > starterSize) fail(`the collection grew by ${grew}`);
else ok(`the collection grew by ${grew} card(s) — the rest were already at the playable cap`);

// --- 4. back on the tour, the count moved ------------------------------------
console.log("\n4. Back on the tour");
await page.goto("http://localhost:5173/#tour", { waitUntil: "networkidle" });
await settleOn(".tour-screen");
const count = await page.locator("#tour-count").innerText();
if (!/2 of 10 unlocked/.test(count)) fail(`the tour reads "${count}" after one win`);
else ok(`the tour counts the win: "${count}"`);
if ((await page.locator(".tour-stop.locked").count()) !== 8) fail("the won stop is still offering its loaner");
else ok("the stop it was won on no longer offers a loaner");

// --- 5. the completion reward ------------------------------------------------
/**
 * The remaining eight unlocks are seeded rather than played. Step 3 already
 * proved a win unlocks a faction for real, and playing eight more matches would
 * add ten minutes to prove the same thing eight more times — what is left to
 * check is the reward panel, which needs the tour finished however it got there.
 */
console.log("\n5. Finishing it");
/**
 * Unlocked through the app's own grant rather than by editing localStorage. Two
 * reasons, and the second one bit first: there is no second definition of what a
 * tour unlock is, and the profile store writes on a debounce and flushes its
 * in-memory copy on `pagehide` — so a hand-edited save is overwritten by the
 * reload it was made for.
 */
await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const content = await import("/src/engine/content.ts");
  const storage = await import("/src/save/storage.ts");
  const index = content.getContent();
  for (const stop of window.hypeboundTour.progress().stops) {
    profile.recordTourWin(index, stop.factionId);
  }
  // writes are debounced by 250ms; flush rather than race the reload
  storage.flushAllStores();
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".tour-screen");

if ((await page.locator(".tour-reward").count()) !== 1) fail("the reward panel never appeared on a finished tour");
else ok("the reward panel appears once every stop is won");

const choices = await page.evaluate(() => window.hypeboundTour.choices());
const openChoices = choices.filter((choice) => !choice.owned);
if (openChoices.length === 0) fail("the Legendary choice had nothing in it");
else ok(`${openChoices.length} Legendary/Legendaries left to choose from (${choices.length} in the game)`);

const claimDisabled = await page.locator("#tour-claim").isDisabled();
if (!claimDisabled) fail("the reward could be claimed before choosing a Legendary");
else ok("claiming is refused until a Legendary is chosen");

const beforeClaim = await profile();
await page.locator(`.tour-prize-option[data-card="${openChoices[0].id}"]`).click();
await page.screenshot({ path: path.join(OUT, "tour-reward.png") });
await page.locator("#tour-claim").click();
await page.waitForTimeout(300);

const afterClaim = await profile();
const paid = {
  clout: afterClaim.clout - beforeClaim.clout,
  drops: afterClaim.pendingDrops - beforeClaim.pendingDrops,
  legendary: (afterClaim.collection[openChoices[0].id] ?? 0) - (beforeClaim.collection[openChoices[0].id] ?? 0),
};
if (paid.clout !== 1000) fail(`the reward paid ${paid.clout} Clout, the panel promised 1,000`);
else ok("paid exactly the 1,000 Clout it printed");
if (paid.drops !== 10) fail(`the reward owed ${paid.drops} Drops, the panel promised 10`);
else ok("owed exactly the 10 Merch Drops it printed");
if (paid.legendary !== 1) fail(`the chosen Legendary arrived ${paid.legendary} time(s)`);
else ok(`the chosen Legendary arrived (${openChoices[0].id})`);

if ((await page.locator(".tour-reward").count()) !== 0) fail("the reward panel is still offering a paid reward");
else ok("the panel closes once it is paid");

/** And it must never pay twice, however the route is re-entered. */
const second = await page.evaluate(() => window.hypeboundTour.claim(null));
const afterSecond = await profile();
if (second !== null || afterSecond.clout !== afterClaim.clout) fail("the completion reward paid a second time");
else ok("a second claim pays nothing");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — The Grand Tour`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
