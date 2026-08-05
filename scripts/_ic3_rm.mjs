/**
 * Name the elements the Collection leaves invisible under reduced motion.
 *
 * `_ic_a11y.mjs` counts them, which is enough to know something is wrong and not
 * enough to fix it. Reduced motion fails in exactly one interesting way — the
 * animation was the only thing setting the element's final opacity, so killing
 * it strands the element at `from` — and the fix depends entirely on which
 * element and which keyframe. This prints both, and photographs the result.
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
const dir = "scripts/screenshots/w4/ic3/rm";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.emulateMedia({ reducedMotion: "reduce" });
await seedPlayedAccount(page, ORIGIN);

for (const route of ["collection", "lobby", "pass", "battle"]) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  if (route === "battle") {
    await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count())
      await page.click(".mulligan-actions .btn-primary");
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
  }
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(dir, `${route}.png`) });
  console.log(
    route,
    JSON.stringify(
      await page.evaluate(() => {
        const running = document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => ({
            name: a.animationName ?? "(web-anim)",
            on: String(a.effect?.target?.className ?? a.effect?.target?.tagName ?? "").slice(0, 44),
            dur: Math.round(a.effect?.getTiming?.().duration ?? 0),
            iter: a.effect?.getTiming?.().iterations,
          }));
        const invisible = [...document.querySelectorAll(".screen *, .battle-hud *")]
          .filter((e) => {
            const s = getComputedStyle(e);
            return parseFloat(s.opacity) < 0.05 && e.getBoundingClientRect().width > 40;
          })
          .map((e) => ({
            cls: String(e.className).slice(0, 50),
            text: (e.textContent ?? "").trim().slice(0, 40),
            anim: getComputedStyle(e).animationName,
          }));
        return { running: running.slice(0, 8), runningCount: running.length, invisible };
      })
    )
  );
}
await browser.close();
