/**
 * Does a save actually follow you to another machine?
 *
 * Nothing short of two independent browsers can answer that. A unit test can
 * prove `decideSync` picks the right branch and a server test can prove
 * `applyPut` refuses the wrong revision, but the question a player is really
 * asking — *will my collection be there* — is about two storage areas, a
 * network, a token and a screen, and it has been wrong before in exactly the
 * places that only appear when all four are real. The CORS preflight for
 * `If-Match` is the current example: correct in every server-side test,
 * and an opaque "Failed to fetch" in a browser.
 *
 * The shape:
 *
 *   A. a fresh browser makes an account, plays, and its save goes up
 *   B. a second fresh browser with a *different* save signs in to the same
 *      account, is asked which to keep, and chooses the cloud
 *   C. the save that was replaced is still recoverable on B
 *   D. deleting the account removes the save from the server too
 *
 * Step B is the one worth the wall-clock. It is the only path where the game
 * overwrites a real collection, and the only one with a person in it.
 *
 * Not part of `npm test`: it creates and destroys real accounts against the
 * live project. Run by hand, with a dev server on :5173.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const STAMP = String(Math.floor(Math.random() * 1e9));
const EMAIL = `hypebound-cloud-${STAMP}@example.com`;
const PASSWORD = "cloud-save-password";
/** Written into the profile so it can be recognised on the other machine. */
const MARKER = `marker-${STAMP}`;

let failures = 0;
const ok = (m) => console.log(`   ok: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`   FAIL: ${m}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

/** A browser with its own storage — the whole point is that they share nothing. */
async function freshMachine(label) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`   [${label}] page error: ${e.message.slice(0, 160)}`));
  return page;
}

/** Choose a starter deck, which is what creates a non-default profile. */
async function startPlaying(page, faction) {
  await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
  await page.waitForSelector(".starter-screen", { timeout: 20000 });
  await page.evaluate((f) => window.hypeboundStarter?.choose(f), faction);
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });
}

const profileOf = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("hypebound:profile");
    return raw ? JSON.parse(raw).data : null;
  });

/**
 * Wait for the profile to reach localStorage.
 *
 * The store debounces writes by 250 ms, so reading straight after choosing a
 * starter deck is a race — one this script lost, and lost invisibly: `null`
 * read as "machine B has no independent save", which then made the archive
 * comparison compare two undefineds and fail for a second wrong reason.
 */
async function waitForProfile(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const profile = await profileOf(page);
    if (profile) return profile;
    await page.waitForTimeout(100);
  }
  return null;
}

/** Ask the server what it holds, using the page's own session. */
const manifestFrom = (page) =>
  page.evaluate(async () => {
    const { ONLINE } = await import("/src/config.ts");
    const session = JSON.parse(localStorage.getItem("hypebound-auth:session") ?? "null");
    if (!session) return { error: "signed out" };
    const response = await fetch(`${ONLINE.serverUrl}/me/saves`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) return { error: `status ${response.status}` };
    return await response.json();
  });

async function waitForSection(page, section, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const manifest = await manifestFrom(page);
    const found = manifest?.sections?.find((s) => s.section === section);
    if (found) return found;
    await page.waitForTimeout(1000);
  }
  return null;
}

console.log(`\nHYPEBOUND cloud saves — ${EMAIL}\n`);

