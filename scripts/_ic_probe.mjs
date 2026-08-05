/**
 * Integration-critic probe. Read-only measurement, no game code touched.
 *
 * Exists because four of the five instruments that have lied in this project
 * lied by producing a confident number from a screenshot. Anything a critic is
 * about to call a defect on the strength of a PNG gets asked of the DOM here
 * first: the curve bars that appear absent, the scrollbar that appears to float
 * in dead space, and whether two screens genuinely disagree about their room.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

const go = async (hash) => {
  await page.goto(`${ORIGIN}/?nointro#${hash}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1300);
};

const out = {};

await go("deckbuilder");
out.curve = await page.evaluate(() => {
  const bars = [...document.querySelectorAll(".curve-bar")];
  const host = document.querySelector(".curve-bars");
  return {
    barsHostH: host?.clientHeight ?? null,
    bars: bars.slice(0, 4).map((b) => {
      const f = b.querySelector(".curve-fill");
      const r = f.getBoundingClientRect();
      return {
        cls: b.className,
        paintedH: +r.height.toFixed(1),
        layoutH: f.offsetHeight,
        transform: getComputedStyle(f).transform,
        origin: getComputedStyle(f).transformOrigin,
        cssHeight: getComputedStyle(f).height,
        flexBasis: getComputedStyle(f).flexBasis,
      };
    }),
  };
});

for (const route of ["settings", "profile", "shop", "a11y"]) {
  await go(route);
  out[`scroll_${route}`] = await page.evaluate(() => {
    const res = [];
    for (const el of document.querySelectorAll(".screen, .screen *")) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 200) continue;
      const gutter = el.offsetWidth - el.clientWidth;
      if (gutter < 2) continue;
      const r = el.getBoundingClientRect();
      res.push({
        cls: String(el.className || el.tagName).slice(0, 60),
        scrollerRight: +r.right.toFixed(0),
        gutter,
      });
    }
    const boxes = [...document.querySelectorAll(".screen *")]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 300 && r.height > 150);
    return { scrollers: res.slice(0, 6), widestContentRight: Math.max(0, ...boxes.map((r) => Math.round(r.right))) };
  });
}

for (const route of [
  "lobby",
  "collection",
  "settings",
  "a11y",
  "shop",
  "profile",
  "deckbuilder",
  "play",
  "pass",
  "starter",
  "missions",
]) {
  await go(route);
  out[`bg_${route}`] = await page.evaluate(() => {
    const s = document.querySelector(".screen") ?? document.body;
    const cs = getComputedStyle(s);
    const stage = document.querySelector("[class*='room'], [data-room]");
    return {
      dataRoom:
        s.getAttribute("data-room") ??
        document.body.getAttribute("data-room") ??
        document.documentElement.getAttribute("data-room") ??
        stage?.getAttribute("data-room") ??
        null,
      screenBg: cs.backgroundColor,
      screenImg: cs.backgroundImage.slice(0, 70),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyImg: getComputedStyle(document.body).backgroundImage.slice(0, 70),
      screenClass: String(s.className).slice(0, 80),
    };
  });
}

for (const route of [
  "collection",
  "deckbuilder",
  "shop",
  "pass",
  "profile",
  "settings",
  "play",
  "missions",
  "mastery",
  "achievements",
  "events",
  "stats",
  "a11y",
  "banner",
  "gallery",
  "replays",
  "decks",
  "news",
  "inbox",
  "leaderboards",
]) {
  await go(route);
  out[`back_${route}`] = await page.evaluate(() => {
    const first = [...document.querySelectorAll(".screen a, .screen button")]
      .slice(0, 3)
      .map((e) => e.textContent.trim().replace(/\s+/g, " ").slice(0, 28));
    return first;
  });
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
