/**
 * Enumerate every under-44px touch target and every sub-11px text node across
 * the same screens verify-mobile walks, with enough identity (tag + full class
 * chain + parent) to find the rule that produced it.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ONLY=process.argv[2];const ALL = [
  { name: "667x375", width: 667, height: 375, dpr: 2 },
  { name: "915x412", width: 915, height: 412, dpr: 2.6 },
  { name: "1080x810", width: 1080, height: 810, dpr: 2 },
];
const VIEWPORTS = ONLY ? ALL.filter(v=>v.name===ONLY) : ALL;

const SCREENS = [
  ["lobby", ".lobby-screen"],
  ["play", ".play-screen"],
  ["collection", ".collection-screen"],
  ["decks", ".deck-slots-screen"],
  ["deckbuilder", ".builder-screen"],
  ["shop", ".shop-screen"],
  ["missions", ".missions-screen"],
  ["profile", ".profile-screen"],
  ["gauntlet", ".gauntlet-screen"],
  ["events", ".events-screen"],
  ["a11y", ".a11y-screen"],
  ["settings", ".settings-screen"],
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const probe = () =>
  // eslint-disable-next-line no-undef
  window.__probe();

for (const vp of VIEWPORTS) {
  console.log(`\n===== ${vp.name} =====`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await seedPlayedAccount(page);
  for (const [hash, sel] of SCREENS) {
    await page.goto(`${ORIGIN}/#${hash}`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector(sel, { timeout: 15000 });
    } catch {
      console.log(`  ${hash}: never rendered`);
      continue;
    }
    await page.waitForTimeout(Number(process.env.SETTLE ?? 300));
    const result = await page.evaluate(() => {
      const ident = (el) => {
        const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
        const p = el.parentElement;
        const pcls = p && typeof p.className === "string" && p.className ? `.${p.className.trim().split(/\s+/)[0]}` : p ? p.tagName.toLowerCase() : "";
        return `${pcls} > ${el.tagName.toLowerCase()}${cls}${el.id ? `#${el.id}` : ""}`;
      };
      const interactive = [...document.querySelectorAll("button, a, [role='switch'], [role='radio'], input, select")].filter((el) => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      });
      const small = interactive
        .map((el) => {
          const b = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            id: ident(el),
            text: (el.textContent ?? "").trim().slice(0, 20),
            w: Math.round(b.width),
            h: Math.round(b.height),
            lw: el.offsetWidth,
            lh: el.offsetHeight,
            tf: s.transform === "none" ? "" : s.transform,
            mh: s.minHeight,
          };
        })
        .filter((e) => e.w < 44 || e.h < 44);
      const tiny = [...document.querySelectorAll("p, li, td, span, div")]
        .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 3)
        .map((el) => ({ id: ident(el), text: (el.textContent ?? "").trim().slice(0, 20), px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 }))
        .filter((e) => e.px > 0 && e.px < 11);
      return { small, tiny };
    });
    if (result.small.length || result.tiny.length) {
      console.log(`  --- #${hash}`);
      for (const e of result.small) console.log(`    SMALL rect ${e.w}x${e.h} layout ${e.lw}x${e.lh} min-h ${e.mh} tf[${e.tf}]  ${e.id}   "${e.text}"`);
      for (const e of result.tiny) console.log(`    TINY  ${e.px}px    ${e.id}   "${e.text}"`);
    }
  }
  await ctx.close();
}
await browser.close();
void probe;
