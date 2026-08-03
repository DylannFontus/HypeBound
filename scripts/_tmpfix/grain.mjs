/** High-pass grain amplitude on chosen FLAT patches of real plates. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

/** selector, then x0,y0,x1,y1 as fractions of the element box. */
const PATCHES = [
  ["lobby", ".lobby-play", 0.02, 0.15, 0.18, 0.85, "hero left"],
  ["lobby", ".lobby-play", 0.82, 0.15, 0.98, 0.85, "hero right"],
  ["lobby", ".lobby-nav-btn", 0.04, 0.06, 0.42, 0.34, "panel tile top-left"],
  ["lobby", ".lobby-currency", 0.05, 0.15, 0.35, 0.85, "chip"],
  ["lobby", ".lobby-card", 0.55, 0.05, 0.97, 0.28, "rail panel"],
  ["lobby", ".lobby-xp", 0.5, 0.2, 0.95, 0.8, "well"],
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const ANALYSE = `(u) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    if (w < 8 || h < 8) return resolve({ tooSmall: [w, h] });
    const d = ctx.getImageData(0, 0, w, h).data;
    const luma = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) luma[i] = 0.2126*d[i*4] + 0.7152*d[i*4+1] + 0.0722*d[i*4+2];
    const sigma = 2, r = 6, k = []; let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i*i)/(2*sigma*sigma)); k.push(v); s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float64Array(w*h), lo = new Float64Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let a=0; for(let i=-r;i<=r;i++) a+=k[i+r]*luma[y*w+Math.min(w-1,Math.max(0,x+i))]; tmp[y*w+x]=a; }
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let a=0; for(let i=-r;i<=r;i++) a+=k[i+r]*tmp[Math.min(h-1,Math.max(0,y+i))*w+x]; lo[y*w+x]=a; }
    const hp = []; let mean = 0;
    for (let i=0;i<luma.length;i++){ hp.push(Math.abs(luma[i]-lo[i])); mean += luma[i]; }
    mean /= luma.length;
    hp.sort((a,b)=>a-b);
    const q = (p) => hp[Math.floor(hp.length*p)];
    resolve({ px: w + "x" + h, face: +mean.toFixed(1), p95: +q(0.95).toFixed(2),
      pct255: +((q(0.95)/255)*100).toFixed(2), pctFace: +((q(0.95)/mean)*100).toFixed(2) });
  };
  img.src = u;
})`;

try {
  await seedPlayedAccount(page, ORIGIN);
  let current = null;
  for (const [route, sel, fx0, fy0, fx1, fy1, name] of PATCHES) {
    if (route !== current) {
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
      await page.addStyleTag({ content: `*,*::before,*::after{animation-play-state:paused !important;animation-delay:-3000ms !important}` });
      await page.waitForTimeout(700);
      current = route;
    }
    const el = page.locator(sel).first();
    if ((await el.count()) === 0) { console.log(name, "MISSING", sel); continue; }
    const box = await el.boundingBox();
    const clip = {
      x: Math.round(box.x + box.width * fx0),
      y: Math.round(box.y + box.height * fy0),
      width: Math.max(8, Math.round(box.width * (fx1 - fx0))),
      height: Math.max(8, Math.round(box.height * (fy1 - fy0))),
    };
    const buf = await page.screenshot({ clip });
    const uri = `data:image/png;base64,${buf.toString("base64")}`;
    const out = await page.evaluate(([fn, u]) => new Function("return " + fn)()(u), [ANALYSE, uri]);
    console.log(name.padEnd(20), JSON.stringify(out));
  }
} finally {
  await browser.close();
}
