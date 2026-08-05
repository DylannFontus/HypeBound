/**
 * One question, three scales: does the Hype Curve's peak chip touch its own title?
 *
 * The sweep in `_w6scale_sweep.mjs` caps its overlap list at the eight largest
 * boxes, and on the deck builder at 160% eight larger overlaps exist — so the
 * defect that was actually reported gets sorted off the end of the report. This
 * asks about the two elements by name and prints the gap in pixels, negative
 * when they intersect.
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
const dir = String(arg("dir", "scripts/screenshots/w6/scale/curve"));
const tag = String(arg("tag", "now"));
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

for (const pct of String(arg("scales", "100,140,160")).split(",")) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(400);

  await page.goto(`${ORIGIN}/?nointro#deckbuilder`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1600);

  const m = await page.evaluate(() => {
    const host = document.querySelector(".deck-curve");
    if (!host) return { error: "no .deck-curve" };
    const eyebrow = host.querySelector(".eyebrow");
    const frame = host.querySelector(".curve-frame");
    const counts = [...host.querySelectorAll(".curve-count")].filter((c) => !c.hidden);
    if (!eyebrow || !frame) return { error: "no eyebrow/frame" };
    const eb = eyebrow.getBoundingClientRect();
    const fb = frame.getBoundingClientRect();
    const R = (n) => Math.round(n * 10) / 10;
    const rows = counts.map((c) => {
      const cb = c.getBoundingClientRect();
      return {
        v: c.textContent,
        // negative = the chip has risen into the eyebrow's box
        gapToEyebrow: R(cb.top - eb.bottom),
        // negative = the chip has escaped the frame it belongs to
        aboveFrame: R(fb.top - cb.top),
        h: R(cb.height),
      };
    });
    const worst = rows.reduce((a, b) => (b.gapToEyebrow < a.gapToEyebrow ? b : a), rows[0] ?? null);
    return {
      eyebrowText: eyebrow.textContent,
      frameH: R(fb.height),
      counts: rows,
      worst,
      overlapsEyebrow: worst ? worst.gapToEyebrow < 0 : null,
      escapesFrame: worst ? worst.aboveFrame > 0 : null,
    };
  });
  console.log(`ui-scale ${pct}%`, JSON.stringify(m));
  await page.locator(".deck-curve").first().screenshot({ path: path.join(dir, `curve-${tag}-${pct}.png`) });
}
await browser.close();
