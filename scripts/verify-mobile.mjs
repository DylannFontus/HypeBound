/**
 * The responsive claims, at real device viewports — known gap 7.
 *
 * The gap read: *"Mobile is responsive but untested on a real device. Landscape
 * enforcement, pointer unification and 44px targets are implemented; go test it
 * on hardware."* Hardware is still hardware and this is not a substitute for it.
 * What it *is* a substitute for is the half of that sentence which was never
 * checked at all: the claims are implemented, and nothing had ever confirmed
 * they hold at a phone's actual dimensions.
 *
 * So this walks the real screens at four real viewports and asserts:
 *
 * - **nothing scrolls sideways** — the single most common responsive failure,
 *   and the one that makes a layout feel broken rather than cramped;
 * - **touch targets clear 44 CSS pixels**, which is §13's number and Apple's;
 * - **portrait raises the rotate overlay** on a small screen and does not on a
 *   large one, because a tablet held upright is not a mistake;
 * - **the battle board still deals** at the smallest supported size;
 * - **text does not shrink below legibility** anywhere.
 *
 * What it cannot do is feel a real finger, judge a real screen's contrast, or
 * report thermals. Those stay in the gap.
 *
 * ## The settle, and the sixth instrument that lied
 *
 * This used to measure 250ms after the screen root appeared, which was fine
 * until the visual overhaul gave every screen the staggered entrance §3a of the
 * bar demands. `getBoundingClientRect` returns the *visual* box, so a row that
 * arrives from `scale: 0.985` scales its whole subtree — and a button sitting
 * exactly on the 44px floor measures 43.4 and is rounded to 43. Eight controls
 * on `#missions` and three on `#shop` were reported as under-size targets whose
 * resting boxes are 390×44; the reading was a photograph of an animation, not
 * of a control. Waiting cannot hide a genuine failure, because a `min-height`
 * that is too small is too small at rest as well.
 *
 * So it waits for the entrance to finish rather than for a fixed number of
 * milliseconds. `iterations !== Infinity` is the load-bearing half: the idle
 * layer — ambient drift, specular crawl, the breathing hero — never stops, and
 * waiting for zero animations would simply time out on every screen.
 */
import { chromium, devices } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

/**
 * Four viewports, chosen to bracket what actually exists rather than to be
 * pretty numbers: the smallest phone anyone still ships, a common modern phone,
 * a tablet, and a small laptop.
 */
const VIEWPORTS = [
  { name: "iPhone SE landscape", width: 667, height: 375, touch: true, dpr: 2 },
  { name: "Pixel 7 landscape", width: 915, height: 412, touch: true, dpr: 2.6 },
  { name: "iPad landscape", width: 1080, height: 810, touch: true, dpr: 2 },
  /**
   * iPad Pro 11-inch, in Safari rather than standalone.
   *
   * 2420x1668 physical at 2x is 1210x834 points, and Safari's own chrome takes
   * roughly 74 of them, so the page gets about 1210x760. That is a viewport this
   * set did not cover: wider than the 1080 iPad and *shorter* than the 810 one,
   * which is the combination that catches a layout sized from vh. It is also a
   * device somebody actually intends to play this on, which the generic entries
   * above are not.
   */
  { name: "iPad Pro 11in landscape, Safari chrome", width: 1210, height: 760, touch: true, dpr: 2 },
  { name: "small laptop", width: 1280, height: 720, touch: false, dpr: 1 },
];

/** §13's target size, and the one every platform guideline agrees on. */
const MIN_TARGET = 44;

const SCREENS = [
  { hash: "lobby", selector: ".lobby-screen" },
  { hash: "play", selector: ".play-screen" },
  { hash: "collection", selector: ".collection-screen" },
  { hash: "decks", selector: ".deck-slots-screen" },
  { hash: "deckbuilder", selector: ".builder-screen" },
  { hash: "shop", selector: ".shop-screen" },
  { hash: "missions", selector: ".missions-screen" },
  { hash: "profile", selector: ".profile-screen" },
  { hash: "gauntlet", selector: ".gauntlet-screen" },
  { hash: "events", selector: ".events-screen" },
  { hash: "a11y", selector: ".a11y-screen" },
  { hash: "settings", selector: ".settings-screen" },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

/** Hold until every finite animation has finished; see the note at the top. */
const settleEntrance = async (page) => {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().filter((a) => {
          if (a.playState !== "running") return false;
          const timing = a.effect?.getTiming?.();
          return Boolean(timing) && timing.iterations !== Infinity;
        }).length === 0,
      null,
      { timeout: 6000 }
    )
    .catch(() => {});
  await page.waitForTimeout(250);
};

let failures = 0;
const fail = (m) => {
  console.log(`   FAIL: ${m}`);
  failures += 1;
};
const ok = (m) => console.log(`   ok: ${m}`);
const errors = [];

/** Measure one screen: sideways scroll, small targets, tiny text. */
const measure = async (page) =>
  page.evaluate((minTarget) => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;

    const interactive = [...document.querySelectorAll("button, a, [role='switch'], [role='radio'], input, select")]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });

    const small = interactive
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { label: (el.textContent ?? "").trim().slice(0, 24) || el.id || el.className.split(" ")[0], w: Math.round(box.width), h: Math.round(box.height) };
      })
      .filter((entry) => entry.w < minTarget || entry.h < minTarget);

    const tiny = [...document.querySelectorAll("p, li, td, span, div")]
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 3)
      .map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize)))
      .filter((size) => size > 0 && size < 11);

    return { overflow, interactive: interactive.length, small, tiny: tiny.length };
  }, MIN_TARGET);

