/**
 * Which of the two panel languages is each screen speaking?
 *
 * `foundation.css` defines `.mat-panel` — grain, rim, lip, a 315° sheen, a real
 * material. `base.css` defines a plain `.panel` — a glass fill, one 1px border,
 * one inset highlight. Both are live. A screen built on the first looks like
 * HYPEBOUND; a screen built on the second looks like the placeholder it was
 * before the overhaul started, and the eye reads the difference instantly even
 * though no single screen is *wrong*. Counting them per route turns "it feels
 * like two games" into a number somebody can act on.
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

const routes = [
  "lobby", "play", "collection", "deckbuilder", "decks", "shop", "banner", "pass",
  "missions", "mastery", "achievements", "events", "profile", "stats", "leaderboards",
  "settings", "a11y", "privacy", "news", "inbox", "replays", "starter", "queue", "gauntlet", "story",
];

const rows = [];
for (const r of routes) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1100);
  rows.push(
    await page.evaluate((route) => {
      const s = document.querySelector(".screen");
      if (!s) return { route, err: "no screen" };
      const all = [...s.querySelectorAll("*")];
      const big = all.filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 120 && b.height > 60;
      });
      const mat = big.filter((e) => /\bmat-(panel|card|chip|hero|rail|well)\b/.test(String(e.className))).length;
      const plain = big.filter(
        (e) =>
          /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className))
      ).length;
      // Surfaces with a flat single-colour background and nothing else: the §1 ban.
      let flat = 0;
      for (const e of big) {
        const cs = getComputedStyle(e);
        const bg = cs.backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
        if (cs.backgroundImage !== "none") continue;
        if (cs.boxShadow !== "none") continue;
        flat += 1;
      }
      return { route, bigSurfaces: big.length, matPanels: mat, plainPanels: plain, flatFills: flat };
    }, r)
  );
}
console.table(rows);
await browser.close();
