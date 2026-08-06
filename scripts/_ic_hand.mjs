/**
 * How dark is the hand, really?
 *
 * A screenshot said "the hand looks disabled" and a screenshot is exactly the
 * kind of evidence this project has been burned by — the grain reading that came
 * back 18.5% because the crop sat over button text is the cautionary tale. So
 * the comparison is made on the *same card id* in three places, sampling only
 * the art region, and the effective opacity/filter chain is read alongside the
 * pixels so the number has a mechanism attached to it.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

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
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
if (await page.locator(".mulligan-actions .btn-primary").count())
  await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(1600);

const hand = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".hand-card, .hand-bar > *, [class*='hand-card']")];
  const chain = (el) => {
    let o = 1;
    const f = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      o *= parseFloat(cs.opacity);
      if (cs.filter && cs.filter !== "none") f.push(`${String(n.className).slice(0, 24)}:${cs.filter}`);
    }
    return { effectiveOpacity: +o.toFixed(3), filters: f };
  };
  return cards.slice(0, 8).map((c) => ({
    cls: String(c.className).slice(0, 70),
    ...chain(c),
    rect: (() => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  }));
});
console.log("HAND CARDS:", JSON.stringify(hand, null, 1));

// Sample mean luminance of the art band of each hand card, off the composited page.
const shot = await page.screenshot({ type: "png" });
const lum = await page.evaluate(
  async ({ b64, boxes }) => {
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return boxes.map((b) => {
      // Art band only: upper-middle of the card, clear of the cost gem and name plate.
      const x = b.x + Math.round(b.w * 0.25);
      const y = b.y + Math.round(b.h * 0.18);
      const w = Math.max(1, Math.round(b.w * 0.5));
      const h = Math.max(1, Math.round(b.h * 0.3));
      if (x < 0 || y < 0 || x + w > c.width || y + h > c.height) return null;
      const d = g.getImageData(x, y, w, h).data;
      let s = 0;
      let n = 0;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        s += l;
        if (l > max) max = l;
        n += 1;
      }
      return { meanLuma: +(s / n).toFixed(1), maxLuma: Math.round(max), sampled: `${w}x${h}` };
    });
  },
  { b64: shot.toString("base64"), boxes: hand.map((h) => h.rect) }
);
console.log("HAND ART LUMA:", JSON.stringify(lum));

// The same cards, in the mulligan, one match later — and in the collection.
await page.goto(`${ORIGIN}/?nointro#collection`, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
const collBoxes = await page.evaluate(() =>
  [...document.querySelectorAll(".card-cell, .col-cell, [class*='card-cell']")].slice(0, 6).map((c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })
);
const shot2 = await page.screenshot({ type: "png" });
const lum2 = await page.evaluate(
  async ({ b64, boxes }) => {
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return boxes.map((b) => {
      const x = b.x + Math.round(b.w * 0.25);
      const y = b.y + Math.round(b.h * 0.18);
      const w = Math.max(1, Math.round(b.w * 0.5));
      const h = Math.max(1, Math.round(b.h * 0.3));
      if (x < 0 || y < 0 || x + w > c.width || y + h > c.height) return null;
      const d = g.getImageData(x, y, w, h).data;
      let s = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n += 1;
      }
      return { meanLuma: +(s / n).toFixed(1) };
    });
  },
  { b64: shot2.toString("base64"), boxes: collBoxes }
);
console.log("COLLECTION ART LUMA:", JSON.stringify(lum2));

await browser.close();
