/**
 * How many animations is a HYPEBOUND route actually running, and does that
 * number predict the frame rate?
 *
 * `_w11verify_wkarms.mjs` measured a 62x spread on WebKit and found that the two
 * axes the wave-10 fix worked on — `will-change` and `filter` — move nothing,
 * while `animation: none` moves everything. That is an attribution, not a
 * quantity. Before any budget can be built there has to be a number, and before
 * the number can be believed there has to be a **dose-response control**: a page
 * this harness builds itself, with a known count of full-bleed composited
 * animations on it, measured on the same clock in the same context.
 *
 * If the synthetic page tracks the application's curve, the animation count is
 * the mechanism and the budget is the fix. If a synthetic page with sixty
 * full-bleed animations runs at sixty frames a second, the count is innocent and
 * the framing this was launched under is wrong — which is the more useful of the
 * two outcomes and the reason the control is here.
 *
 * Nothing in this file touches the application. It reads.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTES = process.argv[2]?.split(",") ?? ["lobby", "fairness", "settings", "collection", "missions"];

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

/**
 * The census. `getAnimations()` sees CSS animations, CSS transitions and WAAPI
 * alike, which is exactly the population that costs a compositor frames — and
 * `{ subtree: true }` on the document is the only call that catches the ones
 * hanging off pseudo-elements, which is most of the atmosphere.
 */
const CENSUS = `
  (() => {
    const all = document.getAnimations({ subtree: true });
    const rows = new Map();
    let running = 0;
    for (const a of all) {
      if (a.playState !== "running") continue;
      running++;
      const name = a.animationName ?? a.transitionProperty ?? "(waapi)";
      let owner = "(unknown)";
      try {
        const t = a.effect && a.effect.target;
        if (t) {
          const el = t.element ?? t;
          owner = (el.tagName || "?").toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "");
          if (t.pseudoElement) owner += t.pseudoElement;
        }
      } catch {}
      const key = name + "  @  " + owner;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    return {
      total: all.length,
      running,
      rows: [...rows.entries()].sort((a, b) => b[1] - a[1]),
    };
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 120)));

// ---- control 1: the blank page ------------------------------------------
await page.setContent("<h1>control</h1>");
console.log("CONTROL blank page          " + JSON.stringify(await page.evaluate(COUNT(1500))));

// ---- control 2: dose-response -------------------------------------------
/**
 * `n` full-viewport layers, each on its own infinite transform+opacity
 * animation, on an otherwise empty page. Deliberately the *cheap* kind — the
 * kind this project has spent three waves making sure its layers are — so the
 * curve measures the count and not the expense of any one of them.
 */
const DOSE = (n) => `
  (() => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#0a0714;overflow:hidden";
    const style = document.createElement("style");
    style.textContent = "@keyframes doseA{from{transform:translate3d(0,0,0)}to{transform:translate3d(40px,40px,0)}}" +
      "@keyframes doseB{0%,100%{opacity:.4}50%{opacity:1}}" +
      ".dose{position:fixed;inset:-10%;pointer-events:none;background:radial-gradient(40% 40% at 30% 20%,rgba(180,120,255,.06),transparent 70%);will-change:transform,opacity}";
    document.head.appendChild(style);
    for (let i = 0; i < ${n}; i++) {
      const d = document.createElement("div");
      d.className = "dose";
      d.style.animation = "doseA " + (7 + i % 11) + "s linear infinite alternate, doseB " + (4 + i % 7) + "s ease-in-out infinite";
      document.body.appendChild(d);
    }
    return document.getAnimations({ subtree: true }).length;
  })()`;

console.log("");
console.log("CONTROL dose-response — n cheap full-bleed animated layers on a blank page");
for (const n of [0, 4, 8, 16, 24, 40, 60]) {
  await page.setContent("<h1>dose</h1>");
  const declared = await page.evaluate(DOSE(n));
  await page.waitForTimeout(700);
  const r = await page.evaluate(COUNT(1500));
  console.log(`  layers=${String(n).padStart(3)}  animations=${String(declared).padStart(3)}  ${JSON.stringify(r)}`);
}

// ---- the application ------------------------------------------------------
await seedPlayedAccount(page);

console.log("");
console.log("ROUTES");
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const census = await page.evaluate(CENSUS);
  const timing = await page.evaluate(COUNT(2000));
  const tier = await page.evaluate(() => document.documentElement.dataset.gfxTier ?? "(unset)");
  console.log(
    `\n${route}  tier=${tier}  running=${census.running}  total=${census.total}  ${JSON.stringify(timing)}`
  );
  for (const [key, n] of census.rows) console.log(`    ${String(n).padStart(3)}x  ${key}`);
}

await browser.close();
