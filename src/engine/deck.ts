/**
 * Deck construction rules and validation.
 * Canon: docs/design/00-core-rules.md §2 (sizes) and §8.6 (Current legality).
 */

import type { CardDef, ContentIndex, CurrentId, DeckList, LeaderCardDef } from "./types";
import { collectibleCards, getCard } from "./content";

export interface DeckProblem {
  code:
    | "wrongSize"
    | "tooManyCopies"
    | "illegalCurrent"
    | "illegalFaction"
    | "tooManyPrism"
    | "unknownCard"
    | "unknownLeader"
    | "tokenInDeck";
  message: string;
  cardId?: string;
}

/** Currents a leader's deck may contain (primary, optional secondary). */
export function legalCurrentsFor(leader: LeaderCardDef): CurrentId[] {
  const out: CurrentId[] = [leader.primaryCurrent];
  if (leader.secondaryCurrent) out.push(leader.secondaryCurrent);
  return out;
}

/** Is this card legal in a deck led by `leader`? Prism is handled separately. */
export function isCardLegalFor(content: ContentIndex, leader: LeaderCardDef, card: CardDef): boolean {
  if (card.token || card.type === "leader" || card.variantOf) return false;
  if (card.faction !== leader.faction && card.faction !== "neutral") return false;
  if (card.current === "prism") return true; // subject to the splash limit
  return legalCurrentsFor(leader).includes(card.current);
}

/** Every card the deck builder should offer for this leader. */
export function legalCardPool(content: ContentIndex, leader: LeaderCardDef): CardDef[] {
  return collectibleCards(content).filter((card) => isCardLegalFor(content, leader, card));
}

export function validateDeck(content: ContentIndex, deck: DeckList): DeckProblem[] {
  const problems: DeckProblem[] = [];
  const balance = content.balance.deck;

  const leader = content.leaders[deck.leaderCardId];
  if (!leader) {
    return [{ code: "unknownLeader", message: `Unknown leader: ${deck.leaderCardId}` }];
  }

  if (deck.cards.length !== balance.size) {
    problems.push({ code: "wrongSize", message: `Deck must contain exactly ${balance.size} cards (has ${deck.cards.length}).` });
  }

  const counts = new Map<string, number>();
  let prismCount = 0;

  for (const cardId of deck.cards) {
    const card = content.cards[cardId];
    if (!card) {
      problems.push({ code: "unknownCard", message: `Unknown card: ${cardId}`, cardId });
      continue;
    }
    if (card.token) {
      problems.push({ code: "tokenInDeck", message: `${card.name} is a token and cannot be in a deck.`, cardId });
      continue;
    }
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    if (card.current === "prism") prismCount += 1;

    if (card.faction !== leader.faction && card.faction !== "neutral") {
      problems.push({ code: "illegalFaction", message: `${card.name} belongs to another faction.`, cardId });
    } else if (card.current !== "prism" && !legalCurrentsFor(leader).includes(card.current)) {
      problems.push({
        code: "illegalCurrent",
        message: `${card.name} is ${content.currents[card.current]?.name ?? card.current}; ${leader.name} allows ${legalCurrentsFor(leader).map((c) => content.currents[c]?.name ?? c).join(" and ")}.`,
        cardId,
      });
    }
  }

  for (const [cardId, count] of counts) {
    const card = content.cards[cardId];
    if (!card) continue;
    const max = card.rarity === "legendary" ? balance.maxCopiesLegendary : balance.maxCopies;
    if (count > max) {
      problems.push({ code: "tooManyCopies", message: `${card.name}: ${count} copies (maximum ${max}).`, cardId });
    }
  }

  if (prismCount > balance.prismSplashLimit && leader.primaryCurrent !== "prism" && leader.secondaryCurrent !== "prism") {
    problems.push({
      code: "tooManyPrism",
      message: `${prismCount} Prism cards (maximum splash is ${balance.prismSplashLimit}).`,
    });
  }

  return problems;
}

export const isDeckLegal = (content: ContentIndex, deck: DeckList): boolean => validateDeck(content, deck).length === 0;

/**
 * Every tag this leader's card pool actually pays off, and how often.
 *
 * Derived from the data rather than authored: a tag that some card's targeting
 * filter names ("your other Crew characters", "a Signal card") is a tag a deck
 * wants to be dense in. Counting the references gives each faction its own
 * priorities without a hand-written archetype list per faction, and without
 * anything to keep in sync when cards change.
 */
export function payoffTags(content: ContentIndex, leader: LeaderCardDef): Map<string, number> {
  const counts = new Map<string, number>();
  const note = (tag: string): void => {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    // TargetFilter.tag — "characters with this tag"
    if (Array.isArray(record["tag"])) {
      for (const tag of record["tag"]) if (typeof tag === "string") note(tag);
    }
    // collab: { kind: "tag", value }
    if (record["kind"] === "tag" && typeof record["value"] === "string") note(record["value"]);
    for (const child of Object.values(record)) walk(child);
  };

  walk(leader.passive);
  walk(leader.fixation);
  walk(leader.ultimate);
  for (const card of legalCardPool(content, leader)) walk(card.effects);
  return counts;
}

/**
 * How much this leader wants this card, beyond fitting the curve.
 *
 * Higher is better. Ties fall back to card id so the build stays a pure function
 * of (content, leader) — every replay, every test and every AI opponent depends
 * on that.
 */
function synergyScore(card: CardDef, leader: LeaderCardDef, payoff: Map<string, number>): number {
  let score = 0;
  for (const tag of card.tags) score += (payoff.get(tag) ?? 0) * 2;
  // leaning on the primary Current keeps Confluences and Resonance reachable
  if (card.current === leader.primaryCurrent) score += 3;
  // a card that is itself a payoff is worth having, but only once the deck has
  // bodies to pay it off with — the curve fill below handles that ordering
  if (card.rarity === "legendary") score += 1;
  return score;
}

