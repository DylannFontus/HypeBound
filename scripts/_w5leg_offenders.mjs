/**
 * Which element, exactly, is the census counting?
 *
 * `_ic_census.mjs` returns two numbers per route and no names, which is enough
 * to know a route is wrong and not enough to fix it. This prints the offenders
 * themselves — tag, class list, rect and the computed fill — so a builder can
 * go straight to the line that declares them instead of guessing from a count.
 *
 * It deliberately re-implements the census's two predicates verbatim rather
 * than importing them: if the two ever disagree, the disagreement is the bug,
 * and a shared helper would hide it.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const routes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wait = Number(process.argv.find((a) => a.startsWith("--wait="))?.slice(7) ?? 1100);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

for (const r of routes) {
  await page.goto(`${ORIGIN}/?nointro#${r}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(wait);
  const found = await page.evaluate(() => {
    const s = document.querySelector(".screen");
    if (!s) return { plain: [], flat: [] };
    const all = [...s.querySelectorAll("*")];
    const big = all.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 120 && b.height > 60;
    });
    const describe = (e) => {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return {
        sel: `${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join(".")}`,
        size: `${Math.round(b.width)}x${Math.round(b.height)}`,
        bg: cs.backgroundColor,
        img: cs.backgroundImage === "none" ? "none" : `${cs.backgroundImage.slice(0, 42)}…`,
        radius: cs.borderRadius,
        border: cs.borderColor,
      };
    };
    const plain = big
      .filter((e) => /\bpanel\b/.test(String(e.className)) && !/\bmat-/.test(String(e.className)))
      .map(describe);
    const flat = [];
    for (const e of big) {
      const cs = getComputedStyle(e);
      if (cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent") continue;
      if (cs.backgroundImage !== "none") continue;
      if (cs.boxShadow !== "none") continue;
      flat.push(describe(e));
    }
    return { plain, flat };
  });
  console.log(`\n=== ${r} ===`);
  for (const p of found.plain) console.log("  PLAIN", JSON.stringify(p));
  for (const f of found.flat) console.log("  FLAT ", JSON.stringify(f));
  if (found.plain.length === 0 && found.flat.length === 0) console.log("  clean");
}
await browser.close();
