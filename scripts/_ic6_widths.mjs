/**
 * Does the lobby scroll sideways, and at which widths — checked twice, two ways.
 *
 * `verify-mobile.mjs` reports "none of the 12 screens scrolls sideways" and the
 * lobby is one of the twelve. A separate sweep at 844x390 — the width the
 * project's own constraints name — found the lobby overflowing with eight of its
 * nine destination tiles past the right edge. Both cannot be right, and the
 * project's history says to doubt the instrument before the work, so this
 * measures the width continuously instead of at four chosen points, and does it
 * with and without `?nointro` because `verify-mobile.mjs` omits the flag and the
 * opening cinematic is a full-screen fixed sibling of `#app`.
 *
 *   node scripts/_ic6_widths.mjs lobby collection
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const routes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WIDTHS = [
  [667, 375],
  [740, 380],
  [800, 390],
  [844, 390],
  [900, 400],
  [915, 412],
  [1024, 500],
  [1080, 810],
  [1280, 720],
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const nointro of [true, false]) {
  console.log(`\n=== ${nointro ? "?nointro (a player who has booted before)" : "no flag — the cinematic is live, which is how verify-mobile navigates"} ===`);
  for (const [w, h] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await seedPlayedAccount(page, ORIGIN);
    const row = [];
    for (const route of routes.length ? routes : ["lobby"]) {
      await page.goto(`${ORIGIN}/${nointro ? "?nointro" : ""}#${route}`, { waitUntil: "networkidle" });
      await page
        .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1100);
      const m = await page.evaluate(() => {
        const screen = document.querySelector(".screen");
        const vw = window.innerWidth;
        const widest = [...(screen?.querySelectorAll("*") ?? [])].reduce((max, e) => {
          const b = e.getBoundingClientRect();
          return b.width > 4 && b.height > 4 ? Math.max(max, b.right) : max;
        }, 0);
        return {
          vw,
          docW: document.documentElement.scrollWidth,
          bodyW: document.body.scrollWidth,
          screenW: screen ? screen.scrollWidth : -1,
          widest: Math.round(widest),
          intro: Boolean(document.querySelector(".intro-root, .intro-overlay, [class*='intro']")),
          bodyOverflowX: getComputedStyle(document.body).overflowX,
        };
      });
      row.push(
        `${route}: doc=${m.docW} body=${m.bodyW} screen=${m.screenW} widestRight=${m.widest} ` +
          `${m.docW > m.vw + 2 || m.widest > m.vw + 2 ? "OVERFLOW" : "fits"}${m.intro ? " [intro present]" : ""} ovx=${m.bodyOverflowX}`
      );
    }
    console.log(`${String(w).padStart(4)}x${String(h).padEnd(4)}  ${row.join("   |   ")}`);
    await page.close();
  }
}

await browser.close();
