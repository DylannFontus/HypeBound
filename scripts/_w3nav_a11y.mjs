/**
 * The accessibility contract for the navigation changes, checked rather than
 * assumed.
 *
 * Three things moved that this setting can see: the recede's blur became a
 * declaration instead of a keyframe, the entrance cascade became an attribute
 * the shell writes instead of a selector the stylesheet guesses, and the match
 * card's entrance is armed on the frame it is built. Reduced motion has an
 * opinion about all three, and none of them is visible to a screenshot of a
 * settled screen.
 *
 * So this drives real navigations with `reducedMotion` on, at both the desk and
 * the phone viewport, and reports the computed filter on the outgoing screen,
 * which keyframes actually ran, and whether the cascade fired.
 *
 *   node scripts/_w3nav_a11y.mjs
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
  [1600, 900],
  [1280, 720],
  [844, 390],
]) {
  for (const reduced of [false, true]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await seedPlayedAccount(page, ORIGIN);
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, { timeout: 30000 });
    /**
     * Through the app's own setter, not through `localStorage`.
     *
     * A hand-written key misses the store's version wrapper and is discarded on
     * load, which reads as "reduced motion had no effect" — the same trap
     * `lib/account.mjs` documents for the profile. `updateSettings` writes the
     * store *and* stamps `data-reduced-motion` on the root, so the answer is
     * true before the next navigation rather than after the next reload.
     */
    await page.evaluate(async (on) => {
      const settings = await import("/src/save/settings.ts");
      settings.updateSettings({ reducedMotion: on });
    }, reduced);
    await page.waitForTimeout(900);

    const seen = await page.evaluate(async () => {
      const w2 = window;
      w2.__names = new Set();
      document.addEventListener("animationstart", (e) => w2.__names.add(e.animationName), true);
      const sample = [];
      const tick = () => {
        const out = document.querySelector(".screen.screen-out, .screen[data-nav$='-out'], .screen[data-nav$='-hold']");
        if (out !== null) sample.push(getComputedStyle(out).filter);
        if (sample.length < 40) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      location.hash = "#missions";
      await new Promise((r) => setTimeout(r, 1400));
      return {
        reduced: document.documentElement.dataset.reducedMotion ?? "unset",
        names: [...w2.__names].filter((n) => n.startsWith("nav-")).sort(),
        filters: [...new Set(sample)],
        cascade: document.querySelectorAll(".missions-screen > [data-cascade] > [data-rise]").length,
        containers: document.querySelectorAll(".missions-screen > [data-cascade]").length,
      };
    });
    console.log(
      `${w}x${h} reduced=${String(reduced).padEnd(5)} root=${seen.reduced.padEnd(5)} ` +
        `cascade ${seen.cascade} risers in ${seen.containers} containers\n` +
        `    outgoing filter: ${seen.filters.join(" | ") || "never sampled"}\n` +
        `    nav keyframes:   ${seen.names.join(" ") || "none"}`
    );
    await page.close();
  }
}

await browser.close();
