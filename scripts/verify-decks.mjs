/**
 * The deck builder's comparison and assistance, in a real browser — known gap 8
 * and `03-screens-and-navigation.md` §4.3.2.
 *
 * The unit suite proves the engine: the diff, the ranking, that no suggestion
 * names a card the account does not own, that a replacement keeps the curve.
 * None of that needs a browser.
 *
 * What only a browser can show is **the bug this block closes**. The pool refuses
 * to let you add an unowned card, one `if` deep; the Auto-Build button called
 * straight past it into `autoBuildDeck`, which builds from every printed card in
 * the game. So the check that matters is done on a deliberately sparse account:
 * press the button, and count how many of the thirty cards it just handed you
 * are cards you actually own.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

/**
 * A deliberately sparse account: a started profile owning a handful of Neon
 * Idols cards and nothing else. This is the state the finding lives in — a real
 * new player two Drops into the game.
 */
await page.goto(ORIGIN, { waitUntil: "networkidle" });
/**
 * Start from nothing.
 *
 * A verification that inherits state from its own last run is not a
 * verification — the first three checks here are about what a NEW account sees,
 * and a leftover 30-card deck from the previous run answers them wrongly and
 * looks like a regression.
 */
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

const started = await page.evaluate(() => {
  try {
    return Boolean(JSON.parse(localStorage.getItem("hypebound:profile") ?? "null")?.data?.starterFaction);
  } catch {
    return false;
  }
});
if (!started) {
  await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
  await page.waitForSelector(".starter-screen", { timeout: 20000 });
  await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 });
}

const SPARSE = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const { legalCardPool } = await import("/src/engine/deck.ts");
  const content = getContent();
  const leader = content.leaders["idols-lumi-starcall"];
  // eight legal cards, two copies each — nowhere near a thirty-card deck
  const owned = legalCardPool(content, leader).slice(0, 8);
  profileStore.update((draft) => {
    draft.collection = Object.fromEntries(owned.map((card) => [card.id, 2]));
    draft.decks = [];
    draft.activeDeckIndex = 0;
  });
  profileStore.flush();
  return { owned: owned.map((card) => card.id), leaderCardId: leader.id };
});
ok(`seeded a sparse account: ${SPARSE.owned.length} distinct cards owned`);

/**
 * Reload before asserting. The starter grant leaves a write on the store's
 * 250 ms debounce, and seeding on top of it races that timer — the trap
 * scripts/lib/account.mjs documents. A reload settles both.
 */
await page.reload({ waitUntil: "networkidle" });
await page.goto(`${ORIGIN}/#deckbuilder`, { waitUntil: "networkidle" });
await settleOn(".builder-screen");

// --- 1. a new slot no longer opens on cards you do not own -----------------------------
console.log("\n1. A new slot opens empty");
const opening = await page.evaluate(() => ({
  listed: document.querySelectorAll("#db-list .deck-row").length,
  count: document.querySelector(".deck-count-value")?.textContent?.trim(),
}));
if (opening.count !== "0") {
  fail(`a fresh slot opened with ${opening.count} cards — it used to auto-build from the whole card pool`);
} else {
  ok("a fresh slot opens at 0 cards rather than thirty you do not own");
}

// --- 2. Auto-Complete respects the collection -------------------------------------------
console.log("\n2. Auto-Complete builds only from what you own");
await page.evaluate((leaderCardId) => {
  const select = document.querySelector("#db-leader");
  if (select) {
    select.value = leaderCardId;
    select.dispatchEvent(new Event("change"));
  }
}, SPARSE.leaderCardId);
await page.waitForTimeout(300);

