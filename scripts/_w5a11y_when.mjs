/**
 * Is the 43px a control, or is it the screen?
 *
 * Every remaining "under 44px" target measures exactly 0.985 of its own layout
 * box, on three viewports, including a header button that cannot be late in a
 * row cascade. That is the signature of an ancestor transform, not of a rule.
 * This samples the screen root's own matrix at the moment `verify-mobile`
 * measures, and again once everything has settled.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await seedPlayedAccount(page);

const sample = () =>
  page.evaluate(() => {
    const screen = document.querySelector(".screen:not(.screen-out)") ?? document.querySelector(".screen");
    const btn = document.querySelector(".mission-actions button");
    const chain = [];
    for (let el = btn; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (s.transform !== "none" || s.scale !== "none") {
        chain.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} transform=${s.transform} scale=${s.scale}`);
      }
    }
    return {
      screenClass: screen?.className,
      outs: document.querySelectorAll(".screen-out").length,
      running: document.getAnimations().filter((a) => a.playState === "running").length,
      btnRect: btn ? [Math.round(btn.getBoundingClientRect().width * 10) / 10, Math.round(btn.getBoundingClientRect().height * 10) / 10] : null,
      btnLayout: btn ? [btn.offsetWidth, btn.offsetHeight] : null,
      chain,
    };
  });

await page.goto("http://localhost:5173/#missions", { waitUntil: "networkidle" });
await page.waitForSelector(".missions-screen", { timeout: 15000 });
for (const ms of [250, 600, 1200, 2500]) {
  await page.waitForTimeout(ms === 250 ? 250 : 0);
  if (ms !== 250) await page.waitForTimeout(ms - 250);
  console.log(`\n--- ${ms}ms after the screen appeared`);
  console.log(JSON.stringify(await sample(), null, 1));
  break;
}

for (const extra of [350, 600, 1500]) {
  await page.waitForTimeout(extra);
  console.log(`\n--- +${extra}ms`);
  console.log(JSON.stringify(await sample(), null, 1));
}

await browser.close();
