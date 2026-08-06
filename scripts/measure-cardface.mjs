/**
 * Numbers for the card renderer, taken off the real canvas.
 *
 * The review that preceded this file was argued in measurements — a rim's
 * luminance-weighted light vector, a text box's total value range, a per-tile
 * repaint cost — and a fix answered in adjectives is not an answer. This asks the
 * dev server for the renderer, draws into an offscreen canvas at card space, and
 * reads pixels back.
 *
 *   node scripts/measure-cardface.mjs
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

const out = await page.evaluate(async () => {
  const [content, renderer, backs, palette] = await Promise.all([
    import("/src/engine/content.ts"),
    import("/src/ui/cardRenderer/renderCard.ts"),
    import("/src/ui/cardRenderer/renderCardBack.ts"),
    import("/src/ui/cardRenderer/palette.ts"),
  ]);
  await new Promise((r) => setTimeout(r, 900));
  const index = content.getContent();
  const all = Object.values(index.cards).filter((c) => !c.token);

  const W = 512;
  const H = 680;
  const surface = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  const report = {};

  // --- 1. the text box, and the band below it ------------------------------
  const card = all.find((c) => c.current === "tide" && c.type === "character" && c.text) ?? all[0];
  const canvas = surface(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  renderer.renderCard(ctx, card, {});
  const box = palette.LAYOUT.textBox;
  const read = (x, y, w, h) => {
    const d = ctx.getImageData(x, y, w, h).data;
    let min = 255;
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = luma(d, i);
      min = Math.min(min, l);
      max = Math.max(max, l);
      sum += l;
      n++;
    }
    return { min: +min.toFixed(1), max: +max.toFixed(1), mean: +(sum / n).toFixed(1), range: +(max - min).toFixed(1) };
  };
  const probe = (x, y) => {
    const d = ctx.getImageData(x, y, 6, 6).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += luma(d, i);
    return +(sum / (d.length / 4)).toFixed(1);
  };
  report.textBox = {
    card: card.name,
    topLeft: probe(box.x + 8, box.y + 8),
    bottomRight: probe(box.x + box.w - 14, box.y + 44),
    field: read(box.x + 6, box.y + 6, box.w - 12, 46),
  };
  report.lowerBand = read(120, 596, 272, 70);

  // --- 2. the rim's light vector, on the card and on the back --------------
  const vector = (target, w, h, cx, cy) => {
    const c = target.getContext("2d", { willReadFrequently: true });
    const samples = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const t = (deg * Math.PI) / 180;
      // walk in from outside until the first opaque pixel, then read 5px deeper
      let best = null;
      for (let r = Math.max(w, h) * 0.75; r > 10; r -= 1) {
        const x = Math.round(cx + Math.cos(t) * r);
        const y = Math.round(cy + Math.sin(t) * r);
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const px = c.getImageData(x, y, 1, 1).data;
        if (px[3] > 200) {
          const ix = Math.round(cx + Math.cos(t) * (r - 5));
          const iy = Math.round(cy + Math.sin(t) * (r - 5));
          const q = c.getImageData(ix, iy, 1, 1).data;
          best = { deg, l: 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2] };
          break;
        }
      }
      if (best) samples.push(best);
    }
    let vx = 0;
    let vy = 0;
    let peak = samples[0];
    let dim = samples[0];
    for (const s of samples) {
      const t = (s.deg * Math.PI) / 180;
      vx += Math.cos(t) * s.l;
      vy += Math.sin(t) * s.l;
      if (s.l > peak.l) peak = s;
      if (s.l < dim.l) dim = s;
    }
    // report in CSS degrees where 315 is up-left, matching LIGHT_RIG.cssAngle
    const angle = ((Math.atan2(-vy, vx) * 180) / Math.PI + 360) % 360;
    return {
      brightestAt: peak.deg,
      brightest: +peak.l.toFixed(0),
      darkestAt: dim.deg,
      darkest: +dim.l.toFixed(0),
      ratio: +(peak.l / Math.max(1, dim.l)).toFixed(2),
      lightVector: +angle.toFixed(0),
    };
  };

  const backCanvas = surface(W, H);
  const bctx = backCanvas.getContext("2d", { willReadFrequently: true });
  backs.renderCardBack(bctx, { color: "#b56cff", emblem: "diamond" });
  report.backRim = vector(backCanvas, W, H, W / 2, H / 2);
  report.faceRim = vector(canvas, W, H, W / 2, H / 2);

  // --- 3. the foil must not repaint the painting ---------------------------
  const foilCard = all.find((c) => c.id === "after-dawnrise-uninvited-guest") ?? card;
  const artOf = (opts) => {
    const c = surface(W, H);
    const cc = c.getContext("2d", { willReadFrequently: true });
    renderer.renderCard(cc, foilCard, opts);
    return cc.getImageData(90, 150, 330, 170).data;
  };
  const plain = artOf({});
  let worstMean = 0;
  let worstHue = 0;
  for (const phase of [0.15, 0.3, 0.45, 0.6, 0.75]) {
    const lit = artOf({ premium: true, phase });
    let sum = 0;
    let hue = 0;
    for (let i = 0; i < plain.length; i += 4) {
      const a = 0.2126 * plain[i] + 0.7152 * plain[i + 1] + 0.0722 * plain[i + 2];
      const b = 0.2126 * lit[i] + 0.7152 * lit[i + 1] + 0.0722 * lit[i + 2];
      sum += Math.abs(a - b);
      // hue drift: how far the red-blue balance moved
      hue += Math.abs(plain[i] - plain[i + 2] - (lit[i] - lit[i + 2]));
    }
    const n = plain.length / 4;
    worstMean = Math.max(worstMean, sum / n);
    worstHue = Math.max(worstHue, hue / n);
  }
  report.foil = { card: foilCard.name, worstValueShift: +worstMean.toFixed(2), worstHueShift: +worstHue.toFixed(2) };

  // --- 4. repaint cost -----------------------------------------------------
  const tile = surface(168 * 2, 223 * 2);
  const tctx = tile.getContext("2d");
  tctx.scale((168 * 2) / W, (168 * 2) / W);
  const sample = all.slice(0, 40);
  for (const c of sample) renderer.renderCard(tctx, c, { renderWidth: 168, motion: false });
  let t0 = performance.now();
  for (const c of sample) renderer.renderCard(tctx, c, { renderWidth: 168, motion: false });
  const full = (performance.now() - t0) / sample.length;

  // the composite path: what an idle tick actually costs
  const base = surface(168 * 2, 223 * 2);
  base.getContext("2d").drawImage(tile, 0, 0);
  t0 = performance.now();
  const reps = 200;
  for (let i = 0; i < reps; i++) {
    const c = sample[i % sample.length];
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, tile.width, tile.height);
    tctx.drawImage(base, 0, 0);
    tctx.scale((168 * 2) / W, (168 * 2) / W);
    renderer.drawCardMotion(tctx, c, { sheen: i / reps, glow: false });
  }
  const idle = (performance.now() - t0) / reps;
  report.cost = { fullTilePaint: +full.toFixed(2), idleComposite: +idle.toFixed(2) };

  // --- 5. does an idle frame actually change, at tile size? ----------------
  const a = surface(185, 246);
  const actx = a.getContext("2d", { willReadFrequently: true });
  actx.scale(185 / W, 185 / W);
  renderer.renderCard(actx, card, { renderWidth: 185, sheen: 0.1 });
  const b = surface(185, 246);
  const bctx2 = b.getContext("2d", { willReadFrequently: true });
  bctx2.scale(185 / W, 185 / W);
  renderer.renderCard(bctx2, card, { renderWidth: 185, sheen: 0.45 });
  const da = actx.getImageData(0, 0, 185, 246).data;
  const db = bctx2.getImageData(0, 0, 185, 246).data;
  let diff = 0;
  let maxDiff = 0;
  let moved = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    diff += d;
    maxDiff = Math.max(maxDiff, d);
    if (d > 3) moved++;
  }
  const n = da.length / 4;
  report.idleAtTile = {
    mean: +(diff / n).toFixed(2),
    max: maxDiff,
    movedPct: +((moved / n) * 100).toFixed(1),
  };

  /**
   * --- 5b. text contrast, worst glyph against its brightest local background
   *
   * The rules box was raised from 4–14/255 into the 40–70 band and the bottom
   * scrim was relaxed by eight points of opacity, and both of those move text
   * contrast the wrong way. This walks each type region, takes the darkest glyph
   * pixel and the brightest background pixel in the same band, and reports the
   * WCAG ratio between them — over the brightest artwork on disk as well as a
   * dark one, in both the default and the high-contrast theme.
   */
  const rel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (d, i) => 0.2126 * rel(d[i]) + 0.7152 * rel(d[i + 1]) + 0.0722 * rel(d[i + 2]);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const contrastIn = (c, x, y, w, h) => {
    const d = c.getImageData(x, y, w, h).data;
    const values = [];
    for (let i = 0; i < d.length; i += 4) values.push(lum(d, i));
    values.sort((p, q) => p - q);
    /**
     * The extremes, not quartiles. Card type is light on dark everywhere except
     * inside the rules box, so a percentile chosen for one polarity misses the
     * glyphs entirely in the other — a 13px type line covers about 8% of its
     * band, and a 12th-percentile "paper" reading never touches it. One per cent
     * off each end skips the antialiased fringe and nothing else.
     */
    const ink = values[Math.floor(values.length * 0.01)];
    const paper = values[Math.floor(values.length * 0.99)];
    return +ratio(ink, paper).toFixed(2);
  };

  const bright = all.find((c) => c.id === "goth-crypt-usher") ?? card;
  const contrast = {};
  for (const theme of ["default", "high"]) {
    const before = document.documentElement.dataset.contrast;
    document.documentElement.dataset.contrast = theme === "high" ? "high" : "";
    const worst = { name: 99, rules: 99, typeLine: 99, footer: 99 };
    for (const c of [card, bright, all.find((x) => x.rarity === "legendary") ?? card]) {
      const s = surface(W, H);
      const sc = s.getContext("2d", { willReadFrequently: true });
      renderer.renderCard(sc, c, {});
      const b = palette.LAYOUT;
      worst.name = Math.min(worst.name, contrastIn(sc, 140, b.namePlate.y + 10, 232, 34));
      const tb = b.textBox;
      worst.rules = Math.min(worst.rules, contrastIn(sc, tb.x + 10, tb.y + 10, tb.w - 20, tb.h - 20));
      worst.typeLine = Math.min(worst.typeLine, contrastIn(sc, 130, b.typeLineY - 9, 252, 18));
      worst.footer = Math.min(worst.footer, contrastIn(sc, 132, b.footerY - 8, 248, 16));
    }
    contrast[theme] = worst;
    document.documentElement.dataset.contrast = before ?? "";
  }
  report.contrast = contrast;

  // --- 6. the collector line prints all four fields ------------------------
  const footers = [];
  for (const rarity of ["common", "rare", "epic", "legendary"]) {
    const c = all.find((x) => x.rarity === rarity && x.type === "character");
    if (!c) continue;
    footers.push({
      rarity,
      code: palette.FACTION_CODE[c.faction],
      label: palette.RARITY_STYLE[rarity].label,
    });
  }
  report.footers = footers;

  return report;
});

console.log(JSON.stringify(out, null, 2));
if (errors.length) console.log("page errors:", errors.slice(0, 4));
await browser.close();
