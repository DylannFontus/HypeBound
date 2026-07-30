/**
 * Renders a strip of cards to a PNG so the card layout can be reviewed.
 * Useful when iterating on the frame design or checking new art.
 *
 * Usage: node scripts/preview-cards.mjs [cardId ...]
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const BASE = "http://localhost:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ids = process.argv.slice(2);
const cardIds = ids.length
  ? ids
  : [
      "idols-lumi-starcall", // has real art on disk
      "idols-encore-diva",
      "goth-crypt-usher",
      "after-designated-driver",
      "neutral-block-button",
      "idols-arena-tour",
    ];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1700, height: 760 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.hypebound !== undefined, null, { timeout: 15000 });

// give art loading a moment, then render each card into a strip
await page.evaluate((list) => {
  for (const id of list) if (window.hypebound.content.cards[id]) window.hypebound.previewCard(id, 100);
  document.querySelectorAll("div[style*='z-index:9999']").forEach((n) => n.remove());
}, cardIds);
await page.waitForTimeout(1500);

const missing = await page.evaluate((list) => {
  const strip = document.createElement("div");
  strip.id = "card-strip";
  strip.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;gap:18px;align-items:center;justify-content:center;background:#0b0614;padding:24px";
  const absent = [];
  for (const id of list) {
    const card = window.hypebound.content.cards[id];
    if (!card) {
      absent.push(id);
      continue;
    }
    strip.appendChild(window.hypebound.renderCardCanvas(card, 260));
  }
  document.body.appendChild(strip);
  return absent;
}, cardIds).catch(async () => {
  // renderCardCanvas is not exposed; fall back to previewCard one at a time
  return null;
});

if (missing === null) {
  // fallback path: screenshot each card individually
  for (const id of cardIds) {
    const ok = await page.evaluate((cardId) => {
      const existing = document.getElementById("single-preview");
      if (existing) existing.remove();
      if (!window.hypebound.content.cards[cardId]) return false;
      const canvas = window.hypebound.previewCard(cardId, 380);
      canvas.parentElement.id = "single-preview";
      return true;
    }, id);
    if (!ok) {
      console.log(`skip (unknown card): ${id}`);
      continue;
    }
    await page.waitForTimeout(900);
    const out = path.join(HERE, "screenshots", `card-${id}.png`);
    await page.locator("#single-preview canvas").screenshot({ path: out });
    console.log(`wrote ${out}`);
  }
} else {
  if (missing.length) console.log("unknown cards:", missing.join(", "));
  await page.waitForTimeout(800);
  const out = path.join(HERE, "screenshots", "card-strip.png");
  await page.locator("#card-strip").screenshot({ path: out });
  console.log(`wrote ${out}`);
}

await browser.close();
