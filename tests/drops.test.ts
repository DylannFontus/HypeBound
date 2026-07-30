/**
 * Merch Drops, against the promises the economy doc makes to the player.
 *
 * §5 of `07-economy-and-monetization.md` is written as a binding algorithm and
 * ends with a paragraph headed *"Consequences (stated so QA can assert them)"*.
 * Those consequences are the tests here, phrased the way the doc phrases them,
 * because they are what a player would notice being broken — not the shape of
 * the code that produces them.
 *
 * Everything runs against the real card pool, because the interesting cases are
 * about pool completion, and a fixture pool of four cards would prove nothing
 * about a pool of 195.
 */

import { describe, expect, it } from "vitest";
import { getContent, collectibleCards } from "../src/engine/content";
import { seedRng } from "../src/engine/rng";
import { openDrop, playableCap, publishedOdds, type CollectionView } from "../src/game/economy/drops";
import type { CardDef, Rarity } from "../src/engine/types";

const content = getContent();
const pool = collectibleCards(content);
const economy = content.balance.economy;

const empty = (): CollectionView => ({ owned: {}, sinceLegendary: 0 });

/** Every collectible card of a rarity, held at its playable cap. */
function completeRarity(rarity: Rarity): Record<string, number> {
  const owned: Record<string, number> = {};
  for (const card of pool) {
    if (card.rarity === rarity) owned[card.id] = playableCap(content, card);
  }
  return owned;
}

/** Open `n` Drops through one PRNG, carrying the collection forward. */
function openMany(n: number, start: CollectionView = empty(), seed = 12345) {
  const rng = seedRng(seed);
  const owned: Record<string, number> = { ...start.owned };
  let sinceLegendary = start.sinceLegendary;
  const all = [];
  for (let i = 0; i < n; i++) {
    const drop = openDrop(content, { owned, sinceLegendary }, rng);
    for (const card of drop.cards) {
      if (card.convertedToSignal === undefined) owned[card.cardId] = (owned[card.cardId] ?? 0) + 1;
    }
    sinceLegendary = drop.sinceLegendary;
    all.push(drop);
  }
  return { drops: all, owned, sinceLegendary };
}

describe("a Merch Drop is dealt as the panel says", () => {
  it("holds exactly the published number of cards", () => {
    for (const drop of openMany(40).drops) {
      expect(drop.cards).toHaveLength(economy.packSize);
    }
  });

  it("never repeats a card id inside one Drop", () => {
    for (const drop of openMany(200).drops) {
      const ids = drop.cards.map((c) => c.cardId);
      expect(new Set(ids).size, `a Drop contained ${ids.join(", ")}`).toBe(ids.length);
    }
  });

  it("always contains at least one Rare or better", () => {
    const rank: Rarity[] = ["common", "rare", "epic", "legendary"];
    for (const drop of openMany(300).drops) {
      const best = Math.max(...drop.cards.map((c) => rank.indexOf(c.rarity)));
      expect(best, `a Drop of ${drop.cards.map((c) => c.rarity).join(", ")} broke the floor`).toBeGreaterThanOrEqual(
        rank.indexOf("rare")
      );
    }
  });

  it("publishes odds that sum to 1 and match the table it rolls from", () => {
    const rates = economy.pack.rates;
    const total = Object.values(rates).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 6);
    // the panel and the roll read the same object, so this asserts they agree
    const printed = publishedOdds(content);
    expect(printed.map((row) => row.rarity)).toEqual(["legendary", "epic", "rare", "common"]);
    expect(printed.find((row) => row.rarity === "legendary")?.percent).toBe(`${(rates.legendary * 100).toFixed(1)}%`);
  });
});

describe("the Legendary guarantee", () => {
  /**
   * The player-facing promise is "a Legendary within every 40 Drops". Checked as
   * the longest run without one across a long opening session, on several seeds,
   * because a pity that works on average and fails on one seed is not a promise.
   */
  it("never leaves more than the published number of Drops without one", () => {
    for (const seed of [1, 7, 99, 4242, 31337]) {
      let gap = 0;
      let worst = 0;
      for (const drop of openMany(200, empty(), seed).drops) {
        if (drop.cards.some((c) => c.rarity === "legendary")) gap = 0;
        else worst = Math.max(worst, ++gap);
      }
      expect(worst, `seed ${seed} went ${worst} Drops without a Legendary`).toBeLessThanOrEqual(
        economy.pack.legendaryPity
      );
    }
  });

  it("resets the counter on the Drop that pays out, not the next one", () => {
    const { drops } = openMany(120);
    for (const drop of drops) {
      if (drop.cards.some((c) => c.rarity === "legendary")) expect(drop.sinceLegendary).toBe(0);
    }
  });
});

