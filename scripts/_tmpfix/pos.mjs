/** Which material plates are position:static AND hold an abs-positioned descendant? */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
try {
  await seedPlayedAccount(page, ORIGIN);
  for (const route of process.argv.slice(2)) {
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const out = await page.evaluate(() => {
      const risky = [];
      let statics = 0;
      for (const el of document.querySelectorAll(".mat-hero,.mat-panel,.mat-chip")) {
        if (getComputedStyle(el).position !== "static") continue;
        statics++;
        for (const kid of el.querySelectorAll("*")) {
          const p = getComputedStyle(kid).position;
          if (p === "absolute" || p === "fixed") risky.push(`${el.className.slice(0, 46)} > ${(kid.className.baseVal ?? kid.className ?? kid.tagName).toString().slice(0, 30)} (${p})`);
        }
      }
      const t = {};
      for (const x of risky) t[x] = (t[x] ?? 0) + 1;
      return { statics, risky: t };
    });
    console.log(route, JSON.stringify(out, null, 1));
  }
} finally {
  await browser.close();
}