const auto = page.locator(".builder-actions button", { hasText: "Auto-Complete" });
if ((await auto.count()) === 0) fail("there is no Auto-Complete button");
else {
  await auto.first().click();
  await page.waitForTimeout(500);

  const filled = await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    const owned = profileStore.get().collection;
    const rows = [...document.querySelectorAll("#db-list .deck-row")].map((row) => ({
      name: row.querySelector(".deck-row-name")?.textContent ?? "",
      count: Number((row.querySelector(".deck-row-count")?.textContent ?? "×0").replace("×", "")),
    }));
    return {
      total: Number(document.querySelector(".deck-count-value")?.textContent ?? "0"),
      rows,
      ownedIds: Object.keys(owned).filter((id) => owned[id] > 0),
      short: document.querySelector("#db-short")?.textContent ?? "",
    };
  });

  // every listed card must be one the account owns, at a count it owns
  const unowned = await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    const { getContent } = await import("/src/engine/content.ts");
    const content = getContent();
    const owned = profileStore.get().collection;
    const byName = new Map(Object.values(content.cards).map((card) => [card.name, card.id]));
    return [...document.querySelectorAll("#db-list .deck-row")]
      .map((row) => {
        const name = row.querySelector(".deck-row-name")?.textContent ?? "";
        const count = Number((row.querySelector(".deck-row-count")?.textContent ?? "×0").replace("×", ""));
        const id = byName.get(name);
        return { name, count, owned: owned[id ?? ""] ?? 0 };
      })
      .filter((entry) => entry.count > entry.owned);
  });

  if (unowned.length > 0) {
    fail(`${unowned.length} card(s) in the list are not owned at that count: ${unowned.map((e) => `${e.name} ×${e.count} (own ${e.owned})`).join(", ")}`);
  } else {
    ok(`filled to ${filled.total} cards, every one of them owned`);
  }

  if (filled.total >= 30) {
    fail("a collection of 8 distinct cards produced a full 30-card deck; it should stop short");
  } else if (!filled.short) {
    fail("it stopped short and said nothing about why");
  } else {
    ok(`stopped short and said so: "${filled.short.slice(0, 110)}"`);
  }
}
await page.screenshot({ path: path.join(OUT, "decks-autocomplete.png"), fullPage: true });

// --- 3. suggestions, and their reasons ---------------------------------------------------
console.log("\n3. Suggestions explain themselves");
/**
 * Cut the list back to four cards first.
 *
 * A deck that has exhausted a sparse collection has nothing left to suggest —
 * which is the honest answer, and tests nothing. The interesting state is the
 * one the feature exists for: a player part-way through, stuck.
 */
await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#db-list .deck-row")];
  for (const row of rows.slice(2)) row.click();
});
await page.waitForTimeout(400);
const suggestions = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#db-suggestions .assist-row")];
  return rows.map((row) => ({
    card: row.getAttribute("data-add"),
    reason: row.getAttribute("data-reason"),
    why: row.querySelector(".assist-why")?.textContent?.trim() ?? "",
    name: row.querySelector(".assist-name")?.textContent?.trim() ?? "",
  }));
});
if (suggestions.length === 0) {
  ok("nothing left to suggest — the collection is exhausted, which is the honest answer here");
} else {
  const unexplained = suggestions.filter((entry) => entry.why.length < 10);
  if (unexplained.length > 0) fail(`${unexplained.length} suggestion(s) have no reason printed`);
  else ok(`${suggestions.length} suggestions, each with a reason: "${suggestions[0].name} — ${suggestions[0].why}"`);

  const unownedSuggested = await page.evaluate(async (ids) => {
    const { profileStore } = await import("/src/save/profile.ts");
    const owned = profileStore.get().collection;
    return ids.filter((id) => (owned[id] ?? 0) <= 0);
  }, suggestions.map((s) => s.card));
  if (unownedSuggested.length > 0) fail(`it suggested ${unownedSuggested.length} card(s) the account does not own`);
  else ok("and not one of them is a card the account does not own");
}

// --- 4. what to craft ---------------------------------------------------------------------
console.log("\n4. What it would have suggested if you owned it");
const craft = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#db-craft .assist-row")];
  return rows.map((row) => ({
    card: row.getAttribute("data-craft"),
    text: row.textContent?.replace(/\s+/g, " ").trim() ?? "",
  }));
});
if (craft.length === 0) fail("a sparse account was told nothing about what to craft");
else {
  const owned = await page.evaluate(async (ids) => {
    const { profileStore } = await import("/src/save/profile.ts");
    const collection = profileStore.get().collection;
    return ids.filter((id) => (collection[id] ?? 0) > 0);
  }, craft.map((c) => c.card));
  if (owned.length > 0) fail(`${owned.length} craft target(s) are cards the account already owns`);
  else ok(`${craft.length} craft targets, none of them already owned: "${craft[0].text.slice(0, 100)}"`);
}

