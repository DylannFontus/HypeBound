/**
 * `steps(35)` bought 3.5x in the harness's own dose control and nothing at all
 * in the application. Which of the two is lying?
 *
 * The computed style says `steps(35)`, the census says one running animation,
 * the depth is five, and the route still measures 1.6fps where the model says
 * thirty. One of the model's terms is therefore wrong *for this layer*, and the
 * candidates are specific enough to separate:
 *
 *   A shipped
 *   B grain animation off (nothing at all animating on the page)
 *   C grain animation continuous again (linear) — is steps() doing anything?
 *   D grain animation at steps(35) but the tile replaced with a flat colour
 *   E grain kept, but its layer shrunk to a quarter of the viewport
 *   F grain kept, tile replaced by a plain gradient (no repeating PNG)
 *   G a synthetic layer built to imitate the grain, in the same document
 *
 * D and F are the interesting pair: the grain is the only layer in the game
 * whose background is a **repeating 96px PNG**, and a tiled bitmap is the one
 * kind of paint that a compositor may re-rasterise rather than re-blend.
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

const inject = (css) => {
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
};

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

const arm = async (label, css) => {
  await land();
  if (css) await page.evaluate(inject, css);
  await page.waitForTimeout(1200);
  const running = await page.evaluate(
    () => document.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length
  );
  const r = await page.evaluate(COUNT(2000));
  console.log(`${label.padEnd(46)}running=${String(running).padStart(2)}  ${JSON.stringify(r)}`);
};

await arm("A shipped (steps(35))", null);
await arm("B grain animation off", ".atm-fore-grain{animation:none !important}");
await arm("C grain continuous (linear)", ".atm-fore-grain{animation-timing-function:linear !important}");
await arm("D grain steps(6)", ".atm-fore-grain{animation-timing-function:steps(6) !important}");
await arm("E grain layer quartered", ".atm-fore-grain{inset:25% !important}");
await arm("F grain tile -> plain gradient", ".atm-fore-grain{background-image:linear-gradient(45deg,#fff2,#fff0) !important}");
await arm("G grain tile -> none, animation kept", ".atm-fore-grain{background-image:none !important}");
await arm("H shipped again (drift check)", null);

await browser.close();
