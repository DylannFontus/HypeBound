/**
 * The Gauntlet — `09-game-modes.md` §8. Draft a deck one pick at a time, then
 * ride it until 12 wins or 3 losses.
 *
 * Every function here is pure: run in, run out, no DOM, no storage, no clock.
 * That is what lets the whole mode be tested headlessly, and headless testing is
 * the only way to be confident about the part of a draft nobody can eyeball —
 * that **every** offer, for every leader, at every pick, is three distinct legal
 * cards. There are 20 leaders and 30 picks; a person clicking through can check
 * a handful of them.
 *
 * ## The offer is derived, not stored
 *
 * A pick's three cards come from `subSeed(run seed, generation, pick number)`
 * plus the deck drafted so far. Nothing about an offer is written down, so a
 * reload mid-draft shows the same three cards rather than rerolling them — and
 * closing the tab on a pick you did not like is not a reroll button.
 *
 * ## The rarity table does not survive contact with the card pool
 *
 * §8.1 rolls a rarity per pick and then wants three *distinct* cards of it. This
 * build cannot do that for Legendary: **not one of the twenty selectable leaders
 * has three Legendaries in its legal pool** — most have exactly one, three have
 * none, and one leader cannot fill an Epic offer either. So the roll happens
 * exactly as specced and then a documented ladder fills what the bucket cannot,
 * taking from the nearest rarity below first. `offerReality()` measures it per
 * leader and the screen prints the result, because a draft that quietly hands
 * you Epics when it said Legendary is a draft that lies about its own odds.
 */

import type { AiDifficulty, CardDef, ContentIndex, DeckList, LeaderCardDef, Rarity } from "../../engine/types";
import { nextFloat, nextInt, seedRng, subSeed, type RngState } from "../../engine/rng";
import { curveBucket, curveNeed as engineCurveNeed, legalCardPool } from "../../engine/deck";
import { selectableLeaders } from "../../engine/content";
import { cosmeticById } from "../cosmetics";
import { RARITY_ORDER, gauntletData, type DraftRarity, type RarityWeights, type RewardRow } from "./data";

export const GAUNTLET_VERSION = 1;

/**
 * Controls §8 asks for that this build does not have, each with the reason.
 *
 * The list is on the screen rather than in a document, because the player who
 * wonders where competitive Gauntlet is deserves the answer in the place they
 * wondered it. The test asserts every reason is a real sentence — an entry
 * reading "TODO" would be worse than no list.
 */
export const DEFERRED_GAUNTLET: ReadonlyMap<string, string> = new Map([
  [
    "Competitive Gauntlet",
    "§8.2 matches you against other drafters by run record and then by Gauntlet MMR. Both are the server's job — there is nobody to be matched against offline, and a fake queue that always found an AI would be a lie about who you just beat.",
  ],
  [
    "Entry cost",
    "§8.3 charges 150 Clout or one Gauntlet Ticket. Practice is free entry by §8.4, so nothing is debited here; the price is shown so the online version cannot quietly arrive at a different one.",
  ],
  [
    "Gauntlet Tickets",
    "A Ticket buys one competitive entry, and competitive Gauntlet needs a server. Paying a currency with no sink is a reward that does nothing, so the Practice table pays the Clout and the Signal and says the Ticket column is waiting on the mode it spends into.",
  ],
  [
    "Merch Drops from a run",
    "§8.4 excludes packs from Practice rewards outright. This is the design's line, not a shortfall, and it is listed here so the greyed column on the reward table has a stated reason next to it.",
  ],
  [
    "The animated Gauntlet card back",
    "§8.3's 12-win row asks for an animated card back. Card backs in this build are a procedural still drawn once to a canvas texture; nothing animates one. A 12-win run is paid the static Gauntlet back instead, and the animated upgrade waits on an animation path that would also serve the Hype Wave's animated rows.",
  ],
]);

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

/**
 * A fight handed off to the battle screen.
 *
 * Stored on the run, and stored **before** the board is built, so the hub can
 * say a fight is in progress rather than pretending the run is idle.
 *
 * Its seed is keyed by (wins, losses) and deliberately *not* by how many times
 * the fight has been entered. The Doomscroll counts re-entries into its battle
 * seed so a restart is at least a different game; the Gauntlet does the
 * opposite, because here a loss is the resource being spent and rerolling the
 * board would be worth doing on purpose. Walking out of a losing board and
 * walking back in gives you the same opponent, the same deck and the same
 * opening — the most an offline build can do about it — and `fightsEntered`
 * keeps count so the run summary can say it out loud.
 */