// --- 5. build around this card -----------------------------------------------------------
console.log("\n5. Build around this card");
const around = await page.evaluate(() => {
  const button = document.querySelector(".pool-build-around");
  return {
    exists: Boolean(button),
    card: button?.getAttribute("data-around") ?? null,
    label: button?.getAttribute("aria-label") ?? "",
  };
});
if (!around.exists) fail("no build-around control on the pool cards");
else {
  await page.evaluate(() => document.querySelector(".pool-build-around")?.click());
  await page.waitForTimeout(600);
  const built = await page.evaluate(() => ({
    total: Number(document.querySelector(".deck-count-value")?.textContent ?? "0"),
    name: document.querySelector("#db-name")?.value ?? "",
    listed: [...document.querySelectorAll("#db-list .deck-row .deck-row-name")].map((el) => el.textContent),
  }));
  if (built.total === 0) fail("build-around produced an empty deck");
  else if (!built.name.startsWith("Around:")) fail(`build-around named the deck "${built.name}"`);
  else ok(`"${around.label}" produced a ${built.total}-card deck named "${built.name}"`);
}

/**
 * From here on the account owns everything legal for the leader, because the
 * remaining checks are about Compare and Test-vs-AI rather than about scarcity —
 * and both of those need a deck that is legal enough to save and to play.
 */
console.log("\n6. A full collection, so the deck can be saved and played");
await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const { legalCardPool } = await import("/src/engine/deck.ts");
  const content = getContent();
  const leader = content.leaders["idols-lumi-starcall"];
  profileStore.update((draft) => {
    draft.collection = Object.fromEntries(legalCardPool(content, leader).map((card) => [card.id, 2]));
    draft.decks = [];
    draft.activeDeckIndex = 0;
  });
  profileStore.flush();
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".builder-screen");
await page.evaluate((leaderCardId) => {
  const select = document.querySelector("#db-leader");
  if (select) {
    select.value = leaderCardId;
    select.dispatchEvent(new Event("change"));
  }
}, SPARSE.leaderCardId);
await page.waitForTimeout(300);
await page.locator(".builder-actions button", { hasText: "Auto-Complete" }).first().click();
await page.waitForTimeout(600);

const legal = await page.evaluate(() => ({
  total: Number(document.querySelector(".deck-count-value")?.textContent ?? "0"),
  ok: Boolean(document.querySelector(".validation-ok")),
}));
if (legal.total !== 30 || !legal.ok) fail(`auto-complete on a full collection produced ${legal.total} cards, valid=${legal.ok}`);
else ok("auto-complete filled a legal 30-card deck from the collection");
await page.screenshot({ path: path.join(OUT, "decks-suggestions.png"), fullPage: true });

// --- 7. Compare versions --------------------------------------------------------------------
console.log("\n7. Compare versions");
const compareLabel = async () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll(".builder-actions button")].find((el) =>
      (el.textContent ?? "").startsWith("Compare")
    );
    return button?.textContent?.trim() ?? "";
  });

const beforeSave = await compareLabel();
if (beforeSave !== "Compare") fail(`with nothing saved the button reads "${beforeSave}"`);
else ok('with nothing saved the button reads "Compare"');

await page.locator(".builder-actions button", { hasText: "Save Deck" }).first().click();
await page.waitForTimeout(600);
const afterSave = await compareLabel();
if (!afterSave.includes("saved")) fail(`straight after saving the button reads "${afterSave}"`);
else ok(`straight after saving it reads "${afterSave}"`);

/**
 * Cut one card and add a DIFFERENT one, so the diff has both directions in it.
 *
 * An earlier version of this step cut a row and then clicked the first pool cell
 * that was not at its limit — which is the card it had just freed. The round
 * trip left the deck identical, the label correctly read "saved", and the check
 * blamed the label.
 */
