import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
/**
 * Is the legacy `.panel` compatibility material the same substance as
 * `.mat-panel`, or only the same idea? The census counts class names; the eye
 * reads grain, rim, lip, cast and radius. This prints those five for a legacy
 * rail and a real material side by side on the same page, so "two languages"
 * can be settled with numbers instead of adjectives.
 */
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const O="http://localhost:5173";
const b=await chromium.launch({executablePath:CHROME,headless:true,ignoreDefaultArgs:["--hide-scrollbars"],args:["--enable-unsafe-swiftshader","--no-sandbox"]});
const p=await b.newPage({viewport:{width:1600,height:900}});
await seedPlayedAccount(p,O);
for(const [r,sels] of [["collection",[".filter-rail",".card-grid"]],["deckbuilder",[".builder-side"]],["lobby",[".lobby-tile",".lobby-record"]]]){
 await p.goto(`${O}/?nointro#${r}`,{waitUntil:"networkidle"});await p.waitForTimeout(2200);
 console.log(r, JSON.stringify(await p.evaluate((ss)=>{
  const pick=(s)=>{const e=document.querySelector(s);if(!e)return {s,missing:1};const c=getComputedStyle(e);
   return {s,cls:String(e.className).slice(0,30),grain:/url\(/.test(c.backgroundImage),layers:c.backgroundImage.split("),").length,
   shadowLen:c.boxShadow.length, insets:(c.boxShadow.match(/inset/g)||[]).length, radius:c.borderTopLeftRadius,
   borderTop:c.borderTopColor, borderBottom:c.borderBottomColor};};
  const mats=[...document.querySelectorAll(".mat-panel")].slice(0,1).map(e=>{const c=getComputedStyle(e);
   return {s:".mat-panel", cls:String(e.className).slice(0,30), grain:/url\(/.test(c.backgroundImage),layers:c.backgroundImage.split("),").length,
   shadowLen:c.boxShadow.length, insets:(c.boxShadow.match(/inset/g)||[]).length, radius:c.borderTopLeftRadius,
   borderTop:c.borderTopColor,borderBottom:c.borderBottomColor};});
  return [...ss.map(pick),...mats];
 },sels),null,0));
}
await b.close();
