/**
 * Does a SMALL mover pay for the whole full-bleed stack, or only for its own
 * damaged region?
 *
 * This decides one concrete question — whether `foundation.css` may keep the
 * hero's idle sheen on the low tier — and it generalises to every small
 * animation in the game. The stack curve in `_w12budget_stack.mjs` was measured
 * with a full-bleed mover, so it says nothing about a 120px button.
 *
 * If a small mover is cheap over a deep stack, the compositor is damaging only
 * the region under it and the budget's rate term should be weighted by area.
 * If it costs the same as a full-bleed one, the damage is the whole viewport
 * whatever moved, and every animation anywhere is charged for every full-screen
 * layer in the document.
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

const BUILD = (statics, kind) => `
  (() => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent =
      "@keyframes dA{from{transform:translate3d(0,0,0)}to{transform:translate3d(96px,96px,0)}}" +
      ".L{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%)}" +
      ".S{position:fixed;left:40px;top:40px;width:140px;height:48px;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);will-change:transform}" +
      ".B{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%);will-change:transform}";
    document.head.appendChild(style);
    for (let i = 0; i < ${statics}; i++) {
      const d = document.createElement("div");
      d.className = "L";
      document.body.appendChild(d);
    }
    const kind = ${JSON.stringify(kind)};
    if (kind !== "none") {
      const d = document.createElement("div");
      d.className = kind === "small" ? "S" : "B";
      d.style.animation = "dA 7s linear infinite alternate";
      document.body.appendChild(d);
    }
    return document.getAnimations({ subtree: true }).length;
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

const run = async (statics, kind) => {
  await page.setContent("<h1>arm</h1>");
  await page.evaluate(BUILD(statics, kind));
  await page.waitForTimeout(600);
  const r = await page.evaluate(COUNT(1500));
  console.log(`  static=${String(statics).padStart(2)}  mover=${kind.padEnd(6)}  fps=${String(r.fps).padStart(5)}  worstGap=${String(r.worstGapMs).padStart(5)}ms`);
};

await page.setContent("<h1>null</h1>");
console.log("null arm  " + JSON.stringify(await page.evaluate(COUNT(1500))));

for (const s of [0, 4, 8, 16]) {
  console.log("");
  for (const kind of ["none", "small", "bleed"]) await run(s, kind);
}

await page.setContent("<h1>null</h1>");
console.log("\nnull arm again  " + JSON.stringify(await page.evaluate(COUNT(1500))));
await browser.close();
