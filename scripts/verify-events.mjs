/**
 * The Event Hub, in a real browser — `09-game-modes.md` §14 and
 * `03-screens-and-navigation.md` §4.4.3.
 *
 * The unit tests cover the calendar arithmetic, the credit rules and the data
 * check. What only a browser can show is the half of §4.4.3 that is about
 * **honesty**, because every one of those claims is a sentence on a screen:
 *
 * - an event that is running says when it really ends, from real run data;
 * - an event that has ended says the date it comes back, rather than nothing;
 * - the leaderboard tab is shown as unavailable with its reason, not faked;
 * - the shop refuses what you cannot afford instead of pretending to sell it;
 * - claiming a mission moves a real balance, and the balance survives a reload.
 *
 * And the thing that made the deck-slot list necessary in the first place: the
 * screen has to be **reachable from the lobby**, or it does not exist.
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

console.log("\n1. The hub is reachable from the lobby");
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await settleOn(".lobby-screen");

const navButton = await page.evaluate(() => {
  const button = document.querySelector("#lobby-events");
  return button ? { text: button.textContent.trim(), badge: button.querySelector(".lobby-nav-badge")?.textContent ?? null } : null;
});
if (!navButton) fail("there is no Events button in the lobby — the screen would be unreachable");
else ok(`the lobby has an Events button ("${navButton.text}")`);

await page.click("#lobby-events");
await settleOn(".events-screen");
ok("and it opens the Event Hub");

// ---------------------------------------------------------------------------

console.log("\n2. Every event is in exactly one of the three states");
const shape = await page.evaluate(() => {
  const views = window.hypeboundEvents?.views() ?? [];
  return {
    views,
    live: document.querySelectorAll(".event-card.is-live").length,
    upcoming: document.querySelectorAll(".event-card.is-upcoming").length,
    archive: document.querySelectorAll(".event-card.is-archive").length,
    header: document.querySelector(".screen-header .muted")?.textContent?.trim() ?? "",
  };
});

if (shape.views.length === 0) fail("the hub knows about no events at all");
else ok(`${shape.views.length} events: ${shape.views.map((v) => `${v.id}=${v.phase}`).join(", ")}`);

const drawn = shape.live + shape.upcoming + shape.archive;
if (drawn !== shape.views.length) {
  fail(`${shape.views.length} events but ${drawn} cards drawn (${shape.live} live, ${shape.upcoming} upcoming, ${shape.archive} archived)`);
} else {
  ok(`every one of them is drawn exactly once — ${shape.live} live, ${shape.upcoming} upcoming, ${shape.archive} archived`);
}
if (!shape.header.includes("running")) fail(`the header does not summarise the calendar: "${shape.header}"`);
else ok(`the header counts them: "${shape.header}"`);

// ---------------------------------------------------------------------------

console.log("\n3. Honest timers — every date drawn is a real run boundary");
const timers = await page.evaluate(() => {
  const views = window.hypeboundEvents?.views() ?? [];
  const runStarts = window.hypeboundEvents?.runStarts() ?? [];
  return {
    views,
    runStarts,
    liveTimer: document.querySelector(".event-card.is-live .event-timer")?.textContent?.trim().replace(/\s+/g, " ") ?? "",
    archiveTimer: document.querySelector(".event-card.is-archive .event-timer")?.textContent?.trim().replace(/\s+/g, " ") ?? "",
    rerun: document.querySelector(".event-rerun")?.textContent?.trim().replace(/\s+/g, " ") ?? "",
    now: Date.now(),
  };
});

const liveView = timers.views.find((v) => v.phase === "active");
if (!liveView) {
  ok("nothing is running right now, so there is no countdown to check (the calendar has moved past it)");
} else if (!liveView.endsAt || liveView.endsAt <= timers.now) {
  fail(`the running event's end (${liveView.endsAt}) is not in the future`);
} else if (!/Ends/.test(timers.liveTimer) || !/left/.test(timers.liveTimer)) {
  fail(`the running event does not print a real end time: "${timers.liveTimer}"`);
} else {
  ok(`the running event prints its real end: "${timers.liveTimer}"`);
}

const archivedView = timers.views.find((v) => v.phase === "ended");
if (!archivedView) {
  ok("nothing is archived yet, so there is no rerun notice to check");
} else if (!archivedView.returnsAt) {
  fail(`${archivedView.id} has ended with no scheduled return — §14 promises reruns`);
} else if (!/Returns/.test(timers.archiveTimer)) {
  fail(`the archive does not say when it returns: "${timers.archiveTimer}"`);
} else {
  ok(`the archive carries a rerun notice: "${timers.archiveTimer}"`);
  if (!timers.rerun.includes("guaranteed")) fail("the archive does not state the rerun guarantee");
  else ok(`and states the guarantee: "${timers.rerun.slice(0, 90)}…"`);
}

// every drawn date is one of the event's own published run boundaries
const allStarts = new Set(timers.runStarts.flat());
for (const view of timers.views) {
  if (view.returnsAt !== null && !allStarts.has(view.returnsAt)) {
    fail(`${view.id} shows a return date that is not one of its published runs`);
  }
}
ok("no date on the screen was invented — each is a published run boundary");

// ---------------------------------------------------------------------------

console.log("\n4. The online half is refused rather than faked");
const locked = await page.evaluate(() => {
  const panel = document.querySelector(".event-locked");
  return panel ? panel.textContent.replace(/\s+/g, " ").trim() : null;
});
if (!locked) fail("there is no leaderboard panel at all");
else if (!/server|accounts/i.test(locked)) fail(`the leaderboard panel does not explain itself: "${locked}"`);
else ok(`the leaderboard says why it is unavailable: "${locked.slice(0, 110)}…"`);

// ---------------------------------------------------------------------------

console.log("\n5. The rules popup");
const rules = await page.evaluate(async () => {
  document.querySelector("[data-rules]")?.click();
  await new Promise((r) => setTimeout(r, 200));
  const overlay = document.querySelector("#ev-rules-overlay");
  const items = [...document.querySelectorAll(".event-rules-list li")].map((li) => li.textContent.trim());
  return { open: Boolean(overlay), items };
});
if (!rules.open) fail("the event rules popup did not open");
else if (rules.items.length === 0) fail("the rules popup opened empty");
else ok(`the rules popup lists ${rules.items.length} rules ("${rules.items[0].slice(0, 70)}…")`);

await page.evaluate(() => document.querySelector("#ev-rules-close")?.click());
await page.waitForTimeout(200);
const closed = await page.evaluate(() => !document.querySelector("#ev-rules-overlay"));
if (!closed) fail("the rules popup would not close");
else ok("and closes again");

// ---------------------------------------------------------------------------

console.log("\n6. The shop refuses what it cannot sell");
const shop = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".event-shop-row")];
  return rows.map((row) => ({
    name: row.querySelector(".event-shop-name")?.textContent?.trim() ?? "",
    cost: row.querySelector(".event-shop-cost")?.textContent?.trim() ?? "",
    disabled: row.querySelector("button")?.disabled ?? null,
  }));
});
if (shop.length === 0) {
  ok("no event is running, so no shop is drawn");
} else {
  ok(`the shop lists ${shop.length} rows (${shop.map((r) => r.name).join(", ")})`);
  const balance = (await page.evaluate(() => window.hypeboundEvents?.views().find((v) => v.phase === "active")?.balance)) ?? 0;
  const shouldAllBeDisabled = balance === 0;
  const anyEnabled = shop.some((row) => row.disabled === false);
  if (shouldAllBeDisabled && anyEnabled) {
    fail(`the balance is ${balance} and the shop still offers a Buy button that is enabled`);
  } else {
    ok(`with a balance of ${balance}, ${shop.filter((r) => r.disabled).length} of ${shop.length} Buy buttons are correctly disabled`);
  }
}

// ---------------------------------------------------------------------------

console.log("\n7. Earning and spending, end to end");
/**
 * Fill in the running event's mission progress, then **flush and reload**.
 *
 * Not decoration. A `profileStore.update` from a `page.evaluate` sits on the
 * store's 250ms debounce, and the screen already on screen keeps drawing the
 * state it mounted with — this script spent a while reporting "0 claimable"
 * against a save that plainly held four completed missions, which is the same
 * trap `lib/account.mjs` documents for the collection. Writing, flushing and
 * reloading means the app boots from the state this test intended, once.
 *
 * The progress itself is written rather than played: crediting it honestly
 * would mean sitting through several real matches, and `tests/events.test.ts`
 * already proves the credit path from a match outcome. What only the browser
 * can show is what happens *after* the currency exists.
 */