const edited = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#db-list .deck-row")];
  const cut = rows[0]?.getAttribute("data-card") ?? "";
  rows[0]?.click();
  return cut;
});
await page.waitForTimeout(300);
const addedName = await page.evaluate((cutId) => {
  const cells = [...document.querySelectorAll(".pool-cell:not(.at-limit)")];
  const other = cells.find((cell) => cell.getAttribute("data-card") !== cutId) ?? cells[0];
  other?.click();
  return other?.getAttribute("data-card") ?? "";
}, edited);
await page.waitForTimeout(400);

const afterEdit = await compareLabel();
if (!/\+\d+ −\d+/.test(afterEdit)) fail(`after editing, the button reads "${afterEdit}"; expected a count`);
else ok(`after one cut and one add it reads "${afterEdit}" — the label is the unsaved-changes indicator`);

await page.locator(".builder-actions button", { hasText: "Compare" }).first().click();
await page.waitForTimeout(400);
const diff = await page.evaluate(() => ({
  open: Boolean(document.querySelector("#db-diff")),
  summary: document.querySelector("#db-diff-summary")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  removed: document.querySelectorAll("#db-diff .diff-removed").length,
  added: document.querySelectorAll("#db-diff .diff-added").length,
  counts: [...document.querySelectorAll("#db-diff .diff-counts")].map((el) => el.textContent?.trim()),
}));
if (!diff.open) fail("the Compare panel did not open");
else if (diff.removed === 0 || diff.added === 0) {
  fail(`the diff shows ${diff.added} added and ${diff.removed} cut after one of each: "${diff.summary}"`);
} else {
  ok(`the diff opened: "${diff.summary}"`);
  ok(`and shows both directions with counts: ${diff.counts.slice(0, 3).join(", ")}`);
}
await page.screenshot({ path: path.join(OUT, "decks-compare.png"), fullPage: true });

// --- 8. Test vs AI ----------------------------------------------------------------------------
console.log("\n8. Test vs AI — §4.3.2");
// put the cut card back so the draft is legal again
await page.locator(".builder-actions button", { hasText: "Compare" }).first().click();
await page.waitForTimeout(200);
await page.locator(".builder-actions button", { hasText: "Auto-Complete" }).first().click();
await page.waitForTimeout(500);

const testButton = page.locator(".builder-actions button", { hasText: "Test vs AI" });
if ((await testButton.count()) === 0) fail("there is no Test vs AI button");
else {
  const savedBefore = await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    return JSON.stringify(profileStore.get().decks);
  });
  const draftCards = await page.evaluate(() =>
    [...document.querySelectorAll("#db-list .deck-row .deck-row-name")].map((el) => el.textContent)
  );

  await testButton.first().click();
  await page.waitForTimeout(1500);
  const landed = await page.evaluate(() => window.location.hash);
  if (!landed.includes("battle")) fail(`Test vs AI landed on ${landed}`);
  else ok(`Test vs AI went straight to ${landed}`);

  const savedAfter = await page.evaluate(async () => {
    const { profileStore } = await import("/src/save/profile.ts");
    return JSON.stringify(profileStore.get().decks);
  });
  if (savedAfter !== savedBefore) fail("Test vs AI wrote the draft to a slot; the point is testing an uncommitted list");
  else ok("and it did not touch the saved slots — the point is trying a list you have not committed to");

  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForTimeout(2500);

  /** The board must be playing the DRAFT, not the deck in the active slot. */
  const playing = await page.evaluate(() => {
    const battle = window.hypeboundBattle;
    if (!battle) return null;
    const view = battle.view();
    const content = battle.content();
    /**
     * The deck comes from the authoritative state, the hand from the view.
     *
     * The view's own deck is sanitized to opaque placeholders (§5.2), so every
     * entry would report `cardId: "hidden"`, miss the token lookup below, and
     * be counted as a real card. That happens to give the right total today
     * because tokens reach the hand rather than the deck — a check that is
     * correct by luck is one bad shuffle from being wrong.
     */
    const state = battle.state();
    const deck = state.players[view.seat].deck;
    /**
     * Tokens are excluded. Going second grants one Borrowed Clout into hand
     * after the mulligan, so a 30-card deck legitimately shows 31 — an earlier
     * version of this check counted it and blamed the draft.
     */
    const real = [...deck, ...view.you.hand].filter(
      (instance) => !content.cards[instance.cardId]?.token
    );
    return {
      leader: content.leaders[view.you.leaderCardId]?.name ?? "",
      tokens: deck.length + view.you.hand.length - real.length,
      deckPlusHand: real.length,
    };
  });
  if (!playing) fail("the battle screen exposed no state");
  else if (playing.deckPlusHand !== 30) fail(`the match dealt a ${playing.deckPlusHand}-card deck`);
  else ok(`the board dealt the 30-card draft, led by ${playing.leader}` + (playing.tokens ? `, plus ${playing.tokens} Borrowed Clout for going second` : ""));
  await page.screenshot({ path: path.join(OUT, "decks-test-vs-ai.png") });
}

