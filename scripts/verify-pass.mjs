/**
 * The Hype Wave, in a real browser.
 *
 * The unit suite proves the tiers, the Rebound arithmetic, the Archive Pass and
 * the calibration. What only a browser can prove is the part §10.6.4 makes
 * binding: that the screen reads as calm rather than as a countdown, that the
 * Backstage column is genuinely locked until it is bought and genuinely
 * retro-claims when it is, and that fifty tiers actually draw.
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
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
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

/** Put the live pass at a tier, through the store, and reload. */
const setTier = async (tier) => {
  await page.evaluate(async (target) => {
    const { profileStore, syncHypeWave } = await import("/src/save/profile.ts");
    const { xpForTier } = await import("/src/game/progression/hypeWave/index.ts");
    const storage = await import("/src/save/storage.ts");
    syncHypeWave();
    profileStore.update((draft) => {
      if (draft.hypeWave.pass) draft.hypeWave.pass.xp = xpForTier(target);
    });
    storage.flushAllStores();
  }, tier);
  await page.reload({ waitUntil: "networkidle" });
};

const giveGlimmer = async (amount) => {
  await page.evaluate(async (value) => {
    const { profileStore } = await import("/src/save/profile.ts");
    const storage = await import("/src/save/storage.ts");
    profileStore.update((draft) => {
      draft.glimmer = value;
    });
    storage.flushAllStores();
  }, amount);
  await page.reload({ waitUntil: "networkidle" });
};

await seedPlayedAccount(page);

// --- 1. a season is running -------------------------------------------------------
console.log("\n1. The season");
await page.goto("http://localhost:5173/#pass", { waitUntil: "networkidle" });
await settleOn(".pass-screen");

const view = await page.evaluate(() => window.hypeboundPass.view());
if (!view?.live) fail("no live season — the shipped season dates do not cover today");
else ok(`season ${view.seasonId} is live, at tier ${view.tier}`);

const rows = await page.locator(".pass-row").count();
if (rows !== 50) fail(`${rows} tier rows, §10.1 says fifty`);
else ok("fifty tiers drawn");

const paceMark = await page.locator(".pass-row.pace").count();
if (paceMark !== 1) fail(`${paceMark} pace markers; there should be exactly one`);
else ok(`the pace line is marked at tier ${view.paceLine}`);

// --- 2. the tone §10.6.4 makes binding ---------------------------------------------
console.log("\n2. Tone");
const body = await page.locator(".pass-body").innerText();
for (const forbidden of ["last chance", "hurry", "don't miss", "expires soon", "ends in"]) {
  if (body.toLowerCase().includes(forbidden)) {
    fail(`the screen says "${forbidden}" — §10.6.4 forbids countdown-panic framing`);
  }
}
ok("no countdown-panic copy anywhere on the screen");

if (!/runs until/i.test(body)) fail("the season's end is not stated as a factual date");
else ok("the season's end is a factual date, as §10.6.4 requires");
if (!/rerun vault/i.test(body)) fail("the screen does not say seasonal cosmetics come back");
else ok("and it says out loud that nothing here is missable");

const pacing = await page.locator(".pass-pacing").first().innerText();
if (!/pace|rebound/i.test(pacing)) fail(`the pacing line reads "${pacing}"`);
else ok(`the pacing state is calm: "${pacing.trim()}"`);

// --- 3. earning and claiming ---------------------------------------------------------
console.log("\n3. Claiming the free track");
await setTier(5);
await page.goto("http://localhost:5173/#pass", { waitUntil: "networkidle" });
await settleOn(".pass-screen");

const atFive = await page.evaluate(() => window.hypeboundPass.view());
if (atFive.tier !== 5) fail(`the pass reads tier ${atFive.tier} after being set to 5`);
else ok("the pass reads tier 5");
if (atFive.claimable.length < 5) fail(`only ${atFive.claimable.length} tiers are claimable at tier 5`);
else ok(`${atFive.claimable.length} tiers are claimable`);

const grant = await page.evaluate(() => window.hypeboundPass.claim("free", 1));
if (!grant?.cosmetics?.length) fail("tier 1 paid no cosmetic");
else ok(`tier 1 paid ${grant.cosmetics[0].name}`);

/**
 * Flushed and reloaded before reading what is worn.
 *
 * `window.hypeboundPass` writes through the app's own module; an `import()`
 * inside `page.evaluate` can reach a *second* instance of that module with its
 * own store, which would read stale `localStorage` while the app's write is
 * still on the 250ms debounce. The reload collapses the two.
 */
