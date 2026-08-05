/**
 * Calibrate the idle probe against the one reference that is not ours.
 *
 * `_w7r_idle.mjs` is arithmetically proven — it reads 7.651 on a bar whose
 * expected value is 7.650 by hand — but "median mean-absolute delta per 200ms"
 * still has free parameters (how many channels, what settles first, what counts
 * as at rest), and this wave's brief quotes numbers from a *different*
 * instrument: Hearthstone 1.71, our lobby 3.01, our board 5.47, gallery 0.195.
 * A number from a probe that has not been reconciled with those is not comparable
 * to them and must not be reported as though it were.
 *
 * `hearthstone_frames/` is 204 frames of real gameplay **0.2 seconds apart** —
 * exactly the probe's tick. So the reference floor can be recomputed here with
 * the identical metric, off the identical source, with no browser and no page
 * involved. If this prints 1.71, the metric matches the brief's and any
 * disagreement about our own screens is a disagreement about *protocol* — what
 * "at rest" means — rather than about arithmetic. If it prints something else,
 * that ratio is the scale factor between the two instruments and every reading
 * has to be quoted in whichever scale it was taken.
 *
 * The frames are Blizzard's and gitignored. This reads them and writes nothing.
 */

import { chromium } from "playwright-core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "hearthstone_frames");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const maths = await browser.newPage();
await maths.goto("data:text/html,<title>maths</title>");

/** Byte-for-byte the routine in `_w7r_idle.mjs`, so the two cannot drift apart. */
async function meanDelta(a, b) {
  return maths.evaluate(async ([sa, sb]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return -1;
    const w = ia.width;
    const h = ia.height;
    const px = (img) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = px(ia);
    const db = px(ib);
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) {
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return sum / (w * h * 3);
  }, [a, b]);
}

const uri = (f) => `data:image/png;base64,${readFileSync(path.join(DIR, f)).toString("base64")}`;

const deltas = [];
let previous = uri(files[0]);
for (let i = 1; i < files.length; i++) {
  const next = uri(files[i]);
  const d = await meanDelta(previous, next);
  if (d >= 0) deltas.push(d);
  previous = next;
}

const sorted = [...deltas].sort((a, b) => a - b);
const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

console.log(`hearthstone, ${deltas.length} pairs 0.2s apart, 1920x1080`);
console.log(`  median ${at(0.5).toFixed(3)}   min ${sorted[0].toFixed(3)}   p10 ${at(0.1).toFixed(3)}   ` +
  `p90 ${at(0.9).toFixed(3)}   max ${sorted.at(-1).toFixed(3)}`);
console.log(`  ticks below 0.5: ${sorted.filter((d) => d < 0.5).length}   exactly zero: ${sorted.filter((d) => d === 0).length}`);

await browser.close();
