/**
 * Is a full-bleed layer charged for *moving*, or for *having an animation*?
 *
 * This is the question the whole budget turns on. `_w12budget_area.mjs` proved
 * the price is paid per viewport-sized layer that animates, and that a promoted
 * full-bleed layer which does not animate is free. Between those two states
 * there is a third the stylesheet can reach: a layer whose animation is running
 * but whose value is **unchanged on most frames**.
 *
 *   CONT     — the shipped shape: a continuous 7s transform.
 *   SLOW     — the same transform over 200s. Still changing every frame, but by
 *              a hundredth of the distance. If cost tracks displacement, this is
 *              cheap; if it tracks "an animation is active", it is not.
 *   STEPS    — `steps(n)`: the animation is running and the computed transform
 *              is identical on all but n frames of the period.
 *   PAUSED   — `animation-play-state: paused`, the state §1.8 uses for a hidden
 *              tab. The animation exists and holds one value forever.
 *   DISCRETE — no CSS animation at all; a `setInterval` writes a new transform
 *              four times a second. The layer is genuinely static in between.
 *
 * The winner among SLOW / STEPS / PAUSED / DISCRETE decides whether the film
 * grain — the one layer this project has measured as load-bearing for "alive at
 * rest" on all forty-nine routes — can be kept at all on a constrained device,
 * or whether keeping it means keeping the stall.
 */
import { webkit } from "playwright-core";

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

const BUILD = (n, mode) => `
  (() => {
    for (const t of window.__timers ?? []) clearInterval(t);
    window.__timers = [];
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent =
      "@keyframes dA{from{transform:translate3d(0,0,0)}to{transform:translate3d(96px,96px,0)}}" +
      ".bleed{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%);will-change:transform}";
    document.head.appendChild(style);
    const mode = ${JSON.stringify(mode)};
    const nodes = [];
    for (let i = 0; i < ${n}; i++) {
      const d = document.createElement("div");
      d.className = "bleed";
      if (mode === "cont")     d.style.animation = "dA 7s linear infinite alternate";
      if (mode === "slow")     d.style.animation = "dA 200s linear infinite alternate";
      if (mode === "steps")    d.style.animation = "dA 7s steps(12) infinite alternate";
      if (mode === "paused") { d.style.animation = "dA 7s linear infinite alternate"; d.style.animationPlayState = "paused"; }
      if (mode === "discrete") d.style.transform = "translate3d(0,0,0)";
      document.body.appendChild(d);
      nodes.push(d);
    }
    if (mode === "discrete") {
      let k = 0;
      window.__timers.push(setInterval(() => {
        k = (k + 1) % 12;
        for (const d of nodes) d.style.transform = "translate3d(" + (k * 8) + "px," + (k * 8) + "px,0)";
      }, 250));
    }
    return document.getAnimations({ subtree: true }).length;
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

const run = async (mode, n) => {
  await page.setContent("<h1>arm</h1>");
  const declared = await page.evaluate(BUILD(n, mode));
  await page.waitForTimeout(700);
  const r = await page.evaluate(COUNT(1800));
  console.log(`  ${mode.padEnd(9)} n=${String(n).padStart(2)}  runningAnims=${String(declared).padStart(2)}  fps=${String(r.fps).padStart(5)}  worstGap=${String(r.worstGapMs).padStart(5)}ms`);
};

await page.setContent("<h1>null</h1>");
console.log("null arm  " + JSON.stringify(await page.evaluate(COUNT(1500))));

for (const n of [1, 4, 8]) {
  console.log(`\nn=${n} full-bleed layers`);
  for (const mode of ["cont", "slow", "steps", "paused", "discrete"]) await run(mode, n);
}

await page.setContent("<h1>null</h1>");
console.log("\nnull arm again (drift check)  " + JSON.stringify(await page.evaluate(COUNT(1500))));

await browser.close();
