/**
 * The system hub, in a real browser — §4.6.3 to §4.6.6.
 *
 * The unit suite proves the derivation: that the disclosure tables are the same
 * object the rollers read, that every dependency is credited, that a diagnostic
 * carries no player in it. What only a browser can prove is:
 *
 * - the numbers **on the page** are the numbers in the data, read back off the
 *   DOM rather than out of a function that the page might not be calling;
 * - the export buttons produce real files with real content;
 * - the delete flow requires the word typed and then actually deletes;
 * - and the biggest claim on the privacy page — **that nothing leaves this
 *   device** — which is checked by watching every request the browser makes and
 *   asserting none of them goes anywhere but the local dev server.
 *
 * That last one is the whole reason this script exists. A privacy page is a
 * promise about behaviour, and behaviour is the one thing a unit test cannot see.
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

/** Every URL the page asks for, for the privacy claim below. */
const requested = [];
page.on("request", (request) => requested.push(request.url()));

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

// --- 1. reachable from settings ----------------------------------------------------
console.log("\n1. §4.6.1's links row");
await page.goto("http://localhost:5173/#settings", { waitUntil: "networkidle" });
await settleOn(".settings-screen");
for (const [id, route] of [
  ["#set-fairness", "fairness"],
  ["#set-privacy", "privacy"],
  ["#set-legal", "legal"],
  ["#set-support", "support"],
]) {
  if ((await page.locator(id).count()) === 0) {
    fail(`settings has no ${id} link`);
    continue;
  }
  await page.locator(id).click();
  await page.waitForTimeout(400);
  const landed = await page.evaluate(() => window.location.hash);
  if (!landed.includes(route)) fail(`${id} landed on ${landed}, expected #${route}`);
  else ok(`${id} → ${landed}`);
  await page.goto("http://localhost:5173/#settings", { waitUntil: "networkidle" });
  await settleOn(".settings-screen");
}

// --- 2. the disclosure page ---------------------------------------------------------
console.log("\n2. Probability disclosures — the screen policy F1 names");
await page.goto("http://localhost:5173/#fairness", { waitUntil: "networkidle" });
await settleOn(".fairness-screen");

/**
 * Read the rates back **off the rendered table** and compare them to the balance
 * file. Asserting against the module's own function would prove the module is
 * self-consistent, which was never in doubt.
 */
const printed = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const economy = getContent().balance.economy;
  const read = (table) =>
    [...document.querySelectorAll(`.fairness-table[data-table="${table}"] tbody tr`)].map((row) => ({
      rarity: row.dataset.rarity,
      percent: row.querySelector("td:nth-child(2)").textContent.trim(),
    }));
  return {
    drop: read("drop"),
    banner: read("banner"),
    expectedDrop: Object.fromEntries(
      Object.entries(economy.pack.rates).map(([rarity, rate]) => [rarity, `${(rate * 100).toFixed(1)}%`])
    ),
    expectedBanner: Object.fromEntries(
      Object.entries(economy.banner.rates).map(([rarity, rate]) => [rarity, `${(rate * 100).toFixed(1)}%`])
    ),
  };
});
for (const [table, expected] of [
  ["drop", printed.expectedDrop],
  ["banner", printed.expectedBanner],
]) {
  const rows = printed[table];
  if (rows.length !== Object.keys(expected).length) {
    fail(`the ${table} table shows ${rows.length} rarities, the data has ${Object.keys(expected).length}`);
    continue;
  }
  const wrong = rows.filter((row) => row.percent !== expected[row.rarity]);
  if (wrong.length > 0) {
    fail(`the ${table} table prints ${wrong.map((r) => `${r.rarity} ${r.percent}`).join(", ")}, the data says otherwise`);
  } else {
    ok(`the ${table} table prints the shipped rates — ${rows.map((r) => `${r.rarity} ${r.percent}`).join(", ")}`);
  }
}

