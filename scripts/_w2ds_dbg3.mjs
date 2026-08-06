import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
console.log("seed:", await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  const modes = ["ai-beginner", "ai-standard", "gauntlet", "story"];
  const res = ["win", "loss", "win", "draw"];
  let t = Date.now() - 40 * 3.6e6;
  for (let i = 0; i < 32; i++) {
    t += 3.1e6;
    profile.recordMatch(null, res[i % 4], { deckName: "Neon Rush", leaderCardId: leaders[i % leaders.length], opponentLeaderCardId: leaders[(i + 4) % leaders.length], mode: modes[i % 4], content, turns: 6 + (i % 9), now: t });
  }
  (await import("/src/save/storage.ts")).flushAllStores();
  return JSON.parse(localStorage.getItem("hypebound:profile")).data.history.length;
}));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
console.log("after reload:", await page.evaluate(async () => {
  const p = await import("/src/save/profile.ts");
  return { mem: p.getProfile().history.length, ls: JSON.parse(localStorage.getItem("hypebound:profile")).data.history.length };
}));
await browser.close();
