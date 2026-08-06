/**
 * Does the panel's new scroll container clip a lifted card?
 *
 * `overflow-y: auto` on `.mulligan-panel` establishes a clip whether or not
 * anything is scrolling, and `.mulligan-card:hover` lifts the card 10px and
 * lengthens its drop shadow to a 24px blur thrown 7px right and 12px down. If
 * the panel's padding box is tighter than that, the repair would have bought a
 * reachable button at the cost of the one effect that says the cards are
 * objects — §1's contact-shadow bullet, and the thing the tray exists for.
 *
 * So this hovers a real pointer over the first and the last card, and reports
 * the headroom on all four sides in pixels: how far the card's own box, plus
 * the shadow's reach, sits inside the panel's clip. Negative is a clip.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const DIR = "scripts/screenshots/w9/mulligan";
mkdirSync(DIR, { recursive: true });

/* The furthest the hover shadow reaches beyond the card's own box, from the
   `drop-shadow(7px 12px 24px)` in `.mulligan-card:hover`. */
const REACH = { top: 24 - 12, right: 24 + 7, bottom: 24 + 12, left: 24 - 7 };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await seedPlayedAccount(page, ORIGIN);

for (const route of ["battle?seed=4", "remix"]) {
  const sep = route.includes("?") ? "&" : "?";
  await page.goto(`${ORIGIN}/?nointro#${route}${sep}r=${Date.now()}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0);
  await page.waitForTimeout(900);

  for (const which of [0, -1]) {
    const point = await page.evaluate((i) => {
      const cards = [...document.querySelectorAll(".mulligan-card")];
      const el = i < 0 ? cards[cards.length - 1] : cards[i];
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }, which);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(420);
    const r = await page.evaluate(
      (reach) => {
        const panel = document.querySelector(".mulligan-panel");
        const card = document.querySelector(".mulligan-card:hover");
        if (!card) return { error: "nothing is hovered" };
        const cs = getComputedStyle(panel);
        const pb = panel.getBoundingClientRect();
        // the clip an `overflow` establishes is the padding box
        const clip = {
          top: pb.top + parseFloat(cs.borderTopWidth),
          bottom: pb.bottom - parseFloat(cs.borderBottomWidth),
          left: pb.left + parseFloat(cs.borderLeftWidth),
          right: pb.right - parseFloat(cs.borderRightWidth),
        };
        const b = card.getBoundingClientRect();
        return {
          overflow: `${cs.overflowX}/${cs.overflowY}`,
          panelScrolls: panel.scrollHeight > panel.clientHeight + 2,
          lifted: getComputedStyle(card).transform !== "none",
          headroom: {
            top: Math.round(b.top - reach.top - clip.top),
            right: Math.round(clip.right - (b.right + reach.right)),
            bottom: Math.round(clip.bottom - (b.bottom + reach.bottom)),
            left: Math.round(b.left - reach.left - clip.left),
          },
        };
      },
      REACH
    );
    console.log(`${route.padEnd(15)} card ${which === 0 ? "first" : "last "}  ${JSON.stringify(r)}`);
    await page.screenshot({
      path: path.join(DIR, `hover-${route.replace(/\W+/g, "-")}-${which === 0 ? "first" : "last"}.png`),
    });
    await page.mouse.move(4, 4);
    await page.waitForTimeout(250);
  }
}
await browser.close();
