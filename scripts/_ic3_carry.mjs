/**
 * Three named carry-forwards, re-checked on the assembled build.
 *
 * The state doc lists them as wave-three debt and nobody has said they are gone:
 * the hand replaying its entrance 28 times per AI turn, the 459ms block in the
 * mulligan curtain, and the pass screen's LIST toggle laying out 7,304px wide
 * with its own way back off-screen. A verdict that ignores them is a verdict on
 * a game the player is not playing.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const dir = "scripts/screenshots/w4/ic3";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

// --- 3. the pass screen's LIST toggle ---------------------------------------
await page.goto(`${ORIGIN}/?nointro#pass`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const toggles = await page.locator(".pass-view-toggle button, .pass-toggle button, button", { hasText: /^(LIST|List|Track|TRACK|Grid)$/ }).count();
console.log("pass toggle candidates:", toggles);
const listBtn = page.locator("button", { hasText: /^List$|^LIST$/ }).first();
if (await listBtn.count()) {
  await listBtn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(dir, "P-pass-list.png") });
  console.log(
    "PASS LIST",
    JSON.stringify(
      await page.evaluate(() => {
        const s = document.querySelector(".screen");
        const wide = [...s.querySelectorAll("*")]
          .map((e) => ({ cls: String(e.className).slice(0, 34), sw: e.scrollWidth, cw: e.clientWidth }))
          .filter((x) => x.sw > 2200)
          .slice(0, 5);
        const back = document.querySelector(".screen a[href*='lobby'], .screen .back-btn, .screen .btn-back, .screen header button");
        const bb = back?.getBoundingClientRect();
        return {
          docScrollW: document.documentElement.scrollWidth,
          vw: window.innerWidth,
          wide,
          backBtn: bb ? { x: Math.round(bb.x), right: Math.round(bb.right), visible: bb.right > 0 && bb.x < window.innerWidth } : null,
        };
      })
    )
  );
} else {
  await page.screenshot({ path: path.join(dir, "P-pass.png") });
  console.log("PASS: no List toggle found; buttons:", JSON.stringify(await page.locator(".screen button").allTextContents()).slice(0, 400));
}

// --- 1 + 2. the mulligan block, and the hand entrance during an AI turn -----
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__lt = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
  }).observe({ entryTypes: ["longtask"] });
});
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log("MULLIGAN long tasks:", JSON.stringify(await page.evaluate(() => window.__lt)));

if (await page.locator(".mulligan-actions .btn-primary").count()) await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(2200);

await page.evaluate(() => {
  window.__hand = [];
  document.addEventListener(
    "animationstart",
    (e) => {
      if (String(e.target.className).includes("hand-card")) window.__hand.push(e.animationName);
    },
    true
  );
});
// hand it over and let the rival take a whole turn
await page.click(".end-turn-btn").catch(() => {});
await page.waitForTimeout(9000);
console.log(
  "HAND entrance replays during one rival turn:",
  JSON.stringify(
    await page.evaluate(() => {
      const c = {};
      for (const n of window.__hand) c[n] = (c[n] ?? 0) + 1;
      return c;
    })
  )
);
await browser.close();
