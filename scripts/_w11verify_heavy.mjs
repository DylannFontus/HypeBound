/**
 * Do the card-heavy screens still block the main thread, and is anything shown
 * while they build?
 *
 * ## Why long tasks and not a frame rate
 *
 * Wave 8 and wave 9 both costed these screens in **long tasks** — gallery
 * 1066ms then 221ms, deck builder 692ms then 299ms, collection 547ms then
 * 528ms — so a comparable number has to be the same quantity. It also has to
 * be, because this project's own notes record that a rAF gap trace cannot see a
 * compositor curtain: rAF runs on the main thread and reports blocking whether
 * or not the player is looking at something. Long tasks measure the thing that
 * is actually being complained about, which is the main thread being gone.
 *
 * ## The four traps this closes, all of them ones this project has already hit
 *
 * 1. **The observer must not live inside a long-lived `page.evaluate`.** An fps
 *    probe written that way once reported 9–19fps for a page running at 75.
 *    Here the observer is installed by an `evaluate` that returns immediately,
 *    parks its results on `window`, and is read back by a *separate* `evaluate`
 *    after the navigation. Nothing measures itself.
 *
 * 2. **It is calibrated before it is trusted.** A known 300ms busy loop is run
 *    first and has to show up as a long task of roughly that length. An empty
 *    result from an observer that was never wired looks exactly like a screen
 *    that costs nothing, and this file would rather fail loudly than report a
 *    zero it has not earned.
 *
 * 3. **The window is bounded by the navigation, not by a fixed sleep.** The
 *    counter is reset immediately before the hash change and read after the
 *    incoming screen has settled, so what is attributed to entering the
 *    Collection is what happened while it was entering.
 *
 * 4. **"Is there a loading state" is answered by watching, not by asking once.**
 *    A veil that exists for 180ms is invisible to a single sample taken at
 *    400ms. A MutationObserver records every value `data-nav` takes and every
 *    veil element that appears, so the answer is a timeline rather than a
 *    snapshot — which is also the only way to tell a deliberate cover from a
 *    screen that simply was not drawn yet.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ROUTES = ["collection", "gallery", "deckbuilder", "missions"];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message.slice(0, 200)));

await seedPlayedAccount(page);
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForSelector(".lobby-screen", { timeout: 20000 });

/** Install the observers once, on the live document. Returns immediately. */
await page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__hb = { tasks: [], nav: [], veils: [], t0: performance.now() };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__hb.tasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ entryTypes: ["longtask"] });
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.attributeName === "data-nav") {
        w.__hb.nav.push({ t: performance.now(), v: /** @type {Element} */ (r.target).getAttribute("data-nav") });
      }
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const c = n.className && typeof n.className === "string" ? n.className : "";
        if (/curtain|veil|skeleton|shimmer|loading|spinner/i.test(c)) w.__hb.veils.push({ t: performance.now(), c });
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-nav"] });
  w.__hbReset = () => {
    w.__hb.tasks = [];
    w.__hb.nav = [];
    w.__hb.veils = [];
    w.__hb.t0 = performance.now();
  };
  w.__hbRead = () => ({ ...w.__hb, elapsed: performance.now() - w.__hb.t0 });
});

/**
 * The calibration block is scheduled with `setTimeout` rather than run inside
 * the `evaluate` itself, and that is not a stylistic choice — it is the
 * difference between this file working and this file lying.
 *
 * A first version ran the busy loop directly in `page.evaluate` and the
 * observer reported **0ms across 0 long tasks** for a deliberate 300ms block.
 * Playwright drives `evaluate` over CDP, and a task entered from the debugger
 * is not attributed to the frame, so the Long Tasks API never sees it. Had the
 * calibration not been there, every route below would have measured 0ms and
 * this script would have reported that the heavy screens had become free.
 *
 * Instrument sixteen, caught by the tripwire rather than by the result.
 */
await page.evaluate(() => {
  /** @type {any} */ (window).__hbReset();
  setTimeout(() => {
    const end = performance.now() + 300;
    while (performance.now() < end) {
      /* deliberately blocking, from a task the page owns */
    }
  }, 0);
});
await page.waitForTimeout(800);
const calib = await page.evaluate(() => /** @type {any} */ (window).__hbRead());
const calibTotal = calib.tasks.reduce((s, t) => s + t.dur, 0);
console.log(`calibration: a deliberate 300ms block measured as ${calibTotal.toFixed(0)}ms across ${calib.tasks.length} long task(s)`);
if (calibTotal < 250) {
  console.log("ABORT — the long-task observer did not see a block it was handed. Every figure below would be a false zero.");
  await browser.close();
  process.exit(1);
}

console.log("\nroute            longTasks   total   longest   nav states seen                veil/skeleton nodes");
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lobby-screen", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => /** @type {any} */ (window).__hbReset());
  await page.evaluate((r) => {
    location.hash = `#${r}`;
  }, route);
  // Settle on the incoming screen rather than on a clock: the window has to
  // cover the whole build, and a fixed wait either clips it or pads it.
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => /** @type {any} */ (window).__hbRead());
  const total = r.tasks.reduce((s, t) => s + t.dur, 0);
  const longest = r.tasks.reduce((m, t) => Math.max(m, t.dur), 0);
  const navStates = [...new Set(r.nav.map((n) => n.v).filter(Boolean))].join(",") || "(none)";
  const veils = r.veils.length ? [...new Set(r.veils.map((v) => v.c.split(" ")[0]))].join(",") : "(none)";
  console.log(
    `${route.padEnd(16)}${String(r.tasks.length).padStart(9)}${total.toFixed(0).padStart(8)}ms${longest
      .toFixed(0)
      .padStart(8)}ms   ${navStates.padEnd(30)} ${veils}`
  );
}

// --- what a card cell shows before its picture arrives ------------------------
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const cells = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const canvases = q("canvas");
  return {
    cardCellCount: q("[class*='card-cell'], .collection-card, .card-tile").length,
    canvasCount: canvases.length,
    canvasWithSize: canvases.filter((c) => c.width > 0 && c.height > 0).length,
    artRequestsAreWebp: performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/assets/art/"))
      .slice(0, 3)
      .map((e) => e.name.split("/").pop() + " " + Math.round(e.transferSize / 1024) + "KB"),
    totalArtRequests: performance.getEntriesByType("resource").filter((e) => e.name.includes("/assets/art/")).length,
    artBytes: Math.round(
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("/assets/art/"))
        .reduce((s, e) => s + e.transferSize, 0) / 1024
    ),
  };
});
console.log("\ncollection cells / art arrival:");
console.log(JSON.stringify(cells, null, 2));

await browser.close();
