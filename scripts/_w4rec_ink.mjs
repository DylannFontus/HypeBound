/**
 * Contrast on a *material*, measured from the framebuffer.
 *
 * The cheap version of this check walks up the tree for an ancestor with an
 * opaque `backgroundColor` and no `background-image` — and a material is a
 * four-layer gradient with a grain tile and a moving specular band, so
 * `backgroundColor` is `transparent` on every one of them and the walk falls
 * through to the page fill. On dark ink over the bright hero plate that reports
 * **1.02:1** for something that is actually about 12:1, and on a faction-tinted
 * panel it reports whatever the void behind the panel would have given. Six such
 * "failures" came back from the first pass and all six were the instrument. That
 * is the sixth lying instrument this project has caught, and it would have been
 * the second one to fail a thing that was fine.
 *
 * So: for each selector, paint the element's own ink transparent, photograph its
 * box, and take the mean luminance of what is left. That is the real plate,
 * including the gradient, the grain and wherever the sheen happens to be. Then
 * the ratio is against the element's computed `color`, which is exact.
 *
 * The band is pinned first — `animation-play-state: paused` at a fixed offset —
 * so two runs measure the same phase rather than whichever frame they caught.
 * Where the band matters the worst case is its peak, so it is parked there.
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

/** Everything this wave introduced or re-plated, and where to find one. */
const CASES = [
  ["settings", ".d-seg-opt.is-on", "segmented, selected"],
  ["settings", ".d-seg-opt:not(.is-on)", "segmented, resting"],
  ["settings", ".d-set-label", "settings row label"],
  ["settings", ".d-set-hint", "settings row hint"],
  ["settings", ".setting-output", "slider read-out"],
  ["a11y", ".a11y-swatch .t-label", "Current swatch label"],
  ["a11y", ".a11y-cue-event", "cue name"],
  ["a11y", ".a11y-cue-character", "cue description"],
  ["a11y", ".a11y-preview-text", "live text sample"],
  ["privacy", ".policy-danger", "destructive action"],
  ["privacy", ".policy-summary .t-body", "policy prose"],
  ["privacy", ".policy-table-panel td.muted", "table's quiet column"],
  ["legal", ".policy-missing", "undrafted document note"],
  ["fairness", ".fairness-table .t-label", "odds panel caption"],
  ["fairness", ".patch-after", "a published rate"],
  ["gauntlet", ".gauntlet-cta", "the hero action"],
  ["gauntlet", ".gauntlet-intro .t-body", "hub prose over the key art"],
  ["gauntlet", ".gauntlet-curve-label", "curve axis label"],
  ["replays", ".replay-entry-deck", "history row title"],
  ["replays", ".replay-entry-meta", "history row meta"],
  ["replays", ".replay-recap-stats dt", "recap caption"],
  ["replays", ".replay-recap-stats dd", "recap figure"],
  ["stats", ".stats-row-name", "rate table row"],
  ["stats", ".d-chip", "mode filter chip"],
  ["support", ".support-q", "FAQ question"],
  ["support", ".support-a", "FAQ answer"],
  ["cloudsave", ".cloud-save-table .patch-after", "save figure"],
  ["profile", ".profile-eyebrow", "faction eyebrow"],
  ["profile", ".profile-slot-label", "cosmetic slot label"],
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

// A second page, used only to decode the PNGs the first one produces.
const decoder = await (await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] })).newPage();
const meanLuma = async (buffer) =>
  decoder.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      n += 1;
    }
    return sum / n;
  }, `data:image/png;base64,${buffer.toString("base64")}`);

const rows = [];
for (const mode of ["normal", "high"]) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.evaluate(async (m) => {
    const { updateSettings } = await import("/src/save/settings.ts");
    updateSettings({ highContrast: m === "high" });
  }, mode);

  let current = "";
  for (const [route, selector, label] of CASES) {
    if (route !== current) {
      await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
      await page
        .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      // Pin the specular band at its peak — worst case for faint ink.
      await page.addStyleTag({
        content: `.mat-hero::after,.mat-panel::after,.mat-chip::after{animation-play-state:paused!important;animation-delay:-1.2s!important}`,
      });
      current = route;
    }
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) {
      rows.push({ mode, route, label, ratio: null, note: "not present" });
      continue;
    }
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);

    const info = await target.evaluate((el) => {
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      /*
       * `color-mix()` computes to `color(srgb 1 0.611 0.774)`, not `rgb(255, 156,
       * 197)` — **0–1 components, not 0–255.**
       *
       * A regex that scrapes the numbers and feeds them to an 8-bit luminance
       * function turns the brightest pink in the palette into something darker
       * than the plate it sits on: this probe reported the profile's faction
       * eyebrow at **1.44:1** and its real ratio, measured the same way with the
       * numbers scaled, is 7.38:1. It was the only failure in fifty-eight
       * samples and it was the instrument.
       *
       * Any ink written with `color-mix` hits this, and this domain has several.
       */
      const raw = (cs.color.match(/[\d.]+/g) ?? []).map(Number);
      const scale = cs.color.startsWith("color(") ? 255 : 1;
      const [r, g, b] = raw.slice(0, 3).map((n) => n * scale);
      return {
        r,
        g,
        b,
        css: cs.color,
        size: +size.toFixed(1),
        large: size >= 24 || (size >= 18.66 && weight >= 700),
      };
    });

    // Hide the ink, photograph the plate under it, restore.
    await target.evaluate((el) => {
      el.dataset.inkProbe = el.style.color;
      el.style.setProperty("color", "transparent", "important");
      for (const kid of el.querySelectorAll("*")) kid.style.setProperty("color", "transparent", "important");
    });
    let shot;
    try {
      shot = await target.screenshot();
    } catch {
      shot = null;
    }
    await target.evaluate((el) => {
      el.style.color = el.dataset.inkProbe ?? "";
      delete el.dataset.inkProbe;
      for (const kid of el.querySelectorAll("*")) kid.style.removeProperty("color");
    });
    if (!shot) {
      rows.push({ mode, route, label, ratio: null, note: "not visible" });
      continue;
    }

    const plate = await meanLuma(shot);
    const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
    const ink = 0.2126 * lin(info.r) + 0.7152 * lin(info.g) + 0.0722 * lin(info.b);
    const ratio = (Math.max(ink, plate) + 0.05) / (Math.min(ink, plate) + 0.05);
    const floor = info.large ? 3 : 4.5;
    rows.push({
      mode,
      route,
      label,
      px: info.size,
      floor,
      ratio: +ratio.toFixed(2),
      pass: ratio >= floor ? "yes" : "NO",
    });
  }
}

console.table(rows);
const bad = rows.filter((r) => r.pass === "NO");
console.log(bad.length === 0 ? "all pass" : `${bad.length} BELOW FLOOR`);
await browser.close();
process.exit(0);
