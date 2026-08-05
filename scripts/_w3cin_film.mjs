/**
 * Film one leg and say, frame by frame, what was on the glass and what was
 * animating — the two things `never-a-blank-frame` reports separately and never
 * side by side, which is why a dark frame in the middle of an exchange cannot
 * be attributed from its output alone.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const [spec, outDir = "scripts/screenshots/w3/cine/film", sizeArg = "1600x900"] = process.argv.slice(2);
const [from, to] = spec.split(">");
const [W, H] = sizeArg.split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: BROWSERS.find((p) => existsSync(p)),
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await seedPlayedAccount(page);
await page.goto(`${ORIGIN}/#${from}`, { waitUntil: "networkidle" });
await page.waitForFunction(
  (n) => {
    const s = document.querySelectorAll(".screen");
    return s.length === 1 && s[0].dataset.nav === "settled" && s[0].classList.contains(n);
  },
  `${from}-screen`,
  { timeout: 40000 }
);
await page.waitForTimeout(400);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
});
await page.evaluate(() => {
  const scope = window;
  scope.__ev = [];
  scope.__t0 = performance.now();
  for (const type of ["animationstart", "animationend"]) {
    document.addEventListener(
      type,
      (e) => {
        if (!e.animationName.startsWith("nav-")) return;
        scope.__ev.push({ t: Math.round(performance.now() - scope.__t0), type, name: e.animationName });
      },
      true
    );
  }
});
await session.send("Page.startScreencast", { format: "png", maxWidth: 960, maxHeight: 540 });
await page.evaluate((h) => {
  location.hash = h;
}, `#${to}`);
await page.waitForTimeout(2600);
await session.send("Page.stopScreencast");

const base = shots.length ? shots[0].t : 0;
const stats = await page.evaluate(async (list) => {
  const out = [];
  for (const shot of list) {
    const image = new Image();
    image.src = `data:image/png;base64,${shot.data}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.naturalWidth;
    c.height = image.naturalHeight;
    const pen = c.getContext("2d", { willReadFrequently: true });
    pen.drawImage(image, 0, 0);
    const px = pen.getImageData(0, 0, c.width, c.height).data;
    const lum = new Float32Array(px.length / 4);
    let sum = 0;
    for (let i = 0, p = 0; i < px.length; i += 4, p += 1) {
      const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lum[p] = v;
      sum += v;
    }
    const sorted = Float32Array.from(lum).sort();
    out.push({ mean: sum / lum.length, p95: sorted[Math.floor(0.95 * sorted.length)] });
  }
  return out;
}, shots);
const events = await page.evaluate(() => window.__ev);

const rows = shots.map((s, i) => ({ t: Math.round((s.t - base) * 1000), ...stats[i] }));
const dark = rows.filter((r) => r.p95 < 0.5 * (rows[rows.length - 1]?.p95 ?? 1));
for (const r of rows) {
  console.log(`t=${String(r.t).padStart(5)}  mean ${r.mean.toFixed(1).padStart(6)}  p95 ${r.p95.toFixed(1).padStart(6)}`);
}
console.log("\nevents:");
for (const e of events) console.log(`  ${String(e.t).padStart(5)}  ${e.type === "animationstart" ? "start" : "end  "} ${e.name}`);
for (const r of dark.slice(0, 4)) {
  const shot = shots.find((s) => Math.round((s.t - base) * 1000) === r.t);
  if (shot) writeFileSync(`${outDir}/${spec.replace(">", "-")}-dark-${r.t}.png`, Buffer.from(shot.data, "base64"));
}
console.log(`\nwrote ${Math.min(4, dark.length)} dark frames to ${outDir}`);
await browser.close();
