/** Pixel-level checks: disabled-button contrast, sheen amplitude, list fade masks. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page);

const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

await page.goto("http://localhost:5173/?nointro#cloudsave", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
console.log("CLOUDSAVE BUTTONS", JSON.stringify(await page.evaluate(() => {
  const px = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const over = (fg, bg, a) => [0,1,2].map((i) => fg[i]*a + bg[i]*(1-a));
  const out = [];
  for (const b of document.querySelectorAll(".cloud-save-actions button, .cloud-save-actions .btn")) {
    const cs = getComputedStyle(b);
    // effective element opacity chain
    let a = 1, n = b;
    while (n && n !== document.body) { a *= Number(getComputedStyle(n).opacity); n = n.parentElement; }
    const ink = px(cs.color).slice(0,3);
    const inkA = px(cs.color)[3] ?? 1;
    // plate colour: read the background-image is a gradient, so sample the background-color fallback + the accent
    const plate = px(cs.backgroundColor).slice(0,3);
    const page = [10,6,20];
    const plateEff = over(plate, page, a * (px(cs.backgroundColor)[3] ?? 1));
    const inkEff = over(ink, plateEff, a * inkA);
    out.push({ label: b.innerText.trim(), disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), opacity: cs.opacity, chainOpacity: Number(a.toFixed(3)), colour: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0,60), ratio: Number(((Math.max(L(inkEff),L(plateEff))+0.05)/(Math.min(L(inkEff),L(plateEff))+0.05)).toFixed(2)) });
  }
  return out;
}), null, 1));

// --- sheen amplitude on a panel: sample the same pixel over one period -----
await page.goto("http://localhost:5173/?nointro#replays", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
const sheen = await page.evaluate(() => {
  const n = document.querySelectorAll(".mat-panel, .mat-chip, .mat-hero").length;
  const anims = document.getAnimations().filter((a) => a.animationName === "hb-sheen-pass");
  return { materials: n, sheens: anims.length, sample: anims.slice(0, 3).map((a) => ({ dur: a.effect.getTiming().duration, delay: a.effect.getTiming().delay })) };
});
console.log("REPLAYS SHEEN", JSON.stringify(sheen));

// --- does the list have a fade mask at the clipped edge? -------------------
for (const [route, sel] of [["news", ".news-list, .d-list"], ["inbox", ".mail-list, .d-list"], ["replays", ".replay-list"]]) {
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(1300);
  const info = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { missing: s };
    const cs = getComputedStyle(el);
    return {
      sel: s,
      mask: cs.maskImage !== "none" ? cs.maskImage.slice(0, 70) : (cs.webkitMaskImage !== "none" ? cs.webkitMaskImage.slice(0, 70) : "NONE"),
      overflowY: cs.overflowY,
      scrollable: el.scrollHeight > el.clientHeight,
      sbWidth: el.offsetWidth - el.clientWidth,
      h: Math.round(el.clientHeight), sh: Math.round(el.scrollHeight),
    };
  }, sel);
  console.log(route.toUpperCase(), JSON.stringify(info));
}

// --- scrollbar chrome: is it themed on every scroller? ---------------------
for (const route of ["profile", "mastery", "stats", "news", "inbox", "settings", "privacy", "story", "custom", "lab"]) {
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  await page.waitForTimeout(1100);
  const out = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll(".screen:not(.screen-out) *")) {
      const cs = getComputedStyle(el);
      if (!/auto|scroll/.test(cs.overflowY) && !/auto|scroll/.test(cs.overflowX)) continue;
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
      if (cs.scrollbarWidth === "auto" && cs.scrollbarColor === "auto") bad.push(el.className.toString().split(" ").slice(0, 2).join("."));
    }
    return [...new Set(bad)];
  });
  if (out.length) console.log("UNTHEMED SCROLLER", route, JSON.stringify(out));
}
await browser.close();
