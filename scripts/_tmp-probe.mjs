/** Temporary measuring probe: drives to a live battle and evaluates a snippet. */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const [sizeArg, file, waitArg] = process.argv.slice(2);
const [vw, vh] = sizeArg.split("x").map(Number);
const source = readFileSync(file, "utf8");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/#battle?seed=7`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count()) {
    await page.click(".mulligan-actions .btn-primary");
  }
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(Number(waitArg || 1400));
  const out = await page.evaluate((src) => new Function(src)(), source);
  console.log(JSON.stringify(out));
  if (errors.length) console.log("ERRORS " + JSON.stringify(errors.slice(0, 8)));
} finally {
  await browser.close();
}
