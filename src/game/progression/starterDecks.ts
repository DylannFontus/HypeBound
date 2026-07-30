/**
 * Starter decks — one per faction, the free lists a new account is built from.
 *
 * `docs/design/07-economy-and-monetization.md` §3.4 fixes the shape: *"a fixed,
 * tuned list: 17 Common, 9 Rare, 3 Epic, 1 Legendary, plus the faction's starter
 * Leader"*, one per faction, all ten Leaders free.
 *
 * The lists are **generated here and frozen into `data/progression.json`**, not
 * hand-tuned card by card, and that is worth saying plainly: the doc calls them
 * tuned and they are currently only *legal and well-shaped* — the right rarity
 * mix, a sane curve, the faction's own cards preferred over neutrals. A designer
 * replacing any list by hand is the intended next step, and nothing here has to
 * change for that to happen: the file is the source of truth and this module
 * only regenerates it on request.
 *
 * Why this matters more than it sounds: until now a new account was handed *every
 * card in the game*, which made Merch Drops incapable of granting anything new.
 * The starter deck is what gives a collection somewhere to grow from.
 */

import type { CardDef, ContentIndex, DeckList, FactionId, Rarity } from "../../engine/types";
import { legalCardPool, validateDeck } from "../../engine/deck";
import { selectableLeaders } from "../../engine/content";

export class StarterDeckError extends Error {}

/** The published composition of every starter deck. */
export const STARTER_MIX: Record<Rarity, number> = { common: 17, rare: 9, epic: 3, legendary: 1 };

export interface StarterDeck {
  factionId: FactionId;
  leaderCardId: string;
  name: string;
  cards: string[];
}

/**
 * A faction's starter leader: its **dual-Current** leader, then by id.
 *
 * Every faction prints one dual-Current leader and one pure-Current leader whose
 * payoff is Perfect Resonance. The pure one has a deliberately narrow pool —
 * 37–39 legal copies against a deck size of 30 — and five of them cannot supply
 * seventeen Commons at all, so a first-by-id rule silently produced five starter
 * decks instead of ten. The dual leader is also the kinder first deck: a wider
 * pool, and no archetype that only works once you have the whole payoff.
 *
 * Which leader is "the starter" is ultimately a design decision, and it lives in
 * the frozen file — this only decides what the generator proposes.
 */
export function starterLeaderFor(content: ContentIndex, factionId: FactionId): string | null {
  const leaders = selectableLeaders(content)
    .filter((leader) => leader.faction === factionId)
    .sort(
      (a, b) =>
        Number(a.secondaryCurrent === null) - Number(b.secondaryCurrent === null) || (a.id < b.id ? -1 : 1)
    );
  return leaders[0]?.id ?? null;
}

/**
 * Build one faction's starter list to the published mix.
 *
 * Legality comes from `legalCardPool`, the same function the deck builder and
 * `autoBuildDeck` use, so a starter deck is legal for exactly the reasons every
 * other deck is. Within a rarity the faction's own cards come first and the
 * curve is spread by cost, so the list plays like a deck rather than like a
 * shopping trip through one cost bucket.
 */
