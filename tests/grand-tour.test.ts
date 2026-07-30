/**
 * The Grand Tour — win with a faction's loaner deck and keep it.
 *
 * `07-economy-and-monetization.md` §3.4 is one sentence and every test here is a
 * clause of it: *"win 1 match (AI Practice counts) with each remaining faction's
 * loaner deck to permanently unlock that faction's starter deck. Completing all
 * 10 grants 1,000 Clout + 10 Merch Drops + 1 Legendary of your choice."*
 *
 * The tour is what closes the loop the starter picker opened. An account picks
 * one faction on its first screen and, until this shipped, had no way to reach
 * the other nine — the picker's own closing line was a promise about software
 * that did not exist.
 *
 * Two of these tests are about a bug this work found rather than a feature it
 * added. `grantStarterDeck` incremented the collection with no cap, so a player
 * who opened Merch Drops before winning their next faction could end up owning
 * **three copies of a Common** — an amount the deck builder refuses to play and
 * the collection screen cannot honestly draw. That is reachable today, without
 * the tour, by anyone who buys a Drop.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import { createMatch } from "../src/engine/state";
import { validateDeck } from "../src/engine/deck";
import { playableCap } from "../src/game/economy/drops";
import { starterDeckFor, starterDecks } from "../src/game/progression/data";
import {
  canChooseLegendary,
  GRAND_TOUR_REWARD_KEY,
  legendaryChoices,
  legendaryFallbackSignal,
  loanerDeckFor,
  tourOpponentDeck,
  tourProgress,
} from "../src/game/progression/grandTour";
import {
  claimGrandTourReward,
  claimOnce,
  CLAIM_LEDGER_LIMIT,
  getProfile,
  grantStarterDeck,
  profileStore,
  recordTourWin,
  STARTER_DROPS,
  tourView,
} from "../src/save/profile";
import type { FactionId } from "../src/engine/types";

const content = getContent();
const FACTIONS = starterDecks().map((deck) => deck.factionId);
const [FIRST, SECOND] = FACTIONS as [FactionId, FactionId];

/** Take the whole tour, the way a player does: one win per remaining faction. */
const winEverything = (): void => {
  grantStarterDeck(content, FIRST);
  for (const factionId of FACTIONS.slice(1)) recordTourWin(content, factionId);
};

/**
 * Can this collection actually field this list?
 *
 * The promise "unlock that faction's starter deck" is not "add thirty numbers to
 * a record" — it is that the deck is playable. Two starter decks share neutral
 * cards, so a second grant genuinely adds fewer than thirty copies, and a test
 * asserting thirty would be asserting a coincidence.
 */
const ownsEnoughFor = (owned: Readonly<Record<string, number>>, cards: readonly string[]): string[] => {
  const wanted = new Map<string, number>();
  for (const cardId of cards) wanted.set(cardId, (wanted.get(cardId) ?? 0) + 1);
  const short: string[] = [];
  for (const [cardId, need] of wanted) {
    if ((owned[cardId] ?? 0) < need) short.push(`${cardId}: has ${owned[cardId] ?? 0}, needs ${need}`);
  }
  return short;
};

beforeEach(() => {
  profileStore.reset();
});

