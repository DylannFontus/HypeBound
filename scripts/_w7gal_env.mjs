/**
 * What the idle probe is actually looking at.
 *
 * The brief quotes a gallery idle floor of 0.195 and a lobby of 3.01; the same
 * instrument in this session reads 0.037 and 0.548. Before trusting either
 * number as an absolute, the environment has to be printed: a headless Chrome
 * that resolves to the **low** graphics tier loses `.mat-panel .mat-panel::after`
 * outright, and a page that has settled into reduced motion loses every sheen in
 * the game — both of which would divide every reading by roughly the same factor
 * and look exactly like a calibration difference.
 *
 * This prints the tier, the reduced-motion flag, and how many infinite
 * animations are actually *running* per route. It answers "is the screen dead or
 * is the camera blind", which is the question this project has got wrong eight
 * times.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const routes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, "http://localhost:5173");

for (const route of routes.length ? routes : ["lobby", "gallery", "collection"]) {
  await page.goto(`http://localhost:5173/?nointro#${route}`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const row = await page.evaluate(() => {
    const anims = document.getAnimations();
    const running = anims.filter((a) => a.playState === "running");
    const infinite = running.filter((a) => {
      try {
        return a.effect.getComputedTiming().iterations === Infinity;
      } catch {
        return false;
      }
    });
    const names = {};
    for (const a of infinite) {
      const key = a.animationName ?? "(waapi)";
      names[key] = (names[key] ?? 0) + 1;
    }
    const screen = document.querySelector(".screen");
    return {
      tier: document.documentElement.dataset.gfxTier ?? "(unset)",
      reducedMotion: document.documentElement.dataset.reducedMotion ?? "(unset)",
      animations: anims.length,
      running: running.length,
      infinite: infinite.length,
      byName: names,
      screenNodes: screen ? screen.querySelectorAll("*").length : 0,
    };
  });
  console.log(`#${route}`.padEnd(14), JSON.stringify(row));
}

await browser.close();
