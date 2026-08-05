/**
 * The camera, with a finger on it.
 *
 * `shot.mjs` photographs with a mouse, and the whole touch floor lives behind
 * `@media (pointer: coarse)` — so the one thing this pass changes is invisible
 * to the project's own camera. This is the same idea with `hasTouch` on, so a
 * 44px control can actually be looked at rather than only measured.
 *
 *   node scripts/_w5a11y_shot.mjs <dir> <WxH> [scale] <route> [route...]
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [dirArg, sizeArg, scaleArg, ...routes] = process.argv.slice(2);
const outDir = path.join(HERE, "screenshots", dirArg);
mkdirSync(outDir, { recursive: true });
const [w, h] = sizeArg.split("x").map(Number);
const uiScale = Number(scaleArg);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await seedPlayedAccount(page);

for (const route of routes) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  if (route.startsWith("battle")) {
    // through the mulligan, so the picture is of a live board rather than a curtain
    await page.waitForSelector(".mulligan-panel", { timeout: 20000 }).catch(() => {});
    await page.locator(".mulligan-confirm, .mulligan-actions .btn").first().click().catch(() => {});
    await page.waitForTimeout(3200);
  }
  if (uiScale !== 1) await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), uiScale);
  await page
    .waitForFunction(
      () =>
        document.getAnimations().filter((a) => {
          if (a.playState !== "running") return false;
          const t = a.effect?.getTiming?.();
          return Boolean(t) && t.iterations !== Infinity;
        }).length === 0,
      null,
      { timeout: 6000 }
    )
    .catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${route.replace(/[^a-z0-9]+/gi, "-")}-${w}x${h}${uiScale === 1 ? "" : `-s${String(uiScale).replace(".", "")}`}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

await browser.close();
