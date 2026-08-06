import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const OUT = "D:/Gooner Card Game/scripts/screenshots/w2/datascreens";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  let t = Date.now() - 40 * 3.6e6;
  for (let i = 0; i < 32; i++) { t += 3.1e6;
    profile.recordMatch(null, ["win","loss","win","draw"][i%4], { deckName: ["Neon Rush","Gothic Control","Meme Tempo","Corporate Value"][i%4], leaderCardId: leaders[i%leaders.length], opponentLeaderCardId: leaders[(i+4)%leaders.length], mode: ["ai-beginner","ai-standard","gauntlet","story"][i%4], content, turns: 6+(i%9), now: t }); }
  (await import("/src/save/storage.ts")).flushAllStores();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const jobs = [["stats", ".stats-summary", "z-trend"], ["stats", ".stats-curve-panel", "z-curve"], ["replays", ".replay-list", "z-replaylist"], ["leaderboards", ".lb-hero, .leaderboards-body .panel:first-of-type", "z-lbcrest"], ["mastery", ".mastery-grid, .mastery-body", "z-mastery"], ["events", ".event-missions, .events-body", "z-eventmissions"]];
for (const [route, sel, name] of jobs) {
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(1500);
  const loc = page.locator(sel).first();
  if (await loc.count()) { await loc.screenshot({ path: path.join(OUT, name + ".png") }); console.log(name); }
  else console.log("MISSING", sel);
}
await browser.close();