describe("duplicate protection", () => {
  /**
   * The headline promise, and the one worth stating in the doc's own words: *a
   * player can never open a useless duplicate while any unowned card of that
   * rarity exists in the pool.*
   */
  it("never grants a card at the cap while the rarity pool has room anywhere", () => {
    const { drops, owned } = openMany(400);
    const seen: Record<string, number> = {};
    for (const drop of drops) {
      for (const card of drop.cards) {
        if (card.convertedToSignal === undefined) continue;
        // a conversion is only legal when nothing of that rarity had room
        const roomLeft = pool.filter(
          (c: CardDef) => c.rarity === card.rarity && (seen[c.id] ?? 0) < playableCap(content, c)
        );
        expect(roomLeft.map((c) => c.id), `converted a ${card.rarity} while ${roomLeft.length} had room`).toEqual([]);
      }
      for (const card of drop.cards) {
        if (card.convertedToSignal === undefined) seen[card.cardId] = (seen[card.cardId] ?? 0) + 1;
      }
    }
    // and nothing ever exceeded the cap
    for (const [cardId, count] of Object.entries(owned)) {
      const card = content.cards[cardId]!;
      expect(count, `${cardId} exceeded its playable cap`).toBeLessThanOrEqual(playableCap(content, card));
    }
  });

  it("converts at the bonus rate once a rarity pool is complete", () => {
    // every Legendary already at the cap: the only thing a Legendary slot can do
    const rng = seedRng(5);
    const owned = completeRarity("legendary");
    let conversions = 0;
    for (let i = 0; i < 60; i++) {
      const drop = openDrop(content, { owned, sinceLegendary: economy.pack.legendaryPity - 1 }, rng);
      for (const card of drop.cards) {
        if (card.rarity !== "legendary") continue;
        expect(card.convertedToSignal, "a capped Legendary should have converted").toBe(
          Math.round(economy.dustValue.legendary * economy.dupeConversionBonus)
        );
        conversions += 1;
      }
    }
    expect(conversions, "the pity should have forced Legendary slots").toBeGreaterThan(0);
  });

  it("hands out a real card rather than Signal while the pool is incomplete", () => {
    // one Legendary short of complete, so there is exactly one home for the slot
    const owned = completeRarity("legendary");
    const spare = pool.find((c) => c.rarity === "legendary")!;
    delete owned[spare.id];

    const rng = seedRng(11);
    const drop = openDrop(content, { owned, sinceLegendary: economy.pack.legendaryPity - 1 }, rng);
    const legendary = drop.cards.find((c) => c.rarity === "legendary");
    expect(legendary?.cardId, "the one card with room should have been granted").toBe(spare.id);
    expect(legendary?.convertedToSignal).toBeUndefined();
  });

  it("marks a card new only the first time it is granted", () => {
    const { drops } = openMany(120);
    const seen = new Set<string>();
    for (const drop of drops) {
      for (const card of drop.cards) {
        if (card.convertedToSignal !== undefined) continue;
        expect(card.isNew, `${card.cardId} reported new twice`).toBe(!seen.has(card.cardId));
        seen.add(card.cardId);
      }
    }
  });
});

describe("Drops are reproducible", () => {
  /**
   * Openings are rolled from a seeded PRNG so an account's history can be
   * re-derived rather than merely trusted — which is what the future
   * authoritative server needs in order to sign it.
   */
  it("the same seed and the same collection open the same Drop", () => {
    const a = openDrop(content, empty(), seedRng(777));
    const b = openDrop(content, empty(), seedRng(777));
    expect(a).toEqual(b);
  });

  it("a different seed opens a different Drop", () => {
    const a = openDrop(content, empty(), seedRng(1));
    const b = openDrop(content, empty(), seedRng(2));
    expect(a).not.toEqual(b);
  });
});
