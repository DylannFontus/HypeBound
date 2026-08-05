/**
 * How wide does each lobby tile's label actually want to be, and how much room
 * does its tile actually have?
 *
 * "Achievements" comes apart at 140% and 160% on a 720p laptop, and the useful
 * question is not "does it wrap" — a screenshot answers that — but *by how
 * much*, because the fix is a cap and a cap needs a number. A Range over the
 * label's own text node gives the width the word wants at the current font
 * size, unaffected by the box that is squeezing it; the tile's content box
 * gives the width it has. The ratio between the two, in container units, is the
 * coefficient the stylesheet needs.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
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

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const size of String(arg("sizes", "1280x720,1600x900,844x390")).split(",")) {
  const [vw, vh] = size.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await seedPlayedAccount(page, ORIGIN);
  for (const pct of String(arg("scales", "80,100,125,140,160")).split(",")) {
    await page.goto(`${ORIGIN}/?nointro#a11y`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.locator("button", { hasText: new RegExp(`^${pct}%$`) }).first().click();
    await page.waitForTimeout(300);
    await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1200);

    const m = await page.evaluate(() => {
      const nav = document.querySelector(".lobby-nav");
      if (!nav) return { error: "no .lobby-nav" };
      const navW = nav.getBoundingClientRect().width;
      const range = document.createRange();
      const rows = [];
      /*
       * The width the label WANTS, which is not the width of the label.
       *
       * The first version of this probe read a Range over the live element,
       * and a Range over an already-wrapped inline returns the union of its
       * line boxes — the width of the longest line, never the width of the
       * word. So it reported "wants 114.4px, has 118.5px" for a label that was
       * visibly in two pieces, and the instrument agreed with the fix while the
       * screenshot disagreed with both. A detached clone at `nowrap` is the
       * only honest answer: nothing is squeezing it, so what it measures is the
       * demand rather than the outcome.
       */
      const ruler = document.createElement("div");
      ruler.style.cssText = "position:fixed;left:-9999px;top:0;white-space:nowrap;visibility:hidden";
      document.body.appendChild(ruler);
      for (const label of document.querySelectorAll(".lobby-nav-label")) {
        const node = label.firstChild;
        if (!node) continue;
        const cs = getComputedStyle(label);
        const probe = document.createElement("span");
        probe.textContent = label.textContent;
        probe.style.cssText = `font:${cs.font};letter-spacing:${cs.letterSpacing};white-space:nowrap`;
        ruler.replaceChildren(probe);
        const want = probe.getBoundingClientRect().width;
        range.selectNodeContents(label);
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
        // the box the label is allowed to occupy: its grid area
        const host = label.parentElement;
        const hcs = getComputedStyle(host);
        const have =
          host.getBoundingClientRect().width -
          Number.parseFloat(hcs.paddingLeft) -
          Number.parseFloat(hcs.paddingRight);
        rows.push({
          text: label.textContent,
          fs: Math.round(Number.parseFloat(cs.fontSize) * 10) / 10,
          want: Math.round(want * 10) / 10,
          have: Math.round(have * 10) / 10,
          box: Math.round(label.getBoundingClientRect().width * 10) / 10,
          hostW: Math.round(host.getBoundingClientRect().width * 10) / 10,
          padX: `${hcs.paddingLeft}/${hcs.paddingRight}`,
          lineWidths: [...range.getClientRects()].map((r) => Math.round(r.width)),
          lines,
          // what the cap would have to be, expressed against the container
          cqi: Math.round((Number.parseFloat(cs.fontSize) * have) / want / navW * 10000) / 100,
          // px of width per px of font size — the constant the cap is derived from
          per: Math.round((want / Number.parseFloat(cs.fontSize)) * 100) / 100,
        });
      }
      ruler.remove();
      const hint = document.querySelector(".lobby-nav-hint");
      return {
        navW: Math.round(navW),
        rootPx: getComputedStyle(document.documentElement).fontSize,
        hintShown: hint ? getComputedStyle(hint).display !== "none" : null,
        worst: rows.filter((r) => r.lines > 1),
        tightest: rows.slice().sort((a, b) => a.cqi - b.cqi)[0],
      };
    });
    console.log(`${size} @${pct}%`, JSON.stringify(m));
  }
  await page.close();
}
await browser.close();
