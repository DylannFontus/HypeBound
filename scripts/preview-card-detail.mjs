/**
 * The gallery's card detail, in a real browser.
 *
 * A layout change is the one kind of work that unit tests cannot judge at all,
 * so this opens the collection, clicks a card, and photographs both tabs. It
 * also checks the two things about the view that are behaviour rather than
 * looks: the tabs swap the panel, and the arrows walk the filtered grid.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "screenshots");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

let failures = 0;
const fail = (m) => {
  console.log(`   FAIL: ${m}`);
  failures += 1;
};
const ok = (m) => console.log(`   ok: ${m}`);

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#collection", { waitUntil: "networkidle" });
await page.waitForSelector(".card-cell", { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });

// search for the one card with written lore, so the Story tab shows real prose
await page.fill("#col-search", "Trailhead Novice");
await page.waitForFunction(() => document.querySelectorAll(".card-cell").length === 1, null, { timeout: 10000 });
await page.click(".card-cell");
await page.waitForSelector(".cd-stage", { timeout: 10000 });
await page.waitForTimeout(500);

const name = await page.textContent(".cd-name");
if (name?.trim() === "Trailhead Novice") ok(`opened ${name.trim()}`);
else fail(`expected Trailhead Novice, got ${name}`);

// -- Effect tab -------------------------------------------------------------
const statCount = await page.locator(".cd-stat").count();
if (statCount >= 4) ok(`effect tab shows ${statCount} stat rows`);
else fail(`effect tab shows only ${statCount} stat rows`);
await page.screenshot({ path: path.join(OUT, "card-detail-effect.png") });

// -- Story tab --------------------------------------------------------------
await page.click(".cd-tabs .cd-tab:nth-child(1)");
await page.waitForSelector(".cd-lore-title", { timeout: 5000 });
const loreTitle = await page.textContent(".cd-lore-title");
const loreBody = await page.textContent(".cd-lore-body");
const loreQuote = await page.textContent(".cd-lore-quote");
if (loreTitle?.trim() === "Week One") ok("story tab reads TITLE: from lore.txt");
else fail(`story tab title was ${loreTitle}`);
if (loreBody?.includes("complained about the incline")) ok("story tab reads the written prose");
else fail("story tab did not show the written prose");
if (loreQuote?.includes("drainage")) ok("a written quote overrides the printed flavour");
else fail(`quote was ${loreQuote}`);

/** The underline has to follow the panel, or the screen lies about where you are. */
const activeTab = await page.$$eval(".cd-tab.active", (els) => els.map((e) => e.textContent?.trim()));
if (activeTab.length === 1 && activeTab[0] === "Story") ok("the Story tab is the one marked active");
else fail(`active tabs were ${JSON.stringify(activeTab)} while the Story panel was showing`);

/** …and the underline has to be under the tab that is active, not beside it. */
const tabGeometry = await page.$$eval(".cd-tab", (els) =>
  els.map((el) => ({
    text: el.textContent?.trim(),
    active: el.classList.contains("active"),
    lit: getComputedStyle(el).borderBottomColor,
    x: Math.round(el.getBoundingClientRect().x),
  }))
);
/**
 * Checked as pixels rather than as a class name, because it once passed on the
 * class and was wrong on screen: the underline is a transitioned border, and a
 * transition that never advances leaves the mark on the tab you just left.
 */
const litTabs = tabGeometry.filter((t) => t.lit !== "rgba(0, 0, 0, 0)" && !t.lit.includes("transparent"));
if (litTabs.length === 1 && litTabs[0].text === "Story" && litTabs[0].active) {
  ok(`the underline is drawn under Story (x=${litTabs[0].x})`);
} else {
  fail(`underline was on ${JSON.stringify(litTabs.map((t) => t.text))} while the Story panel was showing`);
}

/**
 * The card leans, and it leans to the right: its left edge is nearer the viewer
 * and its right edge recedes. Checked by pushing the two edge midpoints through
 * the real matrix rather than by reading the angle back, because the sign of a
 * CSS rotateY is easy to reason about backwards and the depth never is.
 */
const lean = await page.$eval(".cd-tilt", (el) => {
  const m = new DOMMatrix(getComputedStyle(el).transform);
  if (m.is2D) return null;
  return { left: m.transformPoint(new DOMPoint(-100, 0, 0)).z, right: m.transformPoint(new DOMPoint(100, 0, 0)).z };
});
if (!lean) fail("the card is not rendered in 3D");
else if (lean.left > lean.right) ok("the card faces right — its left edge is nearer the viewer");
else fail(`the card faces left: left edge z=${lean.left.toFixed(1)}, right edge z=${lean.right.toFixed(1)}`);
await page.screenshot({ path: path.join(OUT, "card-detail-story.png") });

// -- an unwritten card falls back -------------------------------------------
await page.keyboard.press("Escape");
await page.fill("#col-search", "Phone Basket");
await page.waitForFunction(() => document.querySelectorAll(".card-cell").length >= 1, null, { timeout: 10000 });
await page.click(".card-cell");
await page.waitForSelector(".cd-stage", { timeout: 10000 });
await page.waitForTimeout(300);
const emptyBody = await page.textContent(".cd-lore-body");
const hint = await page.locator(".cd-lore-hint").count();
if (emptyBody?.includes("No lore written")) ok("an unwritten card shows the placeholder");
else fail(`unwritten card showed: ${emptyBody}`);
if (hint === 1) ok("and says where to write it");
else fail("no hint shown for an unwritten card");
const fallbackQuote = await page.textContent(".cd-lore-quote");
if (fallbackQuote?.includes("Everyone complies")) ok("and still shows the card's printed flavour");
else fail(`fallback quote was ${fallbackQuote}`);
await page.screenshot({ path: path.join(OUT, "card-detail-unwritten.png") });

// -- arrows walk the filtered grid ------------------------------------------
await page.keyboard.press("Escape");
await page.fill("#col-search", "");
await page.waitForFunction(() => document.querySelectorAll(".card-cell").length > 5, null, { timeout: 10000 });
await page.click(".card-cell");
await page.waitForSelector(".cd-stage", { timeout: 10000 });
const first = (await page.textContent(".cd-name"))?.trim();
const prevDisabled = await page.locator(".cd-arrow-prev").isDisabled();
if (prevDisabled) ok("the first card has no previous");
else fail("previous was enabled on the first card");
await page.click(".cd-arrow-next");
await page.waitForTimeout(250);
const second = (await page.textContent(".cd-name"))?.trim();
if (second && second !== first) ok(`next walks the grid: ${first} → ${second}`);
else fail("next did not change the card");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(250);
const back = (await page.textContent(".cd-name"))?.trim();
if (back === first) ok("left arrow key walks back");
else fail(`arrow key returned ${back}, expected ${first}`);

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(failures === 0 ? "\nCARD DETAIL OK" : `\n${failures} failure(s)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