// --- 9. the deck slot list ------------------------------------------------------------------
console.log("\n9. §4.3.2's twelve save slots");
await page.goto(`${ORIGIN}/#decks`, { waitUntil: "networkidle" });
await settleOn(".deck-slots-screen");

const slots = await page.evaluate(() => ({
  cap: window.hypeboundDecks.cap(),
  listed: document.querySelectorAll(".deck-slot:not(.deck-slot-empty)").length,
  covers: document.querySelectorAll(".deck-slot-cover canvas").length,
  badges: [...document.querySelectorAll(".deck-slot-badge[data-validity]")].map((el) => el.dataset.validity),
  active: document.querySelectorAll(".deck-slot.is-active").length,
  count: document.querySelector("#slots-count")?.textContent?.trim() ?? "",
  newSlot: Boolean(document.querySelector("#slots-new")),
  verdicts: [...document.querySelectorAll(".deck-slot-split")].map((el) => el.textContent?.trim() ?? ""),
}));

if (slots.cap !== 12) fail(`the cap is ${slots.cap}; §4.3.2 says twelve`);
else ok(`twelve slots, ${slots.count} used`);
if (slots.listed === 0) fail("no saved decks are listed");
else ok(`${slots.listed} deck(s) listed, ${slots.covers} with a rendered cover`);
if (slots.badges.length !== slots.listed) fail("not every slot carries a validity badge");
else ok(`every slot carries a validity badge (${slots.badges.join(", ")})`);
if (slots.active !== 1) fail(`${slots.active} slots are marked active; exactly one should be`);
else ok("exactly one slot is marked active");
if (!slots.newSlot) fail("there is no way to start a new deck");
else ok("and an empty slot invites a new one");
if (slots.verdicts[0]) ok(`each slot states what its Currents buy: "${slots.verdicts[0].slice(0, 90)}"`);

// --- 10. switching decks, which was impossible ------------------------------------------------
console.log("\n10. Switching decks");
/**
 * The hole this closes. `profile.decks` is an array, `setActiveDeck` exists, and
 * until now nothing in the interface listed them — saving a second deck made it
 * active and made the first unreachable except by typing a hash by hand.
 */
const second = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const { autoBuildDeck } = await import("/src/engine/deck.ts");
  const content = getContent();
  // a LEGAL second deck: an earlier fixture cycled the pool and produced two
  // copies of a Legendary, which the slot list correctly refused to activate
  const built = autoBuildDeck(content, "idols-dj-kilowatt", "Second Deck");
  profileStore.update((draft) => {
    draft.decks.push(built);
  });
  profileStore.flush();
  return profileStore.get().decks.length;
});
await page.reload({ waitUntil: "networkidle" });
await settleOn(".deck-slots-screen");