describe("the loaner deck", () => {
  /**
   * The load-bearing promise of the whole mode. If the loaner were an
   * `autoBuildDeck` — which is what the practice route lends today when you have
   * no deck — a player could win with one thirty-card list and be handed a
   * different one, and nothing in the UI would ever say so.
   */
  it("lends exactly the deck the win is played for", () => {
    for (const factionId of FACTIONS) {
      const loaner = loanerDeckFor(content, factionId);
      const starter = starterDeckFor(factionId);
      expect(loaner, factionId).toBeTruthy();
      expect(loaner!.cards, factionId).toEqual(starter!.cards);
      expect(loaner!.leaderCardId, factionId).toBe(starter!.leaderCardId);
    }
  });

  it("names itself apart from the deck you keep", () => {
    for (const factionId of FACTIONS) {
      expect(loanerDeckFor(content, factionId)!.name).not.toBe(starterDeckFor(factionId)!.name);
    }
  });

  it("is legal without owning a single card", () => {
    expect(Object.keys(getProfile().collection)).toHaveLength(0);
    for (const factionId of FACTIONS) {
      const problems = validateDeck(content, loanerDeckFor(content, factionId)!).map((p) => p.message);
      expect(problems, `${factionId}: ${problems.join("; ")}`).toEqual([]);
    }
  });

  /**
   * Legality is a static check; this one deals the thing. A loaner that passes
   * `validateDeck` and then cannot open a match is the same class of bug as a
   * puzzle that passes its unit test and is never dealt.
   */
  it("deals a real match", () => {
    for (const factionId of FACTIONS) {
      const deck = loanerDeckFor(content, factionId)!;
      const state = createMatch({ seed: 11, decks: [deck, loanerDeckFor(content, SECOND)!], firstSeat: 0 }, content);
      expect(state.players[0].deck.length + state.players[0].hand.length, factionId).toBe(
        content.balance.deck.size
      );
      expect(state.players[0].leaderCardId, factionId).toBe(deck.leaderCardId);
    }
  });

  /**
   * §3.4's last line: *"Starter decks are legal in every constructed mode and are
   * the baseline used for new-player matchmaking pools."* The tour is that pool.
   *
   * This is not decoration. The practice route's ordinary rival is an
   * `autoBuildDeck` over a Leader's whole legal pool — Epics and Legendaries
   * included — and a loaner deck is seventeen Commons. Against another starter
   * deck it is a real game: `npm run balance -- --only tour` measures the loaner
   * side at 44.2% across 240 matches with both seats played.
   */
  it("is played against another faction's starter deck, never a full-pool build", () => {
    for (const factionId of FACTIONS) {
      const opponent = tourOpponentDeck(content, factionId);
      expect(opponent, factionId).toBeTruthy();
      expect(opponent!.leaderCardId, `${factionId} faces a mirror of itself`).not.toBe(
        starterDeckFor(factionId)!.leaderCardId
      );
      // it is one of the frozen lists, card for card
      const matching = starterDecks().find((deck) => deck.leaderCardId === opponent!.leaderCardId);
      expect(matching, `${factionId}'s opponent is not a starter deck`).toBeTruthy();
      expect(opponent!.cards).toEqual(matching!.cards);
    }
  });

  it("faces the same opponent every time — the match seed rebuilds the whole match", () => {
    for (const factionId of FACTIONS) {
      expect(tourOpponentDeck(content, factionId)).toEqual(tourOpponentDeck(content, factionId));
    }
  });

  it("has one for every stop on the tour, and no stop without one", () => {
    const stops = tourProgress(content, tourView()).stops.map((stop) => stop.factionId);
    expect(stops.sort()).toEqual([...FACTIONS].sort());
    // an eleventh faction cannot ship with cards and no way to be earned
    const playable = Object.keys(content.factions).filter((id) => id !== "neutral");
    expect([...stops].sort()).toEqual(playable.sort());
  });
});

