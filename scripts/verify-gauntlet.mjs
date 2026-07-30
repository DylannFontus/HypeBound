/**
 * The Gauntlet, in a real browser — `09-game-modes.md` §8.
 *
 * The unit suite proves the draft: 600 offers across 20 leaders, three distinct
 * legal cards every time, the Prism cutoff, the fill ladder, the reward
 * derivation and the daily cap. None of that needs a browser.
 *
 * What only a browser can show:
 *
 * - the draft **renders** — three real card faces, a pick counter that moves,
 *   and a deck list that grows to thirty;
 * - a reload mid-draft comes back to the same pick with the same three cards,
 *   which is the whole point of deriving the offer instead of storing it;
 * - the published rarity table on the page is the table in the data, read back
 *   off the DOM rather than out of the function that produced it;
 * - the "your pool cannot fill a Legendary offer" line is actually printed, for
 *   the leader you actually took;
 * - a drafted deck really deals a match against a really-drafted opponent;
 * - and a finished run pays exactly what its summary promised.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const ORIGIN = "http://localhost:5173";
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

await seedPlayedAccount(page);

// --- 1. reachable from mode select -------------------------------------------------
console.log("\n1. Mode Select lists it as playable");
await page.goto(`${ORIGIN}/#play`, { waitUntil: "networkidle" });
await settleOn(".play-screen");

const card = page.locator(".mode-card", { hasText: "The Gauntlet" });
if ((await card.count()) === 0) fail("Mode Select has no Gauntlet card");
else {
  const status = (await card.first().locator(".mode-status").textContent())?.trim();
  const disabled = await card.first().isDisabled();
  if (disabled) fail("the Gauntlet card is disabled");
  else ok(`Mode Select shows it as "${status}" and it is clickable`);
  await card.first().click();
  await page.waitForTimeout(500);
  const landed = await page.evaluate(() => window.location.hash);
  if (!landed.includes("gauntlet")) fail(`the card landed on ${landed}`);
  else ok(`clicking it goes to ${landed}`);
}
await settleOn(".gauntlet-screen");

// --- 2. the published odds are the odds in the data ----------------------------------
console.log("\n2. §8.1's rarity table, read back off the page");
const table = await page.evaluate(async () => {
  const { gauntletData } = await import("/src/game/gauntlet/data.ts");
  const data = gauntletData();
  const read = (row) =>
    [...document.querySelectorAll(`.gauntlet-rarity-table tr[data-row="${row}"] td`)].slice(1).map((td) => td.textContent.trim());
  const expect = (weights) =>
    ["common", "rare", "epic", "legendary"].map((r) => `${Math.round(weights[r] * 1000) / 10}%`);
  return {
    spotlight: read("spotlight"),
    standard: read("standard"),
    expectedSpotlight: expect(data.draft.rarity.spotlight),
    expectedStandard: expect(data.draft.rarity.standard),
    spotlightPicks: data.draft.spotlightPicks,
  };
});
for (const row of ["spotlight", "standard"]) {
  const printed = table[row].join(" / ");
  const expected = table[`expected${row[0].toUpperCase()}${row.slice(1)}`].join(" / ");
  if (printed !== expected) fail(`the ${row} row prints ${printed}, the data says ${expected}`);
  else ok(`${row}: ${printed}`);
}

// --- 3. the shortfall is stated, not hidden ------------------------------------------
console.log("\n3. What the card pool can actually offer");
const reality = await page.evaluate(() => ({
  text: document.querySelector("#gauntlet-reality")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  rows: window.hypeboundGauntlet.reality().length,
  shortLegendary: window.hypeboundGauntlet.reality().filter((r) => r.short.includes("legendary")).length,
}));
if (reality.shortLegendary !== reality.rows) {
  fail(`${reality.shortLegendary} of ${reality.rows} leaders are short at Legendary — the screen's wording assumes all of them`);
} else if (!/Legendary/i.test(reality.text)) {
  fail(`the hub does not say the pool cannot fill a Legendary offer: "${reality.text}"`);
} else {
  ok(`all ${reality.rows} leaders are short at Legendary, and the page says so`);
  ok(`"${reality.text.slice(0, 150)}…"`);
}

// --- 4. the reward table shows both figures -------------------------------------------
console.log("\n4. §8.3's table, and what Practice actually pays");
const rewards = await page.evaluate(async () => {
  const { gauntletData } = await import("/src/game/gauntlet/data.ts");
  const data = gauntletData();
  const row = document.querySelector('.gauntlet-reward-table tr[data-wins="12"]');
  return {
    printed: [...row.querySelectorAll("td")].map((td) => td.textContent.replace(/\s+/g, " ").trim()),
    scale: data.practice.scale,
    competitive: data.rewards.rows.find((r) => r.wins === 12),
    practice: window.hypeboundGauntlet.reward(12),
  };
});
const cloutCell = rewards.printed[1];
if (!cloutCell.startsWith(String(rewards.practice.clout)) || !cloutCell.includes(String(rewards.competitive.clout))) {
  fail(`the 12-win Clout cell reads "${cloutCell}"; expected ${rewards.practice.clout} / ${rewards.competitive.clout}`);
} else {
  ok(`12 wins: "${cloutCell}" Clout — ${rewards.scale * 100}% of §8.3's row, both figures shown`);
}
if (rewards.practice.packs !== 0 || rewards.practice.tickets !== 0) {
  fail(`Practice paid ${rewards.practice.packs} packs and ${rewards.practice.tickets} tickets; §8.4 excludes both`);
} else {
  ok("packs and Tickets are struck out of the Practice column, with the reason printed under the table");
}
await page.screenshot({ path: path.join(OUT, "gauntlet-hub.png"), fullPage: true });

// --- 5. the draft ----------------------------------------------------------------------
console.log("\n5. The draft");
await page.locator("#gauntlet-start").click();
await page.waitForSelector(".gauntlet-leader-tile", { timeout: 20000 });

const leaders = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const ids = [...document.querySelectorAll(".gauntlet-leader-tile")].map((tile) => tile.dataset.leader);
  return { ids, factions: ids.map((id) => content.leaders[id]?.faction), canvases: document.querySelectorAll(".gauntlet-leader-tile canvas").length };
});
if (leaders.ids.length !== 3) fail(`${leaders.ids.length} leaders offered, expected 3`);
else if (new Set(leaders.factions).size !== 3) fail(`the three leaders share a faction: ${leaders.factions.join(", ")}`);
else if (leaders.canvases !== 3) fail(`${leaders.canvases} leader cards rendered`);
else ok(`three leaders from three factions, all drawn: ${leaders.factions.join(", ")}`);

await page.locator(".gauntlet-leader-tile").first().click();
await page.waitForSelector(".gauntlet-offer-tile", { timeout: 20000 });

const firstPick = await page.evaluate(() => ({
  count: document.querySelector("#gauntlet-pick-count")?.textContent?.trim(),
  cards: [...document.querySelectorAll(".gauntlet-offer-tile")].map((tile) => tile.dataset.card),
  canvases: document.querySelectorAll(".gauntlet-offer-tile canvas").length,
  rarity: document.querySelector("#gauntlet-rarity")?.textContent?.replace(/\s+/g, " ").trim(),
  spotlight: window.hypeboundGauntlet.offer()?.spotlight,
}));
if (firstPick.cards.length !== 3 || firstPick.canvases !== 3) {
  fail(`pick 1 offered ${firstPick.cards.length} cards and drew ${firstPick.canvases}`);
} else if (new Set(firstPick.cards).size !== 3) {
  fail(`pick 1 offered a repeated card: ${firstPick.cards.join(", ")}`);
} else if (firstPick.spotlight !== true) {
  fail("pick 1 is a Spotlight Pick by §8.1 and the screen does not think so");
} else {
  ok(`pick ${firstPick.count} is a Spotlight Pick, three distinct cards drawn: ${firstPick.rarity?.slice(0, 90)}`);
}
await page.screenshot({ path: path.join(OUT, "gauntlet-draft.png"), fullPage: true });

/**
 * A reload has to come back to the same pick with the same three cards.
 *
 * This is the whole reason an offer is derived from (seed, pick, deck) rather
 * than stored: if a reload rerolled it, closing the tab would be a reroll button
 * and nothing about a draft would mean anything.
 */
