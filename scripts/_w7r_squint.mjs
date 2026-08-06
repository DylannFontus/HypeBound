/**
 * The squint test, as a number.
 *
 * AAA bar §6: "Squint at the screen: it should resolve into clear light and dark
 * masses. If everything is mid-purple, nothing reads." That is the most useful
 * sentence in the document and the least checkable — every reviewer squints
 * differently, and "it's all mid-purple" is exactly the kind of judgement that
 * two people can disagree about forever.
 *
 * Squinting is a low-pass filter. So: downsample the frame to a 24×14 grid of
 * mean luminance — each cell is roughly a 67px block at 1600×900, which is about
 * what a squint leaves — and describe the distribution that comes out.
 *
 *   spread   the standard deviation of cell luminance, 0–255. A screen that is
 *            one value everywhere reads 0. This is the headline number.
 *   range    p95 − p05, which is what the *masses* are, ignoring a single bright
 *            button and a single black corner.
 *   split    what fraction of the frame is darker than the midpoint between the
 *            5th and 95th percentiles. Near 0.5 means two masses of comparable
 *            size; near 0 or 1 means one mass and a detail.
 *
 * Luminance is Rec. 709 on sRGB values without linearising, deliberately: the
 * eye's response to a screen is closer to the encoded value than to the linear
 * one, and every reference in this project is judged by eye.
 *
 * ## Validating it
 *
 * `--selftest` renders three known frames and checks the readings against values
 * derived rather than observed:
 *
 *   - a flat fill must read **spread 0.000**. Anything else is the sampler
 *     inventing structure, which is the whole class of failure this project has
 *     been bitten by eight times.
 *   - a half-black half-white split must read **spread 127.5** and **split
 *     0.50** — the standard deviation of a two-point distribution at 0 and 255
 *     with equal weights is exactly half the gap.
 *   - a left-to-right linear ramp 0→255 must read **spread ≈ 73.6**, which is
 *     255/√12, the standard deviation of a uniform distribution.
 *
 * The third one is the interesting control, because a sampler that quantised or
 * clipped would pass the first two and fail it.
 *
 * usage:
 *   node scripts/_w7r_squint.mjs --selftest
 *   node scripts/_w7r_squint.mjs scripts/screenshots/w7/rooms/stats-a.png ...
 */

import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const COLS = 24;
const ROWS = 14;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("data:text/html,<title>squint</title>");

async function squint(dataUri) {
  return page.evaluate(
    async ([src, cols, rows]) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      /**
       * One `drawImage` down to cols×rows does the box filter in the browser's
       * own resampler, which is the same low-pass a squint is. Doing it by hand
       * in JS would be the same arithmetic and one more place to be wrong.
       */
      const c = document.createElement("canvas");
      c.width = cols;
      c.height = rows;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, cols, rows);
      const d = ctx.getImageData(0, 0, cols, rows).data;
      const lum = [];
      for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      return lum;
    },
    [dataUri, COLS, ROWS]
  );
}

function describe(lum) {
  const n = lum.length;
  const mean = lum.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sorted = [...lum].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const lo = at(0.05);
  const hi = at(0.95);
  const mid = (lo + hi) / 2;
  const split = lum.filter((v) => v < mid).length / n;
  return { mean, spread, range: hi - lo, split, lo, hi };
}

async function report(label, dataUri) {
  const r = describe(await squint(dataUri));
  console.log(
    `${label.padEnd(34)} spread ${r.spread.toFixed(2).padStart(6)}   ` +
      `range ${r.range.toFixed(1).padStart(5)} (${r.lo.toFixed(0)}→${r.hi.toFixed(0)})   ` +
      `dark mass ${(r.split * 100).toFixed(0).padStart(2)}%   mean L ${r.mean.toFixed(1)}`
  );
  return r;
}

const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

if (process.argv.includes("--selftest")) {
  const svg = (inner) =>
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">${inner}</svg>`
    ).toString("base64");

  const flat = await report("control: flat #6a5a8a", svg('<rect width="1600" height="900" fill="#6a5a8a"/>'));
  const half = await report(
    "control: half black / half white",
    svg('<rect width="800" height="900" fill="#000"/><rect x="800" width="800" height="900" fill="#fff"/>')
  );
  const ramp = await report(
    "control: linear ramp 0->255",
    svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>' +
        '<rect width="1600" height="900" fill="url(#g)"/>'
    )
  );

  const verdicts = [
    /**
     * `< 1e-6` rather than `=== 0`. The first run of this control failed on a
     * flat fill whose spread was 2.8e-14 — every cell resolved to the same byte
     * and the variance was pure float error in the sum of squares. A tolerance
     * six orders of magnitude below one quantisation step cannot hide structure
     * and does not fail on arithmetic.
     */
    [flat.spread < 1e-6, `a flat fill reads spread ${flat.spread.toExponential(1)}, expected 0 to float error`],
    [
      Math.abs(half.spread - 127.5) < 1.5 && Math.abs(half.split - 0.5) < 0.02,
      `a 50/50 black-white split reads spread ${half.spread.toFixed(2)} / dark ${(half.split * 100).toFixed(
        0
      )}%, expected 127.5 / 50%`,
    ],
    [
      Math.abs(ramp.spread - 255 / Math.sqrt(12)) < 3,
      `a linear ramp reads spread ${ramp.spread.toFixed(2)}, expected 255/sqrt(12) = ${(255 / Math.sqrt(12)).toFixed(2)}`,
    ],
  ];
  console.log("");
  for (const [ok, why] of verdicts) console.log(`  ${ok ? "PASS" : "FAIL"}  ${why}`);
  console.log("");
  await browser.close();
  process.exit(verdicts.every(([ok]) => ok) ? 0 : 1);
}

for (const file of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  await report(path.basename(file, ".png"), uri(file));
}

await browser.close();
