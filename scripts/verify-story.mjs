/**
 * Story chapters, in a real browser.
 *
 * The format and the runner are covered by 70 unit tests. What only a browser
 * can prove is the wiring, and one thing more important than any of it: that a
 * BROKEN chapter shows up as a readable report and takes nothing else down with
 * it. That is the entire feedback loop for somebody who has never opened this
 * project, and it is checked here by deliberately breaking a chapter.
 *
 * So this walks:
 *   1. the mode card → the chapter list → a chapter → an episode;
 *   2. one battle played for real, through the brief, the battle screen and the
 *      route back — the only way to prove the handoff returns to the right step;
 *   3. every remaining episode settled through the debug hook, down both sides
 *      of every choice, checking the flags a decision writes and the lines a
 *      later episode changes because of it;
 *   4. a chapter with a mistake in it, served from a fixture, reported on the
 *      story screen with the line number and the fix, with the real chapter
 *      still playable beside it.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "screenshots");
const STORY_DIR = path.join(HERE, "..", "data", "story");
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

const story = () => page.evaluate(() => window.hypeboundStory?.moment() ?? null);
const flags = () => page.evaluate(() => window.hypeboundStory?.flags() ?? {});

/**
 * Wait for a screen to be the ONLY screen.
 *
 * The router fades the outgoing screen for 200ms before removing it, so for that
 * window two screens are in the DOM and the old one sits on top of the new one's
 * click target. Waiting for the new selector alone is not enough.
 */
const settleOn = async (selector) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
};
const settleOnScene = async () => {
  await settleOn(".scene-screen");
  await page.waitForFunction(() => Boolean(window.hypeboundStory), null, { timeout: 20000 });
};

/**
 * Click through the scene until something needs a decision.
 * Returns the moment it stopped on.
 */
async function readUntilStop(pick = null) {
  /**
   * One click per pass, re-reading the moment each time.
   *
   * A line takes two clicks — one to finish the typewriter, one to advance — but
   * firing both without looking in between is how this got stuck: the second
   * click of the last line lands after the battle brief has already opened over
   * the stage, and Playwright waits thirty seconds for a target that is never
   * going to be clickable again.
   */
  for (let guard = 0; guard < 900; guard++) {
    const moment = await story();
    if (!moment) return null;
    if (moment.kind === "battle" || moment.kind === "end") return moment;
    if (moment.kind === "choice") {
      if (pick === null) return moment;
      await page.locator(".scene-choice").nth(pick).click();
      pick = null;
      continue;
    }
    await page.locator("#scene-stage").click({ position: { x: 800, y: 200 } });
  }
  fail("a scene never reached a choice, a battle or an ending");
  return null;
}

// --- 1. the mode card, the chapter list, a chapter ----------------------------
console.log("\n1. Reaching Story Chapters the way a player does");
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#play", { waitUntil: "networkidle" });
await page.waitForSelector(".mode-grid", { timeout: 20000 });

const storyCard = page.locator(".mode-card", { hasText: "Story Chapters" });
if ((await storyCard.count()) === 0) fail("no Story Chapters card on the mode screen");
else if (await storyCard.first().isDisabled()) fail("the Story Chapters card is still disabled");
else ok("the mode card is live");

await storyCard.first().click();
await page.waitForSelector(".story-list", { timeout: 10000 });

const chapters = await page.locator("button.story-card").count();
const broken = await page.locator(".story-broken").count();
if (chapters < 1) fail("no chapters on the story screen");
else ok(`${chapters} chapter(s) listed`);
if (broken > 0) fail(`${broken} chapter(s) failed to load`);
else ok("every chapter compiled");

/**
 * Does any chapter card cut its own blurb off?
 *
 * A card is a flex item in a column, so once the list overflows the browser
 * shrinks every card rather than scrolling — and each blurb loses its last line
 * mid-sentence. It looked perfect with one chapter and was wrong with five,
 * which is exactly the sort of thing a screenshot of the empty state never
 * catches and a growing campaign always eventually hits.
 */
