/**
 * How many composited surfaces a navigation asks the engine to hold, and how
 * many bytes of backing store they come to.
 *
 * ## Why this number and not a frame rate
 *
 * The stall is reported on Safari and this machine has none; `_w10ipad_raf.mjs`
 * established that Playwright's WebKit cannot stand in for it, because it has no
 * display link and fires one `requestAnimationFrame` in a second. So the honest
 * question is not "how fast is this in WebKit" — nothing here can answer that —
 * but "how much does the CSS *ask the compositor for*", and that is a property
 * of the declarations rather than of the engine reading them. `will-change`,
 * `filter`, `backface-visibility` and an infinite transform animation promote a
 * layer in both engines for the same reasons. WebKit's budget for those layers
 * on iOS is the small one; Chromium's `LayerTree` domain is the only place on
 * this machine that will count them.
 *
 * Read it as a demand figure, not as a cost figure. A change that halves it has
 * halved what the page asks of every engine, and that is the strongest claim
 * available without an iPad.
 *
 * ## Calibration
 *
 * The tree is sampled at rest as well as during a navigation, so the
 * navigation's own contribution is a difference rather than a total, and the
 * viewport is fixed at the reported device's logical size and DPR — the byte
 * figure is meaningless without both.
 *
 *   node scripts/_w10ipad_layers.mjs [--tier low|medium|high]
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
/** iPad Pro 11", landscape, at the ratio its backing store is actually at. */
const TIER = flag("tier", "low");
const IPAD = { width: 1194, height: 834 };
const DPR = 2;

const WALK = [
  ["missions", "descend"],
  ["lobby", "ascend"],
  ["settings", "descend"],
  ["a11y", "descend"],
  ["fairness", "sibling"],
  ["settings", "ascend"],
  ["lobby", "ascend"],
];


/**
 * Force the graphics tier, and force it in the only place that cannot lose.
 *
 * `page.addInitScript` looked like the obvious way to do this and silently did
 * nothing: an init script runs at document-start, `document.documentElement` is
 * still null at that point, and the assignment throws into a void Playwright
 * does not surface. Three separate measurements in this pass were labelled
 * `tier=low` and taken at `high`, which is instrument fifteen and was caught
 * only because a rule that provably applies measured as though it did not.
 *
 * Rewriting the served HTML puts the attribute on `<html>` before a single byte
 * is parsed, so `atmosphere.ts::detectTier` reads it as a declared answer and
 * every tier-gated rule in the stylesheet is live from first paint. The probe
 * then re-reads the tier out of the page and refuses to report under a label it
 * has not confirmed.
 */
async function forceTier(context, tier) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace(/<html/i, `<html data-gfx-tier="${tier}"`);
    return route.fulfill({ response, body });
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME ?? undefined,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: IPAD, deviceScaleFactor: DPR, hasTouch: true });
await forceTier(context, TIER);
const page = await context.newPage();

await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3500);

/** The label is checked against the page, because it was wrong once. */
const liveTier = await page.evaluate(() => document.documentElement.dataset["gfxTier"]);
if (liveTier !== TIER) {
  console.error(`tier not applied: asked for "${TIER}", page reports "${liveTier}". Refusing to report.`);
  await browser.close();
  process.exit(1);
}

const cdp = await context.newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("LayerTree.enable");

/**
 * The tree is **pulled**, not listened for, and that is the difference between
 * this run and the one before it.
 *
 * `LayerTree` has no getter — it only pushes `layerTreeDidChange` — so the first
 * version of this probe kept the last event it happened to receive. When the
 * compositor went quiet the events stopped, the cached tree went stale, and the
 * probe reported every arm as byte-for-byte identical *including* the arm that
 * deletes the room, which is impossible and is the only reason it was caught.
 * A metric that cannot fail loudly will eventually report a constant.
 *
 * Toggling the domain forces a fresh snapshot on demand, so every sample below
 * is a reading taken at the moment it is timestamped. `sane` is the guard: a
 * snapshot with no layers at all is dropped rather than averaged in.
 */
let latest = [];
cdp.on("LayerTree.layerTreeDidChange", (e) => {
  if (e.layers) latest = e.layers;
});

async function snapshot() {
  const fresh = new Promise((resolve) => {
    const once = (e) => {
      if (!e.layers) return;
      cdp.off("LayerTree.layerTreeDidChange", once);
      resolve(e.layers);
    };
    cdp.on("LayerTree.layerTreeDidChange", once);
    setTimeout(() => {
      cdp.off("LayerTree.layerTreeDidChange", once);
      resolve(null);
    }, 400);
  });
  await cdp.send("LayerTree.disable");
  await cdp.send("LayerTree.enable");
  const layers = await fresh;
  if (layers && layers.length) latest = layers;
  return latest;
}

