/** How long the procedural art layer costs on a cold cache. Review scaffolding. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const CHROME = [String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`, String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
const out = await page.evaluate(async () => {
  const art = await import("/src/ui/screens/data/art.ts");
  const factions = ["neon-idols","gothic-royalty","viral-influencers","corporate-creators","digital-demons","cosplay-champions","afterparty-crew","touch-grass-order","algorithm-syndicate","meme-collective"];
  const t = {};
  let s = performance.now();
  for (const f of factions) art.crest(f, { size: 104 });
  t.crest10 = Math.round(performance.now() - s);
  s = performance.now();
  for (const f of factions) art.rankCrest({ size: 60, tier: 1, tiers: 20, colour: "#ff5fa2" });
  t.rank10 = Math.round(performance.now() - s);
  s = performance.now();
  art.rewardTile("lore", "#ff5fa2", 104); art.rewardTile("pack", "#ff5fa2", 104); art.rewardTile("clout", "#ff5fa2", 104);
  t.reward3 = Math.round(performance.now() - s);
  s = performance.now();
  art.banner("#35d0d8", { width: 1024, height: 384, seed: "x", emblem: "diamond" });
  t.banner1024 = Math.round(performance.now() - s);
  s = performance.now();
  art.ladderPlate(1200, 400);
  t.ladder = Math.round(performance.now() - s);

  // where does a single crest actually spend its time?
  const c = document.createElement("canvas"); c.width = 104; c.height = 104;
  const ctx = c.getContext("2d");
  s = performance.now();
  for (let i = 0; i < 10; i++) ctx.fillRect(0, 0, 104, 104);
  t.tenFills = Math.round(performance.now() - s);
  s = performance.now();
  for (let i = 0; i < 10; i++) c.toDataURL("image/png");
  t.tenPng = Math.round(performance.now() - s);
  s = performance.now();
  for (let i = 0; i < 10; i++) c.toDataURL("image/webp", 0.92);
  t.tenWebp = Math.round(performance.now() - s);
  return t;
});
console.log(out);
await browser.close();
