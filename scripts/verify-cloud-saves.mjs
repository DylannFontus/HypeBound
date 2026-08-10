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
 *   D. **the owner's report**: A plays, B plays, A comes back and must have B's
 *      progress — including the case where both played while apart
 *   E. deleting the account removes the save from the server too
 *
 * Step B is the one worth the wall-clock. It is the only path where the game
 * overwrites a real collection, and the only one with a person in it. Step D is
 * the one this feature was actually being used for.
 *
 * Not part of `npm test`: it creates and destroys real accounts against the
 * live project. Run by hand, with a dev server on :5173.
 *
 * ## Four ways this script has measured nothing, and what it does about them
 *
 * Every one of these produced a confident answer rather than an error.
 *
 * 1. **`page.goto(origin + "#play")` is not a reload.** From any other hash it
 *    is a same-document navigation, so "the player reopened the game" never
 *    started a new document and the boot-time sync never ran — which made a
 *    working build look broken. `reopen()` uses `page.reload()` and counts the
 *    `load` events to prove exactly one document arrived.
 * 2. **The dev server hot-reloads the page out from under the scenario.** With
 *    other work going on in the repo, a save to any file full-reloads every
 *    open page; that is what destroyed an execution context mid-run and what
 *    put two boots inside one "reopen". The Vite HMR socket is intercepted.
 * 3. **`bringToFront()` does not change `document.visibilityState`** in
 *    headless Chromium — measured: `visible` before and after, and not one
 *    `visibilitychange` event. A backgrounding test built on it would have
 *    asserted nothing at all. `background()`/`foreground()` therefore drive the
 *    property and the event directly, and assert the app's own listener ran.
 *    The `online` trigger, by contrast, is genuinely fired by the browser via
 *    `context.setOffline`, so at least one of the three return paths is
 *    exercised end to end without simulation.
 * 4. **A module imported inside `page.evaluate` need not be the one the app is
 *    using.** If it is not, a write "through the store" lands in a store
 *    nothing uploads from and every subsequent assertion is about a phantom.
 *    `assertOneStore` compares the imported store's object identity against
 *    `window.hypebound.profile()`, which the running application hands out.
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
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

const loads = new Map();

/** A browser with its own storage — the whole point is that they share nothing. */
async function freshMachine(label) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  loads.set(label, 0);
  /**
   * Silence hot module replacement.
   *
   * The dev server reloads every open page when any file in the repo changes,
   * and a reload arriving in the middle of a scenario is indistinguishable from
   * the application reloading itself. It has already cost this script one
   * destroyed execution context and one scenario that quietly ran twice.
   */
  await page.routeWebSocket(/localhost:5173/, () => {});
  page.on("load", () => loads.set(label, loads.get(label) + 1));
  page.on("pageerror", (e) => console.log(`   [${label}] page error: ${e.message.slice(0, 160)}`));
  page.label = label;
  return page;
}

/**
 * Reopening the game — a real document load, not a hash change.
 *
 * The count is the guard. `page.goto` to a URL that differs only in its hash is
 * a same-document navigation, so the boot path never runs, and a script that
 * calls that "reopening" is testing nothing while reporting a pass.
 */
async function reopen(page, settleMs = 7000) {
  const before = loads.get(page.label);
  /**
   * `domcontentloaded` and then a fixed settle, rather than `networkidle`.
   *
   * Network idleness is not a property of this application: it holds live
   * connections and the dev server is shared with whatever else is being worked
   * on, so `networkidle` timed out here on a page that had loaded perfectly
   * well. The `load` counter below is the actual gate, and it does not care how
   * busy the socket was.
   */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settleMs);
  const after = loads.get(page.label);
  if (after !== before + 1) throw new Error(`[${page.label}] expected one document load, saw ${after - before}`);
}

/**
 * Is the store this script writes through the one the application holds?
 *
 * `window.hypebound.profile` is `getProfile`, which returns the live store's
 * cache object, so reference equality settles it. Without this check a
 * duplicated module would make every write here land somewhere the game never
 * uploads from — storage would show the change, the sync would upload the old
 * value, and the two would disagree with no error anywhere.
 */
