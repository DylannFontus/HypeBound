/**
 * Mastery, in a real browser.
 *
 * The unit suite proves the curve and the claim rules. What only a browser can
 * prove is that a match you actually played moves the track on the screen, that
 * the number the screen prints is the number the claim pays, and — the part this
 * feature is most likely to get wrong — that a rank whose whole reward is a
 * cosmetic the game cannot deliver does **not** offer a button that takes the
 * rank away and hands over nothing.
 *
 * It plays one real match with the game's own AI on the player's side, the same
 * approach `verify-tour.mjs` and `verify-missions.mjs` use, because mastery is
 * credited by `recordMatch` and a match that was never played would not exercise
 * the thing under test.
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
/** Read the saved profile, flushing the 250ms write debounce first. */
const profile = () =>
  page.evaluate(async () => {
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    return JSON.parse(localStorage.getItem("hypebound:profile") ?? "{}").data ?? {};
  });

await seedPlayedAccount(page);

// --- 1. reaching mastery the way a player does -------------------------------
console.log("\n1. Reaching Mastery from the lobby");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");
if ((await page.locator("#lobby-mastery").count()) === 0) fail("no Mastery button in the lobby");
else ok("the lobby offers Mastery");
await page.locator("#lobby-mastery").click();
await settleOn(".mastery-screen");

const factionCards = await page.locator("#mastery-factions .mastery-track").count();
if (factionCards !== 10) fail(`${factionCards} faction tracks, expected 10`);
else ok("ten faction tracks, one per faction");

// --- 2. a fresh account is owed nothing --------------------------------------
console.log("\n2. What an unplayed account is owed");
const seededBadges = await page.locator("#mastery-factions .mastery-badge").count();
if (seededBadges !== 0) fail(`${seededBadges} tracks already offer a reward before any match was played`);
else ok("no track pays out before a single match — rank 1 costs one match, not zero");

// --- 3. a real match moves a real track --------------------------------------
console.log("\n3. Playing a match");
const before = await page.evaluate(() => {
  const factions = window.hypeboundMastery.factions();
  return { neon: factions.find((v) => v.id === "neon-idols")?.xp ?? 0 };
});

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

const saved = await profile();
const played = saved.mastery ?? {};
const leaderId = Object.keys(played.leader ?? {})[0];
if (!leaderId) fail("the match credited no leader track at all");
else ok(`the leader track for ${leaderId} was credited`);
if ((played.faction?.["neon-idols"] ?? 0) <= before.neon) fail("the faction track did not move");
else ok(`the faction track gained ${played.faction["neon-idols"] - before.neon} XP`);
if (played.faction?.["neon-idols"] !== played.leader?.[leaderId]) {
  fail("the faction and the leader were paid different XP for the same match");
} else {
  ok("the faction and the leader were paid the same match XP, as §4 requires");
}
if (Object.keys(played.affinity ?? {}).length === 0) fail("no character earned Affinity");
else ok(`${Object.keys(played.affinity).length} characters earned Affinity from one match`);

// --- 4. the screen offers what was earned ------------------------------------
console.log("\n4. Claiming rank 1");
await page.goto("http://localhost:5173/#mastery", { waitUntil: "networkidle" });
await settleOn(".mastery-screen");
const badges = await page.locator("#mastery-factions .mastery-badge").count();
if (badges === 0) fail("the match earned a rank but no track shows a reward waiting");
else ok(`${badges} track(s) now show a reward waiting`);

await page.locator('#mastery-factions .mastery-track[data-id="neon-idols"]').click();
await page.waitForSelector(".mastery-detail", { timeout: 20000 });
const rank1 = page.locator('.mastery-row[data-rank="1"]');
const printed = await rank1.locator(".mastery-reward").allInnerTexts();
const printedClout = Number((printed.join(" ").match(/(\d+)\s*Clout/) ?? [0, 0])[1]);
if (printedClout <= 0) fail(`rank 1 prints no Clout: ${printed.join(" | ")}`);
else ok(`rank 1 prints ${printedClout} Clout`);

const walletBefore = (await profile()).clout;
await rank1.locator(".mastery-claim").click();
await page.waitForTimeout(200);
const walletAfter = (await profile()).clout;
if (walletAfter - walletBefore !== printedClout) {
  fail(`claiming paid ${walletAfter - walletBefore}, the screen printed ${printedClout}`);
} else {
  ok("claiming paid exactly what the screen printed");
}
if ((await page.locator('.mastery-row[data-rank="1"] .mastery-claim').count()) !== 0) {
  fail("a claimed rank still offers a Claim button");
} else {
  ok("the claimed rank reads as claimed");
}
await page.screenshot({ path: path.join(OUT, "mastery.png") });

// --- 5. a rank that cannot pay does not offer a button -----------------------
console.log("\n5. The rank that cannot pay");
await page.evaluate(() => {
  window.hypeboundMastery.refresh();
});
/**
 * Leader Mastery level 5 — an alternate static portrait, and nothing else.
 *
 * This used to be faction rank 12, a deferred emote. Emotes ship now, and every
 * rank on the faction track pays something real; the genuinely unpayable rows
 * moved to the leader track, where portraits and intro animations still have no
 * surface to appear on.
 *
 * The flush-and-reload is load-bearing. `import("/src/save/profile.ts")` inside
 * `page.evaluate` does not reliably reach the module the running app is using:
 * after any source edit Vite serves it under an HMR-stamped URL, and a bare
 * specifier instantiates a **second copy with its own store cache**. Both write
 * the same `localStorage` key, so nothing appears broken — the screen simply
 * keeps rendering the state it already had. `verify-missions` lost an entire
 * step to this. `localStorage` is the shared truth, so reloading collapses the
 * two instances back into one.
 */
