/**
 * Deck comparison and deck-building assistance — known gap 8, and
 * `03-screens-and-navigation.md` §4.3.2.
 *
 * The load-bearing property is **ownership**. `14-ai-design.md` requires the
 * builder's auto-generate to run *"from the player's collection (pool restricted
 * to owned cards), then report which suggested cards the player is missing"* —
 * and the shipped Auto-Build button called `autoBuildDeck`, which considers the
 * collection not at all. Pressing it handed you thirty cards you could not have
 * added by hand, which then validated as a legal deck and could be saved and
 * played.
 *
 * Ownership deliberately is **not** enforced in `validateDeck`: the Grand Tour's
 * loaner decks, the starter decks, Doomscroll run decks and Gauntlet drafts all
 * legitimately contain cards the account does not own. So these tests pin the
 * rule where it belongs — in the builder's own suggestions — and assert the
 * engine keeps out of it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, collectibleCards, selectableLeaders } from "../src/engine/content";
import { TARGET_CURVE, autoBuildDeck, curveBucket, legalCardPool, validateDeck } from "../src/engine/deck";
import { deckPureCurrent } from "../src/engine/currents";
import type { Collection } from "../src/game/decks";
import {
  autoCompleteDeck,
  buildAround,
  coverCard,
  coverOptions,
  currentSplit,
  deckRecord,
  checkDeckToolsData,
  craftTargets,
  deckNeeds,
  deckToolsData,
  addableCards,
  diffDecks,
  playableCopies,
  replacementsFor,
  suggestCards,
} from "../src/game/decks";
import type { ConfluenceId, DeckList } from "../src/engine/types";
import type { MatchHistoryEntry } from "../src/save/profile";
import { deleteDeck, grantStarterDeck, playableDeck, profileStore, saveDeck, setActiveDeck } from "../src/save/profile";
import { starterDecks } from "../src/game/progression/data";
import type { FactionId } from "../src/engine/types";

const content = getContent();
const LEADER = "idols-lumi-starcall";

const deckOf = (cards: string[], name = "Test", leaderCardId = LEADER): DeckList => ({ name, leaderCardId, cards });

/** A faction that actually ships a starter deck, since that is what is being granted. */
const STARTER_FACTION = starterDecks()[0]!.factionId as FactionId;

/** A collection holding `copies` of everything legal for a leader. */
function fullCollection(leaderCardId = LEADER, copies = 2): Collection {
  const leader = content.leaders[leaderCardId]!;
  return Object.fromEntries(legalCardPool(content, leader).map((card) => [card.id, copies]));
}

// ---------------------------------------------------------------------------

