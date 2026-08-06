/**
 * What the framed wall costs to scroll, against the grid it is judged beside.
 *
 * The gallery now builds a hundred and thirty-eight `.mat-panel` tiles, each an
 * isolated stacking context with a `::after` band, standing on eleven nested
 * `.mat-panel` shelves, under one full-column light layer — and an
 * IntersectionObserver toggling a class on about twenty of them every time the
 * scroller moves. Every one of those is a plausible way to lose the 60fps floor,
 * and none of them is visible in a still.
 *
 * ## What this measures, and what it cannot
 *
 * rAF deltas on the page's own main thread while the scroller is driven at a
 * fixed rate. That is honest for *this* question — a style recalculation, a
 * layout or a paint caused by the class toggle lands on the main thread and
 * shows up as a long frame — and it is explicitly **not** an fps meter: rAF
 * cannot see the compositor, so a screen that is smooth on the compositor and
 * blocked on the main thread reads as blocked, which is the conservative
 * direction. The state doc records this the other way round as a trap, so it is
 * stated here rather than assumed.
 *
 * The control is `#collection`, whose scroller holds 245 card tiles and is one
 * of the rooms already scored at 9. Comparing two numbers taken by one probe in
 * one session is worth more than either against a remembered absolute.
 *
 * usage: node scripts/_w7gal_scroll.mjs
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

/**
 * Drive one scroller at 14px per frame for four seconds and record every gap.
 *
 * The scroll is written from inside the rAF callback so it is one write per
 * frame and cannot outrun the renderer — a `for` loop of `scrollTop +=` would
 * measure the loop.
 */
async function run(route, selector, screen) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "load" });
  await page.waitForSelector(screen, { timeout: 25000 });
  await page.waitForTimeout(4000);
  return page.evaluate(
    ([sel]) =>
      new Promise((resolve) => {
        const el = document.querySelector(sel);
        if (!el) return resolve({ error: `no ${sel}` });
        const gaps = [];
        let last = performance.now();
        const started = last;
        let dir = 1;
        const step = (now) => {
          gaps.push(now - last);
          last = now;
          el.scrollTop += 14 * dir;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) dir = -1;
          if (el.scrollTop <= 0) dir = 1;
          if (now - started < 4000) requestAnimationFrame(step);
          else {
            gaps.shift();
            const sorted = [...gaps].sort((a, b) => a - b);
            const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
            resolve({
              frames: gaps.length,
              median: +at(0.5).toFixed(2),
              p95: +at(0.95).toFixed(2),
              worst: +Math.max(...gaps).toFixed(2),
              over33: gaps.filter((g) => g > 33).length,
              over16: gaps.filter((g) => g > 16.8).length,
              scrolled: Math.round(el.scrollHeight),
            });
          }
        };
        requestAnimationFrame(step);
      }),
    [selector]
  );
}

const rows = [
  ["#gallery wall", await run("gallery", "#gallery-scroll", ".gallery-screen")],
  ["#collection grid", await run("collection", "#card-grid", ".collection-screen")],
];

for (const [label, r] of rows) {
  if (r.error) console.log(`${label.padEnd(18)} ${r.error}`);
  else
    console.log(
      `${label.padEnd(18)} frames ${String(r.frames).padStart(4)}  median ${String(r.median).padStart(6)}ms  ` +
        `p95 ${String(r.p95).padStart(6)}ms  worst ${String(r.worst).padStart(7)}ms  ` +
        `>16.8ms ${String(r.over16).padStart(3)}  >33ms ${String(r.over33).padStart(3)}  ` +
        `content ${r.scrolled}px`
    );
}

await browser.close();
