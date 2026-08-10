/**
 * What one declaration costs one engine, measured synchronously.
 *
 * ## Why this exists rather than another frame-rate probe
 *
 * `_w10ipad_raf.mjs` established that Playwright's WebKit on Windows fires
 * exactly **one** `requestAnimationFrame` callback and then stops, headless and
 * headed alike, while reporting `visibilityState: "visible"` and 31 running
 * animations. It has no display link. Every rendering-rate number that engine
 * could produce is computed over zero samples, which is how instrument eleven
 * happened, so no such number appears anywhere in this file.
 *
 * What that engine *can* still do honestly is run script and flush style and
 * layout on demand, because `setTimeout` ticks normally. So this measures the
 * one thing both engines will answer for identically: **the main-thread cost of
 * a forced style recalculation and layout after a mutation the shell actually
 * performs.** `shell.ts::markCascade` exists because `_w3nav_split.mjs` measured
 * exactly this for Blink and found a class that matches nothing costing 12–22ms;
 * this is that instrument pointed at a second engine.
 *
 * ## What it does not measure, said out loud
 *
 * Compositing. Layerisation, render-surface allocation and rasterisation happen
 * in the rendering update, which is driven by the display link this engine does
 * not have. If the iPad's stall is a compositor cost — and the reasoning in the
 * report says it most likely is — **this instrument cannot see it**, and a flat
 * result here is not evidence of absence.
 *
 * ## Calibration
 *
 * `noop` mutates a data attribute nobody styles. Its reading is the floor: the
 * cost of the forced flush itself plus the timer's resolution. No row below is
 * worth reading unless it clears that floor.
 */

import { chromium, webkit } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const IPAD = { width: 1194, height: 834 };
const SAMPLES = 40;

/**
 * Each case: apply, then force a flush, then undo. Written as strings because
 * they run in the page. The subject is always `.screen`, which is what the
 * shell writes to and the largest element in the document.
 */
const CASES = `[
  ["noop",              el => el.dataset.w10 = "1",                          el => delete el.dataset.w10],
  ["class-nomatch",     el => el.classList.add("w10-matches-nothing"),       el => el.classList.remove("w10-matches-nothing")],
  ["seal-screen-out",   el => el.classList.add("screen-out"),                el => el.classList.remove("screen-out")],
  ["inert",             el => el.setAttribute("inert",""),                   el => el.removeAttribute("inert")],
  ["data-nav-hold",     el => el.dataset.nav = "descend-hold",               el => delete el.dataset.nav],
  ["data-nav-out",      el => el.dataset.nav = "descend-out",                el => delete el.dataset.nav],
  ["data-nav-in",       el => el.dataset.nav = "descend-in",                 el => delete el.dataset.nav],
  ["willchange-tof",    el => el.style.willChange = "transform, opacity, filter", el => el.style.willChange = ""],
  ["willchange-to",     el => el.style.willChange = "transform, opacity",    el => el.style.willChange = ""],
  ["filter-blur-dim",   el => el.style.filter = "blur(3.85px) brightness(0.92)", el => el.style.filter = ""],
  ["filter-blur0-dim",  el => el.style.filter = "blur(0px) brightness(0.92)", el => el.style.filter = ""],
  ["filter-dim-only",   el => el.style.filter = "brightness(0.92)",          el => el.style.filter = ""],
  ["backface-hidden",   el => el.style.backfaceVisibility = "hidden",        el => el.style.backfaceVisibility = ""],
  ["getAnimations",     el => el.getAnimations({subtree:true}).length,       () => {}],
  ["world-travel",      () => document.querySelector(".atmosphere").dataset.travel = "descend",
                        () => delete document.querySelector(".atmosphere").dataset.travel]
]`;

async function runEngine(name, type, launch) {
  const browser = await type.launch({ headless: true, ...launch });
  const context = await browser.newContext({ viewport: IPAD, deviceScaleFactor: 2, hasTouch: true });
  const page = await context.newPage();
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#missions`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(4000);

  const out = await page.evaluate(
    ([casesSrc, samples]) => {
      // eslint-disable-next-line no-new-func
      const cases = new Function("return " + casesSrc)();
      const el = document.querySelector(".screen");
      if (!el) return { error: "no .screen" };
      const nodes = el.querySelectorAll("*").length;
      const flush = () => el.offsetWidth + document.body.offsetHeight;
      const rows = [];
      for (const [label, apply, undo] of cases) {
        const times = [];
        for (let i = 0; i < samples; i++) {
          undo(el);
          flush();
          const t0 = performance.now();
          apply(el);
          flush();
          times.push(performance.now() - t0);
        }
        undo(el);
        flush();
        times.sort((a, b) => a - b);
        rows.push({
          label,
          median: times[Math.floor(times.length / 2)],
          p90: times[Math.floor(times.length * 0.9)],
          max: times[times.length - 1],
        });
      }
      return { nodes, rows, tier: document.documentElement.dataset.gfxTier };
    },
    [CASES, SAMPLES]
  );

  await browser.close();
  return { engine: name, ...out };
}

function report(r) {
  console.log(`\n=== ${r.engine} ===  tier=${r.tier}  screen nodes=${r.nodes}`);
  if (r.error) return console.log("  " + r.error);
  const floor = r.rows.find((x) => x.label === "noop")?.median ?? 0;
  console.log("case".padEnd(20) + "median".padStart(9) + "p90".padStart(9) + "max".padStart(9) + "   over floor");
  for (const row of r.rows) {
    const over = row.median - floor;
    console.log(
      row.label.padEnd(20) +
        row.median.toFixed(2).padStart(9) +
        row.p90.toFixed(2).padStart(9) +
        row.max.toFixed(2).padStart(9) +
        `   ${over > 0 ? "+" : ""}${over.toFixed(2)}ms`
    );
  }
}

report(await runEngine("chromium", chromium, CHROME ? { executablePath: CHROME } : {}));
report(await runEngine("webkit", webkit, {}));
