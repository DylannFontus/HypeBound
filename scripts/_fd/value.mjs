/**
 * The critic's own instrument: whole-frame value statistics for a PNG.
 *
 *   node scripts/_fd/value.mjs <file.png> [bandTop bandBottom]
 *
 * Reports mean/sd of 8-bit luma, the share of 24px blocks that are both dark
 * (<42) and flat (sd<3), luminance percentiles, and the mean/sd of a named band.
 */
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  let palette = null;
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} unsupported`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[p + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < width; x += 1) {
      let r;
      let g;
      let bl;
      if (colour === 3) {
        const idx = line[x] * 3;
        r = palette[idx];
        g = palette[idx + 1];
        bl = palette[idx + 2];
      } else if (channels >= 3) {
        r = line[x * channels];
        g = line[x * channels + 1];
        bl = line[x * channels + 2];
      } else {
        r = g = bl = line[x * channels];
      }
      out[y * width + x] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl);
    }
    prev.set(line);
  }
  return { width, height, luma: out };
}

function stats(values) {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) ** 2;
  return { mean, sd: Math.sqrt(acc / values.length) };
}

const file = process.argv[2];
const { width, height, luma } = decodePng(readFileSync(file));
const whole = stats(luma);

const B = 24;
let blocks = 0;
let dead = 0;
for (let by = 0; by + B <= height; by += B) {
  for (let bx = 0; bx + B <= width; bx += B) {
    const cell = [];
    for (let y = by; y < by + B; y += 1) for (let x = bx; x < bx + B; x += 1) cell.push(luma[y * width + x]);
    const s = stats(cell);
    blocks += 1;
    if (s.mean < 42 && s.sd < 3) dead += 1;
  }
}

const sorted = Uint8Array.from(luma).sort();
const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

const bands = [];
const scale = height / 900;
const named = [
  ["y 80-240", 80, 240],
  ["y 440-720", 440, 720],
  ["y 700-900", 700, 900],
];
for (const [label, a, b] of named) {
  const top = Math.round(a * scale);
  const bottom = Math.min(height, Math.round(b * scale));
  if (top >= bottom) continue;
  const cell = [];
  for (let y = top; y < bottom; y += 1) for (let x = 0; x < width; x += 1) cell.push(luma[y * width + x]);
  bands.push(`${label}: mean ${stats(cell).mean.toFixed(1)} sd ${stats(cell).sd.toFixed(1)}`);
}

console.log(
  `${file.split(/[\\/]/).pop().padEnd(26)} ${width}x${height}  mean ${whole.mean.toFixed(1)} sd ${whole.sd.toFixed(1)}  ` +
    `dead ${dead}/${blocks} = ${((dead / blocks) * 100).toFixed(1)}%  ` +
    `p5 ${pct(0.05)} p50 ${pct(0.5)} p95 ${pct(0.95)} p99 ${pct(0.99)}`
);
console.log(`   ${bands.join("   |   ")}`);