async function assertOneStore(page) {
  const verdict = await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    if (typeof window.hypebound?.profile !== "function") return "no-handle";
    return window.hypebound.profile() === profileStore.get() ? "shared" : "duplicated";
  });

  if (verdict === "shared") {
    ok(`[${page.label}] this script and the game share one profile store`);
    return true;
  }
  if (verdict === "duplicated") {
    fail(`[${page.label}] the imported store is a second copy — every assertion below is about a phantom`);
    return false;
  }
  /**
   * A third answer, and the reason this check is not a boolean.
   *
   * The first version of it read `window.hypebound?.profile?.() === store.get()`
   * and reported machine B as a duplicated module. It was not: `main.ts`
   * **returns early from boot** when a browser still needs to pick a starter
   * deck, before it publishes the debug handle — so a browser that has not
   * reloaded since choosing one has no handle to compare against, and
   * `undefined === anObject` is false for a reason that has nothing to do with
   * module identity. Collapsing "cannot tell" into "duplicated" is how an
   * instrument accuses the thing it is measuring.
   */
  fail(`[${page.label}] the game has not published its debug handle, so store identity cannot be checked here`);
  return false;
}

/**
 * Finish a match, as far as the sync layer can tell.
 *
 * The sync layer sees store mutations and nothing else, so a real match and
 * this differ only in how long they take. Written through `update` for the
 * reason recorded above: a direct `localStorage` edit is overwritten by the
 * in-memory cache on the next flush.
 */
async function playMatch(page, { id, clout }) {
  await page.evaluate(
    async (match) => {
      const { profileStore } = await import("/src/save/profile.ts");
      profileStore.update((profile) => {
        profile.clout = (profile.clout ?? 0) + match.clout;
        profile.stats.matchesPlayed = (profile.stats.matchesPlayed ?? 0) + 1;
        profile.history = [
          {
            id: match.id,
            playedAt: Date.now(),
            deckName: "verify",
            leaderCardId: "l",
            opponentLeaderCardId: "o",
            result: "win",
            turns: 7,
            mode: "casual",
          },
          ...(profile.history ?? []),
        ];
      });
      profileStore.flush();
    },
    { id, clout }
  );
  const written = await profileOf(page);
  if (!written?.history?.some((entry) => entry.id === id)) {
    fail(`[${page.label}] the match write never reached storage`);
  }
}

/**
 * Put the tab in the background, and prove the application noticed.
 *
 * The property is overridden rather than genuinely changed because headless
 * Chromium does not background a tab when another is brought to the front —
 * measured, `visible` before and after, zero events. What is under test is the
 * listener and everything downstream of it, which this exercises exactly; that
 * the browser fires `visibilitychange` at all is platform behaviour and not
 * this build's to prove.
 */
