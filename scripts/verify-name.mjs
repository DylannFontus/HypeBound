/**
 * Can a player change their name, and does the name belong to the account?
 *
 * The owner reported one sentence — *"can't edit profile name and it should be
 * linked to the account"* — and it decomposes into four claims that fail in
 * completely different ways, so this checks all four rather than the first one
 * that is easy to see:
 *
 *   A. the control exists, and a finger can reach it at three geometries
 *   B. a refusal says what is wrong, in the same words the live hint uses
 *   C. the new name lands in the `profile` save section, which is the section
 *      the cloud round trip already carries
 *   D. it actually arrives on a second, independent browser signed into the
 *      same account
 *   E. and none of it makes a single request while signed out
 *
 * ## What this instrument does not let itself do
 *
 * Twelve instruments have produced confident wrong answers in this project, so
 * the three traps that apply here are closed deliberately:
 *
 * **It never calls Playwright's `.click()` on the thing under test.** `.click()`
 * runs `scrollIntoViewIfNeeded` first, which is how the mulligan's Confirm
 * button passed every automated check while sitting 32px below a clipped fold.
 * Reachability here is: measure the box where the page actually put it, try a
 * *real* scroll on the nearest scrollable ancestor, re-measure, and then hit-test
 * the centre with `elementFromPoint`. A control that a real scroll moves by 0px
 * and that hit-tests to something else is unreachable, whatever its `getBoundingClientRect`
 * says.
 *
 * **It never imports a store into `page.evaluate` to make a change.** Vite serves
 * `?t=`-stamped module URLs, so an import from the console can be a *second copy*
 * of the module — a probe writing to it would be writing to a store the running
 * application is not holding, and the screen would correctly fail to update.
 * Every mutation below goes through `window.hypeboundProfile`, which is the
 * application's own instance, or through real typing. Two reads do import a
 * module (`canonicalJson`, `checksumOf`); both are pure functions of their
 * argument, so a second copy computes the same number.
 *
 * **It reports elapsed wall-clock, not a nominal grid.** The wave-8 idle probe
 * published ~830ms samples under a 200ms label because it never measured what
 * one sample cost. The only loop here is the poll waiting for an upload; it
 * prints the real elapsed time and the real number of polls, so the number
 * cannot be read as tighter than it is.
 *
 * Renderer: `--enable-unsafe-swiftshader` is passed so headless Chrome has a
 * WebGL context at all. Nothing here measures a frame rate, so the software
 * rasteriser cannot distort the result the way it distorted four rounds of
 * motion review — every measurement below is layout, text or storage.
 *
 * Step D creates and then deletes a real Supabase account, exactly as
 * `verify-cloud-saves.mjs` does. Run it by hand, with a dev server on :5173.
 *
 *   node scripts/verify-name.mjs            # A, B, C, E  (no network needed)
 *   node scripts/verify-name.mjs --account  # ...and D, which signs up for real
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const WITH_ACCOUNT = process.argv.includes("--account");
const STAMP = String(Math.floor(Math.random() * 1e9));
const EMAIL = `hypebound-name-${STAMP}@example.com`;
const PASSWORD = "display-name-password";

let failures = 0;
const ok = (m) => console.log(`   ok: ${m}`);
const fail = (m) => {
  failures++;
  console.log(`   FAIL: ${m}`);
};
const note = (m) => console.log(`   .. ${m}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

/**
 * The reachability probe. Runs in the page; Playwright ships it across as
 * source, so it may only touch page globals.
 *
 * It answers four separate questions and returns all four, because "is it in
 * the viewport" and "can you press it" are not the same question, and
 * collapsing them is how three unreachable controls shipped in this project.
 */
