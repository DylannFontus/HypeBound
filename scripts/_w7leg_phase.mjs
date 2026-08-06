/**
 * A navigation split into the four things it is actually made of.
 *
 * Every earlier instrument on this leg reported one number — long tasks, or rAF
 * frames, or mean pixel delta — and one number cannot tell you *which half* to
 * fix. This records, from the click:
 *
 *   veil        when `.nav-curtain` entered and left the document
 *   build       when the destination's root element was appended to `#app`
 *               (hold + twoFrames + factory, from the shell's own ordering)
 *   firstCard   when the first `canvas` appeared inside the destination
 *   settled     when `data-nav="settled"` was written
 *   long tasks  every one, from a single observer that is never re-registered
 *
 * `MutationObserver` rather than instrumentation inside the app: the shell's
 * phases are all DOM writes, so the DOM is the honest place to watch for them,
 * and nothing here can change the timing of the thing it is measuring.
 *
 *   node scripts/_w7leg_phase.mjs collection deckbuilder --repeat 3
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
const VALUED = new Set(["--repeat", "--size", "--from"]);
const routes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  routes.push(argv[i]);
}
const repeat = Number(flag("repeat", 3));
const from = String(flag("from", "lobby"));
const [vw, vh] = String(flag("size", "1280x720")).split("x").map(Number);
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
// `?nointro` before the seeder, so the first-run cinematic cannot sit on top
// of the starter picker for the whole of its timeout.
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);

const quiet = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});

for (const route of routes) {
  const rows = [];
  for (let visit = 0; visit < repeat; visit += 1) {
    await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
    await quiet();
    await page.waitForTimeout(600);

    const out = await page.evaluate(
      async ([hash, ms]) => {
        const app = document.getElementById("app");
        const log = { long: [], raf: [] };
        const t0 = performance.now();
        const at = () => Math.round(performance.now() - t0);
        const seen = {};
        const mark = (k) => {
          if (seen[k] === undefined) seen[k] = at();
        };

        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            log.long.push([Math.round(e.startTime - t0), Math.round(e.duration)]);
          }
        });
        obs.observe({ entryTypes: ["longtask"] });

        const dom = new MutationObserver(() => {
          if (document.querySelector(".nav-curtain")) mark("veilUp");
          else if (seen.veilUp !== undefined) mark("veilGone");
          const incoming = [...document.querySelectorAll("#app > .screen")].find(
            (el) => !el.classList.contains("screen-out")
          );
          if (incoming) {
            mark("placed");
            if (incoming.querySelector("canvas")) mark("firstCanvas");
            if (incoming.dataset.nav === "settled") mark("settled");
          }
        });
        dom.observe(app, { childList: true, subtree: true, attributes: true });

        const tick = () => {
          log.raf.push(at());
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        location.hash = hash;
        await new Promise((r) => setTimeout(r, ms));
        obs.disconnect();
        dom.disconnect();

        const incoming = document.querySelector("#app > .screen");
        return {
          ...seen,
          long: log.long,
          raf: log.raf,
          canvases: incoming ? incoming.querySelectorAll("canvas").length : 0,
          nodes: incoming ? incoming.getElementsByTagName("*").length : 0,
        };
      },
      [`#${route}`, 3200]
    );

    let worstGap = 0;
    for (let i = 1; i < out.raf.length; i += 1) worstGap = Math.max(worstGap, out.raf[i] - out.raf[i - 1]);
    rows.push({ ...out, worstGap, raf16: out.raf.filter((t) => t <= 1600).length });
  }

  console.log(`\n=== ${from} -> ${route}   ${vw}x${vh}`);
  for (const [i, r] of rows.entries()) {
    const total = r.long.reduce((a, b) => a + b[1], 0);
    console.log(
      `  visit ${i}  placed ${String(r.placed ?? -1).padStart(5)}  veil ${String(r.veilUp ?? -1).padStart(4)}->${String(
        r.veilGone ?? -1
      ).padStart(5)}  firstCanvas ${String(r.firstCanvas ?? -1).padStart(5)}  settled ${String(
        r.settled ?? -1
      ).padStart(5)}  ` +
        `nodes ${String(r.nodes).padStart(4)} canvases ${String(r.canvases).padStart(3)}  ` +
        `long ${String(r.long.length).padStart(2)}/${String(total).padStart(5)}ms worst ${String(
          Math.max(0, ...r.long.map((l) => l[1]))
        ).padStart(4)}  rAF/1.6s ${String(r.raf16).padStart(3)} worstGap ${String(r.worstGap).padStart(4)}`
    );
    console.log(`            ${r.long.map((l) => `${l[1]}@${l[0]}`).join("  ")}`);
  }
}

await browser.close();
