/**
 * Which way is a surface lit, in numbers rather than in adjectives?
 *
 * The integration critic's charge against the two rails was "one inset instead
 * of four, and the same pale violet hairline on all four edges" — a claim about
 * the *rendered* edge, not about the stylesheet, so it has to be answered with
 * pixels. This reads the four border rows of an element and reports each one as
 * a delta against the element's own face, one pixel further in.
 *
 * A surface lit from 315 degrees reads positive on top and left and negative on
 * bottom and right. `base.css`'s panel reads positive on all four, which is a
 * box lit from four directions at once; that is the number the repair has to
 * move, and "it looks better now" is not an answer to it.
 *
 * Decoding happens in the page through a canvas rather than through a PNG
 * library, which is the house pattern here (`_w4b_lum.mjs`) and avoids adding a
 * dependency to a throwaway instrument. Each edge is averaged across the middle
 * 60% of its own run so a rounded corner cannot contribute, and the face rows
 * are taken four pixels in — clear of the bevel and, on every surface measured
 * here, clear of type as well. Sampling over text is instrument number five in
 * the state doc: it once read 18.5% where the truth was 2.36%.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outDir = "scripts/screenshots/w5/legacy16";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

for (const target of targets) {
  const [route, selector] = target.split("::");
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const box = await page
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) {
    console.log(`${target}: not found`);
    continue;
  }
  const pad = 8;
  const clip = {
    x: Math.max(0, Math.floor(box.x - pad)),
    y: Math.max(0, Math.floor(box.y - pad)),
    width: Math.min(Math.ceil(box.width + pad * 2), 1600 - Math.max(0, Math.floor(box.x - pad))),
    height: Math.min(Math.ceil(box.height + pad * 2), 900 - Math.max(0, Math.floor(box.y - pad))),
  };
  const shot = await page.screenshot({ clip });
  const source = `data:image/png;base64,${shot.toString("base64")}`;

  const result = await page.evaluate(
    async ([src, ox, oy, w, h, zoom, cropSize]) => {
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
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const at = (x, y) => {
        const i = (clamp(y, 0, c.height - 1) * c.width + clamp(x, 0, c.width - 1)) * 4;
        return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      };
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const xs = [];
      for (let x = ox + Math.round(w * 0.2); x < ox + Math.round(w * 0.8); x += 1) xs.push(x);
      const ys = [];
      for (let y = oy + Math.round(h * 0.2); y < oy + Math.round(h * 0.8); y += 1) ys.push(y);
      const row = (y) => mean(xs.map((x) => at(x, y)));
      const col = (x) => mean(ys.map((y) => at(x, y)));

      // A 6x crop of the top-left corner, which is where the two treatments
      // differ most and where the critic took the original comparison.
      const crop = document.createElement("canvas");
      crop.width = cropSize * zoom;
      crop.height = cropSize * zoom;
      const cc = crop.getContext("2d");
      cc.imageSmoothingEnabled = false;
      cc.drawImage(c, ox - 3, oy - 3, cropSize, cropSize, 0, 0, crop.width, crop.height);

      return {
        top: row(oy),
        left: col(ox),
        bottom: row(oy + h - 1),
        right: col(ox + w - 1),
        faceTop: row(oy + 4),
        faceLeft: col(ox + 4),
        faceBottom: row(oy + h - 5),
        faceRight: col(ox + w - 5),
        crop: crop.toDataURL("image/png"),
      };
    },
    [
      source,
      Math.round(box.x) - clip.x,
      Math.round(box.y) - clip.y,
      Math.round(box.width),
      Math.round(box.height),
      6,
      28,
    ]
  );

  const f = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);
  console.log(
    `${route} ${selector}  ${Math.round(box.width)}x${Math.round(box.height)}\n` +
      `   top    edge ${result.top.toFixed(1)}  face ${result.faceTop.toFixed(1)}  ${f(result.top - result.faceTop)}\n` +
      `   left   edge ${result.left.toFixed(1)}  face ${result.faceLeft.toFixed(1)}  ${f(result.left - result.faceLeft)}\n` +
      `   bottom edge ${result.bottom.toFixed(1)}  face ${result.faceBottom.toFixed(1)}  ${f(
        result.bottom - result.faceBottom
      )}\n` +
      `   right  edge ${result.right.toFixed(1)}  face ${result.faceRight.toFixed(1)}  ${f(
        result.right - result.faceRight
      )}`
  );
  const name = `${outDir}/Z-${route}-${selector.replace(/[^a-z0-9]+/gi, "")}.png`;
  writeFileSync(name, Buffer.from(result.crop.split(",")[1], "base64"));
  console.log(`   corner 6x -> ${name}`);
}
await browser.close();
