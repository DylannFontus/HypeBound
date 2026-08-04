/**
 * Watch the collection domain move, rather than guessing from a still.
 *
 * Records every animationstart/animationend on the route, the spread of
 * `--enter-delay` actually written onto the tiles, whether a hover changes the
 * things it is supposed to change, and any long task while it all happens.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const route = process.argv[2] ?? "collection";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 4; i += 1) {
  try { await seedPlayedAccount(page); break; } catch { await page.waitForTimeout(700); }
}
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

await page.evaluate(() => {
  const w = window;
  w.__anim = [];
  w.__long = [];
  const t0 = performance.now();
  document.addEventListener("animationstart", (e) => {
    w.__anim.push({ at: Math.round(performance.now() - t0), name: e.animationName, cls: e.target.className?.baseVal ?? e.target.className });
  }, true);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(Math.round(e.duration)); })
    .observe({ entryTypes: ["longtask"] });
});

await page.evaluate((r) => { location.hash = `#${r}`; }, route);
await page.waitForTimeout(2400);

const anim = await page.evaluate(() => window.__anim.slice(0, 400));
const long = await page.evaluate(() => window.__long.slice());
const byName = {};
for (const a of anim) {
  byName[a.name] ??= { count: 0, first: a.at, last: a.at };
  byName[a.name].count += 1;
  byName[a.name].first = Math.min(byName[a.name].first, a.at);
  byName[a.name].last = Math.max(byName[a.name].last, a.at);
}
console.log("animations started on", route);
console.table(byName);
console.log("long tasks:", long.join(", ") || "none");

const delays = await page.$$eval("[style*='--enter-delay']", (nodes) =>
  nodes.slice(0, 24).map((n) => n.style.getPropertyValue("--enter-delay").trim())
);
console.log("first --enter-delay values:", delays.join(" "));

if (route === "collection") {
  const before = await page.$eval(".card-cell", (n) => getComputedStyle(n).transform);
  await page.hover(".card-cell");
  await page.waitForTimeout(180);
  const after = await page.$eval(".card-cell", (n) => ({
    transform: getComputedStyle(n).transform,
    filter: getComputedStyle(n).filter,
  }));
  console.log("hover transform:", before, "->", after.transform);
  console.log("hover filter:", after.filter);

  // the shared-element grow: capture the detail card's transform across frames
  await page.click(".card-cell");
  const frames = [];
  for (let i = 0; i < 10; i += 1) {
    frames.push(await page.evaluate(() => {
      const el = document.querySelector(".cd-tilt");
      return el ? getComputedStyle(el).transform.slice(0, 60) : "none";
    }));
    await page.waitForTimeout(45);
  }
  console.log("cd-tilt across 10 frames (45ms apart):");
  for (const f of frames) console.log("  ", f);
}

await browser.close();
