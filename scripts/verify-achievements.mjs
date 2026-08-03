/**
 * Achievements, in a real browser.
 *
 * The unit suite proves the tally, the four requirement kinds and the claim
 * path. What only a browser can prove is the part §9 is actually about: that a
 * feat you performed shows up on a screen you can find, that claiming it hands
 * over something you can then wear, and that the two rows which are *not*
 * ordinary — the hidden one and the one waiting on a server — say what they are
 * rather than looking like ordinary rows nobody has finished.
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
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
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
 * Bank a forged match through the app's own accumulator, then reload.
 *
 * Seeded through `profileStore` and flushed rather than by writing the key,
 * because a direct write races the store's 250ms debounce — and re-imported by
 * path after the reload, because `import()` inside `page.evaluate` does not
 * reliably reach the app's own module instance after a source edit.
 */
const bank = async (stats, mode = "ai-casual") => {
  await page.evaluate(
    async ([over, matchMode]) => {
      const { profileStore } = await import("/src/save/profile.ts");
      const { creditMatch } = await import("/src/game/achievements/index.ts");
      const { emptyStats } = await import("/src/game/missions/stats.ts");
      const storage = await import("/src/save/storage.ts");
      profileStore.update((draft) => {
        creditMatch(draft.achievements.tally, { ...emptyStats(0), ...over }, matchMode);
      });
      storage.flushAllStores();
    },
    [stats, mode]
  );
  await page.reload({ waitUntil: "networkidle" });
};

/**
 * Read the persisted profile, not a module instance.
 *
 * Vite hands `page.evaluate`'s dynamic import a separate copy of
 * `profile.ts` with its own store, so reads through it never see what the
 * running app just wrote. Flush, then read the save.
 */
const savedProfile = async () =>
  page.evaluate(async () => {
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    return JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data ?? null;
  });

await seedPlayedAccount(page);

// --- 1. a fresh account has done nothing --------------------------------------
console.log("\n1. What a new account has to show for itself");
await page.goto("http://localhost:5173/#achievements", { waitUntil: "networkidle" });
await settleOn(".achievements-screen");

/**
 * The account this script runs against has been *seeded with a collection*, not
 * played — `seedPlayedAccount` hands it every card so the other scripts can
 * reach the deck builder. So the honest expectation is not "nothing is
 * unlocked": it is that the collection achievements are, and that nothing which
 * requires having played a match is. Which is also the end-to-end proof that
 * account facts and match statistics are read from different places.
 */
const start = await page.evaluate(() => ({
  points: window.hypeboundAchievements.points(),
  reachable: window.hypeboundAchievements.reachable(),
  list: window.hypeboundAchievements.list(),
}));
if (start.list.length < 20) fail(`only ${start.list.length} achievements are on the screen; §9.1 lists twenty`);
else ok(`${start.list.length} achievements listed`);
if (start.reachable <= 0) fail("the screen claims no points are reachable at all");
else ok(`the header says how many points exist: ${start.reachable}`);

const unlockedIds = start.list.filter((entry) => entry.unlocked).map((entry) => entry.id);
const combatUnlocked = start.list.filter((entry) => entry.unlocked && entry.category === "combat");
if (combatUnlocked.length > 0) fail(`an in-match feat is unlocked before any match: ${combatUnlocked[0].id}`);
else ok("no in-match feat is unlocked before a match has been played");
if (!unlockedIds.includes("curator")) fail("a full collection did not unlock Curator, so account facts are not read");
else ok(`the seeded collection unlocked what it should: ${unlockedIds.join(", ")}`);

const headerText = await page.locator("#ach-points").innerText();
if (Number(headerText.replace(/[^0-9]/g, "")) !== start.points) {
  fail(`the points header reads "${headerText}" but the board says ${start.points}`);
} else ok(`the points header agrees with the board (${start.points})`);

// --- 2. the two rows that are not ordinary -------------------------------------
console.log("\n2. The hidden one, and the one waiting on a server");
const hidden = start.list.find((entry) => entry.id === "board-not-found");
if (!hidden?.concealed) fail("the hidden achievement is not concealed");
else ok("the Deep Cuts entry is concealed");

await page.evaluate(() => window.hypeboundAchievements.show("hidden"));
await page.waitForTimeout(120);
const hiddenText = await page.locator('.ach-row[data-id="board-not-found"] .ach-name').innerText();
if (hiddenText.trim() !== "???") fail(`the hidden row shows "${hiddenText}" rather than ???`);
else ok("and it draws as ??? with its hint");

const deferred = start.list.find((entry) => entry.id === "front-row-seat");
if (!deferred?.deferred) fail("Front Row Seat is not marked as unearnable");
else ok(`Front Row Seat says why: "${deferred.deferred.slice(0, 48)}…"`);

await page.evaluate(() => window.hypeboundAchievements.show("social"));
await page.waitForTimeout(120);
const deferredNote = await page.locator('.ach-row[data-id="front-row-seat"] .ach-deferred').count();
if (deferredNote === 0) fail("the Community tab shows no reason on the deferred row");
else ok("the Community tab prints the reason rather than a progress bar");

// --- 3. earning one -------------------------------------------------------------
console.log("\n3. Earning, and claiming");
await bank({ won: true, factionId: "neon-idols" });
await page.goto("http://localhost:5173/#achievements", { waitUntil: "networkidle" });
await settleOn(".achievements-screen");

