/**
 * Put two images side by side, blind, and record which is which.
 *
 * A critic who knows which screenshot is the new one is not judging the
 * screenshot, they are judging the effort. So the comparison is dealt face down:
 * this composites two images into a single labelled A | B sheet, decides which
 * side each one lands on from a *seed* rather than from the argument order, and
 * writes the answer to a key file the judge is never shown.
 *
 *   node scripts/ab.mjs before.png after.png --out intro-ab --seed 7
 *     -> screenshots/review/intro-ab.png   (the sheet: give this to the judge)
 *     -> screenshots/review/intro-ab.key.json  (the answer: do NOT show the judge)
 *
 * Then:
 *   node scripts/ab.mjs --reveal intro-ab --pick A
 *     -> prints which contender the judge actually chose
 *
 * ## Why a seed rather than randomness
 *
 * The workflow layer forbids `Math.random()` because it would make a run
 * unresumable. A seed passed in from outside keeps the assignment unpredictable
 * to the judge while keeping the whole thing reproducible — rerun the same
 * command and you get the same sheet, which matters when a judge's verdict has
 * to be re-examined later.
 *
 * ## Compositing without a new dependency
 *
 * There is no image library in this project and there is not going to be one.
 * Chrome is already here for the screenshot harness and it is a perfectly good
 * compositor: two <img> in a flex row, screenshot the page. Costs nothing and
 * adds nothing to package.json.
 *
 * ## The wrapper has to be `max-content` too, and this one cost a review
 *
 * `.sheet` was `width: max-content` but `#wrap` around it was not, so the wrapper
 * stayed at the 800px starting viewport while its child overflowed to 3,204px.
 * `boundingBox()` reports the wrapper's *layout* box and knows nothing about the
 * overflow, so the viewport was resized to 800 and the element screenshot cropped
 * to the left-hand eighth of contender A. Side B was never in the file. Nothing
 * errored: the sheet was a valid PNG of a plausible screenshot, and a judge shown
 * one has no way to tell that the comparison they were asked to make is not in
 * the picture. Every sheet built from two 1600x900 captures had this shape.
 */

import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REVIEW = path.join(HERE, "screenshots", "review");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

// --- reveal mode --------------------------------------------------------------

if (argv.includes("--reveal")) {
  const name = String(flag("reveal"));
  const pick = String(flag("pick", "")).toUpperCase();
  const keyFile = path.join(REVIEW, `${name}.key.json`);
  if (!existsSync(keyFile)) {
    console.error(`no key for "${name}" at ${keyFile}`);
    process.exit(1);
  }
  const key = JSON.parse(readFileSync(keyFile, "utf8"));
  if (pick !== "A" && pick !== "B") {
    console.log(JSON.stringify(key, null, 2));
    process.exit(0);
  }
  const chosen = pick === "A" ? key.A : key.B;
  const other = pick === "A" ? key.B : key.A;
  console.log(`judge picked ${pick}`);
  console.log(`  ${pick} was: ${chosen}`);
  console.log(`  the other was: ${other}`);
  console.log(`WINNER: ${chosen}`);
  process.exit(0);
}

// --- compose mode -------------------------------------------------------------

const [left, right] = argv.filter((a) => !a.startsWith("--") && /\.(png|jpe?g|webp)$/i.test(a));
if (!left || !right) {
  console.error("usage: node scripts/ab.mjs <imageA> <imageB> --out <name> [--seed n] [--label 'question']");
  process.exit(1);
}
for (const f of [left, right]) {
  if (!existsSync(f)) {
    console.error(`missing image: ${f}`);
    process.exit(1);
  }
}

const outName = String(flag("out", "ab"));
const seed = Number(flag("seed", 0));
const caption = flag("label", null);
const stacked = argv.includes("--stacked");

/**
 * Swap on an odd seed. Trivial, and that is the point — the judge never sees the
 * seed, so a one-bit decision is as unguessable as a good hash would be, and it
 * stays legible to whoever reads the key afterwards.
 */
const swap = seed % 2 === 1;
const sideA = swap ? right : left;
const sideB = swap ? left : right;

mkdirSync(REVIEW, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});

/**
 * Sized from the images themselves so nothing is downscaled into uselessness.
 * A judge asked to spot a 2px bevel on a thumbnail will always say "looks fine".
 */
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

/**
 * Inlined as data URIs rather than referenced by `file://`.
 *
 * A page built with `setContent` has an opaque origin, and Chrome refuses to
 * load `file://` subresources into one — the images simply never arrive and the
 * only symptom is that the wait for `naturalWidth` times out. Base64 costs a
 * third more bytes over the CDP pipe and is immune to the whole question.
 */
const dataUri = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${readFileSync(file).toString("base64")}`;
};

const html = `
<style>
  html, body { margin: 0; background: #101014; }
  #wrap { width: max-content; }
  .sheet { display: flex; flex-direction: ${stacked ? "column" : "row"}; gap: 0; width: max-content; }
  .cell { position: relative; display: block; }
  .cell img { display: block; max-width: none; }
  .tag {
    position: absolute; top: 14px; left: 14px;
    font: 700 26px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: 0.06em;
    color: #fff; background: rgba(0,0,0,0.72); padding: 8px 16px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.28);
  }
  .divider { width: ${stacked ? "auto" : "4px"}; height: ${stacked ? "4px" : "auto"}; background: #101014; }
  .caption {
    font: 600 20px/1.4 "Segoe UI", system-ui, sans-serif; color: #e8e4ff;
    padding: 16px 20px; background: #101014; text-align: center;
  }
</style>
<div id="wrap">
  ${caption ? `<div class="caption">${caption}</div>` : ""}
  <div class="sheet">
    <div class="cell"><img src="${dataUri(sideA)}"><div class="tag">A</div></div>
    <div class="divider"></div>
    <div class="cell"><img src="${dataUri(sideB)}"><div class="tag">B</div></div>
  </div>
</div>`;

await page.setContent(html);
await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));

const box = await page.locator("#wrap").boundingBox();
await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });

const sheet = path.join(REVIEW, `${outName}.png`);
await page.locator("#wrap").screenshot({ path: sheet });
await browser.close();

const keyFile = path.join(REVIEW, `${outName}.key.json`);
writeFileSync(keyFile, JSON.stringify({ A: sideA, B: sideB, seed, swapped: swap }, null, 2));

console.log(sheet);
console.log(`key written to ${keyFile} — do not show this to the judge`);
