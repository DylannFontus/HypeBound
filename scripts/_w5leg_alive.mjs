/**
 * Is the specular band actually running on the sixteen repaired surfaces?
 *
 * §3a asks that a screen be alive at rest, and the band is how every material
 * in this game answers that. A material class that is present but whose
 * `::after` never animates is the failure mode a still frame cannot show — and
 * §8.7 of the bar says not to review motion from a still, so this asks the
 * engine directly. `getAnimations({ subtree: true })` reports pseudo-element
 * animations in Chromium, which is the only place this build ships.
 *
 * It also checks the other half: with the game's reduced-motion setting on,
 * every one of them must be gone. That is a hard requirement rather than a
 * nice-to-have, and it is the half nobody photographs.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const WATCH = {
  collection: [".filter-rail"],
  deckbuilder: [".builder-side"],
  mastery: [".mastery-intro", ".mastery-next"],
  events: [".event-panel"],
  news: [".news-list-panel", ".news-reader", ".news-note"],
  inbox: [".inbox-list-panel", ".inbox-reader", ".inbox-deferred"],
  story: [".story-archive"],
  battle: [".history-panel"],
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const reduced of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await seedPlayedAccount(page, ORIGIN);
  if (reduced) {
    await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await page
      .locator("button", { hasText: /^Reduce motion$/i })
      .first()
      .click()
      .catch(async () => {
        // the control is a switch on this screen; fall back to the setting itself
        await page.evaluate(() => document.documentElement.setAttribute("data-reduced-motion", "true"));
      });
    await page.waitForTimeout(600);
  }
  console.log(`\n=== reduced motion ${reduced ? "ON" : "off"} ===`);
  for (const [route, selectors] of Object.entries(WATCH)) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    if (route === "battle") await page.waitForSelector(".battle-hud", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(route === "battle" ? 3000 : 1400);
    const rows = await page.evaluate(
      ([sels]) =>
        sels.map((sel) => {
          const e = document.querySelector(sel);
          if (!e) return `${sel} absent`;
          // Own band first — `subtree: true` also returns descendants', and a
          // count that lumps the two together says nothing about the surface.
          const own = e
            .getAnimations({ subtree: true })
            .filter(
              (a) =>
                a.effect?.pseudoElement === "::after" &&
                a.playState === "running" &&
                a.effect?.target === e
            );
          const kids = e
            .getAnimations({ subtree: true })
            .filter(
              (a) =>
                a.effect?.pseudoElement === "::after" &&
                a.playState === "running" &&
                a.effect?.target !== e
            )
            .map((a) => String(a.effect.target.className).split(/\s+/)[0] || a.effect.target.tagName);
          return (
            `${sel.padEnd(20)} own ${own.length}` +
            (kids.length ? `  descendants ${kids.length} [${[...new Set(kids)].join(",")}]` : "")
          );
        }),
      [selectors]
    );
    for (const r of rows) console.log(`  ${route.padEnd(12)} ${r}`);
  }
  await page.close();
}
await browser.close();
