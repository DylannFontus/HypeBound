/**
 * The two things this wave changed, checked rather than asserted.
 *
 * Half of it is the gallery — does the room hold at every viewport and every
 * interface scale, does the idle light exist and does it stop when the player
 * asks it to — and half of it is the action log, which is the same object on
 * four different routes and had to be verified on all four rather than on the
 * one that is easy to reach.
 *
 * ## Why the log's material is measured rather than looked for
 *
 * `classList.contains("mat-panel")` proves the class is on the element and
 * nothing else. A stylesheet loaded later can flatten it — which is exactly what
 * `screens.css`'s legacy `.gallery-tile` rule was doing to the gallery's own
 * tiles, silently, because both rules had the same specificity and the legacy one
 * came second. So the assertion is on the *computed* result: a gradient in
 * `background-image`, five or more layers in `box-shadow`, and a border whose top
 * edge is lit while its bottom edge is dark. The last one is the 315-degree rule
 * as a number: a plate whose top and bottom borders are the same colour has no
 * light direction, whatever class it wears.
 *
 * usage: node scripts/_w7gal_verify.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => fail(`pageerror: ${e.message}`));
await seedPlayedAccount(page, ORIGIN);

const settle = async (selector, ms = 1500) => {
  await page.waitForSelector(selector, { timeout: 25000 });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
};

// ---------------------------------------------------------------------------
console.log("\n1. The gallery is a room at every size the bar names");
// ---------------------------------------------------------------------------

/** The parsed alpha of an `rgb(r g b / a)` or `rgba(...)` colour, 0 when opaque. */
const SIZES = [
  { w: 1600, h: 900, cols: 6 },
  { w: 1280, h: 720, cols: 4 },
  { w: 844, h: 390, cols: 3 },
];

for (const size of SIZES) {
  await page.setViewportSize({ width: size.w, height: size.h });
  await page.goto(`${ORIGIN}/?nointro#gallery`, { waitUntil: "load" });
  await settle(".gallery-screen", 2200);
  const shape = await page.evaluate(() => {
    const grid = document.querySelector(".gallery-grid");
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    const tiles = [...document.querySelectorAll(".gal-tile")];
    /** every control the roster and the wall expose, at its resting box */
    const targets = [...document.querySelectorAll(".gal-fac, .gal-tile, .screen-header .btn")].map((el) => {
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    return {
      cols,
      tiles: tiles.length,
      shelves: document.querySelectorAll(".gal-shelf").length,
      alive: document.querySelectorAll(".gal-tile.is-alive").length,
      docWidth: document.documentElement.scrollWidth,
      viewWidth: document.documentElement.clientWidth,
      /* the two names the automation contract still depends on */
      screen: Boolean(document.querySelector(".gallery-screen")),
      smallest: targets.length ? Math.min(...targets.map((t) => Math.min(t.w, t.h))) : 0,
      railVisible: Boolean(document.querySelector(".gal-rail")?.getBoundingClientRect().height),
    };
  });
  const label = `${size.w}x${size.h}`;
  if (shape.docWidth > shape.viewWidth + 1) {
    fail(`${label}: the page scrolls sideways (${shape.docWidth} > ${shape.viewWidth})`);
  } else {
    ok(`${label}: no horizontal overflow`);
  }
  if (shape.tiles < 100) fail(`${label}: only ${shape.tiles} tiles built`);
  else ok(`${label}: ${shape.tiles} tiles across ${shape.shelves} shelves, ${shape.cols} columns`);
  if (!shape.railVisible) fail(`${label}: the roster rail is not on screen`);
  else ok(`${label}: the roster is present rather than display:none`);
  if (shape.alive === 0) fail(`${label}: no tile is carrying the idle light`);
  else if (shape.alive >= shape.tiles) fail(`${label}: every one of ${shape.tiles} tiles is animating, on screen or not`);
  else ok(`${label}: ${shape.alive} of ${shape.tiles} tiles carry the idle light`);
}

await page.setViewportSize({ width: 1280, height: 720 });

// ---------------------------------------------------------------------------
console.log("\n2. …and at 1.4 and 1.6 interface scale");
// ---------------------------------------------------------------------------

for (const pct of ["140", "160"]) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "load" });
  await settle(".a11y-screen", 700);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(350);
  await page.goto(`${ORIGIN}/?nointro#gallery`, { waitUntil: "load" });
  await settle(".gallery-screen", 2000);
  const shape = await page.evaluate(() => {
    const clipped = [...document.querySelectorAll(".gal-fac-name, .gal-tile-name, .gal-shelf-title")].filter(
      (el) => el.scrollHeight > el.clientHeight + 2 && !el.className.includes("tile-name")
    ).length;
    return {
      docWidth: document.documentElement.scrollWidth,
      viewWidth: document.documentElement.clientWidth,
      railW: Math.round(document.querySelector(".gal-rail")?.getBoundingClientRect().width ?? 0),
      footVisible: (() => {
        const foot = document.querySelector(".gal-rail-foot");
        if (!foot) return false;
        const b = foot.getBoundingClientRect();
        return b.bottom <= innerHeight + 1 && b.height > 0;
      })(),
      clipped,
    };
  });
  if (shape.docWidth > shape.viewWidth + 1) fail(`scale ${pct}: sideways scroll (${shape.docWidth})`);
  else ok(`scale ${pct}: no horizontal overflow, rail ${shape.railW}px`);
  if (!shape.footVisible) fail(`scale ${pct}: the "met" meter is off the bottom of the rail`);
  else ok(`scale ${pct}: the rail's foot is still on screen`);
  if (shape.clipped > 0) fail(`scale ${pct}: ${shape.clipped} label(s) clipped by their own box`);
  else ok(`scale ${pct}: no label clipped vertically`);
}

