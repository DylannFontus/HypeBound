/**
 * Mean luminance of a rectangle in a PNG, for any number of PNGs at once.
 *
 * The End Turn confirm was measured at "mean luminance 84.0 to 35.9 — a 57%
 * cut", and the only way to know whether a change to the scrim actually moved
 * that number is to take the same reading again over the same rectangle. Node
 * has no image library in this project and is not getting one for this, so
 * Chrome does the decode and the arithmetic — the same trick `_w4b_diff.mjs`
 * uses.
 *
 *   node scripts/_w4mod_lum.mjs <x> <y> <w> <h> a.png b.png ...
 */
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [x, y, w, h] = process.argv.slice(2, 6).map(Number);
const files = process.argv.slice(6);
const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
for (const file of files) {
  const stat = await page.evaluate(
    async ([src, rx, ry, rw, rh]) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(rx, ry, rw, rh).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        // Rec. 601 luma, which is what the original 84.0/35.9 reading used.
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n += 1;
      }
      return { mean: sum / n, size: `${img.width}x${img.height}` };
    },
    [b64(file), x, y, w, h]
  );
  console.log(`${file.padEnd(56)} ${stat.mean.toFixed(1)}   (${stat.size})`);
}
await browser.close();
