/**
 * Mean colour, and the hue of it, over a rectangle of a capture.
 *
 * `_w4b_lum.mjs` answers "how bright is this region", which is the right
 * question for a hand that might be the darkest object on screen and the wrong
 * one for "is that outline in the palette". Hue is the thing being argued about
 * in this wave, so hue is what this prints — plus the brightest pixel in the
 * region, because a 2px rim is a small minority of any box you can aim at and
 * its mean is mostly the card underneath it.
 *
 *   node scripts/_w5rgb.mjs a.png b.png -- rim:365,742,4,80
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
      const hueOf = (r, g, b) => {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) return -1;
        const d = max - min;
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = Math.round(h * 60);
        return h < 0 ? h + 360 : h;
      };
      const stat = (x, y, w, h) => {
        const d = ctx.getImageData(x, y, w, h).data;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        let best = { lum: -1 };
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          sr += r;
          sg += g;
          sb += b;
          n += 1;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum > best.lum) best = { lum: +lum.toFixed(1), rgb: `${r},${g},${b}`, hue: hueOf(r, g, b) };
        }
        const mr = Math.round(sr / n);
        const mg = Math.round(sg / n);
        const mb = Math.round(sb / n);
        /*
         * How many pixels in here are a *lit* green, and how many a lit warm.
         *
         * The mean of a box containing a 2px rim is mostly the card under it, so
         * a mean hue cannot answer "is the outline lime". A census can: count
         * only pixels bright and saturated enough to be an emitter rather than
         * artwork, and bucket them. 150 luminance and 0.34 saturation is above
         * every skin tone and card frame in the hand and below the rim.
         */
        let lime = 0;
        let warm = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < 150) continue;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max === 0 || (max - min) / max < 0.34) continue;
          const hue = hueOf(r, g, b);
          if (hue >= 90 && hue <= 175) lime += 1;
          else if (hue >= 25 && hue <= 60) warm += 1;
        }
        return { mean: `${mr},${mg},${mb}`, meanHue: hueOf(mr, mg, mb), brightest: best, litLime: lime, litWarm: warm };
      };
      const result = { size: `${img.width}x${img.height}` };
      for (const b of boxes) result[b.name] = stat(b.x, b.y, b.w, b.h);
      return result;
    },
    [src, regions]
  );
  console.log(file.split(/[\\/]/).pop(), JSON.stringify(out));
}
await browser.close();
