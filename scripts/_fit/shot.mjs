/**
 * `shot.mjs` with an interface size.
 *
 * The project camera photographs any route at any viewport but has no way to
 * ask for 140% or 160% text, and half of this pass's findings only exist above
 * 100%. Rather than teach the shared camera a flag it does not need, this drives
 * the accessibility screen's own segmented control — which is the only honest
 * way to set the scale, because the setting drives JS-side layout decisions as
 * well as `--ui-scale`, so writing the custom property photographs a state the
 * game never enters.
 *
 *   node scripts/_fit/shot.mjs --route "battle?seed=4" --size 844x390  *        --scale 160 --out mulligan --wait 7000
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "../lib/account.mjs";
const CHROME = ["C:\Program Files\Google\Chrome\Application\chrome.exe","C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"].find((p)=>existsSync(p));
const ORIGIN = "http://localhost:5173";
const a = (n,d)=>{const i=process.argv.indexOf(`--${n}`);return i===-1?d:process.argv[i+1];};
const [w,h] = String(a("size","844x390")).split("x").map(Number);
const pct = Number(a("scale","100"));
const route = String(a("route","lobby"));
const out = String(a("out","shot"));
const dir = String(a("dir","scripts/screenshots/assets/fit"));
mkdirSync(dir,{recursive:true});
const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs:["--hide-scrollbars"], args:["--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1, hasTouch:w<1250, isMobile:w<1250 });
const page = await ctx.newPage();
await seedPlayedAccount(page, ORIGIN);
if (pct !== 100) { await page.goto(`${ORIGIN}/?nointro#a11y`, {waitUntil:"networkidle"}); await page.waitForTimeout(900); await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click(); await page.waitForTimeout(400); }
await page.goto(`${ORIGIN}/?nointro#${route}`, {waitUntil:"networkidle"});
await page.waitForTimeout(Number(a("wait","2600")));
await page.screenshot({ path: path.join(dir, `${out}.png`) });
console.log(path.join(dir, `${out}.png`));
await browser.close();
