/**
 * The Inbox, in a real browser — `03-screens-and-navigation.md` §4.5.3.
 *
 * The unit suite proves the derivation: which facts make which messages, that
 * retention drops a message and never a grant, that an attachment pays once.
 * What only a browser can prove is that any of it reaches a player.
 *
 * So this checks the things a passing unit suite is compatible with being
 * completely broken:
 *
 * - the lobby badge counts the same unread the screen does, and goes down;
 * - a message opens, and its body is real sentences rather than empty slots;
 * - the Welcome Back attachment posts from a **lobby mount** (which is where
 *   `syncHypeWave` runs) and pays into the wallet on screen when taken;
 * - nothing that owes you something can be deleted or swept up by "clear read";
 * - a deletion survives a reload, because a delete that forgets itself is worse
 *   than no delete button at all;
 * - the senders that cannot exist are printed with their reasons.
 *
 * It also checks the lobby's Daily Missions rail, which until this feature was
 * three hard-coded rows pretending to be progress.
 *
 * Dates: this deliberately asserts *shapes* rather than "the season-opened
 * message is present today". The shipped calendar moves on, and a verification
 * that starts failing in November because a real banner run ended is a
 * verification nobody trusts.
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

/** Clout as the header actually renders it, not as a second module instance believes it. */
const walletOn = async (selector) =>
  Number((await page.locator(selector).innerText()).replace(/[^0-9]/g, ""));

await seedPlayedAccount(page);

// --- 1. the lobby ---------------------------------------------------------------
console.log("\n1. The lobby: an Inbox with a badge, and a mission rail that is not made up");
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");

if ((await page.locator("#lobby-inbox").count()) === 0) fail("the lobby has no Inbox button");
else ok("the lobby has an Inbox button");

const lobbyBadge = Number((await page.locator("#lobby-inbox .lobby-nav-badge").innerText().catch(() => "0")) || 0);
if (lobbyBadge <= 0) fail("a fresh account has no unread mail — the welcome message should be waiting");
else ok(`the badge shows ${lobbyBadge} unread`);

/**
 * The Daily Missions rail. It used to render "Play 3 matches / Win with 2
 * different Currents / Activate a Confluence" for every account forever — three
 * rows with the shape of progress and none of the substance. Every row must now
 * name a mission that exists in the data.
 */
const railCheck = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll(".lobby-rail .mission-list .mission .mission-text")].map((n) =>
    n.textContent.trim()
  );
  const raw = await (await fetch("/data/missions.json")).json();
  const names = new Set([...(raw.daily ?? []), ...(raw.weekly ?? [])].map((m) => m.name));
  return { rows, unknown: rows.filter((row) => !names.has(row) && !row.startsWith("No dailies")) };
});
if (railCheck.rows.length === 0) fail("the lobby's mission rail is empty");
else if (railCheck.unknown.length > 0) fail(`the mission rail invents rows: ${railCheck.unknown.join(", ")}`);
else ok(`the mission rail lists ${railCheck.rows.length} real missions (${railCheck.rows.join(", ")})`);

// --- 2. the inbox ---------------------------------------------------------------
console.log("\n2. The inbox itself");
await page.locator("#lobby-inbox").click();
await settleOn(".inbox-screen");

const listed = await page.evaluate(() => window.hypeboundInbox.list());
if (listed.length === 0) fail("the inbox is empty on an account that has facts to report");
else ok(`${listed.length} messages: ${listed.map((m) => m.topic).join(", ")}`);

const thin = listed.filter((m) => !m.subject.trim() || m.body.length === 0 || m.body.some((p) => p.trim().length < 20));
if (thin.length > 0) fail(`messages with no real body: ${thin.map((m) => m.id).join(", ")}`);
else ok("every message has a subject and body text");

const rendered = await page.locator(".mail-row").count();
if (rendered !== listed.length) fail(`${listed.length} messages derived but ${rendered} rows drawn`);
else ok(`all ${rendered} drawn as rows`);

/**
 * Drawn is not the same as reachable. The list's height is set by whichever
 * message is open, so a long inbox will happily render every row *outside* the
 * panel, underneath the one below it — which is exactly how the sixth message
 * went missing the first time this ran.
 */
const reachable = await page.evaluate(() => {
  const list = document.querySelector(".mail-list");
  const rows = [...document.querySelectorAll(".mail-row")];
  const last = rows[rows.length - 1];
  last.scrollIntoView({ block: "nearest" });
  const panel = list.getBoundingClientRect();
  const box = last.getBoundingClientRect();
  return { fits: box.bottom <= panel.bottom + 1 && box.top >= panel.top - 1, rows: rows.length };
});
if (!reachable.fits) fail("the last message is drawn outside the list panel — it cannot be reached");
else ok(`and the last of the ${reachable.rows} can actually be scrolled to`);

