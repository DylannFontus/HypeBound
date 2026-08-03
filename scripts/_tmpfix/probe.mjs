/** Does adding an ::after / overflow:hidden to the three raised materials break anything? */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const routes = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
try {
  await seedPlayedAccount(page, ORIGIN);
  for (const route of routes) {
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(900);
    const out = await page.evaluate(() => {
      const sel = ".mat-hero,.mat-panel,.mat-chip";
      const plates = [...document.querySelectorAll(sel)];
      const pseudo = [];
      const escapes = [];
      for (const el of plates) {
        for (const which of ["::before", "::after"]) {
          const cs = getComputedStyle(el, which);
          if (cs.content && cs.content !== "none" && cs.content !== "normal") {
            pseudo.push(`${which} ${el.className}`.slice(0, 120));
          }
        }
        const box = el.getBoundingClientRect();
        for (const kid of el.querySelectorAll("*")) {
          const k = kid.getBoundingClientRect();
          if (k.width === 0 || k.height === 0) continue;
          const over =
            Math.max(0, box.left - k.left) +
            Math.max(0, k.right - box.right) +
            Math.max(0, box.top - k.top) +
            Math.max(0, k.bottom - box.bottom);
          if (over > 2) escapes.push(`${el.className.slice(0, 40)} > ${kid.className || kid.tagName} by ${over.toFixed(0)}px`);
        }
      }
      const tally = (list) => {
        const m = {};
        for (const x of list) m[x] = (m[x] ?? 0) + 1;
        return m;
      };
      return { plates: plates.length, pseudo: tally(pseudo), escapes: tally(escapes) };
    });
    console.log(route, JSON.stringify(out, null, 1));
  }
} finally {
  await browser.close();
}
