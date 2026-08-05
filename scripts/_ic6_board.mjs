/**
 * The board at every size the constraints name, and with the decorative layer off.
 *
 * Two things no menu sweep can answer. First, the mat is a three.js scene with a
 * DOM HUD stapled to it, so its failure at 844x390 or at 160% text is a
 * different failure from a CSS grid's — the camera has to reframe *and* the HUD
 * has to fit. Second, §3's reduced-motion clause is a hard requirement rather
 * than a nicety, and the only honest test of "kills the decorative layer, keeps
 * the functional one" is to turn it on and look.
 *
 *   node scripts/_ic6_board.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const OUT = path.join(HERE, "screenshots", "w6", "critic-final", "board");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let s = 0;
  let c = 0;
  for (let i = 0; i + 2 < n; i += a.channels * 2) {
    s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    c += 3;
  }
  return s / c;
}

const CASES = [
  { tag: "1280x720", w: 1280, h: 720, settings: {} },
  { tag: "844x390", w: 844, h: 390, settings: {} },
  { tag: "1600x900-s14", w: 1600, h: 900, settings: { uiScale: 1.4 } },
  { tag: "1280x720-s16", w: 1280, h: 720, settings: { uiScale: 1.6 } },
  { tag: "1600x900-reduced", w: 1600, h: 900, settings: { reducedMotion: true } },
  { tag: "1600x900-contrast", w: 1600, h: 900, settings: { highContrast: true } },
];

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await seedPlayedAccount(page, ORIGIN);
  if (Object.keys(c.settings).length) {
    const got = await page.evaluate(async (patch) => {
      const mod = await import("/src/save/settings.ts");
      const storage = await import("/src/save/storage.ts");
      mod.updateSettings(patch);
      storage.flushAllStores();
      return mod.getSettings();
    }, c.settings);
    console.log(`[${c.tag}] uiScale=${got.uiScale} reducedMotion=${got.reducedMotion} highContrast=${got.highContrast}`);
  }
  await page.goto(`${ORIGIN}/?nointro#battle?seed=7&difficulty=casual`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => console.log(`[${c.tag}] no mulligan`));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${c.tag}-mulligan.png`) });
  await page.locator(".mulligan-actions .btn-primary").first().click().catch(() => {});
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn") !== null, null, { timeout: 40000 })
    .catch(() => console.log(`[${c.tag}] no end-turn button`));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, `${c.tag}-board.png`) });

  const fit = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const off = [];
    for (const e of document.querySelectorAll("button, .hand-card, .hud-panel, [role='button']")) {
      const b = e.getBoundingClientRect();
      if (b.width < 6 || b.height < 6) continue;
      if (b.right > vw + 1 || b.left < -1 || b.bottom > vh + 1 || b.top < -1) {
        off.push(`${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0]} ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    }
    return { off, hand: document.querySelectorAll(".hand-card").length, xscroll: document.documentElement.scrollWidth > vw + 2 };
  });
  console.log(`[${c.tag}] hand=${fit.hand} xscroll=${fit.xscroll} offscreen=${fit.off.length}`);
  for (const s of fit.off.slice(0, 5)) console.log(`      off ${s}`);

  // is it alive?
  const shots = [];
  for (let i = 0; i < 12; i += 1) {
    shots.push(decodePng(await page.screenshot()));
    await page.waitForTimeout(200);
  }
  const ds = [];
  for (let i = 1; i < shots.length; i += 1) ds.push(meanDelta(shots[i - 1], shots[i]));
  ds.sort((a, b) => a - b);
  console.log(
    `[${c.tag}] idle min=${ds[0].toFixed(3)} median=${ds[Math.floor(ds.length / 2)].toFixed(3)} max=${ds[ds.length - 1].toFixed(3)}  [reference min 0.50 median 1.71]`
  );
  await page.close();
}

await browser.close();
