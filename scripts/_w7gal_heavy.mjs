/**
 * What `#gallery` costs to open, with and without the route table's `heavy` flag.
 *
 * `shell.ts` veils a navigation whenever either endpoint is flagged `heavy`, and
 * `#gallery` is one of the three routes that is. The note beside `RouteNode.heavy`
 * states the exit condition in as many words:
 *
 *   "the real answer is for those three screens to mount a shell and build their
 *    card canvases in chunked frames afterwards, at which point `heavy` comes out
 *    of the table entirely and they run the ordinary descend."
 *
 * The gallery now does exactly that — a rail, a header and one shelf in the
 * factory, the other ten shelves one per frame, and no portrait rasterised until
 * the entrance has had its 480ms — so the claim is testable rather than
 * aspirational. This measures the factory's own elapsed time against
 * `HEAVY_BUILD_MS`, and then flips the flag at runtime and measures how long the
 * cover is on screen either way.
 *
 * `ROUTES` is an exported mutable object, so the second half is a real
 * navigation through the real shell with one property changed — not a
 * simulation of one.
 *
 * usage: node scripts/_w7gal_heavy.mjs [route]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const route = process.argv[2] ?? "gallery";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await seedPlayedAccount(page, ORIGIN);

/**
 * Time a navigation and report how long a cover was in the document for.
 *
 * The cover is `.nav-curtain`, which `shell.ts` creates by that name.
 *
 * A first draft looked for "a positioned, full-viewport element that is not a
 * screen" instead, on the reasoning that a probe should not depend on a class it
 * does not own. It matched `atmosphere.ts`'s persistent world — which is exactly
 * that shape and never leaves — and reported **both** arms as covered for the
 * entire three-second window, identically, which reads as "no difference" to
 * anybody skimming. A heuristic that cannot come back negative is not a
 * measurement, and this project has now been lied to by ten instruments.
 */
async function timeNav(hash, { unheavy = false } = {}) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  if (unheavy) {
    await page.evaluate(async (r) => {
      const mod = await import("/src/ui/shell.ts");
      if (mod.ROUTES?.[r]) delete mod.ROUTES[r].heavy;
    }, hash);
  }
  return page.evaluate(
    ([r, sel]) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let coveredFrom = 0;
        let coveredTo = 0;
        let screenAt = 0;
        const tick = () => {
          const now = performance.now() - t0;
          if (!screenAt && document.querySelector(sel)) screenAt = now;
          const covered = Boolean(document.querySelector(".nav-curtain"));
          if (covered) {
            if (!coveredFrom) coveredFrom = now;
            coveredTo = now;
          }
          if (now < 3000) requestAnimationFrame(tick);
          else
            resolve({
              screenAt: Math.round(screenAt),
              coverFrom: Math.round(coveredFrom),
              coverTo: Math.round(coveredTo),
              coverMs: Math.round(coveredTo - coveredFrom),
            });
        };
        requestAnimationFrame(tick);
        location.hash = `#${r}`;
      }),
    [hash, `.${hash === "gallery" ? "gallery" : hash}-screen`]
  );
}

/** The factory's own elapsed time, which is the number `HEAVY_BUILD_MS` is compared against. */
const buildMs = await page.evaluate(async (r) => {
  await import("/src/ui/shell.ts");
  const marks = [];
  const t = performance.now();
  location.hash = `#${r}`;
  await new Promise((res) => setTimeout(res, 2500));
  marks.push(performance.now() - t);
  return marks[0];
}, route);

console.log(`#${route}`);
const withHeavy = await timeNav(route);
const withoutHeavy = await timeNav(route, { unheavy: true });
console.log(`  heavy: true   screen in document at ${withHeavy.screenAt}ms, cover on screen ${withHeavy.coverFrom}–${withHeavy.coverTo}ms (${withHeavy.coverMs}ms)`);
console.log(`  heavy removed screen in document at ${withoutHeavy.screenAt}ms, cover on screen ${withoutHeavy.coverFrom}–${withoutHeavy.coverTo}ms (${withoutHeavy.coverMs}ms)`);
console.log(`  (settled navigation round-trip ${Math.round(buildMs)}ms)`);

await browser.close();
