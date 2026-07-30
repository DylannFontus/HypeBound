/**
 * Merch Drops, in a real browser.
 *
 * The algorithm is covered by unit tests against the real card pool. What only a
 * browser can prove is the part the player actually meets: that the odds are on
 * the panel *before* the button, that buying spends exactly the printed price,
 * that five cards turn over, that a duplicate says what it converted into, and
 * that the cards land in the collection.
 *
 * It also checks the one thing a shop must never do — charge for something it
 * did not deliver — by comparing the wallet and the collection across a purchase
 * rather than trusting the screen's own summary.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

const settleOn = async (selector) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });
};
const wallet = () =>
  page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("hypebound:profile") ?? "{}").data ?? {};
    return { clout: p.clout ?? 0, signal: p.shards ?? 0, cards: Object.values(p.collection ?? {}).reduce((a, b) => a + b, 0) };
  });

// --- 0. a brand-new account picks a starting faction -------------------------
/**
 * The first thing a new account meets, and the reason Drops mean anything: an
 * account used to be created holding every card in the game, so a Drop could
 * never grant one. This walks the path from an empty profile to a playable deck.
 */
console.log("\n0. A new account");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("hypebound:profile"));
// reload rather than goto: the URL is identical, so a goto is a same-document
// navigation and the app never re-runs its bootstrap
await page.reload({ waitUntil: "networkidle" });
await settleOn(".starter-screen");
ok("a fresh account is sent to the starter picker, not the lobby");

const options = await page.locator(".starter-option").count();
if (options !== 10) fail(`the picker offered ${options} factions, expected 10`);
else ok("all ten factions are offered");
await page.screenshot({ path: path.join(OUT, "starter-picker.png") });

await page.locator(".starter-option").nth(7).click();
await page.locator("#starter-confirm").click();
await settleOn(".lobby-screen");

const started = await page.evaluate(() => JSON.parse(localStorage.getItem("hypebound:profile")).data);
const ownedCount = Object.values(started.collection).reduce((a, b) => a + b, 0);
if (ownedCount !== 30) fail(`the starter grant gave ${ownedCount} cards, expected a 30-card deck`);
else ok("exactly one 30-card deck was granted");
if (started.decks.length !== 1) fail(`the account has ${started.decks.length} decks`);
else ok(`the deck is ready to play: "${started.decks[0].name}"`);
if (started.pendingDrops !== 5) fail(`the account was owed ${started.pendingDrops} Drops, expected 5`);
else ok("five free Drops came with it");

// --- 1. reaching the counter the way a player does ---------------------------
console.log("\n1. Reaching Merch Drops from the lobby");
await settleOn(".lobby-screen");

const shopButton = page.locator("#lobby-shop");
if ((await shopButton.count()) === 0) fail("no Merch Drops button in the lobby");
else ok("the lobby offers Merch Drops");
await shopButton.click();
await settleOn(".shop-screen");

// give the account enough Clout to open several Drops, the way play would
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("hypebound:profile"));
  raw.data.clout = 5000;
  localStorage.setItem("hypebound:profile", JSON.stringify(raw));
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".shop-screen");

// --- 2. the odds are printed before anything is bought -----------------------
console.log("\n2. What the panel says before the button");
const panel = await page.locator(".shop-body").innerText();
const price = await page.evaluate(() => window.hypeboundShop.price());
for (const claim of ["Common", "Rare", "Epic", "Legendary", "1 Rare or better", "twice in the same Drop"]) {
  if (!panel.includes(claim)) fail(`the panel never mentions "${claim}"`);
}
ok("rarities, the floor and the no-duplicate rule are all printed");

const odds = await page.$$eval(".odds-table tbody tr", (rows) =>
  rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim()))
);
const printedTotal = odds.reduce((sum, [, pct]) => sum + parseFloat(pct ?? "0"), 0);
if (Math.abs(printedTotal - 100) > 0.05) fail(`the printed odds sum to ${printedTotal}%, not 100%`);
else ok(`the printed odds sum to 100% (${odds.map((o) => o.join(" ")).join(", ")})`);

const pityBefore = await page.locator("#shop-pity").innerText();
if (!/\d+ Drops?/.test(pityBefore)) fail(`the pity counter reads "${pityBefore}"`);
else ok(`the Legendary counter is shown: ${pityBefore}`);
await page.screenshot({ path: path.join(OUT, "shop-panel.png") });

