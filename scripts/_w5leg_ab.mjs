/**
 * The same element, both ways, in the same frame of the same page.
 *
 * Measuring the repair against a screenshot taken before it is a comparison
 * across two boots, two layouts and two scroll positions, and the rails are
 * 795px tall so a two-pixel shift moves every sample. Instead this loads the
 * route once and swaps the surface class on the live element — `.panel`, then
 * `.mat-panel` — reading the four edges each time. Nothing else about the page
 * changes between the two reads, so the difference is the material and only the
 * material.
 *
 *   node scripts/_w5leg_ab.mjs collection::.filter-rail deckbuilder::.builder-side
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const targets = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

async function edges(box) {
  const pad = 8;
  const clip = {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.min(Math.ceil(box.width + pad * 2), 1600 - Math.max(0, Math.floor(box.x - pad))),
    height: Math.min(Math.ceil(box.height + pad * 2), 900 - Math.max(0, Math.floor(box.y - pad))),
  };
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ([src, ox, oy, w, h]) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const at = (x, y) => {
        const i = (cl(y, 0, c.height - 1) * c.width + cl(x, 0, c.width - 1)) * 4;
        return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      };
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const xs = [];
      for (let x = ox + Math.round(w * 0.2); x < ox + Math.round(w * 0.8); x += 1) xs.push(x);
      const ys = [];
      for (let y = oy + Math.round(h * 0.2); y < oy + Math.round(h * 0.8); y += 1) ys.push(y);
      const row = (y) => mean(xs.map((x) => at(x, y)));
      const col = (x) => mean(ys.map((y) => at(x, y)));
      return {
        top: row(oy) - row(oy + 4),
        left: col(ox) - col(ox + 4),
        bottom: row(oy + h - 1) - row(oy + h - 5),
        right: col(ox + w - 1) - col(ox + w - 5),
      };
    },
    [
      `data:image/png;base64,${shot.toString("base64")}`,
      Math.round(box.x) - clip.x,
      Math.round(box.y) - clip.y,
      Math.round(box.width),
      Math.round(box.height),
    ]
  );
}

const f = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

for (const target of targets) {
  const [route, selector] = target.split("::");
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const el = page.locator(selector).first();
  const box = await el.boundingBox().catch(() => null);
  if (!box) {
    console.log(`${target}: not found`);
    continue;
  }
  const bare = selector.replace(/^\./, "");
  const rows = [];
  for (const surface of ["panel", "mat-panel"]) {
    await page.evaluate(
      ([sel, cls, keep]) => {
        const node = document.querySelector(sel);
        node.className = `${keep} ${cls}`;
      },
      [selector, surface, bare]
    );
    // one frame for style and paint, then a beat for the sheen band's phase to
    // stop mattering — the band is 40% of the plate wide and never reaches an
    // edge column, so it cannot bias the reading either way, but a settled
    // frame is cheaper to argue about than a lucky one
    await page.waitForTimeout(420);
    rows.push([surface, await edges(box)]);
  }
  console.log(`\n${route} ${selector}  ${Math.round(box.width)}x${Math.round(box.height)}`);
  console.log("   surface      top     left   bottom    right");
  for (const [name, e] of rows) {
    console.log(
      `   ${name.padEnd(11)} ${f(e.top).padStart(6)} ${f(e.left).padStart(7)} ${f(e.bottom).padStart(7)} ${f(
        e.right
      ).padStart(8)}`
    );
  }
}
await browser.close();