async function background(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.__hbSawHidden = false;
    document.addEventListener("visibilitychange", () => (window.__hbSawHidden = document.visibilityState === "hidden"), { once: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const seen = await page.evaluate(() => window.__hbSawHidden === true);
  if (!seen) fail(`[${page.label}] the page never saw itself go to the background`);
}

async function foreground(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

/** Poll until a condition holds, so a wait is never a guess about a duration. */
async function until(page, describe, predicate, timeoutMs = 45000, stepMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) {
      fail(`${describe} (waited ${(timeoutMs / 1000).toFixed(0)}s)`);
      return false;
    }
    await page.waitForTimeout(stepMs);
  }
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

/**
 * The profile as the *server* holds it, read with a raw fetch.
 *
 * Deliberately not through `SaveClient`: this is the independent witness the
 * assertions are checked against, and a witness that shares a module with the
 * thing under test is not one.
 */
/**
 * Read once, up front, and never inside a scenario.
 *
 * `import("/src/config.ts")` is a request to the dev server, so a reader that
 * fetched the config each time threw `Failed to fetch` the moment a machine was
 * put offline — reporting a broken script where the intended answer was "this
 * device cannot reach the save service", which is the whole point of that step.
 */
let SERVER_URL = "";

const cloudProfile = (page) =>
  page.evaluate(async (base) => {
    const session = JSON.parse(localStorage.getItem("hypebound-auth:session") ?? "null");
    if (!session) return { error: "signed out" };
    try {
      const response = await fetch(`${base}/me/saves/profile`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (response.status === 404) return { absent: true };
      if (!response.ok) return { error: `status ${response.status}` };
      const body = await response.json();
      const data = JSON.parse(body.payload);
      return {
        revision: body.revision,
        clout: data.clout,
        matches: data.stats?.matchesPlayed,
        history: (data.history ?? []).map((entry) => entry.id),
      };
    } catch {
      // Unreachable is an answer, not a crash: it is what "this device is
      // offline" looks like from here, and a step below asserts on exactly it.
      return { error: "unreachable" };
    }
  }, SERVER_URL);

const localHistory = async (page) => ((await profileOf(page))?.history ?? []).map((entry) => entry.id);

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
  SERVER_URL = await a.evaluate(async () => (await import("/src/config.ts")).ONLINE.serverUrl);
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
  /**
   * The scenario the owner reported, in the owner's words: play on one device,
   * play on another with the same account, come back to the first.
   *
   * It failed for a reason that had nothing to do with the pull. `syncNow`
   * treated `conflict` as "do nothing", and nothing ever resolved a conflict —
   * so the first time both sides moved, that device stopped syncing in both
   * directions, permanently and silently. Measured before the fix: four
   * consecutive passes on the returning device, all four deciding `conflict`,
   * all four no-ops, while the other device's matches piled up on the server.
   *
   * D5 is the part that matters most. It is the case that used to wedge, and
   * the assertion is not "somebody won" — it is that *both* matches survive.
   */
  console.log("\nD. Progress made on a second device comes back to the first");

  /**
   * Both devices are reopened first, which is the state a real one is in.
   *
   * It also matters for a reason worth recording: a browser that has just
   * chosen a starter deck is still running the document that `main.ts`
   * **returned early** from — before the boot-time `syncNow`, before
   * `startAutoSync`, and before the debug handle. Machine B had been in that
   * state since scenario B, so it had auto-sync only because signing in started
   * it. A reload puts both devices on the ordinary boot path.
   */
  await reopen(a);
  await reopen(b);
  const storesAreShared = (await assertOneStore(a)) && (await assertOneStore(b));

  if (storesAreShared) {
    // --- D1: leaving pushes, rather than waiting out the debounce -----------
    const beforePush = Date.now();
    await playMatch(a, { id: "A-match-1", clout: 100 });
    await background(a);
    const pushed = await until(
      a,
      "A's match never reached the server after the tab went to the background",
      async () => (await cloudProfile(a))?.history?.includes("A-match-1"),
      20000
    );
    if (pushed) {
      const took = Date.now() - beforePush;
      ok(`A's match reached the server ${(took / 1000).toFixed(1)}s after going to the background`);
      // The debounce is 30s. Anything at or beyond it means the tab-away push
      // did not happen and the ordinary timer got there first, which is the
      // window that lets two devices diverge in the first place.
      if (took < 25000) ok("and it did not wait out the 30s upload debounce");
      else fail(`it waited ${(took / 1000).toFixed(1)}s, so leaving the page did not push`);
    }

    // --- D2: coming back pulls ----------------------------------------------
    await foreground(b);
    const bPulled = await until(
      b,
      "B came back to the foreground and never pulled A's match",
      async () => (await localHistory(b)).includes("A-match-1")
    );
    if (bPulled) ok("B came back to the foreground and picked up A's match");

    // --- D3 and D4: the report, in both directions --------------------------
    await playMatch(b, { id: "B-match-1", clout: 200 });
    await background(b);
    await until(b, "B's match never reached the server", async () => (await cloudProfile(b))?.history?.includes("B-match-1"), 20000);

    await foreground(a);
    const aGotIt = await until(
      a,
      "A came back and still did not have B's match — this is the reported bug",
      async () => (await localHistory(a)).includes("B-match-1")
    );
    if (aGotIt) ok("A came back to the first device and B's match was there");

    // --- D5: both devices played while apart --------------------------------
    console.log("\n   Both played while apart — the case that used to wedge for ever");
    await a.context().setOffline(true);
    await playMatch(a, { id: "A-offline", clout: 1000 });
    await foreground(a);
    await a.waitForTimeout(3000);

    const strandedCloud = await cloudProfile(a);
    if (strandedCloud?.error) ok("A is offline and cannot reach the save service, as intended");
    else fail(`A was supposed to be offline, but the save service answered: ${JSON.stringify(strandedCloud)?.slice(0, 90)}`);

    await playMatch(b, { id: "B-solo", clout: 2000 });
    await background(b);
    await until(b, "B's second match never reached the server", async () => (await cloudProfile(b))?.history?.includes("B-solo"), 20000);

    const cloutBefore = (await profileOf(a))?.clout ?? 0;

    /**
     * Coming back online is the one return trigger the browser fires for real
     * here, so it is the one worth using for the scenario that matters most.
     */
    await a.evaluate(() => {
      window.__hbSawOnline = false;
      window.addEventListener("online", () => (window.__hbSawOnline = true), { once: true });
    });
    await a.context().setOffline(false);
    await a.waitForTimeout(1500);
    if (await a.evaluate(() => window.__hbSawOnline === true)) ok("A observed a real `online` event from the browser");
    else fail("A never saw an `online` event, so this scenario is not testing the trigger it claims to");

    const converged = await until(
      a,
      "A never reconciled: it holds one of the two afternoons and the other is gone",
      async () => {
        const held = await localHistory(a);
        return held.includes("A-offline") && held.includes("B-solo");
      },
      60000
    );

    const finalA = await profileOf(a);
    const finalIds = (finalA?.history ?? []).map((entry) => entry.id);
    if (converged) {
      ok(`both afternoons survived on A: ${JSON.stringify(finalIds)}`);
    } else {
      fail(`A holds ${JSON.stringify(finalIds)} — a match a player played was thrown away`);
    }

    /**
     * The arithmetic, not just the list. A merge that keeps both history
     * entries and then picks one side's Clout has still quietly deleted the
     * rewards for one of them.
     */
    if ((finalA?.clout ?? 0) >= cloutBefore + 2000) {
      ok(`the Clout from both devices is there (${cloutBefore} + 2000 → ${finalA?.clout})`);
    } else {
      fail(`Clout went ${cloutBefore} → ${finalA?.clout}; one device's earnings were dropped`);
    }

    // And the merge has to reach the server, or the other device never sees it.
    const uploaded = await until(
      a,
      "the reconciled save never reached the server",
      async () => {
        const cloud = await cloudProfile(a);
        return cloud?.history?.includes("A-offline") && cloud?.history?.includes("B-solo");
      },
      45000
    );
    if (uploaded) ok("and the reconciled save went up, so the other device gets it too");

    // --- the pair converges, rather than trading revisions -------------------
    /**
     * Two attempts, because they fail differently and the difference matters.
     *
     * If coming back to the foreground converges B, the return trigger works.
     * If only a reload does, the merge is fine and the *trigger* is broken —
     * which is the original bug wearing a different hat, and worth saying so
     * rather than reporting a generic "did not converge".
     */
    const bothAfternoons = async () => {
      const held = await localHistory(b);
      return held.includes("A-offline") && held.includes("B-solo");
    };

    await foreground(b);
    if (await until(b, "B did not converge on returning to the foreground", bothAfternoons, 30000)) {
      ok("B converged on the same save, so the two devices agree again");
    } else {
      const link = await b.evaluate(() => JSON.parse(localStorage.getItem("hypebound:cloud-link") ?? "null"));
      const cloud = await cloudProfile(b);
      console.log(
        `      B holds ${JSON.stringify(await localHistory(b))}; link ${JSON.stringify(link?.sections?.profile)};` +
          ` the server holds ${JSON.stringify(cloud?.history)} at revision ${cloud?.revision}`
      );
      await reopen(b);
      if (await until(b, "B never converged at all, even after reopening the game", bothAfternoons, 20000)) {
        fail("B converged only after a reload — coming back to the foreground did not trigger a sync");
      }
    }

    /**
     * The wedge test. Before the fix the device was not merely wrong once, it
     * was stuck: every later pass decided `conflict` and did nothing, for ever.
     * One more match on each side has to keep flowing.
     */
    await playMatch(a, { id: "A-after", clout: 10 });
    await background(a);
    const stillWorks = await until(
      a,
      "the device stopped syncing after reconciling — it is wedged, exactly as before",
      async () => (await cloudProfile(a))?.history?.includes("A-after"),
      30000
    );
    if (stillWorks) ok("and syncing keeps working afterwards, rather than wedging");
  }

  // -------------------------------------------------------------------------
  console.log("\nE. Deleting the account removes the save from the server");

  /**
   * Quiet machine A first.
   *
   * It is still signed in with a token that has not expired, and it now syncs
   * on a good deal more than a local write — so a background pass landing
   * between the delete and the check would re-create the very rows this step is
   * looking for. "A second device with a live token can re-upload after a
   * deletion" is a real question and a separate one; it predates this change,
   * and answering it here would only make this step flaky.
   */
  await a
    .evaluate(async () => {
      const { stopAutoSync } = await import("/src/save/cloudSaves.ts");
      stopAutoSync();
    })
    /**
     * Housekeeping, not an assertion, so it does not get to fail the run.
     *
     * It has thrown "execution context was destroyed" when the dev server
     * restarted underneath the run — which happens whenever `vite.config.ts` is
     * saved by anyone. Worth quieting A, not worth reporting a defect in the
     * game because somebody else pressed Ctrl-S.
     */
    .catch((error) => console.log(`   (could not quiet machine A: ${String(error).slice(0, 80)})`));

  await b.goto(`${ORIGIN}/#privacy`, { waitUntil: "networkidle" });
  await b.waitForSelector(".privacy-screen");
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
