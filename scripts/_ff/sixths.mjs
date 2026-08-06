/**
 * Emptiness by vertical sixth — the recon's own measure, so a claim about the
 * composition can be checked against the number it was written from.
 *
 *   node scripts/_ff/sixths.mjs <file.png> [more.png ...]
 *
 * A 24px block counts as empty when it is both dark (mean < 42) and flat
 * (sd < 3), which is `scripts/_fd/value.mjs`'s definition, applied per band.
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

const B = 24;
for (const file of process.argv.slice(2)) {
  const { width, height, luma } = decodePng(readFileSync(file));
  const bands = [];
  for (let s = 0; s < 6; s += 1) {
    const y0 = Math.round((s * height) / 6);
    const y1 = Math.round(((s + 1) * height) / 6);
    let blocks = 0;
    let dead = 0;
    for (let by = y0; by + B <= y1; by += B) {
      for (let bx = 0; bx + B <= width; bx += B) {
        let sum = 0;
        const cell = [];
        for (let y = by; y < by + B; y += 1)
          for (let x = bx; x < bx + B; x += 1) {
            const v = luma[y * width + x];
            cell.push(v);
            sum += v;
          }
        const mean = sum / cell.length;
        let acc = 0;
        for (const v of cell) acc += (v - mean) ** 2;
        const sd = Math.sqrt(acc / cell.length);
        blocks += 1;
        if (mean < 42 && sd < 3) dead += 1;
      }
    }
    bands.push(blocks === 0 ? "--" : String(Math.round((100 * dead) / blocks)));
  }
  console.log(`${file.split(/[\\/]/).pop().padEnd(26)} empty by sixth: ${bands.join("/")}`);
}
