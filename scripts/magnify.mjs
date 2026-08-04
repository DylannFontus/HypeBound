/**
 * Crop and magnify a region of a PNG so a detail can actually be judged.
 *
 * `shot.mjs --clip` needs a selector, and the things worth staring at on this
 * board — a drop socket, a contact shadow, the seam under the End Turn ring —
 * are drawn inside a canvas and have no element to name. This takes pixels.
 *
 *   node scripts/_bm_crop.mjs <in.png> <out.png> <x> <y> <w> <h> [scale]
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const [inPath, outPath, x, y, w, h, scale = "2"] = process.argv.slice(2);
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const data = readFileSync(path.resolve(inPath)).toString("base64");
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({
  viewport: { width: Math.round(Number(w) * Number(scale)), height: Math.round(Number(h) * Number(scale)) },
});
await page.setContent(
  `<style>html,body{margin:0;background:#000;overflow:hidden}
   img{position:absolute;image-rendering:pixelated;
       left:${-Number(x) * Number(scale)}px;top:${-Number(y) * Number(scale)}px;
       transform-origin:0 0;transform:scale(${Number(scale)})}</style>
   <img src="data:image/png;base64,${data}">`
);
await page.waitForTimeout(200);
await page.screenshot({ path: path.resolve(outPath) });
await browser.close();
console.log(outPath);
