/**
 * Navigation cost probe for the rewards domain.
 *
 * node navprobe.mjs banner shop pass achievements missions
 *
 * Cold: fresh page each route, lobby -> route, longtask observer + rAF gap.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = "D:/Gooner Card Game";
const { seedPlayedAccount } = await import(
  "file:///" + path.join(REPO, "scripts/lib/account.mjs").replace(/\\/g, "/")
);

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const routes = process.argv.slice(2);
const size = { width: 1600, height: 900 };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const route of routes) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(900);

  const result = await page.evaluate(async (r) => {
    const tasks = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) });
    });
    obs.observe({ entryTypes: ["longtask"] });
    const frames = [];
    let stop = false;
    const tick = (t) => {
      frames.push(t);
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    const anims = [];
    const onStart = (e) => anims.push({ n: e.animationName, k: "start", t: Math.round(performance.now() - t0) });
    const onEnd = (e) => anims.push({ n: e.animationName, k: "end", t: Math.round(performance.now() - t0) });
    document.addEventListener("animationstart", onStart, true);
    document.addEventListener("animationend", onEnd, true);
    location.hash = "#" + r;
    await new Promise((res) => setTimeout(res, 2600));
    stop = true;
    obs.disconnect();
    document.removeEventListener("animationstart", onStart, true);
    document.removeEventListener("animationend", onEnd, true);
    let maxGap = 0;
    const gaps = [];
    for (let i = 1; i < frames.length; i++) {
      const g = Math.round(frames[i] - frames[i - 1]);
      if (g > 60) gaps.push({ g, at: Math.round(frames[i] - t0) });
      if (g > maxGap) maxGap = g;
    }
    const rel = tasks
      .filter((t) => t.at >= t0 - 40)
      .map((t) => ({ ms: t.ms, at: Math.round(t.at - t0) }));
    const navAnims = anims.filter((a) => a.n && a.n.startsWith("nav-"));
    return {
      tasks: rel,
      total: rel.reduce((a, b) => a + b.ms, 0),
      maxGap,
      gaps,
      navAnims: navAnims.slice(0, 14),
    };
  }, route);

  console.log(`\n=== lobby -> ${route} (cold) ===`);
  console.log(`  long tasks: ${result.tasks.map((t) => `${t.ms}ms@${t.at}`).join(", ") || "none"}`);
  console.log(`  total blocked: ${result.total}ms   worst rAF gap: ${result.maxGap}ms`);
  console.log(`  gaps>60ms: ${result.gaps.map((g) => `${g.g}@${g.at}`).join(", ") || "none"}`);
  console.log(`  nav anims: ${result.navAnims.map((a) => `${a.n}:${a.k}@${a.t}`).join(", ") || "none"}`);
  if (errors.length) console.log(`  errors: ${errors.slice(0, 3).join(" | ")}`);
  await page.close();
}

await browser.close();
