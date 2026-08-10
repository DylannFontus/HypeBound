/**
 * The quantity that actually predicts the frame rate: animated full-bleed area.
 *
 * `_w12budget_area.mjs` separated the two candidate mechanisms and the answer is
 * not the one the brief assumed. On this harness, 160 running animations on
 * 120px boxes hold 27.3fps; **two** running animations on a single viewport-sized
 * layer drop it to 23.2. Static full-bleed promoted layers are free. So the price
 * is paid per composited frame, per square pixel of layer that moves — which is
 * a bandwidth cost, not a scheduling one.
 *
 * This measures that quantity on the real application, in viewports of animated
 * area, and it also asks a question the census raised and could not answer: five
 * seconds after a navigation, `nav-sibling-out`, `atm-travel-ascend`,
 * `nav-veil-grain` and the whole curtain plate were still reported as *running*.
 * Either the teardown genuinely leaks, or a page pinned at 1fps cannot get
 * through whatever schedules it. Sampling the same census at four horizons
 * distinguishes those: a leak stays, a slow teardown clears.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const TIER = process.argv[3] ?? null;

/**
 * Area, in viewports, of every distinct element carrying a running animation.
 * Deduped by element: two animations on one layer cost one layer's raster, which
 * is the whole point of the finding this measures.
 */
const BLEED = `
  (() => {
    const vw = innerWidth, vh = innerHeight, va = vw * vh;
    const seen = new Map();
    for (const a of document.getAnimations({ subtree: true })) {
      if (a.playState !== "running") continue;
      const t = a.effect && a.effect.target;
      if (!t) continue;
      const el = t.element ?? t;
      const pseudo = t.pseudoElement ?? "";
      let r;
      try { r = el.getBoundingClientRect(); } catch { continue; }
      let w = r.width, h = r.height;
      if (pseudo) {
        // a pseudo-element is not measurable; take its own box from computed insets
        const cs = getComputedStyle(el, pseudo);
        const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
        if (Number.isFinite(pw) && pw > 0) w = pw;
        if (Number.isFinite(ph) && ph > 0) h = ph;
      }
      const key = (el.tagName || "?").toLowerCase() +
        (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "") + pseudo;
      const area = (w * h) / va;
      const prev = seen.get(key);
      if (prev) { prev.anims++; }
      else seen.set(key, { area, anims: 1, name: a.animationName ?? a.transitionProperty ?? "(waapi)" });
    }
    const rows = [...seen.entries()].map(([k, v]) => ({ el: k, ...v })).sort((a, b) => b.area - a.area);
    return {
      layers: rows.length,
      anims: rows.reduce((s, r) => s + r.anims, 0),
      bleedLayers: rows.filter((r) => r.area >= 0.6).length,
      viewports: +rows.reduce((s, r) => s + r.area, 0).toFixed(2),
      bleedViewports: +rows.filter((r) => r.area >= 0.6).reduce((s, r) => s + r.area, 0).toFixed(2),
      rows: rows.slice(0, 22),
    };
  })()`;

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
if (TIER) await ctx.addInitScript((t) => { document.documentElement.dataset.gfxTier = t; }, TIER);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 120)));

await page.setContent("<h1>control</h1>");
console.log("CONTROL blank " + JSON.stringify(await page.evaluate(COUNT(1500))) + (TIER ? `   [tier forced ${TIER}]` : ""));

await seedPlayedAccount(page);

// A cold load, so nothing from a previous route is in flight.
const routes = (process.argv[2] ?? "lobby,fairness,collection").split(",");
for (const route of routes) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  console.log(`\n=== ${route} (cold load) tier=${await page.evaluate(() => document.documentElement.dataset.gfxTier ?? "(unset)")}`);
  for (const at of [1500, 4000, 9000]) {
    await page.waitForTimeout(at === 1500 ? 1500 : at === 4000 ? 2500 : 5000);
    const b = await page.evaluate(BLEED);
    console.log(`  t=${String(at).padStart(5)}ms  layers=${String(b.layers).padStart(3)} anims=${String(b.anims).padStart(3)}  fullBleedLayers=${String(b.bleedLayers).padStart(2)}  animatedViewports=${String(b.viewports).padStart(6)} (fullBleed ${b.bleedViewports})`);
    if (at === 9000) {
      for (const r of b.rows) console.log(`        ${r.area.toFixed(2).padStart(5)}vp  x${r.anims}  ${r.name.padEnd(22)} ${r.el}`);
    }
  }
  console.log(`  fps ${JSON.stringify(await page.evaluate(COUNT(2000)))}`);
}

await browser.close();
