/** Read the console on boot. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => console.log(`[${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message, e.stack?.split("\n").slice(0, 4).join(" | ")));
await page.goto(`${ORIGIN}/#${process.argv[2] ?? "lobby"}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("---- dom ----");
console.log(await page.evaluate(() => document.getElementById("app")?.innerHTML.slice(0, 300)));
await browser.close();
