/**
 * Photograph a route at a chosen interface scale, optionally clipped to one
 * element. `shot.mjs` cannot do it, because the scale is a *setting* and has to
 * be pressed rather than written — see `_ic3_scale.mjs` for why writing
 * `--ui-scale` onto the root photographs a state the game never enters.
 *
 *   node scripts/_w6scale_shot.mjs deckbuilder 160 --clip ".builder-side"
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const [route, scales] = process.argv.slice(2);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const [vw, vh] = String(arg("size", "1280x720")).split("x").map(Number);
const dir = String(arg("dir", "scripts/screenshots/w6/scale/shots"));
const clip = arg("clip", null);
const tag = String(arg("tag", "now"));
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await seedPlayedAccount(page, ORIGIN);

for (const pct of String(scales).split(",")) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(350);
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const file = path.join(dir, `${route}-${tag}-${pct}-${vw}x${vh}.png`);
  const target = clip ? page.locator(String(clip)).first() : page;
  await target.screenshot({ path: file });
  console.log(file);
}
await browser.close();
