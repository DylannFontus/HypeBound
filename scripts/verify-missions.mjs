/**
 * Missions, in a real browser.
 *
 * The unit suite proves the rules; what only a browser can prove is that a match
 * you actually played moves a mission you actually hold, and that claiming it
 * pays the number printed on the card.
 *
 * It plays one real match with the game's own AI on the player's side — the same
 * approach `verify-tour.mjs` uses, and for the same reason: mission progress is
 * derived from the *record*, so a match that was never really played would not
 * exercise the thing under test.
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
const ok = (m) => console.log(`   ok: ${m}`);

const settleOn = async (selector) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
};
/**
 * Read the saved profile — flushing first.
 *
 * The store writes on a 250ms debounce, so reading `localStorage` straight after
 * a claim returns the state from *before* it. That looked exactly like a claim
 * paying nothing, twice, while the in-memory state was correct all along. It is
 * the second time this debounce has produced a false failure; the first was
 * `verify-tour.mjs` seeding unlocks.
 */
const profile = () =>
  page.evaluate(async () => {
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    return JSON.parse(localStorage.getItem("hypebound:profile") ?? "{}").data ?? {};
  });

await seedPlayedAccount(page);

// --- 1. reaching missions the way a player does ------------------------------
console.log("\n1. Reaching Missions from the lobby");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");
if ((await page.locator("#lobby-missions").count()) === 0) fail("no Missions button in the lobby");
else ok("the lobby offers Missions");
await page.locator("#lobby-missions").click();
await settleOn(".missions-screen");

const dailies = await page.locator("#missions-daily .mission").count();
const weeklies = await page.locator("#missions-weekly .mission").count();
if (dailies !== 3) fail(`the account holds ${dailies} dailies, expected 3`);
else ok("three dailies, as §7 specifies");
if (weeklies < 1) fail("no weeklies were issued");
else ok(`${weeklies} weeklies issued`);

// --- 2. what the screen promises ---------------------------------------------
console.log("\n2. What the screen says");
const intro = await page.locator(".missions-intro").innerText();
if (!/expire/i.test(intro)) fail("the screen never says that nothing expires (F6)");
else ok("F6 is stated on the screen, not just honoured in code");

const published = await page.evaluate(() => window.hypeboundMissions.published());
const firstReward = await page.locator("#missions-daily .mission .mission-reward").first().innerText();
const printedClout = Number((firstReward.match(/\d+/) ?? [0])[0]);
const expectedDaily = published.dailyClout * published.rookieRoadMultiplier; // seeded account is new
if (printedClout !== expectedDaily) fail(`a daily prints ${printedClout} Clout, balance.json says ${expectedDaily}`);
else ok(`dailies print the published rate (${printedClout} Clout, Rookie Road doubled)`);
await page.screenshot({ path: path.join(OUT, "missions.png") });

// --- 3. a real match moves a real mission ------------------------------------
console.log("\n3. Playing a match");
const before = await page.evaluate(() =>
  window.hypeboundMissions.views().map((v) => v.parts.reduce((sum, p) => sum + p.have, 0))
);

await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=606", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
for (let step = 0; step < 400; step++) {
  if (await page.evaluate(() => document.querySelector(".end-overlay") !== null)) break;
  const gotTurn = await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  if (!gotTurn) break;
  const decided = await page.evaluate(async () => {
    const ai = await import("/src/ai/ai.ts");
    const profiles = await import("/src/ai/profiles.ts");
    const battle = window.hypeboundBattle;
    const state = battle.state();
    if (state.winner !== null || state.activeSeat !== 0) return null;
    const decision = ai.chooseIntent(state, battle.content(), 0, profiles.getAiProfile("expert"));
    if (!decision || decision.intent.type === "concede") return null;
    await battle.submit(decision.intent);
    return decision.intent.type;
  });
  if (decided === null) await page.evaluate(() => window.hypeboundBattle.submit({ type: "endTurn", seat: 0 }));
  await page.waitForTimeout(100);
}
await page.waitForSelector(".end-overlay", { timeout: 60000 });
// leave through the result screen — that is where the match is banked
await page.locator(".end-actions .btn-ghost").click();
await settleOn(".lobby-screen");

const afterMatch = await profile();
if ((afterMatch.missions?.outcomes ?? []).length !== 1) {
  fail(`the match left ${(afterMatch.missions?.outcomes ?? []).length} entries in the evidence log, expected 1`);
} else {
  ok("the match was recorded as mission evidence");
}

await page.goto("http://localhost:5173/#missions", { waitUntil: "networkidle" });
await settleOn(".missions-screen");
const after = await page.evaluate(() =>
  window.hypeboundMissions.views().map((v) => v.parts.reduce((sum, p) => sum + p.have, 0))
);
const moved = after.filter((total, index) => total > (before[index] ?? 0)).length;
if (moved === 0) fail("a full match moved no mission at all");
else ok(`${moved} of ${after.length} held missions advanced from one match`);

// --- 4. claiming pays what it printed ----------------------------------------
console.log("\n4. Claiming");
/**
 * A single match rarely finishes a mission outright, so one is completed through
 * the app's own state rather than by playing until something lands. The claim
 * path itself — the completion re-check, the payment, the removal — is exercised
 * for real; only the evidence is arranged.
 */
