/** Census of my eight routes, plus lobby as the yardstick. */
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
  "lobby",
  "profile", "stats", "leaderboards", "replays", "settings", "a11y", "privacy",
  "legal", "support", "gauntlet", "fairness", "cloudsave",
];

const rows = [];
for (const r of routes) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(900);
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
        (e) => /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className))
      ).length;
      let flat = 0;
      for (const e of big) {
        const cs = getComputedStyle(e);
        const bg = cs.backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
        if (cs.backgroundImage !== "none") continue;
        if (cs.boxShadow !== "none") continue;
        flat += 1;
      }
      const native = s.querySelectorAll(
        "select:not(.select), input[type=checkbox]:not(.checkbox):not(.switch), input[type=range]:not(.slider), input[type=text]:not(.field), textarea:not(.textarea)"
      ).length;
      const glyphs = (s.textContent || "").match(/[▦✦✉◈◇⚗☠✋▤✖←→▶◀⏮⏭◆●○★☆✓✕⚙]/g)?.length ?? 0;
      const nums = s.querySelectorAll(".num").length;
      const roles = s.querySelectorAll(".t-display,.t-heading,.t-body,.t-label").length;
      const svgs = s.querySelectorAll("svg").length;
      return {
        route, big: big.length, mat, plain, flat, native, glyphs, nums, roles, svgs,
        h: Math.round(s.scrollHeight),
      };
    }, r)
  );
}
console.table(rows);
await browser.close();
