/**
 * Do cards actually come out of the deck?
 *
 * `handBar.aimAtPile` points a new card's entrance at `--pile-deck-*`, which
 * `battleView` projects every sync. If either half is missing the keyframe
 * silently falls back to a 40px rise out of nothing — which looks deliberate and
 * is not, and is exactly the sort of thing a still cannot show. This records the
 * `--from-*` each arriving card was actually given.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const b = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(p, "http://localhost:5173");
await p.goto("http://localhost:5173/?nointro#battle", { waitUntil: "networkidle" });
await p.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
if (await p.locator(".mulligan-actions .btn-primary").count()) await p.click(".mulligan-actions .btn-primary");
await p
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
  .catch(() => {});
await p.waitForTimeout(1500);

const piles = await p.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return ["--pile-deck-x", "--pile-deck-y", "--pile-discard-x", "--pile-discard-y"].map(
    (k) => `${k}=${s.getPropertyValue(k).trim() || "(unset)"}`
  );
});

await p.evaluate(() => {
  window.__arrivals = [];
  document.addEventListener(
    "animationstart",
    (e) => {
      if (e.animationName !== "hand-card-in") return;
      const el = e.target;
      window.__arrivals.push({
        from: [el.style.getPropertyValue("--from-x"), el.style.getPropertyValue("--from-y")],
        delay: getComputedStyle(el).animationDelay,
      });
    },
    true
  );
});
const handBefore = await p.locator(".hand-card").count();
await p.click(".end-turn-btn");
await p.waitForTimeout(16000);
const arrivals = await p.evaluate(() => window.__arrivals);
const handAfter = await p.locator(".hand-card").count();
const turn = await p.evaluate(() => {
  const v = window.hypeboundBattle.view();
  return { activeSeat: v.activeSeat, seat: v.seat, phase: v.phase, hand: v.you.hand.length, deck: v.you.deckCount };
});
console.log(JSON.stringify({ piles, handBefore, handAfter, turn, arrivals }, null, 1));
await b.close();
