/**
 * Can a finger reach the primary action of every screen, at every size the bar
 * names?
 *
 * Three unreachable controls have been found in this effort — the lobby's Inbox
 * badge, the deck builder's Save Deck, and the mulligan's Confirm — and all
 * three were found by accident, one at a time, after passing every automated
 * check. They passed because `locator.click()` scrolls first and because
 * "below the fold" and "unreachable" are different claims that every previous
 * instrument collapsed into one.
 *
 * They are different in exactly one way, and it is the only thing this file
 * measures: **is there a scroller between the control and the viewport that a
 * human gesture can actually move.** A button 800px down a scrollable page is
 * fine. A button 32px down an `overflow: hidden` grid item is a wall. Both look
 * identical to `getBoundingClientRect`.
 *
 * So every off-screen control gets three real attempts, in this order, and the
 * row records which of them worked:
 *
 *   WHEEL   `mouse.wheel(0, N)` — the desktop gesture
 *   SWIPE   a CDP touch drag — the phone gesture, which can move containers a
 *           wheel cannot and is refused by different things
 *   SCRIPT  `scrollBy` plus a write to every `scrollTop` — what
 *           `scrollIntoViewIfNeeded` does, which no player has. Reported
 *           separately and never counted as a pass; when this is the only one
 *           that works, that gap *is* the defect.
 *
 * The primary action is found the way a player finds it: the biggest hero-material
 * button on the screen, falling back to the first `.btn-primary`. Named by its
 * own text in the output so a row cannot silently be about a different button
 * than the one being discussed.
 *
 *   node scripts/_ic9_reach.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ROUTES = [
  "lobby", "collection", "deckbuilder", "shop", "decks", "settings", "a11y",
  "profile", "missions", "mastery", "pass", "achievements", "stats", "gallery",
  "leaderboards", "events", "tour", "gauntlet", "doomscroll", "story", "remixhub",
  "custom", "lab", "banner", "inbox", "replays", "signin", "cloudsave", "play",
];
const CONFIGS = [
  { w: 1280, h: 720, scale: 1 },
  { w: 844, h: 390, scale: 1 },
  { w: 1280, h: 720, scale: 1.4 },
  { w: 844, h: 390, scale: 1.6 },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await seedPlayedAccount(page, ORIGIN);

async function setScale(scale) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: new RegExp(`^${Math.round(scale * 100)}%$`) }).first().click();
  await page.waitForTimeout(350);
}

/** The one control the screen exists for, plus every other action's geometry. */
const ACTIONS = () => {
  const screen = document.querySelector(".screen:not(.screen-out)") ?? document.body;
  const buttons = [...screen.querySelectorAll("button, a[href], [role='button']")].filter((b) => {
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 8 && r.height > 8;
  });
  const score = (b) => {
    const cls = [...b.classList];
    const r = b.getBoundingClientRect();
    return (cls.includes("mat-hero") ? 1e6 : 0) + (cls.includes("btn-primary") ? 5e5 : 0) + r.width * r.height;
  };
  const hero = buttons.sort((a, b) => score(b) - score(a))[0];
  const geo = (b) => {
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      text: (b.textContent ?? b.getAttribute("aria-label") ?? "").trim().replace(/\s+/g, " ").slice(0, 34),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
      above: Math.round(Math.max(0, -r.top)),
      right: Math.round(Math.max(0, r.right - window.innerWidth)),
      inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
    };
  };
  const offscreen = buttons.map(geo).filter((g) => g && !g.inView);
  return { hero: geo(hero), offscreenCount: offscreen.length, offscreen: offscreen.slice(0, 4), vh: window.innerHeight };
};

async function swipe(x, y, dy) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: 1 }] });
  for (let i = 1; i <= 10; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: Math.max(4, y - (dy * i) / 10), radiusX: 12, radiusY: 12, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const walls = [];
for (const cfg of CONFIGS) {
  await setScale(cfg.scale);
  await page.setViewportSize({ width: cfg.w, height: cfg.h });
  console.log(`\n===== ${cfg.w}x${cfg.h} @ ${Math.round(cfg.scale * 100)}% =====`);
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1100);
    const a = await page.evaluate(ACTIONS);
    if (!a.hero) {
      console.log(`  ${route.padEnd(14)} (no action found)`);
      continue;
    }
    if (a.hero.inView) {
      console.log(
        `  ${route.padEnd(14)} "${a.hero.text}" in view` + (a.offscreenCount ? `   (${a.offscreenCount} other control(s) off screen)` : "")
      );
      continue;
    }
    // Off screen. Can a human bring it back?
    const dir = a.hero.below > 0 ? 1 : -1;
    await page.mouse.move(Math.round(cfg.w / 2), Math.round(cfg.h / 2));
    await page.mouse.wheel(0, dir * 600);
    await page.waitForTimeout(300);
    const afterWheel = await page.evaluate(ACTIONS);
    await swipe(Math.round(cfg.w / 2), Math.round(cfg.h * (dir > 0 ? 0.75 : 0.25)), dir * 300);
    await page.waitForTimeout(350);
    const afterSwipe = await page.evaluate(ACTIONS);
    await page.evaluate((d) => {
      window.scrollBy(0, d * 600);
      for (const el of document.querySelectorAll("*")) el.scrollTop += d * 600;
    }, dir);
    await page.waitForTimeout(300);
    const afterScript = await page.evaluate(ACTIONS);
    const reachable = afterWheel.hero?.inView || afterSwipe.hero?.inView;
    const scriptOnly = !reachable && afterScript.hero?.inView;
    if (!reachable) walls.push(`${cfg.w}x${cfg.h}@${Math.round(cfg.scale * 100)}% ${route} "${a.hero.text}"${scriptOnly ? " (script only)" : ""}`);
    console.log(
      `  ${route.padEnd(14)} "${a.hero.text}" ${a.hero.below ? `${a.hero.below}px BELOW` : ""}${a.hero.above ? `${a.hero.above}px ABOVE` : ""}${a.hero.right ? ` ${a.hero.right}px RIGHT` : ""}` +
        `  ->  wheel ${afterWheel.hero?.inView ? "OK" : "no"}, swipe ${afterSwipe.hero?.inView ? "OK" : "no"}, script ${afterScript.hero?.inView ? "OK" : "no"}` +
        (reachable ? "" : scriptOnly ? "   <-- WALL: only a script can reach it" : "   <-- WALL: nothing reaches it")
    );
  }
}

console.log(`\nWALLS (${walls.length}):`);
for (const w of walls) console.log(`  ${w}`);
await browser.close();