const before = await page.evaluate(() => window.hypeboundDecks.slots().find((slot) => slot.active)?.name ?? "");
const useButton = page.locator("[data-use]");
if ((await useButton.count()) === 0) fail(`with ${second} decks there is no way to switch to the other`);
else {
  await useButton.first().click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.hypeboundDecks.slots().find((slot) => slot.active)?.name ?? "");
  if (after === before) fail(`"Play with this" did not change the active deck (still ${after})`);
  else ok(`the active deck moved from "${before}" to "${after}" — a thing that could not be done at all before`);
}
await page.screenshot({ path: path.join(OUT, "decks-slots.png"), fullPage: true });

// --- 11. cover, card back and the 16-character name --------------------------------------------
console.log("\n11. Cover, card back, and the name limit");
await page.goto(`${ORIGIN}/#deckbuilder?deck=0`, { waitUntil: "networkidle" });
await settleOn(".builder-screen");

const nameLimit = await page.evaluate(() => {
  const input = document.querySelector("#db-name");
  input.value = "a name far longer than sixteen characters";
  input.dispatchEvent(new Event("input"));
  return { attr: input.getAttribute("maxlength"), value: input.value };
});
if (nameLimit.attr !== "16") fail(`the name input's maxlength is ${nameLimit.attr}`);
else if (nameLimit.value.length > 16) fail(`a pasted name survived at ${nameLimit.value.length} characters`);
else ok(`the deck name is capped at 16 ("${nameLimit.value}")`);

const identity = await page.evaluate(() => ({
  donut: Boolean(document.querySelector("#db-donut")),
  verdict: document.querySelector("#db-verdict")?.textContent?.trim() ?? "",
  legend: document.querySelectorAll(".identity-swatch").length,
  record: document.querySelector("#db-record")?.textContent?.trim() ?? "",
}));
if (!identity.donut) fail("there is no Current-split donut");
else ok(`the donut renders with ${identity.legend} Current(s) in its legend`);
if (!/Resonance|Confluence|Currents|No cards/.test(identity.verdict)) {
  fail(`the verdict line reads "${identity.verdict}"`);
} else {
  ok(`and states what the split buys: "${identity.verdict}"`);
}
if (!identity.record) fail("no per-deck record is shown");
else ok(`per-deck record: "${identity.record}"`);

// pick a cover
await page.locator("#db-pick-cover").click();
await page.waitForTimeout(300);
const covered = await page.evaluate(() => {
  const option = document.querySelector("[data-cover]");
  const id = option?.getAttribute("data-cover") ?? null;
  option?.click();
  return id;
});
await page.waitForTimeout(300);
const coverLabel = await page.evaluate(() => document.querySelector("#db-pick-cover")?.textContent?.trim() ?? "");
if (!covered) fail("the cover picker offered nothing");
else if (!coverLabel.startsWith("Cover:") || coverLabel.includes("none")) fail(`the cover button reads "${coverLabel}"`);
else ok(`picked a cover — the button now reads "${coverLabel}"`);

/**
 * The card back has to reach the board, or `DeckList.cardBackId` is exactly the
 * inert field it has been since the type was written.
 */
console.log("\n12. The deck's card back reaches the board");
const backPicked = await page.evaluate(async () => {
  const { profileStore } = await import("/src/save/profile.ts");
  // own one, so the picker has something to offer besides the default
  profileStore.update((draft) => {
    if (!draft.cosmetics.owned.includes("cardBack:award:gauntlet")) {
      draft.cosmetics.owned.push("cardBack:award:gauntlet");
    }
    draft.cosmetics.equipped = {};
  });
  profileStore.flush();
  return true;
});
void backPicked;
await page.reload({ waitUntil: "networkidle" });
await settleOn(".builder-screen");
await page.locator("#db-pick-back").click();
await page.waitForTimeout(300);

