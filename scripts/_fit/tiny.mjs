/**
 * Every rendered text size under the 11px legibility floor, unrounded.
 *
 * Written to settle one question before changing a rule: verify-mobile.mjs used
 * to count "anything that ROUNDS below 11px", which is how base.css describes
 * the floor beside --fs-micro, and which forgives every literal in the
 * half-pixel above it. 0.66rem is 10.56px at 100% and sat in the battle log.
 *
 * Tightening the comparison is obviously correct and obviously risky: a floor
 * that suddenly reports thirty rows is a floor nobody will read. So this asked
 * the strict question across all sixteen swept routes first, and the answer was
 * two elements in the whole game, both the same declaration. The rule was
 * tightened on that number rather than on the principle alone.
 *
 *   node scripts/_fit/tiny.mjs --size 1280x720
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME=["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN="http://localhost:5173";
const a=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h]=String(a("size","1280x720")).split("x").map(Number);
const routes=String(a("routes","lobby,play,collection,decks,deckbuilder,shop,missions,profile,gauntlet,events,a11y,settings,mastery,achievements,gallery,battle?seed=4")).split(",");
const browser=await chromium.launch({executablePath:CHROME,headless:true,ignoreDefaultArgs:["--hide-scrollbars"],args:["--enable-unsafe-swiftshader","--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
const page=await ctx.newPage();
await seedPlayedAccount(page,ORIGIN);
for(const route of routes){
  await page.goto(`${ORIGIN}/?nointro#${route}`,{waitUntil:"networkidle"});
  await page.waitForTimeout(2400);
  const rows=await page.evaluate(()=>{
    const name=(n)=>{const c=typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):"";return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${c?"."+c:""}`;};
    const seen=new Map();
    for(const el of document.querySelectorAll(".screen *")){
      if(el.children.length)continue;
      if((el.textContent||"").trim().length<3)continue;
      if(typeof el.checkVisibility==="function"&&!el.checkVisibility({opacityProperty:true,visibilityProperty:true,contentVisibilityAuto:true}))continue;
      const px=parseFloat(getComputedStyle(el).fontSize);
      if(!(px>0)||px>=11)continue;
      const k=`${name(el)}|${px.toFixed(2)}`;
      if(!seen.has(k))seen.set(k,{el:name(el),px:+px.toFixed(2),text:(el.textContent||"").replace(/\s+/g," ").trim().slice(0,30)});
    }
    return [...seen.values()];
  });
  for(const r of rows) console.log(route.padEnd(16), JSON.stringify(r));
}
await browser.close();
