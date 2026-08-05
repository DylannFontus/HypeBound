/**
 * Mean and percentile luminance of a rectangle of a capture.
 *
 * "The hand is the darkest object on screen" is a measurable claim and it was
 * being argued from impressions. This reads the pixels: one region per argument,
 * as `name:x,y,w,h`, against any number of PNGs.
 *
 *   node scripts/_w4b_lum.mjs a.png b.png -- hand:330,560,620,150 mat:400,200,480,200
 */
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const files = argv.slice(0, split === -1 ? argv.length : split);
const regions = (split === -1 ? [] : argv.slice(split + 1)).map((spec) => {
  const [name, box] = spec.split(":");
  const [x, y, w, h] = box.split(",").map(Number);
  return { name, x, y, w, h };
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
for (const file of files) {
  const src = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const out = await page.evaluate(
    async ([source, boxes]) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = source;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const stat = (x, y, w, h) => {
        const d = ctx.getImageData(x, y, w, h).data;
        const values = [];
        for (let i = 0; i < d.length; i += 4) values.push(lum(d[i], d[i + 1], d[i + 2]));
        values.sort((a, b) => a - b);
        const at = (p) => +values[Math.floor((values.length - 1) * p)].toFixed(1);
        return {
          mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1),
          p10: at(0.1),
          median: at(0.5),
          p90: at(0.9),
        };
      };
      const result = { size: `${img.width}x${img.height}`, whole: stat(0, 0, img.width, img.height) };
      for (const b of boxes) result[b.name] = stat(b.x, b.y, b.w, b.h);
      return result;
    },
    [src, regions]
  );
  console.log(file.split(/[\\/]/).pop(), JSON.stringify(out));
}
await browser.close();
