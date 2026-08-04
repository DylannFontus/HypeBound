/**
 * Watch the data screens move, rather than photographing them still.
 *
 * §8.7 of the bar: a still cannot show motion, and four earlier rounds were
 * wasted reviewing §3 from single frames. This records `animationstart` for
 * every element on a route plus any long task, and prints the cascade so the
 * delays can be read as numbers rather than guessed at from two pictures.
 *
 * Review scaffolding. Nothing imports it and it never ships.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const routes = process.argv.slice(2);
if (routes.length === 0) routes.push("mastery");

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto(ORIGIN, { waitUntil: "networkidle" });

await page.evaluate(() => {
  const w = window;
  w.__hbAnim = [];
  w.__hbLong = [];
  document.addEventListener(
    "animationstart",
    (event) => {
      const target = event.target;
      w.__hbAnim.push({
        at: Math.round(performance.now()),
        name: event.animationName,
        cls: (target.className && String(target.className).slice(0, 44)) || target.tagName,
        delay: getComputedStyle(target).animationDelay,
      });
    },
    true
  );
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) w.__hbLong.push(Math.round(entry.duration));
  }).observe({ entryTypes: ["longtask"] });
});

for (const route of routes) {
  const t0 = await page.evaluate(() => {
    window.__hbAnim = [];
    window.__hbLong = [];
    return performance.now();
  });
  await page.evaluate((r) => {
    location.hash = "#" + r;
  }, route);
  await page.waitForTimeout(1500);

  const data = await page.evaluate((start) => {
    return {
      anim: window.__hbAnim.map((a) => ({ ...a, at: Math.round(a.at - start) })),
      long: window.__hbLong,
    };
  }, t0);

  const byName = new Map();
  for (const entry of data.anim) {
    if (!byName.has(entry.name)) byName.set(entry.name, []);
    byName.get(entry.name).push(entry);
  }
  console.log(`\n=== #${route} — ${data.anim.length} animations started ===`);
  for (const [name, list] of byName) {
    const delays = [...new Set(list.map((a) => a.delay))].slice(0, 10).join(", ");
    const first = list[0].at;
    const last = list[list.length - 1].at;
    console.log(`  ${name} x${list.length}  window ${first}-${last}ms  delays: ${delays}`);
  }
  console.log(`  long tasks: ${data.long.length ? data.long.join("ms, ") + "ms" : "none"}`);
  await page.evaluate(() => {
    location.hash = "#lobby";
  });
  await page.waitForTimeout(500);
}

await browser.close();
