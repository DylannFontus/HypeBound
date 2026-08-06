/** Keyboard reach into the collection grid, and arrow navigation inside it. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:5173/#collection", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  if (location.hash !== "#collection") location.hash = "#collection";
});
await page.waitForTimeout(2500);

const active = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el
      ? {
          cls: String(el.className).slice(0, 30),
          label: el.getAttribute("aria-label")?.slice(0, 60) ?? null,
          ring: getComputedStyle(el).outlineWidth,
        }
      : null;
  });

const out = { tabStops: [], tilesReachedAt: -1 };
for (let i = 0; i < 120; i++) {
  await page.keyboard.press("Tab");
  const info = await active();
  if (info && info.cls.includes("card-cell")) {
    out.tilesReachedAt = i + 1;
    out.firstTile = info;
    break;
  }
}

// how many stops the whole grid costs a player passing through it
let after = 0;
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("Tab");
  const info = await active();
  if (!info || !info.cls.includes("card-cell")) {
    after = i + 1;
    out.tabStopsInsideGrid = after;
    out.afterGrid = info;
    break;
  }
}

// arrows walk the grid
await page.keyboard.press("Shift+Tab");
const trail = [];
for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
  trail.push((await active())?.label ?? null);
}
out.arrowTrail = trail;
out.focusRing = (await active())?.ring ?? null;

// Enter opens
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
out.enterOpens = await page.evaluate(() => {
  const o = document.querySelector(".card-detail-overlay");
  return o ? !o.hidden : false;
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