const deferredLeaderId = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { leaderMasteryConfig } = await import("/src/game/progression/data.ts");
  const { xpForRank } = await import("/src/game/progression/mastery.ts");
  const { getContent, selectableLeaders } = await import("/src/engine/content.ts");
  const storage = await import("/src/save/storage.ts");
  const id = selectableLeaders(getContent())[0].id;
  const { factionMasteryConfig } = await import("/src/game/progression/data.ts");
  profileStore.update((draft) => {
    draft.mastery.leader[id] = xpForRank(leaderMasteryConfig(), 5);
    // the faction track is raised here too, because the steps after this one
    // claim ranks 2, 3 and 12 — and one match only reaches rank 1
    draft.mastery.faction["neon-idols"] = xpForRank(factionMasteryConfig(), 20);
  });
  storage.flushAllStores();
  return id;
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".mastery-screen");
await page.evaluate((id) => window.hypeboundMastery.open("leader", id), deferredLeaderId);
await page.waitForTimeout(200);
const level5 = page.locator('.mastery-row[data-rank="5"]');
if ((await level5.count()) === 0) fail("level 5 is not on the leader ladder");
else if ((await level5.locator(".mastery-claim").count()) !== 0) {
  fail("a rank whose whole payout is a deferred cosmetic still offers a Claim");
} else {
  const note = await level5.locator(".mastery-row-action").innerText();
  if (!/waiting/i.test(note)) fail(`level 5 says "${note}" rather than what it is waiting for`);
  else ok("the deferred rank says what it is waiting for instead of offering a button");
}
const deferredStyled = await level5.locator(".mastery-reward.deferred").count();
if (deferredStyled === 0) fail("the deferred reward is not marked as deferred on screen");
else ok("the deferred reward is visibly pending, not presented as paid");

// and the rank that used to sit here now pays for real
const emoteGrant = await page.evaluate(() => window.hypeboundMastery.claim("faction", "neon-idols", 12));
if (!emoteGrant || emoteGrant.cosmetics.length === 0) fail("faction rank 12 no longer pays its emote");
else ok(`rank 12 now pays a real cosmetic — ${emoteGrant.cosmetics[0].name}`);

// --- 6. the pick, and the Faction Pack ---------------------------------------
console.log("\n6. Picks and Faction Packs");
const offered = await page.evaluate(() => window.hypeboundMastery.picks("faction", "neon-idols", 3));
if (offered.length !== 3) fail(`rank 3 offers ${offered.length} cards, expected 3`);
else ok("rank 3 offers three cards to choose from");

const refused = await page.evaluate(() => window.hypeboundMastery.claim("faction", "neon-idols", 3));
if (refused !== null) fail("a pick was claimable without choosing anything");
else ok("a pick refuses to pay until a choice is made");

const picked = await page.evaluate(
  ([cardId]) => window.hypeboundMastery.claim("faction", "neon-idols", 3, cardId),
  [offered[0]]
);
if (!picked) fail("choosing an offered card still paid nothing");
else ok(`the pick granted ${offered[0]}`);

const pack = await page.evaluate(() => window.hypeboundMastery.claim("faction", "neon-idols", 2));
const packCards = pack?.pack?.cards ?? [];
if (packCards.length === 0) fail("the Faction Pack opened empty");
else {
  const foreign = await page.evaluate(async (ids) => {
    const { getContent } = await import("/src/engine/content.ts");
    const content = getContent();
    return ids.filter((id) => content.cards[id]?.faction !== "neon-idols");
  }, packCards.map((card) => card.cardId));
  if (foreign.length > 0) fail(`the Faction Pack contained cards from elsewhere: ${foreign.join(", ")}`);
  else ok(`the Faction Pack held ${packCards.length} cards, all Neon Idols`);
}

// --- 7. the lore is readable, not merely announced ---------------------------
console.log("\n7. Lore");
await page.evaluate(() => window.hypeboundMastery.open("faction", "neon-idols"));
await page.waitForTimeout(200);
const readButtons = await page.locator(".mastery-read").count();
if (readButtons === 0) fail("no unlocked lore page can be opened");
else {
  await page.locator(".mastery-read").first().click();
  await page.waitForTimeout(150);
  const text = await page.locator(".mastery-lore").first().innerText();
  if (text.length < 120) fail(`the lore page opened with almost nothing in it: "${text}"`);
  else ok(`a lore page opens and reads (${text.length} characters)`);
}
await page.screenshot({ path: path.join(OUT, "mastery-lore.png") });

// --- 8. the Bias Board -------------------------------------------------------
console.log("\n8. The Bias Board");
await page.evaluate(() => window.hypeboundMastery.refresh());
await page.locator('.mastery-tab[data-tab="bias"]').click();
await page.waitForTimeout(200);
const biasRows = await page.locator("#mastery-bias .mastery-track").count();
if (biasRows === 0) fail("the Bias Board is empty after a played match");
else ok(`the Bias Board lists ${biasRows} characters`);

const topAp = await page.evaluate(() => {
  const board = window.hypeboundMastery.bias();
  return board.length > 0 ? board[0].ap : 0;
});
const cap = await page.evaluate(() => window.hypeboundMastery.published().affinity.perMatchCap);
if (topAp <= 0) fail("no character has any Affinity");
else if (topAp > cap) fail(`a character earned ${topAp} AP from one match, over the published cap of ${cap}`);
else ok(`the most-loved character has ${topAp} AP, within the published cap of ${cap}`);

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Mastery`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
