/**
 * How wide does a destination label want to be, and how wide is its tile?
 *
 * "Achievements" is one unbreakable word on the narrowest tile in the grid, and
 * it is the thing that decides whether the label can stay on one line at 125%
 * and 140%. Guessing from a screenshot is how the first three attempts at this
 * went; this measures the word against the box with the tile's own computed
 * font, and reports how many line boxes the label ended up with.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [wArg, hArg] = (process.env.SIZE ?? "1280x720").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: wArg, height: hArg }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await seedPlayedAccount(page);

for (const scale of [1, 1.25, 1.4, 1.6]) {
  await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
  await page.evaluate((v) => document.documentElement.style.setProperty("--ui-scale", String(v)), scale);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const rows = [];
    for (const el of document.querySelectorAll(".lobby-nav-label")) {
      const cs = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;white-space:nowrap;visibility:hidden;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
      probe.textContent = el.textContent;
      document.body.appendChild(probe);
      const need = Math.round(probe.getBoundingClientRect().width);
      probe.remove();
      rows.push({
        text: el.textContent,
        avail: Math.round(el.parentElement.clientWidth),
        need,
        lines: el.getClientRects().length,
      });
    }
    const nav = document.querySelector(".lobby-nav");
    const tile = document.querySelector(".lobby-nav-btn");
    return {
      navW: nav.clientWidth,
      navEm: Math.round((nav.clientWidth / parseFloat(getComputedStyle(nav).fontSize)) * 100) / 100,
      row: getComputedStyle(nav).gridAutoRows,
      tileH: tile.offsetHeight,
      over: [...document.querySelectorAll(".lobby-nav-btn")].map((t) => t.scrollHeight - t.clientHeight),
      rows,
    };
  });
  console.log(`\nscale ${scale}  nav ${r.navW}px (${r.navEm}em)  row ${r.row}  tile ${r.tileH}px  worst clip ${Math.max(...r.over)}px`);
  for (const row of r.rows) {
    const flag = row.need > row.avail ? "   <-- does not fit on one line" : "";
    console.log(`   ${row.text.padEnd(14)} needs ${String(row.need).padStart(4)}px in ${String(row.avail).padStart(4)}px, ${row.lines} line(s)${flag}`);
  }
}
await browser.close();
