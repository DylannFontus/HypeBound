/**
 * Renders one leader medallion per Current to a PNG.
 *
 * The rim profile is the Current's colourblind signal, so the check this is
 * for is whether the eight silhouettes stay separable with colour ignored.
 *
 * Usage: node scripts/preview-leaders.mjs [--mono] [leaderId ...]
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const args = process.argv.slice(2);
const mono = args.includes("--mono");
const ids = args.filter((a) => !a.startsWith("--"));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1700, height: 820 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.hypebound !== undefined, null, { timeout: 15000 });

const chosen = await page.evaluate(
  ([list, greyscale]) => {
    const picked = window.hypebound.previewLeaders(300, list.length ? list : undefined);
    if (greyscale) document.getElementById("leader-strip").style.filter = "grayscale(1)";
    return picked;
  },
  [ids, mono]
);

await page.waitForTimeout(1400); // let any art load and repaint
const out = path.join(HERE, "screenshots", mono ? "leaders-mono.png" : "leaders.png");
await page.locator("#leader-strip").screenshot({ path: out });
console.log(`wrote ${out}`);
console.log(`leaders: ${chosen.join(", ")}`);

await browser.close();
