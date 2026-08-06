/**
 * Does the gallery still do what the automation contract says it does?
 *
 * `verify-screens.mjs` drives this screen entirely through `window.
 * hypeboundGallery` and four class names, and this wave renamed the tile class
 * out from under a legacy `screens.css` rule that was overwriting the material.
 * This is the cheap check that the hook, the filter, the character page and the
 * card strip all still answer — run before the slow verifier rather than after.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log(`  ! pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`  ! console: ${m.text().slice(0, 160)}`);
});
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#gallery", { waitUntil: "networkidle" });
await page.waitForSelector(".gallery-screen");
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const g = window.hypeboundGallery;
  const out = { hasHook: Boolean(g) };
  if (!g) return out;
  out.count = g.count();
  out.tilesAll = document.querySelectorAll(".gal-tile").length;
  out.shelves = document.querySelectorAll(".gal-shelf").length;
  out.rosterRows = document.querySelectorAll(".gal-fac").length;
  out.neon = g.show("neon-idols");
  out.shelvesFiltered = document.querySelectorAll(".gal-shelf").length;
  g.show("all");
  const ids = [...document.querySelectorAll(".gal-tile")].map((t) => t.dataset.id);
  out.firstIds = ids.slice(0, 3);
  out.opened = g.open(ids[0]);
  out.pagePresent = Boolean(document.querySelector(".gallery-page"));
  out.prose = document.querySelectorAll(".gallery-prose").length;
  out.trackHeads = document.querySelectorAll(".gallery-track h4").length;
  out.stripCanvases = document.querySelectorAll("#gallery-strip canvas").length;
  out.portraitCanvas = Boolean(document.querySelector("#gallery-portrait canvas"));
  out.openedLumi = g.open("idols-lumi-starcall");
  g.close();
  out.backToGrid = document.querySelectorAll(".gal-tile").length;
  return out;
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
