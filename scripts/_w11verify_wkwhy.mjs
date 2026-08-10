/**
 * WebKit runs a blank page at 63fps and this application at 0.7fps. Which part
 * of the application?
 *
 * The previous probe (`_w11verify_webkit.mjs`) established that Playwright's
 * WebKit 26.5 has a working display link — 63.1fps on `setContent`, on the same
 * `page` object, in the same context, moments before the app arm read 0.7fps.
 * That kills the blanket claim the iPad work rests on. It does not yet say
 * *why*, and there are two very different answers:
 *
 * - **Software WebGL.** Headless WebKit on Windows has no GPU. `three.js` and
 *   the atmosphere may be painting through a software rasteriser that a real
 *   iPad would never use, in which case 0.7fps is an artefact of this machine
 *   and says nothing about Safari.
 * - **The CSS compositing load.** If a route that creates no WebGL context is
 *   also at 0.7fps, then it is the stylesheet and not the renderer, and that
 *   travels to a real iPad — because it is the same demand the layer census
 *   counts.
 *
 * So this counts WebGL contexts per route and times each one. The counter is
 * installed before any app code runs, because a context created during boot is
 * invisible to a probe that starts looking afterwards.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTES = ["lobby", "settings", "fairness", "collection"];

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

/** Before any app code: tally every WebGL context the page ever asks for. */
await ctx.addInitScript(() => {
  const w = /** @type {any} */ (window);
  w.__gl = 0;
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (typeof type === "string" && type.includes("webgl")) w.__gl++;
    return real.call(this, type, ...rest);
  };
});

const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 120)));

await page.setContent("<h1>control</h1>");
console.log("control (blank)     " + JSON.stringify(await page.evaluate(COUNT(1000))));

await seedPlayedAccount(page);

for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => ({
    gl: /** @type {any} */ (window).__gl,
    canvases: document.querySelectorAll("canvas").length,
    visibility: document.visibilityState,
    tier: document.documentElement.dataset.gfxTier ?? "(unset)",
  }));
  const timing = await page.evaluate(COUNT(2000));
  console.log(
    `${route.padEnd(12)} ${JSON.stringify(timing).padEnd(34)} webglContexts=${state.gl} canvases=${state.canvases} visibility=${state.visibility} tier=${state.tier}`
  );
}

await browser.close();
