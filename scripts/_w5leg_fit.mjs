/**
 * Do the sixteen repaired surfaces still fit, at every size the bar demands?
 *
 * §9 makes 1280x720, a phone in landscape at 844x390 and 140% interface size
 * hard constraints, and a material swap is exactly the change that looks free
 * and is not: `.mat-panel` writes a `border-width`, a `border-radius` and
 * `position: relative` onto surfaces that previously had somebody else's, and a
 * rail that gains two pixels of border at 140% is a rail whose Save Deck button
 * goes off the bottom of a 720px window. This walks the routes at each of the
 * three configurations and reports the element's own box plus anything on the
 * screen that leaves the viewport.
 *
 * Interface size is set by pressing the 140% button rather than by writing
 * `--ui-scale` onto the root, for the reason `_ic3_scale.mjs` gives: the
 * setting also drives JS-side layout, so a hand-set custom property photographs
 * a state the game never enters.
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
};

const CONFIGS = [
  { name: "1280x720", w: 1280, h: 720, scale: false },
  { name: "844x390", w: 844, h: 390, scale: false },
  { name: "1280x720 @140%", w: 1280, h: 720, scale: true },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const cfg of CONFIGS) {
  const page = await browser.newPage({ viewport: { width: cfg.w, height: cfg.h } });
  await seedPlayedAccount(page, ORIGIN);
  if (cfg.scale) {
    await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page
      .locator("button", { hasText: /^140%$/ })
      .first()
      .click();
    await page.waitForTimeout(800);
  }
  console.log(`\n=== ${cfg.name} ===`);
  for (const [route, selectors] of Object.entries(WATCH)) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    const report = await page.evaluate(
      ([sels]) => {
        const seen = [];
        for (const sel of sels) {
          for (const e of document.querySelectorAll(sel)) {
            const b = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            seen.push(
              `${sel} ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.x)},${Math.round(b.y)}` +
                ` r=${cs.borderRadius.split(" ")[0]}` +
                (cs.display === "none" ? " [display:none]" : "")
            );
          }
          if (!document.querySelector(sel)) seen.push(`${sel} absent`);
        }
        const screen = document.querySelector(".screen");
        const out = [];
        if (screen) {
          for (const e of screen.querySelectorAll("*")) {
            const b = e.getBoundingClientRect();
            if (b.width < 4 || b.height < 4) continue;
            if (b.right > window.innerWidth + 2 || b.left < -2) {
              out.push(`${String(e.className).slice(0, 40)} L${Math.round(b.left)} R${Math.round(b.right)}`);
            }
          }
        }
        return {
          seen,
          docScrollW: document.documentElement.scrollWidth,
          vw: window.innerWidth,
          escapes: [...new Set(out)].slice(0, 6),
        };
      },
      [selectors]
    );
    const bleed = report.docScrollW > report.vw + 1 ? ` PAGE-SCROLL-X ${report.docScrollW} > ${report.vw}` : "";
    console.log(`  ${route}${bleed}`);
    for (const line of report.seen) console.log(`     ${line}`);
    for (const line of report.escapes) console.log(`     OFF-VIEWPORT ${line}`);
  }
  await page.close();
}
await browser.close();