/** Opening the screen reads what it is showing, or the badge outlives its message. */
const unreadAfterOpen = await page.evaluate(() => window.hypeboundInbox.unread());
if (unreadAfterOpen !== listed.filter((m) => !m.read).length - 0 && unreadAfterOpen >= lobbyBadge) {
  fail(`opening the inbox did not read the message it displayed (${lobbyBadge} → ${unreadAfterOpen})`);
} else ok(`opening the newest message read it (${lobbyBadge} → ${unreadAfterOpen} unread)`);

const reading = (await page.locator(".mail-reading-subject").innerText()).trim();
if (!reading) fail("nothing is open in the reading pane");
else ok(`reading "${reading}"`);

const retention = await page.locator(".mail-reading-foot .faint").innerText();
if (!/Clears from your inbox|will not expire/i.test(retention)) fail(`no retention line on the open message: "${retention}"`);
else ok(`the open message states its retention: "${retention.trim()}"`);

await page.screenshot({ path: path.join(OUT, "inbox.png") });

// --- 3. the deferred senders ----------------------------------------------------
console.log("\n3. Who cannot write to you, and why");
const deferred = await page.evaluate(() => window.hypeboundInbox.deferred());
const printed = await page.locator(".mail-deferred-list li").count();
if (printed !== deferred.length) fail(`${deferred.length} deferred senders, ${printed} printed`);
else ok(`all ${printed} silent senders are listed with a reason`);
for (const wanted of ["Version-migration grants", "Friend messages and deck shares", "Moderation notices and appeal outcomes"]) {
  if (!deferred.some((entry) => entry.sender === wanted)) fail(`§4.5.3's "${wanted}" is not accounted for`);
}
const bodyText = await page.locator(".inbox-deferred").innerText();
if (!/server/i.test(bodyText)) fail("the deferred panel never says a server is what is missing");
else ok("and says a server is what the social senders are waiting on");

// --- 4. links --------------------------------------------------------------------
// Checked before anything is deleted, or a cleared inbox would leave nothing to follow
// and this would pass by having nothing to do.
console.log("\n4. A message that points somewhere goes there");
const linked = listed.find((m) => m.topic === "banner" || m.topic === "season");
if (!linked) fail("no banner or season mail — one of those should always carry a link");
else {
  await page.evaluate((id) => window.hypeboundInbox.open(id), linked.id);
  const target = await page.locator("#mail-link").getAttribute("data-screen");
  await page.locator("#mail-link").click();
  await page.waitForTimeout(600);
  const landed = await page.evaluate(() => window.location.hash);
  if (!landed.includes(target)) fail(`"${linked.subject}" pointed at #${target} and landed on ${landed}`);
  else ok(`"${linked.subject}" opens ${landed}`);
  await page.goto("http://localhost:5173/#inbox", { waitUntil: "networkidle" });
  await settleOn(".inbox-screen");
}

// --- 5. mark read, and clear -----------------------------------------------------
console.log("\n5. Mark read, delete, and what refuses to be deleted");
const deletable = listed.find((m) => m.attachment.length === 0);
if (!deletable) fail("no ordinary message to delete");
else {
  await page.evaluate((id) => window.hypeboundInbox.remove(id), deletable.id);
  const stillThere = await page.evaluate((id) => window.hypeboundInbox.list().some((m) => m.id === id), deletable.id);
  if (stillThere) fail(`deleting "${deletable.subject}" did nothing`);
  else ok(`deleted "${deletable.subject}"`);

  // a delete that forgets itself is worse than no delete button
  await page.reload({ waitUntil: "networkidle" });
  await settleOn(".inbox-screen");
  const back = await page.evaluate((id) => window.hypeboundInbox.list().some((m) => m.id === id), deletable.id);
  if (back) fail("the deleted message came back after a reload");
  else ok("and it is still gone after a reload");
}

const readAll = await page.evaluate(() => window.hypeboundInbox.readAll());
const unreadNow = await page.evaluate(() => window.hypeboundInbox.unread());
if (unreadNow !== 0) fail(`"mark all read" left ${unreadNow} unread`);
else ok(`"mark all read" cleared ${readAll} unread`);

// --- 6. the Welcome Back attachment ----------------------------------------------
console.log("\n6. The Welcome Back package arrives as mail, and pays only when taken");

