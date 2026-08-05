/**
 * What "alive" actually measures, taken from the reference rather than remembered.
 *
 * The state document quotes an idle Hearthstone floor of 0.6-1.3 mean delta per
 * 200ms. That number is only usable if this critic's own delta is computed the
 * same way on the same kind of pixels, so this recomputes it from
 * `hearthstone_frames/` with the very decoder the journey film uses. If the two
 * halves of a comparison are measured by different code, the comparison is a
 * seventh lying instrument rather than a calibration.
 *
 *   node scripts/_ic6_calib.mjs [--scale 2]
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "hearthstone_frames");

const files = readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();

/** Mean absolute per-channel delta between two decoded frames of equal size. */
function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  const step = a.channels; // sample every pixel, all colour channels
  for (let i = 0; i < n; i += step) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

const deltas = [];
let prev = null;
for (let i = 0; i < files.length; i += 1) {
  const img = decodePng(readFileSync(path.join(DIR, files[i])));
  if (prev) deltas.push({ i, d: meanDelta(prev, img), file: files[i] });
  prev = img;
}

const values = deltas.map((d) => d.d).sort((x, y) => x - y);
const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
console.log(`frames: ${files.length}   pairs: ${deltas.length}   (0.2s apart, 1920x1080)`);
console.log(
  `mean=${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)}  ` +
    `min=${q(0).toFixed(3)}  p10=${q(0.1).toFixed(3)}  median=${q(0.5).toFixed(3)}  ` +
    `p90=${q(0.9).toFixed(3)}  max=${q(0.999).toFixed(3)}`
);
console.log(`pairs under 0.30 (would read as "identical"): ${values.filter((v) => v < 0.3).length}`);
console.log(`pairs under 0.05 (truly frozen): ${values.filter((v) => v < 0.05).length}`);