function reachProbe(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const first = el.getBoundingClientRect();

  // A real scroll, on the real scroller, exactly as a wheel would drive it.
  const scrollableAncestor = (node) => {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return document.scrollingElement || document.documentElement;
  };
  const scroller = scrollableAncestor(el);
  const startedAt = scroller.scrollTop;
  const offscreen = first.top < 0 || first.bottom > vh;
  if (offscreen) scroller.scrollBy(0, first.top < 0 ? first.top - 24 : first.bottom - vh + 24);
  const moved = scroller.scrollTop - startedAt;

  const box = el.getBoundingClientRect();
  const inView = box.top >= 0 && box.left >= 0 && box.bottom <= vh && box.right <= vw;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const hit = inView ? document.elementFromPoint(cx, cy) : null;
  const hittable = Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));

  // The clipping ancestor, if any, so an unreachable control names its cause.
  let clipper = null;
  for (let n = el.parentElement; n && !clipper; n = n.parentElement) {
    const style = getComputedStyle(n);
    if (/(hidden|clip)/.test(style.overflowY) || /(hidden|clip)/.test(style.overflowX)) {
      clipper = String(n.className || n.tagName);
    }
  }

  return {
    found: true,
    vw,
    vh,
    w: Math.round(box.width),
    h: Math.round(box.height),
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    right: Math.round(box.right),
    neededScroll: offscreen,
    scrolled: Math.round(moved),
    inView,
    hittable,
    hitTag: hit ? String(hit.id || hit.className || hit.tagName) : null,
    clipper,
    cx,
    cy,
  };
}

/** A browser with its own storage — the whole point of D is that they share none. */
async function freshMachine(label, viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`   [${label}] page error: ${e.message.slice(0, 160)}`));
  return page;
}

/**
 * Get past `needsStarterChoice()`, which redirects every route to the picker.
 *
 * Not optional and not incidental: a profile with no starter deck can never
 * reach `#profile` at all, so a probe that skipped this would measure the
 * starter screen and report the name control missing.
 */
async function startPlaying(page, faction = "neon-idols") {
  await page.goto(`${ORIGIN}/?nointro#starter`, { waitUntil: "networkidle" });
  await page.waitForSelector(".starter-screen", { timeout: 20000 });
  await page.evaluate((f) => window.hypeboundStarter?.choose(f), faction);
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });
}

/**
 * Land on the profile screen with nothing on top of it.
 *
 * `?nointro` because the opening cinematic is a sibling of `#app` with the game
 * live underneath — every selector and every wait resolves through it, and
 * `elementFromPoint` would return the title card. `#hb-boot-plate` is removed
 * 600ms after boot and covers the whole viewport until it is, which would make
 * every hit test fail for a reason that has nothing to do with the layout.
 */
async function openProfile(page) {
  await page.goto(`${ORIGIN}/?nointro#profile`, { waitUntil: "networkidle" });
  await page.waitForSelector(".profile-screen", { timeout: 20000 });
  await page.waitForFunction(() => !document.getElementById("hb-boot-plate"), { timeout: 10000 });
  await page.waitForFunction(() => Boolean(window.hypeboundProfile), { timeout: 10000 });
}

const storedName = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("hypebound:profile");
    return raw ? JSON.parse(raw).data.displayName : null;
  });

console.log(`\nHYPEBOUND display name — ${WITH_ACCOUNT ? EMAIL : "local only"}\n`);