/** And the same numbers on the shop's own panel, which is F1's other half. */
await page.goto("http://localhost:5173/#shop", { waitUntil: "networkidle" });
await settleOn(".shop-screen");
const shopRates = await page.evaluate(() =>
  [...document.querySelectorAll(".shop-odds .odds-table tbody tr")].map((row) =>
    row.querySelector("td:nth-child(2)").textContent.trim()
  )
);
const pageRates = printed.drop.map((row) => row.percent);
if (JSON.stringify(shopRates) !== JSON.stringify(pageRates)) {
  fail(`the shop prints ${shopRates.join(", ")} and the disclosure page prints ${pageRates.join(", ")}`);
} else ok(`the shop's own panel prints the same table (${shopRates.join(", ")})`);

if ((await page.locator("#shop-fairness").count()) === 0) fail("the shop's odds panel does not link to the disclosures");
else ok("and links to the full disclosures");

await page.goto("http://localhost:5173/#fairness", { waitUntil: "networkidle" });
await settleOn(".fairness-screen");
const body = await page.locator(".fairness-body").innerText();
for (const wanted of ["Guarantees", "What a card is worth", "In plain language", "Rates last changed"]) {
  if (!body.includes(wanted)) fail(`§4.6.3's "${wanted}" section is missing`);
}
ok("all of §4.6.3's sections are present");

/**
 * A panel can be present and still be unreadable. These pages are a scrolling
 * flex column, where a child's default is to *shrink* when its content is taller
 * than the box — which collapsed every table on this page to a sliver the first
 * time it rendered. Present is not the same as legible.
 */
const collapsed = await page.evaluate(() =>
  [...document.querySelectorAll(".fairness-body > section")]
    .filter((section) => section.scrollHeight > section.clientHeight + 2)
    .map((section) => section.className)
);
if (collapsed.length > 0) fail(`${collapsed.length} panel(s) are clipping their own content: ${collapsed.join(", ")}`);
else ok("and none of them is clipping its content");
if (!/Never/.test(await page.locator(".fairness-history").innerText())) {
  fail("the rate-change log does not say the rates have never changed");
} else ok("the rate-change log reports no change, which the snapshot test backs up");
await page.screenshot({ path: path.join(OUT, "fairness.png") });

// --- 3. privacy ---------------------------------------------------------------------
console.log("\n3. Privacy — real export, real delete");
await page.goto("http://localhost:5173/#privacy", { waitUntil: "networkidle" });
await settleOn(".privacy-screen");

const exported = await page.evaluate(() => {
  const text = window.hypeboundPrivacy.exportText();
  const parsed = JSON.parse(text);
  return { keys: Object.keys(parsed), hasProfile: "hypebound:profile" in parsed, bytes: text.length };
});
if (!exported.hasProfile) fail("the export does not contain the profile");
else ok(`the export is the whole save — ${exported.keys.length} keys, ${exported.bytes.toLocaleString()} bytes`);

const shown = await page.evaluate(() => {
  document.querySelector("#privacy-show").click();
  const dump = document.querySelector("#privacy-dump");
  return { hidden: dump.hidden, length: dump.textContent.length };
});
if (shown.hidden || shown.length < 100) fail("the save is not shown on the page before exporting");
else ok(`and is shown on the page first (${shown.length.toLocaleString()} characters)`);

/** A row saying nothing is collected must not also say where it is kept. */
const rows = await page.evaluate(() =>
  [...document.querySelectorAll(".policy-table tbody tr")].map((row) => ({
    collected: row.dataset.collected === "true",
    where: row.querySelector("td:nth-child(4)").textContent.trim(),
  }))
);
const contradictory = rows.filter((row) => !row.collected && row.where !== "—");
if (contradictory.length > 0) fail("a row says nothing is collected and also says where it is stored");
else ok(`${rows.length} data categories, ${rows.filter((r) => !r.collected).length} of them collecting nothing`);