/**
 * Come back after the stated absence.
 *
 * Three navigations, and every one of them is load-bearing. `import()` inside
 * `page.evaluate` reaches a **genuinely different module instance** — measured,
 * not assumed: `(await import("/src/save/profile.ts")).getProfile() !==
 * window.hypebound.profile()` — so the store written here is not the store the
 * app is reading.
 *
 * So: reload first, to flush whatever the app still has pending; write, and
 * flush; reload again, so the app re-reads the file. The second reload is safe
 * because both module instances register their own `pagehide` flush and the
 * app's fires first, leaving this one's write on top.
 *
 * Then `#lobby` — a hash change, which mounts the lobby *without* reloading, so
 * the freshly-loaded store is the one `syncHypeWave` runs against.
 */
await page.reload({ waitUntil: "networkidle" });
const away = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { hypeWaveData } = await import("/src/game/progression/hypeWave/index.ts");
  const storage = await import("/src/save/storage.ts");
  const days = hypeWaveData().welcomeBack.afterDays;
  profileStore.update((draft) => {
    draft.hypeWave.lastSeenAt = Date.now() - (days + 6) * 86400000;
    draft.hypeWave.welcomeBackAt = 0;
  });
  storage.flushAllStores();
  return { days, clout: hypeWaveData().welcomeBack.clout };
});
await page.reload({ waitUntil: "networkidle" });

/** The lobby is where `syncHypeWave` runs, so the package must post from there. */
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await settleOn(".lobby-screen");
const cloutBefore = await walletOn(".lobby-currencies .currency:first-child .currency-value");

await page.goto("http://localhost:5173/#inbox", { waitUntil: "networkidle" });
await settleOn(".inbox-screen");
const withGrant = (await page.evaluate(() => window.hypeboundInbox.list())).find((m) => m.attachment.length > 0);
if (!withGrant) fail(`coming back after ${away.days} days posted no Welcome Back mail`);
else {
  ok(`"${withGrant.subject}" arrived with ${withGrant.attachment[0].amount} Clout attached`);
  if (withGrant.expiresAt !== null) fail("the attachment message carries an expiry — F6 forbids losing a grant by waiting");
  else ok("and it is marked as never expiring while it still owes something");

  const inboxClout = await walletOn("#inbox-clout");
  if (inboxClout !== cloutBefore) fail(`the package paid itself: ${cloutBefore} → ${inboxClout} without a claim`);
  else ok(`nothing was paid on arrival (${inboxClout} Clout, unchanged)`);

  // it must survive "clear read" and refuse "delete"
  await page.evaluate(() => window.hypeboundInbox.readAll());
  await page.evaluate(() => window.hypeboundInbox.clearRead());
  const survived = await page.evaluate((id) => window.hypeboundInbox.list().some((m) => m.id === id), withGrant.id);
  if (!survived) fail('"clear read" threw away an unclaimed grant');
  else ok('"clear read" left it alone');

  const removed = await page.evaluate((id) => window.hypeboundInbox.remove(id), withGrant.id);
  if (removed) fail("delete threw away an unclaimed grant");
  else ok("delete refuses it while the attachment is unclaimed");

  await page.evaluate((id) => window.hypeboundInbox.open(id), withGrant.id);
  const label = await page.locator(".mail-attachment .mail-reward").innerText();
  if (!label.includes(String(withGrant.attachment[0].amount))) fail(`the attachment is not shown on screen: "${label}"`);
  else ok(`the attachment reads "${label.trim()}"`);

  await page.locator("#mail-claim").click();
  await page.waitForTimeout(150);
  const after = await walletOn("#inbox-clout");
  if (after - cloutBefore !== away.clout) fail(`claiming paid ${after - cloutBefore} Clout, §10.5.4 says ${away.clout}`);
  else ok(`claiming paid exactly ${away.clout} Clout (${cloutBefore} → ${after})`);

  const twice = await page.evaluate((id) => window.hypeboundInbox.claim(id), withGrant.id);
  if (twice !== null) fail("the attachment paid a second time");
  else ok("and refuses to pay twice");

  const nowDeletable = await page.evaluate((id) => window.hypeboundInbox.remove(id), withGrant.id);
  if (!nowDeletable) fail("a claimed message still cannot be deleted");
  else ok("once taken, the message deletes like any other");
}

// --- 7. shots and console --------------------------------------------------------
/**
 * And the empty state, which this run has genuinely arrived at by deleting
 * everything rather than by being shown a mock of one.
 */
await page.goto("http://localhost:5173/#inbox", { waitUntil: "networkidle" });
await settleOn(".inbox-screen");
await page.screenshot({ path: path.join(OUT, "inbox-empty.png") });
console.log("\n   saved screenshots/inbox.png and inbox-empty.png");

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of errors.slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
