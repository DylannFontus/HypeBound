/**
 * The Headliner Banner page and the Stream Check-In, in a real browser.
 *
 * The unit suite proves the pull algorithm, the pity counters and the check-in
 * track. What only a browser can prove is the part §4.1 is actually about:
 * **disclosure**. The exact rates have to be on the page, the Encore Meter has
 * to show its count in words rather than in colour, the rerun calendar has to be
 * readable, and the opening history has to exist and export.
 *
 * A gacha page that rolled correctly and told you nothing would pass every unit
 * test in this repository.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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

/**
 * Set the account's Clout, without losing what the app has just written.
 *
 * The reload comes FIRST on purpose. `window.hypeboundBanner` writes through the
 * app's own module and those writes sit on a 250ms debounce; an `import()`
 * inside `page.evaluate` reaches a *second* instance of that module with its own
 * store, so writing through it before the app has flushed would take a snapshot
 * that predates the pull and put it back on top. Reloading fires `pagehide`,
 * which flushes the app — then the second instance reads a current file.
 */
const giveClout = async (amount) => {
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(async (value) => {
    const { profileStore } = await import("/src/save/profile.ts");
    const storage = await import("/src/save/storage.ts");
    profileStore.update((draft) => {
      draft.clout = value;
    });
    storage.flushAllStores();
  }, amount);
  await page.reload({ waitUntil: "networkidle" });
};

await seedPlayedAccount(page);

// --- 1. the page exists and a banner is running ---------------------------------
console.log("\n1. The banner");
await page.goto("http://localhost:5173/#banner", { waitUntil: "networkidle" });
await settleOn(".banner-screen");

const view = await page.evaluate(() => window.hypeboundBanner.view());
if (!view) fail("no banner at all");
else ok(`showing "${view.id}"${view.live ? ", running now" : ", between runs"}`);
if (!view.live) fail("no banner is running today — the shipped run dates do not cover it");
else ok("a banner is live");

const featured = await page.locator(".banner-card").count();
if (featured !== 7) fail(`${featured} featured cards; §4 asks for 1 Legendary + 2 Epics + 4 Rares`);
else ok("seven featured cards: a Legendary, two Epics and four spotlighted Rares");

const art = await page.locator(".banner-card-art canvas").count();
if (art !== featured) fail(`${art} of ${featured} featured cards drew their art`);
else ok("each one renders its card");

// --- 2. disclosure --------------------------------------------------------------
console.log("\n2. What the page tells you before you spend");
await page.evaluate(() => window.hypeboundBanner.show("odds"));
await page.waitForTimeout(150);
const oddsText = await page.locator(".banner-panel").innerText();
for (const rate of ["2.0%", "8.0%", "30.0%", "60.0%"]) {
  if (!oddsText.includes(rate)) fail(`the odds table does not print ${rate}`);
}
ok("the exact per-rarity rates are printed");
if (!oddsText.includes("1.0%")) fail("the featured rate-up share is not printed");
else ok("and the share concentrated on the featured cards");
if (!/150%/.test(oddsText)) fail("the duplicate-conversion rate is not stated");
else ok("the duplicate-conversion rate is stated, with a worked example");
if (!/no odds advantage/i.test(oddsText)) fail("the page does not say the ×10 has no edge");
else ok("and it says out loud that the ×10 is not a better deal");

const meterLabel = await page.locator("#banner-meter-label").innerText();
if (!/\d+ \/ \d+ pulls until/.test(meterLabel)) fail(`the Encore Meter reads "${meterLabel}"`);
else ok(`the Encore Meter is labelled, not colour-only: "${meterLabel.trim().split("\n")[0]}"`);

const head = await page.locator(".banner-head").innerText();
if (!/Reruns:/.test(head)) fail("no rerun calendar on the page");
else ok("the rerun calendar is published on the page");
if (!/never gates|already in Merch Drops/i.test(head)) fail("the page does not say the banner gates nothing");
else ok("and it says nothing here becomes unobtainable");

// --- 3. pulling ------------------------------------------------------------------
console.log("\n3. Pulling");
await page.evaluate(() => window.hypeboundBanner.show(null));
await giveClout(0);
await page.goto("http://localhost:5173/#banner", { waitUntil: "networkidle" });
await settleOn(".banner-screen");

const freeFirst = await page.evaluate(() => window.hypeboundBanner.pull(1));
if (!freeFirst || freeFirst.cloutSpent !== 0) fail(`the first ×1 cost ${freeFirst?.cloutSpent}; §4.1 makes it free`);
else ok("the first ×1 pull is free, as §4.1 promises");

const refused = await page.evaluate(() => window.hypeboundBanner.pull(1));
if (refused) fail("a second pull went through with no Clout");
else ok("and the second is refused with no Clout");

await giveClout(5000);
await page.goto("http://localhost:5173/#banner", { waitUntil: "networkidle" });
await settleOn(".banner-screen");
const ten = await page.evaluate(() => window.hypeboundBanner.pull(10));
if (ten?.cards?.length !== 10) fail(`a ×10 produced ${ten?.cards?.length} cards`);
else ok("a ×10 produces ten cards");
if (ten.cloutSpent !== 1500) fail(`the ×10 cost ${ten.cloutSpent}, expected exactly ten pulls at 150`);
else ok("and costs exactly ten pulls, never discounted");
if (!ten.cards.some((card) => card.rarity === "epic" || card.rarity === "legendary")) {
  fail("a full ×10 produced nothing Epic or better — the ten-pull guarantee did not fire");
} else ok("the ten-pull Epic guarantee held");
if (ten.cosmetics.length !== 1) fail("the first ×10 did not grant the themed card back");
else ok(`the first ×10 granted "${ten.cosmetics[0].name}"`);
if (ten.tokens !== 10) fail(`the ×10 granted ${ten.tokens} Backstage Tokens, expected ten`);
else ok("ten Backstage Tokens banked");

