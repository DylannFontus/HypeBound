/**
 * Reduced motion, forced colours and focus, checked on the assembled game.
 *
 * §3 makes reduced motion a hard requirement rather than a nicety, and the way
 * it usually fails is not "the animation still runs" but "the animation was the
 * only thing that made the element visible, so killing it leaves a hole". So
 * this asks two questions on the same page: does anything still animate, and is
 * every screen root still fully opaque and in place once nothing does.
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
await page.emulateMedia({ reducedMotion: "reduce" });
await seedPlayedAccount(page, ORIGIN);

for (const route of ["lobby", "collection", "shop", "settings"]) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const running = document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => (a.animationName ?? a.constructor.name) + "@" + String(a.effect?.target?.className ?? "").slice(0, 30));
    const screen = document.querySelector(".screen");
    const cs = screen ? getComputedStyle(screen) : null;
    const invisible = [...document.querySelectorAll(".screen *")].filter((e) => {
      const s = getComputedStyle(e);
      return parseFloat(s.opacity) < 0.05 && e.getBoundingClientRect().width > 40;
    }).length;
    return {
      runningAnimations: running.length,
      sample: [...new Set(running)].slice(0, 8),
      screenOpacity: cs?.opacity,
      screenTransform: cs?.transform,
      elementsStuckInvisible: invisible,
    };
  });
  console.log(route, JSON.stringify(r));
}

// Focus-visible, keyboard only.
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
for (let i = 0; i < 3; i += 1) await page.keyboard.press("Tab");
console.log(
  "FOCUS",
  JSON.stringify(
    await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const cs = getComputedStyle(a);
      return {
        tag: a.tagName,
        cls: String(a.className).slice(0, 50),
        outline: cs.outline,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow.slice(0, 90),
      };
    })
  )
);

await browser.close();
