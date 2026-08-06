/**
 * Text contrast across the assembled game, in both the default and the
 * high-contrast theme.
 *
 * The bar asks for 4.5:1 body and 3:1 large "in BOTH themes", and the thing that
 * makes this hard to eyeball is that HYPEBOUND's surfaces are translucent
 * materials over a moving atmosphere — so the effective background behind a word
 * is not the element's own `background-color`. This walks up the ancestor chain
 * compositing every semi-transparent fill until it reaches an opaque one, which
 * is the same thing the eye does.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

const audit = () =>
  page.evaluate(() => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = (c) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const effectiveBg = (el) => {
      let acc = null;
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (!c || c.a === 0) continue;
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 0.999) return acc;
      }
      return acc ?? { r: 8, g: 6, b: 16, a: 1 };
    };
    const bad = [];
    for (const el of document.querySelectorAll(".screen *")) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
      if (!txt) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 6 || b.height < 6) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.5) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = effectiveBg(el);
      const r = ratio(fg.a < 1 ? over(fg, bg) : fg, bg);
      const px = parseFloat(cs.fontSize);
      const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
      const need = large ? 3 : 4.5;
      if (r < need) bad.push({ t: txt.slice(0, 32), r: Math.round(r * 100) / 100, need, px: Math.round(px), cls: String(el.className).slice(0, 34) });
    }
    return bad.sort((a, b) => a.r - b.r).slice(0, 8);
  });

for (const contrast of ["normal", "high"]) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate((c) => document.documentElement.setAttribute("data-contrast", c), contrast);
  for (const r of ["lobby", "collection", "profile", "stats", "settings", "shop", "pass", "play", "leaderboards", "missions"]) {
    await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
    await page.evaluate((c) => document.documentElement.setAttribute("data-contrast", c), contrast);
    await page.waitForTimeout(2200);
    const bad = await audit();
    console.log(`[${contrast}] ${r.padEnd(12)} ${bad.length ? JSON.stringify(bad) : "ok"}`);
  }
}
await browser.close();
