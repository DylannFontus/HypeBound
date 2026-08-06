/**
 * News and patch notes, in a real browser — §4.2.2 and §4.2.3.
 *
 * The unit suite proves the derivation: that every number in an article resolves
 * from live data, that a card diff chains correctly, and that the newest
 * release's economy snapshot equals the shipped balance. What only a browser can
 * prove is that any of it reaches a player — and one thing the unit suite cannot
 * reach at all, because it needs a canvas: **the before/after card frames**.
 *
 * No card has been re-balanced yet, and writing a change into `patch-notes.json`
 * to exercise the renderer would put a change in the player-facing record that
 * never happened. So the renderer is driven here through `previewDiff`, an
 * automation-only hook: real cards, real canvases, and nothing written down.
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

// --- 1. the lobby card ------------------------------------------------------------
console.log("\n1. The lobby's What's New card is the newest article, not a fixed paragraph");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");

if ((await page.locator("#lobby-news").count()) === 0) fail("the lobby has no news card");
else {
  const shown = (await page.locator("#lobby-news .lobby-news-title").innerText()).trim();
  const newest = await page.evaluate(async () => {
    const { getContent } = await import("/src/engine/content.ts");
    const { newsArticles } = await import("/src/game/news/index.ts");
    return newsArticles(getContent())[0].title;
  });
  if (shown !== newest) fail(`the lobby shows "${shown}" but the newest article is "${newest}"`);
  else ok(`the lobby shows the newest article — "${shown}"`);

  await page.locator("#lobby-news").click();
  await settleOn(".news-screen");
  const opened = (await page.locator(".mail-reading-subject").innerText()).trim();
  if (opened !== shown) fail(`the card opened "${opened}" rather than the article it displayed`);
  else ok("and clicking it opens that article");
}

// --- 2. the feed ------------------------------------------------------------------
console.log("\n2. The feed");
const listed = await page.evaluate(() => window.hypeboundNews.list());
if (listed.length === 0) fail("the feed is empty");
else ok(`${listed.length} articles`);

/**
 * The claim the whole token mechanism exists to make. Not "the article contains
 * a percent sign" — the exact rate the roller uses has to be in the text.
 */
const quoted = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const rates = getContent().balance.economy.banner.rates;
  return {
    legendary: `${(rates.legendary * 100).toFixed(1)}%`,
    common: `${(rates.common * 100).toFixed(1)}%`,
  };
});
const bannerArticle = listed.find((a) => a.id === "second-funeral-live");
if (!bannerArticle) fail("the banner article is missing from the feed");
else {
  const text = bannerArticle.body.join(" ");
  if (!text.includes(quoted.legendary) || !text.includes(quoted.common)) {
    fail(`the article does not quote the shipped rates ${quoted.legendary} / ${quoted.common}`);
  } else ok(`the article quotes the shipped rates — ${quoted.legendary} Legendary, ${quoted.common} Common`);
}

