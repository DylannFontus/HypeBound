/**
 * Starter decks — the free lists a new account is built from.
 *
 * These are the first thirty cards anybody owns, so the bar is simply that they
 * are playable: legal for their Leader, the right size, and made of cards that
 * exist. `data/progression.json` is the source of truth and may be hand-edited,
 * which is exactly why it is checked here rather than trusted.
 *
 * The second half is the reason the whole thing exists. Accounts used to be
 * created holding **every card in the game**, which made a Merch Drop incapable
 * of granting anything new: 93.5% of every Drop converted straight to Signal.
 * The last test is that this is no longer true.
 */

import { describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import { seedRng } from "../src/engine/rng";
import { starterDecks, starterDeckFor, checkStarterData } from "../src/game/progression/data";
import { asDeckList, buildAllStarterDecks, checkStarterDeck, mixOf, STARTER_MIX } from "../src/game/progression/starterDecks";
import { openDrop, playableCap } from "../src/game/economy/drops";
import { validateDeck } from "../src/engine/deck";
import type { FactionId } from "../src/engine/types";

const content = getContent();

describe("the frozen starter lists", () => {
  it("has one for every faction, and every one of them loads", () => {
    const problems = checkStarterData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/progression.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("gives every list a legal deck a new player could actually play", () => {
    for (const deck of starterDecks()) {
      const errors = validateDeck(content, asDeckList(deck)).map((problem) => problem.message);
      expect(errors, `${deck.factionId}: ${errors.join("; ")}`).toEqual([]);
      expect(deck.cards, `${deck.factionId} is not a full deck`).toHaveLength(content.balance.deck.size);
    }
  });

  /**
   * The published mix is 17/9/3/1, and four factions cannot reach seventeen
   * Commons: a Leader only has two of the eight Currents available, so a faction
   * printing six Commons of its own runs out. Those lists take Rares instead.
   * The top of the curve is what the promise is really about, so that is what is
   * asserted exactly — one Legendary and three Epics, every time.
   */
  it("gives every list exactly one Legendary and the published Epics", () => {
    for (const deck of starterDecks()) {
      const mix = mixOf(content, deck);
      expect(mix.legendary, `${deck.factionId}`).toBe(STARTER_MIX.legendary);
      expect(mix.epic, `${deck.factionId}`).toBeGreaterThanOrEqual(STARTER_MIX.epic);
      expect(mix.common + mix.rare, `${deck.factionId}`).toBe(
        content.balance.deck.size - mix.epic - mix.legendary
      );
    }
  });

  it("names a Leader the player can actually select", () => {
    for (const deck of starterDecks()) {
      const leader = content.leaders[deck.leaderCardId];
      expect(leader, `${deck.factionId}: ${deck.leaderCardId}`).toBeTruthy();
      expect(leader!.token ?? false, `${deck.factionId} starts with a scripted-encounter leader`).toBe(false);
      expect(leader!.faction).toBe(deck.factionId);
    }
  });

  /**
   * The frozen file and the generator have to still agree about what is possible.
   * They are allowed to differ — a designer may hand-tune a list, and the file
   * wins — but a generator that can no longer produce a legal deck at all means
   * the card pool moved under it, and the next content change would be a silent
   * failure rather than a loud one.
   */
  it("can still be regenerated from the current card pool", () => {
    const generated = buildAllStarterDecks(content);
    expect(generated).toHaveLength(starterDecks().length);
    for (const deck of generated) {
      expect(checkStarterDeck(content, deck), `${deck.factionId}`).toEqual([]);
    }
  });
});

describe("what a new account can open", () => {
  const startingWith = (factionId: FactionId): Record<string, number> => {
    const owned: Record<string, number> = {};
    for (const cardId of starterDeckFor(factionId)?.cards ?? []) owned[cardId] = (owned[cardId] ?? 0) + 1;
    return owned;
  };

  /**
   * The bug this whole change exists to fix, asserted directly: a Drop opened by
   * a new account must be able to grant a card they do not have. Under the old
   * give-everything grant this was false for 93.5% of every Drop.
   */
  it("opens Drops that grant cards it does not already own", () => {
    const owned = startingWith("neon-idols");
    const rng = seedRng(4242);
    let brandNew = 0;
    let converted = 0;
    for (let i = 0; i < 10; i++) {
      const drop = openDrop(content, { owned, sinceLegendary: 0 }, rng);
      for (const card of drop.cards) {
        if (card.convertedToSignal !== undefined) converted += 1;
        else {
          if (card.isNew) brandNew += 1;
          owned[card.cardId] = (owned[card.cardId] ?? 0) + 1;
        }
      }
    }
    expect(brandNew, "ten Drops granted no card the account did not have").toBeGreaterThan(20);
    expect(converted, "a new account should not be converting anything to Signal yet").toBe(0);
  });

  it("leaves almost the whole collection still to find", () => {
    const owned = startingWith("neon-idols");
    const pool = collectibleCards(content);
    const atCap = pool.filter((card) => (owned[card.id] ?? 0) >= playableCap(content, card));
    // a starter deck is 30 cards out of a 245-card collection; nothing like complete
    expect(atCap.length / pool.length, "a starter deck should not complete much of the collection").toBeLessThan(0.1);
  });
});
