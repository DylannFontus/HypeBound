/**
 * Does the board actually fit the phone?
 *
 * The 844x390 landscape target is a hard constraint (AAA-BAR §9) and it is the
 * one viewport nobody looks at, because every screenshot review is taken at
 * 1600x900. This measures the three collisions the bar cares about rather than
 * describing them: the player's own medallion against the hand, the rival's
 * medallion against its nameplate, and the mat's rim against the frame.
 *
 * Everything is read out of the live page — the medallions are 3D objects, so
 * their screen boxes come from the same `project()` the DOM anchors use, not
 * from a guess about where the camera put them.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const sizes = (process.argv[2] ?? "844x390,1280x720,1600x900").split(",");
const hoverIndex = Number(process.argv[3] ?? -1);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const size of sizes) {
  const [w, h] = size.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count()) {
      await page.click(".mulligan-actions .btn-primary");
    }
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1400);

    if (hoverIndex >= 0) {
      const cards = page.locator(".hand-card");
      const n = await cards.count();
      if (hoverIndex < n) await cards.nth(hoverIndex).hover();
      await page.waitForTimeout(400);
    }

    const out = await page.evaluate(() => {
      const battle = window.hypeboundBattle;
      const dbg = battle?.debug?.() ?? {};
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const overlap = (a, b) => {
        if (!a || !b) return 0;
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        return ox * oy;
      };
      const cards = [...document.querySelectorAll(".hand-card")].map((el) => ({
        rect: rect(el),
        cls: el.className,
      }));
      const plates = {
        enemy: rect(document.querySelector(".leader-plate-enemy")),
        player: rect(document.querySelector(".leader-plate-player")),
      };
      const rail = rect(document.querySelector(".ability-rail"));
      const medallions = dbg.medallions ?? null;
      const matBox = dbg.matBox ?? null;
      const result = {
        viewport: { w: innerWidth, h: innerHeight },
        insets: {
          top: getComputedStyle(document.documentElement).getPropertyValue("--board-inset-top").trim(),
          bottom: getComputedStyle(document.documentElement).getPropertyValue("--board-inset-bottom").trim(),
        },
        medallions,
        matBox,
        plates,
        rail,
        handTop: Math.min(...cards.map((c) => c.rect.y)),
        handCount: cards.length,
        cardTone: cards.map((c) => ({
          playable: c.cls.includes("playable") && !c.cls.includes("unplayable"),
          filter: getComputedStyle(document.querySelector(`.hand-card`)).filter.slice(0, 60),
        }))[0],
      };
      if (medallions) {
        result.collisions = {
          playerMedallionVsHand: Math.max(
            ...cards.map((c) => overlap(medallions.player, c.rect)),
            0
          ),
          playerMedallionVsRail: overlap(medallions.player, rail),
          playerMedallionVsPlate: overlap(medallions.player, plates.player),
          enemyMedallionVsPlate: overlap(medallions.enemy, plates.enemy),
        };
        result.crop = matBox
          ? {
              top: matBox.y < 0 ? -matBox.y : 0,
              bottom: matBox.y + matBox.h > innerHeight ? matBox.y + matBox.h - innerHeight : 0,
              left: matBox.x < 0 ? -matBox.x : 0,
              right: matBox.x + matBox.w > innerWidth ? matBox.x + matBox.w - innerWidth : 0,
            }
          : null;
      }
      return result;
    });
    console.log(size, JSON.stringify(out, null, 1));
  } catch (error) {
    console.log(size, "FAILED", error.message);
  } finally {
    await page.close();
  }
}
await browser.close();
