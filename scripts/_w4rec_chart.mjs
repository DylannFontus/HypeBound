/**
 * Are the two Statistics charts drawn at the width of the box they are in?
 *
 * `statsScreen` sizes both canvases from `host.clientWidth || 760`, and
 * `shell.ts` builds a screen on a **detached** tree — so `clientWidth` is 0 at
 * the moment the chart is made and the fallback wins every time. This prints the
 * canvas's CSS width beside its host's, at three viewports. If they disagree,
 * the centrepiece of the screen is drawn to a constant.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { seedHistory } from "./lib/records.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await seedHistory(page);

const rows = [];
for (const [w, h] of [
  [1600, 900],
  [1280, 720],
  [844, 390],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${ORIGIN}/?nointro#stats`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  rows.push(
    await page.evaluate((size) => {
      const read = (sel) => {
        const host = document.querySelector(sel);
        const canvas = host?.querySelector("canvas");
        return {
          host: host ? Math.round(host.clientWidth) : 0,
          canvas: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
        };
      };
      const curve = read("#stats-curve");
      const trend = read("#stats-trend");
      return {
        size,
        curveHost: curve.host,
        curveDrawn: curve.canvas,
        trendHost: trend.host,
        trendDrawn: trend.canvas,
        curveShortfall: curve.host - curve.canvas,
        trendShortfall: trend.host - trend.canvas,
      };
    }, `${w}x${h}`)
  );
}
console.table(rows);
await browser.close();
