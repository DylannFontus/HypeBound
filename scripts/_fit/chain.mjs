/**
 * Print the ancestor chain of one element, with the numbers that decide whether
 * it is reachable.
 *
 * `verify-mobile.mjs` says *what* is cut; this says *who* cut it. Every finding
 * in that sweep is a rectangle against a clip rectangle, and the repair is
 * always one declaration on one ancestor — so the first question after a
 * report is which ancestor, and the answer is a walk printing box, scrollWidth,
 * clientWidth, both overflows and the computed `grid-template-columns`.
 *
 * It is what turned "#profile has four unreachable buttons at 160%" into
 * "`nav.profile-links` is 201px wide and its single grid track computes to
 * 304px, inside a `section.d-rail-card` that is `overflow: hidden`" — which is
 * a one-word fix (`min()`), and was not guessable from the report alone.
 *
 *   node scripts/_fit/chain.mjs --size 844x390 --scale 160 --route profile  *        --sel "#profile-achievements"
 *
 * The interface size is chosen by CLICKING the accessibility screen's own
 * control, never by writing `--ui-scale` onto the root: the setting also drives
 * JS-side layout decisions, so a hand-set property photographs a state the game
 * never enters.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME = ["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN = "http://localhost:5173";
const a = (n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h] = String(a("size","844x390")).split("x").map(Number);
const pct = Number(a("scale","160"));
const route = String(a("route","profile"));
const sel = String(a("sel","#profile-achievements"));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs:["--hide-scrollbars"], args:["--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1, hasTouch:w<1200, isMobile:w<1200 });
const page = await ctx.newPage();
await seedPlayedAccount(page, ORIGIN);
if (pct !== 100) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, {waitUntil:"networkidle"});
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(400);
}
await page.goto(`${ORIGIN}/?nointro#${route}`, {waitUntil:"networkidle"});
await page.waitForTimeout(2200);
const out = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { error: "not found" };
  const name = (n) => { const cls = typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):""; return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${cls?"."+cls:""}`; };
  const rows = [];
  let n = el;
  while (n && n !== document.documentElement) {
    const b = n.getBoundingClientRect(); const cs = getComputedStyle(n);
    rows.push({ el:name(n), box:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)], scrollW:n.scrollWidth, clientW:n.clientWidth, ovx:cs.overflowX, ovy:cs.overflowY, cols:cs.gridTemplateColumns.slice(0,80), pad:cs.padding, minW:cs.minWidth });
    n = n.parentElement;
  }
  return { vw: innerWidth, vh: innerHeight, uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(), rows };
}, sel);
console.log(JSON.stringify(out, null, 1));
await browser.close();