describe("copies an account may actually run", () => {
  it("is the lesser of the rule and what you own", () => {
    const common = collectibleCards(content).find((card) => card.rarity === "common")!;
    const legendary = collectibleCards(content).find((card) => card.rarity === "legendary")!;
    const { maxCopies, maxCopiesLegendary } = content.balance.deck;

    expect(playableCopies(content, common, 99)).toBe(maxCopies);
    expect(playableCopies(content, common, 1)).toBe(1);
    expect(playableCopies(content, common, 0)).toBe(0);
    expect(playableCopies(content, legendary, 99)).toBe(maxCopiesLegendary);
    expect(playableCopies(content, legendary, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("compare versions — §4.3.2", () => {
  const saved = deckOf(["idols-stan-account", "idols-stan-account", "idols-backup-dancer"], "Mine");

  it("reports an untouched draft as identical", () => {
    const diff = diffDecks(content, saved, structuredClone(saved));
    expect(diff.identical).toBe(true);
    expect(diff.unsaved).toBe(false);
    expect(diff.rows).toEqual([]);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  /**
   * A deck is a multiset, so the useful sentence is "you cut one of your two",
   * not "one of thirty ids differs". Counts, both ways, in one row per card.
   */
  it("counts copies rather than listing ids", () => {
    const draft = deckOf(["idols-stan-account", "idols-backup-dancer", "idols-stage-tech"], "Mine");
    const diff = diffDecks(content, saved, draft);

    const stan = diff.rows.find((row) => row.cardId === "idols-stan-account")!;
    expect(stan.before).toBe(2);
    expect(stan.after).toBe(1);
    expect(stan.delta).toBe(-1);

    const tech = diff.rows.find((row) => row.cardId === "idols-stage-tech")!;
    expect(tech.before).toBe(0);
    expect(tech.after).toBe(1);
    expect(tech.delta).toBe(1);

    // a card that did not move is not a row
    expect(diff.rows.some((row) => row.cardId === "idols-backup-dancer")).toBe(false);

    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.identical).toBe(false);
  });

  it("reports both sizes, so 28 → 30 can be stated rather than implied", () => {
    const draft = deckOf([...saved.cards, "idols-stage-tech"], "Mine");
    const diff = diffDecks(content, saved, draft);
    expect(diff.beforeSize).toBe(3);
    expect(diff.afterSize).toBe(4);
  });

  it("notices a changed leader and a changed name", () => {
    const renamed = { ...structuredClone(saved), name: "Something else" };
    expect(diffDecks(content, saved, renamed).nameChanged).toBe(true);
    expect(diffDecks(content, saved, renamed).identical).toBe(false);

    const releadered = { ...structuredClone(saved), leaderCardId: "idols-dj-kilowatt" };
    const diff = diffDecks(content, saved, releadered);
    expect(diff.leaderChanged).toBe(true);
    expect(diff.beforeLeaderCardId).toBe(LEADER);
    expect(diff.afterLeaderCardId).toBe("idols-dj-kilowatt");
  });

  /**
   * An empty slot is *unsaved*, not "thirty cards added". There is no version to
   * compare against, and thirty green rows would imply there was.
   */
  it("says a slot has nothing saved rather than calling the whole deck an addition", () => {
    const diff = diffDecks(content, null, saved);
    expect(diff.unsaved).toBe(true);
    expect(diff.identical).toBe(false);
    expect(diff.leaderChanged).toBe(false);
    expect(diff.nameChanged).toBe(false);
    expect(diff.beforeSize).toBe(0);
  });

  it("orders rows by cost, the way the deck list is read", () => {
    const draft = deckOf(["idols-stage-tech"], "Mine");
    const diff = diffDecks(content, saved, draft);
    const costs = diff.rows.map((row) => row.cost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("survives a card the build no longer ships", () => {
    const stale = deckOf(["a-card-that-was-removed"], "Old");
    const diff = diffDecks(content, stale, deckOf([], "Old"));
    expect(diff.rows[0]!.name).toBe("a-card-that-was-removed");
    expect(diff.rows[0]!.delta).toBe(-1);
  });
});

// ---------------------------------------------------------------------------

describe("the engine stays out of ownership", () => {
  /**
   * This is a guard, not a wish. Four shipped systems hand the player a deck of
   * cards they do not own — the Grand Tour's loaner, the starter decks, a
   * Doomscroll run deck and a Gauntlet draft. If ownership ever moved into
   * `validateDeck`, all four would start reporting illegal decks.
   */
  it("validates a deck of cards nobody owns", () => {
    const built = autoBuildDeck(content, LEADER, "Nobody owns any of this");
    expect(validateDeck(content, built)).toEqual([]);
  });

  it("and the auto-builder does not consult a collection at all", () => {
    // its signature has nowhere to put one, which is the point: the collection
    // rule belongs to the builder's suggestions, not to deck construction
    expect(autoBuildDeck.length).toBeLessThanOrEqual(4);
    const a = autoBuildDeck(content, LEADER, "x");
    const b = autoBuildDeck(content, LEADER, "x");
    expect(a.cards).toEqual(b.cards);
  });

  it("gives a full collection every legal card at the playable cap", () => {
    const collection = fullCollection();
    const leader = content.leaders[LEADER]!;
    for (const card of legalCardPool(content, leader)) {
      expect(collection[card.id]).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the tunables", () => {
  it("pass their own check", () => {
    const problems = checkDeckToolsData();
    expect(problems, problems.length === 0 ? "" : `\ndeck-tools.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("catch a weighting that would make the panel useless", () => {
    const data = deckToolsData();
    const original = data.weights.curve;
    data.weights.curve = 0;
    expect(checkDeckToolsData().join(" ")).toContain("no curve help");
    data.weights.curve = original;

    const swap = data.replacements.sameCostBonus;
    data.replacements.sameCostBonus = 0;
    expect(checkDeckToolsData().join(" ")).toContain("not a replacement");
    data.replacements.sameCostBonus = swap;

    expect(checkDeckToolsData()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("what a deck is short of", () => {
  it("measures against the same curve autoBuildDeck fills", () => {
    const empty = deckOf([]);
    const need = deckNeeds(content, empty);
    expect(need.short).toBe(content.balance.deck.size);
    for (const [bucket, want] of Object.entries(TARGET_CURVE)) {
      expect(need.curve[Number(bucket)]).toBe(want);
    }
  });

  /**
   * A full deck is not necessarily a filled curve.
   *
   * `autoBuildDeck` aims at `TARGET_CURVE` and then tops up with whatever is
   * legal when a bucket runs dry — most leaders simply do not print two cards at
   * 7 or more Hype. So a thirty-card auto-built deck is `short: 0` and still
   * reports an outstanding bucket, and that is the truth rather than a bug: an
   * earlier version of this test asserted the curve came out perfect and was
   * asserting something the card pool cannot deliver.
   */
  it("separates being full from having the curve it wanted", () => {
    const built = autoBuildDeck(content, LEADER, "Full");
    expect(built.cards.length).toBe(content.balance.deck.size);
    expect(deckNeeds(content, built).short).toBe(0);

    // and a curve really is reported as filled when it is
    const exact: string[] = [];
    const pool = legalCardPool(content, content.leaders[LEADER]!);
    for (const [bucket, want] of Object.entries(TARGET_CURVE)) {
      const atCost = pool.filter((card) => curveBucket(card.cost) === Number(bucket));
      for (let i = 0; i < want && atCost.length > 0; i++) exact.push(atCost[i % atCost.length]!.id);
    }
    const need = deckNeeds(content, deckOf(exact));
    for (const [bucket, want] of Object.entries(TARGET_CURVE)) {
      const supplied = pool.filter((card) => curveBucket(card.cost) === Number(bucket)).length;
      if (supplied > 0) expect(need.curve[Number(bucket)], `bucket ${bucket}`).toBe(Math.max(0, want - want));
    }
  });

  /**
   * A deck of one Current is seven cards from Perfect Resonance. A deck of two
   * has given that up for a Confluence, and suggesting "keep it pure" would be
   * advice about a deck the player is not building.
   */
  it("knows whether the deck is still pure", () => {
    const leader = content.leaders[LEADER]!;
    const pool = legalCardPool(content, leader).filter((card) => card.current !== "prism");
    const primary = pool.filter((card) => card.current === leader.primaryCurrent);
    const other = pool.find((card) => card.current !== leader.primaryCurrent);

    expect(deckNeeds(content, deckOf(primary.slice(0, 3).map((c) => c.id))).pureCurrent).toBe(
      leader.primaryCurrent
    );
    if (other) {
      const mixed = [...primary.slice(0, 3).map((c) => c.id), other.id];
      expect(deckNeeds(content, deckOf(mixed)).pureCurrent).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe("suggestions", () => {
  const collection = fullCollection();

  /**
   * The rule §14 states and Auto-Build broke. Every suggestion has to be a card
   * the account could add by hand, one at a time, through the pool beside it.
   */
  it("never suggests a card the account does not own", () => {
    const sparse: Collection = { "idols-stan-account": 2, "idols-backup-dancer": 1 };
    const suggestions = suggestCards(content, deckOf([]), sparse, 20);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(sparse[suggestion.cardId] ?? 0, suggestion.cardId).toBeGreaterThan(0);
    }
  });

  it("never suggests more copies than the rules and the collection allow", () => {
    const one: Collection = { "idols-stan-account": 1 };
    expect(suggestCards(content, deckOf(["idols-stan-account"]), one, 20)).toEqual([]);
    expect(suggestCards(content, deckOf([]), one, 20)[0]?.copies).toBe(1);
  });

  it("suggests nothing at all for a full deck", () => {
    expect(suggestCards(content, autoBuildDeck(content, LEADER, "Full"), collection)).toEqual([]);
  });

  it("only ever suggests cards legal for the leader", () => {
    const leader = content.leaders[LEADER]!;
    const legal = new Set(legalCardPool(content, leader).map((card) => card.id));
    // a collection holding literally everything, so illegality is the only filter
    const everything: Collection = Object.fromEntries(collectibleCards(content).map((card) => [card.id, 2]));
    for (const suggestion of suggestCards(content, deckOf([]), everything, 30)) {
      expect(legal.has(suggestion.cardId), `${suggestion.cardId} is not legal for ${LEADER}`).toBe(true);
    }
  });

  /**
   * Every suggestion carries the term that dominated its score, said in a
   * sentence. A recommendation nobody can argue with is one nobody can act on.
   */
  it("explains itself, every time", () => {
    for (const suggestion of suggestCards(content, deckOf([]), collection, 20)) {
      expect(suggestion.why.trim().length, suggestion.cardId).toBeGreaterThan(8);
      expect(["curve", "tag", "synergy", "current", "resonance", "any"]).toContain(suggestion.reason);
    }
  });

  /**
   * The claim in "fills your 4-cost gap" has to be true. This is the property
   * that stops the weights drifting into nonsense: whatever the ranking does,
   * a curve-reasoned suggestion must land in a bucket that is actually short.
   */
  it("only claims a curve reason when that bucket really is short", () => {
    const partial = deckOf(autoBuildDeck(content, LEADER, "x").cards.slice(0, 12));
    const need = deckNeeds(content, partial);
    for (const suggestion of suggestCards(content, partial, collection, 20)) {
      if (suggestion.reason !== "curve") continue;
      expect(need.curve[curveBucket(suggestion.cost)] ?? 0, `${suggestion.cardId} at cost ${suggestion.cost}`).toBeGreaterThan(0);
    }
  });

  it("is deterministic, so the panel does not reshuffle under the cursor", () => {
    const deck = deckOf(autoBuildDeck(content, LEADER, "x").cards.slice(0, 10));
    expect(suggestCards(content, deck, collection, 8).map((s) => s.cardId)).toEqual(
      suggestCards(content, deck, collection, 8).map((s) => s.cardId)
    );
  });

  it("converges on what the deck already is", () => {
    // stuff a deck with one tag and check the suggestions lean the same way
    const leader = content.leaders[LEADER]!;
    const idols = legalCardPool(content, leader).filter((card) => card.tags.includes("idol"));
    if (idols.length < 3) return;
    const themed = deckOf(idols.slice(0, 3).map((card) => card.id));
    const suggestions = suggestCards(content, themed, collection, 6);
    const sharing = suggestions.filter((s) => (content.cards[s.cardId]?.tags ?? []).includes("idol")).length;
    expect(sharing, "the panel ignored the archetype in front of it").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("what you are missing — §14", () => {
  it("names cards it would have suggested if you owned them", () => {
    const sparse: Collection = { "idols-stan-account": 2 };
    const targets = craftTargets(content, deckOf([]), sparse, 10);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(sparse[target.cardId] ?? 0).toBe(0);
      expect(target.copies).toBe(0);
      expect(target.needToOwn).toBeGreaterThan(0);
      expect(target.why.trim().length).toBeGreaterThan(8);
    }
  });

  it("names nothing when the account owns everything legal", () => {
    expect(craftTargets(content, deckOf([]), fullCollection(), 10)).toEqual([]);
  });

  it("keeps the list short enough to act on", () => {
    const targets = craftTargets(content, deckOf([]), {});
    expect(targets.length).toBeLessThanOrEqual(deckToolsData().suggestions.craftTargets);
  });
});

// ---------------------------------------------------------------------------

describe("replacements for cards you cannot field", () => {
  /**
   * A real case: a deck code from somebody else, or a deck saved before its
   * cards were dismantled. `validateDeck` says the list is perfect and the
   * account cannot play it.
   */
  it("finds the card you cannot field, and offers something you can", () => {
    const collection = fullCollection();
    const borrowed = deckOf(["idols-stan-account", "idols-stan-account", "idols-backup-dancer"]);
    const without: Collection = { ...collection, "idols-stan-account": 0 };

    const replacements = replacementsFor(content, borrowed, without);
    const row = replacements.find((entry) => entry.cardId === "idols-stan-account")!;
    expect(row.excess).toBe(2);
    expect(row.with).not.toBeNull();
    expect(without[row.with!.cardId] ?? 0).toBeGreaterThan(0);
    // and it does not suggest the card it is replacing
    expect(row.with!.cardId).not.toBe("idols-stan-account");
  });

  it("counts only the copies you are actually short of", () => {
    const collection = fullCollection();
    const deck = deckOf(["idols-stan-account", "idols-stan-account"]);
    const one: Collection = { ...collection, "idols-stan-account": 1 };
    expect(replacementsFor(content, deck, one)[0]!.excess).toBe(1);
  });

  it("says nothing about a deck the account can field", () => {
    const collection = fullCollection();
    expect(replacementsFor(content, autoBuildDeck(content, LEADER, "x"), collection)).toEqual([]);
  });

  /**
   * A replacement that changes the curve is not a replacement — which is what
   * `sameCostBonus` is for, and why it is the largest number in the file.
   */
  it("prefers a substitute at the same cost", () => {
    const collection = fullCollection();
    const leader = content.leaders[LEADER]!;
    const pool = legalCardPool(content, leader);
    const victim = pool.find((card) => pool.filter((other) => other.cost === card.cost).length > 2);
    if (!victim) return;

    const without: Collection = { ...collection, [victim.id]: 0 };
    const row = replacementsFor(content, deckOf([victim.id]), without)[0]!;
    expect(row.with).not.toBeNull();
    expect(Math.abs(row.with!.cost - victim.cost), `${victim.name} (${victim.cost}) → ${row.with!.name} (${row.with!.cost})`).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("auto-complete", () => {
  const collection = fullCollection();

  it("fills to a legal deck from the collection alone", () => {
    const filled = autoCompleteDeck(content, deckOf([]), collection);
    expect(filled.cards.length).toBe(content.balance.deck.size);
    expect(validateDeck(content, filled)).toEqual([]);
    for (const cardId of filled.cards) expect(collection[cardId] ?? 0).toBeGreaterThan(0);
  });

  it("keeps what you already chose", () => {
    const started = deckOf(["idols-stage-tech", "idols-stage-tech"]);
    const filled = autoCompleteDeck(content, started, collection);
    expect(filled.cards.filter((id) => id === "idols-stage-tech").length).toBeGreaterThanOrEqual(2);
    expect(filled.cards.length).toBe(content.balance.deck.size);
  });

  /**
   * The honest half. A collection of four cards cannot make thirty, and the old
   * Auto-Build's answer was to invent twenty-six the account had never seen.
   */
  it("stops short rather than inventing cards you do not own", () => {
    const sparse: Collection = { "idols-stan-account": 2, "idols-backup-dancer": 2 };
    const filled = autoCompleteDeck(content, deckOf([]), sparse);
    expect(filled.cards.length).toBe(4);
    for (const cardId of filled.cards) expect(sparse[cardId]).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(autoCompleteDeck(content, deckOf([]), collection).cards).toEqual(
      autoCompleteDeck(content, deckOf([]), collection).cards
    );
  });

  /**
   * **Every leader**, not one.
   *
   * This is the test that caught the bug. Suggestions originally gated on
   * ownership and copy count alone, so `autoCompleteDeck` for **Skree Nine-Tabs**
   * returned thirty owned, under-limit, individually legal cards that together
   * broke the Prism splash limit — *six Prism against a maximum of three*. It
   * went unnoticed because the fill was only ever run for Neon Idols, who print
   * one Prism card in total.
   *
   * The lesson is the one this project keeps relearning: a suite that exercises
   * one representative of a set is testing the representative.
   */
  it("builds a legal deck for every selectable leader", () => {
    const broken: string[] = [];
    for (const leader of selectableLeaders(content)) {
      const owned = Object.fromEntries(legalCardPool(content, leader).map((card) => [card.id, 2]));
      const filled = autoCompleteDeck(content, deckOf([], "x", leader.id), owned);
      const problems = validateDeck(content, filled).filter((problem) => problem.code !== "wrongSize");
      if (problems.length > 0) broken.push(`${leader.id}: ${problems.map((p) => p.message).join("; ")}`);
    }
    expect(broken, broken.length === 0 ? "" : `\n${broken.length} leaders:\n  ${broken.join("\n  ")}\n`).toEqual([]);
  });

  it("respects the Prism splash limit specifically", () => {
    const leader = content.leaders["meme-leader-skree-nine-tabs"]!;
    const owned = Object.fromEntries(legalCardPool(content, leader).map((card) => [card.id, 2]));
    const filled = autoCompleteDeck(content, deckOf([], "x", leader.id), owned);
    const prism = filled.cards.filter((id) => content.cards[id]?.current === "prism").length;
    expect(prism, `${prism} Prism in a deck limited to ${content.balance.deck.prismSplashLimit}`).toBeLessThanOrEqual(
      content.balance.deck.prismSplashLimit
    );
  });

  /**
   * A deck that is already broken still gets help.
   *
   * The legality gate is a *delta*: adding a card may not make anything worse.
   * Demanding a clean deck first would leave somebody staring at an imported
   * list they cannot fix with an empty suggestions panel.
   */
  it("still suggests something for a deck that is already illegal", () => {
    const leader = content.leaders["meme-leader-skree-nine-tabs"]!;
    const prismCards = legalCardPool(content, leader)
      .filter((card) => card.current === "prism")
      .slice(0, 5)
      .map((card) => card.id);
    if (prismCards.length < 5) return;

    const overSplashed = deckOf(prismCards, "Broken", leader.id);
    expect(validateDeck(content, overSplashed).some((p) => p.code === "tooManyPrism")).toBe(true);

    const owned = Object.fromEntries(legalCardPool(content, leader).map((card) => [card.id, 2]));
    const suggestions = suggestCards(content, overSplashed, owned, 5);
    expect(suggestions.length, "an illegal deck was offered no help at all").toBeGreaterThan(0);
    // and none of them makes the Prism problem worse
    for (const suggestion of suggestions) {
      expect(content.cards[suggestion.cardId]?.current, suggestion.cardId).not.toBe("prism");
    }
  });

  it("never exceeds the copy limit", () => {
    const filled = autoCompleteDeck(content, deckOf([]), collection);
    const counts = new Map<string, number>();
    for (const id of filled.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [cardId, count] of counts) {
      const card = content.cards[cardId]!;
      expect(count, cardId).toBeLessThanOrEqual(playableCopies(content, card, 99));
    }
  });
});

// ---------------------------------------------------------------------------

describe("build around this card — §4.3.2", () => {
  const collection = fullCollection();

  it("picks a leader that can legally run the card", () => {
    const built = buildAround(content, "idols-backup-dancer", collection)!;
    expect(built).not.toBeNull();
    const leader = content.leaders[built.leaderCardId]!;
    expect(legalCardPool(content, leader).some((card) => card.id === "idols-backup-dancer")).toBe(true);
    expect(built.cards).toContain("idols-backup-dancer");
  });

  it("seeds every copy the account owns", () => {
    const two: Collection = { ...collection, "idols-backup-dancer": 2 };
    const built = buildAround(content, "idols-backup-dancer", two)!;
    expect(built.cards.filter((id) => id === "idols-backup-dancer").length).toBe(2);
  });

  it("refuses a token, a leader, or a card that does not exist", () => {
    expect(buildAround(content, "no-such-card", collection)).toBeNull();
    const token = Object.values(content.cards).find((card) => card.token);
    if (token) expect(buildAround(content, token.id, collection)).toBeNull();
    expect(buildAround(content, LEADER, collection)).toBeNull();
  });

  /**
   * The bug this caught, and the reason it is worth its own test.
   *
   * The seed was `Math.max(1, playableCopies(...))`, so building around a card
   * you did not own put an uncollected copy in the list — the exact failure this
   * whole module exists to stop, one corner over. It refuses now, and the pool
   * only offers the control on a card you own; both, because a rule enforced in
   * one place is a rule waiting to be walked around.
   */
  it("refuses to build around a card the account does not own", () => {
    expect(buildAround(content, "idols-backup-dancer", {})).toBeNull();
    expect(buildAround(content, "idols-backup-dancer", { "idols-backup-dancer": 0 })).toBeNull();
    expect(buildAround(content, "idols-backup-dancer", { "idols-backup-dancer": 1 })).not.toBeNull();
  });

  it("never puts an unowned card in the deck it builds", () => {
    for (const cardId of ["idols-backup-dancer", "idols-stage-tech"]) {
      const sparse: Collection = { [cardId]: 2, "idols-stan-account": 2 };
      const built = buildAround(content, cardId, sparse);
      if (!built) continue;
      for (const id of built.cards) {
        expect(sparse[id] ?? 0, `${id} is not owned`).toBeGreaterThan(0);
      }
    }
  });

  it("builds something legal, or honestly short", () => {
    const built = buildAround(content, "idols-stage-tech", collection)!;
    const problems = validateDeck(content, built).filter((problem) => problem.code !== "wrongSize");
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the Current split — §4.3.2", () => {
  const leader = content.leaders[LEADER]!;
  const pool = legalCardPool(content, leader).filter((card) => card.current !== "prism");
  const primary = pool.filter((card) => card.current === leader.primaryCurrent);
  const secondary = pool.filter((card) => card.current === leader.secondaryCurrent);

  it("says nothing about an empty deck rather than inventing a verdict", () => {
    const split = currentSplit(content, deckOf([]));
    expect(split.slices).toEqual([]);
    expect(split.pureCurrent).toBeNull();
    expect(split.verdict).toBe("No cards yet.");
  });

  /**
   * §4.3.2's own wording, and the reason the donut is worth drawing: the picture
   * says what the split *is*, the sentence says what it **buys**.
   */
  it("names Perfect Resonance for a pure deck, and how far off it is", () => {
    const threshold = content.balance.resonance.threshold;
    const nearly = currentSplit(content, deckOf(primary.slice(0, 2).map((card) => card.id)));
    expect(nearly.pureCurrent).toBe(leader.primaryCurrent);
    expect(nearly.verdict).toContain("Pure");
    expect(nearly.verdict).toMatch(/more .* for Perfect Resonance/);

    const enough: string[] = [];
    while (enough.length < threshold) enough.push(primary[enough.length % primary.length]!.id);
    const there = currentSplit(content, deckOf(enough));
    expect(there.verdict).toContain("Perfect Resonance enabled");
  });

  it("names the Confluence a two-Current deck unlocks", () => {
    if (secondary.length === 0) return;
    const split = currentSplit(content, deckOf([primary[0]!.id, secondary[0]!.id]));
    expect(split.slices.length).toBe(2);
    expect(split.pureCurrent).toBeNull();
    if (split.confluenceId) {
      expect(split.verdict).toContain("Confluence:");
      expect(split.verdict).toContain(content.confluences[split.confluenceId as ConfluenceId]!.name);
    } else {
      expect(split.verdict).toContain("no Confluence for that pair");
    }
  });

  /**
   * Prism is the splash, not a third Current — for the **donut**. A deck of Halo
   * plus three Prism draws one slice, because `validateDeck` counts it as a Halo
   * deck and a picture that called it "two Currents" would contradict the rule
   * printed two panels above it.
   *
   * It is a different question from whether the deck is **pure**, and conflating
   * the two is precisely the bug this test now guards. Legality says the splash
   * is fine; `deckPureCurrent` returns null on sight of a single Prism card, so
   * Perfect Resonance is off. The panel used to say "Pure Halo — Perfect
   * Resonance enabled after 7 Halo cards" over a deck that could never have it.
   */
  it("counts Prism as one slice, and still admits the splash broke purity", () => {
    const prism = legalCardPool(content, leader).find((card) => card.current === "prism");
    if (!prism) return;
    const deck = deckOf([...primary.slice(0, 3).map((card) => card.id), prism.id]);
    const split = currentSplit(content, deck);

    expect(split.slices.length).toBe(1);
    expect(split.slices[0]!.current).toBe(leader.primaryCurrent);
    expect(split.prism).toBe(1);

    expect(split.pureCurrent).toBeNull();
    expect(split.verdict).not.toContain("Pure ");
    expect(split.verdict).toContain("1 Prism");
    expect(split.verdict).toContain("Refraction");
  });

  /**
   * The assertion that would have caught it, and the one that keeps catching it.
   *
   * Purity is the engine's rule, so the only durable check is that this module's
   * answer **is** the engine's answer — for every leader, for a clean deck and
   * for the same deck with one Prism card added. Testing one representative deck
   * for one leader is what let the original mistake through: Neon Idols have a
   * single Prism card, and nobody splashed it.
   */
  it("agrees with the engine about purity, for every leader, splashed or not", () => {
    for (const entry of selectableLeaders(content)) {
      const built = autoBuildDeck(content, entry.id, "x");
      expect(currentSplit(content, built).pureCurrent).toBe(deckPureCurrent(content, built));
      expect(deckNeeds(content, built).pureCurrent).toBe(deckPureCurrent(content, built));

      const prismCard = legalCardPool(content, entry).find((card) => card.current === "prism");
      if (!prismCard) continue;
      const splashed = { ...built, cards: [...built.cards.slice(0, -1), prismCard.id] };
      expect(currentSplit(content, splashed).pureCurrent).toBeNull();
      expect(deckNeeds(content, splashed).pureCurrent).toBeNull();
      expect(currentSplit(content, splashed).verdict).not.toContain("Perfect Resonance enabled");
    }
  });

  /**
   * A draft may hold a card id this build no longer has — an imported deck code,
   * or a card cut from the game since it was saved. The engine's `deckPureCurrent`
   * throws on one; every read in this module skips it. The screen must not crash.
   */
  it("survives a card id that is no longer in the build", () => {
    const deck = deckOf([primary[0]!.id, "gone-from-this-build"]);
    expect(() => currentSplit(content, deck)).not.toThrow();
    expect(currentSplit(content, deck).pureCurrent).toBe(leader.primaryCurrent);
    expect(() => deckNeeds(content, deck)).not.toThrow();
  });

  it("warns when a deck has more Currents than a Leader allows", () => {
    const three = new Set<string>();
    const cards: string[] = [];
    for (const card of pool) {
      if (three.size >= 3 && !three.has(card.current)) continue;
      three.add(card.current);
      cards.push(card.id);
      if (three.size === 3) break;
    }
    if (three.size < 3) return;
    expect(currentSplit(content, deckOf(cards)).verdict).toContain("will not validate");
  });

  it("shares of the slices add up", () => {
    const split = currentSplit(content, deckOf(autoBuildDeck(content, LEADER, "x").cards));
    const total = split.slices.reduce((sum, slice) => sum + slice.share, 0);
    if (split.slices.length > 0) expect(total).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------

describe("the cover — §4.3.2", () => {
  it("offers only cards that are in the deck", () => {
    const deck = deckOf(["idols-stan-account", "idols-stan-account", "idols-backup-dancer"]);
    const options = coverOptions(content, deck).map((card) => card.id);
    expect(new Set(options)).toEqual(new Set(["idols-stan-account", "idols-backup-dancer"]));
  });

  it("falls back to the costliest card when nothing is chosen", () => {
    const deck = deckOf(["idols-stan-account", "idols-backup-dancer"]);
    const cover = coverCard(content, deck)!;
    const costliest = Math.max(...deck.cards.map((id) => content.cards[id]!.cost));
    expect(cover.cost).toBe(costliest);
  });

  /**
   * A cover you cut two edits ago would show a card the deck no longer holds,
   * which is exactly the sort of quiet inconsistency `coverCardId` had time to
   * acquire while nothing read it.
   */
  it("ignores a chosen cover the deck no longer contains", () => {
    const deck: DeckList = { ...deckOf(["idols-backup-dancer"]), coverCardId: "idols-stan-account" };
    expect(coverCard(content, deck)!.id).toBe("idols-backup-dancer");
  });

  it("has no cover for an empty deck", () => {
    expect(coverCard(content, deckOf([]))).toBeNull();
    expect(coverOptions(content, deckOf([]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("a deck's record — §4.3.2's stats tab", () => {
  const entry = (deckName: string, result: "win" | "loss" | "draw"): MatchHistoryEntry => ({
    id: `m${Math.random().toString(36).slice(2)}`,
    playedAt: Date.now(),
    deckName,
    leaderCardId: LEADER,
    opponentLeaderCardId: "goth-leader-morvina-vane",
    result,
    turns: 8,
    mode: "ai-casual",
  });

  it("reports nothing for a deck that has never been played", () => {
    const record = deckRecord(content, [], "Never Played");
    expect(record.played).toBe(0);
    expect(record.thin).toBe(true);
  });

  /**
   * A win rate on three games is not a win rate. The dashboard's own
   * `MIN_SAMPLE` decides, so the builder and the statistics screen agree about
   * when a number is worth printing.
   */
  it("marks a thin sample rather than reporting 33%", () => {
    const history = [entry("Mine", "win"), entry("Mine", "loss"), entry("Mine", "loss")];
    const record = deckRecord(content, history, "Mine");
    expect(record.played).toBe(3);
    expect(record.thin).toBe(true);
  });

  it("counts only that deck's matches", () => {
    const history = [
      ...Array.from({ length: 6 }, () => entry("Mine", "win")),
      ...Array.from({ length: 4 }, () => entry("Other", "loss")),
    ];
    const mine = deckRecord(content, history, "Mine");
    expect(mine.played).toBe(6);
    expect(mine.won).toBe(6);
    expect(mine.winRate).toBe(1);
    expect(mine.thin).toBe(false);
    expect(deckRecord(content, history, "Other").played).toBe(4);
  });

  /**
   * The record is keyed by **name**, because that is what `recordMatch` stamps
   * on a history entry — there is no deck id in this game. Renaming therefore
   * starts a record over, and the screen says so rather than quietly reporting a
   * win rate about a different deck.
   */
  it("is keyed by name, with everything that implies", () => {
    const history = [...Array.from({ length: 6 }, () => entry("Old Name", "win"))];
    expect(deckRecord(content, history, "Old Name").played).toBe(6);
    expect(deckRecord(content, history, "New Name").played).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("deck slots — §4.3.2", () => {
  beforeEach(() => profileStore.reset());

  it("caps at the number of slots the data publishes", () => {
    const slots = content.balance.deck.slots;
    expect(slots).toBeGreaterThan(1);

    for (let i = 0; i < slots; i++) {
      expect(saveDeck(deckOf([], `Deck ${i}`)), `slot ${i}`).toBe(i);
    }
    expect(profileStore.get().decks.length).toBe(slots);
    // and the next one is refused rather than silently appended
    expect(saveDeck(deckOf([], "One too many"))).toBe(-1);
    expect(profileStore.get().decks.length).toBe(slots);
  });

  /**
   * The bug the slot list exposed.
   *
   * `activeDeckIndex` is an index into a list that shifts when a slot is
   * deleted, and only the upper bound was being clamped — so deleting slot 0
   * while slot 2 was active left the pointer at 2, silently changing which deck
   * you were playing to a different one. It was unreachable while nothing in
   * the interface listed the slots; §4.3.2's list makes it two clicks away.
   */
  it("keeps the active deck the same deck when an earlier slot is deleted", () => {
    for (const name of ["A", "B", "C", "D"]) saveDeck(deckOf([], name));
    setActiveDeck(2);
    expect(profileStore.get().decks[profileStore.get().activeDeckIndex]!.name).toBe("C");

    deleteDeck(0);
    expect(profileStore.get().decks.map((deck) => deck.name)).toEqual(["B", "C", "D"]);
    expect(
      profileStore.get().decks[profileStore.get().activeDeckIndex]!.name,
      "deleting an earlier slot changed which deck is active"
    ).toBe("C");
  });

  it("falls back sensibly when the active slot is the one deleted", () => {
    for (const name of ["A", "B", "C"]) saveDeck(deckOf([], name));
    setActiveDeck(1);
    deleteDeck(1);
    expect(profileStore.get().decks.map((deck) => deck.name)).toEqual(["A", "C"]);
    expect(profileStore.get().activeDeckIndex).toBe(0);
  });

  it("leaves the pointer alone when a later slot is deleted", () => {
    for (const name of ["A", "B", "C"]) saveDeck(deckOf([], name));
    setActiveDeck(0);
    deleteDeck(2);
    expect(profileStore.get().activeDeckIndex).toBe(0);
    expect(profileStore.get().decks[0]!.name).toBe("A");
  });

  it("survives deleting the last deck, and an index that is not there", () => {
    saveDeck(deckOf([], "Only"));
    deleteDeck(0);
    expect(profileStore.get().decks).toEqual([]);
    expect(profileStore.get().activeDeckIndex).toBe(0);
    // an out-of-range delete is a no-op rather than a splice of nothing
    deleteDeck(5);
    deleteDeck(-1);
    expect(profileStore.get().decks).toEqual([]);
  });

  /**
   * The third corner of the same bug.
   *
   * A pasted deck code resolves card ids and nothing else — it never touches the
   * collection — and `validateDeck` says nothing about ownership. So an imported
   * thirty-card list of cards the account has never seen validated perfectly,
   * saved, became the active deck and was dealt in a real match, walking
   * straight past the one `if` in the card pool.
   *
   * `replacementsFor` is the gate, because it is already the function that knows
   * which cards an account cannot field — and it names them, so the refusal can
   * say which card rather than just "no".
   */
  it("can tell an imported deck the account cannot field", () => {
    const borrowed = deckOf(["idols-stan-account", "idols-stan-account", "idols-backup-dancer"], "Borrowed");
    expect(validateDeck(content, borrowed).filter((p) => p.code !== "wrongSize")).toEqual([]);

    const nothing = replacementsFor(content, borrowed, {});
    expect(nothing.length, "an entirely unowned deck reported nothing to fix").toBeGreaterThan(0);
    expect(nothing.map((entry) => entry.cardId)).toContain("idols-stan-account");

    // and an account that owns it all has nothing to report
    expect(replacementsFor(content, borrowed, fullCollection())).toEqual([]);
  });

  it("still overwrites a slot when one is named, even at the cap", () => {
    const slots = content.balance.deck.slots;
    for (let i = 0; i < slots; i++) saveDeck(deckOf([], `Deck ${i}`));
    expect(saveDeck(deckOf(["idols-stan-account"], "Rewritten"), 3)).toBe(3);
    expect(profileStore.get().decks[3]!.name).toBe("Rewritten");
    expect(profileStore.get().decks.length).toBe(slots);
  });
});

// ---------------------------------------------------------------------------

/**
 * The nine defects a twenty-agent adversarial review found in this module and
 * the screens above it, each reproduced before it was believed and each pinned
 * here so it cannot come back.
 *
 * They shared one shape, which is worth naming: **a rule answered twice.**
 * Purity was decided here and in the engine; the slot cap was enforced in
 * `saveDeck` and ignored in `grantStarterDeck`; admissibility was checked for
 * suggestions and skipped for craft targets; the panel's score floor was allowed
 * to decide a deck's size. Every one of them was a place where this module had
 * an opinion about something that already had an owner.
 */
describe("what the review found", () => {
  beforeEach(() => {
    profileStore.update((draft) => {
      draft.decks = [];
      draft.activeDeckIndex = 0;
    });
  });

  /**
   * Defect 4. The cover and the card back are saved fields, so changing one is
   * an unsaved change — and `identical` is what the Compare button reads to say
   * whether there are any.
   */
  it("counts a new cover or card back as a change, because saving stores them", () => {
    const saved: DeckList = {
      ...deckOf(["idols-stan-account", "idols-backup-dancer"]),
      coverCardId: "idols-stan-account",
    };

    expect(diffDecks(content, saved, { ...saved }).identical).toBe(true);

    const newCover = diffDecks(content, saved, { ...saved, coverCardId: "idols-backup-dancer" });
    expect(newCover.identical, "a changed cover reported as no change at all").toBe(false);
    expect(newCover.coverChanged).toBe(true);
    expect(newCover.rows).toEqual([]);

    const newBack = diffDecks(content, saved, { ...saved, cardBackId: "cardback-neon" });
    expect(newBack.identical).toBe(false);
    expect(newBack.cardBackChanged).toBe(true);

    // "never chose one" and "chose nothing" are the same state to a player
    const neither = diffDecks(content, deckOf(["idols-stan-account"]), deckOf(["idols-stan-account"]));
    expect(neither.coverChanged).toBe(false);
    expect(neither.cardBackChanged).toBe(false);
  });

  /**
   * Defect 7, first half. A craft target is a spending recommendation, so it has
   * to name a card that spending would actually let you play. A deck sitting at
   * the Prism splash limit was being told to buy a fourth Prism card.
   */
  it("never names a craft target the deck still could not legally hold", () => {
    const leaderId = "meme-leader-skree-nine-tabs";
    const leader = content.leaders[leaderId];
    if (!leader) return;
    const limit = content.balance.deck.prismSplashLimit;
    const prismPool = legalCardPool(content, leader).filter((card) => card.current === "prism");
    if (prismPool.length <= limit) return;

    const atTheLimit = deckOf(
      prismPool.slice(0, limit).map((card) => card.id),
      "Splashed",
      leaderId
    );
    const targets = craftTargets(content, atTheLimit, {}, 50);
    expect(
      targets.filter((target) => content.cards[target.cardId]?.current === "prism").map((t) => t.cardId),
      "told the player to craft Prism cards this deck can never add"
    ).toEqual([]);
  });

  /** Defect 7, second half — a full deck has nothing to add, so nothing to buy. */
  it("suggests nothing to craft for a deck that is already complete", () => {
    const full = autoBuildDeck(content, LEADER, "Full");
    expect(full.cards.length).toBe(content.balance.deck.size);
    expect(suggestCards(content, full, {})).toEqual([]);
    expect(craftTargets(content, full, {}), "offered a shopping list for a finished deck").toEqual([]);
  });

  /**
   * Defect 8, and the reason it went unseen: it needs a collection rich enough
   * to finish a deck but poor enough that the last few cards score badly. A full
   * collection never trips it, and a full collection is what the other tests use.
   *
   * The display floor exists to keep weak cards out of a list of five. It must
   * not decide how many cards are in the deck.
   */
  it("fills to thirty from an owned pool, however weakly the last cards score", () => {
    expect(
      deckToolsData().suggestions.minScoreToShow,
      "this test is meaningless without a floor to leak"
    ).toBeGreaterThan(0);

    /**
     * Partial collections, deterministically. A **full** collection never trips
     * this — every leader finishes on strong cards — which is exactly why the
     * bug survived the first round of tests. The floor only bites when the cards
     * left to choose from are the weak ones, and that is what a real account
     * holds.
     */
    let short = 0;
    let checked = 0;
    for (const leader of selectableLeaders(content)) {
      const pool = legalCardPool(content, leader);
      for (const keep of [3, 4, 5]) {
        // a stable pseudo-random slice: every `keep`th card, offset by leader
        const owned: Collection = Object.fromEntries(
          pool.filter((_, index) => (index + leader.id.length) % keep !== 0).map((card) => [card.id, 2])
        );
        const filled = autoCompleteDeck(content, deckOf([], "Fill", leader.id), owned);
        checked += 1;

        /**
         * The honest invariant, and the only one that holds for every
         * collection: it stopped short **only** because there was nothing left
         * it could legally add. Asserting "always reaches thirty" would be false
         * for a genuinely thin collection, and asserting nothing would be how
         * this got through the first time.
         */
        if (filled.cards.length < content.balance.deck.size) {
          short += 1;
          expect(
            addableCards(content, filled, owned).map((entry) => entry.cardId),
            `${leader.id} stopped at ${filled.cards.length} of ${content.balance.deck.size} with cards still addable`
          ).toEqual([]);
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
    void short;
  });

  /** And with everything owned, every leader reaches a legal thirty. */
  it("reaches a legal thirty for every leader when the collection is full", () => {
    for (const leader of selectableLeaders(content)) {
      const owned: Collection = Object.fromEntries(
        legalCardPool(content, leader).map((card) => [card.id, 2])
      );
      const filled = autoCompleteDeck(content, deckOf([], "Fill", leader.id), owned);
      expect(filled.cards.length, `${leader.id} stopped at ${filled.cards.length}`).toBe(
        content.balance.deck.size
      );
      expect(validateDeck(content, filled).map((problem) => problem.code)).toEqual([]);
    }
  });

  /**
   * Defect 6. The slot list refuses to let you press "Play with this" on a deck
   * that does not validate, so deleting the active deck must not quietly make
   * such a deck active behind that same button.
   */
  it("hands the active marker to a deck that validates, not just to slot 0", () => {
    saveDeck(deckOf(["idols-stan-account"], "Broken"));
    saveDeck(autoBuildDeck(content, LEADER, "Legal"));
    saveDeck(deckOf(["idols-backup-dancer"], "Active"));
    setActiveDeck(2);

    deleteDeck(2);
    const profile = profileStore.get();
    expect(profile.decks[profile.activeDeckIndex]!.name, "made a one-card deck active").toBe("Legal");
    expect(validateDeck(content, profile.decks[profile.activeDeckIndex]!)).toEqual([]);
  });

  it("falls back to slot 0 when nothing at all validates", () => {
    saveDeck(deckOf(["idols-stan-account"], "A"));
    saveDeck(deckOf(["idols-backup-dancer"], "B"));
    setActiveDeck(1);
    deleteDeck(1);
    expect(profileStore.get().activeDeckIndex).toBe(0);
    expect(profileStore.get().decks.length).toBe(1);
  });

  /**
   * The other half of defect 6: `activeDeck() ?? autoBuildDeck(...)` guarded
   * against *no* deck and waved through an **illegal** one, at every route into
   * a battle. `playableDeck` is where that ladder now lives.
   */
  it("never starts a match with a deck the engine would reject", () => {
    expect(validateDeck(content, playableDeck(content, LEADER))).toEqual([]);

    saveDeck(deckOf(["idols-stan-account"], "Twenty-nine short"));
    setActiveDeck(0);
    expect(
      validateDeck(content, playableDeck(content, LEADER)),
      "dealt an illegal deck into a real match"
    ).toEqual([]);

    saveDeck(autoBuildDeck(content, LEADER, "Legal"));
    setActiveDeck(0);
    expect(playableDeck(content, LEADER).name, "walked past a legal saved deck").toBe("Legal");

    setActiveDeck(1);
    expect(playableDeck(content, LEADER).name).toBe("Legal");
  });

  /**
   * Defect 3. The Grand Tour pays a faction starter deck for a loaner win, and
   * that path pushed onto `decks` with no cap while the only screen that lists
   * decks renders `slice(0, slots)` — so the reward landed in a slot nothing in
   * the game could show.
   */
  it("does not grant a starter deck into a slot that does not exist", () => {
    const slots = content.balance.deck.slots;
    for (let i = 0; i < slots; i++) saveDeck(deckOf([], `Deck ${i}`));
    expect(profileStore.get().decks.length).toBe(slots);

    profileStore.update((draft) => {
      draft.unlockedFactions = [];
      draft.starterFaction = null;
    });
    const grant = grantStarterDeck(content, STARTER_FACTION);
    expect(grant, "no starter deck exists for the faction this test picked").not.toBeNull();

    expect(profileStore.get().decks.length, "wrote a deck no screen can render").toBe(slots);
    expect(grant!.deckSaved, "claimed to have saved a deck it could not save").toBe(false);
    // the reward that matters still lands: the cards, and the faction itself
    expect(grant!.cardsAdded + grant!.convertedToSignal).toBeGreaterThan(0);
    expect(profileStore.get().unlockedFactions).toContain(STARTER_FACTION);
  });

  it("still grants the deck when there is room for it", () => {
    profileStore.update((draft) => {
      draft.unlockedFactions = [];
      draft.starterFaction = null;
    });
    const grant = grantStarterDeck(content, STARTER_FACTION);
    expect(grant!.deckSaved).toBe(true);
    expect(profileStore.get().decks.length).toBe(1);
  });
});
