/**
 * A tape measure for the rewards domain, and the reason it is a file rather
 * than an `--eval` on the camera.
 *
 * Four rounds of this review were spent arguing about whether a row was clipped
 * by eight pixels or by eighty, from PNGs. A screenshot tells you something is
 * wrong; it does not tell you that `.rw-banner-scroll` has 574px of client
 * height against 812px of content, which is the number that decides whether the
 * fix is a smaller hero or a different layout. This prints the boxes.
 *
 *   node scripts/measure-rewards.mjs banner 1600x900 ".rw-hero,.rw-spotlight"
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [route, size = "1600x900", sels = "", evalJs = "", waitMs = "1200"] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
  .catch(() => {});
if (evalJs) await page.evaluate((s) => new Function(s)(), evalJs);
await page.waitForTimeout(Number(waitMs));

const out = await page.evaluate((selCsv) => {
  const list = selCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const rows = [];
  for (const sel of list) {
    const nodes = [...document.querySelectorAll(sel)].slice(0, 8);
    if (nodes.length === 0) {
      rows.push({ sel, missing: true });
      continue;
    }
    for (const [i, el] of nodes.entries()) {
      const r = el.getBoundingClientRect();
      rows.push({
        sel: nodes.length > 1 ? `${sel}[${i}]` : sel,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        hidden: Math.max(0, el.scrollHeight - el.clientHeight),
        bg: getComputedStyle(el).backgroundImage.slice(0, 160),
        bgSize: getComputedStyle(el).backgroundSize,
      });
    }
  }
  return { rows, viewport: `${innerWidth}x${innerHeight}` };
}, sels);

console.log(JSON.stringify(out, null, 1));

/* Anything the eval left on window.__rw is printed too. That is how motion gets
   measured rather than guessed at: install an animationstart/animationend
   recorder and a longtask PerformanceObserver in the eval, park the results
   there, and read them back here. Four review rounds were spent trying to judge
   a 480ms flip from stills. */
const report = await page.evaluate(() => window.__rw ?? null);
if (report) console.log("REPORT:", JSON.stringify(report, null, 1));
if (errs.length) console.log("CONSOLE:", errs.slice(0, 8));
await browser.close();
