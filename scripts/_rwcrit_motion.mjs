/** Instrument the rewards domain's motion: animation events, long tasks, fps, screencast. */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const OUT = "D:/Gooner Card Game/scripts/screenshots/w2/rewards";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const INSTRUMENT = () => {
  const w = window;
  w.__anim = [];
  w.__long = [];
  w.__frames = [];
  const t0 = performance.now();
  w.__t0 = t0;
  const rec = (kind) => (e) => {
    w.__anim.push({
      kind,
      t: Math.round(performance.now() - t0),
      name: e.animationName || e.propertyName || "?",
      cls: (e.target && e.target.className && String(e.target.className).slice(0, 60)) || "",
      tag: e.target && e.target.tagName,
      dur: e.elapsedTime,
    });
  };
  document.addEventListener("animationstart", rec("start"), true);
  document.addEventListener("animationend", rec("end"), true);
  document.addEventListener("animationiteration", rec("iter"), true);
  document.addEventListener("transitionstart", rec("tstart"), true);
  document.addEventListener("transitionend", rec("tend"), true);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__long.push({ t: Math.round(e.startTime - t0), d: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    w.__frames.push(Math.round((now - last) * 100) / 100);
    last = now;
    w.__raf = requestAnimationFrame(tick);
  };
  w.__raf = requestAnimationFrame(tick);
};

const fpsReport = (frames) => {
  if (!frames.length) return {};
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  return {
    n: frames.length,
    meanMs: +mean.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
    p50: p(0.5),
    p95: p(0.95),
    worst: sorted[sorted.length - 1],
    over33: frames.filter((f) => f > 33.4).length,
    over16: frames.filter((f) => f > 17).length,
  };
};

const results = {};

try {
  await seedPlayedAccount(page, ORIGIN);

  // ---------- 1. SHOP idle + entrance ----------
  await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
  await page.evaluate(INSTRUMENT);
  await page.waitForTimeout(2500);
  results.shopIdle = await page.evaluate(() => ({
    anim: window.__anim.slice(0, 80),
    long: window.__long,
    fps: window.__frames,
  }));
  results.shopIdle.fpsStat = fpsReport(results.shopIdle.fps);
  delete results.shopIdle.fps;

  // count running animations at rest
  results.shopRunning = await page.evaluate(() =>
    document.getAnimations().map((a) => ({
      name: a.animationName || (a.effect && a.effect.getComputedTiming && "css") || "?",
      state: a.playState,
      dur: a.effect && a.effect.getTiming().duration,
      iter: a.effect && a.effect.getTiming().iterations,
      target: a.effect && a.effect.target ? String(a.effect.target.className).slice(0, 50) : "",
    }))
  );

  // ---------- 2. PACK OPEN set-piece ----------
  await page.evaluate(() => {
    window.__anim = [];
    window.__long = [];
    window.__frames = [];
    window.__t0 = performance.now();
  });
  const cdp = await page.context().newCDPSession(page);
  const shots = [];
  cdp.on("Page.screencastFrame", async (f) => {
    shots.push({ t: Date.now(), data: f.data });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 800, everyNthFrame: 1 });
  const tStart = Date.now();
  await page.locator("#shop-buy").click({ force: true });
  await page.waitForTimeout(900);
  const packAt = Date.now() - tStart;
  await page.locator(".rw-pack").click({ force: true });
  await page.waitForTimeout(1600);
  // click each card
  const slots = await page.locator(".reveal-slot .rw-flip").count();
  for (let i = 0; i < slots; i++) {
    await page.locator(".reveal-slot .rw-flip").nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(420);
  }
  await page.waitForTimeout(1200);
  await cdp.send("Page.stopScreencast");
  results.packOpen = await page.evaluate(() => ({
    anim: window.__anim,
    long: window.__long,
    fps: window.__frames,
  }));
  results.packOpen.fpsStat = fpsReport(results.packOpen.fps);
  delete results.packOpen.fps;
  results.packOpen.packAt = packAt;
  results.packOpen.screencastFrames = shots.length;
  results.packOpen.spanMs = shots.length ? shots[shots.length - 1].t - shots[0].t : 0;

  // write a sample of screencast frames
  const step = Math.max(1, Math.floor(shots.length / 24));
  let n = 0;
  for (let i = 0; i < shots.length; i += step) {
    writeFileSync(path.join(OUT, `cast-${String(n).padStart(2, "0")}.jpg`), Buffer.from(shots[i].data, "base64"));
    n++;
    if (n >= 24) break;
  }
  results.packOpen.castWritten = n;

  await page.screenshot({ path: path.join(OUT, "reveal-final.png") });

  // ---------- 3. BANNER x10 ----------
  await page.goto(`${ORIGIN}/?nointro#banner`, { waitUntil: "networkidle" });
  await page.evaluate(INSTRUMENT);
  await page.waitForTimeout(2200);
  results.bannerIdle = { anim: (await page.evaluate(() => window.__anim)).slice(0, 60) };
  results.bannerIdleFps = fpsReport(await page.evaluate(() => window.__frames));
  results.bannerRunning = await page.evaluate(() => document.getAnimations().length);

  await page.evaluate(() => { window.__anim = []; window.__frames = []; window.__long = []; window.__t0 = performance.now(); });
  const pullSel = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /10\s*Pull/i.test(x.textContent || ""));
    if (b) b.id = b.id || "x10-pull";
    return b ? b.id : null;
  });
  results.pullButton = pullSel;
  if (pullSel) {
    await page.locator(`#${pullSel}`).click({ force: true });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "pull10-0.png") });
    await page.locator(".rw-pack").click({ force: true }).catch(() => {});
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, "pull10-1.png") });
    await page.evaluate(() => { const b = document.getElementById("reveal-all"); if (b) b.click(); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "pull10-2.png") });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, "pull10-3.png") });
  }
  results.pull10 = await page.evaluate(() => ({ anim: window.__anim.slice(0, 140), long: window.__long }));
  results.pull10Fps = fpsReport(await page.evaluate(() => window.__frames));

  results.errors = errors;
} catch (e) {
  results.fatal = String(e && e.stack || e);
  results.errors = errors;
}

writeFileSync("C:/Users/dylou/AppData/Local/Temp/claude/d--Gooner-Card-Game/f8a96538-0dc2-44e6-ae58-d9b83898ec10/scratchpad/rw_motion.json", JSON.stringify(results, null, 1));
console.log(JSON.stringify({
  shopIdleFps: results.shopIdle && results.shopIdle.fpsStat,
  shopIdleLong: results.shopIdle && results.shopIdle.long,
  shopRunningCount: results.shopRunning && results.shopRunning.length,
  packFps: results.packOpen && results.packOpen.fpsStat,
  packLong: results.packOpen && results.packOpen.long,
  cast: results.packOpen && { frames: results.packOpen.screencastFrames, span: results.packOpen.spanMs },
  bannerIdleFps: results.bannerIdleFps,
  bannerRunning: results.bannerRunning,
  pullButton: results.pullButton,
  pull10Fps: results.pull10Fps,
  fatal: results.fatal,
  errors: errors.slice(0, 6),
}, null, 1));

await browser.close();
