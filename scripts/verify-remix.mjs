/**
 * The Remix Queue in a real browser — `09-game-modes.md` §12.
 *
 * The unit tests cover the rotation arithmetic and the config assembly. What
 * only a browser shows is §12's actual requirement, which is about *display*:
 * the modifier must appear **on the queue tile and in the mulligan screen**.
 *
 * That is a small sentence carrying a large one. A global rule change the player
 * discovers by losing to it is a bug, so the interesting assertions here are
 * that the rule is legible before anything is at stake — and that the rule the
 * mulligan names is the same rule the hub named, rather than two independent
 * lookups that happen to agree today.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
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

// ---------------------------------------------------------------------------

console.log("\n1. Reachable from mode select");
await page.goto(`${ORIGIN}/#play`, { waitUntil: "networkidle" });
await settleOn(".play-screen");
const tile = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".mode-card, .play-mode, [data-mode]")].find((el) =>
    el.textContent.includes("Remix Queue")
  );
  return card ? card.textContent.replace(/\s+/g, " ").trim().slice(0, 90) : null;
});
if (!tile) fail("there is no Remix Queue tile in mode select");
else ok(`mode select offers it — "${tile}"`);

await page.goto(`${ORIGIN}/#remixhub`, { waitUntil: "networkidle" });
await settleOn(".remix-screen");
ok("and #remixhub opens");

// ---------------------------------------------------------------------------

console.log("\n2. This week's rule, stated before anything is at stake");
const hub = await page.evaluate(() => ({
  current: window.hypeboundRemix.current(),
  rotation: window.hypeboundRemix.rotation(),
  quest: window.hypeboundRemix.quest(),
  ruleText: document.querySelector("#remix-rule")?.textContent?.trim() ?? "",
  until: document.querySelector(".remix-until")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  both: document.querySelector(".remix-both")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
}));

if (!hub.ruleText) fail("the hub does not print this week's rule");
else if (hub.ruleText !== hub.current.text) fail("the printed rule is not the rule the rotation picked");
else ok(`the rule is on the tile: "${hub.ruleText.slice(0, 80)}"`);

if (!/until/i.test(hub.until)) fail(`the hub does not say when the week turns over: "${hub.until}"`);
else ok(`and when it turns over — ${hub.until.slice(0, 70)}`);

if (!/both players/i.test(hub.both)) fail("the hub does not say the rule applies to both players");
else ok("and that it applies to both players");

// ---------------------------------------------------------------------------

console.log("\n3. The whole launch table, including what is not built");
const playable = hub.rotation.filter((entry) => !entry.deferred);
const deferred = hub.rotation.filter((entry) => entry.deferred);
if (hub.rotation.length !== 10) fail(`§12.1 publishes ten modifiers; the hub lists ${hub.rotation.length}`);
else ok(`all ten of §12.1's modifiers are listed — ${playable.length} playable, ${deferred.length} not yet`);

const shown = await page.evaluate(() => document.querySelectorAll(".remix-row").length);
if (shown !== 10) fail(`${shown} rows drawn for 10 modifiers`);
else ok("every one of them is drawn");

const reasons = await page.evaluate(() =>
  [...document.querySelectorAll(".remix-row.is-deferred .remix-why")].map((el) => el.textContent.trim())
);
if (reasons.length !== deferred.length) fail(`${deferred.length} deferred modifiers but ${reasons.length} reasons shown`);
else if (reasons.some((r) => r.length < 40)) fail("a deferred modifier is listed without a real reason");
else ok(`each unbuilt one says why — e.g. "${reasons[0]?.slice(0, 70)}…"`);

if (!hub.quest || hub.quest.required <= 0) fail("the weekly quest is not shown");
else ok(`the weekly quest asks for ${hub.quest.required} wins and pays ${hub.quest.clout} Clout`);

await page.screenshot({ path: path.join(OUT, "remix-hub.png"), fullPage: true });

// ---------------------------------------------------------------------------

console.log("\n4. The rule reaches the match, and the mulligan says so");
await page.evaluate(() => document.querySelector("#remix-play")?.click());
await settleOn(".battle-screen");
await page.waitForTimeout(2500);

const inMatch = await page.evaluate(() => ({
  ruleName: document.querySelector(".mulligan-rule-name")?.textContent?.trim() ?? "",
  ruleText: document.querySelector(".mulligan-rule-text")?.textContent?.trim() ?? "",
  mulliganOpen: Boolean(document.querySelector(".mulligan-panel")),
}));

if (!inMatch.mulliganOpen) fail("the match did not reach a mulligan");
else if (!inMatch.ruleText) fail("§12 requires the modifier on the mulligan screen, and it is not there");
else if (inMatch.ruleText !== hub.current.text) {
  fail(`the mulligan names a different rule than the hub — "${inMatch.ruleText.slice(0, 60)}"`);
} else {
  ok(`the mulligan states the same rule the hub did: "${inMatch.ruleName}"`);
}

await page.screenshot({ path: path.join(OUT, "remix-mulligan.png") });

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/remix-*.png");
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
