import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("framenavigated", f => { if (f === page.mainFrame()) console.log("NAV", f.url()); });
page.on("pageerror", e => console.log("ERR", e.message));
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.evaluate(() => { location.hash = "#battle"; });
await page.waitForTimeout(4000);
console.log("in battle");
try { await page.evaluate(() => { location.hash = "#lobby"; }); } catch (e) { console.log("EVAL FAILED:", e.message.slice(0,80)); }
await page.waitForTimeout(3000);
console.log("now", page.url());
await browser.close();