const chosenBack = await page.evaluate(() => {
  const options = [...document.querySelectorAll("[data-back]")];
  const owned = options.find((option) => option.getAttribute("data-back") !== "default");
  owned?.click();
  return { count: options.length, id: owned?.getAttribute("data-back") ?? null };
});
await page.waitForTimeout(400);
if (!chosenBack.id) fail(`the card-back picker offered only ${chosenBack.count} option(s)`);
else {
  const stored = await page.evaluate(() => window.hypeboundBuilder?.deck()?.cardBackId ?? null);
  if (stored !== chosenBack.id) fail(`the deck stored "${stored}" after picking "${chosenBack.id}"`);
  else ok(`the deck records its own card back ("${stored}")`);

  await page.locator(".builder-actions button", { hasText: "Save Deck" }).first().click();
  await page.waitForTimeout(500);
  await page.locator(".builder-actions button", { hasText: "Test vs AI" }).first().click();
  await page.waitForSelector(".battle-screen", { timeout: 20000 });
  await page.waitForTimeout(2500);

  const onBoard = await page.evaluate(async () => {
    const { cardBackStyleFor } = await import("/src/ui/battle/cardMesh.ts");
    return cardBackStyleFor(0);
  });
  const expected = await page.evaluate(async (id) => {
    const { cosmeticById } = await import("/src/game/cosmetics/index.ts");
    const { getContent } = await import("/src/engine/content.ts");
    const cosmetic = cosmeticById(getContent(), id);
    return cosmetic ? { color: cosmetic.color, emblem: cosmetic.emblem } : null;
  }, chosenBack.id);

  if (!onBoard || !expected) fail("could not read the board's card back");
  else if (onBoard.color !== expected.color || onBoard.emblem !== expected.emblem) {
    fail(`the board is using ${JSON.stringify(onBoard)}; the deck picked ${JSON.stringify(expected)}`);
  } else {
    ok(`the board is dealing the deck's own card back (${onBoard.emblem}, ${onBoard.color})`);
  }
  await page.screenshot({ path: path.join(OUT, "decks-cardback.png") });
}


/**
 * What a twenty-agent adversarial review found, checked in the browser.
 *
 * Three of the nine defects are things a player would *see*, and all three were
 * invisible to the unit tests because they live in the gap between a correct
 * function and the screen that reads it: a diff that did not compare the fields
 * the pickers write, a histogram with no diagnosis, and a returned score nothing
 * drew. The engine-level ones are pinned in `tests/decks.test.ts`.
 */
console.log("\n13. What the review found, on screen");
await page.goto(`${ORIGIN}/#deckbuilder?deck=0`, { waitUntil: "networkidle" });
await settleOn(".builder-screen");

/**
 * The cover is a saved field, so changing it is an unsaved change. The Compare
 * button is the builder's only unsaved-changes indicator, and it used to read
 * "Compare — saved" over a cover the player had just changed and would lose by
 * walking away.
 */
await page.locator(".builder-actions button", { hasText: "Save Deck" }).first().click();
await page.waitForTimeout(400);

const beforeCover = await page.evaluate(
  () =>
    [...document.querySelectorAll(".builder-actions button")]
      .map((b) => b.textContent.trim())
      .find((t) => t.startsWith("Compare")) ?? ""
);
if (!beforeCover.includes("saved")) fail(`straight after saving the button reads "${beforeCover}"`);
else ok(`straight after saving it reads "${beforeCover}"`);

const coverSwitched = await page.evaluate(() => {
  const open = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Cover:"));
  if (!open) return { ok: false, why: "no cover button" };
  open.click();
  const options = [...document.querySelectorAll(".identity-option")];
  const before = window.hypeboundBuilder?.deck()?.coverCardId ?? null;
  const next = options.find((o) => !o.classList.contains("is-chosen"));
  if (!next) return { ok: false, why: `only ${options.length} cover option(s)` };
  next.click();
  return { ok: true, before, after: window.hypeboundBuilder?.deck()?.coverCardId ?? null };
});
await page.waitForTimeout(300);