const holes = listed.filter((a) => /\{[a-zA-Z]/.test([a.title, a.summary, ...a.body].join(" ")));
if (holes.length > 0) fail(`unresolved tokens on screen: ${holes.map((a) => a.id).join(", ")}`);
else ok("no article renders a token as text");

const rendered = await page.locator(".news-row").count();
if (rendered !== listed.length) fail(`${listed.length} articles but ${rendered} rows`);
else ok(`all ${rendered} drawn as rows`);

/** Drawn is not the same as reachable — see the note on the same check in verify-inbox. */
const reachable = await page.evaluate(() => {
  const list = document.querySelector(".news-list");
  const rows = [...document.querySelectorAll(".news-row")];
  const last = rows[rows.length - 1];
  last.scrollIntoView({ block: "nearest" });
  const panel = list.getBoundingClientRect();
  const box = last.getBoundingClientRect();
  return box.bottom <= panel.bottom + 1 && box.top >= panel.top - 1;
});
if (!reachable) fail("the last article is drawn outside the list panel — it cannot be reached");
else ok("and the last of them can actually be scrolled to");

/**
 * Authored schedule dates are UTC calendar dates. Rendering them in local time
 * shows 2026-07-27T00:00Z as "26 July" west of Greenwich, so a banner article
 * would advertise a run ending the day before the data says it does.
 */
const dateCheck = await page.evaluate(async () => {
  const { bannerById, runEnd } = await import("/src/game/economy/banner/index.ts");
  const banner = bannerById("second-funeral");
  const ends = new Date(runEnd(banner.runs[0]));
  const day = String(ends.getUTCDate());
  const article = window.hypeboundNews.list().find((a) => a.id === "second-funeral-live");
  return { day, ok: article.body.join(" ").includes(` ${day} `) || article.body.join(" ").includes(`${day} `) };
});
if (!dateCheck.ok) fail(`the article does not name the run's real end day (${dateCheck.day})`);
else ok(`schedule dates read in UTC — the run ends on day ${dateCheck.day} everywhere`);

const unreadBefore = await page.evaluate(() => window.hypeboundNews.unread());
const categories = [...new Set(listed.map((a) => a.category))];
await page.evaluate((c) => window.hypeboundNews.filter(c), categories[0]);
const filtered = await page.locator(".news-row").count();
const expected = listed.filter((a) => a.category === categories[0]).length;
if (filtered !== expected) fail(`filtering to "${categories[0]}" showed ${filtered}, expected ${expected}`);
else ok(`the "${categories[0]}" chip filters to ${filtered}`);
await page.evaluate(() => window.hypeboundNews.filter(""));

await page.evaluate(() => window.hypeboundNews.readAll());
const unreadAfter = await page.evaluate(() => window.hypeboundNews.unread());
if (unreadAfter !== 0) fail(`"mark all read" left ${unreadAfter} unread`);
else ok(`"mark all read" cleared ${unreadBefore} unread`);

const deferred = await page.evaluate(() => window.hypeboundNews.deferred());
const noteText = await page.locator(".news-note").innerText();
for (const entry of deferred) {
  if (!noteText.includes(entry.name)) fail(`the missing "${entry.name}" category is not accounted for on screen`);
}
if (deferred.length > 0) ok(`and says why there is no ${deferred.map((d) => d.name).join(", ")} feed`);

await page.screenshot({ path: path.join(OUT, "news.png") });

// --- 3. a deep link ---------------------------------------------------------------
console.log("\n3. An article's deep link goes where it says");
const linked = listed.find((a) => a.link && a.link.screen !== "patchnotes");
if (!linked) fail("no article carries a deep link");
else {
  await page.evaluate((id) => window.hypeboundNews.open(id), linked.id);
  await page.locator("#news-link").click();
  await page.waitForTimeout(600);
  const landed = await page.evaluate(() => window.location.hash);
  if (!landed.includes(linked.link.screen)) fail(`"${linked.title}" points at #${linked.link.screen}, landed on ${landed}`);
  else ok(`"${linked.title}" opens ${landed}`);
}

// --- 4. patch notes ---------------------------------------------------------------
console.log("\n4. Patch notes");
await page.goto("http://localhost:5173/#patchnotes", { waitUntil: "networkidle" });
await settleOn(".patch-screen");

const shownVersion = (await page.locator("#patch-version").innerText()).trim();
const dataVersion = await page.evaluate(() => window.hypeboundPatch.version());
if (shownVersion !== dataVersion) fail(`the header shows ${shownVersion}, the data says ${dataVersion}`);
else ok(`the client displays its data version — ${shownVersion} (policy F1)`);

const releases = await page.evaluate(() => window.hypeboundPatch.releases());
if (releases.length === 0) fail("no releases");
else if (releases[0].empty) fail("the shipped release records nothing at all");
else {
  ok(`${releases.length} release: ${releases[0].version} "${releases[0].headline}"`);
  ok(`  ${releases[0].rules} rules, ${releases[0].systems} systems, ${releases[0].fixes} fixes`);
}

const body = await page.locator(".patch-release").innerText();
for (const heading of ["Cards changed", "Economy", "Rules", "Systems", "Fixed"]) {
  if (!body.includes(heading)) fail(`§4.2.3's "${heading}" section is missing`);
}
ok("all of §4.2.3's sections are present");

/**
 * The economy table has two modes and the page picks between them.
 *
 * With nothing changed since the previous release it prints the **snapshot** —
 * the shipped numbers, which is the whole claim. With a real diff it prints
 * **what changed**, before and after.
 *
 * This check used to assume the first mode, because there was one release and
 * nothing to diff against. A second release made the page correctly switch to
 * the diff, and the check failed while the page was right — so it now asserts
 * whichever contract is actually in force, and that every row it prints agrees
 * with the shipped balance.
 */
const printed = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const economy = getContent().balance.economy;
  const at = (path) => path.split(".").reduce((node, key) => (node === undefined ? undefined : node[key]), economy);
  const rows = [...document.querySelectorAll(".patch-table tbody tr")].map((row) => ({
    text: row.innerText.replace(/\s+/g, " ").trim(),
    cells: [...row.querySelectorAll("td")].map((cell) => cell.innerText.trim()),
  }));
  /**
   * Case-insensitively: the header cells are uppercased in CSS, and `innerText`
   * returns the *rendered* text, so a check for "Before" never matches "BEFORE".
   */
  const headers = [...document.querySelectorAll(".patch-table thead th")].map((th) =>
    th.innerText.trim().toLowerCase()
  );
  const isDiff = headers.includes("before") && headers.includes("after");

  return {
    rows: rows.length,
    isDiff,
    // in either mode the LAST column is the value this build actually ships
    disagreeing: rows
      .map((row) => ({ path: row.cells[0], shown: row.cells[row.cells.length - 1] }))
      .filter((row) => row.path && String(at(row.path)) !== row.shown)
      .map((row) => `${row.path}: page says ${row.shown}, balance says ${at(row.path)}`),
    hasPullPrice: rows.some((row) => row.text.includes("banner.pullPrice") && row.text.includes(String(economy.banner.pullPrice))),
  };
});