const revealed = await page.locator(".banner-pill").count();
if (revealed < 10) fail(`the reveal strip shows ${revealed} of ten`);
else ok("the pull is shown card by card");
await page.screenshot({ path: path.join(OUT, "banner.png") });

// --- 4. targeting ------------------------------------------------------------------
console.log("\n4. Targeting");
const before = await page.evaluate(() => window.hypeboundBanner.view());
const epicId = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  return Object.values(getContent().cards).find((c) => c.rarity === "epic" && !c.token && !c.variantOf)?.id;
});
const retargeted = await page.evaluate((id) => window.hypeboundBanner.target(id), epicId);
const after = await page.evaluate(() => window.hypeboundBanner.view());
if (!retargeted || after.target !== epicId) fail("the Target Card could not be changed");
else ok("the Target Card can be any card in the pool");
if (after.sinceTarget !== before.sinceTarget) fail("changing the Target reset the Encore Meter");
else ok(`and changing it keeps the meter's count (${after.sinceTarget})`);

const wished = await page.evaluate((id) => window.hypeboundBanner.wish(id), epicId);
if (!wished?.includes(epicId)) fail("a card could not be wishlisted");
else ok("cards can be wishlisted");

/**
 * `seedPlayedAccount` hands the account two of everything, so nothing is under
 * the playable cap and the shop would rightly refuse every purchase. One Common
 * is cleared out first — which is also the only honest way to test the shop:
 * buying a card you are already capped on is a thing it must refuse.
 */
const commonId = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const { profileStore } = await import("/src/save/profile.ts");
  const storage = await import("/src/save/storage.ts");
  const card = Object.values(getContent().cards).find((c) => c.rarity === "common" && !c.token && !c.variantOf);
  profileStore.update((draft) => {
    delete draft.collection[card.id];
  });
  storage.flushAllStores();
  return card.id;
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".banner-screen");

const tokens = await page.evaluate(() => window.hypeboundBanner.view().tokens);
const price = await page.evaluate((id) => window.hypeboundBanner.redeem(id), commonId);
if (price !== 2) fail(`the Backstage Shop charged ${price} tokens for a Common, expected 2`);
else ok(`the Backstage Shop sold a Common for ${price} tokens (held ${tokens})`);

// a Common caps at two, so the second buy is legitimate and the third is not
const second = await page.evaluate((id) => window.hypeboundBanner.redeem(id), commonId);
const third = await page.evaluate((id) => window.hypeboundBanner.redeem(id), commonId);
if (second !== 2) fail(`the second copy cost ${second}, and a Common caps at two`);
else if (third !== null) fail("the shop sold a third copy past the playable cap");
else ok("it sells up to the playable cap of two, and refuses the third");

// --- 5. history -----------------------------------------------------------------------
console.log("\n5. History");
const history = await page.evaluate(() => window.hypeboundBanner.history());
if (history.length < 2) fail(`the history holds ${history.length} entries after two pulls`);
else ok(`every pull is logged (${history.length} entries)`);
if (!history[0].cards[0].rarity) fail("a log entry does not record what was pulled");
else ok("and each records the card, its rarity and any conversion");

await page.evaluate(() => window.hypeboundBanner.show("history"));
await page.waitForTimeout(150);
if ((await page.locator("#banner-export").count()) === 0) fail("no JSON export on the history panel");
else ok("the history exports as JSON, as §4.1 asks");

// --- 6. the check-in ---------------------------------------------------------------------
console.log("\n6. Stream Check-In");
await page.goto("http://localhost:5173/#missions", { waitUntil: "networkidle" });
await settleOn(".missions-screen");

const steps = await page.locator(".checkin-step").count();
if (steps !== 10) fail(`${steps} check-in steps; §11 lists ten`);
else ok("ten steps on the monthly track");

const panelText = await page.locator(".checkin-panel").innerText();
if (!/no streaks/i.test(panelText)) fail("the panel does not say there are no streaks");
else ok("and it says out loud that there are no streaks");

if ((await page.locator("#missions-checkin").count()) === 0) {
  fail("today's step cannot be claimed");
} else {
  /**
   * Read off the screen rather than through an `import()`. The claim goes through
   * the app's own module; a second instance's `getProfile()` would answer from
   * its own cache and report no change — and the wallet on the header is what a
   * player actually sees, which makes it the better thing to assert anyway.
   */
  const wallet = async () => Number((await page.locator("#missions-clout").innerText()).replace(/[^0-9]/g, ""));
  const cloutBefore = await wallet();
  await page.locator("#missions-checkin").click();
  await page.waitForTimeout(200);
  const cloutAfter = await wallet();
  if (cloutAfter - cloutBefore !== 50) fail(`step 1 paid ${cloutAfter - cloutBefore} Clout, §11 says 50`);
  else ok("step 1 paid the 50 Clout §11 lists");
  if ((await page.locator("#missions-checkin").count()) > 0) fail("a second claim is offered on the same day");
  else ok("and a second claim on the same day is not offered");
}

// --- 7. reaching it from the shop -----------------------------------------------------------
console.log("\n7. Finding the banner");
await page.goto("http://localhost:5173/#shop", { waitUntil: "networkidle" });
await settleOn(".shop-screen");
if ((await page.locator("#shop-banner").count()) === 0) fail("the shop does not link to the banner");
else ok("the shop shows the running Headliner");
await page.locator("#shop-banner").click();
await settleOn(".banner-screen");
ok("and it goes there");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Headliner Banners & Check-In`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