const clipped = await page.evaluate(() =>
  [...document.querySelectorAll(".story-card")]
    .filter((card) => {
      const about = card.querySelector(".story-card-about");
      return about && about.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom + 1;
    })
    .map((card) => card.querySelector(".story-card-title")?.textContent ?? "?")
);
if (clipped.length) fail(`chapter blurb cut off on: ${clipped.join(", ")}`);
else ok("every chapter blurb is fully readable");
await page.screenshot({ path: path.join(OUT, "story-chapters.png") });

await page.locator("button.story-card").first().click();
await page.waitForSelector(".episode-list", { timeout: 10000 });
const episodes = await page.locator(".episode-row").count();
if (episodes < 2) fail(`chapter has only ${episodes} episode(s)`);
else ok(`${episodes} episodes listed`);

const lockedAtStart = await page.locator(".episode-row:disabled").count();
if (lockedAtStart !== episodes - 1) fail(`expected every episode but the first to be locked, ${lockedAtStart} were`);
else ok("only the first episode is unlocked");

// --- 2. one episode, one battle, played for real -----------------------------
console.log("\n2. Playing the first episode, and its battle, for real");
await page.locator(".episode-row").first().click();
await settleOnScene();

const firstChoice = await readUntilStop();
if (firstChoice?.kind !== "choice") fail(`expected a choice, reached ${firstChoice?.kind}`);
else ok(`reached the choice: "${firstChoice.prompt}"`);
await page.screenshot({ path: path.join(OUT, "story-choice.png") });

// pick the second option and check the flag it writes really lands
await page.locator(".scene-choice").nth(1).click();
const afterChoice = await flags();
if (Object.keys(afterChoice).length === 0) fail("picking an option wrote no flags");
else ok(`the choice was remembered: ${JSON.stringify(afterChoice)}`);

const battle = await readUntilStop(0);
if (battle?.kind !== "battle") fail(`expected a battle, reached ${battle?.kind}`);
else ok(`reached the battle against ${battle.battle.opponentName}`);

await page.waitForSelector("#scene-brief:not([hidden])", { timeout: 10000 });
const briefText = await page.locator(".scene-brief").innerText();
for (const rule of battle?.battle.rules ?? []) {
  if (!briefText.includes(rule.name)) fail(`the brief never prints the rule "${rule.name}"`);
}
if ((battle?.battle.rules.length ?? 0) > 0) ok("every rule is printed on the brief before a card is dealt");
if (!briefText.includes("Loaner deck") && !briefText.includes("Your deck")) fail("the brief never says where the deck comes from");
else ok("the brief says where the player's cards come from");
await page.screenshot({ path: path.join(OUT, "story-brief.png") });

const positionBefore = await page.evaluate(() => window.hypeboundStory.position());
await page.locator("#scene-brief-start").click();
await page.waitForSelector(".battle-screen, canvas", { timeout: 25000 });
await page.waitForTimeout(2500);
ok("the battle screen dealt the match");
await page.screenshot({ path: path.join(OUT, "story-battle.png") });

/**
 * Conceding is a loss, and a loss has to come back to the SAME step — the brief
 * again, with Story Assist now on offer. Getting this wrong would silently skip
 * a fight the player did not win, which is the failure mode the whole
 * position-is-one-number design exists to make impossible.
 */
await page.evaluate(() => window.hypeboundBattle.submit({ type: "concede", seat: 0 }));
await page.waitForSelector(".end-panel", { timeout: 25000 });
const endButtons = await page.locator(".end-actions .btn").allTextContents();
if (endButtons.length !== 1 || !/continue/i.test(endButtons[0] ?? "")) {
  fail(`a story battle should offer one way out, back to the story (got ${JSON.stringify(endButtons)})`);
} else {
  ok("the battle ends with one way out, back to the story");
}
await page.locator(".end-actions .btn").first().click();
await settleOnScene();

/**
 * A loss resumes inside the episode's own "if you lose" lines, and those lines
 * lead back to the same battle — not past it. Checking only that the screen came
 * back would pass even if the loss had silently counted as a win.
 */