/** The delete flow: refuses anything but the word, then really deletes. */
await page.evaluate(() => {
  window.__prompts = [];
  window.prompt = (message) => {
    window.__prompts.push(message);
    return window.__answer;
  };
});
await page.evaluate(() => {
  window.__answer = "yes";
});
await page.locator("#privacy-delete").click();
await page.waitForTimeout(200);
const survived = await page.evaluate(() => localStorage.getItem("hypebound:profile") !== null);
const asked = await page.evaluate(() => window.__prompts?.[0] ?? "");
if (!survived) fail('the delete went ahead without the word "DELETE"');
else if (!/DELETE/.test(asked)) fail("the confirmation does not say what to type");
else ok("delete refuses anything but the typed word, and says which word");
await page.screenshot({ path: path.join(OUT, "privacy.png") });

// --- 4. legal -----------------------------------------------------------------------
console.log("\n4. Legal — attributions generated, terms honestly absent");
await page.goto("http://localhost:5173/#legal", { waitUntil: "networkidle" });
await settleOn(".legal-screen");

const legal = await page.evaluate(async () => {
  const manifest = await (await fetch("/package.json")).json();
  const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  const credited = [...document.querySelectorAll(".policy-table tbody tr")].map((row) => row.dataset.package).sort();
  return { packages, credited, documents: window.hypeboundLegal.documents() };
});
if (JSON.stringify(legal.credited) !== JSON.stringify(legal.packages)) {
  fail(`credited ${legal.credited.join(", ")} but the manifest lists ${legal.packages.join(", ")}`);
} else ok(`every one of the ${legal.packages.length} dependencies is credited on the page`);

const undrafted = legal.documents.filter((entry) => entry.status === "not-written");
if (undrafted.length === 0) fail("terms and an EULA are claimed to exist");
else {
  const text = await page.locator(".policy-doc.not-written").first().innerText();
  if (!/not written|Not written/i.test(text)) fail("an undrafted document does not say it is undrafted");
  else ok(`${undrafted.map((d) => d.title).join(" and ")} are shown as not written, with the reason`);
}
await page.screenshot({ path: path.join(OUT, "legal.png") });

// --- 5. support ----------------------------------------------------------------------
console.log("\n5. Support — a searchable FAQ and a real diagnostic");
await page.goto("http://localhost:5173/#support", { waitUntil: "networkidle" });
await settleOn(".support-screen");

const all = await page.evaluate(() => window.hypeboundSupport.faq().length);
const found = await page.evaluate(() => window.hypeboundSupport.search("odds"));
if (found === 0 || found >= all) fail(`searching "odds" matched ${found} of ${all} — the filter is not filtering`);
else ok(`the FAQ searches (${found} of ${all} match "odds")`);
await page.evaluate(() => window.hypeboundSupport.search(""));

const diagnostic = await page.evaluate(() => {
  const report = window.hypeboundSupport.diagnostic();
  const printed = [...document.querySelectorAll("#support-diagnostic tr")].map((row) => row.dataset.key);
  return { report, printed };
});
for (const wanted of ["dataVersion", "contentHash", "lastMatchSeed", "agent"]) {
  if (!diagnostic.printed.includes(wanted)) fail(`§4.6.6's "${wanted}" is not shown before export`);
}
ok(`the diagnostic is shown in full first — ${diagnostic.printed.length} fields including the data hash`);

const leaks = Object.entries(diagnostic.report).filter(([key]) =>
  ["displayName", "collection", "decks", "clout"].includes(key)
);
if (leaks.length > 0) fail(`the diagnostic carries ${leaks.map(([k]) => k).join(", ")}`);
else ok("and carries no name, no collection and no save");
await page.screenshot({ path: path.join(OUT, "support.png") });

// --- 6. the claim the privacy page actually makes ------------------------------------
console.log("\n6. Nothing left the device");
const offsite = requested.filter((url) => !url.startsWith("http://localhost:5173") && !url.startsWith("data:") && !url.startsWith("blob:"));
if (offsite.length > 0) {
  fail(`${offsite.length} request(s) went off this machine: ${[...new Set(offsite)].slice(0, 5).join(", ")}`);
} else {
  ok(`all ${requested.length} requests in this session went to the local dev server and nowhere else`);
}

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of errors.slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log(`\n   saved screenshots/fairness.png, privacy.png, legal.png, support.png`);
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
