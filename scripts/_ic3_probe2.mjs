/**
 * Three loose ends the playthrough raised, checked together.
 *
 * 1. The emote menu, which `screens.css` §O deliberately leaves out of the modal
 *    lacquer on the grounds that it "already carries a material class". On screen
 *    it reads as a square-cornered browser dropdown, so this asks the computed
 *    style rather than the comment.
 * 2. Whether the menus are alive at rest — §3's "idle is never dead" — measured
 *    as the set of infinite animations actually running on a settled screen.
 * 3. The scrollbar gutter, which lands in a different column on the records hub
 *    than it does on the settings hub.
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

// --- 2 + 3: idle life and scroller geometry, per route ----------------------
for (const r of ["lobby", "collection", "profile", "stats", "settings", "a11y", "shop", "pass", "missions", "play"]) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2800);
  console.log(
    r.padEnd(12),
    JSON.stringify(
      await page.evaluate(() => {
        const inf = document
          .getAnimations()
          .filter((a) => a.playState === "running" && a.effect?.getTiming?.().iterations === Infinity)
          .map((a) => a.animationName ?? "(web)");
        const scrollers = [...document.querySelectorAll(".screen, .screen *")]
          .filter((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY))
          .map((e) => {
            const b = e.getBoundingClientRect();
            return { cls: String(e.className).slice(0, 30), gutter: Math.round(b.width - e.clientWidth), right: Math.round(b.right) };
          });
        return { infinite: [...new Set(inf)], scrollers: scrollers.slice(0, 3) };
      })
    )
  );
}

// --- 1: the emote menu ------------------------------------------------------
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
if (await page.locator(".mulligan-actions .btn-primary").count()) await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
  .catch(() => {});
await page.waitForTimeout(1500);
await page.locator(".battle-controls .btn").first().click();
await page.waitForTimeout(700);
console.log(
  "EMOTE",
  JSON.stringify(
    await page.evaluate(() => {
      const e = document.querySelector(".emote-menu");
      if (!e) return { missing: true, all: [...document.querySelectorAll(".battle-overlay *")].map((x) => String(x.className)).slice(0, 8) };
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      return {
        cls: e.className,
        radius: cs.borderRadius,
        bgImage: cs.backgroundImage.slice(0, 70),
        bgColor: cs.backgroundColor,
        shadow: cs.boxShadow.slice(0, 130),
        border: cs.borderTopColor + " / " + cs.borderBottomColor,
        anim: cs.animationName,
        box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      };
    })
  ),
  null,
  1
);
await browser.close();
