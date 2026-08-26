/**
 * Every run of text on a route that is cut by an ancestor, and which ancestor.
 *
 * The companion to `chain.mjs` for the text channel: `verify-mobile.mjs` reports
 * "14 of 23px cut on y" and this says the clipper is
 * `button.mode-card.mode-tail`, that it is 70px tall, that its `overflow-y` is
 * `hidden` and that its scrollHeight exceeds its clientHeight — which together
 * are the difference between "this list needs scrolling" and "this tile is too
 * short for its own contents at 160% and nothing can reach the rest".
 *
 *   node scripts/_fit/cut.mjs --size 1280x720 --scale 160 --route play
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME = ["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN = "http://localhost:5173";
const a = (n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h] = String(a("size","1280x720")).split("x").map(Number);
const pct = Number(a("scale","160"));
const route = String(a("route","play"));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs:["--hide-scrollbars"], args:["--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1, hasTouch:w<1250, isMobile:w<1250 });
const page = await ctx.newPage();
await seedPlayedAccount(page, ORIGIN);
if (pct !== 100) { await page.goto(`${ORIGIN}/?nointro#a11y`, {waitUntil:"networkidle"}); await page.waitForTimeout(900); await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click(); await page.waitForTimeout(400); }
await page.goto(`${ORIGIN}/?nointro#${route}`, {waitUntil:"networkidle"});
await page.waitForTimeout(2600);
const rows = await page.evaluate(() => {
  const screen = document.querySelector(".screen");
  const name=(n)=>{const c=typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):"";return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${c?"."+c:""}`;};
  const out=[];
  for (const el of screen.querySelectorAll("*")) {
    if (el.children.length) continue;
    if (!(el.textContent||"").trim()) continue;
    const b = el.getBoundingClientRect();
    if (b.width<8||b.height<8) continue;
    let n = el.parentElement, clipper=null, cbox=null;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== "visible") {
        const cb = n.getBoundingClientRect();
        if (b.bottom > cb.bottom + 1 || b.top < cb.top - 1) { clipper = n; cbox = cb; break; }
      }
      n = n.parentElement;
    }
    if (!clipper) continue;
    const cs = getComputedStyle(clipper);
    out.push({ el:name(el), text:(el.textContent||"").replace(/\s+/g," ").trim().slice(0,42),
      box:[Math.round(b.top),Math.round(b.bottom),Math.round(b.height)],
      clipper:name(clipper), cbox:[Math.round(cbox.top),Math.round(cbox.bottom),Math.round(cbox.height)],
      ovy: cs.overflowY, scrollable: clipper.scrollHeight > clipper.clientHeight + 2 });
  }
  return out;
});
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