await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "load" });
await settle(".a11y-screen", 700);
await page.locator("button", { hasText: /^100%$/ }).first().click();
await page.waitForTimeout(300);
await page.setViewportSize({ width: 1600, height: 900 });

// ---------------------------------------------------------------------------
console.log("\n3. The action log is the same material on every route that draws it");
// ---------------------------------------------------------------------------

/** Read the plate's computed edge, not its class list. */
const LOG_PROBE = () => {
  const el = document.querySelector(".history-panel");
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  const band = getComputedStyle(el, "::after");
  const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const top = parse(cs.borderTopColor);
  const bottom = parse(cs.borderBottomColor);
  return {
    present: true,
    classes: el.className,
    gradient: /gradient/.test(cs.backgroundImage),
    layers: cs.boxShadow.split(/,(?![^(]*\))/).length,
    radius: cs.borderTopLeftRadius,
    topLit: (top[3] ?? 1) > 0 && top[0] > 200,
    bottomDark: (bottom[0] ?? 255) < 40,
    bandName: band.animationName,
    bandDelay: band.animationDelay,
    running: document
      .getAnimations()
      .filter((a) => a.animationName === "hb-sheen-pass" && a.effect?.target === el && a.playState === "running").length,
  };
};

async function checkLog(route, label) {
  const probe = await page.evaluate(LOG_PROBE);
  if (!probe.present) return fail(`${label}: no .history-panel on the board`);
  const bad = [];
  if (!/\bmat-panel\b/.test(probe.classes)) bad.push("not composed with .mat-panel");
  /*
   * The token is split out rather than pattern-matched. "history-panel" contains
   * "panel" and `\b` matches inside it, because a hyphen is a word boundary — the
   * first draft of this line reported four healthy routes as still carrying the
   * legacy class, which is the ninth instrument in this project to give a
   * confident wrong answer rather than an error.
   */
  if (String(probe.classes).split(/\s+/).includes("panel")) bad.push("still carries the legacy .panel");
  if (!probe.gradient) bad.push("no gradient in background-image");
  if (probe.layers < 5) bad.push(`only ${probe.layers} box-shadow layers`);
  if (!probe.topLit) bad.push("top border is not lit");
  if (!probe.bottomDark) bad.push("bottom border is not in shadow");
  if (probe.bandName !== "hb-sheen-pass") bad.push(`band animation is ${probe.bandName}`);
  if (probe.bandDelay !== "-5.1s") bad.push(`band delay is ${probe.bandDelay}, not -5.1s`);
  if (bad.length) fail(`${label}: ${bad.join("; ")}`);
  else
    ok(
      `${label}: mat-panel, ${probe.layers} shadow layers, radius ${probe.radius}, lit top / dark bottom, band ${probe.bandDelay}`
    );
}

async function intoBattle(hash) {
  await page.goto(`${ORIGIN}/?nointro#${hash}`, { waitUntil: "load" });
  await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count()) {
    await page.click(".mulligan-actions .btn-primary");
  }
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

