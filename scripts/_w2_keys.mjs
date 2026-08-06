/**
 * The behaviour half of the collection: keyboard reach, the roving tab stop,
 * and the card-detail overlay's close/step contract, which used to register a
 * new window listener on every arrow press and stop closing on backdrop click
 * after the first interaction.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 4; i++) {
  try { await seedPlayedAccount(page); break; } catch { await page.waitForTimeout(700); }
}
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".card-cell", { timeout: 20000 });
await page.waitForTimeout(1600);

let fails = 0;
const ok = (m) => console.log("   ok:", m);
const bad = (m) => { console.log("   FAIL:", m); fails += 1; };

const stops = await page.$$eval(".card-cell[tabindex='0']", (n) => n.length);
stops === 1 ? ok("exactly one tile is a tab stop (roving)") : bad(`${stops} tiles are tab stops`);

await page.focus(".card-cell[tabindex='0']");
const start = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(120);
const right = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
right && right !== start ? ok(`ArrowRight moved: ${start?.split(".")[0]} -> ${right.split(".")[0]}`) : bad("ArrowRight did not move focus");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(120);
const down = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
down && down !== right ? ok(`ArrowDown moved a row: ${down.split(".")[0]}`) : bad("ArrowDown did not move focus");

await page.keyboard.press("Enter");
await page.waitForSelector(".cd-stage", { timeout: 5000 });
ok("Enter opened the detail");

// step ten times: the old code registered a listener per open and fired them all
const names = [];
for (let i = 0; i < 10; i++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(90);
  names.push((await page.textContent(".cd-name"))?.trim());
}
const unique = new Set(names).size;
unique === 10 ? ok(`ten ArrowRights walked ten distinct cards (${names[0]} … ${names[9]})`)
              : bad(`ten ArrowRights produced ${unique} distinct cards: ${names.join(", ")}`);
const position = await page.textContent(".cd-position");
ok(`position indicator reads "${position?.trim()}"`);

// backdrop click, twice, with an interaction in between — the {once:true} bug
await page.click(".cd-tab:nth-child(1)");
await page.waitForTimeout(150);
await page.mouse.click(40, 450);
await page.waitForTimeout(400);
let hidden = await page.$eval("#card-detail", (n) => n.hidden);
hidden ? ok("backdrop click closes after an interaction inside the overlay") : bad("backdrop click did not close the overlay");

await page.click(".card-cell");
await page.waitForSelector(".cd-stage", { timeout: 5000 });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
hidden = await page.$eval("#card-detail", (n) => n.hidden);
hidden ? ok("Escape closes") : bad("Escape did not close");

const focused = await page.evaluate(() => document.activeElement?.className);
focused?.includes("card-cell") ? ok("focus returned to the tile that opened it") : bad(`focus went to ${focused}`);

// the effect panel must render markup, not print it
await page.fill("#col-search", "Anon Poster");
await page.waitForTimeout(600);
await page.click(".card-cell");
await page.waitForSelector(".cd-stage", { timeout: 5000 });
await page.click(".cd-tab:nth-child(2)"); // the Story tab was left selected above
await page.waitForSelector(".cd-effect", { timeout: 5000 });
const effect = await page.$eval(".cd-effect", (n) => ({ text: n.textContent, strong: n.querySelectorAll("strong").length }));
!effect.text.includes("**") && effect.strong > 0
  ? ok(`the effect panel renders its markup (${effect.strong} bold runs, no asterisks)`)
  : bad(`the effect panel printed: ${effect.text}`);

console.log(fails === 0 ? "\nPASS" : `\n${fails} FAILURE(S)`);
await browser.close();
