/** Ad-hoc probe: run arbitrary page.evaluate against a route after it settles. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "collection";
const expr = process.argv[3] ?? "return 1";
const size = (process.argv[4] ?? "1600x900").split("x").map(Number);
const wait = Number(process.argv[5] ?? 2200);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
for (let i = 0; i < 5; i++) {
  try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); }
}
await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(wait);
const out = await page.evaluate(`(async () => { ${expr} })()`);
console.log(JSON.stringify(out, null, 2));
const shot = process.argv[6];
if (shot) {
  await page.waitForTimeout(Number(process.argv[7] ?? 900));
  await page.screenshot({ path: `scripts/screenshots/w2/collection/${shot}.png` });
  console.log(`scripts/screenshots/w2/collection/${shot}.png`);
}
await browser.close();
