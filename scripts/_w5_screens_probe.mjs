/**
 * `verify:screens` with its six hash navigations un-stuck — a probe, not a fix.
 *
 * The real script dies on the first `goto("#stats", { waitUntil: "networkidle" })`
 * after the two seeding matches, and takes the whole run with it as an uncaught
 * TimeoutError. `_w5_idlewho.mjs` established why: once the battle route has been
 * on screen, `networkidle` never re-arms for that document, even with nothing in
 * flight by the document's own `performance` entries and `waitForLoadState`
 * timing out with no navigation at all.
 *
 * That kills the script before a single statistics assertion runs, so nobody
 * knows whether the forty checks *after* line 128 pass. This copy changes only
 * the six same-document waits to `load` and leaves every assertion untouched, so
 * the answer to "and what does the rest of it say?" exists before anybody
 * decides how to repair the original. Nothing here is a fix; the repository's
 * own script is unmodified.
 */
/**
 * The screens the profile points at, in a real browser.
 *
 * Statistics (§4.5.6), match history (§4.5.5), the character gallery (§4.3.3)
 * and the leaderboards explainer (§4.5.7). The unit suite proves the
 * dashboard's arithmetic; what only a browser can prove is that the numbers
 * reach a screen, that the gallery's portraits are actually drawn rather than
 * being empty canvases, and that every button the profile grew leads somewhere.
 *
 * This one plays two real matches first, because a statistics screen with no
 * statistics passes every check ever written about it.
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

await seedPlayedAccount(page);

// --- 0. give it something to count ---------------------------------------------
console.log("\n0. Playing two matches, so there is something to measure");
for (const seed of [301, 302]) {
  await page.goto(`http://localhost:5173/#battle?difficulty=beginner&seed=${seed}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
  const finished = await page.evaluate(async () => {
    const hook = window.hypeboundBattle;
    if (!hook?.autoPlay) return false;
    await hook.autoPlay();
    return true;
  });
  if (!finished) {
    // no auto-play hook: bank the matches through the profile instead, which is
    // still a real `recordMatch` and still a real replay
    await page.evaluate(async () => {
      const { recordMatch } = await import("/src/save/profile.ts");
      const { getContent } = await import("/src/engine/content.ts");
      const { autoBuildDeck } = await import("/src/engine/deck.ts");
      const { createMatch } = await import("/src/engine/state.ts");
      const { applyIntent } = await import("/src/engine/reducer.ts");
      const { chooseIntent } = await import("/src/ai/ai.ts");
      const { getAiProfile } = await import("/src/ai/profiles.ts");
      const storage = await import("/src/save/storage.ts");
      const content = getContent();
      const build = (seed, a, b) => {
        const config = {
          seed,
          decks: [autoBuildDeck(content, a, "A"), autoBuildDeck(content, b, "B")],
          firstSeat: 0,
        };
        let state = createMatch(config, content);
        const intents = [];
        const profiles = [getAiProfile("casual"), getAiProfile("casual")];
        while (state.phase === "mulligan") {
          const seat = state.players[0].mulliganDone ? 1 : 0;
          const decision = chooseIntent(state, content, seat, profiles[seat]);
          if (!decision) break;
          intents.push(decision.intent);
          state = applyIntent(state, content, decision.intent).state;
        }
        let guard = 0;
        while (state.winner === null && guard++ < 700) {
          const decision = chooseIntent(state, content, state.activeSeat, profiles[state.activeSeat]);
          if (!decision) break;
          intents.push(decision.intent);
          try {
            state = applyIntent(state, content, decision.intent).state;
          } catch {
            break;
          }
        }
        return { config, intents, result: { winner: state.winner, turns: state.turn }, state };
      };
      for (const [seed, leader, deckName, outcome] of [
        [901, "idols-lumi-starcall", "Neon Test", "win"],
        [902, "idols-lumi-starcall", "Neon Test", "loss"],
        [903, "goth-leader-alaric-thornheart", "Goth Test", "win"],
      ]) {
        const built = build(seed, leader, "goth-leader-alaric-thornheart");
        recordMatch(built, outcome, {
          deckName,
          leaderCardId: leader,
          opponentLeaderCardId: "goth-leader-alaric-thornheart",
          mode: "ai-casual",
          content,
        });
      }
      storage.flushAllStores();
    });
    await page.reload({ waitUntil: "networkidle" });
    break;
  }
}
const played = await page.evaluate(async () => (await import("/src/save/profile.ts")).getProfile().history.length);
if (played === 0) fail("no matches on record, so nothing below measures anything");
else ok(`${played} matches on record`);

// --- 1. statistics --------------------------------------------------------------
console.log("\n1. Statistics dashboard");
await page.goto("http://localhost:5173/#stats", { waitUntil: "load" });
await settleOn(".stats-screen");

const board = await page.evaluate(() => window.hypeboundStats.board());
if (board.overall.played !== played) fail(`the dashboard counts ${board.overall.played} of ${played} matches`);
else ok(`the dashboard counts all ${board.overall.played} matches`);
if (board.sample.detailed === 0) fail("no match recorded per-match detail, so every average is blank");
else ok(`${board.sample.detailed} of them recorded per-match detail`);
if (board.byDeck.length === 0) fail("no deck rows");
else ok(`${board.byDeck.length} deck row${board.byDeck.length === 1 ? "" : "s"}, ${board.byFaction.length} faction rows`);

const headline = await page.locator(".stats-headline dd").first().innerText();
if (Number(headline.replace(/[^0-9]/g, "")) !== board.overall.played) {
  fail(`the headline reads "${headline}" but the board says ${board.overall.played}`);
} else ok("the headline agrees with the board");

const pips = await page.locator(".stats-pip").count();
if (pips !== board.trend.length) fail(`${pips} trend pips for ${board.trend.length} matches`);
else ok(`the trend sparkline draws ${pips} pips`);

const sampleNote = await page.locator(".stats-sample").innerText();
if (!/draw/i.test(sampleNote)) fail("the screen does not say how draws are counted");
else ok("and it says out loud how draws are counted");

const csv = await page.evaluate(() => window.hypeboundStats.csv());
const csvRows = csv.trim().split("\n").length;
if (csvRows !== played + 1) fail(`the CSV has ${csvRows} lines for ${played} matches plus a header`);
else ok(`the CSV export writes one row per match (${csvRows} lines)`);
await page.screenshot({ path: path.join(OUT, "stats.png") });

const filtered = await page.evaluate(() => {
  window.hypeboundStats.filter("boss");
  return window.hypeboundStats.board("boss");
});
if (filtered.overall.played !== 0) fail("filtering to a mode with no matches still counted some");
else ok("filtering the mode filters the totals too, not just the tables");
await page.evaluate(() => window.hypeboundStats.filter("all"));

// --- 2. match history -----------------------------------------------------------
console.log("\n2. Match history");
await page.goto("http://localhost:5173/#replays", { waitUntil: "load" });
await settleOn(".replay-screen");

const rows = await page.locator(".replay-entry").count();
if (rows !== played) fail(`${rows} rows for ${played} matches`);
else ok(`${rows} rows, one per match`);

const filterGroups = await page.locator(".replay-filter-group").count();
if (filterGroups < 2) fail(`${filterGroups} filter groups; §4.5.5 asks for mode, faction and result`);
else ok(`${filterGroups} filter groups drawn`);

await page.locator('[data-filter="result"][data-value="win"]').click();
await page.waitForTimeout(150);
const wins = await page.locator(".replay-entry").count();
const actualWins = await page.evaluate(
  async () => (await import("/src/save/profile.ts")).getProfile().history.filter((h) => h.result === "win").length
);
if (wins !== actualWins) fail(`the wins filter shows ${wins} of ${actualWins} wins`);
else ok(`filtering to wins shows exactly the ${wins} won`);

await page.locator('[data-filter="result"][data-value="all"]').click();
await page.waitForTimeout(150);
const meta = await page.locator(".replay-entry-meta").first().innerText();
if (!/vs /.test(meta)) fail(`a row does not name the opponent: "${meta}"`);
else ok("each row names the opponent it was played against");

const rematch = await page.locator("#replay-rematch").count();
if (rematch === 0) fail("a practice match offers no 'run it back'");
else ok("a practice match offers 'run it back'");
await page.screenshot({ path: path.join(OUT, "history.png") });

// --- 3. the gallery ---------------------------------------------------------------
console.log("\n3. Character gallery");
await page.goto("http://localhost:5173/#gallery", { waitUntil: "load" });
await settleOn(".gallery-screen");

const castSize = await page.evaluate(() => window.hypeboundGallery.count());
if (castSize < 100) fail(`the cast is only ${castSize}`);
else ok(`${castSize} characters in the cast`);

const neonTiles = await page.evaluate(() => window.hypeboundGallery.show("neon-idols"));
if (neonTiles === 0) fail("filtering to a faction emptied the grid");
else ok(`filtering to Neon Idols shows ${neonTiles}`);

const opened = await page.evaluate(() => window.hypeboundGallery.open("idols-lumi-starcall"));
if (!opened) fail("a character page would not open");
else ok("a character page opens");

const portraitPixels = await page.evaluate(() => {
  const canvas = document.querySelector("#gallery-portrait canvas");
  if (!canvas) return 0;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
  return painted;
});
if (portraitPixels < 5000) fail(`the portrait drew ${portraitPixels} pixels — effectively blank`);
else ok(`the portrait renders (${portraitPixels} pixels painted)`);

const prose = await page.locator(".gallery-prose").count();
if (prose === 0) fail("the character page shows no prose at all");
else ok(`${prose} paragraph${prose === 1 ? "" : "s"} of lore on the page`);

const track = await page.locator(".gallery-track h4").first().innerText();
if (!/mastery|affinity/i.test(track)) fail(`no progression track on a leader's page (found "${track}")`);
else ok(`the leader's page shows a track: "${track.trim()}"`);

const strip = await page.locator("#gallery-strip canvas").count();
if (strip === 0) fail("the cards strip is empty");
else ok(`the cards strip renders ${strip} card${strip === 1 ? "" : "s"}`);
await page.screenshot({ path: path.join(OUT, "gallery.png") });

// --- 4. leaderboards, honestly ------------------------------------------------------
console.log("\n4. Leaderboards");
await page.goto("http://localhost:5173/#leaderboards", { waitUntil: "load" });
await settleOn(".leaderboards-screen");
const ladderRows = await page.locator("table, .leaderboard-row").count();
if (ladderRows > 0) fail("a ladder is being rendered offline; §4.5.7 forbids a fake one");
else ok("no fake ladder is rendered");
const explainer = await page.locator(".leaderboards-explainer p").first().innerText();
if (!/server/i.test(explainer)) fail(`the explainer does not say what is missing: "${explainer}"`);
else ok("the explainer says it needs the server, in words");

// --- 5. the profile is the hub --------------------------------------------------------
console.log("\n5. Reaching them from the profile");
await page.goto("http://localhost:5173/#profile", { waitUntil: "load" });
await settleOn(".profile-screen");
for (const [id, selector, name] of [
  ["profile-stats", ".stats-screen", "Statistics"],
  ["profile-history", ".replay-screen", "Match history"],
  ["profile-gallery", ".gallery-screen", "Characters"],
  ["profile-leaderboards", ".leaderboards-screen", "Leaderboards"],
]) {
  await page.goto("http://localhost:5173/#profile", { waitUntil: "load" });
  await settleOn(".profile-screen");
  if ((await page.locator(`#${id}`).count()) === 0) {
    fail(`the profile has no ${name} button`);
    continue;
  }
  await page.locator(`#${id}`).click();
  try {
    await settleOn(selector);
    ok(`${name} is reachable from the profile`);
  } catch {
    fail(`${name} did not open`);
  }
}

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Profile hub screens`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
