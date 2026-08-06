/** Dense screencast of an arbitrary window, dumping every frame in a range. */
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const mode = argv[0] ?? "intro"; // intro | curtain | nav
const outDir = argv[1] ?? "D:/Gooner Card Game/scripts/screenshots/w2/cinematics/window";
const from = Number(argv[2] ?? 4600);
const to = Number(argv[3] ?? 5300);
const [vw, vh] = String(argv[4] ?? "1600x900").split("x").map(Number);
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

let t0 = 0;
const session = await page.context().newCDPSession(page);
const frames = [];
const startCast = async () => {
  session.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
    frames.push({ data, t: metadata.timestamp });
    await session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
};

if (mode === "intro") {
  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await startCast();
  t0 = Date.now();
  await page.goto("http://localhost:5173/#lobby", { waitUntil: "commit" });
  await page.waitForTimeout(to + 900);
} else if (mode === "curtain") {
  await seedPlayedAccount(page, "http://localhost:5173");
  await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__anim = [];
    for (const type of ["animationstart", "animationend", "animationcancel"]) {
      document.addEventListener(type, (e) => {
        window.__anim.push([type, e.animationName, Math.round(performance.now()), e.target.className?.baseVal ?? String(e.target.className).slice(0, 60)]);
      }, true);
    }
    window.__gaps = []; let last = performance.now();
    const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] });
    window.__t0 = performance.now();
  });
  await startCast();
  t0 = Date.now();
  await page.evaluate(() => { location.hash = "#battle?mode=casual"; });
  await page.waitForTimeout(to + 1200);
} else {
  await seedPlayedAccount(page, "http://localhost:5173");
  await page.goto(`http://localhost:5173/?nointro#${argv[5] ?? "lobby"}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await startCast();
  t0 = Date.now();
  await page.evaluate((sel) => { document.querySelector(sel)?.click(); }, argv[6] ?? "#lobby-collection");
  await page.waitForTimeout(to + 900);
}

await session.send("Page.stopScreencast");

const stats = await page.evaluate(async (shots) => {
  const grade = async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    const W = bitmap.width, H = bitmap.height;
    const c = new OffscreenCanvas(W, H); const ctx = c.getContext("2d");
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

const rel = stats.map((s, i) => ({ i, ms: s.t * 1000 - t0, ...s }));
const win = rel.filter((f) => f.ms >= from && f.ms <= to);
console.log(`${mode} — ${frames.length} frames, window ${from}-${to}ms has ${win.length}`);
console.log("  " + win.map((f) => `${f.ms.toFixed(0)}:${f.mean.toFixed(1)}/${f.sd.toFixed(1)}/${f.p95.toFixed(0)}`).join(" "));
const settledTail = rel.filter((f) => f.ms > to + 200);
if (settledTail.length) {
  const sm = settledTail.reduce((a, f) => a + f.mean, 0) / settledTail.length;
  const sp = settledTail.reduce((a, f) => a + f.p95, 0) / settledTail.length;
  const ss = settledTail.reduce((a, f) => a + f.sd, 0) / settledTail.length;
  console.log(`  settled after: mean ${sm.toFixed(1)} p95 ${sp.toFixed(1)} sd ${ss.toFixed(1)}`);
  const dark = win.filter((f) => f.p95 < sp * 0.6);
  console.log(`  frames under 60% of settled p95: ${dark.length}${dark.length ? " → " + dark.map((d) => `${d.ms.toFixed(0)}ms:${d.p95.toFixed(0)}`).join(" ") : ""}`);
  if (dark.length) console.log(`  dark span: ${(dark.at(-1).ms - dark[0].ms).toFixed(0)}ms`);
}
const step = Math.max(1, Math.round(win.length / 24));
for (let i = 0; i < win.length; i += step) {
  writeFileSync(`${outDir}/${mode}-${String(Math.round(win[i].ms)).padStart(5, "0")}.jpg`, Buffer.from(frames[win[i].i].data, "base64"));
}
try {
  const anim = await page.evaluate(() => window.__anim ?? []);
  if (anim.length) {
    console.log(`  animation events (${anim.length}):`);
    for (const a of anim.slice(0, 60)) console.log(`    ${a[0].padEnd(14)} ${String(a[1]).padEnd(28)} t=${a[2]} ${a[3]}`);
  }
  const gaps = await page.evaluate(() => (window.__gaps ?? []).slice(1));
  if (gaps.length) {
    const over = gaps.filter((g) => g > 33);
    console.log(`  rAF gaps >33ms: ${over.length}/${gaps.length}  worst ${over.sort((a,b)=>b-a).slice(0,6).map((g)=>g.toFixed(0)).join(", ") || "-"}`);
  }
  const longs = await page.evaluate(() => window.__long ?? []);
  if (longs.length) console.log(`  long tasks: ${longs.join(", ")}`);
} catch {}
if (errors.length) console.log("  console errors: " + errors.slice(0, 8).join(" | "));
await browser.close();
