import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const p = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const c = getContent(); const L = Object.keys(c.leaders);
  let t = Date.now() - 40 * 3.6e6;
  for (let i = 0; i < 32; i++) { t += 3.1e6;
    p.recordMatch(null, ["win","loss","win","draw"][i%4], { deckName: "Neon Rush", leaderCardId: L[i%L.length], opponentLeaderCardId: L[(i+4)%L.length], mode: "ai-standard", content: c, turns: 8, now: t }); }
  (await import("/src/save/storage.ts")).flushAllStores();
});
await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1200);
for (const r of ["profile", "stats", "leaderboards"]) {
  await page.evaluate((x) => { location.hash = `#${x}`; }, r);
  await page.waitForTimeout(1600);
  const t = await page.evaluate(() => document.querySelector(".screen:not(.screen-out)")?.innerText.replace(/\s+/g, " ").slice(0, 300));
  console.log(r.toUpperCase(), "::", t);
}
await browser.close();