const firstWin = await page.evaluate(() =>
  window.hypeboundAchievements.list().find((entry) => entry.id === "we-did-it-chat")
);
if (!firstWin?.unlocked) fail("winning a match did not unlock the first-win achievement");
else ok("one banked win unlocked We Did It, Chat!");

const cloutBefore = (await savedProfile()).clout;
await page.locator('.ach-claim[data-id="we-did-it-chat"]').click();
await page.waitForTimeout(200);
const cloutAfter = (await savedProfile()).clout;
if (cloutAfter - cloutBefore !== 100) fail(`claiming paid ${cloutAfter - cloutBefore} Clout, §9.1 says 100`);
else ok("claiming paid the 100 Clout §9.1 promises");

const afterClaim = await page.evaluate(() =>
  window.hypeboundAchievements.list().find((entry) => entry.id === "we-did-it-chat")
);
if (!afterClaim.claimed || afterClaim.claimable) fail("the row is still claimable after being claimed");
else ok("and the row will not pay twice");

// --- 4. a title, worn ------------------------------------------------------------
console.log("\n4. A reward you can wear");
await bank({ charactersBanished: 25 });
await page.goto("http://localhost:5173/#achievements", { waitUntil: "networkidle" });
await settleOn(".achievements-screen");
await page.evaluate(() => window.hypeboundAchievements.claim("log-off-speedrun"));
await page.waitForTimeout(150);

const worn = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const { cosmeticById } = await import("/src/game/cosmetics/index.ts");
  const storage = await import("/src/save/storage.ts");
  storage.flushAllStores();
  const saved = JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data;
  const id = saved?.cosmetics?.equipped?.title ?? null;
  return id ? (cosmeticById(getContent(), id)?.name ?? null) : null;
});
if (worn !== "Certified Grass Toucher") fail(`the title slot holds "${worn}", §13 names it Certified Grass Toucher`);
else ok("the title §13 names was granted and put on automatically");

await page.goto("http://localhost:5173/#profile", { waitUntil: "networkidle" });
await settleOn(".profile-screen");
const profileTitle = await page.locator("#profile-title").innerText();
if (!/grass toucher/i.test(profileTitle)) fail(`the profile shows "${profileTitle}"`);
else ok("and the profile is wearing it");

const linkCount = await page.locator("#profile-achievements").count();
if (linkCount === 0) fail("the profile has no way to reach the achievements screen");
else ok("the profile links to Achievements, as §4.2.8 asks");

// --- 5. points, and a milestone ---------------------------------------------------
console.log("\n5. Points and milestones");
await bank({
  won: true,
  factionId: "neon-idols",
  fullFixations: 1,
  flawlessWin: 1,
  burnoutWin: 1,
  shutoutWin: 1,
  widestWinningBoard: 6,
  mostLeaderDamageInATurn: 12,
  reactionsTriggered: 50,
  perfectResonances: 10,
  elementalBonusDamage: 250,
});
await page.goto("http://localhost:5173/#achievements", { waitUntil: "networkidle" });
await settleOn(".achievements-screen");

const points = await page.evaluate(() => window.hypeboundAchievements.points());
if (points < 200) fail(`ten feats banked but the header says ${points} points`);
else ok(`ten feats are worth ${points} achievement points`);

const milestones = await page.evaluate(() => window.hypeboundAchievements.milestones());
if (milestones.length === 0) fail("no point milestones are shown at all");
else ok(`${milestones.length} milestones drawn, the first at ${milestones[0].points} points`);

const claimedMilestone = await page.evaluate(() => {
  const first = window.hypeboundAchievements.milestones()[0];
  return first.claimable ? window.hypeboundAchievements.claimMilestone(first.points) : null;
});
if (claimedMilestone) {
  ok(`the ${milestones[0].points}-point milestone paid ${claimedMilestone.cosmetics.map((c) => c.name).join(", ")}`);
  const frame = (await savedProfile())?.cosmetics?.equipped?.frame ?? null;
  if (!frame?.startsWith("frame:award:")) fail(`the milestone frame was not equipped (slot holds ${frame})`);
  else ok("and the frame it paid is being worn");
} else {
  ok(`the first milestone is still ${milestones[0].points - points} points away, and says so`);
}

// --- 6. the tabs ------------------------------------------------------------------
console.log("\n6. Categories");
const tabCount = await page.locator(".ach-tabs .mastery-tab").count();
if (tabCount !== 7) fail(`${tabCount} category tabs, §9 lists seven`);
else ok("seven category tabs, as §9 lists");

await page.evaluate(() => window.hypeboundAchievements.show("combat"));
await page.waitForTimeout(120);
const combatRows = await page.locator(".ach-list .ach-row").count();
const pct = await page.locator(".ach-category-pct").innerText();
if (combatRows === 0) fail("the Highlight Reel tab is empty");
else ok(`Highlight Reel shows ${combatRows} achievements, ${pct.trim()} complete`);
await page.screenshot({ path: path.join(OUT, "achievements.png") });

// --- 7. the lobby knows -----------------------------------------------------------
console.log("\n7. Finding it from the lobby");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");
const lobbyButton = await page.locator("#lobby-achievements").count();
if (lobbyButton === 0) fail("the lobby has no Achievements button");
else ok("the lobby has an Achievements button");
await page.locator("#lobby-achievements").click();
await settleOn(".achievements-screen");
ok("and it goes there");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Achievements`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
