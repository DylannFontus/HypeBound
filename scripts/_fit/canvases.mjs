/**
 * Every `<canvas>` on a route: backing store, CSS box, both aspects, object-fit.
 *
 * A canvas is a replaced element, so its picture is squashed whenever the shape
 * of its backing store and the shape of its box disagree and `object-fit` is
 * `fill` — which is the initial value, so it is the state of every canvas
 * nobody has thought about. That is invisible in a screenshot (a crushed card
 * still reads as a card) and invisible in the DOM (nothing is wrong with the
 * markup), and it is how the mulligan shipped a 0.753:1 card painted at 1.575:1
 * through nine waves of visual review.
 *
 * Printing the four numbers side by side is the whole tool, and it also shows
 * the thing that is *not* a defect: an explicit `cover`, which crops.
 *
 *   node scripts/_fit/canvases.mjs --route "battle?seed=4" --size 844x390 --scale 160
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME = ["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN = "http://localhost:5173";
const a = (n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h] = String(a("size","844x390")).split("x").map(Number);
const pct = Number(a("scale","100"));
const route = String(a("route","decks"));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs:["--hide-scrollbars"], args:["--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1, hasTouch:w<1200, isMobile:w<1200 });
const page = await ctx.newPage();
await seedPlayedAccount(page, ORIGIN);
if (pct !== 100) { await page.goto(`${ORIGIN}/?nointro#a11y`, {waitUntil:"networkidle"}); await page.waitForTimeout(900); await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click(); await page.waitForTimeout(400); }
await page.goto(`${ORIGIN}/?nointro#${route}`, {waitUntil:"networkidle"});
await page.waitForTimeout(2600);
const rows = await page.evaluate(() => {
  const name = (n) => { const cls = typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):""; return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${cls?"."+cls:""}`; };
  return [...document.querySelectorAll("canvas")].map((c) => {
    const b = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    return { el: name(c), parent: c.parentElement?name(c.parentElement):null, store: `${c.width}x${c.height}`, storeAR: +(c.width/c.height).toFixed(3),
      box: `${Math.round(b.width)}x${Math.round(b.height)}`, boxAR: b.height? +(b.width/b.height).toFixed(3):0,
      fit: cs.objectFit, inline: c.getAttribute("style")||"", cssW: cs.width, cssH: cs.height, aspectRatio: cs.aspectRatio };
  });
});
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
