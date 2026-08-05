/**
 * The two states where another owner's rule still replaces the material's cast.
 *
 * `.mat-panel` publishes its bevel as `box-shadow: var(--mat-cast)`, which is
 * one declaration — so any rule that writes `box-shadow` on the same element
 * replaces the whole bevel rather than adding to it. Two such rules exist in
 * `collectionKit.ts`, which is not this builder's file: the filter rail's
 * drawer cast below 900px, and the deck rail's drop-target highlight. Both were
 * written against `base.css`'s panel, where there was no inset bevel to lose.
 *
 * This prints what each state actually computes to, so the loss is a number in
 * a report rather than a thing somebody notices in three weeks.
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

const shadow = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return "absent";
    const cs = getComputedStyle(e);
    const insets = (cs.boxShadow.match(/inset/g) ?? []).length;
    return `${insets} inset layer(s); border ${cs.borderTopColor} / ${cs.borderBottomColor}`;
  }, sel);

// 1. the filter rail as a wide-window panel, then as a phone drawer
for (const [label, w, h] of [
  ["collection 1600x900", 1600, 900],
  ["collection 844x390 drawer", 844, 390],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#collection`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (w < 900) {
    await page.locator("#col-filter-open").click().catch(() => {});
    await page.waitForTimeout(600);
  }
  console.log(`${label.padEnd(28)} .filter-rail  ${await shadow(page, ".filter-rail")}`);
  await page.close();
}

// 2. the deck rail at rest and while a card is over it
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#deckbuilder`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  console.log(`${"deckbuilder rest".padEnd(28)} .builder-side ${await shadow(page, ".builder-side")}`);
  for (const cls of ["hb-drop-live", "hb-drop-over"]) {
    await page.evaluate((c) => document.querySelector(".builder-side")?.classList.add(c), cls);
    await page.waitForTimeout(200);
    console.log(`${`deckbuilder ${cls}`.padEnd(28)} .builder-side ${await shadow(page, ".builder-side")}`);
    await page.evaluate((c) => document.querySelector(".builder-side")?.classList.remove(c), cls);
  }
  await page.close();
}
await browser.close();