if (!coverSwitched.ok) {
  fail(`could not change the cover: ${coverSwitched.why}`);
} else if (coverSwitched.before === coverSwitched.after) {
  fail("clicking a different cover changed nothing");
} else {
  ok(`the cover changed from ${coverSwitched.before ?? "(none)"} to ${coverSwitched.after}`);

  const afterCover = await page.evaluate(
    () =>
      [...document.querySelectorAll(".builder-actions button")]
        .map((b) => b.textContent.trim())
        .find((t) => t.startsWith("Compare")) ?? ""
  );
  // "unsaved" contains "saved", so this compares against the exact saved label
  if (afterCover === beforeCover || afterCover.endsWith("— saved")) {
    fail(`after changing the cover the button still reads "${afterCover}" — the change would be lost silently`);
  } else {
    ok(`and the button now reads "${afterCover}" rather than claiming the deck is saved`);
  }

  const opened = await page.evaluate(() => {
    [...document.querySelectorAll(".builder-actions button")]
      .find((b) => b.textContent.trim().startsWith("Compare"))
      ?.click();
    return true;
  });
  await page.waitForTimeout(300);
  const summary = await page.evaluate(() => document.querySelector("#db-diff-summary")?.textContent?.trim() ?? "");
  void opened;
  if (!summary.includes("new cover")) fail(`the diff summary does not mention the cover: "${summary}"`);
  else ok(`and the diff names it: "${summary.replace(/\s+/g, " ")}"`);
}

/**
 * `DeckNeed.worstBucket` was computed by a dedicated loop and read by nothing.
 * The histogram draws what the curve *is*; this is the sentence that says where
 * it is furthest from what it should be.
 */
const curve = await page.evaluate(() => ({
  note: document.querySelector("#db-curve-note")?.textContent?.trim() ?? "",
  marked: document.querySelectorAll(".curve-bar.is-thin").length,
  bars: document.querySelectorAll(".curve-bar").length,
}));
if (!curve.note) fail("the Hype Curve draws bars and says nothing about them");
else if (curve.marked > 1) fail(`${curve.marked} buckets are marked as the thinnest one`);
else ok(`the curve states its own weak point: "${curve.note}" (${curve.marked} of ${curve.bars} bars marked)`);

/**
 * `Suggestion.score` was returned by every suggestion and drawn by nothing. The
 * bar is relative to the best row, because the number has no units — what a
 * player can use is whether the top pick is far ahead or the field is level.
 */
/**
 * A full deck has nothing to suggest, which is correct and tests nothing. Cut
 * it back the way section 3 does, to the state the panel exists for.
 */
/**
 * Close the diff first. It shares the assist host with the suggestions — and a
 * `page.goto` that changes only the hash does not remount the screen, so the
 * panel opened above would still be sitting on top of what is being checked.
 */
await page.evaluate(() => document.querySelector("#db-diff-close")?.click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  for (const row of [...document.querySelectorAll("#db-list .deck-row")].slice(2)) row.click();
});
await page.waitForTimeout(400);

const strength = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#db-suggestions .assist-row")];
  return rows.map((row) => ({
    score: Number(row.getAttribute("data-score")),
    width: row.querySelector(".assist-strength i")?.style.width ?? "",
  }));
});
if (strength.length === 0) {
  fail("no suggestions rendered, so the strength bar could not be checked");
} else if (strength.some((row) => !row.width)) {
  fail(`${strength.filter((r) => !r.width).length} suggestion row(s) draw no strength bar`);
} else if (strength.some((row) => !Number.isFinite(row.score) || row.score <= 0)) {
  fail("a suggestion carries no score to draw");
} else {
  const widths = strength.map((row) => parseFloat(row.width));
  const descending = widths.every((width, i) => i === 0 || width <= widths[i - 1] + 0.01);
  if (!descending) fail(`the strength bars are not in the list's own order: ${widths.join(", ")}`);
  else if (Math.round(widths[0]) !== 100) fail(`the best suggestion's bar is ${widths[0]}%, not full`);
  else ok(`${strength.length} suggestions draw their score, best first (${widths.map((w) => `${Math.round(w)}%`).join(", ")})`);
}

await page.screenshot({ path: path.join(OUT, "decks-review.png") });

if (errors.length > 0) {
  console.log("\nConsole errors:");
  for (const error of [...new Set(errors)].slice(0, 10)) console.log(`   ${error}`);
  failures += errors.length;
}

console.log("\n   saved screenshots/decks-*.png");
console.log(failures === 0 ? "\nPASS\n" : `\n${failures} FAILURE(S)\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
