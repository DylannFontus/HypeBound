/**
 * Does a player's browser actually fetch the light file, and how much of the
 * collection has arrived by the time they have looked at it?
 *
 * `verify:art` answers a different question than it appears to. It reads
 * `public/assets/art`, which holds only the PNG masters, and asks a browser to
 * decode each one *by the master's own filename* — so it proves the paintings
 * are sound and proves nothing at all about the format that ships. `dist` has
 * no PNG under `assets/art` at all. The two facts are compatible with the
 * deployed game requesting 296 files that do not exist.
 *
 * So this asks the network log instead of the folder: what did the page request
 * while a player used the Collection, what did each response weigh, and was any
 * of it a fallback to a master that is not in `dist`.
 *
 * The one trap worth naming: **a missing `.webp` on the dev server answers 200
 * with `index.html`**, because the SPA fallback catches anything the asset
 * middleware declines. A checker that trusted the status code would call every
 * miss a hit. This reads the content type and the decoded size of the image the
 * page actually holds, so an HTML body counts as the failure it is.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

/** Every art response, recorded from the wire rather than from the app. */
const art = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!/\/assets\/(art|boards|icons|brand)\//.test(url)) return;
  let bytes = 0;
  try {
    bytes = (await res.body()).length;
  } catch {
    /* redirected or aborted */
  }
  art.push({
    url: url.replace(ORIGIN, ""),
    status: res.status(),
    type: res.headers()["content-type"] ?? "",
    bytes,
  });
});

await seedPlayedAccount(page);
await page.goto(`${ORIGIN}/#collection`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

// Scroll the grid, because a virtualised list only asks for what it shows.
for (let i = 0; i < 8; i++) {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(700);
}
await page.waitForTimeout(2500);

const group = (re) => art.filter((a) => re.test(a.url));
const sum = (list) => list.reduce((s, a) => s + a.bytes, 0);
const report = (label, list) => {
  const html = list.filter((a) => a.type.includes("html"));
  const webp = list.filter((a) => a.type.includes("webp"));
  const png = list.filter((a) => a.type.includes("png"));
  console.log(
    `${label.padEnd(10)} ${String(list.length).padStart(4)} responses  ` +
      `webp ${String(webp.length).padStart(4)} (${(sum(webp) / 1024).toFixed(0)} KB)  ` +
      `png ${String(png.length).padStart(3)} (${(sum(png) / 1024).toFixed(0)} KB)  ` +
      `html-fallback ${html.length}  total ${(sum(list) / 1024).toFixed(0)} KB`
  );
  if (html.length) console.log("   HTML instead of an image: " + html.slice(0, 4).map((h) => h.url).join(", "));
};

console.log("\nwhat the Collection actually pulled off the wire:");
report("art", group(/\/assets\/art\//));
report("icons", group(/\/assets\/icons\//));
report("boards", group(/\/assets\/boards\//));
report("brand", group(/\/assets\/brand\//));

const artOnly = group(/\/assets\/art\//);
if (artOnly.length) {
  const sizes = artOnly.map((a) => a.bytes).sort((a, b) => a - b);
  console.log(
    `\ncard art per file: min ${(sizes[0] / 1024).toFixed(1)} KB  ` +
      `median ${(sizes[Math.floor(sizes.length / 2)] / 1024).toFixed(1)} KB  ` +
      `max ${(sizes[sizes.length - 1] / 1024).toFixed(1)} KB`
  );
}

/** And what the DOM believes it is holding, which is the only proof it painted. */
const painted = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  return {
    cells: q("[class*='card-cell'], .collection-card, .card-tile").length,
    canvases: q("canvas").length,
    // artLoader marks a card once its picture is in memory.
    loadedArt: /** @type {any} */ (window).hypebound?.artLoaded?.() ?? "(no hook)",
  };
});
console.log("\nDOM: " + JSON.stringify(painted));

await browser.close();
