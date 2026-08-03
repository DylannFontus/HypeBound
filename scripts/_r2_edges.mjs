/**
 * Measure the alpha along all four edges of a rendered card canvas, plus the
 * frame band's lit/shadowed ratio, so the "shadow ends in a straight line"
 * defect can be checked rather than eyeballed.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const [content, renderer] = await Promise.all([
    import("/src/engine/content.ts"),
    import("/src/ui/cardRenderer/renderCard.ts"),
  ]);
  const index = content.getContent();
  const all = Object.values(index.cards).filter((c) => !c.token && c.type === "character");
  const picks = [
    all.find((c) => c.rarity === "legendary"),
    all.find((c) => c.rarity === "common"),
    all.find((c) => c.rarity === "epic"),
  ].filter(Boolean);

  await new Promise((r) => setTimeout(r, 500));

  const out = [];
  for (const card of picks) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 680;
    const ctx = canvas.getContext("2d");
    renderer.renderCard(ctx, card, {});
    const d = ctx.getImageData(0, 0, 512, 680).data;
    const alphaAt = (x, y) => d[(y * 512 + x) * 4 + 3];
    const scan = (pts) => {
      let max = 0;
      let sum = 0;
      let hotX = -1;
      for (const [x, y] of pts) {
        const a = alphaAt(x, y);
        sum += a;
        if (a > max) {
          max = a;
          hotX = x;
        }
      }
      return { max, mean: +(sum / pts.length).toFixed(1), hotX };
    };
    const top = [];
    const bottom = [];
    for (let x = 0; x < 512; x++) {
      top.push([x, 0]);
      bottom.push([x, 679]);
    }
    const left = [];
    const right = [];
    for (let y = 0; y < 680; y++) {
      left.push([0, y]);
      right.push([511, y]);
    }
    out.push({
      id: card.id,
      rarity: card.rarity,
      top: scan(top),
      bottom: scan(bottom),
      left: scan(left),
      right: scan(right),
    });
  }
  return out;
});

console.log(JSON.stringify(result, null, 1));
await browser.close();