export interface PendingFight {
  seed: number;
  enemyLeaderCardId: string;
  difficulty: AiDifficulty;
  /** the run record this fight is being played at, for the board's header */
  atWins: number;
  atLosses: number;
}

export type GauntletPhase = "leader" | "draft" | "ready" | "run" | "done";

export interface GauntletRun {
  version: number;
  seed: number;
  /**
   * Bumped by "Delete and Repost". The offer seed mixes it in, so a re-draft is
   * a genuinely different draft rather than the same thirty offers again — which
   * would make the one free re-draft worth nothing.
   */
  generation: number;
  phase: GauntletPhase;
  /** the three leaders offered at the start; kept so a reload re-offers them */
  leaderChoices: string[];
  leaderCardId: string | null;
  /** drafted card ids, in pick order */
  deck: string[];
  redraftsUsed: number;
  wins: number;
  losses: number;
  /** true when the player cashed out early rather than playing to a limit */
  retiredEarly: boolean;
  pending: PendingFight | null;
  /** fights entered, including ones walked out of; reported on the summary */
  fightsEntered: number;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Seeded helpers
// ---------------------------------------------------------------------------

/**
 * Weighted pick over fractional weights.
 *
 * `pickWeightedIndex` in the engine takes integers, because everything that
 * wanted it until now was counting things. The curve assist is a fraction per
 * missing copy, and rounding it to integers would round a "soft" weight into
 * either no effect or a hard preference.
 */
function weightedPick<T>(rng: RngState, items: readonly T[], weight: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return nextInt(rng, items.length);
  let roll = nextFloat(rng) * total;
  for (let index = 0; index < items.length; index++) {
    roll -= Math.max(0, weight(items[index]!));
    if (roll < 0) return index;
  }
  return items.length - 1;
}

/**
 * Roll one rarity from a distribution.
 *
 * The fallback is the last rarity carrying weight, not simply the last one. A
 * spotlight row assigns Common zero, and a roll of 0.9999999 against weights
 * that sum to 0.99999999 must not land on a rarity the table excluded.
 */
function rollRarity(rng: RngState, weights: RarityWeights): DraftRarity {
  let roll = nextFloat(rng);
  let last: DraftRarity = "common";
  for (const rarity of RARITY_ORDER) {
    if (weights[rarity] > 0) last = rarity;
    roll -= weights[rarity];
    if (roll < 0 && weights[rarity] > 0) return rarity;
  }
  return last;
}

/**
 * Where to look when a rarity cannot fill an offer: itself, then downward one
 * step at a time, then upward.
 *
 * Down before up because the rolled rarity is a ceiling the player was promised
 * and the nearest honest substitute is the rarity below it — a Legendary pick
 * for a leader with one Legendary should read as "one Legendary and two Epics",
 * not as a Common pick with a bonus.
 */
function fillLadder(rarity: DraftRarity): DraftRarity[] {
  const index = RARITY_ORDER.indexOf(rarity);
  const below = RARITY_ORDER.slice(0, index).slice().reverse();
  const above = RARITY_ORDER.slice(index + 1);
  return [rarity, ...below, ...above];
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export interface DraftOffer {
  /** 1-based, exactly as §8.1 numbers its Spotlight Picks */
  pick: number;
  spotlight: boolean;
  /** the rarity the bucket rolled */
  rarity: DraftRarity;
  cardIds: string[];
  /** slots the rolled rarity could not fill on its own */
  substituted: number;
  /** false once the canonical Prism splash limit has been drafted */
  prismOpen: boolean;
}

const isPrismNative = (leader: LeaderCardDef): boolean =>
  leader.primaryCurrent === "prism" || leader.secondaryCurrent === "prism";

/**
 * How many cards of each cost bucket the draft still wants.
 *
 * `TARGET_CURVE` is the shape `autoBuildDeck` fills, imported rather than
 * restated — a draft steering toward a curve nothing else in the game believes
 * in would be teaching a target that does not exist.
 */
const curveNeed = (content: ContentIndex, deck: readonly string[]): Record<number, number> =>
  engineCurveNeed(content, deck);

/**
 * The cards a leader may be offered right now.
 *
 * §8.1's legality is the deck builder's legality, so it is `legalCardPool` and
 * not a second opinion. The one thing on top is the Prism cutoff: Prism may be
 * offered until the canonical splash limit has been drafted, after which it
 * stops appearing — **unless Prism is one of the leader's own Currents**, in
 * which case the splash limit was never about them. `validateDeck` already
 * carves out Prism-native leaders and `autoBuildDeck` had to be taught the same
 * thing after it spent a while building Vera Foamhammer decks out of half her
 * faction; this is the third place that rule has to hold.
 */
export function offerPool(content: ContentIndex, leader: LeaderCardDef, deck: readonly string[]): {
  pool: CardDef[];
  prismOpen: boolean;
} {
  const limit = content.balance.deck.prismSplashLimit;
  const drafted = deck.filter((cardId) => content.cards[cardId]?.current === "prism").length;
  const prismOpen = isPrismNative(leader) || drafted < limit;
  const pool = legalCardPool(content, leader).filter((card) => card.current !== "prism" || prismOpen);
  return { pool, prismOpen };
}

/**
 * Build one pick's offer.
 *
 * Deterministic in (seed, generation, pick, deck-so-far). The deck is an input
 * because the curve assist and the Prism cutoff both read it — which means an
 * offer is stable across a reload but genuinely responds to what has been
 * drafted, and neither property is worth losing.
 */
export function offerCards(
  content: ContentIndex,
  leaderCardId: string,
  deck: readonly string[],
  seed: number,
  generation: number,
  pick: number
): DraftOffer {
  const leader = content.leaders[leaderCardId];
  if (!leader) throw new Error(`Unknown leader: ${leaderCardId}`);
  const draft = gauntletData().draft;

  const spotlight = draft.spotlightPicks.includes(pick);
  const rng = seedRng(subSeed(seed, "pick", generation, pick));
  const rarity = rollRarity(rng, spotlight ? draft.rarity.spotlight : draft.rarity.standard);

  const { pool, prismOpen } = offerPool(content, leader, deck);
  const need = curveNeed(content, deck);
  const weight = (card: CardDef): number => 1 + draft.curveAssist * (need[curveBucket(card.cost)] ?? 0);

  const chosen: CardDef[] = [];
  const taken = new Set<string>();
  for (const step of fillLadder(rarity)) {
    if (chosen.length >= draft.offerSize) break;
    const candidates = pool.filter((card) => card.rarity === (step as Rarity) && !taken.has(card.id));
    while (chosen.length < draft.offerSize && candidates.length > 0) {
      const index = weightedPick(rng, candidates, weight);
      const card = candidates.splice(index, 1)[0]!;
      taken.add(card.id);
      chosen.push(card);
    }
  }

  return {
    pick,
    spotlight,
    rarity,
    cardIds: chosen.map((card) => card.id),
    substituted: chosen.filter((card) => card.rarity !== rarity).length,
    prismOpen,
  };
}

/** The offer the run is looking at, or null when it is not drafting. */
export function currentOffer(content: ContentIndex, run: GauntletRun): DraftOffer | null {
  if (run.phase !== "draft" || !run.leaderCardId) return null;
  return offerCards(content, run.leaderCardId, run.deck, run.seed, run.generation, run.deck.length + 1);
}

// ---------------------------------------------------------------------------
// Starting, drafting, running
// ---------------------------------------------------------------------------

/**
 * Three leaders, each from a different faction (§8.1).
 *
 * Different factions rather than three random leaders, because two leaders of
 * one faction share most of a card pool — an offer of two Cosplay leaders and
 * one other is really a choice between two decks, not three.
 */
export function leaderOffer(content: ContentIndex, seed: number): string[] {
  const wanted = gauntletData().draft.leaderChoices;
  const rng = seedRng(subSeed(seed, "leaders"));

  const byFaction = new Map<string, LeaderCardDef[]>();
  for (const leader of selectableLeaders(content)) {
    const list = byFaction.get(leader.faction) ?? [];
    list.push(leader);
    byFaction.set(leader.faction, list);
  }
  // sorted so the pool is a pure function of content, never of object key order
  const factions = [...byFaction.keys()].sort();

  const out: string[] = [];
  while (out.length < wanted && factions.length > 0) {
    const faction = factions.splice(nextInt(rng, factions.length), 1)[0]!;
    const leaders = [...(byFaction.get(faction) ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (leaders.length === 0) continue;
    out.push(leaders[nextInt(rng, leaders.length)]!.id);
  }
  return out;
}

export function startRun(content: ContentIndex, seed: number, startedAt: number): GauntletRun {
  return {
    version: GAUNTLET_VERSION,
    seed,
    generation: 0,
    phase: "leader",
    leaderChoices: leaderOffer(content, seed),
    leaderCardId: null,
    deck: [],
    redraftsUsed: 0,
    wins: 0,
    losses: 0,
    retiredEarly: false,
    pending: null,
    fightsEntered: 0,
    startedAt,
  };
}

export function chooseLeader(run: GauntletRun, leaderCardId: string): GauntletRun {
  if (run.phase !== "leader" || !run.leaderChoices.includes(leaderCardId)) return run;
  return { ...run, leaderCardId, phase: "draft", deck: [] };
}

export function pickCard(content: ContentIndex, run: GauntletRun, cardId: string): GauntletRun {
  const offer = currentOffer(content, run);
  if (!offer || !offer.cardIds.includes(cardId)) return run;
  const deck = [...run.deck, cardId];
  return { ...run, deck, phase: deck.length >= gauntletData().draft.picks ? "ready" : "draft" };
}

/**
 * "Delete and Repost" — §8.2's one free full-deck re-draft, before the first
 * match.
 *
 * It throws the deck away and drafts again from pick one rather than swapping
 * the finished list for a generated one: a re-draft you do not get to make is
 * not a re-draft, it is a reroll.
 */
export function redraft(run: GauntletRun): GauntletRun {
  if (run.phase !== "ready" && run.phase !== "draft") return run;
  if (run.redraftsUsed >= gauntletData().draft.redrafts) return run;
  return { ...run, generation: run.generation + 1, redraftsUsed: run.redraftsUsed + 1, deck: [], phase: "draft" };
}

export function beginRun(run: GauntletRun): GauntletRun {
  if (run.phase !== "ready") return run;
  return { ...run, phase: "run" };
}

/** The difficulty a run at this many wins faces (§8.4's Casual → Advanced). */
export function difficultyForWins(wins: number): AiDifficulty {
  const table = gauntletData().practice.difficultyByWins;
  let chosen = table[0]!.difficulty;
  for (const step of table) if (wins >= step.minWins) chosen = step.difficulty;
  return chosen;
}

export const isOver = (run: GauntletRun): boolean => {
  const limits = gauntletData().run;
  return run.retiredEarly || run.wins >= limits.winsToRetire || run.losses >= limits.lossesToRetire;
};

/** The fight this run faces next — the pending one if it walked out of it. */
export function nextFight(content: ContentIndex, run: GauntletRun): PendingFight {
  if (run.pending) return run.pending;
  const seed = subSeed(run.seed, "fight", run.wins, run.losses);
  const rng = seedRng(seed);
  const leaders = selectableLeaders(content)
    .map((leader) => leader.id)
    .sort();
  return {
    seed,
    enemyLeaderCardId: leaders[nextInt(rng, leaders.length)]!,
    difficulty: difficultyForWins(run.wins),
    atWins: run.wins,
    atLosses: run.losses,
  };
}

export function enterFight(content: ContentIndex, run: GauntletRun): GauntletRun {
  if (run.phase !== "run" || isOver(run)) return run;
  return { ...run, pending: nextFight(content, run), fightsEntered: run.fightsEntered + 1 };
}

export function resolveFight(run: GauntletRun, won: boolean): GauntletRun {
  if (!run.pending) return run;
  const wins = run.wins + (won ? 1 : 0);
  const losses = run.losses + (won ? 0 : 1);
  const next = { ...run, wins, losses, pending: null };
  return { ...next, phase: isOver(next) ? ("done" as const) : next.phase };
}

/** Cash out early for the row reached so far (§8.2). */
export function retire(run: GauntletRun): GauntletRun {
  if (run.phase !== "run" && run.phase !== "ready") return run;
  return { ...run, retiredEarly: true, pending: null, phase: "done" };
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/**
 * The drafted deck as the engine takes it.
 *
 * Deliberately **not** run through `validateDeck`: §8.1(4) drops the 2/1-copy
 * limits for this mode, so a legal Gauntlet deck is one `validateDeck` would
 * reject. The test that keeps that honest asserts the only complaint it ever
 * makes about a drafted deck is `tooManyCopies` — one rule waived, and the
 * faction, Current, Prism and size rules all still holding.
 */
export const deckListFor = (run: GauntletRun, name = "Gauntlet Deck"): DeckList => ({
  name,
  leaderCardId: run.leaderCardId ?? "",
  cards: [...run.deck],
});

/**
 * A drafted deck for the AI.
 *
 * The opponent drafts too, through the same offer generator, because the
 * alternative is a drafted deck against a stock constructed one — a matchup that
 * is not the mode. `autoBuildDeck` builds the best 30 cards a faction has; a
 * draft deck is 30 cards somebody was *offered*, and those are not the same
 * standard of opponent.
 *
 * The bot picks greedily by curve: whichever offered card fills the emptiest
 * bucket, breaking ties toward the rarer card and then by id so the deck is a
 * pure function of (content, seed, leader).
 */
export function botDeck(content: ContentIndex, seed: number, leaderCardId: string, name: string): DeckList {
  const picks = gauntletData().draft.picks;
  const deck: string[] = [];

  for (let pick = 1; pick <= picks; pick++) {
    const offer = offerCards(content, leaderCardId, deck, seed, 0, pick);
    if (offer.cardIds.length === 0) break;
    const need = curveNeed(content, deck);
    const rank = (cardId: string): [number, number, string] => {
      const card = content.cards[cardId]!;
      return [need[curveBucket(card.cost)] ?? 0, RARITY_ORDER.indexOf(card.rarity as DraftRarity), card.id];
    };
    const best = [...offer.cardIds].sort((a, b) => {
      const [needA, rarityA, idA] = rank(a);
      const [needB, rarityB, idB] = rank(b);
      return needB - needA || rarityB - rarityA || (idA < idB ? -1 : 1);
    })[0]!;
    deck.push(best);
  }

  return { name, leaderCardId, cards: deck };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export interface GauntletReward {
  wins: number;
  clout: number;
  packs: number;
  signal: number;
  tickets: number;
  cardBackProgress: number;
  cosmetics: string[];
}

/** §8.3's row for a final win count. Rows are whole payouts, not increments. */
export function rewardRowFor(wins: number): RewardRow {
  const rows = gauntletData().rewards.rows;
  let chosen = rows[0]!;
  for (const row of rows) if (wins >= row.wins) chosen = row;
  return chosen;
}

/**
 * What a Practice run actually pays (§8.4).
 *
 * **Derived from the competitive row, never authored beside it.** A second
 * hand-written table is a second thing to keep in step with the first, and the
 * failure mode is silent: the two would only disagree for players who reached a
 * row nobody re-checked.
 */
export function practiceReward(wins: number): GauntletReward {
  const { practice } = gauntletData();
  const row = rewardRowFor(wins);
  return {
    wins: row.wins,
    clout: Math.round(row.clout * practice.scale),
    signal: Math.round(row.signal * practice.scale),
    packs: practice.packs ? row.packs : 0,
    tickets: practice.tickets ? row.tickets : 0,
    // a cosmetic has no 25% of itself, and twelve wins is twelve wins
    cardBackProgress: row.cardBackProgress ?? 0,
    cosmetics: [...(row.cosmetics ?? [])],
  };
}

// ---------------------------------------------------------------------------
// What the pool can actually offer
// ---------------------------------------------------------------------------

export interface OfferReality {
  leaderCardId: string;
  leaderName: string;
  counts: Record<DraftRarity, number>;
  /** rarities whose bucket cannot fill an offer from its own cards */
  short: DraftRarity[];
}

/**
 * Per leader, how many distinct cards each rarity bucket can actually offer.
 *
 * Measured with Prism spent — the worst case for every leader Prism is a splash
 * for, and no change at all for the leaders it is a home Current for.
 *
 * This exists because §8.1's table is a promise about odds and the card pool is
 * the thing that decides whether the promise can be kept. Publishing the answer
 * is the same rule `src/game/fairness/` follows for Drop rates: the number the
 * player is shown has to be the number they get.
 */
export function offerReality(content: ContentIndex): OfferReality[] {
  const offerSize = gauntletData().draft.offerSize;

  return selectableLeaders(content)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((leader) => {
      // Prism already spent — the thinnest this leader's pool ever gets, and no
      // change at all for the leaders Prism is a home Current for
      const pool = legalCardPool(content, leader).filter(
        (card) => card.current !== "prism" || isPrismNative(leader)
      );
      const counts = Object.fromEntries(
        RARITY_ORDER.map((rarity) => [rarity, pool.filter((card) => card.rarity === rarity).length])
      ) as Record<DraftRarity, number>;
      return {
        leaderCardId: leader.id,
        leaderName: leader.name,
        counts,
        short: RARITY_ORDER.filter((rarity) => counts[rarity] < offerSize),
      };
    });
}

/** How many leaders cannot fill an offer at each rarity — the headline number. */
export function rarityShortfall(content: ContentIndex): Record<DraftRarity, number> {
  const out = Object.fromEntries(RARITY_ORDER.map((rarity) => [rarity, 0])) as Record<DraftRarity, number>;
  for (const entry of offerReality(content)) for (const rarity of entry.short) out[rarity] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Data check
// ---------------------------------------------------------------------------

/** Everything wrong with `data/gauntlet.json`, checked against real content. */
export function checkGauntletData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = gauntletData();
  const { draft, rewards, practice, cardBack } = data;

  for (const [name, weights] of Object.entries(draft.rarity)) {
    const total = RARITY_ORDER.reduce((sum, rarity) => sum + weights[rarity], 0);
    if (Math.abs(total - 1) > 1e-9) problems.push(`draft.rarity.${name}: weights sum to ${total}, not 1`);
  }
  for (const pick of draft.spotlightPicks) {
    if (pick > draft.picks) problems.push(`draft.spotlightPicks: pick ${pick} is past the ${draft.picks}th`);
  }
  if (draft.offerSize > draft.picks) problems.push("draft: an offer cannot be wider than the draft is long");

  /**
   * A row per win count, no gaps and no repeats.
   *
   * A missing row does not throw — `rewardRowFor` falls back to the highest row
   * at or below the count — it silently pays the row below, which is the kind of
   * shortfall that only shows up for the players who got furthest.
   */
  const expected = data.run.winsToRetire;
  const seen = new Set<number>();
  for (const row of rewards.rows) {
    if (seen.has(row.wins)) problems.push(`rewards: two rows for ${row.wins} wins`);
    seen.add(row.wins);
  }
  for (let wins = 0; wins <= expected; wins++) {
    if (!seen.has(wins)) problems.push(`rewards: no row for ${wins} wins`);
  }
  for (const row of rewards.rows) {
    if (row.wins > expected) problems.push(`rewards: a row for ${row.wins} wins, past the ${expected}-win limit`);
  }
  let previous = -1;
  for (const row of [...rewards.rows].sort((a, b) => a.wins - b.wins)) {
    if (row.clout < previous) problems.push(`rewards: ${row.wins} wins pays less Clout than ${row.wins - 1}`);
    previous = row.clout;
  }

  for (const row of rewards.rows) {
    for (const id of row.cosmetics ?? []) {
      if (!cosmeticById(content, id)) problems.push(`rewards: ${row.wins} wins grants "${id}", which resolves to nothing`);
    }
  }
  const back = cosmeticById(content, cardBack.cosmeticId);
  if (!back) problems.push(`cardBack: "${cardBack.cosmeticId}" resolves to nothing`);
  else if (back.kind !== "cardBack") problems.push(`cardBack: "${cardBack.cosmeticId}" is a ${back.kind}`);

  if (practice.scale <= 0) problems.push("practice: a scale of zero pays nothing for a whole run");
  if (practice.difficultyByWins[0]!.minWins !== 0) problems.push("practice.difficultyByWins: no row covers zero wins");
  let floor = -1;
  for (const step of practice.difficultyByWins) {
    if (step.minWins <= floor) problems.push(`practice.difficultyByWins: ${step.minWins} does not follow ${floor}`);
    floor = step.minWins;
  }

  /**
   * Every leader must be able to fill an offer *somehow*.
   *
   * Not at every rarity — nobody in this build can do that at Legendary, which
   * is what the fill ladder is for. But a leader whose whole legal pool is
   * smaller than an offer would hand out two cards and a gap, and the ladder has
   * nothing left to reach for.
   */
  for (const entry of offerReality(content)) {
    const total = RARITY_ORDER.reduce((sum, rarity) => sum + entry.counts[rarity], 0);
    if (total < draft.offerSize) {
      problems.push(`${entry.leaderCardId}: ${total} legal cards, fewer than an offer of ${draft.offerSize}`);
    }
    if (total < draft.picks / 4) {
      problems.push(`${entry.leaderCardId}: ${total} legal cards is too thin to draft ${draft.picks} from`);
    }
  }

  return problems;
}