describe("winning a stop", () => {
  it("hands over the starter deck, permanently", () => {
    grantStarterDeck(content, FIRST);
    const before = structuredClone(getProfile());
    const granted = recordTourWin(content, SECOND);

    const starter = starterDeckFor(SECOND)!;
    const after = getProfile();
    expect(granted).toBeTruthy();
    expect(after.decks).toHaveLength(before.decks.length + 1);
    expect(after.decks.at(-1)!.leaderCardId).toBe(starter.leaderCardId);
    expect(after.decks.at(-1)!.cards).toEqual(starter.cards);
    expect(after.unlockedFactions).toContain(SECOND);

    // the deck is not merely listed — it is fieldable from the collection
    const short = ownsEnoughFor(after.collection, starter.cards);
    expect(short, `${SECOND} was handed a deck it cannot field:\n  ${short.join("\n  ")}`).toEqual([]);
    expect(validateDeck(content, after.decks.at(-1)!).map((p) => p.message)).toEqual([]);
  });

  /**
   * And the whole way round. Every stop must leave a deck you can actually put on
   * the table — including the ninth and tenth, by which point the collection is
   * full of neutrals that are already at the cap.
   */
  it("leaves every one of the ten decks fieldable", () => {
    winEverything();
    const owned = getProfile().collection;
    for (const deck of starterDecks()) {
      const short = ownsEnoughFor(owned, deck.cards);
      expect(short, `${deck.factionId}:\n  ${short.join("\n  ")}`).toEqual([]);
    }
  });

  /**
   * The route is `#battle?tour=<faction>`, which anybody can type twice. A second
   * grant would push thirty more card copies and a duplicate deck.
   */
  it("pays once, however many times it is won", () => {
    grantStarterDeck(content, FIRST);
    recordTourWin(content, SECOND);
    const after = structuredClone(getProfile());

    expect(recordTourWin(content, SECOND)).toBeNull();
    expect(getProfile().collection).toEqual(after.collection);
    expect(getProfile().decks).toHaveLength(after.decks.length);
    expect(getProfile().unlockedFactions).toEqual(after.unlockedFactions);
  });

  /** §3.4 attaches the five free Drops to the first deck, not to each of ten. */
  it("brings no free Drops — those came with the first deck", () => {
    const first = grantStarterDeck(content, FIRST);
    expect(first!.drops).toBe(STARTER_DROPS);
    expect(getProfile().pendingDrops).toBe(STARTER_DROPS);

    expect(recordTourWin(content, SECOND)!.drops).toBe(0);
    expect(getProfile().pendingDrops).toBe(STARTER_DROPS);
  });

  /**
   * Reachable without the tour at all: open Merch Drops until a card in your
   * next starter deck is at the cap, then unlock that faction. The copies over
   * the cap convert at the published duplicate rate rather than piling up.
   */
  it("never takes the collection above the playable cap", () => {
    const starter = starterDeckFor(SECOND)!;
    const cardId = starter.cards[0]!;
    const card = content.cards[cardId]!;
    const cap = playableCap(content, card);
    const inList = starter.cards.filter((id) => id === cardId).length;

    // one card pre-filled to the cap and nothing else, so the arithmetic is exact
    profileStore.update((draft) => {
      draft.collection[cardId] = cap;
      draft.shards = 0;
    });

    const granted = recordTourWin(content, SECOND)!;
    const { dustValue, dupeConversionBonus } = content.balance.economy;
    const perCopy = Math.round((dustValue[card.rarity] ?? 0) * dupeConversionBonus);

    expect(getProfile().collection[cardId]).toBe(cap);
    expect(granted.cardsAdded).toBe(starter.cards.length - inList);
    expect(granted.convertedToSignal).toBe(perCopy * inList);
    expect(getProfile().shards).toBe(perCopy * inList);
  });

  /**
   * The same rule over the whole tour, stated without arithmetic. Two starter
   * decks share neutral cards, so by the tenth win most neutrals are long since
   * at the cap and every further copy has to convert rather than stack.
   */
  it("puts no card above the cap over the whole tour", () => {
    winEverything();
    const owned = getProfile().collection;
    const over = Object.entries(owned).filter(
      ([cardId, count]) => content.cards[cardId] && count > playableCap(content, content.cards[cardId]!)
    );
    expect(over.map(([id, n]) => `${id}: ${n}`), "cards owned above the playable cap").toEqual([]);
    expect(getProfile().shards).toBeGreaterThan(300);
  });

  /** Winning with a borrowed deck must not change what you are playing with. */
  it("does not make itself the active deck", () => {
    grantStarterDeck(content, FIRST);
    expect(getProfile().activeDeckIndex).toBe(0);
    expect(getProfile().decks[0]!.name).toBe(starterDeckFor(FIRST)!.name);

    recordTourWin(content, SECOND);
    expect(getProfile().activeDeckIndex).toBe(0);
    expect(getProfile().decks[0]!.name).toBe(starterDeckFor(FIRST)!.name);
  });
});

describe("progress", () => {
  it("starts a new account at one of ten, and says which one", () => {
    grantStarterDeck(content, FIRST);
    const progress = tourProgress(content, tourView());
    expect(progress.unlocked).toBe(1);
    expect(progress.total).toBe(FACTIONS.length);
    expect(progress.complete).toBe(false);
    expect(progress.stops.filter((stop) => stop.isStarter).map((s) => s.factionId)).toEqual([FIRST]);
    expect(progress.stops.filter((stop) => stop.unlocked)).toHaveLength(1);
  });

  it("is complete only once every stop is won", () => {
    grantStarterDeck(content, FIRST);
    for (const factionId of FACTIONS.slice(1, -1)) recordTourWin(content, factionId);
    expect(tourProgress(content, tourView()).complete).toBe(false);

    recordTourWin(content, FACTIONS.at(-1)!);
    const progress = tourProgress(content, tourView());
    expect(progress.complete).toBe(true);
    expect(progress.unlocked).toBe(progress.total);
  });

  /**
   * The screen prints these three numbers as a promise before the first loaner
   * match, and the grant pays from the same object — the shop panel's odds bug,
   * pre-empted.
   */
  it("publishes the reward the grant actually pays", () => {
    const published = tourProgress(content, tourView()).reward;
    expect(published).toEqual(content.balance.economy.grandTour);

    winEverything();
    const before = getProfile();
    const pick = legendaryChoices(content, before.collection).find((c) => !c.owned)!;
    const paid = claimGrandTourReward(content, [pick.card.id])!;

    expect(paid.clout).toBe(published.clout);
    expect(paid.drops).toBe(published.drops);
    expect(paid.legendaryCardIds).toHaveLength(published.legendaryChoices);
    expect(getProfile().clout).toBe(before.clout + published.clout);
    expect(getProfile().pendingDrops).toBe(before.pendingDrops + published.drops);
    expect(getProfile().collection[pick.card.id]).toBe((before.collection[pick.card.id] ?? 0) + 1);
  });
});

