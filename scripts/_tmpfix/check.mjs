/** Regression sweep: reduced motion, ui-scale, high contrast, overflow, focus ring. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ROUTES = ["lobby", "play", "starter", "signin"];
const SIZES = [[1600, 900], [1280, 720], [844, 390]];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const probe = async (page) =>
  page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const scrollerOf = (el) => {
      let p = el.parentElement;
      while (p) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return p;
        p = p.parentElement;
      }
      return null;
    };
    let unreachable = 0;
    const offenders = [];
    for (const el of document.querySelectorAll(".screen *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      const out = r.top > vh - 1 || r.bottom < 1 || r.left > vw - 1 || r.right < 1;
      if (!out) continue;
      if (scrollerOf(el)) continue;
      unreachable++;
      if (offenders.length < 4) offenders.push(`${el.className || el.tagName}`.slice(0, 50));
    }
    return {
      running: document.getAnimations().filter((a) => a.playState === "running").length,
      unreachable,
      offenders,
      bodyScroll: document.body.scrollWidth > vw + 1,
    };
  });

try {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await seedPlayedAccount(page, ORIGIN);
    for (const route of ROUTES) {
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1100);
      console.log(`${w}x${h} ${route}`, JSON.stringify(await probe(page)));
    }
    await page.close();
  }

  // reduced motion + high contrast + ui-scale, on the lobby
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await seedPlayedAccount(page, ORIGIN);
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const rm = await page.evaluate(() => {
      document.documentElement.setAttribute("data-reduced-motion", "true");
      return new Promise((r) => setTimeout(() => r({
        running: document.getAnimations().filter((a) => a.playState === "running").length,
        bandVisible: [...document.querySelectorAll(".mat-panel")].some(
          (el) => parseFloat(getComputedStyle(el, "::after").opacity) > 0.01
        ),
        hidden: [...document.querySelectorAll(".lobby-nav-btn, .mode-card, .starter-option, .signin-submit")]
          .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99).length,
      }), 400));
    });
    console.log(`reduced-motion ${route}`, JSON.stringify(rm));
    await page.evaluate(() => document.documentElement.removeAttribute("data-reduced-motion"));
  }

  for (const scale of [0.9, 1.25, 1.5]) {
    await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
    await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), scale);
    await page.waitForTimeout(700);
    console.log(`ui-scale ${scale}`, JSON.stringify(await probe(page)));
  }

  await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const ring = await page.evaluate(async () => {
    document.documentElement.setAttribute("data-keyboard-nav", "true");
    const btn = document.querySelector("#lobby-play");
    btn.focus();
    await new Promise((r) => setTimeout(r, 320));
    const cs = getComputedStyle(btn);
    return { outline: `${cs.outlineColor} ${cs.outlineStyle} ${cs.outlineWidth}`, offset: cs.outlineOffset, boxShadow: cs.boxShadow, radius: cs.borderRadius };
  });
  console.log("focus ring settled", JSON.stringify(ring, null, 1));
} finally {
  await browser.close();
}
