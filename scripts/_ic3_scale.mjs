/**
 * Set interface size to 140% the way a player does — by pressing the button —
 * then photograph the routes at 1280x720.
 *
 * Writing `--ui-scale` onto the root by hand is the tempting shortcut and it is
 * a lie: the setting also drives JS-side layout decisions (the ability rail
 * names it explicitly), so a hand-set custom property photographs a state the
 * game never actually enters. Clicking the control is slower and true.
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
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const dir = String(arg("dir", "scripts/screenshots/w4/ic3/scale14"));
const [vw, vh] = String(arg("size", "1280x720")).split("x").map(Number);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.locator("button", { hasText: /^140%$/ }).first().click();
await page.waitForTimeout(900);
console.log("ui-scale now:", await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")));

for (const r of ["a11y", "lobby", "play", "collection", "deckbuilder", "shop", "profile", "stats", "settings", "pass", "missions"]) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const f = path.join(dir, `${r}.png`);
  await page.screenshot({ path: f });
  // anything sticking out of its own screen, or text clipped to zero
  const bad = await page.evaluate(() => {
    const s = document.querySelector(".screen");
    if (!s) return null;
    const out = [];
    for (const e of s.querySelectorAll("*")) {
      const b = e.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      if (b.right > window.innerWidth + 2 || b.left < -2)
        out.push({ cls: String(e.className).slice(0, 46), right: Math.round(b.right), left: Math.round(b.left) });
      if (e.scrollWidth > e.clientWidth + 6 && getComputedStyle(e).overflowX === "hidden" && e.childElementCount === 0)
        out.push({ cls: String(e.className).slice(0, 46), textClipped: e.scrollWidth - e.clientWidth });
    }
    return { docScrollW: document.documentElement.scrollWidth, vw: window.innerWidth, offenders: out.slice(0, 10) };
  });
  console.log(r, JSON.stringify(bad));
}
await browser.close();
