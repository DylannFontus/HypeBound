/**
 * Is a control off the fold, or behind a wall? Proved structurally, then by hand.
 *
 * `_ic9_reach.mjs` reported twenty-five unreachable controls and that number is
 * not trustworthy, for two reasons that are the instrument's and not the game's:
 *
 *   1. **"The biggest hero-material button" is a heuristic**, and on a screen
 *      made of big tiles it picks a tile in a list rather than the screen's
 *      action. A card three screens down a gallery is *supposed* to be off the
 *      fold.
 *   2. **A wheel is dispatched at a point.** If the scroller is a side column
 *      and the pointer is over a fixed header, the wheel does nothing and the
 *      control looks walled when it is merely elsewhere.
 *
 * Publishing that list would be the twelfth instrument. So this one answers the
 * question structurally instead of by gesture, and the structural answer cannot
 * be wrong about the thing that matters: **walk from the control to the root and
 * ask every ancestor whether it has anywhere to scroll to.** If not one node in
 * the chain has `scrollHeight > clientHeight` on an axis that would help, then
 * no gesture at any coordinate can ever bring the control into view, and the
 * question of where the pointer was does not arise.
 *
 * Then, and only for the controls that survive that, it dispatches gestures — a
 * wheel at every scrollable ancestor's own centre, plus a touch drag — so the
 * verdict is both proved and demonstrated.
 *
 *   node scripts/_ic9_wall.mjs
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const DIR = "scripts/screenshots/w9/ic9-wall";
mkdirSync(DIR, { recursive: true });

/**
 * The named action of each screen, by its own visible text — not by area.
 * A tile in a list is not a screen's action however large it is.
 */
const CASES = [
  { route: "gauntlet", text: "Start a run", cfgs: ["844x390@1", "844x390@1.6"] },
  { route: "events", text: "Practice match", cfgs: ["844x390@1", "844x390@1.6"] },
  { route: "settings", text: "Open accessibility settings", cfgs: ["844x390@1", "844x390@1.6"] },
  { route: "remixhub", text: "Play this week's Remix", cfgs: ["844x390@1.6"] },
  { route: "shop", text: "Open a free Drop", cfgs: ["844x390@1", "844x390@1.6"] },
  { route: "missions", text: "Claim step", cfgs: ["844x390@1", "844x390@1.6"] },
  { route: "stats", text: "Open the deck builder", cfgs: ["844x390@1.6"] },
  { route: "cloudsave", text: "Use the account's save", cfgs: ["844x390@1.6"] },
  { route: "signin", text: "Sign in", cfgs: ["844x390@1.6"] },
  { route: "lobby", text: "Play", cfgs: ["844x390@1.6"] },
  { route: "deckbuilder", text: "Save Deck", cfgs: ["844x390@1.6"] },
  { route: "pass", text: "Claim", cfgs: ["844x390@1.6"] },
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

const PROBE = (text) => {
  const el = [...document.querySelectorAll("button, a[href], [role='button']")].find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").includes(text)
  );
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const chain = [];
  let n = el.parentElement;
  while (n) {
    const cs = getComputedStyle(n);
    const room = n.scrollHeight - n.clientHeight;
    if (room > 2 || cs.overflowY === "auto" || cs.overflowY === "scroll") {
      chain.push({
        el: `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join(".")}`,
        overflowY: cs.overflowY,
        room,
        scrollTop: Math.round(n.scrollTop),
        cx: Math.round(n.getBoundingClientRect().left + n.getBoundingClientRect().width / 2),
        cy: Math.round(
          Math.min(Math.max(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2, 10), window.innerHeight - 10)
        ),
      });
    }
    n = n.parentElement;
  }
  const doc = document.documentElement;
  const docRoom = doc.scrollHeight - doc.clientHeight;
  return {
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    below: Math.round(Math.max(0, r.bottom - window.innerHeight)),
    inView: r.top >= 0 && r.bottom <= window.innerHeight,
    vh: window.innerHeight,
    scrollers: chain,
    docRoom,
  };
};

async function swipe(x, y, dy) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: 1 }] });
  for (let i = 1; i <= 12; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: Math.max(4, y - (dy * i) / 12), radiusX: 12, radiusY: 12, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const verdicts = [];
let current = null;
for (const c of CASES) {
  for (const cfgs of c.cfgs) {
    const [size, scaleStr] = cfgs.split("@");
    const [w, h] = size.split("x").map(Number);
    const scale = Number(scaleStr);
    if (current !== scale) {
      await setScale(scale);
      current = scale;
    }
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${ORIGIN}/?nointro#${c.route}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1200);
    let p = await page.evaluate(PROBE, c.text);
    const label = `${c.route.padEnd(12)} ${size}@${Math.round(scale * 100)}%  "${c.text}"`;
    if (p.missing) {
      console.log(`${label}  -- not on this screen`);
      continue;
    }
    if (p.inView) {
      console.log(`${label}  in view (bottom ${p.bottom} of ${p.vh})`);
      continue;
    }
    // structural verdict first
    const usable = p.scrollers.filter((s) => s.room > 2);
    const structurallyWalled = usable.length === 0 && p.docRoom <= 2;
    // then the demonstration: wheel over every scroller, then a swipe
    for (const s of usable.length ? usable : [{ cx: Math.round(w / 2), cy: Math.round(h / 2) }]) {
      await page.mouse.move(s.cx, s.cy);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(250);
    }
    let after = await page.evaluate(PROBE, c.text);
    if (!after.inView) {
      await swipe(Math.round(w / 2), Math.round(h * 0.8), 320);
      await page.waitForTimeout(300);
      await swipe(Math.round(w / 2), Math.round(h * 0.8), 320);
      await page.waitForTimeout(300);
      after = await page.evaluate(PROBE, c.text);
    }
    const verdict = after.inView ? "reachable by gesture" : structurallyWalled ? "WALL — no ancestor has anywhere to scroll" : "WALL — scrollers exist but no gesture reached it";
    if (!after.inView) {
      verdicts.push(`${c.route} ${size}@${Math.round(scale * 100)}% "${c.text}"`);
      await page.screenshot({ path: path.join(DIR, `${c.route}-${size}-${Math.round(scale * 100)}.png`) });
    }
    console.log(
      `${label}  ${p.below}px below (bottom ${p.bottom} of ${p.vh})  docRoom ${p.docRoom}  scrollers ${JSON.stringify(p.scrollers.map((s) => `${s.el} ${s.overflowY} room=${s.room}`))}  ->  ${verdict}`
    );
  }
}

console.log(`\nCONFIRMED WALLS (${verdicts.length}):`);
for (const v of verdicts) console.log(`  ${v}`);
await browser.close();
