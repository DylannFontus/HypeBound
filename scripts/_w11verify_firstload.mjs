/**
 * What a first-time player downloads before the lobby is usable — measured
 * against the **built** `dist`, not the dev server.
 *
 * This is the only measurement in this pass that can answer the owner's
 * question, and every other one in the repo is taken against `:5173`. Dev
 * serves unminified modules, unbundled, with `no-store` on every encoded image,
 * so a byte total taken there is a number about Vite rather than about the
 * game. `vite preview` serves exactly what GitHub Pages will.
 *
 * Two things it deliberately does:
 *
 * - **It counts `encodedBodySize`, not file size on disk.** Text is served
 *   gzipped and a player pays the compressed weight; images are already
 *   compressed and pay their own. Adding a directory listing to a gzip figure
 *   would overstate the JS by about 1.7 MB.
 * - **It reports a cold cache and then a warm one.** The caching argument in
 *   `vite.config.ts` — that splitting three.js out buys a returning visit
 *   rather than a first one — is a claim with a number attached, and this is
 *   where that number can be checked rather than believed.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const ORIGIN = "http://localhost:4173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const bucket = (url) => {
  if (/\/assets\/art\//.test(url)) return "card art";
  if (/\/assets\/boards\//.test(url)) return "boards";
  if (/\/assets\/icons\//.test(url)) return "icons";
  if (/\/assets\/brand\//.test(url)) return "brand";
  if (/\/assets\/audio\//.test(url)) return "audio";
  if (/\.js(\?|$)/.test(url)) return "JS";
  if (/\.css(\?|$)/.test(url)) return "CSS";
  if (/\.woff2?(\?|$)/.test(url)) return "font";
  if (/\.json(\?|$)/.test(url)) return "data JSON";
  return "other";
};

async function measure(label, settleMs) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  PAGE ERROR:", e.message.slice(0, 160)));
  await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settleMs);

  const rows = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => ({
      name: e.name,
      enc: e.encodedBodySize,
      transfer: e.transferSize,
    }))
  );
  const html = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return nav ? nav.encodedBodySize : 0;
  });

  const totals = new Map([["index.html", { n: 1, bytes: html }]]);
  for (const r of rows) {
    const key = bucket(r.name);
    const e = totals.get(key) ?? { n: 0, bytes: 0 };
    e.n += 1;
    e.bytes += r.enc;
    totals.set(key, e);
  }
  const grand = [...totals.values()].reduce((s, e) => s + e.bytes, 0);

  console.log(`\n${label} — ${rows.length + 1} requests, ${(grand / 1024).toFixed(0)} KB over the wire`);
  for (const [key, e] of [...totals.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`   ${key.padEnd(12)} ${String(e.n).padStart(4)} req  ${(e.bytes / 1024).toFixed(1).padStart(9)} KB`);
  }
  await context.close();
  return grand;
}

const cold = await measure("Cold cache, lobby settled", 9000);

// Warm: same context, second document load, so the HTTP cache is populated.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const warm = await page.evaluate(() => {
  const rows = performance.getEntriesByType("resource");
  return {
    requests: rows.length,
    transferred: rows.reduce((s, e) => s + e.transferSize, 0),
    fromCache: rows.filter((e) => e.transferSize === 0).length,
  };
});
console.log(
  `\nWarm reload — ${warm.requests} requests, ${(warm.transferred / 1024).toFixed(0)} KB transferred, ` +
    `${warm.fromCache} served from cache`
);
console.log(`\nCold total: ${(cold / 1024 / 1024).toFixed(2)} MB`);
await context.close();
await browser.close();