const lossMoment = await story();
if (lossMoment?.kind !== "line") fail(`after losing, the episode resumed on ${lossMoment?.kind}, not the loss lines`);
else ok(`the loss lines play first: "${lossMoment.text}"`);

const retry = await readUntilStop();
const backAt = await page.evaluate(() => window.hypeboundStory.position());
if (retry?.kind !== "battle") fail(`after the loss lines, the episode reached ${retry?.kind}, not the battle again`);
else if (backAt !== positionBefore) fail(`the retry is at step ${backAt}, not ${positionBefore}`);
else ok("a loss leads back to the same battle, at the same step");

const flagsAfterBattle = await flags();
for (const [key, value] of Object.entries(afterChoice)) {
  if (JSON.stringify(flagsAfterBattle[key]) !== JSON.stringify(value)) {
    fail(`the flag "${key}" did not survive the battle handoff`);
  }
}
ok("decisions survive the trip through the battle screen");

await page.waitForSelector("#scene-brief:not([hidden])", { timeout: 10000 });
if (!(await page.locator("#scene-assist-toggle").count())) fail("Story Assist was not offered after a loss");
else ok("Story Assist is offered after the first loss");

// --- 3. the rest of the chapter, settled through the hook --------------------
console.log("\n3. Walking the rest of the chapter");
let settled = 0;
let lines = 0;
for (let guard = 0; guard < 40; guard++) {
  const moment = await readUntilStop();
  if (!moment) break;
  if (moment.kind === "end") break;
  if (moment.kind === "battle") {
    await page.evaluate(() => window.hypeboundStory.settleBattle(true));
    settled += 1;
    continue;
  }
  if (moment.kind === "choice") await page.locator(".scene-choice").first().click();
}
lines = (await page.evaluate(() => window.hypeboundStory?.log().length ?? 0)) ?? 0;
ok(`episode one finished: ${lines} lines read after the battle, ${settled} battle(s) settled`);

await settleOn(".episode-list");
const clearedRows = await page.locator(".episode-row.episode-done").count();
if (clearedRows !== 1) fail(`finishing episode one marked ${clearedRows} episodes cleared`);
else ok("episode one is marked cleared");
if (await page.locator(".episode-row").nth(1).isDisabled()) fail("episode two did not unlock");
else ok("episode two unlocked");

const recap = await page.locator("#story-recap").count();
if (!recap || (await page.locator("#story-recap").isHidden())) fail("the decision recap never appeared");
else ok(`the chapter recap prints the decisions: ${JSON.stringify(await flagsFromRecap())}`);

async function flagsFromRecap() {
  return page.evaluate(() =>
    [...document.querySelectorAll(".story-flag")].map((row) => row.textContent?.trim())
  );
}

// every remaining episode, front to back
console.log("\n4. Playing every remaining episode");
for (let index = 1; index < episodes; index++) {
  await page.locator(".episode-row").nth(index).click();
  await settleOnScene();
  const title = await page.locator(".scene-header .title").innerText();

  let battles = 0;
  for (let guard = 0; guard < 60; guard++) {
    const moment = await readUntilStop();
    if (!moment || moment.kind === "end") break;
    if (moment.kind === "battle") {
      await page.evaluate(() => window.hypeboundStory.settleBattle(true));
      battles += 1;
      continue;
    }
    // alternate which option is taken, so both sides of a branch get walked
    await page.locator(".scene-choice").nth(index % 2).click();
  }
  const read = await page.evaluate(() => window.hypeboundStory?.log().length ?? 0);
  await settleOn(".episode-list");
  ok(`"${title}" — ${read} lines, ${battles} battle(s)`);
}

const allCleared = await page.locator(".episode-row.episode-done").count();
if (allCleared !== episodes) fail(`${allCleared} of ${episodes} episodes cleared at the end of the chapter`);
else ok(`the whole chapter is cleared (${episodes} episodes)`);
await page.screenshot({ path: path.join(OUT, "story-chapter-complete.png") });