export function buildStarterDeck(content: ContentIndex, factionId: FactionId): StarterDeck | null {
  const leaderCardId = starterLeaderFor(content, factionId);
  if (!leaderCardId) return null;
  const leader = content.leaders[leaderCardId];
  if (!leader) return null;

  const balance = content.balance.deck;
  const prismIsHome = leader.primaryCurrent === "prism" || leader.secondaryCurrent === "prism";
  const pool = legalCardPool(content, leader).filter((card) => prismIsHome || card.current !== "prism");

  const capFor = (card: CardDef): number =>
    card.rarity === "legendary" ? balance.maxCopiesLegendary : balance.maxCopies;

  const cards: string[] = [];
  const taken = new Map<string, number>();

  /** Take up to `wanted` copies of a rarity; returns how many it managed. */
  const take = (rarity: Rarity, wanted: number): number => {
    const candidates = pool
      .filter((card) => card.rarity === rarity)
      // the faction's own cards first, then neutrals; then cheapest first so the
      // curve fills from the bottom, then id for a stable list
      .sort(
        (a, b) =>
          Number(a.faction === "neutral") - Number(b.faction === "neutral") ||
          a.cost - b.cost ||
          (a.id < b.id ? -1 : 1)
      );

    let added = 0;
    // two passes: one copy of as many distinct cards as possible, then seconds
    for (let pass = 0; pass < 2 && added < wanted; pass++) {
      for (const card of candidates) {
        if (added >= wanted) break;
        const held = taken.get(card.id) ?? 0;
        if (held > pass || held >= capFor(card)) continue;
        taken.set(card.id, held + 1);
        cards.push(card.id);
        added += 1;
      }
    }
    return added;
  };

  for (const rarity of ["legendary", "epic", "rare", "common"] as Rarity[]) {
    take(rarity, STARTER_MIX[rarity]);
  }

  /**
   * Backfill, because the published mix is not achievable for every faction.
   *
   * Currents are the reason: a leader's legal pool is two of the eight, so a
   * faction that prints six Commons of its own can end up with sixteen legal
   * Common copies against a target of seventeen — Afterparty Crew does exactly
   * that. The deck must still be thirty cards, so the shortfall is taken from
   * the next rarity up, and the frozen file records what the deck really is.
   * The doc's mix is a target; the file is the truth, which is what §3.4 means
   * by "starter lists live in the data".
   */
  const order: Rarity[] = ["rare", "epic", "common", "legendary"];
  let guard = 0;
  while (cards.length < balance.size && guard++ < 64) {
    const before = cards.length;
    for (const rarity of order) {
      if (cards.length >= balance.size) break;
      take(rarity, balance.size - cards.length);
    }
    if (cards.length === before) {
      throw new StarterDeckError(
        `${factionId}: ${leaderCardId}'s legal pool holds only ${cards.length} copies, and a deck is ${balance.size}`
      );
    }
  }

  const faction = content.factions[factionId];
  return { factionId, leaderCardId, name: `${faction?.name ?? factionId} Starter`, cards };
}

/** Every faction's starter deck, in faction id order. */
export function buildAllStarterDecks(content: ContentIndex): StarterDeck[] {
  return Object.keys(content.factions)
    .filter((id) => id !== "neutral")
    .sort()
    .map((id) => buildStarterDeck(content, id as FactionId))
    .filter((deck): deck is StarterDeck => deck !== null);
}

/** A starter deck as the deck list the game plays with. */
export function asDeckList(deck: StarterDeck): DeckList {
  return { name: deck.name, leaderCardId: deck.leaderCardId, cards: [...deck.cards] };
}

/** The rarity breakdown of a list, for the file and for the tests. */
export function mixOf(content: ContentIndex, deck: StarterDeck): Record<Rarity, number> {
  const mix: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const cardId of deck.cards) {
    const card = content.cards[cardId];
    if (card) mix[card.rarity] += 1;
  }
  return mix;
}

/**
 * Is this list something a new account can actually be handed?
 *
 * Legality and size are hard: a starter deck that will not pass `validateDeck`
 * is a deck the player cannot play. The rarity mix is checked at the top end
 * only — exactly one Legendary and at least the published Epics — because the
 * Common/Rare split flexes with what a faction's Currents can legally supply.
 */
export function checkStarterDeck(content: ContentIndex, deck: StarterDeck): string[] {
  const problems = validateDeck(content, asDeckList(deck)).map((problem) => problem.message);
  const mix = mixOf(content, deck);

  if (deck.cards.length !== content.balance.deck.size) {
    problems.push(`${deck.cards.length} cards, a deck is ${content.balance.deck.size}`);
  }
  if (mix.legendary !== STARTER_MIX.legendary) {
    problems.push(`${mix.legendary} Legendary, every starter deck gets exactly ${STARTER_MIX.legendary}`);
  }
  if (mix.epic < STARTER_MIX.epic) problems.push(`${mix.epic} Epic, the published mix promises ${STARTER_MIX.epic}`);
  for (const cardId of deck.cards) {
    if (!content.cards[cardId]) problems.push(`unknown card ${cardId}`);
  }
  return problems;
}
