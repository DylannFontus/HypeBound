/**
 * Name the surfaces the census only counts.
 *
 * "banner: 7 flat fills" is a number a builder cannot act on. This prints the
 * class, the size and the computed fill of every big surface that is either a
 * legacy `.panel` or a §1-banned flat colour with no gradient, no texture and no
 * shadow — so the remaining wiring is a list of elements rather than a tally.
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

for (const r of ["collection", "deckbuilder", "mastery", "events", "news", "inbox", "story", "banner", "privacy", "battle"]) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  if (r === "battle") {
    await page.waitForSelector(".mulligan-panel", { timeout: 30000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count()) await page.click(".mulligan-actions .btn-primary");
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
  }
  await page.waitForTimeout(2200);
  console.log(
    r.padEnd(12),
    JSON.stringify(
      await page.evaluate(() => {
        const root = document.querySelector(".screen") ?? document.body;
        const out = { plain: [], flat: [] };
        for (const e of root.querySelectorAll("*")) {
          const b = e.getBoundingClientRect();
          if (b.width < 120 || b.height < 60) continue;
          const cn = String(e.className);
          const cs = getComputedStyle(e);
          if (/\bpanel\b/.test(cn) && !/\bmat-/.test(cn))
            out.plain.push(`${cn.slice(0, 34)} ${Math.round(b.width)}x${Math.round(b.height)}`);
          const bg = cs.backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && cs.backgroundImage === "none" && cs.boxShadow === "none")
            out.flat.push(`${(cn || e.tagName).slice(0, 34)} ${Math.round(b.width)}x${Math.round(b.height)} ${bg}`);
        }
        return out;
      })
    )
  );
}
await browser.close();
