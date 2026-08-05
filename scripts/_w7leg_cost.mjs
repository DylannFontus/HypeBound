/**
 * Where a heavy navigation's milliseconds go, attributed to a *function*.
 *
 * `_w3nav_cost.mjs` answers "how long was the thread gone" and stops there,
 * which is the question that has already been answered five times. This one
 * turns on the V8 sampling profiler across the click and reports the self-time
 * leaders, so the next edit is aimed at a line rather than at a screen.
 *
 * It also registers **one** long-task observer for the life of the page. The
 * older instrument registers a fresh one per iteration without disconnecting
 * the last, so its second reading prints every task twice and its third prints
 * it three times — read as "39 long tasks totalling 3,711ms" when the honest
 * figure was 13 and 1,237. Six instruments in this project have lied; that is
 * the seventh, and it lies by addition.
 *
 *   node scripts/_w7leg_cost.mjs collection deckbuilder --repeat 2
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
const repeat = Number(flag("repeat", 2));
const from = String(flag("from", "lobby"));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
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

const settled = (id, timeout = 40000) =>
  page
    .waitForFunction(
      (name) => {
        const s = document.querySelectorAll(".screen");
        return s.length === 1 && s[0] && s[0].dataset.nav === "settled" && s[0].classList.contains(name);
      },
      `${id}-screen`,
      { timeout }
    )
    .then(
      () => true,
      () => false
    );

const session = await page.context().newCDPSession(page);
await session.send("Profiler.enable");
await session.send("Profiler.setSamplingInterval", { interval: 200 });

for (const route of routes) {
  for (let visit = 0; visit < repeat; visit += 1) {
    await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
    await settled(from);
    await page.waitForTimeout(500);

    // one observer, installed fresh on a fresh document, reset per run
    await page.evaluate(() => {
      const w = window;
      w.__long = [];
      w.__raf = [];
      w.__t0 = performance.now();
      if (!w.__obs) {
        w.__obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            w.__long.push([Math.round(e.startTime - w.__t0), Math.round(e.duration)]);
          }
        });
        w.__obs.observe({ entryTypes: ["longtask"] });
      }
    });

    await session.send("Profiler.start");
    await page.evaluate((r) => {
      const w = window;
      w.__long = [];
      w.__raf = [];
      w.__t0 = performance.now();
      const tick = () => {
        w.__raf.push(Math.round(performance.now() - w.__t0));
        if (performance.now() - w.__t0 < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      location.hash = `#${r}`;
    }, route);
    const ok = await settled(route);
    await page.waitForTimeout(2500);
    const { profile } = await session.send("Profiler.stop");

    const out = await page.evaluate(() => {
      const screen = document.querySelector(".screen");
      const raf = window.__raf ?? [];
      let worst = 0;
      for (let i = 1; i < raf.length; i += 1) worst = Math.max(worst, raf[i] - raf[i - 1]);
      return {
        long: window.__long ?? [],
        rafCount: raf.filter((t) => t <= 1600).length,
        rafWorst: worst,
        nodes: screen ? screen.getElementsByTagName("*").length : 0,
      };
    });

    // self time per function from the sampling profiler
    const byId = new Map();
    for (const node of profile.nodes) byId.set(node.id, node);
    const self = new Map();
    const dt = profile.timeDeltas ?? [];
    for (let i = 0; i < profile.samples.length; i += 1) {
      const node = byId.get(profile.samples[i]);
      if (!node) continue;
      const cf = node.callFrame;
      const name = `${cf.functionName || "(anon)"} ${String(cf.url).split("/").pop()}:${cf.lineNumber + 1}`;
      self.set(name, (self.get(name) ?? 0) + (dt[i] ?? 0) / 1000);
    }
    const top = [...self.entries()]
      .filter(([n]) => !n.startsWith("(program)") && !n.startsWith("(idle)") && !n.startsWith("(garbage"))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    const total = out.long.reduce((a, b) => a + b[1], 0);
    console.log(
      `\n=== ${route}  visit ${visit}${ok ? "" : "  [NEVER SETTLED]"}  nodes ${out.nodes}\n` +
        `    long ${out.long.length} tasks / ${total}ms   worst ${Math.max(0, ...out.long.map((l) => l[1]))}ms\n` +
        `    rAF in 1.6s ${out.rafCount}   worst gap ${out.rafWorst}ms\n` +
        `    ${out.long.map((l) => `${l[1]}@${l[0]}`).join("  ")}`
    );
    for (const [name, ms] of top) console.log(`      ${ms.toFixed(1).padStart(7)}ms  ${name}`);
  }
}

await session.detach().catch(() => {});
await browser.close();
