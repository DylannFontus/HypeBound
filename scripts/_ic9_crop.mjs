/**
 * Cut a window out of a capture and blow it up, so a critic can look at a
 * contact shadow instead of asserting one exists.
 *
 * Every claim in this review that turns on a detail smaller than about forty
 * pixels — a contact shadow, a rim highlight, a hairline's end-fade, the join
 * between two planes — is unreadable in a 1280x720 frame viewed whole. Reading
 * the full frame and *saying* the shadow is there is how a review passes work it
 * has not seen. So: nearest-neighbour zoom, which is the only resampling that
 * cannot invent an edge, plus a printed luminance profile down the column so the
 * eye's answer and the arithmetic's answer can disagree out loud.
 *
 *   node scripts/_ic9_crop.mjs <png> <x> <y> <w> <h> [zoom] [--profile]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { decodePng } from "./lib/png.mjs";

/** Minimal colour-type-2 PNG writer. `lib/png.mjs` only decodes. */
function encodePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb) >>> 0);
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const [file, xs, ys, ws, hs, zs, ...rest] = process.argv.slice(2);
const x = Number(xs);
const y = Number(ys);
const w = Number(ws);
const h = Number(hs);
const zoom = Number(zs || 3);
const img = decodePng(readFileSync(file));
const out = new Uint8Array(w * zoom * h * zoom * 3);
for (let oy = 0; oy < h * zoom; oy += 1) {
  for (let ox = 0; ox < w * zoom; ox += 1) {
    const sx = Math.min(img.width - 1, x + Math.floor(ox / zoom));
    const sy = Math.min(img.height - 1, y + Math.floor(oy / zoom));
    const s = (sy * img.width + sx) * img.channels;
    const d = (oy * w * zoom + ox) * 3;
    out[d] = img.data[s];
    out[d + 1] = img.data[s + 1];
    out[d + 2] = img.data[s + 2];
  }
}
const dest = path.join(path.dirname(file), `crop-${path.basename(file, ".png")}-${x}_${y}.png`);
writeFileSync(dest, encodePng({ width: w * zoom, height: h * zoom, channels: 3, data: out }));
console.log(dest);

if (rest.includes("--profile")) {
  // Mean luminance per row across the window: a contact shadow is a dip.
  for (let ry = 0; ry < h; ry += 1) {
    let sum = 0;
    for (let rx = 0; rx < w; rx += 1) {
      const s = ((y + ry) * img.width + (x + rx)) * img.channels;
      sum += 0.2126 * img.data[s] + 0.7152 * img.data[s + 1] + 0.0722 * img.data[s + 2];
    }
    const L = sum / w;
    console.log(`y=${String(y + ry).padStart(4)}  L=${L.toFixed(1).padStart(5)}  ${"#".repeat(Math.round(L))}`);
  }
}