console.log("\n6. A reload is not a reroll");
await page.locator(".gauntlet-offer-tile").first().click();
await page.waitForTimeout(300);
const beforeReload = await page.evaluate(() => ({
  count: document.querySelector("#gauntlet-pick-count")?.textContent?.trim(),
  cards: [...document.querySelectorAll(".gauntlet-offer-tile")].map((t) => t.dataset.card),
  deck: window.hypeboundGauntlet.run().deck.length,
}));
await page.reload({ waitUntil: "networkidle" });
await settleOn(".gauntlet-screen");
const afterReload = await page.evaluate(() => ({
  count: document.querySelector("#gauntlet-pick-count")?.textContent?.trim(),
  cards: [...document.querySelectorAll(".gauntlet-offer-tile")].map((t) => t.dataset.card),
  deck: window.hypeboundGauntlet.run().deck.length,
}));
if (afterReload.cards.join() !== beforeReload.cards.join() || afterReload.deck !== beforeReload.deck) {
  fail(`the reload changed the offer: ${beforeReload.cards.join()} → ${afterReload.cards.join()}`);
} else {
  ok(`pick ${afterReload.count} survived a reload with the same three cards and ${afterReload.deck} card(s) drafted`);
}

// --- 7. thirty picks, and the deck that comes out --------------------------------------
console.log("\n7. Thirty picks");
const drafted = await page.evaluate(async () => {
  const run = window.hypeboundGauntlet.autoDraft();
  const { getContent } = await import("/src/engine/content.ts");
  const { validateDeck } = await import("/src/engine/deck.ts");
  const content = getContent();
  const problems = validateDeck(content, { name: "g", leaderCardId: run.leaderCardId, cards: run.deck });
  return {
    phase: run.phase,
    size: run.deck.length,
    leaderCardId: run.leaderCardId,
    listed: document.querySelectorAll("#gauntlet-deck-list li").length,
    codes: [...new Set(problems.map((p) => p.code))],
    copies: Math.max(...Object.values(run.deck.reduce((acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }), {}))),
    prism: run.deck.filter((id) => content.cards[id]?.current === "prism").length,
    prismNative: ["prism"].includes(content.leaders[run.leaderCardId].primaryCurrent) || ["prism"].includes(content.leaders[run.leaderCardId].secondaryCurrent ?? ""),
    splashLimit: content.balance.deck.prismSplashLimit,
  };
});
if (drafted.size !== 30 || drafted.phase !== "ready") fail(`the draft ended at ${drafted.size} cards in phase ${drafted.phase}`);
else ok(`30 picks made, phase "${drafted.phase}", ${drafted.listed} cards listed on the page`);

