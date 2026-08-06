/**
 * Measure, rather than eyeball, what the phone-landscape battle board overlaps.
 *
 * A screenshot at 844x390 shows hand cards running off the bottom edge and the
 * Hype tracker sitting on top of one — but "looks like it overlaps" is exactly
 * the claim a critic should not make from a still, because a card can be behind
 * a transparent region and read as clipped when it is not. This intersects the
 * real boxes and reports the numbers, at three landscape sizes, so the finding
 * survives an argument.
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

for (const [w, h] of [
  [844, 390],
  [915, 412],
  [1280, 720],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count())
    await page.click(".mulligan-actions .btn-primary");
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
    .catch(() => {});
  await page.waitForTimeout(2200);

  console.log(
    JSON.stringify(
      await page.evaluate(
        ([vw, vh]) => {
          const box = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, bo: b.bottom };
          };
          const overlap = (a, b) => {
            const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x);
            const oy = Math.min(a.bo, b.bo) - Math.max(a.y, b.y);
            return ox > 0 && oy > 0 ? Math.round(ox) + "x" + Math.round(oy) : null;
          };
          const cards = [...document.querySelectorAll(".hand-card")].map(box);
          const named = {};
          for (const sel of [".hype-wrap", ".ability-bar", ".leader-plate-player", ".turn-wrap", ".history-panel"]) {
            const e = document.querySelector(sel);
            if (e) named[sel] = box(e);
          }
          const clipped = cards
            .map((c, i) => ({ i, below: Math.round(c.bo - vh), right: Math.round(c.r - vw) }))
            .filter((c) => c.below > 2 || c.right > 2);
          const collisions = [];
          cards.forEach((c, i) => {
            for (const [sel, n] of Object.entries(named)) {
              const o = overlap(c, n);
              if (o) collisions.push({ card: i, over: sel, area: o });
            }
          });
          return {
            viewport: `${vw}x${vh}`,
            hand: cards.length,
            cardsClippedByViewport: clipped,
            hudOverHand: collisions,
            hypeWrap: named[".hype-wrap"] && {
              x: Math.round(named[".hype-wrap"].x),
              y: Math.round(named[".hype-wrap"].y),
              w: Math.round(named[".hype-wrap"].w),
            },
            matBox: window.hypeboundBattle?.debug()?.matBox ?? null,
          };
        },
        [w, h]
      ),
      null,
      1
    )
  );
  await page.close();
}
await browser.close();
