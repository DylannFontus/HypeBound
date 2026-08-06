/**
 * Open a Merch Drop and photograph the whole set-piece.
 *
 * Rewards went from 3/10 to 7/7 in wave two on the strength of this sequence
 * existing at all, and it is the one moment in the game where the player is
 * meant to feel paid. A still of the shop tells you nothing about it: the pack
 * has to be clicked, torn and walked through card by card, so this drives it and
 * writes a frame at each beat.
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
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const dir = String(arg("dir", "scripts/screenshots/w4/ic3"));
const [vw, vh] = String(arg("size", "1600x900")).split("x").map(Number);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const shot = async (n) => {
  const f = path.join(dir, `${n}.png`);
  await page.screenshot({ path: f });
  console.log(f);
};

await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const open = page.locator("button", { hasText: /Open a free Drop|Open Drop|Open a Drop/ }).first();
await open.click();
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(260);
  await shot(`D${i}-open`);
}
// tear / reveal: keep clicking through
for (let i = 0; i < 7; i++) {
  await page.mouse.click(vw / 2, vh / 2);
  await page.waitForTimeout(650);
  await shot(`D-reveal-${i}`);
}
await browser.close();