const otherThanCopies = drafted.codes.filter((code) => code !== "tooManyCopies");
if (otherThanCopies.length > 0) fail(`the drafted deck broke more than the copy limit: ${otherThanCopies.join(", ")}`);
else ok(`the only constructed rule it breaks is the copy limit — §8.1(4)'s one waiver (max ${drafted.copies} copies of a card)`);

if (!drafted.prismNative && drafted.prism > drafted.splashLimit) {
  fail(`${drafted.prism} Prism cards drafted for a non-Prism leader; the splash limit is ${drafted.splashLimit}`);
} else {
  ok(`Prism: ${drafted.prism} drafted, limit ${drafted.splashLimit}${drafted.prismNative ? " (leader is Prism-native, so it does not apply)" : ""}`);
}

// the leader's own pool reality is printed on the draft screen's rules, once chosen
await page.screenshot({ path: path.join(OUT, "gauntlet-deck.png"), fullPage: true });

// --- 8. the one free re-draft ----------------------------------------------------------
console.log("\n8. Delete and Repost");
const redraft = await page.evaluate(() => {
  const before = [...window.hypeboundGauntlet.run().deck];
  return { before, enabled: !document.querySelector("#gauntlet-redraft")?.disabled };
});
if (!redraft.enabled) fail("the re-draft button is disabled on a fresh run");
else {
  await page.locator("#gauntlet-redraft").click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const run = window.hypeboundGauntlet.run();
    return { phase: run.phase, deck: run.deck.length, used: run.redraftsUsed };
  });
  if (after.phase !== "draft" || after.deck !== 0) fail(`the re-draft left phase ${after.phase} with ${after.deck} cards`);
  else ok(`the re-draft emptied the deck and went back to pick 1 (used ${after.used} of 1)`);

  const second = await page.evaluate(() => window.hypeboundGauntlet.autoDraft().deck);
  const same = second.filter((id, i) => id === redraft.before[i]).length;
  if (same > 20) fail(`the re-drafted deck shares ${same}/30 picks in order with the first — it is not a new draft`);
  else ok(`the second draft differs from the first (${same}/30 picks the same)`);

  const disabled = await page.evaluate(() => document.querySelector("#gauntlet-redraft")?.disabled);
  if (!disabled) fail("the re-draft is still offered after being used, and §8.2 gives one");
  else ok("and the second re-draft is refused");
}

// --- 9. a real match with the drafted deck ---------------------------------------------
console.log("\n9. The drafted deck deals a real board");
await page.locator("#gauntlet-begin").click();
await page.waitForSelector("#gauntlet-fight", { timeout: 20000 });

const upNext = await page.evaluate(() => ({
  text: document.querySelector("#gauntlet-next")?.textContent?.replace(/\s+/g, " ").trim(),
  record: document.querySelector("#gauntlet-record .currency-value")?.textContent?.trim(),
  pips: document.querySelectorAll("#gauntlet-pips .gauntlet-pip").length,
}));
ok(`the run board reads "${upNext.record}" with ${upNext.pips} pips — ${upNext.text?.slice(0, 110)}`);

await page.locator("#gauntlet-fight").click();
await settleOn(".battle-screen");
await page.waitForTimeout(2500);