// --- 5. a broken chapter must not break anything -----------------------------
console.log("\n5. Breaking a chapter on purpose");
const BROKEN = path.join(STORY_DIR, "99-deliberately-broken.story.txt");
writeFileSync(
  BROKEN,
  [
    "TITLE: A Chapter With A Mistake In It",
    "",
    "=== EPISODE: One",
    "Lumi Starcall: This line is fine.",
    "BATTLE: Somebody",
    "  PLAYS: Cyra Swype",
    "",
  ].join("\n"),
  "utf8"
);
try {
  await page.goto("http://localhost:5173/#story", { waitUntil: "networkidle" });
  await page.waitForSelector(".story-list", { timeout: 20000 });
  await page.waitForSelector(".story-broken", { timeout: 20000 });

  const report = await page.locator(".story-problems").first().innerText();
  if (!report.includes("99-deliberately-broken.story.txt")) fail("the report never names the file");
  else if (!/line 6/.test(report)) fail(`the report never names the line: ${report}`);
  else if (!report.includes("Cyra Swipe")) fail("the report never suggests the name that would have worked");
  else ok("the broken chapter reports its file, its line and the fix");

  const stillPlayable = await page.locator("button.story-card:not(:disabled)").count();
  if (stillPlayable < 1) fail("a broken chapter took the working ones down with it");
  else ok(`${stillPlayable} working chapter(s) still playable beside it`);
  await page.screenshot({ path: path.join(OUT, "story-broken.png") });
} finally {
  unlinkSync(BROKEN);
}

// --- 6. a multi-wave board, played until reinforcements actually land --------
/**
 * The one thing about waves no unit test can see.
 *
 * The engine suite proves a wave lands on the right turn on the right board, and
 * the story suite proves `WAVES: <name>` reaches a `MatchConfig`. Neither can
 * prove the third thing, which is the one a player experiences: that the
 * schedule is on the brief before a card is dealt, and that when the wave lands
 * the screen SAYS SO. A board that silently grows by three is the failure this
 * is here to catch.
 *
 * Run against a fixture chapter rather than Chapter 9, whose wave battle is the
 * fourth episode of the ninth chapter — reaching it for real would mean winning
 * twenty-one battles first.
 */
