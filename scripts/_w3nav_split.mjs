/**
 * What one attribute write on a screen root actually costs, and why.
 *
 * Every navigation used to pay a 50-64ms task starting the instant the hash
 * changed, before anything had been built, and a long-task observer only says
 * how long it was. This times the individual mutations `seal()` and
 * `beginExit()` make, each against a forced style pass and then a forced
 * layout, so the cost lands on the statement that caused it.
 *
 * The answer, at 1600x900 before the §2.7 rewrite:
 *
 *     lobby (179 nodes)     data-nav 0+23ms   unused class 0+12ms
 *     missions (356)                 0+34ms                 0+6ms
 *     collection (1529)              0+42ms                 0+22ms
 *
 * Style recalculation is the `0+`; all of it is *layout*, and it scales with
 * the node count of a subtree that did not change. That is Blink's whole-subtree
 * invalidation, triggered by two selector shapes that used to live in
 * `transitions.css`: a rightmost compound of bare `*` under an attribute
 * ancestor, and `[class*="-sheet"]`, which makes every `class` mutation in the
 * document conservative. A class name that matches nothing costing 22ms is the
 * tell — keep that row, it is the one that proves the cause.
 *
 *   node scripts/_w3nav_split.mjs lobby missions collection
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

for (const route of process.argv.slice(2)) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const out = await page.evaluate(() => {
    const screen = document.querySelector(".screen");
    if (screen === null) return ["no screen"];
    const flush = () => document.body.offsetHeight;
    /** Style only — `getComputedStyle` does not force layout. */
    const restyle = () => getComputedStyle(document.documentElement).color;
    const time = (label, run, undo) => {
      const a = performance.now();
      run();
      restyle();
      const b = performance.now();
      flush();
      const row = `${label} ${Math.round(b - a)}+${Math.round(performance.now() - b)}ms`;
      undo?.();
      flush();
      return row;
    };
    const settle = () => {
      screen.dataset["nav"] = "settled";
    };
    return [
      // A no-op, so the two below are read against something rather than against
      // an assumption that a forced layout on a settled page is free.
      time("no-op", () => {}),
      time("data-nav", () => (screen.dataset["nav"] = "descend-hold"), settle),
      time("used class", () => screen.classList.add("screen-out"), () => screen.classList.remove("screen-out")),
      time(
        "unused class",
        () => screen.classList.add("zzz-matches-nothing"),
        () => screen.classList.remove("zzz-matches-nothing")
      ),
      time("unused attr", () => screen.setAttribute("data-zzz", "1"), () => screen.removeAttribute("data-zzz")),
      `nodes ${screen.getElementsByTagName("*").length}`,
    ];
  });
  console.log(`${route.padEnd(12)} ${out.join("   ")}`);
}

await browser.close();
