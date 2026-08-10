/**
 * What the idle sheen costs, charged separately from the world.
 *
 * `_w12budget_why.mjs` cleared the atmosphere off the suspect list: with the
 * budget applied, deleting both world planes outright moves a settled route from
 * 1.1fps to 2.4, while cancelling every animation in the document moves it to
 * 42.9. Whatever is left is not the backdrop.
 *
 * What is left is `foundation.css`'s idle sheen — `hb-sheen-pass`, an infinite
 * band on the `::after` of every `.mat-hero`, `.mat-panel` and `.mat-chip` in
 * the game, added so that §3a's "the screen is alive at rest" would be answered
 * by the materials and not only by the backdrop. It is one animation per plate
 * and a screen has between six and forty of them.
 *
 * Arms, interleaved with the shipped state:
 *   1 shipped
 *   2 sheen off on panels and chips only
 *   3 sheen off everywhere (hero too)
 *   4 sheen off everywhere AND the world's remaining clock stopped
 *   5 sheen quantised to steps(20) rather than removed
 *   6 sheen kept, everything else in the document stopped
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTES = (process.argv[2] ?? "settings,lobby").split(",");

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

const inject = (css) => {
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
};

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

await page.setContent("<h1>control</h1>");
console.log("CONTROL blank  " + JSON.stringify(await page.evaluate(COUNT(1500))));
await seedPlayedAccount(page);

for (const route of ROUTES) {
  console.log(`\n=== ${route}`);
  const land = async () => {
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
  };

  await land();
  console.log(
    "  plates: " +
      JSON.stringify(
        await page.evaluate(() => ({
          hero: document.querySelectorAll(".mat-hero").length,
          panel: document.querySelectorAll(".mat-panel").length,
          chip: document.querySelectorAll(".mat-chip").length,
          sheenRunning: document
            .getAnimations({ subtree: true })
            .filter((a) => a.animationName === "hb-sheen-pass" && a.playState === "running").length,
        }))
      )
  );

  const arm = async (label, css, extra) => {
    await land();
    if (css) await page.evaluate(inject, css);
    if (extra) await page.evaluate(extra);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(COUNT(2000));
    console.log(`  ${label.padEnd(40)}${JSON.stringify(r)}`);
  };

  await arm("1 shipped", null);
  await arm("2 sheen off: panel + chip", ".mat-panel::after,.mat-chip::after{animation:none !important}");
  await arm("3 sheen off: all three", ".mat-hero::after,.mat-panel::after,.mat-chip::after{animation:none !important}");
  await arm(
    "4 sheen off + world clock stopped",
    ".mat-hero::after,.mat-panel::after,.mat-chip::after,.atm-fore-grain{animation:none !important}"
  );
  await arm("5 sheen quantised steps(20)", ".mat-hero::after,.mat-panel::after,.mat-chip::after{animation-timing-function:steps(20) !important}");
  await arm("6 only the sheen left running", null, () => {
    for (const a of document.getAnimations({ subtree: true })) if (a.animationName !== "hb-sheen-pass") a.cancel();
  });
  await arm("7 shipped again (drift check)", null);
}

await browser.close();
