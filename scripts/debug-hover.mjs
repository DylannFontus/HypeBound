/** Diagnose what transform the hovered hand card actually computes to. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=20260725", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
await page.click(".mulligan-actions .btn-primary");
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 });
await page.waitForTimeout(2000);

const before = await page.evaluate(() => {
  const el = document.querySelectorAll(".hand-card")[2];
  const r = el.getBoundingClientRect();
  return { transform: getComputedStyle(el).transform, w: Math.round(r.width), h: Math.round(r.height) };
});

const cards = await page.$$(".hand-card");
const box = await cards[2].boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
await page.waitForTimeout(800);

const after = await page.evaluate(() => {
  const el = document.querySelectorAll(".hand-card")[2];
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    transform: cs.transform,
    transformOrigin: cs.transformOrigin,
    animationFillMode: cs.animationFillMode,
    animationName: cs.animationName,
    matches: el.matches(":hover"),
    w: Math.round(r.width),
    h: Math.round(r.height),
    // which element is actually under that point
    topmost: document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.6)?.className ?? "?",
  };
});

const bounds = await page.evaluate(() => {
  const el = document.querySelectorAll(".hand-card")[2];
  const r = el.getBoundingClientRect();
  return {
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    viewportH: window.innerHeight,
    fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight,
    clippedBy: Math.max(0, Math.round(r.bottom - window.innerHeight)),
  };
});

console.log("BEFORE:", JSON.stringify(before));
console.log("AFTER :", JSON.stringify(after, null, 1));
console.log("BOUNDS:", JSON.stringify(bounds));

await browser.close();
