/** Frame-time probe: median/p95 rAF delta on a route, with optional CSS injected. */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "lobby";
const label = process.argv[3] ?? "as-shipped";
const css = process.argv[4] ?? "";
const size = (process.argv[5] ?? "1600x900").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  if (css) await page.addStyleTag({ content: css });
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(async () => {
    const deltas = [];
    let last = performance.now();
    await new Promise((done) => {
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (deltas.length >= 130) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const d = deltas.slice(20).sort((a, b) => a - b);
    const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    return {
      n: d.length,
      median: +q(0.5).toFixed(2),
      p95: +q(0.95).toFixed(2),
      worst: +d[d.length - 1].toFixed(2),
      long: d.filter((x) => x > 33).length,
      plates: document.querySelectorAll(".mat-hero,.mat-panel,.mat-chip,.mode-card").length,
    };
  });
  console.log(JSON.stringify({ route, label, ...stats }));
} finally {
  await browser.close();
}