await page.evaluate(async () => (await import("/src/save/storage.ts")).flushAllStores());
await page.reload({ waitUntil: "networkidle" });
await settleOn(".pass-screen");
const backAfter = await page.evaluate(async () => {
  const { wearing } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  return wearing(getContent(), "cardBack")?.id ?? null;
});
if (!backAfter?.includes("season")) fail(`the seasonal card back was not put on (slot holds ${backAfter})`);
else ok("and it was put on automatically");

const packGrant = await page.evaluate(() => window.hypeboundPass.claim("free", 5));
if (packGrant?.drops !== 1) fail(`tier 5 paid ${packGrant?.drops} Drops, §10.2 says one pack`);
else ok("tier 5 paid the Merch Drop §10.2 promises");

// --- 4. the Backstage Pass ------------------------------------------------------------
console.log("\n4. The Backstage Pass");
await setTier(20);
await page.goto("http://localhost:5173/#pass", { waitUntil: "networkidle" });
await settleOn(".pass-screen");

const lockedCells = await page.locator(".pass-cell.locked").count();
if (lockedCells === 0) fail("the Backstage column is not locked without the pass");
else ok(`the Backstage column is locked (${lockedCells} cells)`);

const refused = await page.evaluate(() => window.hypeboundPass.claim("backstage", 5));
if (refused) fail("a Backstage tier paid out without the pass");
else ok("and a Backstage tier refuses to pay");

const cannotAfford = await page.evaluate(() => window.hypeboundPass.buy());
if (cannotAfford) fail("the Backstage Pass was sold to an account with no Glimmer");
else ok("it cannot be bought without the Glimmer");

await giveGlimmer(1000);
await page.goto("http://localhost:5173/#pass", { waitUntil: "networkidle" });
await settleOn(".pass-screen");
const bought = await page.evaluate(() => window.hypeboundPass.buy());
if (!bought) fail("the Backstage Pass could not be bought with 1,000 Glimmer");
else ok("bought for 1,000 Glimmer");

const retro = await page.evaluate(() => window.hypeboundPass.view());
const backstageClaimable = await page.evaluate(
  () => window.hypeboundPass.view().claimable.length
);
if (!retro.backstage) fail("the pass is not held after buying it");
else ok("the pass is held");
if (backstageClaimable === 0) fail("nothing retro-claimed — §10.1 grants already-earned tiers instantly");
else ok(`${backstageClaimable} tiers are claimable at once — retro-claim works`);

const glimmerBack = await page.evaluate(() => window.hypeboundPass.claim("backstage", 5));
if (glimmerBack?.glimmer !== 100) fail(`Backstage tier 5 paid ${glimmerBack?.glimmer} Glimmer, §10.3 says 100`);
else ok("Backstage tier 5 paid its 100 Glimmer");
await page.screenshot({ path: path.join(OUT, "hypewave.png") });

// --- 5. deferrals say what they wait for -----------------------------------------------
console.log("\n5. What it cannot pay");
const deferred = await page.locator(".pass-reward.deferred").count();
if (deferred === 0) fail("nothing on the premium track is marked as deferred, which cannot be right");
else ok(`${deferred} rewards are marked as waiting on a system`);
const firstNote = await page.locator(".pass-reward.deferred").first().getAttribute("title");
if (!firstNote || firstNote.length < 12) fail(`a deferred reward has no written reason ("${firstNote}")`);
else ok(`and each says why: "${firstNote.slice(0, 52)}…"`);

// --- 6. Encore ----------------------------------------------------------------------------
console.log("\n6. Encore");
await setTier(53);
await page.goto("http://localhost:5173/#pass", { waitUntil: "networkidle" });
await settleOn(".pass-screen");
const owed = await page.evaluate(() => window.hypeboundPass.view().encoreOwed);
if (owed !== 3) fail(`${owed} Encore tiers owed at tier 53, expected 3`);
else ok("three Encore tiers owed past fifty");
const encore = await page.evaluate(() => window.hypeboundPass.encore());
if (encore?.clout !== 150) fail(`Encore paid ${encore?.clout} Clout, expected 150`);
else ok("Encore paid 150 Clout, and will keep paying");

// --- 7. the lobby knows ----------------------------------------------------------------------
console.log("\n7. Finding it from the lobby");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");
if ((await page.locator("#lobby-pass").count()) === 0) fail("the lobby has no Hype Wave button");
else ok("the lobby has a Hype Wave button");
await page.locator("#lobby-pass").click();
await settleOn(".pass-screen");
ok("and it goes there");

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — The Hype Wave`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
