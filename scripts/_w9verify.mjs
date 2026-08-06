/**
 * The behaviours a virtualised wall is most likely to have quietly broken.
 *
 * Building a screen to the fold rather than to the data trades one kind of bug
 * for another: nothing looks wrong, and things that count are suddenly counting
 * a stopwatch. Every check here is one of those.
 *
 *  - the automation hooks still answer for the whole roster, not for the part of
 *    it that happened to be on screen when they were asked
 *  - the scroller is the right length before anything is filled, so the thumb
 *    does not jump under the player's thumb
 *  - a shelf below the fold materialises when it is scrolled to
 *  - the whole cast is reachable by keyboard, which a build-to-the-fold screen
 *    breaks the moment Tab runs out of tiles
 *  - it holds at 1280x720, 844x390 and both interface scales
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
};

for (const [w, h, scale] of [
  [1600, 900, 1],
  [1280, 720, 1],
  [1280, 720, 1.6],
  [844, 390, 1],
  [844, 390, 1.4],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
  await seedPlayedAccount(page, ORIGIN);
  if (scale !== 1) {
    await page.evaluate((s) => {
      document.documentElement.style.setProperty("--ui-scale", String(s));
    }, scale);
  }
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
  await page.evaluate(() => {
    location.hash = "#gallery";
  });
  await page.waitForSelector(".gal-shelf", { timeout: 20000 });
  await page.waitForTimeout(1500);

  console.log(`\n=== ${w}x${h}  ui-scale ${scale} ===`);

  const built = await page.evaluate(() => ({
    shelves: document.querySelectorAll(".gal-shelf").length,
    tiles: document.querySelectorAll(".gal-tile").length,
    scrollH: document.querySelector("#gallery-scroll")?.scrollHeight ?? 0,
    clientH: document.querySelector("#gallery-scroll")?.clientHeight ?? 0,
  }));
  check("all shelves mounted as furniture", built.shelves === 11, `${built.shelves} shelves`);
  check(
    "only the fold is built",
    built.tiles > 0 && built.tiles < 138,
    `${built.tiles} of 138 tiles`
  );
  check(
    "scroller reserved to full length",
    built.scrollH > built.clientH * 2.5,
    `scrollHeight ${built.scrollH} vs client ${built.clientH}`
  );

  /* The reservation must not move the ground under a player who is already
     reading: scroll to a fixed offset, let the shelves there materialise, and
     the offset has to still be the offset. */
  /*
   * What must not move is the picture, and the picture is what is compared.
   *
   * Three numeric versions of this check were wrong in three different ways and
   * every one of them called a working screen broken:
   *
   *  1. `scrollTop` read on the line after the write against its value a second
   *     later — `.hb-scroll` is `scroll-behavior: smooth`, so that is the first
   *     frame of an animation against its destination. 0 against 2,603.
   *  2. The same read after waiting for the smooth scroll: 213px at
   *     `--ui-scale 1.6`. That drift is Blink's **scroll anchoring** moving
   *     `scrollTop` on purpose to keep the anchored element still while a
   *     reserved plane grows into its real height. The number moving is the
   *     mechanism that stops the picture moving.
   *  3. A tile's `getBoundingClientRect().top`, twice: 116px, because a tile
   *     arriving on a shelf is running `card-tile-in`, and a rect read
   *     mid-keyframe reports where the animation put the pixels rather than
   *     where layout put the box.
   *
   *  4. Two captures of the scroller compared byte for byte. That one fails on
   *     every viewport, and it is *right to*: §3a requires the screen to be alive
   *     at rest, so the room breathes, the gems glow and the sheen crawls. An
   *     identity test on a living screen can only ever say "it is alive".
   *
   * What is left is the honest landmark. A `.gal-shelf` section carries no
   * animation of its own — the entrance and the crawl are on the tiles inside it
   * — so its viewport rectangle is layout and nothing else. Take the shelf at the
   * fold and see whether it is where it was.
   */
  const anchored = await page.evaluate(async () => {
    const scroll = document.querySelector("#gallery-scroll");
    if (!scroll) return { moved: -1, id: "none" };
    scroll.style.scrollBehavior = "auto";
    scroll.scrollTop = Math.round(scroll.scrollHeight * 0.4);
    await new Promise((r) => setTimeout(r, 900));
    const mid = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
    const shelf = [...document.querySelectorAll(".gal-shelf")].find((s) => {
      const box = s.getBoundingClientRect();
      return box.top <= mid && box.bottom >= mid;
    });
    if (!shelf) return { moved: -1, id: "no shelf at the fold" };
    const before = shelf.getBoundingClientRect().top;
    await new Promise((r) => setTimeout(r, 1400));
    return { moved: Math.abs(shelf.getBoundingClientRect().top - before), id: shelf.dataset.faction ?? "?" };
  });
  check(
    "the shelf at the fold does not move while others fill",
    anchored.moved >= 0 && anchored.moved <= 3,
    `${anchored.id} moved ${anchored.moved.toFixed?.(1) ?? anchored.moved}px`
  );

  const filled = await page.evaluate(() => {
    const scroll = document.querySelector("#gallery-scroll");
    const mid = (scroll?.scrollTop ?? 0) + (scroll?.clientHeight ?? 0) / 2;
    let onScreen = 0;
    let empty = 0;
    for (const section of document.querySelectorAll(".gal-shelf")) {
      const top = section.offsetTop;
      const bottom = top + section.offsetHeight;
      if (bottom < mid - 200 || top > mid + 200) continue;
      onScreen += 1;
      if (section.querySelectorAll(".gal-tile").length === 0) empty += 1;
    }
    return { onScreen, empty };
  });
  check("no empty plane at the fold after scrolling", filled.empty === 0, `${filled.empty} of ${filled.onScreen}`);

  const hook = await page.evaluate(() => {
    const api = window.hypeboundGallery;
    return { show: api?.show("all") ?? -1, count: api?.count() ?? -1 };
  });
  check("show() answers for the whole roster", hook.show === hook.count, `show ${hook.show}, count ${hook.count}`);

  const keyboard = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".gal-tile")];
    return { tiles: tiles.length, focusable: tiles.filter((t) => t.tabIndex >= 0 || t.tagName === "BUTTON").length };
  });
  check(
    "every built tile is a tab stop",
    keyboard.tiles > 0 && keyboard.focusable === keyboard.tiles,
    `${keyboard.focusable}/${keyboard.tiles}`
  );

  await page.close();
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILURES`}\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
