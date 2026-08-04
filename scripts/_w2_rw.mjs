/**
 * Rewards-domain instrumentation.
 *
 * Stills cannot answer the two questions this domain keeps failing on: whether
 * the overlay plane is actually separated from the screen behind it, and
 * whether the reveal beats fire when they claim to. This drives the real
 * browser, reads computed styles and records animation events, so both are
 * measured rather than guessed at from a PNG.
 *
 *   node scripts/_w2_rw.mjs <probe-name>
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const which = process.argv[2] ?? "veil";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  if (which === "boot") {
    await page.goto(ORIGIN, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log(await page.evaluate(() => document.body.innerHTML.slice(0, 300)));
    console.log(`\nerrors:\n${errors.slice(0, 6).join("\n---\n")}`);
    await browser.close();
    process.exit(0);
  }

  await seedPlayedAccount(page, ORIGIN);

  if (which === "veil") {
    await page.goto(`${ORIGIN}/#shop`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.hypeboundShop.buy());
    await page.waitForTimeout(400);
    console.log(
      JSON.stringify(
        await page.evaluate(() => {
          const veil = document.querySelector(".rw-open-veil");
          const cs = getComputedStyle(veil);
          return {
            bgColor: cs.backgroundColor,
            bgImage: cs.backgroundImage.slice(0, 240),
            backdrop: cs.backdropFilter,
            opacity: cs.opacity,
            rect: veil.getBoundingClientRect().toJSON(),
            overlayBg: getComputedStyle(document.querySelector(".rw-open")).backgroundColor,
          };
        }),
        null,
        2,
      ),
    );
  }

  if (which === "motion") {
    await page.goto(`${ORIGIN}/#shop`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__ev = [];
      const t0 = performance.now();
      for (const type of ["animationstart", "animationend", "transitionstart", "transitionend"]) {
        document.addEventListener(
          type,
          (e) => {
            const target = e.target instanceof Element ? e.target : null;
            window.__ev.push({
              t: Math.round(performance.now() - t0),
              type,
              name: e.animationName ?? e.propertyName,
              on: target ? `${target.className}`.slice(0, 46) : "?",
            });
          },
          true,
        );
      }
      window.__long = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__long.push({ t: Math.round(entry.startTime - t0), ms: Math.round(entry.duration) });
        }
      }).observe({ entryTypes: ["longtask"] });
      window.hypeboundShop.buy();
    });
    await page.waitForTimeout(700);
    // .click() rather than the locator: the pack floats on an idle loop, so
    // Playwright's stability check never settles and the click never lands.
    await page.evaluate(() => document.querySelector(".rw-pack")?.click());
    await page.waitForTimeout(6500);
    const res = await page.evaluate(() => ({ ev: window.__ev ?? [], long: window.__long ?? [] }));
    const seen = new Map();
    for (const e of res.ev) {
      const key = `${e.type}:${e.name}`;
      if (!seen.has(key)) seen.set(key, { first: e.t, n: 0, on: e.on });
      seen.get(key).n += 1;
    }
    for (const [key, v] of seen) console.log(`${String(v.first).padStart(5)}ms  x${String(v.n).padStart(3)}  ${key}  (${v.on})`);
    console.log("\nlong tasks:", JSON.stringify(res.long));
  }

  if (which === "contrast") {
    const routes = ["pass", "achievements", "missions", "shop", "banner"];
    const report = [];
    for (const route of routes) {
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1400);
      report.push(
        await page.evaluate((name) => {
          const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
          const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
          const behind = (el) => {
            let node = el;
            const stack = [];
            while (node && node !== document.documentElement) {
              const cs = getComputedStyle(node);
              const [r, g, b, a = 1] = parse(cs.backgroundColor);
              if (a > 0) stack.push([r, g, b, a]);
              node = node.parentElement;
            }
            stack.push([9, 5, 18, 1]);
            let out = stack.pop();
            for (let i = stack.length - 1; i >= 0; i--) {
              const [r, g, b, a] = stack[i];
              out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1];
            }
            return out;
          };
          const bad = [];
          for (const el of document.querySelectorAll("body *")) {
            if (el.children.length > 0) continue;
            const text = (el.textContent ?? "").trim();
            if (!text) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            const box = el.getBoundingClientRect();
            if (box.width < 2 || box.height < 2) continue;
            let alpha = 1;
            for (let n = el; n && n !== document.body; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
            if (alpha < 0.05) continue;
            const [fr, fg, fb, fa = 1] = parse(cs.color);
            const bg = behind(el);
            const eff = [
              fr * fa * alpha + bg[0] * (1 - fa * alpha),
              fg * fa * alpha + bg[1] * (1 - fa * alpha),
              fb * fa * alpha + bg[2] * (1 - fa * alpha),
            ];
            const l1 = lum(eff);
            const l2 = lum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            const size = Number.parseFloat(cs.fontSize);
            const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
            const floor = large ? 3 : 4.5;
            if (ratio < floor) {
              bad.push({
                text: text.slice(0, 34),
                cls: `${el.className}`.slice(0, 34),
                ratio: Math.round(ratio * 100) / 100,
                size: Math.round(size),
                floor,
              });
            }
          }
          return { route: name, count: bad.length, worst: bad.sort((a, b) => a.ratio - b.ratio).slice(0, 12) };
        }, route),
      );
    }
    console.log(JSON.stringify(report, null, 1));
  }

  if (which === "clean") {
    for (const route of ["shop", "banner", "pass", "missions", "achievements"]) {
      errors.length = 0;
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const stats = await page.evaluate(() => ({
        // horizontal page scroll is a layout failure, never a design choice
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        // anything wearing a state class must still say the state in text somewhere
        srWords: document.querySelectorAll(".rw-sr").length,
        lockTiles: document.querySelectorAll('.rw-tile[data-state="locked"]').length,
      }));
      console.log(`${route}: ${JSON.stringify(stats)} errors=${errors.length}${errors.length ? ` ${errors[0]}` : ""}`);
    }
  }

  if (which === "a11y") {
    // The settings hook only exists while the accessibility screen is mounted,
    // so the switches are thrown there and the route is visited afterwards.
    await page.goto(`${ORIGIN}/#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.hypeboundA11y.set({ reducedMotion: true, highContrast: true }));
    await page.waitForTimeout(300);
    for (const route of ["shop", "pass", "achievements"]) {
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `scripts/screenshots/w2/rewards2/a11y-${route}.png` });
    }
    // and the reveal, which is the one thing reduced motion could break outright
    await page.goto(`${ORIGIN}/#shop`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.hypeboundShop.buy());
    await page.waitForTimeout(900);
    await page.screenshot({ path: "scripts/screenshots/w2/rewards2/a11y-reveal.png" });
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          contrast: document.documentElement.getAttribute("data-contrast"),
          motion: document.documentElement.getAttribute("data-reduced-motion"),
          shown: document.querySelectorAll(".reveal-slot.shown").length,
          slots: document.querySelectorAll(".reveal-slot").length,
          doneEnabled: !document.querySelector("#reveal-done")?.disabled,
        })),
      ),
    );
  }

  if (which === "pity") {
    await page.goto(`${ORIGIN}/#banner`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    console.log(
      JSON.stringify(
        await page.evaluate(() => {
          const out = [];
          for (let i = 0; i < 6; i++) out.push(Boolean(window.hypeboundBanner.pull(10)));
          return {
            pulls: out,
            button: Boolean(document.querySelector(".rw-pull10")),
            disabled: document.querySelector(".rw-pull10")?.disabled ?? null,
            view: window.hypeboundBanner.view(),
          };
        }),
        null,
        1,
      ),
    );
  }

  if (which === "layout") {
    const size = (process.argv[3] ?? "844x390").split("x").map(Number);
    await page.setViewportSize({ width: size[0], height: size[1] });
    for (const [route, sels] of [
      ["shop", [".rw-shop-body", ".rw-shop-left", ".rw-shop-hero", ".rw-shop-pack", ".rw-shop-buyrow"]],
      ["pass", [".rw-pass-body", ".rw-pass-head", ".pass-track", ".pass-lane-key", ".rw-track", ".pass-rows"]],
      ["banner", [".rw-banner-body", ".rw-banner-scroll", ".rw-pullrail", ".rw-seg"]],
    ]) {
      await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1300);
      console.log(
        `\n== ${route} @ ${size.join("x")}\n` +
          JSON.stringify(
            await page.evaluate((list) =>
              list.map((sel) => {
                const el = document.querySelector(sel);
                if (!el) return { sel, missing: true };
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                  sel,
                  x: Math.round(b.x),
                  y: Math.round(b.y),
                  w: Math.round(b.width),
                  h: Math.round(b.height),
                  disp: cs.display,
                  cols: cs.gridTemplateColumns,
                  rows: cs.gridTemplateRows,
                  ov: `${cs.overflowX}/${cs.overflowY}`,
                };
              }),
            sels),
            null,
            1,
          ),
      );
    }
  }

  if (errors.length) console.log(`\nconsole errors: ${JSON.stringify(errors.slice(0, 8), null, 1)}`);
} finally {
  await browser.close();
}
