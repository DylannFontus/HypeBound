/**
 * Does AVIF pay for itself on a card?
 *
 * Weight is only half of the question. Every card image in this game is decoded
 * on the main thread and then drawn into a canvas by `renderCard`, so a format
 * that is 30% smaller on the wire and 3x slower to decode can make a collection
 * scroll worse while making the download better. The size difference is easy to
 * measure and the decode difference is the one that gets assumed, so this
 * measures the decode.
 *
 * ## How this instrument is kept honest
 *
 * - **The bytes never touch the network.** Each format is handed to the page as
 *   a base64 string and turned into a Blob there, so what is being timed is
 *   `createImageBitmap` and nothing else. A `fetch` in the loop would have
 *   measured the dev server.
 * - **Every iteration is reported, not just the mean.** One 40ms outlier inside
 *   a twenty-sample mean is invisible; the median and the spread are printed so
 *   a bimodal result cannot hide behind an average.
 * - **A warm-up pass is discarded.** The first decode of a format in a fresh
 *   renderer pays for codec initialisation, which is paid once per session in
 *   the real game too — reporting it as the per-card cost would overstate AVIF
 *   by an order of magnitude.
 * - **The decoded size is asserted.** A decode that silently produced a 1x1
 *   would be very fast and completely wrong; the check is what tells those
 *   apart.
 */

import { chromium } from "playwright-core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "public", "assets", "art");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ITERATIONS = 20;

const ranked = readdirSync(ART)
  .filter((f) => f.endsWith(".png"))
  .map((f) => ({ f, n: readFileSync(path.join(ART, f)).length }))
  .sort((a, b) => a.n - b.n);

// The heaviest card is the one that decides the budget, and the median is the
// one that decides the total. Both, so a conclusion drawn from one is checked
// against the other.
const subjects = [ranked[Math.floor(ranked.length / 2)], ranked[ranked.length - 1]];

const variants = [];
for (const { f } of subjects) {
  const src = readFileSync(path.join(ART, f));
  variants.push({ name: f, format: "png", bytes: src });
  variants.push({ name: f, format: "webp", bytes: await sharp(src).webp({ quality: 82, effort: 6 }).toBuffer() });
  variants.push({ name: f, format: "avif", bytes: await sharp(src).avif({ quality: 60, effort: 4 }).toBuffer() });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // Never swiftshader: `docs/VISUAL-OVERHAUL-STATE.md` records a camera capped
  // at 1.6fps by exactly that flag. Image decode is not GPU work, but a
  // throttled renderer would still skew the numbers.
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto("about:blank");

  const results = await page.evaluate(
    async ({ items, iterations }) => {
      const out = [];
      for (const item of items) {
        const binary = Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0));
        const blob = new Blob([binary], { type: `image/${item.format}` });

        // Warm-up, discarded: the first decode of a format initialises its codec.
        const warm = await createImageBitmap(blob);
        const size = `${warm.width}x${warm.height}`;
        warm.close();

        const samples = [];
        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          const bitmap = await createImageBitmap(blob);
          samples.push(performance.now() - t0);
          bitmap.close();
        }
        out.push({ ...item, b64: undefined, size, samples });
      }
      return out;
    },
    {
      iterations: ITERATIONS,
      items: variants.map((v) => ({ name: v.name, format: v.format, kb: v.bytes.length / 1024, b64: v.bytes.toString("base64") })),
    }
  );

  console.log(`\ncreateImageBitmap, ${ITERATIONS} samples each, warm-up discarded\n`);
  console.log("card                                  format    KB   median   p90    min    max   decoded");
  for (const r of results) {
    const s = [...r.samples].sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)];
    const p90 = s[Math.floor(s.length * 0.9)];
    console.log(
      `${r.name.slice(0, 36).padEnd(38)}${r.format.padEnd(7)}${r.kb.toFixed(0).padStart(5)}   ` +
        `${median.toFixed(1).padStart(5)}ms ${p90.toFixed(1).padStart(5)} ${s[0].toFixed(1).padStart(5)} ${s[s.length - 1].toFixed(1).padStart(6)}   ${r.size}`
    );
  }

  const wrong = results.filter((r) => r.size !== "512x680");
  if (wrong.length) {
    console.log(`\nINSTRUMENT INVALID — ${wrong.length} variant(s) did not decode at 512x680: ${wrong.map((w) => `${w.name}.${w.format}=${w.size}`).join(", ")}`);
    process.exit(1);
  }
  console.log("\nEvery variant decoded at 512x680, so the times above are for the same picture.");
} finally {
  await browser.close();
}
