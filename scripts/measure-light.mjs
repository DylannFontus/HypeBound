/**
 * Where is the light actually coming from, on the two objects that sit next to
 * each other for the whole of every match?
 *
 * The card frame and the leader coin disagreed, and nothing caught it: the light
 * rig test proves `LIGHT_RIG.cssAngle` and `LIGHT_RIG.world` agree with each
 * other, which is a statement about two constants and says nothing at all about
 * what a canvas painted. So this measures the pixels.
 *
 * For each object it walks the rim in one-degree steps of angle-from-centre —
 * around a circle for the coin, around the frame band's midline for the card —
 * converts each pixel to WCAG relative luminance, and fits
 *
 *     L(θ) ≈ a + b·cos(θ − φ)
 *
 * by least squares. `φ` is where the key light is, in screen degrees (0 = up,
 * clockwise); 315 is the contract. `(a+b)/(a−b)` is how hard it is working.
 *
 * The fit rather than a two-point sample, because a card's rim carries a cost
 * gem in one corner and two stat gems in the others: a saturated cyan crystal on
 * the top-left is not evidence about the metal, and neither is a red one on the
 * bottom-right. Those sectors are masked out and the fit copes with the gaps,
 * where two opposed samples would simply have measured the gems.
 *
 *   node scripts/measure-light.mjs
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });

const report = await page.evaluate(async () => {
  const [content, renderer, leader] = await Promise.all([
    import("/src/engine/content.ts"),
    import("/src/ui/cardRenderer/renderCard.ts"),
    import("/src/ui/cardRenderer/renderLeader.ts"),
  ]);
  const index = content.getContent();
  await new Promise((r) => setTimeout(r, 600));

  const lum = (r, g, b) => {
    const f = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  /** Shortest angular distance between two headings, in degrees. */
  const apart = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  /**
   * Fit L(θ) = a + b·cos(θ − φ) over the samples and report the direction and
   * strength of the illumination.
   */
  const fit = (samples) => {
    let sa = 0;
    let sc = 0;
    let ss = 0;
    for (const { deg, L } of samples) {
      const rad = (deg * Math.PI) / 180;
      sa += L;
      sc += L * Math.cos(rad);
      ss += L * Math.sin(rad);
    }
    const n = samples.length;
    const a = sa / n;
    const c = (2 * sc) / n;
    const s = (2 * ss) / n;
    const b = Math.hypot(c, s);
    const phi = ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;

    /** Mean luminance over a 90-degree arc centred on `centre`. */
    const arc = (centre) => {
      const hit = samples.filter(({ deg }) => apart(deg, centre) <= 45);
      return hit.length ? { L: hit.reduce((t, x) => t + x.L, 0) / hit.length, n: hit.length } : { L: 0, n: 0 };
    };
    const tl = arc(315);
    const br = arc(135);

    /**
     * The critic's own two-point measurement, kept alongside the fit.
     *
     * The nearest *unmasked* sample to each diagonal rather than the diagonal
     * itself, because the leader's health gem sits squarely on its bottom-right
     * rim and a red stone is not a reading of the metal.
     */
    const nearest = (centre) =>
      samples.reduce((best, s) => (apart(s.deg, centre) < apart(best.deg, centre) ? s : best), samples[0]);
    const pTL = nearest(315);
    const pBR = nearest(135);

    return {
      peak: phi,
      mean: a,
      amp: b,
      tl: tl.L,
      br: br.L,
      ratio: br.L > 1e-6 ? tl.L / br.L : Infinity,
      point: `${pTL.L.toFixed(4)}@${pTL.deg} vs ${pBR.L.toFixed(4)}@${pBR.deg}`,
      pointRatio: pBR.L > 1e-6 ? pTL.L / pBR.L : Infinity,
      n,
      arcN: `${tl.n}/${br.n}`,
    };
  };

  /** One sample per degree along a boundary, with sectors masked out. */
  const walk = (ctx, at, masks) => {
    const samples = [];
    for (let deg = 0; deg < 360; deg += 1) {
      if (masks.some(([m, w]) => apart(deg, m) <= w)) continue;
      const [x, y] = at(deg);
      const p = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      if (p[3] < 200) continue;
      samples.push({ deg, L: lum(p[0], p[1], p[2]) });
    }
    return samples;
  };

  /** Screen degrees (0 = up, clockwise) to a unit vector in canvas coordinates. */
  const dir = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [Math.sin(rad), -Math.cos(rad)];
  };

  const out = [];
  const W = 460;

  for (const id of ["cinder", "halo", "tide"]) {
    const card = Object.values(index.leaders).find((c) => c.current === id);
    if (!card) continue;
    const canvas = leader.renderLeaderToCanvas(card, W, { health: 30, maxHealth: 30 });
    document.body.appendChild(canvas);
    await new Promise((r) => setTimeout(r, 150));
    const ctx = canvas.getContext("2d");
    const s = canvas.width / 440;
    // the ring midline, between R_OUT 150 and R_METAL 138
    const at = (deg) => {
      const [ux, uy] = dir(deg);
      return [(220 + ux * 144) * s, (166 + uy * 144) * s];
    };
    // the health gem sits at (355,240) and the armour gem at (85,232)
    out.push({ what: `leader ${id}`, ...fit(walk(ctx, at, [[118, 34], [244, 30]])) });
    canvas.remove();
  }

  const cards = ["idols-lumi-starcall", "crp-lobby-greeter", "after-designated-driver"]
    .map((id) => index.cards[id])
    .filter(Boolean);
  for (const card of cards) {
    const canvas = renderer.renderCardToCanvas(card, W, {});
    document.body.appendChild(canvas);
    await new Promise((r) => setTimeout(r, 150));
    const ctx = canvas.getContext("2d");
    const s = canvas.width / 512;
    /**
     * The frame band's midline: the card rect inset by the bleed plus half the
     * band, walked by angle from the centre. A rectangle rather than a circle,
     * because an ellipse inscribed in a 512×680 card crosses the band only at
     * the four edge midpoints and samples artwork everywhere else.
     */
    const halfW = 256 - 32;
    const halfH = 340 - 32;
    const at = (deg) => {
      const [ux, uy] = dir(deg);
      const t = Math.min(
        Math.abs(ux) < 1e-6 ? Infinity : halfW / Math.abs(ux),
        Math.abs(uy) < 1e-6 ? Infinity : halfH / Math.abs(uy)
      );
      return [(256 + ux * t) * s, (340 + uy * t) * s];
    };
    // cost gem 327°, Current cartouche 26°, health gem 149°, attack gem 211°
    const masks = [[327, 26], [26, 24], [149, 24], [211, 24]];
    out.push({ what: `card ${card.id}`, ...fit(walk(ctx, at, masks)) });
    canvas.remove();
  }

  return out;
});

for (const row of report) {
  console.log(
    `${row.what.padEnd(30)} peak ${row.peak.toFixed(0).padStart(3)}deg   ` +
      `arc TL/BR ${row.ratio.toFixed(2).padStart(7)}  point ${row.point}  = ${row.pointRatio.toFixed(1)}:1`
  );
}
if (errors.length) console.log("page errors:", errors.slice(0, 4));
await browser.close();
