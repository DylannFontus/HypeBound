/**
 * Is the specular band on a *large* panel a soft sweep or a visible seam?
 *
 * The band is 40% of the plate wide with a `transparent → alpha → transparent`
 * ramp, which is soft on the lobby's 176px tiles and was never measured on the
 * 870px document panels this domain is made of. A 348px-wide ramp on a face at
 * luma 44 can be a perfectly smooth gradient and still show a *Mach band* — the
 * eye finds the second derivative, not the first — so this samples a text-free
 * row across a panel and prints the per-pixel delta rather than trusting a
 * downscaled screenshot.
 *
 * Sample a text-free region: instrument #5 in the state doc is a grain
 * measurement that read 18.5% because its crop sat over button glyphs.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const route = process.argv[2] ?? "a11y";
const selector = process.argv[3] ?? ".policy-controls";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);

const box = await page.locator(selector).first().boundingBox();
if (!box) throw new Error(`no ${selector}`);

// A 4px strip just inside the panel's bottom padding, which on every one of
// these panels is empty plate.
const strip = {
  x: Math.round(box.x + 2),
  y: Math.round(box.y + box.height - 10),
  width: Math.round(box.width - 4),
  height: 4,
};
const shot = await page.screenshot({ clip: strip });
await browser.close();

// Playwright hands back a PNG buffer; a second browser decodes it, because a
// PNG decoder is not worth a dependency and Chrome already has one.
const b2 = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const p2 = await b2.newPage();
const lumas = await p2.evaluate(async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const out = [];
  for (let x = 0; x < img.width; x++) {
    let sum = 0;
    for (let y = 0; y < img.height; y++) {
      const i = (y * img.width + x) * 4;
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    out.push(sum / img.height);
  }
  return out;
}, `data:image/png;base64,${shot.toString("base64")}`);
await b2.close();

let maxStep = 0;
let at = 0;
for (let i = 1; i < lumas.length; i++) {
  const step = Math.abs(lumas[i] - lumas[i - 1]);
  if (step > maxStep) {
    maxStep = step;
    at = i;
  }
}
const min = Math.min(...lumas);
const max = Math.max(...lumas);
console.log(
  JSON.stringify(
    {
      route,
      selector,
      width: lumas.length,
      minLuma: +min.toFixed(2),
      maxLuma: +max.toFixed(2),
      range: +(max - min).toFixed(2),
      biggestSingleStep: +maxStep.toFixed(3),
      atX: at,
      profile: lumas.filter((_, i) => i % Math.max(1, Math.floor(lumas.length / 24)) === 0).map((n) => +n.toFixed(1)),
    },
    null,
    2
  )
);
