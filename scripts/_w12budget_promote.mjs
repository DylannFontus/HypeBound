/**
 * Is there a compositor in this harness at all?
 *
 * The evidence that there may not be: with one stepped animation on the page and
 * a stack five deep, the frame cost is independent of the mover's size (a
 * quarter-viewport layer costs the same as a full one), independent of its
 * content (a repeating PNG, a plain gradient and no background at all cost the
 * same), and almost independent of its step rate (steps(35) equals continuous).
 * All three are what a **full-page repaint per change** looks like, and none of
 * them is what compositing looks like.
 *
 * If that is right, the harness's absolute fps is measuring paint cost rather
 * than compositing cost, and it cannot be read as an iPad number — the iPad's
 * complaint is a compositor one. It would also mean the arithmetic in
 * `transitions.css` §0a is describing the right mechanism for the wrong reason,
 * which is worth knowing before it is written down as fact.
 *
 * Two arms settle it:
 *
 *   PROMOTE  give every static full-bleed layer its own `will-change: transform`.
 *            If the engine composites, the mover then only re-blends and the
 *            frame rate recovers. If it does not, nothing happens.
 *   COMPLEX  the harness's own dose control, rebuilt with layers that paint as
 *            many gradients as the application's do. If a simple mover over
 *            *complex* static layers reproduces the application's 1.7fps, the
 *            cost is the paint behind it and the compositing model is not what
 *            is being measured.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";

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

// ---- COMPLEX: the dose control with application-grade paint ----------------
const COMPLEX = (statics, gradients) => `
  (() => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent =
      "@keyframes dA{from{transform:translate3d(0,0,0)}to{transform:translate3d(96px,96px,0)}}" +
      ".M{position:fixed;inset:-10%;pointer-events:none;will-change:transform;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%)}";
    document.head.appendChild(style);
    const g = [];
    for (let k = 0; k < ${gradients}; k++) {
      g.push("radial-gradient(" + (40 + k * 7) + "% " + (35 + k * 5) + "% at " + (10 + k * 9) + "% " + (5 + k * 11) + "%, rgba(" + (120 + k * 9) + ",100,255,.06), transparent 70%)");
    }
    g.push("linear-gradient(135deg,#0c0b1c,#0a0714)");
    for (let i = 0; i < ${statics}; i++) {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:-10%;pointer-events:none";
      d.style.backgroundImage = g.join(",");
      document.body.appendChild(d);
    }
    const m = document.createElement("div");
    m.className = "M";
    m.style.animation = "dA 7s linear infinite alternate";
    document.body.appendChild(m);
    return document.getAnimations({ subtree: true }).length;
  })()`;

await page.setContent("<h1>null</h1>");
console.log("null arm  " + JSON.stringify(await page.evaluate(COUNT(1500))));

console.log("\nCOMPLEX — 1 simple mover over N static layers of G gradients each");
for (const [s, g] of [[5, 1], [5, 3], [5, 6], [5, 9], [12, 9]]) {
  await page.setContent("<h1>arm</h1>");
  await page.evaluate(COMPLEX(s, g));
  await page.waitForTimeout(600);
  const r = await page.evaluate(COUNT(1500));
  console.log(`  static=${s} gradients=${g}  fps=${String(r.fps).padStart(5)}  worstGap=${r.worstGapMs}ms`);
}

// ---- PROMOTE: does promoting the application's static layers help? ---------
await seedPlayedAccount(page);
const land = async () => {
  await page.goto(`${ORIGIN}/#settings`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
};
const arm = async (label, css) => {
  await land();
  if (css) await page.evaluate(inject, css);
  await page.waitForTimeout(1200);
  console.log(`  ${label.padEnd(48)}${JSON.stringify(await page.evaluate(COUNT(2000)))}`);
};

console.log("\nPROMOTE — #settings, tier low");
await arm("shipped", null);
await arm("static layers given will-change:transform", ".atm-wash,.atm-vignette,.d-room-alcove,.d-room-floor,.atmosphere,.screen{will-change:transform}");
await arm("static layers given translateZ(0)", ".atm-wash,.atm-vignette,.d-room-alcove,.d-room-floor,.atmosphere,.screen{transform:translateZ(0)}");
await arm("shipped again (drift check)", null);

await browser.close();
