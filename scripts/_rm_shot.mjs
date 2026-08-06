/** Photograph the battle board with reduced motion set BEFORE the app boots. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
try {
  for (let i = 1; ; i++) {
    try {
      await seedPlayedAccount(page, ORIGIN);
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await page.waitForTimeout(5000);
    }
  }
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("hypebound:settings") ?? "{}");
    const data = raw.data ?? raw;
    data.reducedMotion = true;
    localStorage.setItem("hypebound:settings", JSON.stringify(raw.data ? { ...raw, data } : data));
  });
  await page.goto(`${ORIGIN}/#battle?difficulty=beginner&seed=20260725`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(2200);
  console.log("reducedMotion =", await page.evaluate(() => document.documentElement.dataset.reducedMotion));
  await page.screenshot({ path: "scripts/screenshots/w2/battlemotion/reduced-board.png" });
} finally {
  await browser.close();
}
