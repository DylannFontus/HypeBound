/**
 * Is the dev server actually serving a game right now?
 *
 * Fifteen builders share one Vite process, and a half-saved file anywhere in the
 * tree takes the whole app down with a 500 on one module and an empty `#app`.
 * Every capture script then fails on whatever selector it happened to wait for —
 * `.starter-screen`, `.battle-screen`, `.mulligan-panel` — which reads exactly
 * like the feature under test being broken. This says which module 500'd, in one
 * line, so a red run can be attributed in seconds instead of being investigated.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE: " + m.text().slice(0, 400));
});
page.on("response", async (r) => {
  if (r.status() >= 400) {
    console.log(`HTTP ${r.status()} ${r.url()}\n${(await r.text().catch(() => "")).slice(0, 600)}`);
  }
});

await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("app html len:", await page.evaluate(() => document.querySelector("#app")?.innerHTML.length ?? -1));
console.log(
  "screens:",
  JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".screen")].map((s) => s.className)))
);
await browser.close();
