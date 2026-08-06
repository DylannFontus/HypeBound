/**
 * Where a navigation's milliseconds actually go, per route.
 *
 * The shell's own stopwatch only times the factory. Everything after it —
 * style, layout, the first raster of a whole new screen, and on the collection
 * the lazy painter's own queue — is on the same thread and invisible to it. So
 * this walks a list of routes from the lobby and reports, for each: the
 * factory's elapsed time, every long task from the hash change to the last one,
 * the node count of the tree that was inserted, and how many rAF frames the
 * page managed in the second and a half afterwards.
 *
 *   node scripts/_w3nav_cost.mjs collection missions play settings decks
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const routes = argv.filter((a) => !a.startsWith("--"));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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

for (const route of routes) {
  for (const visit of ["cold", "warm"]) {
    await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
    await settled("lobby");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const w = window;
      w.__long = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__long.push([Math.round(e.startTime - w.__t0), Math.round(e.duration)]);
      }).observe({ entryTypes: ["longtask"] });
    });
    await page.evaluate((r) => {
      const w = window;
      w.__long = [];
      w.__raf = 0;
      w.__cardMs = [];
      w.__t0 = performance.now();
      const tick = () => {
        w.__raf += 1;
        if (performance.now() - w.__t0 < 1600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      location.hash = `#${r}`;
    }, route);
    await settled(route);
    await page.waitForTimeout(1700);
    const out = await page.evaluate(() => {
      const screen = document.querySelector(".screen");
      return {
        long: window.__long,
        raf: window.__raf,
        nodes: screen ? screen.getElementsByTagName("*").length : 0,
        cards: (window.__cardMs ?? []).length,
        cardMs: (window.__cardMs ?? []).reduce((a, b) => a + b, 0),
      };
    });
    const total = out.long.reduce((a, b) => a + b[1], 0);
    console.log(
      `${route.padEnd(14)} ${visit.padEnd(5)} nodes ${String(out.nodes).padStart(5)}  rAF/1.6s ${String(out.raf).padStart(4)}  ` +
        `long ${String(out.long.length).padStart(2)} tasks ${String(total).padStart(5)}ms  worst ${String(Math.max(0, ...out.long.map((l) => l[1]))).padStart(4)}ms  ` +
        `cards ${String(out.cards).padStart(4)} in ${String(out.cardMs).padStart(5)}ms\n` +
        `                     ${out.long.map((l) => `${l[1]}@${l[0]}`).join("  ")}`
    );
  }
}

await browser.close();