function census(layers) {
  let bytes = 0;
  let drawn = 0;
  const big = [];
  for (const l of layers) {
    if (!l.drawsContent) continue;
    drawn += 1;
    const px = (l.width || 0) * (l.height || 0);
    bytes += px * 4;
    if (px >= IPAD.width * IPAD.height * DPR * DPR * 0.5) big.push(`${Math.round(l.width)}x${Math.round(l.height)}`);
  }
  return { total: layers.length, drawn, mb: bytes / (1024 * 1024), big: big.length };
}

/** Poll the tree during a window and keep the peak, because a navigation's
 *  extra surfaces exist for a few hundred milliseconds and then go. */
async function peakDuring(work, ms) {
  let peak = { total: 0, drawn: 0, mb: 0, big: 0 };
  const deadline = Date.now() + ms;
  await work();
  while (Date.now() < deadline) {
    const c = census(await snapshot());
    if (c.mb > peak.mb) peak = c;
  }
  return peak;
}

// warm the module graph so the first leg is not paying for the whole game
for (let i = 0; i < 2; i++) {
  for (const [route] of WALK) {
    await page.evaluate((r) => (location.hash = "#" + r), route);
    await page.waitForTimeout(650);
  }
}
await page.evaluate(() => (location.hash = "#lobby"));
await page.waitForTimeout(1500);

/**
 * One arm per candidate, each a pure subtraction. `noop` matches nothing and is
 * the floor: whatever it differs from `base` by is the probe's own variance and
 * no other arm may be believed under it.
 */
const RESTORE_SCREEN_WC = ".screen[data-nav] { will-change: transform, opacity, filter !important; }";
const RESTORE_WORLD_WC = ".atmosphere[data-travel] .atm-body { will-change: transform, filter !important; }";
const RESTORE_CRAWL = `.d-room-crawl { animation: room-crawl 34s ease-in-out infinite alternate !important;
     will-change: transform !important; transform: none !important; }`;

const ARMS = {
  /** The tree as it stands now. */
  base: "",
  /** The null arm: matches nothing. Its delta is the probe's own variance. */
  noop: ".w10-nothing-matches-this { color: red }",
  /** Each change put back, one at a time, so the saving is a difference rather
      than a comparison against a number from a different run of the probe. */
  "was: screen will-change filter": RESTORE_SCREEN_WC,
  "was: world will-change filter": RESTORE_WORLD_WC,
  "was: low-tier room crawl": RESTORE_CRAWL,
  "was: all three (old tree)": RESTORE_SCREEN_WC + RESTORE_WORLD_WC + RESTORE_CRAWL,
  /** Not changes — the two biggest things still standing, for the report. */
  "still there: the room": ".screen > .d-room { display: none !important; }",
  "still there: front plane": ".atmosphere-fore { display: none !important; }",
};

console.log(`tier=${TIER}  viewport=${IPAD.width}x${IPAD.height}@${DPR}x\n`);
console.log("arm".padEnd(30) + "restLayers".padStart(11) + "restMB".padStart(9) + "navLayers".padStart(11) + "navMB".padStart(9) + "  vs base");

let baseNav = null;
for (const [arm, css] of Object.entries(ARMS)) {
  await page.evaluate(
    ([id, text]) => {
      document.getElementById(id)?.remove();
      if (!text) return;
      const el = document.createElement("style");
      el.id = id;
      el.textContent = text;
      document.head.appendChild(el);
    },
    ["w10-arm", css]
  );
  await page.evaluate(() => (location.hash = "#lobby"));
  await page.waitForTimeout(1100);

  const rest = await peakDuring(async () => {}, 500);
  const rows = [];
  for (const [route] of WALK) {
    rows.push(
      await peakDuring(async () => {
        await page.evaluate((r) => (location.hash = "#" + r), route);
      }, 850)
    );
    await page.waitForTimeout(550);
  }
  const mbs = rows.map((r) => r.mb).sort((a, b) => a - b);
  const lys = rows.map((r) => r.drawn).sort((a, b) => a - b);
  const navMb = mbs[Math.floor(mbs.length / 2)];
  const navLy = lys[Math.floor(lys.length / 2)];
  if (arm === "base") baseNav = navMb;
  const delta = baseNav === null ? 0 : navMb - baseNav;
  console.log(
    arm.padEnd(30) +
      String(rest.drawn).padStart(11) +
      rest.mb.toFixed(1).padStart(9) +
      String(navLy).padStart(11) +
      navMb.toFixed(1).padStart(9) +
      `  ${delta > 0 ? "+" : ""}${delta.toFixed(1)} MB`
  );
}

await browser.close();
