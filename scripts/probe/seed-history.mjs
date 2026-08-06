/**
 * Photograph the data screens with a history behind them.
 *
 * `seedPlayedAccount` gives an account a full collection and **no matches**, so
 * every shot of statistics, match history and leaderboards is a picture of an
 * empty state. Those empty states matter and are reviewed on their own — but the
 * populated form of each screen is the other half of the domain and could not be
 * seen at all. This writes a plausible run of matches straight into the profile
 * store and then hands the page to `shot.mjs`'s own capture.
 *
 *   node scripts/probe/seed-history.mjs stats replays leaderboards profile
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const outDir = dirFlag === -1 ? path.join(HERE, "..", "screenshots", "review") : args[dirFlag + 1];
const routes = args.filter((a, i) => a !== "--dir" && i !== dirFlag + 1);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

const seeded = await page.evaluate(async () => {
  const { profileStore, getProfile } = await import("/src/save/profile.ts");
  const leaders = [
    ["idols-leader-lumi-starcall", "neon-idols"],
    ["gothic-leader-morvina", "gothic-royalty"],
    ["viral-leader-blayze-trendall", "viral-influencers"],
    ["corp-leader-cressida-vale", "corporate-creators"],
  ];
  const decks = ["Neon Idols Starter", "Halo & Pulse", "Manor Control"];
  const modes = ["ai-intermediate", "ai-expert", "gauntlet", "story", "doomscroll"];
  const now = Date.now();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const history = [];
  for (let i = 0; i < 24; i++) {
    const roll = rnd();
    const result = roll < 0.55 ? "win" : roll < 0.92 ? "loss" : "draw";
    const mine = leaders[Math.floor(rnd() * leaders.length)];
    const theirs = leaders[Math.floor(rnd() * leaders.length)];
    history.push({
      id: `seed-${i}`,
      playedAt: now - i * 5_400_000 - Math.floor(rnd() * 3_000_000),
      deckName: decks[Math.floor(rnd() * decks.length)],
      leaderCardId: mine[0],
      opponentLeaderCardId: theirs[0],
      result,
      turns: 6 + Math.floor(rnd() * 12),
      mode: modes[Math.floor(rnd() * modes.length)],
      summary: {
        cardsPlayed: 8 + Math.floor(rnd() * 18),
        peakObsession: Math.floor(rnd() * 9),
        confluenceUsed: rnd() > 0.6,
        damageDealt: 20 + Math.floor(rnd() * 30),
      },
    });
  }

  profileStore.update((p) => {
    p.history = history;
    p.stats.matchesPlayed = history.length;
    p.stats.wins = history.filter((h) => h.result === "win").length;
    p.stats.losses = history.filter((h) => h.result === "loss").length;
    p.stats.draws = history.filter((h) => h.result === "draw").length;
    p.accountLevel = 12;
    p.accountXp = 240;
  });
  profileStore.flush?.();
  return { history: getProfile().history.length, statKeys: Object.keys(getProfile().stats).join(",") };
});
console.log("seeded in this module instance:", JSON.stringify(seeded));

/*
 * Reload, because the module this script imported is not the one the app is running.
 *
 * Vite serves a hot-updated module under `…/profile.ts?t=<stamp>` and the plain
 * `…/profile.ts` this script imports is a *second instance* with its own store.
 * The first run of this probe worked and every later one reported zero matches,
 * which is exactly what two stores over one `localStorage` key looks like: the
 * write landed, in the wrong copy. Flushing to storage and reloading makes the
 * app's own instance read it, which is what a player's session does anyway.
 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
console.log(
  "after reload:",
  await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data?.history?.length ?? "none";
    } catch {
      return "unreadable";
    }
  })
);

/*
 * Navigate from the *same document*, and never let a reload in between.
 *
 * The write lives in the store's memory and in `localStorage`; a Vite HMR
 * full-reload between the seed and the capture puts the page back on whatever
 * the save layer decides to migrate, and two runs of this script produced 24
 * matches and then 0 for no reason visible in the script. Driving the hash
 * directly keeps it one document.
 */
for (const route of routes) {
  await page.evaluate((r) => {
    location.hash = `#${r}`;
  }, route);
  await page.waitForTimeout(200);
  await page.waitForTimeout(1400);
  const file = path.join(outDir, `${route}-played.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

await browser.close();
