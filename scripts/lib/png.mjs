/**
 * A PNG decoder, because the measurement has to be lossless and the repo has no
 * image dependency.
 *
 * This exists for one reason: **JPEG cannot be used to decide whether a surface
 * is moving.** Its own quantisation noise sits at roughly 0.3 mean absolute
 * delta between two identical frames, which is half of Hearthstone's idle floor
 * — so a screencast recorded as JPEG will report a frozen curtain as "alive"
 * and a 3%-white crawl as indistinguishable from a real one. That mistake is
 * already in this project's history twice.
 *
 * Chrome's `Page.screencastFrame` emits non-interlaced 8-bit PNGs, colour type
 * 2 (RGB) or 6 (RGBA), which is the whole surface this needs to cover. Anything
 * else throws rather than guessing, because a decoder that silently returns the
 * wrong pixels is the eighth lying instrument.
 */
import { inflateSync } from "node:zlib";

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** @returns {{ width: number, height: number, channels: number, data: Uint8Array }} */
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (colour !== 2 && colour !== 6) throw new Error(`unsupported colour type ${colour}`);
      if (body[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[src + x];
      const left = x >= channels ? out[row + x - channels] : 0;
      const up = y > 0 ? out[prior + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[prior + x - channels] : 0;
      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      out[row + x] = restored & 0xff;
    }
    src += stride;
  }
  return { width, height, channels, data: out };
}

/** Rec.709 luminance, one float per pixel. */
export function luminance(image) {
  const { width, height, channels, data } = image;
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i += 1, p += channels) {
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return lum;
}
