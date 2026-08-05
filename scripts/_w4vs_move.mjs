/**
 * How much is moving in a reel of frames, frame to frame.
 *
 * `_w3nav_curtain.mjs` answers the same question for a live navigation, which
 * on this machine gives you a dozen frames of curtain and no hold at all. This
 * one reads a directory that `_w4vs_film.mjs` has already written, so the hold
 * can be filmed once through an artificial stall and then measured as many times
 * as the tuning takes.
 *
 * The calibration the brief gives: Hearthstone's own idle floor is a mean
 * per-pair delta of 0.6-1.3 of 255 with nothing happening; this game's menu veil
 * manages 3.6% of pixels moving; the battle veil before the billing existed
 * managed 0.3% and a mean delta of 0.018, which is the number the versus card
 * exists to beat.
 *
 *   node scripts/_w4vs_move.mjs scripts/screenshots/w4/vs 900 3000
 */
import { chromium } from "playwright-core";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const dir = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 1e9);

const files = readdirSync(dir)
  .filter((f) => /^t\d+\.jpg$/.test(f))
  .map((f) => ({ f, t: Number(f.slice(1, -4)) }))
  .filter((e) => e.t >= from && e.t <= to)
  .sort((a, b) => a.t - b.t);

if (files.length < 2) {
  console.log(`only ${files.length} frame(s) in ${from}..${to}ms — nothing to compare`);
  process.exit(0);
}

const b64 = (p) => `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();

const pairs = [];
for (let i = 1; i < files.length; i += 1) {
  const stat = await page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ia.width;
      const h = ia.height;
      const grab = (img) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const da = grab(ia);
      const db = grab(ib);
      let sum = 0;
      let moved = 0;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2])
        );
        sum += d;
        // 3/255 is comfortably above JPEG's own noise floor at quality 90.
        if (d > 3) moved += 1;
        n += 1;
      }
      return { mean: sum / n, moved: (100 * moved) / n };
    },
    [b64(path.join(dir, files[i - 1].f)), b64(path.join(dir, files[i].f))]
  );
  pairs.push({ t: files[i].t, ...stat });
}
await browser.close();

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${pairs.length} pairs over ${files[0].t}..${files[files.length - 1].t}ms`);
console.log(`mean per-pair delta   ${mean(pairs.map((p) => p.mean)).toFixed(3)} / 255`);
console.log(`mean pixels moving    ${mean(pairs.map((p) => p.moved)).toFixed(2)}%`);
console.log(`quietest pair         ${Math.min(...pairs.map((p) => p.moved)).toFixed(2)}% moving`);
console.log(`identical pairs       ${pairs.filter((p) => p.mean < 0.02).length}`);
