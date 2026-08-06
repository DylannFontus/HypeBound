/**
 * Do the five rebuilt screens still expose every hook their `verify-*` scripts
 * drive?
 *
 * ## Why this is not just "run the verify scripts"
 *
 * They are run too, and four of the five pass. `verify-gauntlet.mjs` does not,
 * and it fails on its **first** line of work — `.mode-card` filtered to "The
 * Gauntlet", then `.mode-status` inside it — which is `playScreen.ts`, a file
 * this session has not touched. Probed directly: of fourteen mode cards, only
 * two render a `.mode-status` at all ("The Grand Tour" and "Ranked Ladder"),
 * because `playScreen.ts` emits it as `${status ? … : ""}` and the Gauntlet has
 * no status string. The locator therefore waits thirty seconds and throws before
 * the Gauntlet screen is ever opened.
 *
 * That is a real failure and it belongs to whoever owns Mode Select, but it also
 * means the script can no longer answer the question this session needs answered:
 * *did moving the deck panel to the rail and the deferred list back to the column
 * break any of the ids the checks depend on?* So this drives the same selectors
 * from `#gauntlet` directly, skipping the step that is failing for an unrelated
 * reason, and does the same for the other four screens.
 *
 *   node scripts/_w8col_hooks.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const settled = () =>
  page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});

async function go(route) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await settled();
  await page.waitForTimeout(1200);
}

const count = (sel) => page.locator(sel).count();
async function need(sel, label = sel) {
  const n = await count(sel);
  if (n > 0) ok(`${label} (${n})`);
  else bad(`${label} — not in the DOM`);
  return n;
}

try {
  await seedPlayedAccount(page, ORIGIN);

  console.log("\n#gauntlet — the selectors verify-gauntlet drives, from the route itself");
  await go("gauntlet");
  await need("#gauntlet-reality");
  await need(".gauntlet-reward-table tr[data-wins='12']");
  await need("#gauntlet-start");
  await need(".d-rail .gauntlet-record-card", "the record card, on the wall");
  await need(".gauntlet-deferred", "the deferred list, back in the column");
  await page.locator("#gauntlet-start").click();
  await page.waitForTimeout(700);
  await need(".gauntlet-leader-tile");
  await page.locator(".gauntlet-leader-tile").first().click();
  await page.waitForTimeout(700);
  await need("#gauntlet-pick-count");
  await need("#gauntlet-rarity");
  await need(".gauntlet-offer-tile");
  await need(".d-rail .gauntlet-deck", "the deck panel, on the wall");
  await page.locator(".gauntlet-offer-tile").first().click();
  await page.waitForTimeout(600);
  const pick = await page.locator("#gauntlet-pick-count").textContent();
  if (/2\s*\/\s*30/.test(pick ?? "")) ok(`the pick counter advanced ("${pick?.trim()}")`);
  else bad(`the pick counter reads "${pick?.trim()}" after one pick`);
  await page.evaluate(() => window.hypeboundGauntlet.autoDraft());
  await page.waitForTimeout(900);
  await need("#gauntlet-redraft");
  await need("#gauntlet-begin");
  await need(".d-rail .gauntlet-deck-list li", "thirty picks, listed on the wall");
  await page.locator("#gauntlet-begin").click();
  await page.waitForTimeout(700);
  await need("#gauntlet-next");
  await need("#gauntlet-record .currency-value");
  await need("#gauntlet-fight");

  console.log("\n#doomscroll — the selectors verify-doomscroll drives");
  await page.evaluate(() => localStorage.removeItem("hypebound:gauntlet"));
  await go("doomscroll");
  await need(".doom-leader");
  await need(".d-rail .doom-acts-card", "the descent ladder, on the wall");
  await need(".doom-rule", "the four run rules");
  await page.locator(".doom-leader").first().click();
  await page.waitForTimeout(900);
  await need("#doom-abandon");
  await need(".doom-node-open");
  await need(".d-rail .doom-side", "the run sidebar, on the wall");
  await need(".doom-legend-row", "the map legend");
  const legendKinds = await page.evaluate(() =>
    [...document.querySelectorAll(".doom-legend-row")].map((n) => n.dataset.kind)
  );
  if (legendKinds.length === 8 && new Set(legendKinds).size === 8) ok(`eight node kinds in the key`);
  else bad(`the key lists ${legendKinds.length} kinds: ${legendKinds.join(",")}`);
  const bossWidth = await page.evaluate(() => {
    const el = document.querySelector('.doom-legend-row[data-kind="boss"]');
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
  if (bossWidth > 120) ok(`the boss legend row is ${bossWidth}px, not the map node's 96`);
  else bad(`the boss legend row is ${bossWidth}px — it has taken .doom-node-boss's width`);

  console.log("\n#replays — the workbench hooks, and the empty state that replaces them");
  await go("replays");
  await need(".replay-virgin-hero", "the empty state's hero band");
  await need(".replay-virgin-card", "the three plates");
  await need("#replay-play");
  const virginSpan = await page.evaluate(() => {
    const h = document.querySelector(".replay-virgin-hero");
    return h ? Math.round(h.getBoundingClientRect().width) : 0;
  });
  if (virginSpan > 1200) ok(`the hero is ${virginSpan}px of 1600, not a centred 800px card`);
  else bad(`the hero is ${virginSpan}px wide`);

  console.log("\n#missions — the selectors verify-missions drives");
  await go("missions");
  await need("#missions-daily .mission");
  await need("#missions-weekly .mission");
  await need("#missions-daily .mission .mission-reward");
  const intro = await page.locator(".missions-intro").innerText();
  if (/expire/i.test(intro)) ok("F6 is still stated on .missions-intro");
  else bad("the intro no longer says that nothing expires");
  await need(".missions-record", "the record card");
  await need("#missions-dailies-done");
  await need("#missions-weeklies-done");
  await need("#missions-record-toward");
  await need("#missions-bonus-toward");
  const dupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  if (dupes.length === 0) ok("no duplicate ids");
  else bad(`duplicate ids: ${dupes.join(", ")}`);

  console.log("\n#pass — the selectors verify-pass drives");
  await go("pass");
  const rows = await need(".pass-row");
  if (rows === 50) ok("fifty tiers");
  else bad(`${rows} tiers, expected 50`);
  await need(".pass-cell.locked");
  await need(".pass-pacing");
  await need(".pass-reward.deferred");
  const body = (await page.locator(".pass-body").innerText()).toLowerCase();
  for (const forbidden of ["last chance", "hurry", "don't miss", "expires soon", "ends in"]) {
    if (body.includes(forbidden)) bad(`the screen says "${forbidden}" — §10.6.4 forbids it`);
  }
  if (/runs until/.test(body)) ok("the season's end is a factual date");
  else bad("the season's end is not stated as a date");
  if (/rerun vault/.test(body)) ok("the Rerun Vault is still named");
  else bad("the Rerun Vault sentence is gone");
  await need("#pass-to-missions", "the route out, on the closing band");
  const passDupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  if (passDupes.length === 0) ok("no duplicate ids");
  else bad(`duplicate ids: ${passDupes.join(", ")}`);
} finally {
  if (errors.length) {
    console.log(`\n${errors.length} page error(s):`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log("  " + e.slice(0, 200));
    failures += errors.length;
  }
  await browser.close();
}

console.log(failures === 0 ? "\nALL HOOKS PRESENT" : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
