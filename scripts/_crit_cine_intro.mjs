/**
 * Film the opening cinematic with a CDP screencast and grade every frame.
 * Usage: node cine-intro.mjs <kind:first|returning> <outdir>
 */
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const kind = argv[0] ?? "first";
const outDir = argv[1] ?? "D:/Gooner Card Game/scripts/screenshots/w2/cinematics/intro";
const [vw, vh] = String(argv[2] ?? "1600x900").split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

if (kind === "returning") {
  await seedPlayedAccount(page, "http://localhost:5173");
  // mark the title as already played so the "returning" sting is chosen
  await page.evaluate(() => {
    try { localStorage.setItem("hb.intro.title", "1"); } catch {}
  });
} else {
  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
}

const session = await page.context().newCDPSession(page);
const frames = [];
session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  frames.push({ data, t: metadata.timestamp });
  await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });

const t0 = Date.now();
await page.goto("http://localhost:5173/#lobby", { waitUntil: "commit" });
await page.waitForTimeout(9000);
await session.send("Page.stopScreencast");

const stats = await page.evaluate(async (shots) => {
  const grade = async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    const W = bitmap.width, H = bitmap.height;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, W, H);
    const all = []; let sum = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      all.push(l); sum += l;
    }
    all.sort((a, b) => a - b);
    const mean = sum / all.length;
    let v = 0; for (const l of all) v += (l - mean) ** 2;
    return { mean, p95: all[Math.floor(all.length * 0.95)], sd: Math.sqrt(v / all.length) };
  };
  const out = [];
  for (const s of shots) out.push({ t: s.t, ...(await grade(s.data)) });
  return out;
}, frames);

const rel = stats.map((s, i) => ({ i, ms: s.t * 1000 - t0, mean: s.mean, p95: s.p95, sd: s.sd }));
console.log(`intro:${kind} ${vw}x${vh} — ${frames.length} frames over ${(rel.at(-1)?.ms ?? 0).toFixed(0)}ms`);
console.log(`  fps ≈ ${(frames.length / ((rel.at(-1)?.ms ?? 1) / 1000)).toFixed(1)}`);
// deltas between consecutive frames
let prev = null;
const line = [];
for (const f of rel) {
  line.push(`${f.ms.toFixed(0)}:${f.mean.toFixed(1)}/${f.sd.toFixed(1)}`);
}
console.log("  t:mean/sd " + line.join(" "));

// write every Nth frame out
const step = Math.max(1, Math.round(frames.length / 30));
for (let i = 0; i < frames.length; i += step) {
  writeFileSync(`${outDir}/${kind}-${String(Math.round(rel[i].ms)).padStart(5, "0")}.jpg`, Buffer.from(frames[i].data, "base64"));
}
if (errors.length) console.log("  console errors: " + errors.slice(0, 8).join(" | "));
await browser.close();
