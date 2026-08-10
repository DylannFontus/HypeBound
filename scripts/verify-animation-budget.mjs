/**
 * The instrument for the animation budget, and the number it publishes.
 *
 * The model, established by `_w12budget_area.mjs`, `_w12budget_steps.mjs` and
 * `_w12budget_stack.mjs` against a blank-page control in the same context:
 *
 *   - A composited full-bleed layer costs nothing while it is still. Twenty-four
 *     of them hold 62.5fps.
 *   - The moment **anything** above them changes a composited value, the whole
 *     stack is re-blended for the damaged region. One mover over 8 static
 *     full-bleed layers is 4.6fps; over 24 it is 1.6.
 *   - Distance is free and frequency is not: the same travel over 7s and over
 *     200s cost the same, and `steps(n)` costs `n/period` instead of 60/s.
 *
 * So the quantity that predicts the frame rate is
 *
 *     depth  x  rate
 *
 * where **depth** is the number of full-viewport layers painting in the stack
 * and **rate** is how many times a second anything forces a recomposite. This
 * reports both, per route, and fails the run if either is over budget.
 *
 * It is deliberately a *demand* figure rather than an fps figure. Playwright's
 * WebKit on a machine with no GPU rasterises in software, so its constants are
 * far harsher than an iPad's — but depth and rate are properties of the
 * stylesheet, they are what the compositor is being asked for, and they travel
 * to an engine nobody here can run.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTES = (process.argv[2] ?? "lobby,fairness,settings,collection,missions,stats").split(",");
const TIER = process.argv[3] ?? null;

/**
 * Budgets, per tier. Depth is full-viewport painting layers; rate is composited
 * changes per second, summed over every running animation.
 *
 * These are a **ratchet, not a target**: each is set a little above what the
 * tree actually measures today, so the script passes on the state it was written
 * against and fails the moment somebody adds a full-bleed layer or an unquantised
 * animation. A budget set at an aspiration nobody has reached yet is a red build
 * that gets ignored, which is worse than no budget.
 *
 * High is deliberately unbounded. The whole shape of the original report is that
 * a desktop absorbs this demand invisibly, and `transitions.css` §1.8a spends
 * nothing there on purpose.
 */
const BUDGET = {
  low: { depth: 8, rate: 12 },
  medium: { depth: 19, rate: 160 },
  high: { depth: 99, rate: 9999 },
};

/**
 * Routes that are over budget for reasons that live outside the files this
 * budget's author owns. Named rather than silently skipped, with the owner and
 * the offender, so the next person can clear them rather than rediscover them.
 */
const KNOWN = {
  lobby:
    "screens.css: .lobby-bg::before/::after run lobby-pulse and lobby-sweep at the " +
    "display rate over a full viewport each. Two layers, 120 changes/s, and the " +
    "single largest remaining offender in the game.",
  collection:
    "collection's own sheet: six .col-shelf-grid layers each at or over a viewport. " +
    "Static, so they cost nothing on their own -- but every one of them is charged " +
    "on every frame anything else moves.",
  missions:
    "src/ui/screens/rewards/rewardsTheme.ts: nine .rw-rail-fill progress rails run " +
    "rw-rail-crawl at the display rate, plus rw-breathe on the next check-in step. " +
    "Each is a few hundred pixels and each is charged for the whole stack -- see " +
    "scripts/_w12budget_small.mjs, where a 140x48 mover cost the same as a " +
    "full-screen one. 540 changes/s from nine decorative rails is the largest " +
    "single rate anywhere in the game, and quantising them the way transitions.css " +
    "§1.8a quantises the world would take it to 90.",
};

