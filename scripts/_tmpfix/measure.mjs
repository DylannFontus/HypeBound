/** Focus-ring + grain measurements on the real page. Decoding happens in the browser. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "lobby";
const selectors = process.argv[3] ? process.argv[3].split(",") : [".lobby-play", ".lobby-nav-btn", ".lobby-currency", ".lobby-card"];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

const ANALYSE = `(dataUri, inset) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const x0 = Math.floor(W * inset), x1 = Math.ceil(W * (1 - inset));
    const y0 = Math.floor(H * inset), y1 = Math.ceil(H * (1 - inset));
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 8) return resolve({ tooSmall: [W, H] });
    const d = ctx.getImageData(x0, y0, w, h).data;
    const luma = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) luma[i] = 0.2126 * d[i*4] + 0.7152 * d[i*4+1] + 0.0722 * d[i*4+2];
    const sigma = 2, r = 6;
    const k = []; let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i*i)/(2*sigma*sigma)); k.push(v); s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float64Array(w * h), lo = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0; for (let i = -r; i <= r; i++) a += k[i+r] * luma[y*w + Math.min(w-1, Math.max(0, x+i))];
      tmp[y*w+x] = a;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0; for (let i = -r; i <= r; i++) a += k[i+r] * tmp[Math.min(h-1, Math.max(0, y+i))*w + x];
      lo[y*w+x] = a;
    }
    const hp = []; let mean = 0;
    for (let i = 0; i < luma.length; i++) { hp.push(Math.abs(luma[i] - lo[i])); mean += luma[i]; }
    mean /= luma.length;
    hp.sort((a, b) => a - b);
    const p95 = hp[Math.floor(hp.length * 0.95)];
    resolve({ size: W + "x" + H, face: +mean.toFixed(1), p95abs: +p95.toFixed(2),
      pct255: +((p95/255)*100).toFixed(2), pctFace: +((p95/mean)*100).toFixed(2) });
  };
  img.src = dataUri;
})`;

const grainOf = async (selector, inset = 0.18) => {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return { selector, missing: true };
  const buf = await el.screenshot();
  const uri = `data:image/png;base64,${buf.toString("base64")}`;
  const out = await page.evaluate(
    ([fn, u, i]) => new Function("return " + fn)()(u, i),
    [ANALYSE, uri, inset]
  );
  return { selector, ...out };
};

try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.addStyleTag({ content: `*,*::before,*::after{animation-play-state:paused !important;animation-delay:-3000ms !important}` });
  await page.waitForTimeout(700);

  console.log("--- grain ---");
  for (const sel of selectors) console.log(JSON.stringify(await grainOf(sel)));

  if (route === "lobby") {
    console.log("--- focus ring ---");
    const ring = await page.evaluate(() => {
      document.documentElement.setAttribute("data-keyboard-nav", "true");
      const btn = document.querySelector("#lobby-play");
      btn.focus();
      const cs = getComputedStyle(btn);
      const after = getComputedStyle(btn, "::after");
      return {
        outline: `${cs.outlineColor} ${cs.outlineStyle} ${cs.outlineWidth}`,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
        afterContent: after.content,
        afterBoxShadow: after.boxShadow,
        focusHalo: getComputedStyle(document.documentElement).getPropertyValue("--focus-halo"),
        focusBloom: getComputedStyle(document.documentElement).getPropertyValue("--focus-bloom"),
      };
    });
    console.log(JSON.stringify(ring, null, 1));
  }
} finally {
  await browser.close();
}
