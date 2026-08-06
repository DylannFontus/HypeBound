/**
 * What the battle board is actually called in the DOM.
 *
 * Two attempts to drive a card play from a critic script have now missed because
 * the drop target was guessed from the screenshot rather than read from the
 * page. This prints the class names and boxes of everything on a live board so
 * the next script can name the real selector instead of a plausible one.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
if (await page.locator(".mulligan-actions .btn-primary").count())
  await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(1800);

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll("#app *")) {
        const b = e.getBoundingClientRect();
        if (b.width < 40 || b.height < 20) continue;
        out.push({
          t: e.tagName.toLowerCase(),
          c: String(e.className).slice(0, 70),
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.width),
          h: Math.round(b.height),
        });
      }
      return out;
    }),
    null,
    0
  )
);
await browser.close();
