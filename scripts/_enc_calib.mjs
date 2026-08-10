/**
 * The sweep the card-art encode settings were chosen from.
 *
 * `scripts/encode-assets.mjs` encodes 296 paintings at one quality number, and
 * a number picked by taste is a number nobody can argue with later. So this
 * runs the candidates across five real cards — the smallest file, the two
 * quartiles, the median and the largest, because encoders behave differently on
 * flat art and on dense art — and prints size and error together.
 *
 * Error is RMSE over 0–255 against the source's decoded pixels. It is reported
 * beside the bytes rather than alone because either number on its own is
 * meaningless: 15 KB is only good if it still looks like the painting.
 *
 * AVIF is in the table for one reason: to be ruled in or out with evidence.
 * `scripts/_enc_decode.mjs` is the other half of that decision.
 */
import sharp from "sharp";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ART = "D:/Gooner Card Game/public/assets/art";
const files = readdirSync(ART).filter((f) => f.endsWith(".png"));
// Widest spread: smallest, median, largest — encoders behave differently per content.
const sized = files
  .map((f) => ({ f, n: readFileSync(path.join(ART, f)).length }))
  .sort((a, b) => a.n - b.n);
const sample = [sized[0], sized[Math.floor(sized.length / 4)], sized[Math.floor(sized.length / 2)], sized[Math.floor((sized.length * 3) / 4)], sized[sized.length - 1]];

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

// RMSE over all four channels, plus the worst single-channel delta.
function compare(a, b) {
  if (a.length !== b.length) return { rmse: NaN, max: NaN };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
    if (Math.abs(d) > max) max = Math.abs(d);
  }
  return { rmse: Math.sqrt(sum / a.length), max };
}

const QUALITIES = [78, 82, 86, 90];
console.log("file                                   src KB   " + QUALITIES.map((q) => `q${q} KB/rmse`).join("  ") + "   avif86 KB/rmse/ms");

for (const { f, n } of sample) {
  const src = readFileSync(path.join(ART, f));
  const srcRaw = (await raw(src)).data;
  const meta = await sharp(src).metadata();
  let line = `${f.slice(0, 36).padEnd(38)}${(n / 1024).toFixed(0).padStart(6)}   `;
  for (const q of QUALITIES) {
    const t0 = performance.now();
    const out = await sharp(src).webp({ quality: q, effort: 6, alphaQuality: 100 }).toBuffer();
    const ms = performance.now() - t0;
    const cmp = compare(srcRaw, (await raw(out)).data);
    line += `${(out.length / 1024).toFixed(0).padStart(4)}/${cmp.rmse.toFixed(2)}/${ms.toFixed(0)}ms `;
  }
  const t1 = performance.now();
  const av = await sharp(src).avif({ quality: 60, effort: 4 }).toBuffer();
  const avms = performance.now() - t1;
  const avcmp = compare(srcRaw, (await raw(av)).data);
  line += `   ${(av.length / 1024).toFixed(0).padStart(5)}/${avcmp.rmse.toFixed(2)}/${avms.toFixed(0)}ms`;
  console.log(line, ` [${meta.width}x${meta.height} alpha=${meta.hasAlpha}]`);
}
