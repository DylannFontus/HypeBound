/**
 * Cosmetics, in a real browser.
 *
 * The unit suite proves ownership, slots and resolution. What only a browser can
 * prove is the part the whole layer exists for: that a cosmetic earned from a
 * mastery rank shows up on a screen, can be put on, and is still on when you
 * start a match. Every reward in this game has been one screen away from being
 * invisible, and this is the check that it is not.
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

await seedPlayedAccount(page);

// --- 1. a fresh account wears nothing -----------------------------------------
console.log("\n1. What a new account is wearing");
await page.goto("http://localhost:5173/#profile", { waitUntil: "networkidle" });
await settleOn(".profile-screen");

const startingWorn = await page.evaluate(() => window.hypeboundProfile.wearing());
if (Object.values(startingWorn).some(Boolean)) fail(`already wearing ${JSON.stringify(startingWorn)}`);
else ok("nothing is worn before anything is earned");

const startingEmotes = await page.evaluate(() => window.hypeboundProfile.emotes());
if (startingEmotes.length !== 6) fail(`the wheel starts with ${startingEmotes.length} emotes, expected the 6 starters`);
else ok("the emote wheel starts with its six, which are never taken away");

const startingOwned = await page.evaluate(() => window.hypeboundProfile.owned());
if (startingOwned.length !== 0) fail(`a new account already owns ${startingOwned.length} cosmetics`);
else ok("and owns no cosmetics at all");

// --- 2. earning them through Mastery -------------------------------------------
console.log("\n2. Earning through Faction Mastery");
/**
 * Seeded through the store and reloaded — `import()` inside `page.evaluate` does
 * not reliably reach the app's own module after a source edit, and the reload
 * collapses the two instances via `localStorage`.
 */
await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { factionMasteryConfig } = await import("/src/game/progression/data.ts");
  const { xpForRank } = await import("/src/game/progression/mastery.ts");
  const storage = await import("/src/save/storage.ts");
  profileStore.update((draft) => {
    draft.mastery.faction["neon-idols"] = xpForRank(factionMasteryConfig(), 20);
  });
  storage.flushAllStores();
});
await page.reload({ waitUntil: "networkidle" });

await page.goto("http://localhost:5173/#mastery", { waitUntil: "networkidle" });
await settleOn(".mastery-screen");
const claimed = await page.evaluate(() => {
  const out = [];
  for (const rank of [5, 12, 15, 18, 20]) {
    const grant = window.hypeboundMastery.claim("faction", "neon-idols", rank);
    if (grant) out.push(...grant.cosmetics.map((cosmetic) => `${cosmetic.kind}:${cosmetic.name}`));
  }
  return out;
});
if (claimed.length < 5) fail(`five cosmetic ranks paid only ${claimed.length}: ${claimed.join(", ")}`);
else ok(`five ranks paid ${claimed.length} cosmetics: ${claimed.join(", ")}`);

const gotTitle = claimed.find((entry) => entry.startsWith("title:"));
if (gotTitle !== "title:Center Stage") fail(`rank 20 paid "${gotTitle}", §13 names it Center Stage`);
else ok("rank 20 pays the title §13 names, by name");

// --- 3. worn, and visible ------------------------------------------------------
console.log("\n3. Wearing them");
await page.goto("http://localhost:5173/#profile", { waitUntil: "networkidle" });
await settleOn(".profile-screen");

const worn = await page.evaluate(() => window.hypeboundProfile.wearing());
for (const slot of ["cardBack", "title", "frame"]) {
  if (!worn[slot]) fail(`nothing was auto-equipped into ${slot}, so the reward is invisible`);
  else ok(`${slot} was put on automatically — ${worn[slot]}`);
}

const titleText = await page.locator("#profile-title").innerText();
if (!/center stage/i.test(titleText)) fail(`the profile shows "${titleText}" rather than the equipped title`);
else ok("the equipped title is printed on the profile");

const framePainted = await page.evaluate(() => {
  const canvas = document.querySelector("#profile-frame");
  if (!canvas) return 0;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
  return painted;
});
if (framePainted < 500) fail(`the profile frame drew ${framePainted} pixels — effectively blank`);
else ok(`the profile frame renders (${framePainted} pixels painted)`);

const backPainted = await page.evaluate(() => {
  const canvas = document.querySelector("#profile-back-canvas");
  if (!canvas) return 0;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return seen.size;
});
if (backPainted < 8) fail(`the card-back preview used ${backPainted} colours — it is a flat rectangle`);
else ok(`the card-back preview draws its emblem (${backPainted} distinct colours)`);
await page.screenshot({ path: path.join(OUT, "profile.png") });

// --- 4. the emote wheel grew ----------------------------------------------------
console.log("\n4. The emote wheel");
const wheel = await page.evaluate(() => window.hypeboundProfile.emotes());
if (wheel.length <= 6) fail(`the wheel is still ${wheel.length} after unlocking two emote sets`);
else ok(`the wheel grew to ${wheel.length}`);
for (const starter of ["Greetings", "Well played", "Nice", "Oops", "Threaten", "Thanks"]) {
  if (!wheel.includes(starter)) {
    fail(`the starter emote "${starter}" was taken away`);
    break;
  }
}
if (wheel.includes("Please look forward to it.")) ok("the Neon Idols phrase joined the wheel");
else fail(`the unlocked phrase is not on the wheel: ${wheel.join(" | ")}`);

// --- 5. changing what is worn ---------------------------------------------------
console.log("\n5. Changing a slot");
await page.locator('.profile-slot-toggle[data-slot="title"]').click();
await page.waitForTimeout(150);
const options = await page.locator('.profile-option[data-slot="title"]').count();
if (options < 2) fail(`the title picker offers ${options} options`);
else ok(`the picker offers ${options} options, including the default`);

await page.locator('.profile-option[data-slot="title"][data-id=""]').click();
await page.waitForTimeout(200);
const afterDefault = await page.evaluate(() => window.hypeboundProfile.wearing());
if (afterDefault.title !== null) fail("choosing Default did not clear the title slot");
else ok("a slot can be taken back to its default");

const reEquipped = await page.evaluate(() => window.hypeboundProfile.equip("title", "title:faction:neon-idols"));
if (!reEquipped) fail("re-equipping an owned title was refused");
else ok("and put back on again");

const refused = await page.evaluate(() => window.hypeboundProfile.equip("title", "title:faction:gothic-royalty"));
if (refused) fail("a title the account has not earned was equipped");
else ok("a cosmetic the account has not earned is refused");

// --- 6. it survives into a match -------------------------------------------------
console.log("\n6. In a match");
await page.goto("http://localhost:5173/#battle?difficulty=beginner&seed=606", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 20000 });

const emoteItems = await page.evaluate(() => [...document.querySelectorAll(".emote-item")].map((el) => el.textContent?.trim()));
if (emoteItems.length !== wheel.length) {
  fail(`the battle wheel shows ${emoteItems.length} emotes, the profile says ${wheel.length}`);
} else {
  ok(`the battle emote wheel shows all ${emoteItems.length} unlocked phrases`);
}

const backInPlay = await page.evaluate(async () => {
  const { wearing } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  return wearing(getContent(), "cardBack")?.id ?? null;
});
if (backInPlay !== "cardBack:faction:neon-idols") fail(`the match reads the card back as ${backInPlay}`);
else ok("the equipped card back is what the match renders with");
await page.screenshot({ path: path.join(OUT, "cosmetics-battle.png") });

if (errors.length) {
  console.log("\n   console errors:");
  for (const e of errors.slice(0, 8)) console.log(`     ${e}`);
  failures += errors.length;
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Cosmetics`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