if (printed.rows === 0) fail("the economy table is empty");
else if (printed.disagreeing.length > 0) {
  fail(`the economy table contradicts balance.json: ${printed.disagreeing.slice(0, 3).join("; ")}`);
} else if (printed.isDiff) {
  ok(`the economy table prints ${printed.rows} changed value(s), every one agreeing with the shipped balance`);
} else if (!printed.hasPullPrice) {
  fail("the snapshot does not print the shipped values");
} else {
  ok(`the economy snapshot prints ${printed.rows} shipped values, including the banner pull price`);
}

const search = await page.evaluate(() => {
  window.hypeboundPatch.search("Burnout");
  return document.querySelector(".patch-release").innerText.includes("Burnout");
});
if (!search) fail("search found nothing for a term that is in the notes");
else ok('search narrows the notes ("Burnout" is a rule)');
await page.evaluate(() => window.hypeboundPatch.search(""));

const noFilter = await page.locator(".patch-nofilter").count();
if (releases[0].cards === 0 && noFilter === 0) fail("no card changes, and no explanation of the missing faction filter");
else if (releases[0].cards === 0) ok("the absent faction filter explains itself");

// --- 5. the card diff renderer ------------------------------------------------------
console.log("\n5. The before/after frames, driven with a card that has not actually changed");
const diff = await page.evaluate(async () => {
  const { getContent } = await import("/src/engine/content.ts");
  const card = Object.values(getContent().cards).find((c) => c.type === "character" && !c.token);
  const result = window.hypeboundPatch.previewDiff(card.id, { cost: card.cost + 2, attack: (card.attack ?? 0) + 1 });
  return { ...result, cardId: card.id, cost: card.cost };
});
if (!diff) fail("previewDiff returned nothing");
else if (!(diff.before > 0) || !(diff.after > 0)) fail(`the frames did not draw (${diff.before} × ${diff.after})`);
else if (diff.changed.length !== 2) fail(`patching two fields changed ${diff.changed.length}`);
else ok(`both frames drew for ${diff.cardId} (${diff.changed.join(", ")} patched, ${diff.before}px wide)`);

await page.screenshot({ path: path.join(OUT, "patch-notes.png") });

// --- 6. the inbox announcement -------------------------------------------------------
console.log("\n6. The inbox announces the articles nothing else announces");
await page.goto("http://localhost:5173/#inbox", { waitUntil: "networkidle" });
await settleOn(".inbox-screen");
const mail = await page.evaluate(() => window.hypeboundInbox.list());
const announcements = mail.filter((m) => m.topic === "news");
const subjects = new Set(mail.map((m) => m.subject));
if (subjects.size !== mail.length) fail("two messages carry the same headline");
else ok(`${mail.length} messages, ${announcements.length} of them announcements, none duplicated`);

const bannerMail = mail.filter((m) => m.topic === "banner").map((m) => m.subject);
const announcedBanner = announcements.filter((m) => bannerMail.includes(m.subject));
if (announcedBanner.length > 0) fail("an article duplicates a message the banner sender already posted");
else ok("an article about a banner is left to the banner sender");

console.log(`\n   saved screenshots/news.png and patch-notes.png`);

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of errors.slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
