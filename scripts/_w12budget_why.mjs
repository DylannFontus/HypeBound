/**
 * The budget removed two thirds of the animated area and the frame rate did not
 * move. So the model from §0a is incomplete, and this finds the rest of it.
 *
 * What is known: a blank page is 63fps, this app is ~1fps, `animation: none`
 * buys 33-39fps, and `data-reduced-motion="true"` buys 62.5. That last pair is
 * the clue nobody has followed — the two are not the same intervention, and the
 * gap between 39 and 62.5 is a cost that has nothing to do with animation at
 * all. Reduced motion additionally removes `.atmosphere-fore` outright.
 *
 * Arms, each applied to a settled route, all in one page, with the shipped state
 * re-measured at the end so drift cannot be read as a result:
 *
 *   0 confirm the step override actually landed
 *   1 shipped
 *   2 .atmosphere-fore removed          (what reduced motion also does)
 *   3 .atmosphere removed
 *   4 both removed
 *   5 every animation stopped, layers left standing
 *   6 the grain's background-image cleared, everything else intact
 *   7 both atmosphere planes' background-images cleared
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTE = process.argv[2] ?? "settings";

const COUNT = (ms) => `
  (() => new Promise((resolve) => {
    let frames = 0, worst = 0, last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
      if (now - t0 < ${ms}) requestAnimationFrame(tick);
      else resolve({ fps: +(frames / ((now - t0) / 1000)).toFixed(1), worstGapMs: Math.round(worst) });
    };
    requestAnimationFrame(tick);
  }))()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 120)));

await page.setContent("<h1>control</h1>");
console.log("CONTROL blank  " + JSON.stringify(await page.evaluate(COUNT(1500))));

await seedPlayedAccount(page);

const land = async () => {
  await page.goto(`${ORIGIN}/#${ROUTE}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
};

await land();
console.log(
  "\nstep override landed? " +
    JSON.stringify(
      await page.evaluate(() => {
        const g = document.querySelector(".atm-fore-grain");
        return {
          tier: document.documentElement.dataset.gfxTier,
          grainTiming: g ? getComputedStyle(g).animationTimingFunction : "(no element)",
          grainAnim: g ? getComputedStyle(g).animationName : "-",
          gridTiming: getComputedStyle(document.querySelector(".atm-grid"), "::after").animationName,
          moteMid: getComputedStyle(document.querySelector(".atm-motes-mid"), "::after").animationName,
          bloom: getComputedStyle(document.querySelector(".atm-bloom")).animationName,
        };
      })
    )
);

const arm = async (label, prepare) => {
  await land();
  if (prepare) await page.evaluate(prepare);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(COUNT(2000));
  console.log(`${label.padEnd(38)}${JSON.stringify(r)}`);
};

await arm("1 shipped", null);
await arm("2 .atmosphere-fore removed", () => document.querySelectorAll(".atmosphere-fore").forEach((n) => n.remove()));
await arm("3 .atmosphere removed", () => document.querySelectorAll(".atmosphere").forEach((n) => n.remove()));
await arm("4 both removed", () => document.querySelectorAll(".atmosphere,.atmosphere-fore").forEach((n) => n.remove()));
await arm("5 all animations stopped", () => {
  for (const a of document.getAnimations({ subtree: true })) a.cancel();
});
await arm("6 grain image cleared", () => {
  document.documentElement.style.setProperty("--grain-src", "none");
});
await arm("7 all world background-images cleared", () => {
  const s = document.createElement("style");
  s.textContent = ".atmosphere *,.atmosphere *::after,.atmosphere-fore *,.atmosphere-fore *::after{background-image:none !important}";
  document.head.appendChild(s);
});
await arm("8 shipped again (drift check)", null);

await browser.close();
