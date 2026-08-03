/**
 * Watch the entrance cascade actually run.
 *
 * A screenshot burst cannot catch it — the grid is built while the route
 * transition is still covering the screen, so by the time the shot tool starts
 * sampling, the wave is over. So this drives the *filter* path, which rebuilds
 * the same cascade on demand, and reads each tile's computed opacity once per
 * animation frame.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5173/#collection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  if (location.hash !== "#collection") location.hash = "#collection";
});
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  const search = document.querySelector(".collection-body input[type='search'], .collection-body input");
  const set = (value) => {
    const proto = Object.getPrototypeOf(search);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(search, value);
    search.dispatchEvent(new Event("input", { bubbles: true }));
  };
  // hide everything, then bring it all back so every visible tile re-enters
  set("zzzznothing");
  await new Promise((r) => setTimeout(r, 420));
  set("");

  const samples = [];
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const cells = [...document.querySelectorAll(".card-cell:not([hidden])")].slice(0, 21);
      samples.push({
        t: Math.round(performance.now() - t0),
        opacity: cells.map((c) => +Number(getComputedStyle(c).opacity).toFixed(2)),
      });
      if (performance.now() - t0 > 620) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // report only the frames where the row is not all-0 and not all-1
  const interesting = samples.filter((s) => {
    const min = Math.min(...s.opacity);
    const max = Math.max(...s.opacity);
    return max - min > 0.05;
  });
  return {
    framesWithAPartialGrid: interesting.length,
    totalFrames: samples.length,
    firstAllOpaqueAt: samples.find((s) => s.opacity.every((v) => v >= 0.99))?.t ?? null,
    sample: interesting.filter((_, i) => i % 3 === 0).slice(0, 7),
  };
});

console.log(JSON.stringify(result, null, 1));
await browser.close();
