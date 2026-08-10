/**
 * Is it the animation COUNT, or the animated AREA?
 *
 * `_w12budget_census.mjs` measured a dose-response on this harness that is far
 * too steep to be a description of an iPad: **four** cheap full-bleed layers,
 * animating nothing but `transform` and `opacity`, take WebKit from 62.3fps to
 * 7.8. No tablet behaves like that. But the curve is real and repeatable, and
 * before anything is built on it the mechanism has to be pinned down, because
 * the two candidate mechanisms imply opposite fixes:
 *
 * - **Count.** Every running animation costs a fixed scheduling/commit price.
 *   The fix is to run fewer animations, whatever size they are.
 * - **Area.** Every *composited full-bleed* layer costs a rasterisation of the
 *   viewport per frame. The fix is to shrink or remove the big surfaces and the
 *   count is close to irrelevant.
 *
 * Three arms, same clock, same context, interleaved with a null arm so a
 * monotonic slowdown cannot be read as a result:
 *
 *   SMALL  — n animated 120x120 boxes. High count, negligible area.
 *   BLEED  — n animated full-viewport layers. Same count, ~n viewports of area.
 *   STATIC — n full-viewport layers, promoted, but NOT animating.
 *
 * If SMALL stays fast while BLEED collapses, the brief's framing — "the number
 * of running animations is the cause" — is wrong in its literal form and right
 * in its consequence, and the budget has to be written in square pixels.
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

const BUILD = (n, kind) => `
  (() => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent =
      "@keyframes dA{from{transform:translate3d(0,0,0)}to{transform:translate3d(40px,40px,0)}}" +
      "@keyframes dB{0%,100%{opacity:.4}50%{opacity:1}}" +
      ".bleed{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%);will-change:transform,opacity}" +
      ".small{position:fixed;left:10px;top:10px;width:120px;height:120px;pointer-events:none;background:radial-gradient(circle,rgba(180,120,255,.3),transparent 70%);will-change:transform,opacity}";
    document.head.appendChild(style);
    for (let i = 0; i < ${n}; i++) {
      const d = document.createElement("div");
      d.className = ${JSON.stringify(kind)} === "small" ? "small" : "bleed";
      if (${JSON.stringify(kind)} === "small") { d.style.left = (10 + (i % 8) * 130) + "px"; d.style.top = (10 + Math.floor(i / 8) * 130) + "px"; }
      if (${JSON.stringify(kind)} !== "static") {
        d.style.animation = "dA " + (7 + i % 11) + "s linear infinite alternate, dB " + (4 + i % 7) + "s ease-in-out infinite";
      } else {
        d.style.transform = "translate3d(0,0,0)";
      }
      document.body.appendChild(d);
    }
    return document.getAnimations({ subtree: true }).length;
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

const run = async (kind, n) => {
  await page.setContent("<h1>arm</h1>");
  const declared = await page.evaluate(BUILD(n, kind));
  await page.waitForTimeout(600);
  const r = await page.evaluate(COUNT(1500));
  console.log(`  ${kind.padEnd(7)} n=${String(n).padStart(3)}  animations=${String(declared).padStart(3)}  fps=${String(r.fps).padStart(5)}  worstGap=${r.worstGapMs}ms`);
  return r.fps;
};

console.log("null arm (blank)");
await page.setContent("<h1>null</h1>");
console.log("  " + JSON.stringify(await page.evaluate(COUNT(1500))));

console.log("\nSMALL — high count, negligible area");
for (const n of [4, 16, 40, 80]) await run("small", n);

console.log("\nBLEED — same counts, ~n viewports of animated area");
for (const n of [1, 2, 4, 8, 16]) await run("bleed", n);

console.log("\nSTATIC — full-bleed promoted layers that do not animate");
for (const n of [4, 16, 40]) await run("static", n);

console.log("\nnull arm again (drift check)");
await page.setContent("<h1>null</h1>");
console.log("  " + JSON.stringify(await page.evaluate(COUNT(1500))));

await browser.close();
