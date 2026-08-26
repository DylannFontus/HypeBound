/**
 * The geometry of a handful of selectors: box, scroll metrics, track sizes,
 * alignment, overflow, and any transform in force.
 *
 * Written for one question and kept for the answer it gave: why a mode card's
 * visual box sat 7px above its own container on four desktop formats. The
 * transform column said `matrix(1.015, 0, 0, 1.015, 0, -2)` — the card was in
 * its hover state, because Playwright leaves the mouse wherever it last clicked
 * and the sweep clicks an interface-size button on `#a11y` before every scale.
 * The card was not unreachable; the pointer was parked on it. `verify-mobile`
 * now moves the mouse to the corner before every measurement, and that fix
 * exists because this printed `transform` next to the box rather than instead
 * of it.
 *
 *   node scripts/_fit/geo.mjs --size 1280x720 --scale 160 --route play  *        --sels ".mode-features,.mode-features > *"
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME = ["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN = "http://localhost:5173";
const a=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h]=String(a("size","1280x720")).split("x").map(Number);
const pct=Number(a("scale","100"));
const route=String(a("route","play"));
const sels=String(a("sels",".mode-features,.mode-features > *")).split(",");
const browser=await chromium.launch({executablePath:CHROME,headless:true,ignoreDefaultArgs:["--hide-scrollbars"],args:["--enable-unsafe-swiftshader","--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,hasTouch:w<1250,isMobile:w<1250});
const page=await ctx.newPage();
await seedPlayedAccount(page,ORIGIN);
if(true){await page.goto(`${ORIGIN}/?nointro#a11y`,{waitUntil:"networkidle"});await page.waitForTimeout(900);await page.locator("button",{hasText:new RegExp(`^${pct}%$`)}).first().click();await page.waitForTimeout(400);}
await page.goto(`${ORIGIN}/?nointro#${route}`,{waitUntil:"networkidle"});
await page.waitForTimeout(2600);
const rows=await page.evaluate((sels)=>{
  const name=(n)=>{const c=typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):"";return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${c?"."+c:""}`;};
  const out=[];
  for(const sel of sels) for(const el of document.querySelectorAll(sel.trim())){
    const b=el.getBoundingClientRect();const cs=getComputedStyle(el);
    out.push({sel,el:name(el),box:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],
      scroll:[el.scrollWidth,el.scrollHeight,el.clientWidth,el.clientHeight,el.scrollTop],
      rows:cs.gridTemplateRows.slice(0,60),alignContent:cs.alignContent,alignSelf:cs.alignSelf,ov:cs.overflow,minH:cs.minHeight,mt:cs.marginTop,tr:cs.translate,tf:cs.transform});
  }
  return out;
},sels);
for(const r of rows) console.log(JSON.stringify(r));
await browser.close();