const MEASURE = `
  (() => {
    const vw = innerWidth, vh = innerHeight, va = vw * vh;
    const FULL = 0.6;

    /*
     * Every element painting at >= 60% of the viewport.
     *
     * Two corrections the first version of this probe needed, both of which
     * inflated the count and both of which were caught by reading its own
     * output rather than by trusting it:
     *
     * - A pseudo-element is measured by its OWN box, not its host's.
     *   getBoundingClientRect does not exist for a pseudo, and taking the
     *   host's rect made .d-room-floor::after -- a 1px hairline at 62% -- read
     *   as a full-viewport layer. Its computed width/height is the real box.
     * - html and body are the page background, not composited layers. They are
     *   one root raster that exists whatever the stylesheet does, so counting
     *   them adds two to every route and means nothing.
     */
    const depth = [];
    for (const el of document.querySelectorAll("*")) {
      if (el === document.documentElement || el === document.body) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      const hostArea = (r.width * r.height) / va;
      const paints =
        (cs.backgroundImage && cs.backgroundImage !== "none") ||
        (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
        (cs.boxShadow && cs.boxShadow !== "none");
      for (const pseudo of ["", "::before", "::after"]) {
        let area = hostArea;
        if (pseudo) {
          const p = getComputedStyle(el, pseudo);
          if (p.content === "none" || p.content === "normal") continue;
          if (p.display === "none" || p.visibility === "hidden" || parseFloat(p.opacity) === 0) continue;
          if (!((p.backgroundImage && p.backgroundImage !== "none") || (p.backgroundColor && p.backgroundColor !== "rgba(0, 0, 0, 0)"))) continue;
          const pw = parseFloat(p.width), ph = parseFloat(p.height);
          if (!Number.isFinite(pw) || !Number.isFinite(ph)) continue;
          area = (pw * ph) / va;
        } else if (!paints) continue;
        if (area < FULL) continue;
        depth.push(
          (el.tagName || "?").toLowerCase() +
            (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "") +
            pseudo
        );
      }
    }

    /**
     * Composited changes per second. A continuous animation is charged the
     * display rate; a stepped one is charged its own step rate, which is the
     * whole point of quantising. Transitions are not counted — they are not
     * running at rest, and a settled route is what this measures.
     */
    const DISPLAY = 60;
    let rate = 0;
    const movers = [];
    for (const a of document.getAnimations({ subtree: true })) {
      if (a.playState !== "running") continue;
      const t = a.effect && a.effect.target;
      if (!t) continue;
      const el = t.element ?? t;
      const pseudo = t.pseudoElement ?? "";
      /*
       * Find the style that actually owns this animation.
       *
       * KeyframeEffect.target returns the ORIGINATING element for an animation
       * on a pseudo-element, and this WebKit does not always populate
       * .pseudoElement beside it. Trusting it read .atm-grid's own timing
       * function for the animation running on .atm-grid::after, so a layer
       * quantised to steps(220) was reported at the full display rate and the
       * medium tier looked six times worse than it is. The animation-name list
       * is the reliable discriminator: whichever of the element and its two
       * pseudo-elements declares this name is the one being measured.
       */
      let cs = getComputedStyle(el, pseudo || undefined);
      let owner = pseudo;
      if (!(cs.animationName || "").split(",").some((n) => n.trim() === a.animationName)) {
        for (const guess of ["::after", "::before"]) {
          const g = getComputedStyle(el, guess);
          if ((g.animationName || "").split(",").some((n) => n.trim() === a.animationName)) {
            cs = g;
            owner = guess;
            break;
          }
        }
      }
      const r = el.getBoundingClientRect();
      let area = (r.width * r.height) / va;
      if (owner) {
        const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
        if (Number.isFinite(pw) && Number.isFinite(ph)) area = (pw * ph) / va;
      }
      /*
       * Pick this animation's OWN timing function and duration out of the lists.
       *
       * An element running two animations -- the mote fields run a drift and a
       * twinkle -- has comma-separated lists for every animation-* property, and
       * taking [0] charges the twinkle at the drift's period. The lists also
       * cannot be split on a bare comma, because cubic-bezier(0.2, 0.8, 0.2, 1)
       * is one entry containing three. So: split at top level only, then index
       * by where this animation's name sits, cycling as CSS does.
       */
      const listSplit = (s) => {
        const out = [];
        let depth = 0;
        let cur = "";
        for (const ch of s) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
          cur += ch;
        }
        if (cur.trim()) out.push(cur.trim());
        return out;
      };
      const names = listSplit(cs.animationName || "");
      const idx = Math.max(0, names.indexOf(a.animationName));
      const timings = listSplit(cs.animationTimingFunction || "linear");
      const durations = listSplit(cs.animationDuration || "0s");
      const timing = timings.length ? timings[idx % timings.length] : "linear";
      const stepMatch = /^steps\\(\\s*(\\d+)/.exec(timing);
      const steps = stepMatch ? parseInt(stepMatch[1], 10) : null;
      const durRaw = durations.length ? durations[idx % durations.length] : "0s";
      const durMs = durRaw.endsWith("ms") ? parseFloat(durRaw) : parseFloat(durRaw) * 1000;
      const per = steps && durMs > 0 ? steps / (durMs / 1000) : DISPLAY;
      /*
       * Every mover is charged, whatever size it is.
       *
       * The first version of this counter only added up animations covering at
       * least 60% of the viewport, on the assumption that a small one damages a
       * small region. scripts/_w12budget_small.mjs was written to check that
       * before relying on it and it is false: over a stack of eight full-bleed
       * layers, a 140x48 button animating a transform measured 5.4fps against
       * 4.8 for a layer covering the whole screen. The compositor re-blends the
       * stack whatever moved, so the rate term is "how often does anything
       * change", full stop. Area is still reported, because it is what decides
       * whether a layer belongs in the depth count -- it just does not discount
       * the charge.
       */
      const charged = Math.min(per, DISPLAY);
      rate += charged;
      if (area >= 0.25 || charged >= 30) {
        movers.push({ name: a.animationName ?? "(t)", area: +area.toFixed(2), per: +charged.toFixed(1) });
      }
    }
    return { depth: depth.length, layers: depth, rate: +rate.toFixed(1), movers };
  })()`;

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
/**
 * The tier has to be stamped before `mountAtmosphere` runs — `detectTier` takes
 * an already-declared answer over its own heuristic — but `addInitScript` fires
 * before there is a `documentElement` to stamp. So it retries until there is
 * one, which is still long before any application code.
 */