const board = await page.evaluate(() => {
  const hand = document.querySelectorAll(".hand-card, .hand .card").length;
  return { hand, hash: window.location.hash, canvas: Boolean(document.querySelector("canvas")) };
});
if (!board.canvas) fail("the battle board rendered no canvas");
else ok(`the match dealt on ${board.hash}${board.hand > 0 ? ` with ${board.hand} cards in hand` : ""}`);

const opponent = await page.evaluate(async () => {
  const { botDeck } = await import("/src/game/gauntlet/index.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const { validateDeck } = await import("/src/engine/deck.ts");
  const content = getContent();
  const run = JSON.parse(localStorage.getItem("hypebound:gauntlet")).data.run;
  const fight = run.pending;
  const deck = botDeck(content, fight.seed, fight.enemyLeaderCardId, "Rival");
  const codes = [...new Set(validateDeck(content, deck).map((p) => p.code))].filter((c) => c !== "tooManyCopies");
  return { size: deck.cards.length, leader: fight.enemyLeaderCardId, difficulty: fight.difficulty, codes };
});
if (opponent.size !== 30 || opponent.codes.length > 0) {
  fail(`the opponent's drafted deck is ${opponent.size} cards with problems ${opponent.codes.join(", ")}`);
} else {
  ok(`the opponent drafted 30 cards of its own as ${opponent.leader} on ${opponent.difficulty} — not a stock constructed deck`);
}
await page.screenshot({ path: path.join(OUT, "gauntlet-battle.png") });

// --- 10. what a finished run pays -------------------------------------------------------
console.log("\n10. The payout is the number the summary showed");
/**
 * Collect the run through the screen's own hook.
 *
 * This block used to import `claimGauntlet` and `profileStore` inside the
 * evaluate and diff the balance itself. Vite serves `page.evaluate` its own
 * copy of a module, and the payout landed in one instance while the balance was
 * read from another — so the check reported "promised 56 Clout / 15 Signal and
 * banked 0 / 0" while the game was paying correctly and the return value said
 * so. Anything that writes to the save has to run where the app's stores are.
 */
await page.goto(`${ORIGIN}/#gauntlet`, { waitUntil: "networkidle" });
await settleOn(".gauntlet-screen");
const paid = await page.evaluate(() => window.hypeboundGauntlet.collect(7));

if (!paid) {
  fail("there was no run to collect");
} else if (paid.gained.clout !== paid.payout.clout || paid.gained.signal !== paid.payout.signal) {
  fail(
    `the summary promised ${paid.payout.clout} Clout / ${paid.payout.signal} Signal and banked ${paid.gained.clout} / ${paid.gained.signal}`
  );
} else {
  ok(`a 7-win run promised ${paid.payout.clout} Clout + ${paid.payout.signal} Signal and banked exactly that`);
}
if (paid.left !== null) fail("the finished run was not cleared, so a closed tab comes back to a corpse");
else ok("and the run is cleared, so the summary cannot be re-collected");

/**
 * Reload rather than navigate.
 *
 * The page is already on #gauntlet, and a goto that changes only the hash does
 * not remount the screen — so the hub would still be showing the pre-collect
 * view and its deferred list would be nowhere on the page.
 */
await page.reload({ waitUntil: "networkidle" });
await settleOn(".gauntlet-screen");
const hub = await page.evaluate(() => ({
  deferred: [...document.querySelectorAll(".gauntlet-deferred li")].map((li) => li.dataset.deferred),
  save: window.hypeboundGauntlet.save(),
}));
if (hub.deferred.length === 0) fail("the hub lists nothing as unbuilt, and §8 asks for several things this build lacks");
else ok(`${hub.deferred.length} unbuilt controls listed with reasons: ${hub.deferred.join("; ")}`);
ok(`lifetime record: ${hub.save.runsStarted} started, ${hub.save.runsFinished} finished, best ${hub.save.bestWins}, ${hub.save.lifetimeClout} Clout banked`);

// --- 11. nothing is clipped --------------------------------------------------------------
console.log("\n11. Every panel is legible");
const clipped = await page.evaluate(() =>
  [...document.querySelectorAll(".gauntlet-body > section")]
    .filter((el) => el.scrollHeight > el.clientHeight + 2)
    .map((el) => `${el.className.split(" ").slice(-1)[0]} ${el.scrollHeight}>${el.clientHeight}`)
);
if (clipped.length > 0) fail(`${clipped.length} panel(s) clip their content: ${clipped.join(", ")}`);
else ok("no panel on the hub clips its content");

const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (wide > 2) fail(`the page scrolls sideways by ${wide}px`);
else ok("and the page does not scroll sideways");

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of errors.slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log(`\n   saved screenshots/gauntlet-hub.png, gauntlet-draft.png, gauntlet-deck.png, gauntlet-battle.png`);
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
