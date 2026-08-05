/**
 * One question: why does the Merch Drops pack ignore its own `max-height: 100%`
 * at 160% on a 720p window, and paint itself over the pity meter?
 *
 * `rewardsTheme.ts` carries a long note saying that exact defect was fixed at
 * 140%. It was not fixed at 160%, and this prints the computed values so the
 * repair is aimed at the cause rather than at the symptom.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^160%$/ }).first().click();
await page.waitForTimeout(300);
await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const hero = document.querySelector(".rw-shop-hero");
      const row = document.querySelector(".rw-shop-pack");
      const pack = document.querySelector(".rw-pack-still");
      const rcs = getComputedStyle(row);
      const pcs = getComputedStyle(pack);
      return {
        heroRows: getComputedStyle(hero).gridTemplateRows,
        heroH: hero.getBoundingClientRect().height,
        rowH: row.getBoundingClientRect().height,
        rowClient: row.clientHeight,
        rowDisplay: rcs.display,
        rowAlign: rcs.alignItems,
        rowMinH: rcs.minHeight,
        rowPad: rcs.padding,
        packH: pack.getBoundingClientRect().height,
        packHeight: pcs.height,
        packMaxH: pcs.maxHeight,
        packAspect: pcs.aspectRatio,
        packWidth: pcs.width,
        packAlignSelf: pcs.alignSelf,
        artHtml: (document.querySelector(".rw-pack-still .rw-art") || {}).outerHTML?.slice(0, 160) ?? "no .rw-art",
        artBox: (() => {
          const a = document.querySelector(".rw-pack-still .rw-art");
          if (!a) return null;
          const b = a.getBoundingClientRect();
          return `${Math.round(b.width)}x${Math.round(b.height)}`;
        })(),
      };
    }),
    null,
    1
  )
);
await browser.close();
