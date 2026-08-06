/**
 * A measuring tape for the data screens.
 *
 * `shot.mjs` is the camera; this is the ruler. It seeds the same account the
 * camera seeds, optionally records a match history so the statistics screen has
 * something to plot, navigates, and runs a probe in the page — printing JSON to
 * stdout so a claim in a review can be a number.
 *
 *   node dsmeasure.mjs <route> <probe.js> [--size WxH] [--history N] [--nav from]
 */

import { chromium } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const route = argv[0];
const probePath = argv[1];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const [w, h] = String(flag("size", "1600x900")).split("x").map(Number);
const history = Number(flag("history", 0));
const navFrom = flag("nav", null);
const scale = Number(flag("scale", 1));
const reduced = argv.includes("--reduced");

const probe = readFileSync(probePath, "utf8");

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 1,
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));

await page.goto(ORIGIN, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);

if (history > 0) {
  await page.evaluate(async (n) => {
    const mod = await import("/src/save/profile.ts");
    const store = mod.profileStore;
    const results = [];
    for (let i = 0; i < n; i++) results.push(i % 4 === 3 ? "draw" : i % 4 === 2 ? "loss" : "win");
    store.update((draft) => {
      draft.history = results.map((result, i) => ({
        id: `seed${i}`,
        playedAt: Date.now() - (n - i) * 3600000,
        deckName: i % 2 ? "Encore Loop" : "Late Shift",
        leaderCardId: "leader-dj-last-call",
        opponentLeaderCardId: "leader-half-four-mari",
        mode: i % 3 === 0 ? "ai-casual" : "story",
        result,
        turns: 8 + (i % 7),
        record: null,
        summary: { peakObsession: 3 + (i % 5), confluences: i % 3, resonances: i % 2, cardsPlayed: 12 + (i % 9) },
      }));
      draft.stats.matchesPlayed = n;
      draft.stats.wins = results.filter((r) => r === "win").length;
      draft.stats.losses = results.filter((r) => r === "loss").length;
      draft.stats.draws = results.filter((r) => r === "draw").length;
    });
    if (typeof store.flush === "function") store.flush();
  }, history);
}

if (scale !== 1) {
  await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), scale);
}

if (navFrom) {
  await page.goto(`${ORIGIN}/#${navFrom}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
}

await page.evaluate((r) => {
  window.__probeStart = performance.now();
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  window.__anim = [];
  document.addEventListener(
    "animationstart",
    (e) => window.__anim.push([e.animationName, Math.round(performance.now() - window.__probeStart)]),
    true
  );
  window.__transitions = [];
  document.addEventListener("transitionrun", (e) => window.__transitions.push(e.propertyName), true);
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(Math.round(t - last));
    last = t;
    if (window.__frames.length < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  if (r) location.hash = `#${r}`;
}, route);

await page.waitForTimeout(Number(flag("wait", 2500)));

const out = await page.evaluate(new Function(`return (async () => { ${probe} })()`));
console.log(JSON.stringify(out, null, 2));

await browser.close();
