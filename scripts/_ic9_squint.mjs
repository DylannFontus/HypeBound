/**
 * How much of a frame is nothing — measured in a way a grain overlay cannot buy
 * its way out of.
 *
 * Instrument ten in this project's list was an emptiness metric fooled by a 50%
 * grain overlay: it counted "pixels close to the background colour", and a noise
 * field scattered every one of those pixels a couple of levels away from the
 * background and the screen came back full. So this does not look at pixels at
 * all. It looks at **16x16 blocks**, and within each block it takes the
 * difference between the 90th and 10th percentile luminance — a robust range
 * that a ±2-level noise field moves by about two levels and a real edge, panel
 * or piece of type moves by twenty.
 *
 * Two numbers come out:
 *
 *   VOID%      blocks whose robust range is under 6 L — mathematically smooth
 *              once the grain is discounted. §1: "Perfectly clean gradients read
 *              as CSS."
 *   STRUCTURE% blocks whose range is over 25 L — an edge, a plate, a glyph,
 *              something the eye can land on.
 *
 * Both are meaningless alone and useful side by side with the same figures for
 * `hearthstone_frames/`, which is why every run prints the reference first. A
 * dark screen is not automatically a bad screen; Hearthstone's own frames are
 * dark at the borders. What a bad screen looks like is a very high VOID against
 * a very low STRUCTURE.
 *
 *   node scripts/_ic9_squint.mjs <png...>
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { decodePng } from "./lib/png.mjs";

const BLOCK = 16;
function squint(img) {
  const cols = Math.floor(img.width / BLOCK);
  const rows = Math.floor(img.height / BLOCK);
  let void_ = 0;
  let structure = 0;
  const lum = new Float32Array(BLOCK * BLOCK);
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      let k = 0;
      for (let y = 0; y < BLOCK; y += 1) {
        const row = (by * BLOCK + y) * img.width;
        for (let x = 0; x < BLOCK; x += 1) {
          const i = (row + bx * BLOCK + x) * img.channels;
          lum[k++] = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
        }
      }
      const s = Array.prototype.slice.call(lum).sort((a, b) => a - b);
      const range = s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)];
      if (range < 6) void_ += 1;
      else if (range > 25) structure += 1;
    }
  }
  const n = cols * rows;
  return { n, void: (void_ / n) * 100, structure: (structure / n) * 100 };
}

const refDir = path.join(process.cwd(), "hearthstone_frames");
if (existsSync(refDir)) {
  const files = readdirSync(refDir).filter((f) => f.endsWith(".png"));
  const picks = [files[0], files[Math.floor(files.length / 3)], files[60], files.at(-1)].filter(Boolean);
  for (const f of picks) {
    const s = squint(decodePng(readFileSync(path.join(refDir, f))));
    console.log(`REFERENCE  ${f.padEnd(40)} void ${s.void.toFixed(1).padStart(5)}%   structure ${s.structure.toFixed(1).padStart(5)}%`);
  }
  console.log("");
}

for (const file of process.argv.slice(2)) {
  const s = squint(decodePng(readFileSync(file)));
  console.log(`${path.basename(file).padEnd(50)} void ${s.void.toFixed(1).padStart(5)}%   structure ${s.structure.toFixed(1).padStart(5)}%`);
}
