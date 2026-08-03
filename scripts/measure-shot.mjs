/**
 * Read a screenshot back as numbers.
 *
 * The most damaging notes any critic has written about this project were
 * measurements rather than opinions — "59.9% of the pixels are dark and flat",
 * "+64 luminance in one pixel at y=88" — and a fixer who answers those with an
 * eyeball has not answered them. This prints the same statistics off any PNG the
 * camera wrote, so a change can be checked against the number that failed.
 *
 * The decoding happens in Chrome rather than in a PNG library, and that is
 * deliberate: this repository ships with `playwright-core` and nothing else that
 * can read an image, and installing a decoder to grade a screenshot would be a
 * dependency on the critical path of a review rather than of the game. The
 * browser is already here and already correct about colour.
 *
 *   node scripts/measure-shot.mjs <file.png> [more.png ...]   dead space, sixths, p95
 *   node scripts/measure-shot.mjs <file.png> --row 400        luminance across a row
 *   node scripts/measure-shot.mjs <file.png> --col 800        luminance down a column
 *   node scripts/measure-shot.mjs <file.png> --edges          sharpest single-pixel steps
 */
import { chromium } from "playwright-core";
import { readFileSync, existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const files = argv.filter((a) => a.endsWith(".png"));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const row = flag("row", null);
const col = flag("col", null);
const edges = argv.includes("--edges");

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();

/**
 * Consecutive frames, compared.
 *
 * §3 is half the bar and it is invisible in a single frame: "if consecutive
 * frames are identical, the thing does not animate". This grades a burst the way
 * a critic is asked to read one — what fraction of pixels changed, and by how
 * much — so "the screen is alive at rest" and "reduced motion kills the
 * decorative layer" are both statements with a number behind them.
 */
if (argv.includes("--diff")) {
  const shots = [];
  for (const file of files) shots.push(readFileSync(file).toString("base64"));
  const diffs = await page.evaluate(async (uris) => {
    const read = async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const out = [];
    let previous = await read(uris[0]);
    for (let i = 1; i < uris.length; i++) {
      const current = await read(uris[i]);
      let changed = 0;
      let total = 0;
      let sum = 0;
      let max = 0;
      for (let p = 0; p < current.data.length; p += 16) {
        const d =
          Math.abs(current.data[p] - previous.data[p]) +
          Math.abs(current.data[p + 1] - previous.data[p + 1]) +
          Math.abs(current.data[p + 2] - previous.data[p + 2]);
        total++;
        sum += d / 3;
        if (d / 3 > 6) changed++;
        if (d / 3 > max) max = d / 3;
      }
      out.push({ pct: (changed / total) * 100, mean: sum / total, max });
      previous = current;
    }
    return out;
  }, shots);
  for (const [i, d] of diffs.entries()) {
    console.log(
      `  frame ${i} -> ${i + 1}:  ${d.pct.toFixed(1)}% of pixels changed by >6   mean delta ${d.mean.toFixed(2)}   max ${d.max.toFixed(0)}`
    );
  }
  await browser.close();
  process.exit(0);
}

for (const file of files) {
  const uri = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const stats = await page.evaluate(
    async ({ uri, row, col, edges }) => {
      const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
      const W = bitmap.width;
      const H = bitmap.height;
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, W, H);
      const lum = (x, y) => {
        const i = (y * W + x) * 4;
        return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      };

      const out = { W, H };

      if (row !== null) {
        const y = Number(row);
        const step = Math.max(1, Math.round(W / 80));
        out.row = [];
        for (let x = 0; x < W; x += step) out.row.push([x, Math.round(lum(x, y))]);
      }
      if (col !== null) {
        const x = Number(col);
        const step = Math.max(1, Math.round(H / 60));
        out.col = [];
        for (let y = 0; y < H; y += step) out.col.push([y, Math.round(lum(x, y))]);
      }
      if (edges) {
        const v = [];
        for (let y = 1; y < H; y++) {
          let sum = 0;
          for (let x = 0; x < W; x += 3) sum += Math.abs(lum(x, y) - lum(x, y - 1));
          v.push([y, sum / Math.ceil(W / 3)]);
        }
        const h = [];
        for (let x = 1; x < W; x++) {
          let sum = 0;
          for (let y = 0; y < H; y += 3) sum += Math.abs(lum(x, y) - lum(x - 1, y));
          h.push([x, sum / Math.ceil(H / 3)]);
        }
        const top = (a) => a.sort((p, q) => q[1] - p[1]).slice(0, 6).map(([i, val]) => `${i}:${val.toFixed(1)}`);
        out.hEdges = top(v);
        out.vEdges = top(h);
      }

      // Dead space: 16px blocks that are both dark and flat. The statistic the
      // review used to separate a composed screen from an arranged one.
      const B = 16;
      let dead = 0;
      let blocks = 0;
      const sixth = new Array(6).fill(0);
      const sixthTotal = new Array(6).fill(0);
      for (let by = 0; by + B <= H; by += B) {
        for (let bx = 0; bx + B <= W; bx += B) {
          let sum = 0;
          let sumSq = 0;
          for (let y = by; y < by + B; y++) {
            for (let x = bx; x < bx + B; x++) {
              const l = lum(x, y);
              sum += l;
              sumSq += l * l;
            }
          }
          const n = B * B;
          const mean = sum / n;
          const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
          const isDead = mean < 26 && std < 7;
          blocks++;
          if (isDead) dead++;
          const s = Math.min(5, Math.floor((by / H) * 6));
          sixthTotal[s]++;
          if (isDead) sixth[s]++;
        }
      }
      const all = [];
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) all.push(lum(x, y));
      all.sort((a, b) => a - b);
      out.dead = (dead / blocks) * 100;
      out.mean = all.reduce((a, b) => a + b, 0) / all.length;
      out.p50 = all[Math.floor(all.length * 0.5)];
      out.p95 = all[Math.floor(all.length * 0.95)];
      out.sixths = sixth.map((v, i) => (v / sixthTotal[i]) * 100);
      return out;
    },
    { uri, row, col, edges }
  );

  console.log(`${file}  ${stats.W}x${stats.H}`);
  console.log(
    `  dead ${stats.dead.toFixed(1)}%  mean ${stats.mean.toFixed(1)}  p50 ${stats.p50.toFixed(1)}  p95 ${stats.p95.toFixed(1)}`
  );
  console.log(`  by sixth ${stats.sixths.map((v) => `${v.toFixed(0)}%`).join(" ")}`);
  if (stats.row) console.log(`  row ${row}: ${stats.row.map(([x, l]) => `${x}:${l}`).join(" ")}`);
  if (stats.col) console.log(`  col ${col}: ${stats.col.map(([y, l]) => `${y}:${l}`).join(" ")}`);
  if (stats.hEdges) console.log(`  sharpest horizontal steps y= ${stats.hEdges.join("  ")}`);
  if (stats.vEdges) console.log(`  sharpest vertical steps   x= ${stats.vEdges.join("  ")}`);
}

await browser.close();
