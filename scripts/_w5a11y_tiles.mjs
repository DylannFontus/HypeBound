/**
 * How tall does a destination tile actually want to be, and how much room is
 * there for it?
 *
 * `grid-auto-rows: clamp(58px, 10.8vh, 106px)` sizes the nine lobby tiles in
 * `vh` and fills them with `rem`, so the row stands still while the type grows.
 * Algebra gets close; this asks the browser. It releases the row to `auto`,
 * reads what each tile then wants, and measures the slack left in the actions
 * column so the repair can be sized rather than guessed.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const SIZES = (process.env.SIZES ?? "1280x720,1600x900,1920x1080").split(",");
const SCALES = [1, 1.25, 1.4, 1.6];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const size of SIZES) {
  const [w, h] = size.split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await seedPlayedAccount(page);
  console.log(`\n===== ${w}x${h} =====`);
  for (const scale of SCALES) {
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), scale);
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const nav = document.querySelector(".lobby-nav");
      const actions = document.querySelector(".lobby-actions");
      const play = document.querySelector(".lobby-play");
      const widget = document.querySelector(".lobby-deck-widget");
      const rowNow = getComputedStyle(nav).gridAutoRows;
      const before = { nav: nav.offsetHeight, actions: actions.clientHeight, play: play.offsetHeight, widget: widget.offsetHeight };
      // release the row and see what the content wants
      nav.style.gridAutoRows = "auto";
      const wants = [...nav.children].map((el) => ({
        label: el.querySelector(".lobby-nav-label")?.textContent ?? "?",
        h: el.offsetHeight,
        labelLines: Math.round(el.querySelector(".lobby-nav-label").offsetHeight / parseFloat(getComputedStyle(el.querySelector(".lobby-nav-label")).lineHeight)),
      }));
      const navAuto = nav.offsetHeight;
      nav.style.gridAutoRows = "";
      const gap = parseFloat(getComputedStyle(nav).rowGap);
      return { rowNow, before, wants, navAuto, gap, slack: before.actions - (before.play + before.widget + before.nav + 2 * parseFloat(getComputedStyle(actions).rowGap)) };
    });
    const tallest = Math.max(...r.wants.map((x) => x.h));
    const twoLine = r.wants.filter((x) => x.labelLines > 1).map((x) => x.label);
    console.log(
      `  scale ${scale}: row=${r.rowNow}  nav=${r.before.nav}  wants=${r.navAuto} (tallest tile ${tallest})  ` +
        `play=${r.before.play} widget=${r.before.widget} actions=${r.before.actions} slack=${Math.round(r.slack)}  ` +
        `growth needed=${r.navAuto - r.before.nav}  two-line labels: ${twoLine.length ? twoLine.join("/") : "none"}`
    );
  }
  await ctx.close();
}
await browser.close();
