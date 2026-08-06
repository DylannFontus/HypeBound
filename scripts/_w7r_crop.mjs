/**
 * A nearest-neighbour magnified crop, for judging a texture rather than a layout.
 *
 * The grain plane in `hall.css` is the one change in this wave that could be a
 * defect at full size and invisible in a review: at 1600x900 it is a few levels
 * of shimmer, and the only way to tell "film" from "television static" is to
 * look at it larger than life. `drawImage` with `imageSmoothingEnabled = false`
 * magnifies without inventing intermediate values, so what comes out is the
 * actual pixels and not a resampler's opinion of them.
 *
 *   node scripts/_w7r_crop.mjs in.png out.png x y w h zoom
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
const [inp, out, x, y, w, h, z] = process.argv.slice(2);
if (!CHROME) throw new Error("no Chrome/Edge found");
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("data:text/html,<title>crop</title>");
const b64 = await page.evaluate(async ([src, x, y, w, h, z]) => {
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
  const c = document.createElement("canvas");
  c.width = w * z; c.height = h * z;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, w * z, h * z);
  return c.toDataURL("image/png").split(",")[1];
}, [`data:image/png;base64,${readFileSync(inp).toString("base64")}`, +x, +y, +w, +h, +z]);
writeFileSync(out, Buffer.from(b64, "base64"));
console.log(out);
await browser.close();