if (TIER) {
  await ctx.addInitScript((t) => {
    const set = () => {
      if (document.documentElement) document.documentElement.dataset.gfxTier = t;
      else setTimeout(set, 0);
    };
    set();
  }, TIER);
}
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 140)));

await seedPlayedAccount(page);

let failures = 0;
const verbose = process.argv.includes("--verbose");

for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const tier = await page.evaluate(() => document.documentElement.dataset.gfxTier ?? "high");
  const m = await page.evaluate(MEASURE);
  const budget = BUDGET[tier] ?? BUDGET.high;
  const over = m.depth > budget.depth || m.rate > budget.rate;
  const known = over && KNOWN[route] !== undefined;
  const bad = over && !known;
  if (bad) failures++;
  console.log(
    `${bad ? "FAIL" : known ? "KNOWN" : "ok  "} ${route.padEnd(12)} tier=${tier.padEnd(6)} depth=${String(m.depth).padStart(2)}/${budget.depth}  rate=${String(m.rate).padStart(5)}/${budget.rate} per second   product=${(m.depth * m.rate).toFixed(0)}`
  );
  if (known) console.log(`        not this budget's to fix -- ${KNOWN[route]}`);
  if (verbose || bad) {
    for (const mv of m.movers) console.log(`        mover  ${String(mv.per).padStart(5)}/s  ${mv.area}vp  ${mv.name}`);
    for (const l of m.layers) console.log(`        layer  ${l}`);
  }
}

await browser.close();
if (failures) {
  console.log(`\n${failures} route(s) over budget`);
  process.exit(1);
}
console.log("\nall routes inside the animation budget");
