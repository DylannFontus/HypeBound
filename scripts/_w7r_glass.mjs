/**
 * Is the glass plane actually there, and is it actually moving?
 *
 * The idle probe read `#settings` at 1.479 on one run and 0.588 on the next two,
 * and a measurement that swings 2.5x on an unchanged build is not a measurement.
 * Before tuning anything, the question is whether the layer the number depends
 * on is present and animating on every run — `--grain-src` is written by
 * `atmosphere.ts` at boot and skipped entirely on the low graphics tier, and a
 * glass plane with no `background-image` costs nothing and contributes nothing.
 *
 * Runs the same route N times in one browser, reporting the state of the plane
 * each time along with the current transform, sampled twice 200ms apart so a
 * paused animation is visible as a transform that did not change.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "settings";
const runs = Number(process.argv[3] ?? 4);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, "http://localhost:5173");

for (let i = 0; i < runs; i++) {
  await page.goto(`http://localhost:5173/?nointro#${route}`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const report = await page.evaluate(async () => {
    const root = document.documentElement;
    const grain = getComputedStyle(root).getPropertyValue("--grain-src");
    const el = document.querySelector(".d-room-glass-grain");
    if (!el) return { tier: root.dataset["gfxTier"], grainLen: grain.length, glass: false };
    const cs = getComputedStyle(el);
    const first = cs.transform;
    await new Promise((r) => setTimeout(r, 200));
    const second = getComputedStyle(el).transform;
    const anim = el.getAnimations()[0];
    return {
      tier: root.dataset["gfxTier"],
      grainLen: grain.length,
      glass: true,
      bg: cs.backgroundImage.slice(0, 20),
      opacity: cs.opacity,
      moved: first !== second,
      state: anim ? anim.playState : "none",
      reduced: root.dataset["reducedMotion"] ?? "-",
    };
  });
  console.log(`run ${i + 1}  ${JSON.stringify(report)}`);
}

await browser.close();
