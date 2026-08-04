/**
 * Photograph the data screens with an account that has actually played.
 *
 * `seedPlayedAccount` grants a collection and nothing else, so every statistics,
 * match-history, mastery and leaderboard shot is a picture of an empty state.
 * Those empty states matter and are reviewed separately; the populated ones are
 * the screens a returning player sees every day, and they cannot be judged from
 * a zero-row table. This banks a dozen real matches through `recordMatch` — the
 * same call the battle makes — so the rows, curves, ladders and replays are the
 * real ones rather than fixtures.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const outDir = process.argv[2] ?? "scripts/screenshots/w2/dsr1/played";
const size = (process.argv[3] ?? "1600x900").split("x").map(Number);
const routes = (process.argv[4] ?? "profile,mastery,stats,leaderboards,replays,events").split(",");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await seedPlayedAccount(page);

const banked = await page.evaluate(async () => {
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
    const config = { seed, decks: [autoBuildDeck(content, a, "A"), autoBuildDeck(content, b, "B")], firstSeat: 0 };
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
  const plan = [
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "loss", "ai-casual"],
    ["goth-leader-alaric-thornheart", "Velvet Court", "win", "gauntlet"],
    ["goth-leader-alaric-thornheart", "Velvet Court", "draw", "gauntlet"],
    ["goth-leader-alaric-thornheart", "Velvet Court", "loss", "story"],
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
    ["goth-leader-alaric-thornheart", "Velvet Court", "loss", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "win", "doomscroll"],
    ["idols-lumi-starcall", "Neon Rush", "loss", "ai-casual"],
    ["goth-leader-alaric-thornheart", "Velvet Court", "win", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
    ["idols-lumi-starcall", "Neon Rush", "win", "ai-casual"],
  ];
  let n = 0;
  const day = 86_400_000;
  for (const [leader, deckName, outcome, mode] of plan) {
    const built = build(900 + n, leader, "goth-leader-alaric-thornheart");
    recordMatch(built, outcome, {
      deckName,
      leaderCardId: leader,
      opponentLeaderCardId: "goth-leader-alaric-thornheart",
      mode,
      content,
      now: Date.now() - (plan.length - n) * (day / 3),
    });
    n += 1;
  }
  storage.flushAllStores();
  return n;
});
console.log(`banked ${banked} matches`);
await page.reload({ waitUntil: "networkidle" });

for (const route of routes) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  const file = path.join(outDir, `${route.replace(/[^a-z0-9]+/gi, "-")}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
if (errors.length) console.log("console errors:", errors.slice(0, 8));
await browser.close();
