/**
 * Does every route in the hub still mount, click and leave without an error?
 *
 * A materials migration is mostly markup, and markup that throws takes the whole
 * screen with it — `innerHTML` half-written, an empty `.screen`, and a route that
 * looks fine in a screenshot taken of the one before it. This walks the twelve,
 * clicks the first interactive control on each, and reports anything the console
 * or the page said while it did.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { seedHistory } from "./lib/records.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const CLICKS = {
  a11y: ".d-seg-opt:not(.is-on)",
  settings: ".d-set-toggle .switch",
  stats: ".stats-filters .d-chip:not([aria-pressed='true'])",
  replays: ".replay-entry:nth-child(3)",
  privacy: "#privacy-show",
  support: "#support-search",
  profile: ".profile-slot-toggle",
  gauntlet: "#gauntlet-start",
};

const ROUTES = [
  "profile", "stats", "leaderboards", "replays", "settings", "a11y",
  "privacy", "legal", "support", "gauntlet", "fairness", "cloudsave",
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

let noise = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text().slice(0, 140)}`);
});
page.on("pageerror", (e) => noise.push(`pageerror: ${String(e).slice(0, 140)}`));

await seedPlayedAccount(page, ORIGIN);
await seedHistory(page);

const rows = [];
for (const route of ROUTES) {
  noise = [];
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => document.querySelector(".screen")?.childElementCount ?? 0);

  const selector = CLICKS[route];
  let clicked = "—";
  if (selector) {
    const target = page.locator(selector).first();
    if ((await target.count()) > 0) {
      // The Gauntlet's start button begins a real run; back out of it after.
      await target.click({ timeout: 4000 }).catch((e) => noise.push(`click: ${String(e).slice(0, 80)}`));
      clicked = selector;
      await page.waitForTimeout(700);
    } else {
      clicked = `${selector} (absent)`;
    }
  }
  const after = await page.evaluate(() => document.querySelector(".screen")?.childElementCount ?? 0);
  rows.push({ route, before, after, clicked, noise: noise.length, first: noise[0] ?? "" });

  if (route === "gauntlet") {
    await page.evaluate(async () => {
      const { gauntletStore } = await import("/src/save/gauntletSave.ts");
      gauntletStore.update((d) => {
        d.active = null;
      });
    }).catch(() => {});
  }
}
console.table(rows);
await browser.close();
