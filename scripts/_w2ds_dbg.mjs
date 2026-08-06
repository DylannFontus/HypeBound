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
const out = await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  let err = null;
  try {
    profile.recordMatch(null, "win", { deckName: "Neon Rush", leaderCardId: leaders[0], opponentLeaderCardId: leaders[1], mode: "ai-standard", content, turns: 9, now: Date.now() });
  } catch (e) { err = String(e); }
  return { err, len: profile.getProfile().history.length, keys: Object.keys(localStorage) };
});
console.log(JSON.stringify(out, null, 1));
await page.waitForTimeout(800);
const after = await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  return { len: profile.getProfile().history.length, stored: JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data?.history?.length ?? -1 };
});
console.log(JSON.stringify(after));
await browser.close();
