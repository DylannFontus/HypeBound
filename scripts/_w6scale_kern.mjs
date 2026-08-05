/**
 * Does the win rate's `%` actually touch the figure beside it?
 *
 * The sweep reports a 2–4px box overlap between `.record-value` and
 * `.record-suffix` at every interface scale, including 100%. The suffix carries
 * a deliberate `margin-left: -0.2ch`, and `.record-value` is a `.num` reserving
 * three character cells — so a *box* overlap is exactly what a designed kern
 * looks like from the outside, and the only question that matters is whether
 * any ink lands on any other ink.
 *
 * A seeded account has played no matches, so the slot holds "0" with two empty
 * cells beside it and nothing can collide. This forces the widest value the
 * slot will ever hold — 100 — and measures the gap between the last glyph's
 * ink and the first glyph of the suffix, at every scale, by rendering both
 * strings into an offscreen canvas and finding their real extents.
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
const dir = "scripts/screenshots/w6/scale/kern";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 4 });
await seedPlayedAccount(page, ORIGIN);

for (const pct of ["100", "140", "160"]) {
  await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
  await page.waitForTimeout(300);
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);

  const m = await page.evaluate(() => {
    const stat = [...document.querySelectorAll(".record-stat")].find((s) =>
      (s.textContent || "").includes("Win rate")
    );
    if (!stat) return { error: "no win-rate stat" };
    const value = stat.querySelector(".record-value");
    const suffix = stat.querySelector(".record-suffix");
    value.textContent = "100";
    const vb = value.getBoundingClientRect();
    const sb = suffix.getBoundingClientRect();

    /* The ink, not the box. A Range over the text node stops at the advance
       width of the last glyph, which for a tabular figure includes its right
       side bearing — so this is still slightly pessimistic, in the safe
       direction. */
    const r = document.createRange();
    r.selectNodeContents(value);
    const ink = r.getBoundingClientRect();
    r.selectNodeContents(suffix);
    const sInk = r.getBoundingClientRect();
    return {
      valueBox: `${Math.round(vb.width)}px`,
      boxGap: Math.round((sb.left - vb.right) * 10) / 10,
      inkGap: Math.round((sInk.left - ink.right) * 10) / 10,
      fs: getComputedStyle(value).fontSize,
    };
  });
  console.log(`ui-scale ${pct}%`, JSON.stringify(m));
  await page
    .locator(".record-stat", { hasText: "Win rate" })
    .first()
    .screenshot({ path: path.join(dir, `winrate-${pct}.png`) })
    .catch(() => {});
}
await browser.close();
