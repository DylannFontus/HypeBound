/**
 * Photograph any screen in the game, on demand.
 *
 * The visual work needs one thing above all else: the ability to *look* at what
 * we just changed, and to look at it the same way every time. Every existing
 * `verify-*.mjs` grows its own browser, its own account seeding and its own
 * waits, which is right for a check that asserts on one feature and wrong for a
 * critic who simply needs a picture of the shop.
 *
 * So this is the one camera. Point it at a route, get a PNG.
 *
 *   node scripts/shot.mjs lobby
 *   node scripts/shot.mjs collection --out coll-after --size 2560x1440
 *   node scripts/shot.mjs battle --battle --frames 6x180
 *   node scripts/shot.mjs shop --clip ".shop-grid"
 *   node scripts/shot.mjs lobby --raw            (brand-new account, no seeding)
 *
 * ## Why the account is seeded by default
 *
 * A fresh profile owns nothing and is bounced to the starter picker, so a naive
 * screenshot of `#collection` is a picture of an empty grid — which tells a
 * critic nothing about the collection screen and everything about the fact that
 * nobody has played yet. `--raw` exists for the cases where the empty state *is*
 * the subject, and for the first-run intro, where a seeded account is precisely
 * the wrong thing.
 *
 * ## Determinism
 *
 * Fixed viewport, fixed seed, animations given a fixed settle window, and
 * `--freeze` to pin every CSS animation at a chosen offset. Two runs of the same
 * command should differ only where the game is genuinely non-deterministic; if a
 * critic sees a change, it should be a change we made.
 */

import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith("--")) {
  console.error(
    [
      "usage: node scripts/shot.mjs <route> [options]",
      "",
      "  <route>              hash route, e.g. lobby, collection, 'battle?seed=7'",
      "",
      "  --out <name>         output basename           (default: route slug)",
      "  --dir <path>         output directory          (default: scripts/screenshots/review)",
      "  --size <WxH>         viewport                  (default: 1600x900)",
      "  --wait <ms>          settle time after mount   (default: 1100)",
      "  --frames <n>x<ms>    burst of n frames, ms apart (writes -0, -1, ...)",
      "  --clip <selector>    photograph one element instead of the page",
      "  --eval <js>          run this in the page before the wait",
      "  --freeze <ms>        pin all CSS animations at this offset",
      "  --raw                brand-new account: no seeding, no starter choice",
      "  --battle             drive through the mulligan onto a live board",
      "  --scale <n>          deviceScaleFactor         (default: 1)",
    ].join("\n")
  );
  process.exit(1);
}

const route = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);

const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "screen";
const outName = String(flag("out", slug));
const outDir = String(flag("dir", path.join(HERE, "screenshots", "review")));
const [vw, vh] = String(flag("size", "1600x900"))
  .split("x")
  .map((n) => Number(n));
const settle = Number(flag("wait", 1100));
const scale = Number(flag("scale", 1));
const clip = flag("clip", null);
const evalJs = flag("eval", null);
const freeze = flag("freeze", null);
const burst = (() => {
  const raw = flag("frames", null);
  if (!raw) return null;
  const [n, ms] = String(raw).split("x").map(Number);
  return { count: n || 1, interval: ms || 150 };
})();

mkdirSync(outDir, { recursive: true });

// --- browser -----------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: scale,
});

/**
 * Console noise is reported, never fatal.
 *
 * A screenshot script that exits non-zero on a warning is a screenshot script
 * nobody runs. But a page that threw while painting is exactly the thing a
 * critic would otherwise mistake for a design choice, so it gets said out loud.
 */
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const written = [];
const shoot = async (name) => {
  const file = path.join(outDir, `${name}.png`);
  const target = clip ? page.locator(String(clip)).first() : page;
  await target.screenshot({ path: file });
  written.push(file);
};

try {
  if (has("raw")) {
    await page.goto(ORIGIN, { waitUntil: "networkidle" });
  } else {
    await seedPlayedAccount(page, ORIGIN);
  }

  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });

  /**
   * Wait for the shell to finish swapping screens.
   *
   * `.screen-out` is the outgoing screen mid-fade; photographing while one is
   * present catches two screens stacked on top of each other, which has fooled
   * more than one review into thinking a layout was broken.
   */
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});

  if (has("battle")) {
    await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count()) {
      await page.click(".mulligan-actions .btn-primary");
    }
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, {
        timeout: 30000,
      })
      .catch(() => {});
  }

  if (evalJs) {
    await page.evaluate((source) => {
      // eslint-disable-next-line no-new-func
      return new Function(source)();
    }, String(evalJs));
  }

  if (freeze !== null) {
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-delay: -${Number(freeze)}ms !important;
        animation-play-state: paused !important;
      }`,
    });
  }

  await page.waitForTimeout(settle);

  if (burst) {
    for (let i = 0; i < burst.count; i++) {
      await shoot(`${outName}-${i}`);
      if (i < burst.count - 1) await page.waitForTimeout(burst.interval);
    }
  } else {
    await shoot(outName);
  }

  for (const file of written) console.log(file);
  if (errors.length) {
    console.log(`\n${errors.length} console error(s) while painting:`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  }
} finally {
  await browser.close();
}