// --- 3. buying one, for real -------------------------------------------------
console.log("\n3. Opening a Drop");
// spend the free starter Drops first, so what follows measures a PURCHASE
let owed = await page.evaluate(() => JSON.parse(localStorage.getItem("hypebound:profile")).data.pendingDrops);
let firstNew = 0;
while (owed > 0) {
  await page.evaluate(() => window.hypeboundShop.buy());
  await page.waitForSelector(".shop-reveal:not([hidden])", { timeout: 10000 });
  const free = await page.evaluate(() => window.hypeboundShop.lastDrop());
  firstNew += free.cards.filter((c) => c.isNew).length;
  await page.locator(".reveal-cards").click();
  await page.locator("#reveal-done").click();
  await page.waitForSelector(".shop-reveal", { state: "hidden", timeout: 10000 });
  owed = await page.evaluate(() => JSON.parse(localStorage.getItem("hypebound:profile")).data.pendingDrops);
}
/** The headline: a new account's Drops hand it cards it does not have. */
if (firstNew < 10) fail(`five free Drops granted only ${firstNew} new cards`);
else ok(`the five starter Drops granted ${firstNew} cards the account did not own`);

const before = await wallet();
await page.locator("#shop-buy").click();
await page.waitForSelector(".shop-reveal:not([hidden])", { timeout: 10000 });

const slots = await page.locator(".reveal-slot").count();
if (slots !== 5) fail(`the reveal showed ${slots} cards, expected 5`);
else ok("five cards in the Drop");

// a click turns everything still face down
await page.locator(".reveal-cards").click();
await page.waitForFunction(() => document.querySelectorAll(".reveal-slot.shown").length === 5, null, { timeout: 10000 });
await page.waitForFunction(() => document.querySelectorAll(".reveal-front canvas").length === 5, null, { timeout: 10000 });
ok("every card turns over and renders");
await page.screenshot({ path: path.join(OUT, "shop-reveal.png") });

const drop = await page.evaluate(() => window.hypeboundShop.lastDrop());
const kept = drop.cards.filter((c) => c.convertedToSignal === undefined).length;
const converted = drop.cards.filter((c) => c.convertedToSignal !== undefined);
const after = await wallet();

if (after.clout !== before.clout - price) fail(`the Drop cost ${before.clout - after.clout}, the panel said ${price}`);
else ok(`charged exactly the printed price (${price} Clout)`);

if (after.cards !== before.cards + kept) fail(`${kept} cards were kept but the collection grew by ${after.cards - before.cards}`);
else ok(`the collection grew by the ${kept} card(s) actually kept`);

const expectedSignal = converted.reduce((sum, c) => sum + c.convertedToSignal, 0);
if (after.signal !== before.signal + expectedSignal) fail(`Signal moved by ${after.signal - before.signal}, expected ${expectedSignal}`);
else ok(`Signal moved by exactly the converted amount (${expectedSignal})`);

/** A Drop must always contain something worth opening. */
const best = ["common", "rare", "epic", "legendary"];
const bestInDrop = Math.max(...drop.cards.map((c) => best.indexOf(c.rarity)));
if (bestInDrop < 1) fail(`the Drop was all Commons: ${drop.cards.map((c) => c.rarity).join(", ")}`);
else ok(`the floor held — best card was ${best[bestInDrop]}`);

const tags = await page.$$eval(".reveal-tag", (els) => els.map((e) => e.textContent?.trim()));
if (converted.length > 0 && !tags.some((t) => /Converted/.test(t ?? ""))) {
  fail("a card converted to Signal and the reveal never said so");
} else {
  ok(converted.length > 0 ? "conversions are itemised on the card that converted" : "nothing converted (the pool is not complete)");
}

// --- 4. the counter moves, and the collection really has them ----------------
console.log("\n4. After the Drop");
await page.locator("#reveal-done").click();
await page.waitForSelector(".shop-reveal", { state: "hidden", timeout: 10000 });
const opened = await page.evaluate(() => window.hypeboundShop.profile().opened);
if (opened !== 6) fail(`the account recorded ${opened} Drops opened, expected 6`);
else ok("every opening was recorded");

await page.evaluate(() => window.hypeboundShop.buy());
await page.waitForSelector(".shop-reveal:not([hidden])", { timeout: 10000 });
const log = await page.evaluate(() => window.hypeboundShop.profile().log.length);
if (log !== 7) fail(`the opening history holds ${log} entries after seven Drops`);
else ok("every opening is logged");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Merch Drops`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
