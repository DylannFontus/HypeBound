/**
 * Reserved height against real height, per shelf.
 *
 * The virtualised gallery predicts each unbuilt shelf's height so the scroller is
 * the right length before anything exists. A prediction that is wrong moves the
 * ground under a player who is already reading, so this prints the prediction and
 * the truth side by side rather than inferring the error from a scroll offset.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const scale = process.argv[2] ?? "1.6";
const [vw, vh] = String(process.argv[3] ?? "1280x720").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);
await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", s), scale);
await page.goto(`${ORIGIN}/?nointro#gallery`, { waitUntil: "networkidle" });
await page.waitForSelector(".gal-shelf", { timeout: 20000 });
await page.waitForTimeout(1600);

const before = await page.evaluate(() =>
  [...document.querySelectorAll(".gal-shelf")].map((s) => ({
    f: s.dataset.faction,
    n: s.querySelectorAll(".gal-tile").length,
    h: Math.round(s.offsetHeight),
  }))
);
await page.evaluate(() => window.hypeboundGallery?.show("all"));
await page.waitForTimeout(700);
const after = await page.evaluate(() =>
  [...document.querySelectorAll(".gal-shelf")].map((s) => ({
    f: s.dataset.faction,
    n: s.querySelectorAll(".gal-tile").length,
    h: Math.round(s.offsetHeight),
  }))
);

console.log(`\n${vw}x${vh}  ui-scale ${scale}\n`);
console.log("  faction                 built  reserved   real   error");
let worst = 0;
for (const [i, row] of after.entries()) {
  const was = before[i];
  const err = row.h - was.h;
  if (was.n === 0) worst = Math.max(worst, Math.abs(err));
  console.log(
    `  ${String(row.f).padEnd(22)} ${String(was.n).padStart(4)}  ${String(was.h).padStart(8)} ${String(row.h).padStart(6)}  ${
      was.n === 0 ? String(err).padStart(6) : "     -"
    }`
  );
}
console.log(`\n  worst reservation error on an unbuilt shelf: ${worst}px\n`);
await browser.close();
