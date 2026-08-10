/**
 * Is the high tier's picture unchanged? Two claims, both photographed.
 *
 * Three of this pass's edits are reachable outside the two constrained tiers and
 * each is asserted to be pixel-neutral. An assertion is not a measurement.
 *
 *   1. `.atm-wash` gained four `background-image` entries — the folded bloom,
 *      horizon and vignette — multiplied by `--atm-fold`, which is 0 everywhere
 *      but the low tier. If a `color-mix()` with a 0% first argument ever failed
 *      to parse, or if `--atm-fold` failed to resolve, those four would paint at
 *      full strength over the whole backdrop. This is the arm that would catch
 *      it: forcing the fold to 0 explicitly must change nothing, because it is
 *      already 0.
 *   2. `.screen > .ambient-bg::after` gained `animation: none` beside its
 *      existing `content: none`. The claim is that the box does not exist, so
 *      stopping its animation cannot move a pixel. Restoring the animation is
 *      the test: if the pseudo-element renders at all, a drifting grid over the
 *      whole viewport will show up immediately.
 *
 * Both arms are compared as frozen frames — every animation on the page is
 * paused first and the document timeline pinned — because otherwise the ambient
 * drift makes every pair of screenshots differ and the test measures nothing.
 */
import { webkit } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";
import { decodePng } from "./lib/png.mjs";

const ORIGIN = "http://localhost:5173";
const ROUTES = (process.argv[2] ?? "settings,fairness,lobby").split(",");
const TIER = process.argv[3] ?? "high";

const FREEZE = () => {
  for (const a of document.getAnimations({ subtree: true })) {
    a.pause();
    a.currentTime = 1200;
  }
};

const inject = (css) => {
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
};

function diff(a, b) {
  const A = decodePng(a);
  const B = decodePng(b);
  if (A.width !== B.width || A.height !== B.height) return { error: `size ${A.width}x${A.height} vs ${B.width}x${B.height}` };
  const n = A.channels;
  let sum = 0;
  let max = 0;
  let moved = 0;
  const px = A.width * A.height;
  for (let p = 0; p < px; p++) {
    const i = p * n;
    const d = Math.max(
      Math.abs(A.data[i] - B.data[i]),
      Math.abs(A.data[i + 1] - B.data[i + 1]),
      Math.abs(A.data[i + 2] - B.data[i + 2])
    );
    sum += d;
    if (d > max) max = d;
    if (d > 1) moved++;
  }
  return { mean: +(sum / px).toFixed(4), max, movedPct: +((moved / px) * 100).toFixed(3) };
}

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1, hasTouch: true });
await ctx.addInitScript((t) => {
  const set = () => {
    if (document.documentElement) document.documentElement.dataset.gfxTier = t;
    else setTimeout(set, 0);
  };
  set();
}, TIER);
const page = await ctx.newPage();
await seedPlayedAccount(page);

const shoot = async (route, css) => {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  if (css) await page.evaluate(inject, css);
  await page.waitForTimeout(400);
  await page.evaluate(FREEZE);
  await page.waitForTimeout(200);
  return page.screenshot();
};

/**
 * The low tier's fidelity arm, and it is the one that matters most.
 *
 * §1.8b removes five elements on this tier and paints what four of them were
 * painting into two layers that have to exist anyway. The claim is that the
 * room looks the same. This restores every removed element, parks it exactly
 * where §1.8a parks it, and turns the fold off — which is as close to "the
 * design before the budget" as can be reached from a stylesheet — and compares.
 *
 * A perfect zero is not the expectation and would be suspicious: the folded
 * gradients are restatements in different coordinates, not copies. What is
 * being asked is whether the difference is at the level of a rounding error in
 * a backdrop or at the level of a missing light.
 */
const RESTORE = `
  :root[data-gfx-tier="low"] .atm-bloom,
  :root[data-gfx-tier="low"] .atm-horizon,
  :root[data-gfx-tier="low"] .atm-vignette,
  :root[data-gfx-tier="low"] .atm-fore-vignette,
  :root[data-gfx-tier="low"] .d-room-crawl { display: block !important; }
  :root[data-gfx-tier="low"] .atm-bloom,
  :root[data-gfx-tier="low"] .atm-horizon { opacity: .8 !important; transform: scale(1.035) !important; }
  :root[data-gfx-tier="low"] .d-room-crawl { transform: translate(2%, 2%) scale(1.09) !important; }
  .atm-room { --atm-fold-lights: 0 !important; --atm-fold-vignette: 0 !important; }
  :root[data-gfx-tier="low"] .d-room-alcove {
    background:
      radial-gradient(52% 58% at 12% -4%,
        color-mix(in srgb, var(--hall-accent, var(--accent)) calc(34% * var(--hall-lit, 1)), transparent),
        color-mix(in srgb, var(--hall-accent, var(--accent)) calc(11% * var(--hall-lit, 1)), transparent) 44%,
        transparent 74%),
      radial-gradient(46% 50% at 92% 96%, rgb(70 92 150 / calc(0.1 * var(--hall-lit, 1))), transparent 72%) !important;
  }`;

console.log(`tier forced: ${TIER}\n`);
for (const route of ROUTES) {
  const base = await shoot(route, null);
  const foldOff = await shoot(route, ":root,.atm-room{--atm-fold-lights:0 !important;--atm-fold-vignette:0 !important}");
  const gridBack = await shoot(route, ".screen > .ambient-bg::after{animation:grid-drift 40s linear infinite !important}");
  console.log(`${route}`);
  if (TIER === "low") {
    const restored = await shoot(route, RESTORE);
    console.log(`   pre-budget room restored    ${JSON.stringify(diff(base, restored))}`);
  }
  console.log(`   fold forced to 0 (no-op arm)${JSON.stringify(diff(base, foldOff))}`);
  console.log(`   ambient-bg::after restored  ${JSON.stringify(diff(base, gridBack))}`);
}

await browser.close();
