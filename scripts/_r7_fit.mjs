/**
 * Do the seven late-migrated routes survive the four geometries the project
 * promises?
 *
 * `verify:mobile` is the responsive gate and it walks twelve screens — lobby,
 * play, collection, decks, deckbuilder, shop, missions, profile, gauntlet,
 * events, a11y, settings. Not one of the seven routes this pass touched is in
 * that list, which is the same blindness `_ic_census.mjs` had one file over: a
 * check that covers a subset is read as covering the game. That script belongs
 * to another owner this wave, so rather than widen its list, this covers the
 * seven directly and says so out loud.
 *
 * The four geometries are the hard constraint: **1280×720, 844×390 landscape,
 * and `--ui-scale` 1.4 and 1.6.** For each, three questions:
 *
 *   sideways   does the page scroll horizontally? (never allowed)
 *   spill      does anything stick out of the screen root's own box?
 *   tiny       any control under 44px on a coarse pointer?
 *
 * The scale is set through the accessibility screen's own control rather than
 * by writing `--ui-scale` on the root, because the setting also drives
 * JS-side layout decisions — a hand-set custom property photographs a state the
 * game never actually enters. `_ic3_scale.mjs` learned that first.
 *
 *   node scripts/_r7_fit.mjs                 all seven, all four geometries
 *   node scripts/_r7_fit.mjs lab custom      just these routes
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ROUTES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SEVEN = ROUTES.length
  ? ROUTES
  : ["lab", "doomscroll", "custom", "remixhub", "patchnotes", "tour", "boss"];

const GEOMETRIES = [
  { name: "1280x720", w: 1280, h: 720, touch: false, scale: null },
  { name: "844x390 landscape", w: 844, h: 390, touch: true, scale: null },
  { name: "1280x720 @140%", w: 1280, h: 720, touch: false, scale: "140%" },
  { name: "1280x720 @160%", w: 1280, h: 720, touch: false, scale: "160%" },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

let problems = 0;
for (const g of GEOMETRIES) {
  const context = await browser.newContext({
    viewport: { width: g.w, height: g.h },
    hasTouch: g.touch,
    isMobile: false,
  });
  const page = await context.newPage();
  await seedPlayedAccount(page, ORIGIN);

  if (g.scale) {
    await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await page
      .locator("button", { hasText: new RegExp(`^${g.scale}$`) })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(700);
  }

  const applied = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
  );
  console.log(`\n${g.name}  (--ui-scale ${applied || "1"}${g.touch ? ", coarse pointer" : ""})`);
  if (g.scale && applied !== (g.scale === "140%" ? "1.4" : "1.6")) {
    console.log(`  ! the ${g.scale} control did not take — measured ${applied || "unset"}`);
    problems += 1;
  }

  for (const route of SEVEN) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 25000 })
      .catch(() => {});
    if (route === "boss") {
      await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    }
    await page.waitForTimeout(1200);

    const r = await page.evaluate(() => {
      const screen = document.querySelector(".screen");
      if (!screen) return { err: "no .screen" };
      const box = screen.getBoundingClientRect();
      const sideways = Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - window.innerWidth
      );
      const spill = [];
      const tiny = [];
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      /**
       * `ownerSVGElement` is the guard, and it is here because the first run of
       * this script reported four spills on `#boss` at every geometry — a `<g>`
       * and two `<circle>`s "1,239px to the left of the screen". They are not:
       * a shape inside an `<svg>` reports a client rect derived from the
       * viewBox transform, so a decorative ring drawn in a 0–100 user space
       * lands wherever the transform puts it and has nothing to do with layout.
       * Their class names came out as `[object SVGAnimatedString]`, which was
       * the tell. Only HTML boxes are laid out, so only HTML boxes are measured.
       */
      for (const e of screen.querySelectorAll("*")) {
        if (e.ownerSVGElement) continue;
        const b = e.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        if (b.right > box.right + 2 || b.left < box.left - 2) {
          const cls = String(e.className || "").trim().split(/\s+/).slice(0, 2).join(".");
          spill.push(`${e.tagName.toLowerCase()}${cls ? "." + cls : ""} +${Math.round(b.right - box.right)}px`);
        }
        if (!coarse) continue;
        const interactive =
          e.tagName === "BUTTON" || e.tagName === "SELECT" || e.tagName === "INPUT" || e.getAttribute("role") === "button";
        if (interactive && (b.height < 43.5 || b.width < 43.5)) {
          tiny.push(`${e.tagName.toLowerCase()} ${Math.round(b.width)}×${Math.round(b.height)}`);
        }
      }
      return { sideways: Math.max(0, sideways), spill: [...new Set(spill)].slice(0, 6), tiny: [...new Set(tiny)].slice(0, 6) };
    });

    if (r.err) {
      console.log(`  ${route.padEnd(12)} ! ${r.err}`);
      problems += 1;
      continue;
    }
    const bad = r.sideways > 1 || r.spill.length || r.tiny.length;
    if (bad) problems += 1;
    console.log(
      `  ${route.padEnd(12)} ${bad ? "FAIL" : "ok  "}  sideways=${r.sideways}px  spill=${r.spill.length}  tiny=${r.tiny.length}`
    );
    for (const s of r.spill) console.log(`      spill ${s}`);
    for (const s of r.tiny) console.log(`      tiny  ${s}`);
  }
  await context.close();
}

await browser.close();
console.log(problems === 0 ? "\nPASS — the seven fit all four geometries." : `\n${problems} problem(s)`);
