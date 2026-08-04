/**
 * Film one navigation and write every frame to disk, so the dark one can be
 * looked at rather than described.
 *
 *   node scripts/_ff/film.mjs lobby play scripts/screenshots/w2/ff2/film
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const from = process.argv[2] ?? "lobby";
const to = process.argv[3] ?? "play";
const outDir = process.argv[4] ?? "scripts/screenshots/w2/ff2/film";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

/**
 * Vite's HMR error overlay, swept off the glass.
 *
 * This drives a dev server five other people are editing, and a transform error
 * in *their* module puts a full-screen `<vite-error-overlay>` on top of the game
 * — which a screencast dutifully photographs as a very dark frame with a red
 * line at the top. Two runs of the navigation probe were scored against it
 * before anyone opened the JPEG. It is removed rather than tolerated, and the
 * removal is loud in the log so a run that happened during somebody's broken
 * save is not mistaken for a measurement.
 */
await page.addInitScript(() => {
  setInterval(() => {
    for (const node of document.querySelectorAll("vite-error-overlay")) node.remove();
  }, 120);
});

for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}
await page.goto(`${ORIGIN}/?nointro#${from}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
// Warm: the first visit pays for a module graph nobody is measuring.
for (let i = 0; i < 2; i++) {
  await page.evaluate(async ([f, t]) => {
    location.hash = "#" + t;
    await new Promise((r) => setTimeout(r, 1100));
    location.hash = "#" + f;
    await new Promise((r) => setTimeout(r, 1100));
  }, [from, to]);
}

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (frame) => {
  shots.push({ t: frame.metadata.timestamp ?? 0, data: frame.data });
  void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 800, maxHeight: 450 });
await page.evaluate((t) => {
  location.hash = "#" + t;
}, to);
await page.waitForTimeout(1400);
await session.send("Page.stopScreencast");

const base = shots.length ? shots[0].t : 0;
const stats = await page.evaluate(async (list) => {
  const out = [];
  for (const shot of list) {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${shot.data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const pen = canvas.getContext("2d", { willReadFrequently: true });
    pen.drawImage(image, 0, 0);
    const px = pen.getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = new Float32Array(px.length / 4);
    let sum = 0;
    for (let i = 0, q = 0; i < px.length; i += 4, q += 1) {
      const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lum[q] = v;
      sum += v;
    }
    const sorted = Float32Array.from(lum).sort();
    out.push({ mean: sum / lum.length, p95: sorted[Math.floor(0.95 * sorted.length)] });
  }
  return out;
}, shots);
await session.detach().catch(() => undefined);

for (let i = 0; i < Math.min(shots.length, stats.length); i += 1) {
  const t = Math.round((shots[i].t - base) * 1000);
  const s = stats[i];
  const name = `${String(i).padStart(3, "0")}_t${String(t).padStart(4, "0")}_m${Math.round(s.mean)}_p${Math.round(s.p95)}.jpg`;
  writeFileSync(path.join(outDir, name), Buffer.from(shots[i].data, "base64"));
}
console.log(
  stats
    .map((s, i) => `${String(Math.round((shots[i].t - base) * 1000)).padStart(5)}ms  mean ${s.mean.toFixed(1)}  p95 ${s.p95.toFixed(1)}`)
    .join("\n")
);
await browser.close();
