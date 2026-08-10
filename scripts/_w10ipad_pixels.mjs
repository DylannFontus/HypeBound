/**
 * What dropping the outgoing screen's `filter` costs the picture, in levels.
 *
 * Every other change in this pass is pixel-identical and needs no defence. This
 * one is not: on the low tier `--nav-hold-blur` already resolves to `0px`, so
 * the declaration on a departing screen is `blur(0px) brightness(0.92)` — a
 * full-viewport filter, and therefore a full-viewport intermediate buffer in any
 * engine that cannot fold a filter into an existing layer, bought entirely for
 * an 8% dim. Removing it is only defensible if the 8% is genuinely invisible,
 * and "genuinely invisible" is a number rather than an opinion.
 *
 * So: photograph the hold and the exit with the filter and without it, on the
 * tier the iPad is actually given, and print the mean and 95th-percentile
 * per-channel difference. `--freeze` is not used — the animation is pinned by
 * setting `animation-play-state` on the element under test only, so the
 * atmosphere behind it keeps its own state in both arms and cannot contribute a
 * difference of its own.
 */

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const OUT = path.join("scripts", "screenshots", "live", "w10-ipad");
mkdirSync(OUT, { recursive: true });


/**
 * Force the graphics tier, and force it in the only place that cannot lose.
 *
 * `page.addInitScript` looked like the obvious way to do this and silently did
 * nothing: an init script runs at document-start, `document.documentElement` is
 * still null at that point, and the assignment throws into a void Playwright
 * does not surface. Three separate measurements in this pass were labelled
 * `tier=low` and taken at `high`, which is instrument fifteen and was caught
 * only because a rule that provably applies measured as though it did not.
 *
 * Rewriting the served HTML puts the attribute on `<html>` before a single byte
 * is parsed, so `atmosphere.ts::detectTier` reads it as a declared answer and
 * every tier-gated rule in the stylesheet is live from first paint. The probe
 * then re-reads the tier out of the page and refuses to report under a label it
 * has not confirmed.
 */
async function forceTier(context, tier) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace(/<html/i, `<html data-gfx-tier="${tier}"`);
    return route.fulfill({ response, body });
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME ?? undefined,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const TIER = process.argv[2] ?? "low";
const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 });
await forceTier(context, TIER);
const page = await context.newPage();
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3500);

const liveTier = await page.evaluate(() => document.documentElement.dataset["gfxTier"]);
if (liveTier !== TIER) {
  console.error(`tier not applied: asked for "${TIER}", page reports "${liveTier}". Refusing to report.`);
  await browser.close();
  process.exit(1);
}
console.log(`tier=${liveTier}`);

/** Pin the screen at a chosen point of a chosen state, with no filter override. */
async function shoot(state, offsetMs, drop) {
  await page.evaluate(
    ([s, off, kill]) => {
      const el = document.querySelector(".screen");
      document.getElementById("w10-pin")?.remove();
      const style = document.createElement("style");
      style.id = "w10-pin";
      style.textContent =
        `.screen[data-nav] { animation-delay: -${off}ms !important; animation-play-state: paused !important; }` +
        (kill ? ` .screen[data-nav="descend-hold"], .screen[data-nav="descend-out"] { filter: none !important; }` : "");
      document.head.appendChild(style);
      el.style.setProperty("--nav-dur", s.endsWith("hold") ? "70ms" : "170ms");
      el.dataset.nav = s;
    },
    [state, offsetMs, drop]
  );
  await page.waitForTimeout(400);
  return (await page.screenshot()).toString("base64");
}

/**
 * The diff runs in a second, blank page rather than in Node, because this repo
 * has no PNG decoder and adding one for a three-line measurement is not worth a
 * dependency. A blank `about:blank` context cannot contaminate the sample — it
 * never loads the game.
 */
const judge = await context.newPage();
await judge.goto("about:blank");
async function diff(aB64, bB64) {
  return judge.evaluate(async ([a, b]) => {
    const load = (src) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = "data:image/png;base64," + src;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const draw = (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, c.width, c.height).data;
    };
    const da = draw(ia);
    const db = draw(ib);
    let sum = 0;
    const samples = [];
    for (let i = 0; i < da.length; i += 4) {
      const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      sum += d;
      if (i % 400 === 0) samples.push(d);
    }
    samples.sort((x, y) => x - y);
    return {
      mean: sum / (da.length / 4),
      p95: samples[Math.floor(samples.length * 0.95)],
      max: samples[samples.length - 1],
    };
  }, [aB64, bB64]);
}

for (const [state, off] of [
  ["descend-hold", 69],
  ["descend-out", 20],
  ["descend-out", 120],
]) {
  const withFilter = await shoot(state, off, false);
  const without = await shoot(state, off, true);
  const d = await diff(withFilter, without);
  console.log(
    `${state} @${off}ms   mean ${d.mean.toFixed(2)}/255   p95 ${d.p95.toFixed(2)}   max ${d.max.toFixed(2)}`
  );
}

await browser.close();