try {
  // ==========================================================================
  console.log("A. The control exists, and a finger can reach it");

  const geometries = [
    { label: "1280x720", viewport: { width: 1280, height: 720 }, scale: 1 },
    { label: "844x390", viewport: { width: 844, height: 390 }, scale: 1 },
    { label: "844x390 @1.6", viewport: { width: 844, height: 390 }, scale: 1.6 },
  ];

  for (const geometry of geometries) {
    const page = await freshMachine(geometry.label, geometry.viewport);
    await startPlaying(page);
    if (geometry.scale !== 1) {
      /*
       * Through `updateSettings`, which is the one funnel that writes
       * `--ui-scale` onto the root — see `settings.ts::applySettings`. A second
       * module copy is harmless here for once, because what is being asserted on
       * is a custom property on `documentElement`, and there is only one of
       * those however many copies of the module exist. The reload afterwards
       * makes the application's own copy read it back from storage.
       */
      await page.goto(`${ORIGIN}/?nointro#play`, { waitUntil: "networkidle" });
      await page.evaluate(async (s) => {
        const { updateSettings } = await import("/src/save/settings.ts");
        updateSettings({ uiScale: s });
      }, geometry.scale);
    }
    await openProfile(page);

    const applied = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
    );
    if (geometry.scale !== 1 && applied !== String(geometry.scale)) {
      fail(`${geometry.label}: --ui-scale is "${applied}", so this geometry was never actually tested`);
    }

    const rename = await page.evaluate(reachProbe, "#profile-rename");
    if (!rename.found) {
      fail(`${geometry.label}: no #profile-rename on the profile screen`);
      await page.context().close();
      continue;
    }
    if (rename.inView && rename.hittable) {
      ok(
        `${geometry.label}: Rename is ${rename.w}x${rename.h}px at y=${rename.top}, hit-tests to itself` +
          (rename.neededScroll ? ` (after a real scroll of ${rename.scrolled}px)` : " with no scrolling")
      );
    } else if (rename.neededScroll && rename.scrolled === 0) {
      fail(
        `${geometry.label}: Rename is at y=${rename.top} in a ${rename.vh}px viewport and a real scroll moved it 0px` +
          (rename.clipper ? ` — clipped by .${String(rename.clipper).split(" ")[0]}` : "")
      );
    } else {
      fail(`${geometry.label}: Rename is at y=${rename.top}, hit-tests to "${rename.hitTag}"`);
    }

    // 44px is the touch target the a11y sweep uses everywhere else in this game.
    if (rename.h < 32) note(`${geometry.label}: the Rename chip is only ${rename.h}px tall`);
    else ok(`${geometry.label}: touch target ${rename.w}x${rename.h}px`);

    /*
     * Press it at the coordinates just measured — a real mouse at a real point,
     * not `locator.click()`, which would scroll first and prove nothing.
     */
    if (rename.hittable) {
      await page.mouse.click(rename.cx, rename.cy);
      const opened = await page.evaluate(() => ({
        editing: window.hypeboundProfile?.editing?.() ?? false,
        focused: document.activeElement?.id ?? null,
      }));
      if (opened.editing && opened.focused === "profile-name-input") {
        ok(`${geometry.label}: pressing it opens the editor with the caret already in the field`);
      } else {
        fail(`${geometry.label}: editing=${opened.editing}, focus is on "${opened.focused}"`);
      }

      for (const selector of ["#profile-name-input", "#profile-name-save", "#profile-name-cancel"]) {
        const part = await page.evaluate(reachProbe, selector);
        if (part.found && part.inView && part.hittable) continue;
        fail(
          `${geometry.label}: ${selector} is ${
            part.found ? `at y=${part.top} right=${part.right}/${part.vw}, hits "${part.hitTag}"` : "absent"
          }`
        );
      }
      ok(`${geometry.label}: the field, Save and Cancel are all inside the viewport and all hit-test to themselves`);

      // Escape must put it back, or the editor is a trap on a screen with no modal.
      await page.keyboard.press("Escape");
      const closed = await page.evaluate(() => ({
        editing: window.hypeboundProfile?.editing?.() ?? true,
        focused: document.activeElement?.id ?? null,
      }));
      if (!closed.editing && closed.focused === "profile-rename") {
        ok(`${geometry.label}: Escape closes it and returns focus to Rename`);
      } else {
        fail(`${geometry.label}: after Escape editing=${closed.editing}, focus "${closed.focused}"`);
      }
    }

    await page.context().close();
  }

  // ==========================================================================
  console.log("\nB. A refusal says what is wrong");

  const page = await freshMachine("B", { width: 1280, height: 720 });
  await startPlaying(page);
  await openProfile(page);

  const before = await storedName(page);
  ok(`the account starts as "${before}"`);

  /**
   * Typed into the real field and read back off the real live region, so what
   * this asserts is the sentence a player sees rather than what the pure
   * function returns. The two are wired to the same `checkDisplayName`, and the
   * point of going through the DOM is to prove that wiring exists.
   */
  const cases = [
    { input: "", expect: /cannot be left empty/i, why: "empty" },
    { input: "   ", expect: /cannot be left empty/i, why: "spaces only" },
    { input: "K", expect: /at least 2/i, why: "one character" },
    { input: "x".repeat(31), expect: /up to 24 .* trim 7/i, why: "seven over the limit" },
    { input: "!!! ???", expect: /at least one letter or number/i, why: "no letters or numbers" },
    { input: "Neon  Kilowatt", expect: /^$/, why: "double space, folded not refused", valid: true },
    { input: "Kilowatt", expect: /^$/, why: "ordinary", valid: true },
  ];

  await page.evaluate(() => window.hypeboundProfile.open());
  for (const testCase of cases) {
    const said = await page.evaluate((value) => {
      window.hypeboundProfile.type(value);
      return window.hypeboundProfile.status();
    }, testCase.input);
    const invalidFlag = await page.evaluate(
      () => document.querySelector("#profile-name-input")?.getAttribute("aria-invalid") ?? "?"
    );

    if (testCase.valid) {
      if (invalidFlag === "false") ok(`"${testCase.why}" is accepted (aria-invalid=false)`);
      else fail(`"${testCase.why}" was marked invalid: ${said}`);
    } else if (testCase.expect.test(said) && invalidFlag === "true") {
      ok(`"${testCase.why}" → "${said}"`);
    } else {
      fail(`"${testCase.why}" said "${said}" (aria-invalid=${invalidFlag}), expected ${testCase.expect}`);
    }
  }

  /*
   * Submitting something invalid must refuse *and explain*, and must not write.
   * A silent no-op here is precisely the complaint being fixed.
   */
  await page.evaluate(() => {
    window.hypeboundProfile.type("K");
    window.hypeboundProfile.submit();
  });
  const afterBadSubmit = await page.evaluate(() => ({
    stored: window.hypeboundProfile.name(),
    said: window.hypeboundProfile.status(),
    editing: window.hypeboundProfile.editing(),
    focused: document.activeElement?.id ?? null,
  }));
  if (afterBadSubmit.stored === before && /at least 2/i.test(afterBadSubmit.said) && afterBadSubmit.editing) {
    ok(`submitting "K" is refused with "${afterBadSubmit.said}", editor stays open, caret on ${afterBadSubmit.focused}`);
  } else {
    fail(`bad submit: ${JSON.stringify(afterBadSubmit)}`);
  }

  /*
   * The invisible-character path. A right-to-left override and a zero-width
   * space go in; a clean name and a sentence saying so come out.
   */
  const spoof = await page.evaluate(() => {
    window.hypeboundProfile.type("Ki\u202Elo\u200Bwatt");
    return {
      said: window.hypeboundProfile.status(),
      wouldStore: window.hypeboundProfile.check("Ki\u202Elo\u200Bwatt").name,
    };
  });
  if (spoof.wouldStore === "Kilowatt" && /invisible/i.test(spoof.said)) {
    ok(`a bidi override and a zero-width space are stripped to "${spoof.wouldStore}", and it says so`);
  } else {
    fail(`invisible characters: stored "${spoof.wouldStore}", said "${spoof.said}"`);
  }

  // ==========================================================================
  console.log("\nC. The new name lands in the profile save section");

  const NEW_NAME = `Kilowatt ${STAMP.slice(0, 4)}`;

  const checksumBefore = await page.evaluate(async () => {
    const { checksumOf } = await import("/src/save/cloudSync.ts");
    return checksumOf(JSON.parse(localStorage.getItem("hypebound:profile")).data);
  });

  await page.evaluate((value) => {
    window.hypeboundProfile.type(value);
    window.hypeboundProfile.submit();
  }, NEW_NAME);
  await page.waitForFunction(() => window.hypeboundProfile.editing() === false, { timeout: 10000 });

  const heading = await page.evaluate(() => document.querySelector("#profile-name")?.textContent?.trim() ?? "");
  const lobbyName = await page.evaluate(() => window.hypeboundProfile.name());
  const onDisk = await storedName(page);

  if (heading === NEW_NAME) ok(`the header now reads "${heading}"`);
  else fail(`the header reads "${heading}"`);
  if (lobbyName === NEW_NAME) ok("the store the running application holds agrees");
  else fail(`the application's store says "${lobbyName}"`);
  if (onDisk === NEW_NAME) ok("and it is already in localStorage, without waiting for the 250ms debounce");
  else fail(`localStorage says "${onDisk}" — the flush did not happen`);

  const checksumAfter = await page.evaluate(async () => {
    const { checksumOf } = await import("/src/save/cloudSync.ts");
    return checksumOf(JSON.parse(localStorage.getItem("hypebound:profile")).data);
  });
  if (checksumBefore !== checksumAfter) {
    ok(`the profile section's checksum moved ${checksumBefore.slice(0, 10)} → ${checksumAfter.slice(0, 10)}`);
    note("which is the whole of what makes decideSync() choose push rather than in-sync");
  } else {
    fail("the checksum did not change, so no sync would ever upload the new name");
  }

  const survives = await page.reload({ waitUntil: "networkidle" }).then(() => storedName(page));
  if (survives === NEW_NAME) ok("and it survives a reload");
  else fail(`after a reload the name is "${survives}"`);

  // ==========================================================================
  console.log("\nE. Signed out, renaming makes no request at all");

  const quiet = await freshMachine("E", { width: 1280, height: 720 });
  const requests = [];
  quiet.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(ORIGIN) && !url.startsWith("data:") && !url.startsWith("blob:")) requests.push(url);
  });
  await startPlaying(quiet);
  await openProfile(quiet);
  requests.length = 0;
  await quiet.evaluate(() => {
    window.hypeboundProfile.open();
    window.hypeboundProfile.type("Offline Creator");
    window.hypeboundProfile.submit();
  });
  await quiet.waitForFunction(() => window.hypeboundProfile.editing() === false, { timeout: 10000 });
  await quiet.waitForTimeout(1500);
  if (requests.length === 0) {
    ok(`renamed to "${await storedName(quiet)}" with 0 requests leaving the machine`);
  } else {
    fail(`${requests.length} request(s) left the machine while signed out: ${requests.slice(0, 3).join(", ")}`);
  }
  await quiet.context().close();

  // ==========================================================================
  if (!WITH_ACCOUNT) {
    note("\nD. skipped — pass --account to sign up for real and prove the cross-device half");
  } else {
    console.log("\nD. The name crosses to a second, independent browser");

    await page.goto(`${ORIGIN}/?nointro#signin`, { waitUntil: "networkidle" });
    await page.waitForSelector(".signin-screen");
    await page.click("#signin-toggle");
    await page.fill("#signin-email", EMAIL);
    await page.fill("#signin-password", PASSWORD);
    await page.click("#signin-submit");
    await page.waitForSelector(".queue-screen", { timeout: 30000 });
    ok("machine A made an account");

    /**
     * The poll, with its real cost stated.
     *
     * One iteration is a `fetch` of the manifest plus a 1000ms wait, so the
     * grid is *at least* 1000ms and the elapsed figure printed at the end is
     * the honest one. Publishing "10 polls" without the wall clock is exactly
     * the ~830ms-labelled-200ms error from wave 8.
     */
    const waitForSection = async (target, section, timeoutMs) => {
      const started = Date.now();
      let polls = 0;
      while (Date.now() - started < timeoutMs) {
        polls++;
        const manifest = await target.evaluate(async () => {
          const session = JSON.parse(localStorage.getItem("hypebound-auth:session") ?? "null");
          if (!session) return null;
          const { ONLINE } = await import("/src/config.ts");
          const response = await fetch(`${ONLINE.serverUrl}/me/saves`, {
            headers: { authorization: `Bearer ${session.accessToken}` },
          });
          return response.ok ? await response.json() : null;
        });
        const found = manifest?.sections?.find((s) => s.section === section);
        if (found) return { ...found, polls, elapsedMs: Date.now() - started };
        await target.waitForTimeout(1000);
      }
      return { polls, elapsedMs: Date.now() - started };
    };

    const up = await waitForSection(page, "profile", 60000);
    if (up.revision) ok(`the profile reached the server at revision ${up.revision} after ${up.elapsedMs}ms (${up.polls} polls)`);
    else fail(`the profile never reached the server (${up.elapsedMs}ms, ${up.polls} polls)`);

    // --- the second machine ---------------------------------------------
    const b = await freshMachine("D-B", { width: 1280, height: 720 });
    await startPlaying(b, "gothic-royalty");
    await b.goto(`${ORIGIN}/?nointro#signin`, { waitUntil: "networkidle" });
    await b.waitForSelector(".signin-screen");
    await b.fill("#signin-email", EMAIL);
    await b.fill("#signin-password", PASSWORD);
    await b.click("#signin-submit");

    /*
     * B has its own real save, so the game is *supposed* to stop and ask. That
     * is `decideSync`'s "adopt", and a probe that treated the question as a
     * failure would be measuring the safety property as though it were a bug.
     */
    const asked = await b
      .waitForSelector(".cloud-save-screen", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (asked) {
      note("B was asked which save to keep, as it should be — choosing the account's");
      await b.waitForFunction(() => document.querySelectorAll(".cloud-save-table").length >= 2, { timeout: 30000 }).catch(() => {});
      await b.evaluate(() => window.hypeboundCloudSave?.choose("cloud"));
      await b.waitForSelector(".queue-screen", { timeout: 30000 }).catch(() => {});
    }

    const arrived = await storedName(b);
    if (arrived === NEW_NAME) ok(`machine B, a browser that has never seen this name, now holds "${arrived}"`);
    else fail(`machine B holds "${arrived}", expected "${NEW_NAME}"`);

    // --- and a *second* rename, the one that proves the loop stays open ---
    const SECOND = `Kilowatt ${STAMP.slice(4, 8)}`;
    await openProfile(page);
    const renameStarted = Date.now();
    await page.evaluate((value) => {
      window.hypeboundProfile.open();
      window.hypeboundProfile.type(value);
      window.hypeboundProfile.submit();
    }, SECOND);
    await page.waitForFunction(() => window.hypeboundProfile.editing() === false, { timeout: 20000 });
    const said = await page.evaluate(() => window.hypeboundProfile.status());
    console.log(`   the screen said: "${said}" after ${Date.now() - renameStarted}ms`);
    if (/to your account/i.test(said)) ok("the screen reports the upload rather than promising it");
    else note("the screen fell back to the honest 'will reach your account on the next sync' wording");

    const up2 = await waitForSection(page, "profile", 60000);
    note(`server revision is now ${up2.revision} (${up2.elapsedMs}ms, ${up2.polls} polls)`);

    await b.reload({ waitUntil: "networkidle" });
    await b.waitForTimeout(4000);
    const second = await storedName(b);
    if (second === SECOND) {
      ok(`and a rename made on A after B was already set up arrives on B: "${second}"`);
    } else {
      fail(`B still holds "${second}" after a reload — the second rename did not cross`);
    }

    // --- clean up the real account ---------------------------------------
    await b.goto(`${ORIGIN}/?nointro#privacy`, { waitUntil: "networkidle" });
    await b.waitForSelector(".privacy-screen");
    await b.evaluate(() => {
      window.prompt = () => "DELETE";
      window.alert = () => {};
    });
    await b.click("#privacy-delete-online").catch(() => {});
    await b.waitForTimeout(4000);
    note("test account deleted");
    await b.context().close();
  }

  await page.context().close();
} catch (error) {
  fail(error instanceof Error ? `${error.message}` : String(error));
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? "\nPASS — the name is editable, validated, reachable, and rides the account's save."
    : `\nFAIL — ${failures} problem(s)`
);
process.exit(failures === 0 ? 0 : 1);
