/**
 * A console reader for the room work, and it exists because `shot.mjs` reports
 * a boot failure as "locator('.starter-screen') never became visible" — which
 * is true, useless, and indistinguishable from a screen that is simply slow.
 * This prints the page errors instead.
 *
 *   node scripts/_w8room_dbg.mjs [route]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";

const CHROME = [
  path.join("C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join("C:", "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
].find((p) => existsSync(p));

const route = process.argv[2] ?? "";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("requestfailed", (r) => console.log("REQFAIL:", r.url()));
page.on("response", (r) => r.status() >= 400 && console.log("HTTP", r.status(), r.url()));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 400)));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text().slice(0, 400)));
await page.goto(`http://localhost:5173/?nointro${route ? `#${route}` : ""}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("hash    ", await page.evaluate(() => location.hash));
console.log("screens ", await page.evaluate(() => [...document.querySelectorAll(".screen")].map((s) => s.className)));
console.log("rooms   ", await page.evaluate(() => document.querySelectorAll(".d-room").length));
console.log("layers  ", await page.evaluate(() => document.querySelectorAll(".d-room > *").length));
console.log("foreGrn ", await page.evaluate(() => document.querySelectorAll(".atm-fore-grain").length));
console.log(
  "grainSrc",
  await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--grain-src").length)
);
await browser.close();
