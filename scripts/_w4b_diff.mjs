/**
 * What actually changed between two captures, amplified so it can be seen.
 *
 * Feedback that is present in the scene graph and invisible on the screen has
 * cost this project several rounds — the drop socket drawn under an occupied
 * card, the slot rings lerping toward zero forever — and the only way to tell
 * the two apart is to subtract the frames. Chrome does the decode and the
 * arithmetic; node has no image library here and is not getting one for this.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [aPath, bPath] = process.argv.slice(2, 4);
const gain = Number(process.argv[4] ?? 8);
const out = process.argv[5] ?? path.join(path.dirname(aPath), "diff.png");

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const result = await page.evaluate(
  async ([a, b, g]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ia.width;
    const h = ia.height;
    const draw = (img) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.getContext("2d").getImageData(0, 0, w, h).data;
    };
    const da = draw(ia);
    const db = draw(ib);
    const oc = document.createElement("canvas");
    oc.width = w;
    oc.height = h;
    const octx = oc.getContext("2d");
    const outImg = octx.createImageData(w, h);
    const px = outImg.data;
    let moved = 0;
    let sum = 0;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      sum += d / 3;
      if (d > 12) {
        moved++;
        const p = i / 4;
        const x = p % w;
        const y = (p / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const v = Math.min(255, (d / 3) * g);
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
    octx.putImageData(outImg, 0, 0);
    return {
      png: oc.toDataURL("image/png"),
      movedPct: +((moved / (da.length / 4)) * 100).toFixed(2),
      meanDelta: +(sum / (da.length / 4)).toFixed(2),
      box: moved ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
    };
  },
  [b64(aPath), b64(bPath), gain]
);

const { writeFileSync } = await import("node:fs");
writeFileSync(out, Buffer.from(result.png.split(",")[1], "base64"));
console.log(JSON.stringify({ movedPct: result.movedPct, meanDelta: result.meanDelta, box: result.box, out }));
await browser.close();
