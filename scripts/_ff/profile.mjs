/**
 * A row or column of luma out of a PNG, so a "seam" can be a number.
 *
 *   node scripts/_ff/profile.mjs <file.png> row <y> <x0> <x1> [step]
 *   node scripts/_ff/profile.mjs <file.png> col <x> <y0> <y1> [step]
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

const [file, mode, at, from, to, stepRaw] = process.argv.slice(2);
const step = Number(stepRaw ?? 1);
const { width, height, luma } = decodePng(readFileSync(file));
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const cells = [];
if (mode === "row") {
  const y = Number(at);
  for (let x = Number(from); x <= Number(to); x += step) {
    const band = [];
    for (let dy = -3; dy <= 3; dy += 1) band.push(luma[Math.min(height - 1, Math.max(0, y + dy)) * width + x]);
    cells.push([x, avg(band)]);
  }
} else {
  const x = Number(at);
  for (let y = Number(from); y <= Number(to); y += step) {
    const band = [];
    for (let dx = -3; dx <= 3; dx += 1) band.push(luma[y * width + Math.min(width - 1, Math.max(0, x + dx))]);
    cells.push([y, avg(band)]);
  }
}
let worst = [0, 0];
for (let i = 1; i < cells.length; i += 1) {
  const d = Math.abs(cells[i][1] - cells[i - 1][1]);
  if (d > worst[1]) worst = [cells[i][0], d];
}
console.log(cells.map(([k, v]) => `${k}:${v.toFixed(1)}`).join("  "));
console.log(`steepest step ${worst[1].toFixed(1)} luma at ${mode === "row" ? "x" : "y"}=${worst[0]} (per ${step}px)`);
