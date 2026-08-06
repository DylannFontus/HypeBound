/**
 * Capture the data screens with a populated account.
 *
 * `scripts/lib/account.mjs` grants a collection and currency but never a match
 * history, so every stats/replay/mastery shot is an empty state. This drives
 * `recordMatch` in-page thirty-two times to give the domain something to draw.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const OUT = process.argv[3] ?? "D:/Gooner Card Game/scripts/screenshots/w2/datascreens";
const ROUTES = (process.argv[2] ?? "profile,stats,replays,mastery").split(",");
const SIZE = (process.argv[4] ?? "1600x900").split("x").map(Number);
const SUFFIX = process.argv[5] ?? "-full";
mkdirSync(OUT, { recursive: true });

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await seedPlayedAccount(page);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const seeded = await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const storage = await import("/src/save/storage.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  const modes = ["ai-beginner", "ai-standard", "ai-brutal", "gauntlet", "story", "doomscroll", "puzzle"];
  const decks = ["Neon Rush", "Gothic Control", "Meme Tempo", "Corporate Value"];
  const results = ["win", "loss", "win", "win", "loss", "draw", "win", "loss"];
  let now = Date.now() - 32 * 3.6e6;
  for (let i = 0; i < 32; i++) {
    const leader = leaders[i % leaders.length];
    const foe = leaders[(i * 3 + 1) % leaders.length];
    now += 3.1e6;
    profile.recordMatch(null, results[i % results.length], {
      deckName: decks[i % decks.length],
      leaderCardId: leader,
      opponentLeaderCardId: foe,
      mode: modes[i % modes.length],
      content,
      turns: 6 + (i % 9),
      now,
    });
  }
  storage.flushAllStores();
  return profile.getProfile().history.length;
});
console.log(`seeded ${seeded} matches`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

for (const route of ROUTES) {
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(900);
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1300);
  console.log(
    "  history at shot:",
    await page.evaluate(async () => (await import("/src/save/profile.ts")).getProfile().history.length)
  );
  const file = path.join(OUT, `${route}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 8)) console.log("  " + e);
}
await browser.close();
