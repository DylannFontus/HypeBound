/**
 * One session, walked, with every leg reported.
 *
 * `_w7leg_phase.mjs` reloads between measurements, which is honest about a cold
 * route and dishonest about a session: `Shell` keeps its stopwatch in instance
 * fields, so a reload throws away every measurement it has taken and the second
 * reading is another first visit wearing a warm module cache. Read that way it
 * says a route is veiled when it is not, and — worse — the other way round.
 *
 * So this loads **once** and then walks a list of hashes, reporting per leg:
 *
 *   veil     when `.nav-curtain` appeared and when it left, or `-` for none
 *   respond  the first frame on which any pixel of the outgoing screen moved,
 *            taken from the shell's own `data-nav` write rather than a timer
 *   settled  when the destination wrote `data-nav="settled"`
 *   long     every long task from the click, from one observer installed once
 *
 * The point of the walk is the second and third visit to the same place, which
 * is the visit a player actually makes and the one no instrument here has ever
 * measured.
 *
 *   node scripts/_w7leg_walk.mjs lobby collection lobby collection lobby
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const VALUED = new Set(["--size", "--settle"]);
const _probe = argv.includes("--probe");
const walk = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  walk.push(argv[i]);
}
const [vw, vh] = String(flag("size", "1280x720")).split("x").map(Number);
const settleMs = Number(flag("settle", 2600));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
/**
 * A walk is only a walk if it happened in one document, so a reload in the
 * middle of one does not produce a shorter walk — it produces a *wrong* one,
 * with the shell's stopwatch silently reset half way through. This drives a
 * live Vite dev server that three other people are editing, and an edit to any
 * source file pushes a full reload down the HMR socket, so the whole walk is
 * restarted rather than resumed.
 */
let reloaded = false;
page.on("load", () => {
  reloaded = true;
});

const rows = [];
for (let attempt = 0; attempt < 6; attempt += 1) {
  rows.length = 0;
  reloaded = false;
  try {
    await runWalk(rows);
    if (!reloaded) break;
  } catch (error) {
    // "Execution context was destroyed" *is* the reload; the `load` event that
    // would set the flag races the rejection and often loses.
    const navigated = /Execution context was destroyed|Target closed|frame was detached/i.test(String(error));
    if (!reloaded && !navigated) throw error;
  }
  console.error(`  (the page reloaded under the walk — restarting, attempt ${attempt + 2})`);
}
console.log(`\n  leg                         veil            respond  settled   rAF/1.6s  long tasks`);
for (const row of rows) console.log(row);
await browser.close();

async function runWalk(into) {
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#${walk[0] ?? "lobby"}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // everything above is setup; a reload before this point is harmless
  reloaded = false;

  for (let step = 1; step < walk.length; step += 1) {
    const from = walk[step - 1];
    const to = walk[step];
    const out = await page.evaluate(
    async ([hash, ms, heavyProbe]) => {
      const app = document.getElementById("app");
      const t0 = performance.now();
      const at = () => Math.round(performance.now() - t0);
      const seen = {};
      const long = [];
      const raf = [];
      let probeSink = 0;
      const mark = (k) => {
        if (seen[k] === undefined) seen[k] = at();
      };

      const obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) long.push([Math.round(e.startTime - t0), Math.round(e.duration)]);
      });
      obs.observe({ entryTypes: ["longtask"] });

      /**
       * `respond` is the first frame on which the outgoing screen is drawn
       * differently from how the click found it. The shell writes
       * `data-nav="<relation>-hold"` on it synchronously in the hashchange
       * handler, and the answer wanted here is not when the attribute was
       * written but when the browser first *composited* a frame with it — so
       * this reads the outgoing element's own computed transform once per
       * animation frame and marks the first one that is not the identity.
       */
      const outgoing = document.querySelector("#app > .screen");
      const dom = new MutationObserver(() => {
        if (document.querySelector(".nav-curtain")) mark("veilUp");
        else if (seen.veilUp !== undefined) mark("veilGone");
        for (const el of document.querySelectorAll("#app > .screen")) {
          if (el === outgoing) continue;
          mark("placed");
          if (el.dataset.nav === "settled") mark("settled");
        }
      });
      dom.observe(app, { childList: true, subtree: true, attributes: true });

      const tick = () => {
        raf.push(at());
        if (outgoing && seen.respond === undefined) {
          const t = getComputedStyle(outgoing).transform;
          if (t && t !== "none") mark("respond");
        }
        /**
         * The same per-frame reads `tests/never-a-blank-frame.ts` makes, on
         * demand, so the cost of that probe can be A/B'd against its absence.
         * `getBoundingClientRect` is a forced synchronous layout, and this one
         * lands on a grid that is inserting sixty cells a chunk.
         */
        if (heavyProbe) {
          for (const el of document.querySelectorAll(".screen")) {
            const st = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            probeSink += Number(st.opacity) + box.width + box.height;
          }
          const veil = document.querySelector(".nav-curtain");
          if (veil) probeSink += Number(getComputedStyle(veil).opacity);
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      location.hash = hash;
      await new Promise((r) => setTimeout(r, ms));
      obs.disconnect();
      dom.disconnect();

      let worst = 0;
      for (let i = 1; i < raf.length; i += 1) worst = Math.max(worst, raf[i] - raf[i - 1]);
      return { ...seen, long, raf16: raf.filter((t) => t <= 1600).length, worst };
    },
    [`#${to}`, settleMs, argv.includes("--probe")]
  );

    const total = out.long.reduce((a, b) => a + b[1], 0);
    const veil =
      out.veilUp === undefined
        ? "     none      "
        : `${String(out.veilUp).padStart(5)}->${String(out.veilGone ?? -1).padStart(5)}  `;
    into.push(
      `  ${`${from} -> ${to}`.padEnd(26)} ${veil} ${String(out.respond ?? -1).padStart(6)}  ${String(
        out.settled ?? -1
      ).padStart(6)}  ${String(out.raf16).padStart(8)}   ${String(out.long.length).padStart(2)}/${String(
        total
      ).padStart(5)}ms worst ${String(Math.max(0, ...out.long.map((l) => l[1]))).padStart(4)}  gap ${String(
        out.worst
      ).padStart(4)}`
    );
  }
}
