/**
 * Is a low-tier screen still alive at rest with the room's crawl parked?
 *
 * Parking `.d-room-crawl` on the low tier is the one change in this pass that a
 * player could in principle notice, because it stops something moving. AAA bar
 * §3a makes "the screen is alive at rest" a requirement rather than a flourish,
 * and this project has already shipped one rule that removed the only moving
 * layer on a route and took the idle measurement under the floor with it — the
 * `#boss` case recorded at §1.9a of `transitions.css`. So the question gets
 * asked before the change is defended, not after.
 *
 * ## The sampler is the shared one, and the first draft of this file is why
 *
 * This started with its own capture loop — `page.screenshot()` inside a `for`
 * with a `waitForTimeout(200)` beside it — and printed an achieved grid of
 * **1053ms against a 200ms label**. That is instrument eleven, reproduced from
 * scratch, in the pass whose whole subject is instruments that lie. It was
 * caught by `tests/every-screen-is-a-room.test.ts`, which bans that exact shape
 * repository-wide precisely because five earlier scripts all carried it and all
 * had "calibrated".
 *
 * So the sampling is `lib/idle.mjs`'s `createIdleSampler`: one sampler,
 * validated once, which budgets the capture inside the period, refuses a run
 * whose clock slipped, and returns the grid it actually achieved. `gridNote`
 * prints that grid next to every figure, which is the contract — no delta is
 * quoted here without the interval it was measured on, and an off-grid run is
 * reported as off-grid rather than as a number.
 *
 * The floor comes from `hearthstone_frames/` at the same lag rather than from a
 * constant, so the comparison is against the reference this project is measured
 * against and not against a remembered value.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { createIdleSampler, gridNote, referenceAtLag, f3 } from "./lib/idle.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const TIER = process.argv[2] ?? "low";
const ROUTE = process.argv[3] ?? "missions";
const LAG_MS = 200;

async function forceTier(context, tier) {
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace(/<html/i, `<html data-gfx-tier="${tier}"`);
    return route.fulfill({ response, body });
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME ?? undefined,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1 });
await forceTier(context, TIER);
const page = await context.newPage();
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${ROUTE}`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3500);

const liveTier = await page.evaluate(() => document.documentElement.dataset["gfxTier"]);
if (liveTier !== TIER) {
  console.error(`tier not applied: asked "${TIER}", got "${liveTier}". Refusing to report.`);
  await browser.close();
  process.exit(1);
}

const reference = referenceAtLag(LAG_MS);
console.log(
  `tier=${liveTier}  route=#${ROUTE}  reference at ${LAG_MS}ms: ` +
    (reference ? `min ${f3(reference.min)} median ${f3(reference.median)}` : "unavailable (frames not on disk)")
);
console.log("");

const sample = await createIdleSampler(page, { lagMs: LAG_MS });

async function arm(label, css) {
  await page.evaluate(
    ([text]) => {
      document.getElementById("w10-idle-arm")?.remove();
      if (!text) return;
      const el = document.createElement("style");
      el.id = "w10-idle-arm";
      el.textContent = text;
      document.head.appendChild(el);
    },
    [css]
  );
  await page.waitForTimeout(900);
  const stats = await sample({ seconds: 3 });
  const verdict = stats.onGrid ? "" : "   OFF GRID — not comparable to any floor";
  console.log(`${label.padEnd(32)} median ${f3(stats.median)}  min ${f3(stats.min)}   ${gridNote(stats)}${verdict}`);
}

await arm("as shipped (crawl parked)", "");
await arm(
  "crawl animating (old tree)",
  `.d-room-crawl { animation: room-crawl 34s ease-in-out infinite alternate !important;
     will-change: transform !important; transform: none !important; }`
);
await arm("front-plane grain removed", ".atm-fore-grain { display: none !important; }");

await browser.close();
