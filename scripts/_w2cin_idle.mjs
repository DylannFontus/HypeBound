/** Precise idle-life measurement: full-res-ish pixel deltas between rest frames. */
import { chromium } from "playwright-core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const dir = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
const picked = files.filter((f) => Number(f.split("-t")[1].slice(0, 5)) >= from);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("about:blank");
const payload = picked.map((f) => ({ name: f, b64: readFileSync(path.join(dir, f)).toString("base64") }));
const out = await page.evaluate(async (list) => {
  const res = [];
  let prev = null;
  for (const item of list) {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + item.b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 113;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 200, 113);
    const d = ctx.getImageData(0, 0, 200, 113).data;
    const g = new Float32Array(200 * 113);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) g[k] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (prev) {
      let max = 0;
      let sum = 0;
      let moved = 0;
      for (let k = 0; k < g.length; k++) {
        const dd = Math.abs(g[k] - prev[k]);
        if (dd > max) max = dd;
        sum += dd;
        if (dd > 1.5) moved++;
      }
      res.push({ name: item.name, max: Math.round(max * 10) / 10, mean: Math.round((sum / g.length) * 100) / 100, movedPct: Math.round((100 * moved) / g.length) });
    }
    prev = g;
  }
  return res;
}, payload);
const still = out.filter((r) => r.max < 2).length;
console.log(`${out.length} consecutive pairs from t>=${from}ms in ${path.basename(dir)}`);
console.log(`pairs with max per-pixel luminance delta < 2/255 (visually static): ${still} (${Math.round((100 * still) / out.length)}%)`);
console.log(`mean of per-pair mean delta: ${(out.reduce((a, r) => a + r.mean, 0) / out.length).toFixed(3)}/255`);
console.log(`mean %% of pixels moving more than 1.5/255 per frame: ${(out.reduce((a, r) => a + r.movedPct, 0) / out.length).toFixed(1)}%`);
console.log("sample:", JSON.stringify(out.slice(0, 12)));
await browser.close();
