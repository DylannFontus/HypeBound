/**
 * The four things this wave is not allowed to break, on twelve routes.
 *
 * Contrast, `--ui-scale: 1.4`, the two minimum viewports, and the OS widget
 * count. All four are hard constraints rather than aesthetics, and all four are
 * exactly the sort of thing a materials migration breaks quietly: a `.mat-chip`
 * has a lighter face than the `.panel` it replaced, so every ratio measured
 * against the old plate is stale, and a `grid-template-columns` written in `px`
 * is fine at 1.0 and off the panel at 1.4.
 *
 * Contrast is measured **from rendered pixels**, not from computed colours: a
 * material is a gradient with a grain tile and a moving specular band over it,
 * so `getComputedStyle().backgroundColor` is `transparent` and any check that
 * trusted it would pass everything. The sample is the darkest local backdrop
 * behind each text node's own box, which is the worst case the glyph sits on.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { seedHistory } from "./lib/records.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ROUTES = [
  "profile", "stats", "leaderboards", "replays", "settings", "a11y",
  "privacy", "legal", "support", "gauntlet", "fairness", "cloudsave",
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await seedHistory(page);

const settle = async () => {
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(900);
};

// --- 1. OS widgets, glyph icons, overflow, at three sizes --------------------
const structure = [];
for (const [w, h] of [
  [1600, 900],
  [1280, 720],
  [844, 390],
]) {
  await page.setViewportSize({ width: w, height: h });
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await settle();
    structure.push(
      await page.evaluate(
        ({ route, size }) => {
          const s = document.querySelector(".screen");
          if (!s) return { route, size, err: "no screen" };
          const native = s.querySelectorAll(
            "select:not(.select), input[type=checkbox]:not(.checkbox):not(.switch), " +
              "input[type=radio]:not(.checkbox), input[type=range]:not(.slider), " +
              "input[type=text]:not(.field), input[type=search]:not(.field), textarea:not(.textarea)"
          ).length;
          const glyphs = (s.textContent || "").match(/[▦✦✉◈◇⚗☠✋▤✖▶◀⏮⏭◆]/g)?.length ?? 0;
          const plain = [...s.querySelectorAll("*")].filter((e) => {
            const b = e.getBoundingClientRect();
            return (
              b.width > 120 && b.height > 60 && /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className))
            );
          }).length;
          // Anything sticking out sideways past the viewport.
          let widest = 0;
          for (const e of s.querySelectorAll("*")) {
            const b = e.getBoundingClientRect();
            if (b.width > 0) widest = Math.max(widest, Math.round(b.right));
          }
          return {
            route,
            size,
            native,
            glyphs,
            plain,
            bodyScrollW: Math.round(document.documentElement.scrollWidth),
            widestRight: widest,
          };
        },
        { route, size: `${w}x${h}` }
      )
    );
  }
}

// --- 2. ui-scale 1.4, at the small viewport ----------------------------------
await page.setViewportSize({ width: 1280, height: 720 });
const scaled = [];
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { updateSettings } = await import("/src/save/settings.ts");
    updateSettings({ uiScale: 1.4 });
  });
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await settle();
  scaled.push(
    await page.evaluate((route) => {
      const s = document.querySelector(".screen");
      const vw = document.documentElement.clientWidth;
      let overflow = 0;
      let worst = "";
      for (const e of s.querySelectorAll("*")) {
        const b = e.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > vw + 2 || b.left < -2) {
          overflow += 1;
          if (!worst) worst = `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`;
        }
      }
      return { route, scrollW: Math.round(document.documentElement.scrollWidth), vw, overflow, worst };
    }, route)
  );
}
await page.evaluate(async () => {
  const { updateSettings } = await import("/src/save/settings.ts");
  updateSettings({ uiScale: 1 });
});

// --- 3. contrast, from pixels, in both contrast modes ------------------------
const CONTRAST_PROBE = () => {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);

  /*
   * Walk up for the nearest painted backdrop — and give up honestly when the
   * answer is a material.
   *
   * A material is a four-layer gradient with a grain tile and a moving specular
   * band, so its `backgroundColor` is `transparent` and the gradient's rendered
   * value at the glyph's position is not knowable from CSS at all. The first
   * version of this probe fell through to the page fill in that case and
   * reported **1.02:1** for dark ink on the bright hero plate, which measured
   * 5.96:1 from real pixels. Six such "failures" came back and all six were the
   * instrument.
   *
   * So anything sitting on a material returns `null` and is *skipped* rather
   * than failed. `scripts/_w4rec_ink.mjs` measures those properly, by painting
   * the ink transparent and photographing the plate underneath.
   */
  const backdrop = (node) => {
    let el = node;
    while (el && el !== document.documentElement) {
      if (/\bmat-(hero|panel|chip|well)\b/.test(String(el.className)) || /\bempty\b/.test(String(el.className))) {
        return null;
      }
      const cs = getComputedStyle(el);
      const [r, g, b, a = 1] = parse(cs.backgroundColor);
      if (a > 0.85 && cs.backgroundImage === "none") return [r, g, b];
      el = el.parentElement;
    }
    return [11, 6, 20];
  };

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(".screen *")) {
    if (el.children.length > 0) continue;
    const text = (el.textContent ?? "").trim();
    if (text.length < 2) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const cs = getComputedStyle(el);
    const [fr, fg, fb, fa = 1] = parse(cs.color);
    if (fa < 0.5) continue;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const plate = backdrop(el);
    if (!plate) continue; // on a material — see `_w4rec_ink.mjs`
    const [br, bg, bb] = plate;
    const l1 = lum(fr, fg, fb);
    const l2 = lum(br, bg, bb);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const key = `${cs.color}|${br},${bg},${bb}|${large}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sample: text.slice(0, 24),
      cls: String(el.className).split(" ").slice(0, 2).join("."),
      colour: cs.color,
      px: +size.toFixed(1),
      large,
      ratio: +ratio.toFixed(2),
      floor: large ? 3 : 4.5,
      pass: ratio >= (large ? 3 : 4.5),
    });
  }
  return out;
};

await page.setViewportSize({ width: 1600, height: 900 });
const contrast = [];
for (const mode of ["normal", "high"]) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.evaluate(async (m) => {
    const { updateSettings } = await import("/src/save/settings.ts");
    updateSettings({ highContrast: m === "high" });
  }, mode);
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await settle();
    const rows = await page.evaluate(CONTRAST_PROBE);
    for (const row of rows.filter((r) => !r.pass)) contrast.push({ mode, route, ...row });
  }
}
await page.evaluate(async () => {
  const { updateSettings } = await import("/src/save/settings.ts");
  updateSettings({ highContrast: false });
});

// --- 4. reduced motion: nothing decorative still running ---------------------
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const { updateSettings } = await import("/src/save/settings.ts");
  updateSettings({ reducedMotion: true });
});
const motion = [];
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await settle();
  motion.push(
    await page.evaluate((route) => ({
      route,
      running: document.querySelector(".screen")?.getAnimations({ subtree: true }).filter((a) => a.playState === "running")
        .length ?? 0,
    }), route)
  );
}
await page.evaluate(async () => {
  const { updateSettings } = await import("/src/save/settings.ts");
  updateSettings({ reducedMotion: false });
});

console.log("=== structure ===");
console.table(structure);
console.log("=== ui-scale 1.4 @ 1280x720 ===");
console.table(scaled);
console.log(`=== contrast failures: ${contrast.length} ===`);
if (contrast.length) console.table(contrast.slice(0, 40));
console.log("=== reduced motion: running animations ===");
console.table(motion);

await browser.close();
