/**
 * Checks a Weekly Boss fight is actually dealt the way the tier says: the boss
 * leader is the one with the twist, the extra health lands on the BOSS only,
 * and the tier's balance override reaches the live match.
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

const openTier = async (tier, bossId = "") => {
  const bossParam = bossId ? `&boss=${bossId}` : "";
  await seedPlayedAccount(page);
  await page.goto(`http://localhost:5173/#boss?tier=${tier}${bossParam}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForSelector(".mulligan-panel", { timeout: 20000 });
  await page.click(".mulligan-actions .btn-primary");
  await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, {
    timeout: 40000,
  });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const v = window.hypeboundBattle.view();
    const s = window.hypeboundBattle.state();
    return {
      bossLeader: v.opponent.leaderCardId,
      bossHp: v.opponent.leaderHealth,
      bossMax: v.opponent.leaderMaxHealth,
      youHp: v.you.leaderHealth,
      youMax: v.you.leaderMaxHealth,
      overrides: s.config.balanceOverrides ?? null,
    };
  });
};

// --- Normal: no extra health, no overrides ----------------------------------
const normal = await openTier("normal");
console.log(`normal:      ${JSON.stringify(normal)}`);
if (!normal.bossLeader.startsWith("boss-")) fail(`the boss leader was not used (${normal.bossLeader})`);
if (normal.bossHp !== 30) fail(`Normal should not add health (boss on ${normal.bossHp})`);
await page.screenshot({ path: path.join(OUT, "boss-normal.png") });

// --- Impossible: +10 boss health, and ONLY the boss --------------------------
const impossible = await openTier("impossible");
console.log(`impossible:  ${JSON.stringify(impossible)}`);
if (impossible.bossHp !== 40) fail(`Impossible should give the boss 40 health, got ${impossible.bossHp}`);
if (impossible.bossMax !== 40) fail(`boss max health should be 40, got ${impossible.bossMax}`);
if (impossible.youHp !== 30) {
  fail(`the PLAYER must stay on 30 — extra health is a setup op, not a balance override (got ${impossible.youHp})`);
}
if (!impossible.overrides || impossible.overrides["draw.perTurn"] !== 2) {
  fail(`the tier's balance override never reached the match: ${JSON.stringify(impossible.overrides)}`);
}
await page.screenshot({ path: path.join(OUT, "boss-impossible.png") });

// --- every boss in the roster, not just this week's -------------------------
/**
 * The rotation means the two checks above only ever exercise whichever boss the
 * calendar landed on — one in ten. That is fine as a product feature and useless
 * as verification: nine twists would go unrendered until their week came round,
 * and a presenter that cannot draw one of the new events would surface as a
 * "random" console error months later.
 *
 * So walk all ten, and play real turns rather than just dealing them. The unit
 * suite already proves each twist's rules; what a browser adds is that the twist
 * survives contact with the renderer, the event presenter and the AI.
 */
const roster = await page.evaluate(async () => {
  const mod = await import("/src/game/weeklyBoss.ts");
  return mod.BOSSES.map((b) => ({ id: b.id, leaderCardId: b.leaderCardId, name: b.name }));
});

if (roster.length !== 10) fail(`expected 10 bosses in the roster, found ${roster.length}`);
console.log(`\nwalking all ${roster.length} bosses at Normal:`);

for (const boss of roster) {
  const before = errors.length;
  const dealt = await openTier("normal", boss.id);

  if (dealt.bossLeader !== boss.leaderCardId) {
    fail(`${boss.id}: dealt ${dealt.bossLeader}, expected ${boss.leaderCardId}`);
    continue;
  }

  // pass two full turns so the twist actually fires and the presenter draws it
  let live = true;
  for (let turn = 0; turn < 2 && live; turn++) {
    const ended = await page.evaluate(() => document.querySelector(".end-overlay") !== null);
    if (ended) break;
    await page.click(".end-turn-btn:not([disabled])").catch(() => {});
    live = await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!live) fail(`${boss.id}: never got a turn back — the AI or the twist stalled`);

  const fresh = errors.slice(before);
  console.log(`  ${fresh.length === 0 && live ? "ok  " : "FAIL"} ${boss.name}`);
  if (fresh.length > 0) fail(`${boss.id}: ${fresh.join(" | ")}`);
}

await page.screenshot({ path: path.join(OUT, "boss-roster-last.png") });

console.log(errors.length ? `\nconsole errors: ${errors.join(" | ")}` : "\nno console errors");
if (errors.length) failures += 1;
console.log(failures === 0 ? "\nWeekly Boss OK" : `\n${failures} problem(s)`);
if (failures > 0) process.exitCode = 1;
await browser.close();