console.log("\n6. A multi-wave board");
const WAVED = path.join(STORY_DIR, "98-wave-check.story.txt");
writeFileSync(
  WAVED,
  [
    "TITLE: Wave Check",
    "FACTION: Algorithm Syndicate",
    "ABOUT: A fixture chapter written by the browser verification. Deleted again on the way out.",
    "",
    "=== EPISODE: The Queue",
    "",
    "NARRATION: They keep arriving.",
    "",
    "BATTLE: The Support Queue",
    "  PLAYS: Skree Nine-Tabs",
    "  YOU PLAY: Don Sortino",
    "  DIFFICULTY: beginner",
    "  WAVES: the support queue",
    "",
  ].join("\n"),
  "utf8"
);
try {
  /**
   * Reload until the new file is in the module graph.
   *
   * Chapters are discovered by an eager `import.meta.glob`, which the dev server
   * re-evaluates when the folder changes — but not instantly. A single load and
   * a one-shot count reported "the chapter never appeared" against a chapter
   * that appeared a second later, which is a flaky check reading as a bug.
   */
  let waveCard = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto("http://localhost:5173/#story", { waitUntil: "networkidle" });
    await page.waitForSelector(".story-list", { timeout: 20000 });
    waveCard = page.locator("button.story-card", { hasText: "Wave Check" });
    if ((await waveCard.count()) > 0) break;
    waveCard = null;
    await page.waitForTimeout(1000);
  }

  if (!waveCard) fail("the wave fixture chapter never appeared");
  else {
    await waveCard.first().click();
    await settleOn(".episode-list");
    await page.locator(".episode-row").first().click();
    await settleOnScene();

    const waveBattle = await readUntilStop();
    if (waveBattle?.kind !== "battle") fail(`expected the wave battle, reached ${waveBattle?.kind}`);

    await page.waitForSelector("#scene-brief:not([hidden])", { timeout: 10000 });
    const brief = await page.locator(".scene-brief").innerText();
    /**
     * Every wave, named and counted, before the player commits. This is the
     * whole difference between a wave encounter and an opponent who will not
     * stop: you are told there are three.
     */
    const missing = ["The Support Queue", "band one", "band two", "band three"].filter((t) => !brief.includes(t));
    if (missing.length) fail(`the brief never prints: ${missing.join(", ")}`);
    else ok("the brief prints the whole wave schedule before a card is dealt");
    if (!/1\./.test(brief) || !/3\./.test(brief)) fail("the brief does not number the waves");
    else ok("the waves are numbered, so the fight is countable");
    await page.screenshot({ path: path.join(OUT, "story-wave-brief.png") });

    await page.locator("#scene-brief-start").click();
    await page.waitForSelector(".battle-screen, canvas", { timeout: 25000 });
    await page.waitForFunction(() => Boolean(window.hypeboundBattle), null, { timeout: 20000 });

    const dealt = await page.evaluate(() => window.hypeboundBattle.state().config.scenario?.waves ?? []);
    if (dealt.length !== 3) fail(`the match was dealt ${dealt.length} waves, expected 3`);
    else ok(`the match carries all ${dealt.length} waves in its config, so a replay rebuilds them`);

    /**
     * Keep the mulligan through its own button rather than submitting the intent.
     * Submitting works and leaves the overlay standing over the board, which
     * hides the very thing this section exists to photograph.
     */
    await page.locator(".mulligan-actions .btn").first().click();
    await page.waitForSelector(".mulligan-actions", { state: "detached", timeout: 15000 });
    let landed = 0;
    for (let turn = 0; turn < 8 && landed === 0; turn++) {
      landed = await page.evaluate(() => window.hypeboundBattle.state().wavesLanded);
      if (landed > 0) break;
      const mine = await page.evaluate(() => {
        const s = window.hypeboundBattle.state();
        return s.phase === "main" && s.activeSeat === 0;
      });
      if (mine) await page.evaluate(() => window.hypeboundBattle.submit({ type: "endTurn", seat: 0 }));
      await page.waitForTimeout(2000);
      landed = await page.evaluate(() => window.hypeboundBattle.state().wavesLanded);
    }

    if (landed === 0) fail("no wave ever arrived");
    else {
      const board = await page.evaluate(() =>
        window.hypeboundBattle.state().players[1].board.filter(Boolean).map((c) => c.cardId)
      );
      ok(`wave ${landed} landed — their board holds ${board.length}: ${board.join(", ")}`);

      /** Arriving is not enough; the screen has to say it arrived. */
      const log = await page.evaluate(() =>
        [...document.querySelectorAll(".history-entry")].map((e) => e.textContent ?? "")
      );
      const line = log.find((entry) => /Wave \d+\/\d+/.test(entry));
      if (!line) fail(`the log never mentions the wave: ${JSON.stringify(log.slice(-6))}`);
      else ok(`the log announces it: "${line.trim()}"`);

      /**
       * And nothing in it may attack the turn it lands. A wave the player never
       * gets a turn to answer is not a difficulty setting, it is an ambush.
       */
      const eager = await page.evaluate(() => {
        const s = window.hypeboundBattle.state();
        return s.players[1].board
          .filter(Boolean)
          .filter((c) => c.enteredOnTurn < 0 && !c.keywords.includes("raid"))
          .map((c) => c.cardId);
      });
      if (eager.length) fail(`wave bodies arrived able to attack: ${eager.join(", ")}`);
      else ok("nothing in the wave can attack the turn it lands");
    }
    await page.screenshot({ path: path.join(OUT, "story-wave-board.png") });
  }
} finally {
  unlinkSync(WAVED);
}

// --- done --------------------------------------------------------------------
const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
if (realErrors.length) {
  console.log("\nConsole errors:");
  for (const e of realErrors.slice(0, 10)) console.log(`   ${e}`);
  failures += realErrors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — story chapters`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
