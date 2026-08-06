/**
 * Does anything on this route fall off the bottom, and by how much.
 *
 *   node scripts/_ff/fit.mjs <route|queue> <WxH> [uiScale]
 *
 * Reports the scroll overflow of every scroller on the screen and the box of
 * every element whose bottom is past the viewport, because "it scrolls" and "it
 * is cut off with no way to reach it" look identical in a screenshot.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "signin";
const [w, h] = (process.argv[3] ?? "844x390").split("x").map(Number);
const uiScale = process.argv[4] ?? null;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}
await page.evaluate(() => {
  localStorage.setItem(
    "hypebound-auth:session",
    JSON.stringify({
      accessToken: "camera-only",
      refreshToken: "camera-only",
      expiresAtMs: Date.now() + 3_600_000,
      account: { userId: "camera", email: "camera@example.com" },
    })
  );
});
await page.goto(`${ORIGIN}/?nointro#${route}`);
await page.reload({ waitUntil: "networkidle" });
if (uiScale) await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", s), uiScale);
await page.waitForTimeout(2200);

const report = await page.evaluate(() => {
  const out = [];
  const screen = document.querySelector(".screen");
  out.push(`screen: ${screen?.className ?? "none"}`);
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY !== "visible") {
      out.push(
        `scroller ${el.className || el.tagName} ${el.clientHeight} client / ${el.scrollHeight} scroll (+${el.scrollHeight - el.clientHeight})`
      );
    }
  }
  const vh = innerHeight;
  const seen = new Set();
  for (const el of document.querySelectorAll("main *, header *, main, header")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom <= vh + 1 && r.top >= -1) continue;
    const key = el.className || el.tagName;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`offscreen ${key} top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} (viewport ${vh})`);
  }
  return out;
});
console.log(report.join("\n"));
await browser.close();
