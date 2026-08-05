/**
 * Where does the pack's base actually sit inside its row?
 *
 * The alcove's floor line has to meet the object standing on it, and the pack
 * is centred in a row whose height changes with the interface scale — so
 * "88% of the row" is a guess that is right on one window and cuts the pack in
 * half on another. This prints the gap between the pack's bottom edge and its
 * row's bottom edge at every combination, which is the only number the
 * stylesheet can safely anchor to.
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

for (const size of ["1280x720", "1600x900", "844x390"]) {
  const [vw, vh] = size.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await seedPlayedAccount(page, ORIGIN);
  for (const pct of ["100", "140", "160"]) {
    await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
    await page.waitForTimeout(300);
    await page.goto(`${ORIGIN}/?nointro#shop`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1400);
    const m = await page.evaluate(() => {
      const row = document.querySelector(".rw-shop-pack");
      const pack = document.querySelector(".rw-pack-still");
      if (!row || !pack) return { error: "no pack" };
      const r = row.getBoundingClientRect();
      const p = pack.getBoundingClientRect();
      const R = (n) => Math.round(n * 10) / 10;
      return {
        row: `${R(r.width)}x${R(r.height)}`,
        pack: `${R(p.width)}x${R(p.height)}`,
        baseGap: R(r.bottom - p.bottom),
        topGap: R(p.top - r.top),
        basePct: R(((p.bottom - r.top) / r.height) * 100),
      };
    });
    console.log(`${size} @${pct}%`, JSON.stringify(m));
  }
  await page.close();
}
await browser.close();
