/**
 * The term the first model missed: what does ONE animated layer cost when there
 * are N static full-bleed layers underneath it?
 *
 * Three measurements that only make sense together:
 *
 *   16 static full-bleed layers, none animating ............. 62.4 fps
 *   1 full-bleed layer animating, nothing else on the page ... 23.2 fps
 *   the application, one animated layer left running ......... 1.0 fps
 *
 * The application's single animated layer is twenty-five times more expensive
 * than the harness's own. The obvious remaining difference is what is underneath
 * it: HYPEBOUND stacks fifteen-odd full-viewport surfaces — two room slots,
 * their washes and blooms and horizons, the deep plane, the grid, three mote
 * fields, a sweep, two vignettes, the front plane's grain — and a blank page
 * stacks none.
 *
 * If cost scales with the depth of the stack under the damaged region, then
 * static layers are only free while *nothing moves above them*, and the budget
 * in §0a is incomplete in an important way: it is not enough to stop animating
 * a layer, the layer itself has to go. That is a different and much stronger
 * instruction, so it needs measuring rather than assuming.
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

/** `statics` full-bleed layers that never move, plus `movers` that do. */
const BUILD = (statics, movers, opaque) => `
  (() => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent =
      "@keyframes dA{from{transform:translate3d(0,0,0)}to{transform:translate3d(96px,96px,0)}}" +
      ".L{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%)}" +
      ".O{background:linear-gradient(160deg,#120c22,#07040f)}";
    document.head.appendChild(style);
    for (let i = 0; i < ${statics}; i++) {
      const d = document.createElement("div");
      d.className = ${opaque} && i === 0 ? "L O" : "L";
      document.body.appendChild(d);
    }
    for (let i = 0; i < ${movers}; i++) {
      const d = document.createElement("div");
      d.className = "L";
      d.style.willChange = "transform";
      d.style.animation = "dA " + (7 + i) + "s linear infinite alternate";
      document.body.appendChild(d);
    }
    return document.getAnimations({ subtree: true }).length;
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

const run = async (statics, movers, opaque = false) => {
  await page.setContent("<h1>arm</h1>");
  await page.evaluate(BUILD(statics, movers, opaque));
  await page.waitForTimeout(600);
  const r = await page.evaluate(COUNT(1500));
  console.log(`  static=${String(statics).padStart(2)}  moving=${String(movers).padStart(2)}${opaque ? "  [base opaque]" : "              "}  fps=${String(r.fps).padStart(5)}  worstGap=${String(r.worstGapMs).padStart(5)}ms`);
};

await page.setContent("<h1>null</h1>");
console.log("null arm  " + JSON.stringify(await page.evaluate(COUNT(1500))));

console.log("\nONE mover, deepening the static stack under it");
for (const s of [0, 2, 4, 8, 12, 16, 24]) await run(s, 1);

console.log("\nZERO movers, same stacks (the control for the control)");
for (const s of [4, 12, 24]) await run(s, 0);

console.log("\nTWO movers, deepening the stack");
for (const s of [0, 4, 12]) await run(s, 2);

console.log("\nnull arm again (drift check)");
await page.setContent("<h1>null</h1>");
console.log("  " + JSON.stringify(await page.evaluate(COUNT(1500))));

await browser.close();