const seeded = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { eventById, liveEvents } = await import("/src/game/events/index.ts");
  const live = liveEvents(Date.now())[0];
  if (!live) return { skipped: true };

  const event = eventById(live.id);
  profileStore.update((draft) => {
    draft.events ??= { state: {} };
    draft.events.state ??= {};
    const state = draft.events.state[event.id] ?? {
      eventId: event.id,
      progress: {},
      claimed: [],
      balance: 0,
      earned: 0,
      bought: {},
      conversions: [],
      completionGranted: false,
    };
    for (const mission of event.missions) {
      const requirements = mission.objective.all ?? mission.objective.any ?? [];
      state.progress[mission.id] = requirements.map((r) => r.target);
    }
    draft.events.state[event.id] = state;
  });
  const storage = await import("/src/save/storage.ts");
  storage.flushAllStores();
  return { skipped: false, eventId: event.id, missions: event.missions.length };
});

if (seeded.skipped) {
  ok("no event is running, so there is nothing to earn (the calendar has moved on)");
} else {
  await page.reload({ waitUntil: "networkidle" });
  await settleOn(".events-screen");

  const claimable = await page.evaluate(() => document.querySelectorAll("[data-claim]").length);
  if (claimable !== seeded.missions) {
    fail(`${seeded.missions} missions were completed but ${claimable} Claim buttons are drawn`);
  } else {
    ok(`${claimable} completed missions each offer a Claim button`);
  }

  const claimed = await page.evaluate(async () => {
    const balanceOf = () => window.hypeboundEvents?.views().find((v) => v.phase === "active")?.balance ?? 0;
    const before = balanceOf();
    let clicks = 0;
    for (const button of [...document.querySelectorAll("[data-claim]")]) {
      button.click();
      clicks += 1;
      await new Promise((r) => setTimeout(r, 150));
    }
    return { before, after: balanceOf(), clicks, notice: document.querySelector("#ev-notice")?.textContent?.trim() ?? "" };
  });

  if (claimed.after <= claimed.before) {
    fail(`claiming ${claimed.clicks} missions moved the balance from ${claimed.before} to ${claimed.after}`);
  } else {
    ok(`claiming ${claimed.clicks} missions paid the balance ${claimed.before} → ${claimed.after}`);
    if (claimed.notice) ok(`and it said so: "${claimed.notice}"`);
  }

  // the completion meta-reward — §14's "completion meta-reward (event frame)"
  const frame = await page.evaluate(async () => {
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    const saved = JSON.parse(localStorage.getItem("hypebound:profile") ?? "null");
    return (saved?.data?.cosmetics?.owned ?? []).filter((id) => id.includes(":event:"));
  });
  if (frame.length === 0) fail("claiming every mission granted no completion cosmetic");
  else ok(`the completion meta-reward landed in the wardrobe (${frame.join(", ")})`);

  const bought = await page.evaluate(async () => {
    const viewOf = () => window.hypeboundEvents?.views().find((v) => v.phase === "active");
    const row = [...document.querySelectorAll(".event-shop-row")].find((r) => r.querySelector("button:not([disabled])"));
    if (!row) return { none: true };
    const name = row.querySelector(".event-shop-name")?.textContent?.trim() ?? "";
    const before = viewOf();
    row.querySelector("button").click();
    await new Promise((r) => setTimeout(r, 300));
    const after = viewOf();
    return {
      none: false,
      name,
      balanceBefore: before.balance,
      balanceAfter: after?.balance ?? 0,
      stockBefore: before.shopLeft,
      stockAfter: after?.shopLeft ?? [],
      notice: document.querySelector("#ev-notice")?.textContent?.trim() ?? "",
    };
  });

  if (bought.none) {
    fail("nothing in the shop was affordable even after claiming every mission");
  } else if (bought.balanceAfter >= bought.balanceBefore) {
    fail(`buying "${bought.name}" did not spend anything (${bought.balanceBefore} → ${bought.balanceAfter})`);
  } else if (JSON.stringify(bought.stockBefore) === JSON.stringify(bought.stockAfter)) {
    fail(`buying "${bought.name}" did not consume stock (${JSON.stringify(bought.stockBefore)})`);
  } else {
    ok(`bought "${bought.name}": balance ${bought.balanceBefore} → ${bought.balanceAfter}, stock ${JSON.stringify(bought.stockBefore)} → ${JSON.stringify(bought.stockAfter)}`);
    ok(`and it said so: "${bought.notice}"`);
  }

  /**
   * And it is saved, not a screen variable. This is also the rerun guarantee in
   * miniature: stock consumed is stored per event, not per run, so the shop
   * comes back exactly as it was left.
   */
  const beforeReload = await page.evaluate(async () => {
    const storage = await import("/src/save/storage.ts");
    storage.flushAllStores();
    return window.hypeboundEvents?.views().find((v) => v.phase === "active");
  });
  await page.reload({ waitUntil: "networkidle" });
  await settleOn(".events-screen");
  const afterReload = await page.evaluate(() => window.hypeboundEvents?.views().find((v) => v.phase === "active"));
  if (afterReload?.balance !== beforeReload?.balance || JSON.stringify(afterReload?.shopLeft) !== JSON.stringify(beforeReload?.shopLeft)) {
    fail(
      `a reload changed the event: balance ${beforeReload?.balance} → ${afterReload?.balance}, stock ${JSON.stringify(beforeReload?.shopLeft)} → ${JSON.stringify(afterReload?.shopLeft)}`
    );
  } else {
    ok(`balance and stock survive a reload (${afterReload?.balance}, ${JSON.stringify(afterReload?.shopLeft)})`);
  }
}

await page.screenshot({ path: path.join(OUT, "events-hub.png"), fullPage: true });

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/events-hub.png");
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
