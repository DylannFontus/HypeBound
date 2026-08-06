/**
 * Cut a region out of a capture so it can be *looked at* rather than squinted at.
 *
 * A 1600x900 PNG shown at reading size is roughly a quarter of its real
 * resolution, and every judgement about a lip, a bevel or a contact shadow is a
 * judgement about ten or twenty pixels. This crops and nearest-neighbour zooms,
 * so what is on screen is what is in the file and not an interpolation of it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodePng } from "./lib/png.mjs";
import { deflateSync } from "node:zlib";

const [file, box, out, zoomArg] = process.argv.slice(2);
const [cx, cy, cw, ch] = box.split(",").map(Number);
const zoom = Number(zoomArg ?? 2);
const src = decodePng(readFileSync(path.resolve(file)));
const w = cw * zoom;
const h = ch * zoom;

/** Minimal RGBA PNG writer — one IDAT, filter 0 on every row. */
const raw = Buffer.alloc((w * 4 + 1) * h);
for (let y = 0; y < h; y += 1) {
  raw[y * (w * 4 + 1)] = 0;
  for (let x = 0; x < w; x += 1) {
    const sx = Math.min(src.width - 1, cx + Math.floor(x / zoom));
    const sy = Math.min(src.height - 1, cy + Math.floor(y / zoom));
    const p = (sy * src.width + sx) * src.channels;
    const q = y * (w * 4 + 1) + 1 + x * 4;
    raw[q] = src.data[p];
    raw[q + 1] = src.data[p + 1];
    raw[q + 2] = src.data[p + 2];
    raw[q + 3] = src.channels === 4 ? src.data[p + 3] : 255;
  }
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  path.resolve(out),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
);
console.log(path.resolve(out));
