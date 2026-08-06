/**
 * Which one is lying — the game or the gesture?
 *
 * `_ic9_wall.mjs` reported nine walls, and every one of them had a scroller with
 * hundreds or thousands of pixels of room. A container that can scroll and a
 * gesture that does not move it is a description of a broken gesture at least as
 * readily as it is a description of a broken screen, and four other rows in the
 * same run *were* moved by the same code — which proves the harness works
 * sometimes, and proves nothing about the rows where it did not.
 *
 * So this stops asking "did the button come into view" and starts asking, step
 * by step, **what each scroller's `scrollTop` was before and after each
 * gesture**. A container whose `scrollTop` went from 0 to 900 and left the button
 * where it was is a clipped inner box — the mulligan defect. A container whose
 * `scrollTop` stayed 0 after a wheel delivered over its own centre either cannot
 * scroll or is being reset, and the two are told apart by writing `scrollTop`
 * directly and seeing whether that sticks.
 *
 *   node scripts/_ic9_wall2.mjs gauntlet 844x390 1
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

const CASES = [
  ["gauntlet", "Start a run", 844, 390, 1],
  ["events", "Practice match", 844, 390, 1],
  ["settings", "Open accessibility settings", 844, 390, 1],
  ["missions", "Claim step", 844, 390, 1],
  ["remixhub", "Play this week's Remix", 844, 390, 1.6],
  ["cloudsave", "Use the account's save", 844, 390, 1.6],
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

const STATE = (text) => {
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
    if (room > 2) {
      const b = n.getBoundingClientRect();
      chain.push({
        el: `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join(".")}`,
        ov: cs.overflowY,
        room,
        top: Math.round(n.scrollTop),
        cx: Math.round(b.left + b.width / 2),
        cy: Math.round(Math.min(Math.max(b.top + b.height / 2, 10), window.innerHeight - 10)),
        h: Math.round(b.height),
      });
    }
    n = n.parentElement;
  }
  return { bottom: Math.round(r.bottom), below: Math.round(Math.max(0, r.bottom - window.innerHeight)), vh: window.innerHeight, chain };
};

for (const [route, text, w, h, scale] of CASES) {
  await setScale(scale);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1300);
  const s0 = await page.evaluate(STATE, text);
  console.log(`\n=== ${route} ${w}x${h} @${Math.round(scale * 100)}%  "${text}" ===`);
  console.log(`  before: bottom ${s0.bottom} of ${s0.vh} (${s0.below}px below)`);
  for (const c of s0.chain) console.log(`    scroller ${c.el.padEnd(38)} ${c.ov.padEnd(7)} room ${String(c.room).padStart(5)}  scrollTop ${c.top}  box h=${c.h} centre (${c.cx},${c.cy})`);

  // wheel, delivered over each scroller's own centre
  for (const c of s0.chain) {
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(320);
    const s = await page.evaluate(STATE, text);
    const now = s.chain.find((x) => x.el === c.el);
    console.log(`  wheel over ${c.el}: its scrollTop ${c.top} -> ${now?.top}, button bottom ${s0.bottom} -> ${s.bottom}`);
  }
  // touch drag over each scroller
  for (const c of s0.chain) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.cx, y: Math.min(h - 20, c.cy + 60), radiusX: 12, radiusY: 12, force: 1 }] });
    for (let i = 1; i <= 14; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: c.cx, y: Math.max(6, Math.min(h - 20, c.cy + 60) - (300 * i) / 14), radiusX: 12, radiusY: 12, force: 1 }],
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(400);
    const s = await page.evaluate(STATE, text);
    const now = s.chain.find((x) => x.el === c.el);
    console.log(`  swipe over ${c.el}: its scrollTop -> ${now?.top}, button bottom -> ${s.bottom}`);
  }
  // and the script write, as the upper bound on what any scroll can do
  await page.evaluate(
    ({ text }) => {
      const el = [...document.querySelectorAll("button, a[href], [role='button']")].find((b) =>
        (b.textContent ?? "").replace(/\s+/g, " ").includes(text)
      );
      let n = el?.parentElement;
      while (n) {
        n.scrollTop = n.scrollHeight;
        n = n.parentElement;
      }
    },
    { text }
  );
  await page.waitForTimeout(400);
  const sEnd = await page.evaluate(STATE, text);
  console.log(`  script scrollTop=max on every ancestor: button bottom -> ${sEnd.bottom} of ${sEnd.vh}  ${sEnd.below === 0 ? "IN VIEW" : `still ${sEnd.below}px below`}`);
  await page.screenshot({ path: path.join(DIR, `dbg-${route}-${w}x${h}-${Math.round(scale * 100)}.png`) });
}
await browser.close();