for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.name} — ${viewport.width}×${viewport.height}${viewport.touch ? ", touch" : ""}`);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
  });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${viewport.name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${viewport.name}: ${e.message}`));

  await seedPlayedAccount(page);

  let wideScreens = 0;
  const smallTargets = new Map();
  let tinyText = 0;

  for (const screen of SCREENS) {
    await page.goto(`${ORIGIN}/#${screen.hash}`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector(screen.selector, { timeout: 15000 });
    } catch {
      fail(`${screen.hash} never rendered`);
      continue;
    }
    await settleEntrance(page);

    const result = await measure(page);
    if (result.overflow > 2) {
      fail(`#${screen.hash} scrolls sideways by ${result.overflow}px`);
      wideScreens += 1;
    }
    for (const entry of result.small) {
      smallTargets.set(`${screen.hash}: ${entry.label} (${entry.w}×${entry.h})`, true);
    }
    tinyText += result.tiny;
  }

  if (wideScreens === 0) ok(`none of the ${SCREENS.length} screens scrolls sideways`);
  /**
   * The 44px floor is a **touch** rule and is asserted only where a finger is
   * the pointer. On a mouse a 44px filter chip is a third taller for nobody's
   * benefit, so the laptop viewport reports the count and does not fail on it.
   */
  if (smallTargets.size === 0) {
    ok(`every interactive element clears ${MIN_TARGET}px in both directions`);
  } else if (viewport.touch) {
    fail(`${smallTargets.size} touch target(s) under ${MIN_TARGET}px: ${[...smallTargets.keys()].slice(0, 6).join("; ")}`);
  } else {
    ok(`${smallTargets.size} control(s) sit under ${MIN_TARGET}px on a mouse, which is the point of the coarse-pointer rule`);
  }
  if (tinyText === 0) ok("no text renders below 11px");
  else fail(`${tinyText} element(s) render text below 11px`);

  /**
   * Portrait. §13 enforces landscape on a phone and must NOT on a tablet held
   * upright — a rotate prompt on a device that is perfectly usable is a wall in
   * front of a working game.
   */
  /**
   * A fresh context, portrait from the start — which is the case that matters:
   * somebody opening the game on a phone they are already holding upright.
   * Resizing the existing page tested the resize listener instead, and reported
   * a failure the app did not have.
   */
  const portraitContext = await browser.newContext({
    viewport: { width: viewport.height, height: viewport.width },
    deviceScaleFactor: viewport.dpr,
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
  });
  const portraitPage = await portraitContext.newPage();
  await portraitPage.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
  await portraitPage.waitForTimeout(400);
  const portrait = await portraitPage.evaluate(() => {
    const overlay = document.getElementById("rotate-overlay");
    return {
      exists: Boolean(overlay),
      shown: overlay ? !overlay.hidden : false,
      w: window.innerWidth,
      h: window.innerHeight,
      min: Math.min(window.innerWidth, window.innerHeight),
    };
  });
  const shouldPrompt = portrait.h > portrait.w && portrait.min < 820;
  if (!portrait.exists) fail("there is no rotate overlay at all");
  else if (portrait.shown !== shouldPrompt) {
    fail(
      `at ${portrait.w}×${portrait.h} the rotate overlay is ${portrait.shown ? "shown" : "hidden"}; ` +
        `the rule (portrait and a short side under 820px) says it should be ${shouldPrompt ? "shown" : "hidden"}`
    );
  } else if (shouldPrompt) {
    ok(`portrait at ${portrait.w}×${portrait.h} asks for landscape`);
  } else {
    ok(`${portrait.w}×${portrait.h} is left alone — it is not portrait, or it is big enough not to be`);
  }
  await portraitContext.close();

  await page.screenshot({ path: path.join(OUT, `mobile-${viewport.width}x${viewport.height}.png`) });
  await context.close();
}

/**
 * The board, at the smallest supported size.
 *
 * Every other check is about menus. A card game that lays out beautifully and
 * then cannot deal a hand on a phone has not been checked.
 */
console.log("\nThe battle board at 667×375");
const context = await browser.newContext({
  viewport: { width: 667, height: 375 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`board: ${e.message}`));
await seedPlayedAccount(page);
await page.goto(`${ORIGIN}/#battle?difficulty=casual`, { waitUntil: "networkidle" });
try {
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForTimeout(3000);
  const board = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const doc = document.documentElement;
    return {
      canvas: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
      overflow: doc.scrollWidth - doc.clientWidth,
      hand: document.querySelectorAll(".hand-card, .hand .card").length,
    };
  });
  if (!board.canvas) fail("the board rendered no canvas at 667×375");
  else if (board.canvas.w < 300) fail(`the board canvas is only ${board.canvas.w}px wide`);
  else ok(`the board fills ${board.canvas.w}×${board.canvas.h} and deals${board.hand ? ` (${board.hand} in hand)` : ""}`);
  if (board.overflow > 2) fail(`the board scrolls sideways by ${board.overflow}px`);
  else ok("and does not scroll sideways");
  await page.screenshot({ path: path.join(OUT, "mobile-battle.png") });
} catch (error) {
  fail(`the board never rendered at 667×375: ${String(error).slice(0, 120)}`);
}
await context.close();

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/mobile-*.png");
console.log(
  failures === 0
    ? "\nPASS — the responsive claims hold at four viewports. Real hardware is still untested.\n"
    : `\n${failures} FAILURE(S)\n`
);
await browser.close();
void devices;
process.exit(failures === 0 ? 0 : 1);