/**
 * How many cards a 30-card deck wants at each cost, with 7 meaning "7 or more".
 *
 * Exported because the Gauntlet's draft steers its offers toward the buckets a
 * run is short of, and the shape it steers toward has to be the shape this
 * game's own deck builder fills. A draft aiming at a different curve would be
 * teaching a target nothing else in the build believes in — and the two copies
 * would drift the first time either was tuned.
 */
export const TARGET_CURVE: Readonly<Record<number, number>> = { 1: 5, 2: 6, 3: 6, 4: 5, 5: 4, 6: 2, 7: 2 };

/** The bucket a card counts toward in `TARGET_CURVE` (everything 7+ is one bucket). */
export const curveBucket = (cost: number): number => Math.max(1, Math.min(7, cost));

/**
 * How many cards short of `TARGET_CURVE` each cost bucket is.
 *
 * One implementation, three callers: `autoBuildDeck` fills toward it, the
 * Gauntlet's pick assist weights offers by it, and the deck builder's
 * suggestions rank by it. It lived in the Gauntlet first and was about to be
 * written a third time for the builder — three copies of the same arithmetic,
 * each free to drift the first time anybody tuned the curve.
 *
 * Unknown ids are skipped rather than counted at cost 0, because a deck code
 * naming a card this build no longer ships should not report a phantom
 * one-drop.
 */
export function curveNeed(content: ContentIndex, cards: readonly string[]): Record<number, number> {
  const have: Record<number, number> = {};
  for (const cardId of cards) {
    const card = content.cards[cardId];
    if (!card) continue;
    const bucket = curveBucket(card.cost);
    have[bucket] = (have[bucket] ?? 0) + 1;
  }
  const need: Record<number, number> = {};
  for (const [bucket, want] of Object.entries(TARGET_CURVE)) {
    need[Number(bucket)] = Math.max(0, want - (have[Number(bucket)] ?? 0));
  }
  return need;
}

/**
 * Build a reasonable legal deck for a leader — used by the AI, the tutorial,
 * the starter decks, and tests. Prefers a smooth curve over raw power.
 *
 * `"synergy"` orders each cost bucket by tag density instead of by id, on the
 * theory that the factions at the bottom of the balance table — Afterparty
 * Crew's end-of-turn chains, the Syndicate's Signal cards, the Collective's
 * Reposts — were being handed decks without the density their payoffs need.
 *
 * It was measured and it is not the default, because it did nothing: 320 mirror
 * matches (same leader, both seats, one deck built each way) came out 49.1% to
 * 50.9%, which is a coin flip. `npm run balance` re-runs that comparison, so a
 * better heuristic can be judged the same way rather than argued about.
 */
export function autoBuildDeck(
  content: ContentIndex,
  leaderCardId: string,
  name = "Auto Deck",
  mode: "synergy" | "curve" = "curve"
): DeckList {
  const leader = content.leaders[leaderCardId];
  if (!leader) throw new Error(`Unknown leader: ${leaderCardId}`);

  const balance = content.balance.deck;
  const payoff = mode === "synergy" ? payoffTags(content, leader) : new Map<string, number>();

  /**
   * Prism is a splash for most leaders and a home Current for a few.
   *
   * Dropping every Prism card was a shortcut around the splash limit, and it is
   * correct for the eight leaders who can only splash three. For a leader whose
   * own Current *is* Prism it threw away half the faction: Cosplay Champions
   * print eleven Tide cards and seven Prism, so Vera Foamhammer was being built
   * from twelve cards and could not reach thirty. `validateDeck` already skips
   * the splash check for a Prism-native leader — this is the builder catching up
   * with the rule.
   */
  const prismIsHome = leader.primaryCurrent === "prism" || leader.secondaryCurrent === "prism";
  const pool = legalCardPool(content, leader)
    .filter((card) => prismIsHome || card.current !== "prism")
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        (mode === "synergy" ? synergyScore(b, leader, payoff) - synergyScore(a, leader, payoff) : 0) ||
        (a.id < b.id ? -1 : 1)
    );

  // target curve: how many cards we want at each cost bucket
  const curve = TARGET_CURVE;
  const cards: string[] = [];
  const counts = new Map<string, number>();

  const maxFor = (card: CardDef): number => (card.rarity === "legendary" ? balance.maxCopiesLegendary : balance.maxCopies);

  const tryAdd = (card: CardDef): boolean => {
    const current = counts.get(card.id) ?? 0;
    if (current >= maxFor(card)) return false;
    if (cards.length >= balance.size) return false;
    counts.set(card.id, current + 1);
    cards.push(card.id);
    return true;
  };

  for (const [costKey, wanted] of Object.entries(curve)) {
    const cost = Number(costKey);
    const bucket = pool.filter((card) => (cost === 7 ? card.cost >= 7 : card.cost === cost));
    let added = 0;
    // two passes so we spread copies across distinct cards before doubling up
    for (let pass = 0; pass < 2 && added < wanted; pass++) {
      for (const card of bucket) {
        if (added >= wanted) break;
        if (tryAdd(card)) added++;
      }
    }
  }

  // top up with anything legal if the curve could not be filled
  for (const card of pool) {
    while (cards.length < balance.size && tryAdd(card)) {
      /* keep adding copies of this card until its limit or the deck is full */
    }
    if (cards.length >= balance.size) break;
  }

  return { name, leaderCardId, cards: cards.slice(0, balance.size) };
}
