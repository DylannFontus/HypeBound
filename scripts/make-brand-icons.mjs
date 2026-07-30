/**
 * Every favicon, from the one master.
 *
 * `public/assets/brand/hb-mark-master.png` is 2048x2048 and just under a
 * megabyte. Pointing a `<link rel="icon">` at it would make every page load
 * fetch a megabyte to draw sixteen pixels, so the small sizes are generated —
 * and generated *from the master* rather than requested separately, because six
 * independent generations of "the same logo" are six slightly different logos.
 *
 * ## Why the browser does the resizing
 *
 * No image library. `sharp` or `jimp` would be a new dependency, and
 * `tests/fairness.test.ts` checks the attribution list against the manifest, so
 * a package added for a one-off build step becomes a line on the legal page
 * forever. Chrome is already a dev dependency here for the verify scripts and
 * its canvas downscaler is good, so it does the work and writes nothing to the
 * project.
 *
 * ## The .ico is assembled by hand
 *
 * An `.ico` is a trivial container: a six-byte header, a sixteen-byte directory
 * entry per image, then the images. Since Vista those images may be PNGs, so
 * the file is three of the PNGs we just made with 54 bytes of index in front.
 * That is less code than taking on a dependency to do it, and the `.exe` icon
 * comes from the same file when the desktop build happens.
 *
 *   node scripts/make-brand-icons.mjs
 */

import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(ROOT, "public", "assets", "brand", "hb-mark-master.png");
const PUBLIC = path.join(ROOT, "public");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

/** The sizes, and what each is for. */
const OUTPUTS = [
  { size: 16, file: "favicon-16.png", why: "browser tab" },
  { size: 32, file: "favicon-32.png", why: "browser tab, retina" },
  { size: 48, file: "favicon-48.png", why: "the .ico, and Windows" },
  { size: 180, file: "apple-touch-icon.png", why: "iOS home screen" },
  { size: 192, file: "icon-192.png", why: "Android and PWA" },
  { size: 512, file: "icon-512.png", why: "PWA splash" },
];

/** These three go inside favicon.ico. */
const ICO_SIZES = [16, 32, 48];

if (!existsSync(MASTER)) {
  console.error(`\nNo master at ${path.relative(ROOT, MASTER)}.\nGenerate it first — see docs/ASSET-BRIEF.md §1.1.\n`);
  process.exit(1);
}

const master = readFileSync(MASTER);
console.log(`\nHYPEBOUND brand icons — from a ${master.readUInt32BE(16)}x${master.readUInt32BE(20)} master\n`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();

const encoded = await page.evaluate(
  async ([dataUrl, sizes]) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("the master did not decode"));
      image.src = dataUrl;
    });

    const out = {};
    for (const size of sizes) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      /**
       * `high` matters at these ratios. 2048 to 16 is a 128x reduction, and the
       * default sampler aliases badly enough that the monogram's counters fill
       * in — which is precisely the failure the mark was designed to avoid.
       */
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, size, size);
      out[size] = canvas.toDataURL("image/png");
    }
    return out;
  },
  [`data:image/png;base64,${master.toString("base64")}`, OUTPUTS.map((o) => o.size)]
);

await browser.close();

const pngFor = (size) => Buffer.from(encoded[size].split(",")[1], "base64");

for (const { size, file, why } of OUTPUTS) {
  const bytes = pngFor(size);
  writeFileSync(path.join(PUBLIC, file), bytes);
  console.log(`   ${file.padEnd(22)} ${String(size).padStart(4)}px  ${String(bytes.length).padStart(7)} bytes   ${why}`);
}

// ---------------------------------------------------------------------------
// favicon.ico
// ---------------------------------------------------------------------------

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, bytes }, index) => {
    const at = index * 16;
    // 0 means 256 in this field; none of our sizes hit that, but the encoding
    // is worth respecting rather than assuming.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size, 0 for truecolour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(bytes.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.bytes)]);
}

const ico = buildIco(ICO_SIZES.map((size) => ({ size, bytes: pngFor(size) })));
writeFileSync(path.join(PUBLIC, "favicon.ico"), ico);
console.log(`   ${"favicon.ico".padEnd(22)} ${ICO_SIZES.join("/")}px  ${String(ico.length).padStart(7)} bytes   legacy, and the .exe icon later`);

console.log("\nDone. Re-run this whenever the master changes.\n");
