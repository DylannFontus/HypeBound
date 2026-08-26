/**
 * Every replaced element in the game whose box is not the shape of its picture,
 * across a set of routes, at one window size.
 *
 * `verify-mobile.mjs` fails on a *distortion* — a wrong shape being painted
 * with `object-fit: fill`. This is the wider question behind it, and the one the
 * owner actually asked: does the asset FIT the format? A mismatch that is
 * explicitly `cover` is not a bug, but it is not free either, because `cover`
 * pays for a wrong shape by throwing the rest of the picture away. At 844x390
 * the play screen's hero art is a 0.667:1 portrait in an 808x76 box: `cover`
 * behaves exactly as promised and shows roughly one and a half per cent of the
 * painting, as a horizontal smear.
 *
 * So this prints the shape gap and lets a human decide, rather than guessing on
 * their behalf. It is also the evidence that `foundation.css` §11's
 * `object-fit: contain` default costs nothing: run across eleven routes at
 * 1600x900, 3440x1440 and 844x390, every single mismatch in the game is already
 * an explicit `cover`, so there is nothing anywhere for `contain` to letterbox.
 *
 *   node scripts/_fit/imgs.mjs --size 3440x1440
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME=["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN="http://localhost:5173";
const a=(n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h]=String(a("size","1600x900")).split("x").map(Number);
const routes=String(a("routes","lobby,play,collection,decks,shop,signin,queue,gallery,profile,events,missions")).split(",");
const browser=await chromium.launch({executablePath:CHROME,headless:true,ignoreDefaultArgs:["--hide-scrollbars"],args:["--enable-unsafe-swiftshader","--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
const page=await ctx.newPage();
await seedPlayedAccount(page,ORIGIN);
for(const route of routes){
  await page.goto(`${ORIGIN}/?nointro#${route}`,{waitUntil:"networkidle"});
  await page.waitForTimeout(2200);
  const rows=await page.evaluate(()=>{
    const name=(n)=>{const c=typeof n.className==="string"?n.className.trim().split(/\s+/).slice(0,3).join("."):"";return `${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}${c?"."+c:""}`;};
    const out=[];
    for(const el of document.querySelectorAll("img, canvas")){
      const cs=getComputedStyle(el);const wpx=parseFloat(cs.width),hpx=parseFloat(cs.height);
      const nw=el.tagName==="IMG"?el.naturalWidth:el.width, nh=el.tagName==="IMG"?el.naturalHeight:el.height;
      if(!(wpx>8&&hpx>8&&nw&&nh))continue;
      const nat=nw/nh, box=wpx/hpx; const skew=nat>box?nat/box:box/nat;
      if(skew<=1.02)continue;
      out.push({el:name(el),fit:cs.objectFit,nat:+nat.toFixed(3),box:+box.toFixed(3),skew:+skew.toFixed(2),size:`${Math.round(wpx)}x${Math.round(hpx)}`});
    }
    return out;
  });
  for(const r of rows) console.log(route.padEnd(12), JSON.stringify(r));
}
await browser.close();
