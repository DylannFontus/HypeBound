/**
 * The measurement the whole domain was blocked on: what does one keystroke in
 * the collection search actually cost?
 *
 * Round one measured 2,499.6ms of blocked main thread for a single character.
 * This types a sixteen-character query at a realistic speed and reports every
 * long task the browser saw while it was happening, plus the worst frame gap,
 * so "it is fast now" is a number rather than an impression.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
for (let i = 0; i < 5; i++) {
  try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); }
}
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "networkidle" });
await page.waitForSelector(".card-cell canvas");
await page.waitForTimeout(2600);

await page.evaluate(() => {
  const w = window;
  w.__long = [];
  w.__frames = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__long.push(Math.round(e.duration));
  }).observe({ entryTypes: ["longtask"] });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    w.__frames.push(Math.round(now - last));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.click("#col-search");
const query = "designated driv";
const t0 = Date.now();
for (const ch of query) {
  await page.keyboard.type(ch);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(900);
const out = await page.evaluate(() => ({
  long: window.__long,
  worstFrame: Math.max(...window.__frames.slice(4)),
  frames: window.__frames.length,
  shown: window.hypeboundCollection?.shown?.(),
}));
console.log(`typed ${query.length} chars in ${Date.now() - t0}ms wall`);
console.log("long tasks (>50ms):", out.long.length ? out.long.join(", ") : "none");
console.log("worst frame gap:", out.worstFrame, "ms over", out.frames, "frames");
console.log("cards shown after query:", out.shown);

// and the single worst case: paste sixteen characters at once
await page.evaluate(() => { window.__long.length = 0; });
await page.fill("#col-search", "");
await page.waitForTimeout(500);
await page.evaluate(() => { window.__long.length = 0; });
await page.fill("#col-search", "a");
await page.waitForTimeout(1200);
console.log("one-character cold pass long tasks:", await page.evaluate(() => window.__long.join(", ") || "none"));

await browser.close();
