import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const OUT = "D:/Gooner Card Game/scripts/screenshots/w2/datascreens";
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#story", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
// hover the second story row and focus the third
const rows = page.locator(".story-card, .d-row, .story-list > *");
console.log("rows:", await rows.count());
await rows.nth(1).hover().catch(()=>{});
await page.waitForTimeout(400);
await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
await page.waitForTimeout(400);
console.log("focused:", await page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + "." + (a.className||"").toString().split(" ").slice(0,3).join(".") : "none"; }));
await page.screenshot({ path: path.join(OUT, "z-states-story.png"), clip: { x: 200, y: 80, width: 1200, height: 560 } });
// events: hover a mission tile
await page.evaluate(() => { location.hash = "#events"; });
await page.waitForTimeout(1500);
await page.locator(".event-mission, .d-row").first().hover().catch(()=>{});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "z-states-events.png"), clip: { x: 200, y: 600, width: 1200, height: 300 } });
await browser.close();
