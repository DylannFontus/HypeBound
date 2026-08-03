/**
 * Does every visible card actually move, and does the setting that says stop
 * actually stop it?
 *
 * The review that preceded this measured 8 of 12 sampled collection canvases
 * changing and the other 4 at exactly 0.000 — a grid that reads as partly broken
 * rather than alive — and then measured two frames 2.1 seconds apart as
 * indistinguishable by eye anyway. Both are questions about pixels over time, so
 * both get answered by snapshotting every card canvas on the screen, waiting,
 * and snapshotting again.
 *
 *   node scripts/measure-cardmotion.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/#collection", { waitUntil: "networkidle" });
await page.waitForSelector(".card-cell canvas", { timeout: 45000 });
await page.waitForTimeout(2500);

const sampler = () => {
  const canvases = [...document.querySelectorAll("canvas")].filter((c) => {
    const box = c.getBoundingClientRect();
    return box.width > 60 && box.top < innerHeight && box.bottom > 0;
  });
  return canvases.map((c) => {
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const w = Math.min(c.width, 120);
    const h = Math.min(c.height, 160);
    return [...ctx.getImageData(0, 0, w, h).data];
  });
};

const compare = ([a, b]) => {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || x.length !== y.length) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let max = 0;
    for (let k = 0; k < x.length; k += 4) {
      const d = Math.max(Math.abs(x[k] - y[k]), Math.abs(x[k + 1] - y[k + 1]), Math.abs(x[k + 2] - y[k + 2]));
      sum += d;
      if (d > max) max = d;
    }
    out.push({ mean: +(sum / (x.length / 4)).toFixed(3), max });
  }
  return out;
};

const run = async (label) => {
  const first = await page.evaluate(sampler);
  await page.waitForTimeout(1400);
  const second = await page.evaluate(sampler);
  const deltas = compare([first, second]).filter(Boolean);
  const moved = deltas.filter((d) => d.mean > 0.05);
  return {
    label,
    canvases: deltas.length,
    moved: moved.length,
    dead: deltas.length - moved.length,
    meanOfMoved: +(moved.reduce((s, d) => s + d.mean, 0) / Math.max(1, moved.length)).toFixed(3),
    maxSeen: Math.max(0, ...deltas.map((d) => d.max)),
  };
};

const normal = await run("motion on");

await page.evaluate(async () => {
  const settings = await import("/src/save/settings.ts");
  settings.updateSettings({ reducedMotion: true });
});
await page.waitForTimeout(900);
const reduced = await run("reduced motion");

// frame time while the grid is alive
await page.evaluate(async () => {
  const settings = await import("/src/save/settings.ts");
  settings.updateSettings({ reducedMotion: false });
});
await page.waitForTimeout(600);
const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (times.length < 180) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          resolve({
            median: +times[Math.floor(times.length / 2)].toFixed(1),
            p95: +times[Math.floor(times.length * 0.95)].toFixed(1),
            worst: +times[times.length - 1].toFixed(1),
          });
        }
      };
      requestAnimationFrame(tick);
    })
);

console.log(JSON.stringify({ normal, reduced, frames }, null, 2));
if (errors.length) console.log("page errors:", errors.slice(0, 4));
await browser.close();