describe("the completion reward", () => {
  const somethingChoosable = (): string =>
    legendaryChoices(content, getProfile().collection).find((choice) => !choice.owned)!.card.id;

  it("is refused before the tour is finished", () => {
    grantStarterDeck(content, FIRST);
    const pick = somethingChoosable();
    expect(claimGrandTourReward(content, [pick])).toBeNull();
    expect(getProfile().clout).toBe(500);
  });

  it("is refused a second time", () => {
    winEverything();
    expect(claimGrandTourReward(content, [somethingChoosable()])).toBeTruthy();
    const after = structuredClone(getProfile());

    /**
     * Free a Legendary back up first, so the second refusal can only be "already
     * paid". Re-offering the card just granted would be refused for two reasons
     * at once and would not prove which one fired.
     */
    const dismantled = legendaryChoices(content, after.collection).find((choice) => choice.owned)!.card.id;
    profileStore.update((draft) => delete draft.collection[dismantled]);

    expect(claimGrandTourReward(content, [dismantled])).toBeNull();
    expect(getProfile().clout).toBe(after.clout);
    expect(getProfile().pendingDrops).toBe(after.pendingDrops);
    expect(getProfile().claimedRewards.filter((key) => key === GRAND_TOUR_REWARD_KEY)).toHaveLength(1);
  });

  /**
   * A Legendary caps at one copy. "Choosing" one already owned would hand over a
   * card that can never go in a deck, which is worse than being told no.
   */
  it("refuses a Legendary the account already holds", () => {
    winEverything();
    const owned = legendaryChoices(content, getProfile().collection).find((choice) => choice.owned);
    expect(owned, "the ten starter decks should have granted at least one Legendary").toBeTruthy();
    expect(canChooseLegendary(content, getProfile().collection, owned!.card.id)).toBe(false);
    expect(claimGrandTourReward(content, [owned!.card.id])).toBeNull();
    expect(getProfile().claimedRewards).not.toContain(GRAND_TOUR_REWARD_KEY);
  });

  it("refuses anything that is not a Legendary in the launch set", () => {
    winEverything();
    const common = collectibleCards(content).find((card) => card.rarity === "common")!;
    expect(claimGrandTourReward(content, [common.id])).toBeNull();
    expect(claimGrandTourReward(content, ["no-such-card"])).toBeNull();
    expect(getProfile().claimedRewards).not.toContain(GRAND_TOUR_REWARD_KEY);
  });

  /**
   * `legendaryChoices` is a number in `balance.json`, and a number nothing reads
   * is the inert-field bug this project has now found five times. Asking for the
   * wrong count has to be refused, or the field is decoration.
   */
  it("grants exactly as many Legendaries as the balance file says", () => {
    winEverything();
    // the ten starter decks grant ten of the eleven collectible Legendaries, so
    // a second choosable one has to be arranged rather than assumed
    const held = legendaryChoices(content, getProfile().collection).find((choice) => choice.owned)!.card.id;
    profileStore.update((draft) => delete draft.collection[held]);

    const open = legendaryChoices(content, getProfile().collection).filter((c) => !c.owned);
    expect(open.length).toBeGreaterThan(1);

    expect(claimGrandTourReward(content, []), "no choice at all").toBeNull();
    expect(claimGrandTourReward(content, [open[0]!.card.id, open[1]!.card.id]), "one too many").toBeNull();
    expect(claimGrandTourReward(content, [open[0]!.card.id])).toBeTruthy();
  });

  /**
   * A content check wearing a reward test's clothes, and the finding is worth
   * stating plainly: the game prints **11 collectible Legendaries**, and the ten
   * starter decks hand over ten of them — one per faction, because nine factions
   * print exactly one and Viral Influencers prints two. So a player finishing the
   * tour today is choosing from a shelf holding **one card**.
   *
   * That is content size, not a defect: §10.1 models the launch set at 50
   * Legendaries and the shipped set is 195 collectible cards rather than 500. The
   * reward is implemented as written and will become a real choice as the set
   * grows. What must never happen is the shelf being *empty*, which would strand
   * the Clout and the Drops — so that is what this asserts.
   */
  it("always leaves the winner something to choose", () => {
    winEverything();
    const open = legendaryChoices(content, getProfile().collection).filter((choice) => !choice.owned);
    expect(
      open.length,
      "the ten starter decks now consume every Legendary in the game; the tour's choice reward has nothing in it"
    ).toBeGreaterThan(0);
  });

  /**
   * `legendaryChoices` is 1 in the shipped file, which makes "the same card
   * twice" unreachable through the real balance numbers — and an unreachable
   * branch is the inert-code smell this project keeps finding. So the rule is
   * driven at the value that makes it bite, by handing the grant a content index
   * whose balance asks for two. The field is data; a designer can raise it.
   */
  it("refuses the same Legendary listed twice when it asks for two", () => {
    const twoChoices = structuredClone(content);
    twoChoices.balance.economy.grandTour.legendaryChoices = 2;

    winEverything();
    // free one back up, so two are genuinely choosable
    const held = legendaryChoices(content, getProfile().collection).find((choice) => choice.owned)!.card.id;
    profileStore.update((draft) => delete draft.collection[held]);
    const open = legendaryChoices(content, getProfile().collection).filter((choice) => !choice.owned);
    expect(open.length).toBeGreaterThan(1);

    expect(claimGrandTourReward(twoChoices, [open[0]!.card.id, open[0]!.card.id])).toBeNull();
    expect(getProfile().claimedRewards).not.toContain(GRAND_TOUR_REWARD_KEY);

    // …and two distinct ones are accepted, so the refusal was about the repeat
    const paid = claimGrandTourReward(twoChoices, [open[0]!.card.id, open[1]!.card.id]);
    expect(paid!.legendaryCardIds).toHaveLength(2);
  });

  /**
   * The claim is banked in `claimedRewards`, which `claimOnce` trims to its most
   * recent 400 entries — right for a boss first-clear, which is keyed per boss,
   * per tier, per *week* and accumulates at about thirty a week, and wrong for a
   * reward that may only ever be paid once in the life of an account.
   *
   * Left alone, the Grand Tour's key would age off the front after roughly three
   * months of ordinary play and the whole reward would become claimable again.
   */
  it("is not forgotten when the claim ledger fills up", () => {
    winEverything();
    expect(claimGrandTourReward(content, [somethingChoosable()])).toBeTruthy();
    const after = structuredClone(getProfile());

    // a year of weekly boss clears, through the real one-off path
    for (let i = 0; i < CLAIM_LEDGER_LIMIT + 200; i++) claimOnce(`boss:week-${i}`, 0);
    expect(getProfile().claimedRewards.length).toBeLessThanOrEqual(CLAIM_LEDGER_LIMIT + 1);
    expect(getProfile().claimedRewards, "the permanent key was evicted by seasonal ones").toContain(
      GRAND_TOUR_REWARD_KEY
    );

    // free a Legendary back up so a second claim could otherwise succeed
    const held = legendaryChoices(content, getProfile().collection).find((choice) => choice.owned)!.card.id;
    profileStore.update((draft) => delete draft.collection[held]);
    expect(claimGrandTourReward(content, [held])).toBeNull();
    expect(getProfile().pendingDrops).toBe(after.pendingDrops);
  });

  /**
   * The one path that would otherwise strand the Clout and the Drops behind a
   * choice with nothing left in it. It pays at the published duplicate rate
   * rather than a rate invented for this corner.
   */
  it("still pays an account that already owns every Legendary", () => {
    winEverything();
    profileStore.update((draft) => {
      for (const card of collectibleCards(content)) {
        if (card.rarity === "legendary") draft.collection[card.id] = playableCap(content, card);
      }
    });
    const before = getProfile();
    expect(legendaryChoices(content, before.collection).every((choice) => choice.owned)).toBe(true);

    const paid = claimGrandTourReward(content, [])!;
    const expected = legendaryFallbackSignal(content) * content.balance.economy.grandTour.legendaryChoices;
    expect(paid.legendaryCardIds).toEqual([]);
    expect(paid.convertedToSignal).toBe(expected);
    expect(getProfile().shards).toBe(before.shards + expected);
    expect(getProfile().clout).toBe(before.clout + paid.clout);
  });
});
