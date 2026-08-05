/**
 * Why `verify:screens` dies on `#stats` — an instrument, not a fix.
 *
 * `scripts/verify-screens.mjs` navigates with `waitUntil: "networkidle"`, which
 * Playwright defines as *five hundred milliseconds with nothing in flight*. On
 * `#stats` that condition is never met and the script takes an uncaught
 * `TimeoutError` thirty seconds later, killing the whole run before a single
 * statistics assertion has been evaluated.
 *
 * A timeout says nothing about which of the two possible causes is true: a
 * connection held open forever, or a stream of short requests that never stops.
 * They look identical from outside and they have completely different fixes, so
 * this logs every request with a timestamp and prints what is still open at each
 * second. The route is reached by writing `location.hash` rather than by
 * `goto`, so the measurement is of the screen and not of the navigation helper
 * that is failing on it.
 *
 * The trap this avoids: concluding "the stats screen is slow". It is not slow.
 * Whatever this finds is a thing that never finishes, and thirty seconds is only
 * where Playwright gave up.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const inflight = new Map();
let started = [];
page.on("request", (r) => {
  inflight.set(r, Date.now());
  started.push({ t: Date.now(), url: r.url(), type: r.resourceType() });
});
const finish = (r) => inflight.delete(r);
page.on("requestfinished", finish);
page.on("requestfailed", finish);

const routes = process.argv.slice(2);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "load" });
await page.waitForTimeout(3000);
console.log(`lobby settled with ${inflight.size} in flight`);

for (const route of routes.length ? routes : ["stats"]) {
  started = [];
  const mark = Date.now();
  await page.evaluate((r) => { location.hash = `#${r}`; }, route);
  console.log(`\n=== #${route} ===`);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1000);
    const open = [...inflight.keys()].map((r) => `${r.resourceType()} ${r.url().slice(0, 130)}`);
    console.log(`  t=${String(Date.now() - mark).padStart(5)}ms  started=${String(started.length).padStart(5)}  inflight=${inflight.size}`);
    if (open.length) console.log("       still open: " + open.slice(0, 4).join("\n       still open: "));
  }
  const tally = new Map();
  for (const s of started) {
    const key = `${s.type} ${s.url.replace(/[?&](t|v|import)=[^&]*/g, "").slice(0, 120)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`  total started on #${route}: ${started.length}`);
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(5)}  ${k}`);
  }
}

await browser.close();
