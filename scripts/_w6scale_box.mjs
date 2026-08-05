/**
 * Print the box a named element actually got, at a chosen interface scale.
 *
 * The sweep answers "is anything cut"; this answers "why", which is always the
 * same three numbers — the height the box was given, the height its content
 * wanted, and whether anything in the chain can scroll to the difference.
 *
 *   node scripts/_w6scale_box.mjs starter 160 ".starter-body,.starter-list-wrap,.starter-list"
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const [route, pct, selectors] = process.argv.slice(2);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const [vw, vh] = String(arg("size", "1280x720")).split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
await page.waitForTimeout(400);
await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
  .catch(() => {});
await page.waitForTimeout(1500);

const rows = await page.evaluate((sel) => {
  const out = [];
  for (const s of sel.split(",")) {
    for (const el of document.querySelectorAll(s.trim())) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.push({
        sel: s.trim(),
        box: `${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.left)},${Math.round(b.top)}`,
        client: `${el.clientWidth}x${el.clientHeight}`,
        scroll: `${el.scrollWidth}x${el.scrollHeight}`,
        overflow: `${cs.overflowX}/${cs.overflowY}`,
        scrolls: el.scrollHeight > el.clientHeight + 2,
        display: cs.display,
        rows: cs.gridTemplateRows,
        justify: cs.justifyContent,
        vars: {
          fadeTop: cs.getPropertyValue("--fade-top").trim(),
          fadeBottom: cs.getPropertyValue("--fade-bottom").trim(),
        },
      });
    }
  }
  return { vh: window.innerHeight, vw: window.innerWidth, out };
}, selectors);
console.log(`viewport ${rows.vw}x${rows.vh}  ui-scale ${pct}%  route ${route}`);
for (const r of rows.out) console.log(JSON.stringify(r));
await browser.close();
