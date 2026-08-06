/**
 * Reachability, done again — the first version of this was instrument twelve.
 *
 * `_ic9_reach.mjs` reported twenty-five unreachable controls across four
 * configurations. Every single one of them was wrong, and the way it was wrong
 * is worth more than the list was.
 *
 * It scrolled **600px, then swiped 300 more, then scripted 600 more, and checked
 * only at the end.** The controls it was chasing were eleven to a hundred and
 * eight pixels below the fold. So the button came into view, went straight past
 * the top of the screen, and the final check — `r.top >= 0` — correctly reported
 * that it was not in the viewport. Twenty-five confident "a finger cannot reach
 * this" verdicts, produced by a harness that had scrolled the button off the
 * other end. Exactly the shape of the eleven before it: a real measurement, of a
 * narrower question than the one asked.
 *
 * Two changes, and the second is the one that matters:
 *
 *   1. **The scroll is incremental and stops the moment the control is in
 *      view** — twelve steps of 140px, checked between every step, over each
 *      scrollable ancestor's own centre in turn. A gesture that arrives cannot
 *      then leave.
 *   2. **The row reports how far the player had to travel to get there.** That
 *      is the honest finding here: nothing is walled, but the shop's only
 *      purchase button sits 1,233px down a 390px viewport at 160%, which is nine
 *      swipes, and no previous instrument said so because "reachable" was the
 *      whole of what any of them asked.
 *
 *   node scripts/_ic9_reach2.mjs
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

const HERO = () => {
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
  const el = buttons.sort((a, b) => score(b) - score(a))[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const chain = [];
  let n = el.parentElement;
  while (n) {
    if (n.scrollHeight - n.clientHeight > 2) {
      const b = n.getBoundingClientRect();
      chain.push({
        cx: Math.round(b.left + b.width / 2),
        cy: Math.round(Math.min(Math.max(b.top + b.height / 2, 12), window.innerHeight - 12)),
      });
    }
    n = n.parentElement;
  }
  return {
    text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().replace(/\s+/g, " ").slice(0, 32),
    below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    right: Math.round(Math.max(0, r.right - window.innerWidth)),
    inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    chain,
  };
};

const walls = [];
const farAway = [];
for (const cfg of CONFIGS) {
  await setScale(cfg.scale);
  await page.setViewportSize({ width: cfg.w, height: cfg.h });
  console.log(`\n===== ${cfg.w}x${cfg.h} @ ${Math.round(cfg.scale * 100)}% =====`);
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1100);
    const h0 = await page.evaluate(HERO);
    if (!h0) continue;
    if (h0.inView) {
      console.log(`  ${route.padEnd(14)} "${h0.text}" in view`);
      continue;
    }
    let steps = 0;
    let now = h0;
    outer: for (const s of h0.chain.length ? h0.chain : [{ cx: cfg.w >> 1, cy: cfg.h >> 1 }]) {
      await page.mouse.move(s.cx, s.cy);
      for (let i = 0; i < 14; i += 1) {
        await page.mouse.wheel(0, 140);
        steps += 1;
        await page.waitForTimeout(130);
        now = await page.evaluate(HERO);
        if (now?.inView) break outer;
      }
    }
    if (!now?.inView) {
      // one last try with a real touch drag, also incremental
      for (let i = 0; i < 8 && !now?.inView; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: cfg.w >> 1, y: Math.round(cfg.h * 0.8), radiusX: 12, radiusY: 12, force: 1 }],
        });
        for (let k = 1; k <= 8; k += 1) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: cfg.w >> 1, y: Math.round(cfg.h * 0.8) - (120 * k) / 8, radiusX: 12, radiusY: 12, force: 1 }],
          });
          await new Promise((r) => setTimeout(r, 16));
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForTimeout(250);
        now = await page.evaluate(HERO);
        steps += 1;
      }
    }
    const travel = h0.below;
    if (!now?.inView) walls.push(`${cfg.w}x${cfg.h}@${Math.round(cfg.scale * 100)}% ${route} "${h0.text}" ${h0.below}px below ${h0.right}px right`);
    else if (travel > 2 * cfg.h) farAway.push(`${cfg.w}x${cfg.h}@${Math.round(cfg.scale * 100)}% ${route} "${h0.text}" ${travel}px (${(travel / cfg.h).toFixed(1)} screens)`);
    console.log(
      `  ${route.padEnd(14)} "${h0.text}" ${h0.below ? `${h0.below}px below` : ""}${h0.right ? ` ${h0.right}px right` : ""} -> ${now?.inView ? `reached after ${steps} step(s)` : "NOT REACHED  <-- WALL"}`
    );
  }
}

console.log(`\nWALLS (${walls.length}):`);
for (const w of walls) console.log(`  ${w}`);
console.log(`\nMORE THAN TWO SCREENS AWAY (${farAway.length}) — reachable, but a long way for a primary action:`);
for (const f of farAway) console.log(`  ${f}`);
await browser.close();
