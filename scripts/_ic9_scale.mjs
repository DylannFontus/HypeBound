import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";
const CHROME=[String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`].find(p=>existsSync(p));
const O="http://localhost:5173", DIR="scripts/screenshots/w9/ic9-scale"; mkdirSync(DIR,{recursive:true});
const b=await chromium.launch({executablePath:CHROME,headless:true,ignoreDefaultArgs:["--hide-scrollbars"],args:["--enable-unsafe-swiftshader","--no-sandbox"]});
const c=await b.newContext({viewport:{width:1280,height:800},hasTouch:true,deviceScaleFactor:1});
const p=await c.newPage(); const cdp=await c.newCDPSession(p);
await seedPlayedAccount(p,O);
async function setScale(s){await p.setViewportSize({width:1280,height:800});await p.goto(`${O}/?nointro#a11y`,{waitUntil:"networkidle"});await p.waitForTimeout(600);await p.locator("button",{hasText:new RegExp(`^${Math.round(s*100)}%$`)}).first().click();await p.waitForTimeout(400);}
for(const [w,h,s] of [[1280,720,1.4],[1280,720,1.6],[844,390,1.6]]){
  await setScale(s); await p.setViewportSize({width:w,height:h});
  for(const r of ["lobby","battle?seed=88&difficulty=casual"]){
    await p.goto(`${O}/?nointro#${r}`,{waitUntil:"networkidle"});
    if(r.startsWith("battle")){
      await p.waitForSelector(".mulligan-panel",{timeout:30000}); await p.waitForTimeout(900);
      const g=await p.evaluate(()=>{const e=document.querySelector(".mulligan-actions .btn-primary");const q=e.getBoundingClientRect();return {x:Math.round(q.left+q.width/2),y:Math.round(q.top+q.height/2)};});
      await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:g.x,y:g.y,button:"left",clickCount:1});
      await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:g.x,y:g.y,button:"left",clickCount:1});
      await p.waitForFunction(()=>document.querySelectorAll(".hand-card").length>0,null,{timeout:25000}).catch(()=>{});
      await p.waitForTimeout(2500);
    } else await p.waitForTimeout(1800);
    const n=`${r.split("?")[0]}-${w}x${h}-${Math.round(s*100)}`;
    await p.screenshot({path:path.join(DIR,n+".png")});
    console.log(n);
  }
}
await b.close();