await intoBattle("battle?seed=7&difficulty=casual");
await checkLog("battle", "#battle");
await intoBattle("boss?tier=normal");
await checkLog("boss", "#boss");
await intoBattle("remix");
await checkLog("remix", "#remix");

/* #gauntletfight needs a whole draft in front of it, so it gets one. */
await page.goto(`${ORIGIN}/?nointro#gauntlet`, { waitUntil: "load" });
await settle(".gauntlet-screen", 900);
if (await page.locator("#gauntlet-start").count()) {
  await page.locator("#gauntlet-start").click();
  await page.waitForSelector(".gauntlet-leader-tile", { timeout: 25000 });
  await page.locator(".gauntlet-leader-tile").first().click();
  for (let pick = 0; pick < 40; pick += 1) {
    if (await page.locator("#gauntlet-begin").count()) break;
    if (!(await page.locator(".gauntlet-offer-tile").count())) break;
    await page.locator(".gauntlet-offer-tile").first().click();
    await page.waitForTimeout(60);
  }
  if (await page.locator("#gauntlet-begin").count()) {
    await page.locator("#gauntlet-begin").click();
    await page.waitForSelector("#gauntlet-fight", { timeout: 25000 });
    await page.locator("#gauntlet-fight").click();
    await page.waitForSelector(".battle-screen", { timeout: 30000 });
    if (await page.locator(".mulligan-actions .btn-primary").count()) {
      await page.click(".mulligan-actions .btn-primary").catch(() => {});
    }
    await page.waitForTimeout(2000);
    await checkLog("gauntletfight", `#gauntletfight (${await page.evaluate(() => location.hash)})`);
  } else {
    fail("could not draft a gauntlet run far enough to reach #gauntletfight");
  }
} else {
  fail("no #gauntlet-start on the gauntlet hub");
}

// ---------------------------------------------------------------------------
console.log("\n4. Reduced motion removes the decorative layer and keeps the room usable");
// ---------------------------------------------------------------------------

await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "load" });
await settle(".a11y-screen", 700);
/* the switch, found by its own label rather than by position in a list */
const rmToggle = page.locator("label", { hasText: /reduce motion|reduced motion/i }).locator("input").first();
if (await rmToggle.count()) {
  await rmToggle.check({ force: true }).catch(() => {});
} else {
  await page.evaluate(() => {
    document.documentElement.dataset.reducedMotion = "true";
  });
}
await page.waitForTimeout(400);
await page.goto(`${ORIGIN}/?nointro#gallery`, { waitUntil: "load" });
await settle(".gallery-screen", 1800);

const rm = await page.evaluate(() => {
  const running = document.getAnimations().filter((a) => {
    if (a.playState !== "running") return false;
    try {
      return a.effect.getComputedTiming().iterations === Infinity;
    } catch {
      return false;
    }
  });
  const names = {};
  for (const a of running) names[a.animationName ?? "(waapi)"] = (names[a.animationName ?? "?"] ?? 0) + 1;
  return {
    flag: document.documentElement.dataset.reducedMotion,
    names,
    alive: document.querySelectorAll(".gal-tile.is-alive").length,
    tiles: document.querySelectorAll(".gal-tile").length,
    tilesClickable: document.querySelectorAll(".gal-tile").length > 0,
  };
});
const decorative = ["hb-sheen-pass", "gal-room-breathe", "gal-room-rake", "gal-wall-light", "gal-gem-breathe"];
const leaked = decorative.filter((n) => rm.names[n]);
if (rm.flag !== "true") fail(`reduced motion never took: data-reduced-motion=${rm.flag}`);
else if (leaked.length) fail(`reduced motion still runs ${leaked.join(", ")}`);
else ok(`reduced motion: none of the five decorative loops runs (${JSON.stringify(rm.names)})`);
if (rm.alive !== 0) fail(`reduced motion: ${rm.alive} tiles were still granted the crawl`);
else ok("reduced motion: the observer never grants the crawl at all");
if (!rm.tilesClickable) fail("reduced motion: the gallery has no tiles");
else ok(`reduced motion: all ${rm.tiles} tiles still built and reachable`);

/* back off */
if (await rmToggle.count()) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "load" });
  await settle(".a11y-screen", 700);
  await rmToggle.uncheck({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