await page.evaluate(async () => {
  const { profileStore, getProfile } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();

  /**
   * Stamp the forged matches **after every held mission was issued**.
   *
   * A mission only scores matches from its own `issuedAt` onward, and a mission
   * issued for the first time takes `issuedAt: now`. Using `Date.now()` here
   * therefore made the whole fixture invisible on any run where the rotation was
   * (re-)issued after the navigation — which is how this step failed
   * intermittently while reporting "no mission completed even against a maximal
   * match". Anchoring to the latest `issuedAt` removes the race entirely.
   */
  const rotation = getProfile().missions.rotation;
  const issued = [...rotation.daily, ...rotation.weekly].map((mission) => mission.issuedAt);
  const playedAt = Math.max(Date.now(), ...issued) + 1;

  const factions = Object.keys(content.factions).filter((id) => id !== "neutral");
  const currents = Object.keys(content.currents);
  const modes = ["ai-casual", "story-1", "doomscroll-normal", "boss-bronze"];
  const stats = {
    seat: 0, won: true, leaderCardId: "x", secondaryCurrent: null,
    cardsPlayed: 99, cardsDrawn: 99, charactersDefeated: 99, damageToEnemyLeader: 99,
    healingToFriendlies: 99, supportsGiven: 99, confluencesActivated: 99, perfectResonances: 99,
    obsessionGained: 99, fixationsUsed: 99, ultimatesUsed: 99, elementalBonusHits: 99,
    afterpartyTriggers: 99, equipmentPlayed: 99, expensiveCardsPlayed: 99, cancelledApplied: 99,
    negativeStatusesCleared: 99, mostOfOneCurrent: 99,
  };

  /**
   * Every faction against every Current. The three dailies an account holds are
   * drawn from a clock-seeded RNG, so a fixture tuned to a few of them completes
   * or does not depending on the minute the script runs.
   */
  const forged = [];
  factions.forEach((factionId, index) => {
    currents.forEach((primaryCurrent, step) => {
      forged.push({
        mode: modes[(index + step) % modes.length],
        playedAt,
        deckEditedThisPeriod: true,
        masteryAtPlay: { faction: 1, leader: 1 },
        stats: { ...stats, factionId, primaryCurrent },
      });
    });
  });
  profileStore.update((draft) => {
    draft.missions.outcomes.push(...forged);
  });
  const storage = await import("/src/save/storage.ts");
  storage.flushAllStores();
});

/**
 * Reload before reading the result, and this one is not optional.
 *
 * `import("/src/save/profile.ts")` inside `page.evaluate` does **not** reliably
 * reach the module the running app is using. After any source edit Vite serves
 * that module under an HMR-stamped URL, and a bare specifier then instantiates a
 * *second* copy — with its own `profileStore` cache. Both write to the same
 * `localStorage` key, so nothing looks broken; the screen simply keeps scoring
 * against the state it already had. That is what produced "no mission completed
 * even against a maximal match" while the profile plainly held 81 outcomes.
 *
 * `localStorage` is the shared truth between the two instances, so flushing and
 * reloading collapses them back into one.
 */
await page.reload({ waitUntil: "networkidle" });
await settleOn(".missions-screen");
await page.evaluate(() => window.hypeboundMissions.refresh());
await page.waitForTimeout(200);

const claimable = await page.evaluate(() => window.hypeboundMissions.views().filter((v) => v.complete));
if (claimable.length === 0) fail("no mission completed even against a maximal match");
else ok(`${claimable.length} mission(s) now claimable`);

const walletBefore = (await profile()).clout;
const target = claimable[0];
const paid = await page.evaluate(
  ([cadence, id]) => window.hypeboundMissions.claim(cadence, id),
  [target.cadence, target.id]
);
const walletAfter = (await profile()).clout;

if (!paid) fail("claiming a completed mission returned nothing");
else if (walletAfter - walletBefore !== paid.clout) {
  fail(`the claim paid ${walletAfter - walletBefore} Clout, the card said ${paid.clout}`);
} else {
  ok(`claiming paid exactly what the card printed (${paid.clout} Clout, ${paid.xp} XP)`);
}

const stillThere = await page.evaluate(
  ([cadence, id]) => window.hypeboundMissions.views().some((v) => v.cadence === cadence && v.id === id),
  [target.cadence, target.id]
);
if (stillThere) fail("a claimed mission is still on the screen");
else ok("the claimed mission left the list");

const again = await page.evaluate(
  ([cadence, id]) => window.hypeboundMissions.claim(cadence, id),
  [target.cadence, target.id]
);
if (again !== null) fail("a mission paid twice");
else ok("a second claim pays nothing");
await page.screenshot({ path: path.join(OUT, "missions-claimed.png") });

// --- 5. the Weekly Restock ---------------------------------------------------
console.log("\n5. Weekly Restock");
const dropsBefore = (await profile()).pendingDrops ?? 0;
const granted = await page.evaluate(() => window.hypeboundMissions.restock());
const dropsAfter = (await profile()).pendingDrops ?? 0;
if (granted !== published.weeklyRestockDrops) fail(`the Restock gave ${granted}, balance says ${published.weeklyRestockDrops}`);
else ok(`the Weekly Restock gave its published ${granted} Drops`);
if (dropsAfter - dropsBefore !== granted) fail(`the wallet moved by ${dropsAfter - dropsBefore}`);
else ok("and they are owed on the account");
if ((await page.evaluate(() => window.hypeboundMissions.restock())) !== 0) fail("the Restock paid twice in one week");
else ok("a second Restock in the same week pays nothing");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Missions`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