try {
  // -------------------------------------------------------------------------
  console.log("A. A fresh machine makes an account and its save goes up");
  const a = await freshMachine("A");
  await startPlaying(a, "neon-idols");
  await waitForProfile(a);

  /**
   * A recognisable mark, written through the store rather than around it.
   *
   * Two earlier versions of this script edited `localStorage` directly and both
   * were wrong, in a way worth recording because it looks exactly like a sync
   * bug. `Store` keeps an in-memory cache, and `flushAllStores()` is wired to
   * `pagehide` — so any navigation writes that cache back over a direct edit,
   * and the edit is gone before the next document reads it. The game then
   * uploads what it was still holding, and the server ends up with a profile
   * that disagrees with this browser's storage.
   *
   * Going through `profileStore.update` puts the value in the cache and the
   * storage at once, which is what the game itself does everywhere.
   */
  await a.evaluate(async (marker) => {
    const { profileStore } = await import("/src/save/profile.ts");
    profileStore.update((profile) => {
      profile.displayName = marker;
      profile.clout = 4242;
    });
    profileStore.flush();
  }, MARKER);

  /**
   * And then reload, which is belt as well as braces.
   *
   * Writing through the store fixes the cache-versus-storage problem, but a
   * module imported from `page.evaluate` is not guaranteed to be the same
   * instance the application is holding — and when it is not, the marker lands
   * in a store nothing uploads from. That failure is invisible from inside the
   * page: storage shows the marker, the game uploads the old profile, and the
   * two disagree with no error anywhere.
   *
   * A reload settles it. Both instances flush on `pagehide`, the marked one
   * writes last because it registered last, and the new document constructs
   * exactly one store from what is on disk.
   */
  await a.reload({ waitUntil: "networkidle" });

  const marked = await profileOf(a);
  if (marked?.displayName === MARKER && marked?.clout === 4242) {
    ok("the save is marked, and one store holds it after a reload");
  } else {
    fail(`the marker did not take: ${JSON.stringify(marked)?.slice(0, 120)}`);
  }

  await a.goto(`${ORIGIN}/#signin`, { waitUntil: "networkidle" });
  await a.waitForSelector(".signin-screen");
  await a.click("#signin-toggle");
  await a.fill("#signin-email", EMAIL);
  await a.fill("#signin-password", PASSWORD);
  await a.click("#signin-submit");
  await a.waitForSelector(".queue-screen", { timeout: 30000 });
  ok("account created, and the queue was reached without an adoption prompt");

  const uploaded = await waitForSection(a, "profile");
  if (uploaded) ok(`profile uploaded at revision ${uploaded.revision} (${uploaded.bytes} bytes)`);
  else fail("the profile never reached the server");

  const localA = await profileOf(a);
  if (localA?.displayName === MARKER) ok("machine A still has its own save, unmodified");
  else fail(`machine A's marker is "${localA?.displayName}"`);

  /**
   * What the server actually received, read back rather than assumed.
   *
   * The first run of this script inferred from a byte count that the upload was
   * missing the marker, which sent the investigation somewhere it did not need
   * to go. Reading the value is cheaper than reasoning about its length.
   */
  const roundTrip = await a.evaluate(async () => {
    const { SaveClient } = await import("/src/net/saveClient.ts");
    const pulled = await new SaveClient().pull("profile");
    if (pulled.kind !== "ok") return { kind: pulled.kind };
    return { kind: "ok", displayName: pulled.data.displayName, clout: pulled.data.clout };
  });
  if (roundTrip.kind === "ok" && roundTrip.displayName === MARKER && roundTrip.clout === 4242) {
    ok(`the server holds the marked save (clout ${roundTrip.clout})`);
  } else {
    fail(`the server holds ${JSON.stringify(roundTrip)}`);
  }

  // -------------------------------------------------------------------------
  console.log("\nB. A second machine, its own save, the same account");
  const b = await freshMachine("B");
  await startPlaying(b, "gothic-royalty");

  const beforeB = await waitForProfile(b);
  if (beforeB && beforeB.displayName !== MARKER) {
    ok(`machine B starts with a save of its own (${beforeB.decks?.length ?? 0} deck(s), clout ${beforeB.clout})`);
  } else {
    fail(`machine B did not get an independent save: ${JSON.stringify(beforeB)?.slice(0, 120)}`);
  }

  await b.goto(`${ORIGIN}/#signin`, { waitUntil: "networkidle" });
  await b.waitForSelector(".signin-screen");
  await b.fill("#signin-email", EMAIL);
  await b.fill("#signin-password", PASSWORD);
  await b.click("#signin-submit");

  /**
   * The assertion this script exists for: two real saves must produce a
   * question, not a silent overwrite in either direction.
   */
  const asked = await b
    .waitForSelector(".cloud-save-screen", { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (asked) ok("it stopped and asked which save to keep");
  else fail("no adoption screen — one of the two saves was about to be chosen silently");

  if (asked) {
    /**
     * Wait for the download before reading the comparison.
     *
     * The screen paints immediately with the cloud side marked "Fetching it…"
     * and fills it in when the pull returns, which is the right behaviour — a
     * blank screen while a network call runs is worse. It does mean a check
     * that reads the text the instant the screen appears reads the placeholder,
     * and the first version of this script did exactly that and accused the
     * screen of not showing a save it was in the middle of fetching.
     */
    await b
      .waitForFunction(() => document.querySelectorAll(".cloud-save-table").length >= 2, { timeout: 30000 })
      .catch(() => {});

    // Both sides must be described, or the choice is not an informed one.
    const shown = await b.evaluate(() => document.querySelector(".cloud-save-compare")?.textContent ?? "");
    /**
     * `\D?` for the thousands separator, not a comma.
     *
     * The screen formats with `toLocaleString()`, so the separator is whatever
     * the machine's locale uses — here a narrow no-break space, which is not a
     * comma and is not a normal space either. A test that hard-codes `4,242`
     * passes in one locale and fails in another while the page is correct in
     * both.
     */
    if (/4\D?242/.test(shown)) ok("the account's save is summarised by its contents, not by a device name");
    else fail(`the comparison does not show the cloud save: ${shown.replace(/\s+/g, " ").slice(0, 180)}`);

    await b.evaluate(() => window.hypeboundCloudSave?.choose("cloud"));
    const landed = await b
      .waitForSelector(".queue-screen", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!landed) {
      // Still on the adoption screen means the choice reported a problem, and
      // the screen's own status line is the most direct account of what.
      const status = await b.evaluate(() => window.hypeboundCloudSave?.status?.() ?? "(no status)");
      fail(`choosing the cloud save did not complete: ${status}`);
    }
  }

  const afterB = await profileOf(b);
  if (afterB?.displayName === MARKER && afterB?.clout === 4242) {
    ok(`machine B now holds machine A's save (clout ${afterB.clout})`);
  } else {
    fail(`machine B has displayName "${afterB?.displayName}", clout ${afterB?.clout}`);
  }

  // -------------------------------------------------------------------------
  console.log("\nC. The save that was replaced is still recoverable");
  const archived = await b.evaluate(() => {
    const raw = localStorage.getItem("hypebound:cloud-archive:profile");
    return raw ? JSON.parse(raw) : null;
  });
  if (archived?.data?.displayName === beforeB?.displayName) ok("B's own save was kept aside before being replaced");
  else fail("the replaced save was not archived, so it is gone");

  /**
   * The export hook only exists while the privacy screen is mounted, so this
   * has to be on that screen to ask. The first version asked from the queue
   * screen, got `undefined`, and reported that the privacy page overstates its
   * own export — a false accusation produced entirely by asking in the wrong
   * place.
   */
  await b.goto(`${ORIGIN}/#privacy`, { waitUntil: "networkidle" });
  await b.waitForSelector(".privacy-screen");
  const inExport = await b.evaluate(() => {
    const text = window.hypeboundPrivacy?.exportText?.() ?? "";
    return { has: text.includes("cloud-archive"), hooked: Boolean(window.hypeboundPrivacy) };
  });
  if (inExport.has) ok("and the export on the privacy page includes it, as that page claims");
  else fail(`the archive is not in the export (hook present: ${inExport.hooked})`);

  // -------------------------------------------------------------------------
  console.log("\nD. Deleting the account removes the save from the server");
  await b.evaluate(() => {
    localStorage.removeItem("__e2e_alert");
    window.prompt = () => "DELETE";
    window.alert = (m) => localStorage.setItem("__e2e_alert", String(m));
  });
  await b.click("#privacy-delete-online");
  await b.waitForFunction(() => localStorage.getItem("__e2e_alert") !== null, { timeout: 30000 }).catch(() => {});
  const said = await b.evaluate(() => localStorage.getItem("__e2e_alert") ?? "(nothing)");
  console.log(`   the page said: "${said}"`);
  if (/uploaded save/i.test(said)) ok("and it says the uploaded save went with it");
  else fail(`the message does not mention the save: ${said}`);

  /**
   * Checked from machine A, which still holds a valid token. Asking the browser
   * that just deleted itself would prove nothing — it has no session left, so
   * every answer would look like success.
   */
  const leftover = await manifestFrom(a);
  if (leftover?.error) {
    ok(`machine A can no longer read the save either (${leftover.error})`);
  } else if ((leftover?.sections?.length ?? 0) === 0) {
    ok("the server holds no sections for that account any more");
  } else {
    fail(`the server still holds ${leftover.sections.length} section(s) after account deletion`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nPASS — a save crosses machines, and deleting the account takes it back." : `\nFAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
