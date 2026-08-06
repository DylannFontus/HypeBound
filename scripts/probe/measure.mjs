/**
 * Ask the page for the box of a selector, instead of counting pixels in a PNG.
 *
 *   node scripts/probe/measure.mjs replays ".replay-body" ".replay-stage"
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2];
const sels = process.argv.slice(3);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const zoomFlag = process.argv.indexOf("--zoom");
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: zoomFlag === -1 ? 1 : Number(process.argv[zoomFlag + 1]),
});
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto(`http://localhost:5173/#${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

/**
 * `--rect x,y,w,h out.png` — photograph a *region*, blown up.
 *
 * `shot.mjs --clip` takes a selector, which cannot see the one thing a scrollbar
 * argument is about: ten pixels of chrome at the right edge of the window, which
 * no element owns. At scale 4 a scrollbar button is 40px across and the question
 * answers itself.
 */
const rectFlag = process.argv.indexOf("--rect");
if (rectFlag !== -1) {
  const [x, y, w, h] = process.argv[rectFlag + 1].split(",").map(Number);
  const out = process.argv[rectFlag + 2];
  await page.screenshot({ path: out, clip: { x, y, width: w, height: h }, scale: "device" });
  console.log(out);
  await browser.close();
  process.exit(0);
}

/** `--at x,y` — what is painted at this point, and what element owns it. */
const atFlag = process.argv.indexOf("--at");
if (atFlag !== -1) {
  const [x, y] = process.argv[atFlag + 1].split(",").map(Number);
  console.log(
    await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py);
        const chain = [];
        for (let n = el; n && chain.length < 6; n = n.parentElement) {
          const r = n.getBoundingClientRect();
          chain.push(`${n.tagName}.${String(n.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return chain.join("\n  ");
      },
      [x, y]
    )
  );
  await browser.close();
  process.exit(0);
}

const rows = await page.evaluate((list) => {
  return list.map((s) => {
    const el = document.querySelector(s);
    if (!el) return `${s}  MISSING`;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return `${s}  ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}  display=${
      c.display
    }  max-width=${c.maxWidth}  padding=${c.padding}  margin=${c.margin}  cols=${c.gridTemplateColumns}`;
  });
}, sels);

console.log(rows.join("\n"));
await browser.close();
