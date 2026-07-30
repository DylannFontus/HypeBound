/**
 * Faction Mastery, Leader Mastery and the Bias Board — the curve, the ranks and
 * the rewards.
 *
 * `08-progression.md` §4, §5 and §6. Three parallel trackers fed by nothing but
 * playing matches, and the design is emphatic about what feeds them: *"Faction
 * Mastery XP = the match XP (completion + win) you earn while playing that
 * faction's leader. Missions and bonuses do not count — mastery measures matches
 * actually played."* The save layer enforces that; this module never sees where
 * the XP came from, only how much of it there is.
 *
 * ## Mastery accumulates; missions derive
 *
 * Worth stating plainly, because the two systems sit next to each other and look
 * alike. Mission progress is **recomputed from a bounded log of finished
 * matches** — the evidence can be re-read and a claim can be audited. Mastery
 * cannot work that way: it is lifetime, the log is pruned to what the oldest held
 * mission needs, and a track that forgot the first two hundred matches would be
 * wrong. So mastery is an **accumulator**, and the price of that is that it has
 * to be right the first time — there is no re-derivation to fall back on.
 *
 * That is the whole reason `recordMatch` credits mastery outside the `try` that
 * guards the mission stats: a record that fails to replay earns no mission credit
 * (it can be re-derived later if the bug is fixed) but must still earn mastery
 * (it cannot).
 *
 * ## Everything here is pure
 *
 * State in, result out. No storage, no DOM, no clock, and no randomness that is
 * not seeded from its own inputs — which is what lets the pick offered at rank 3
 * be the same three cards on every render and after every reload without storing
 * a thing.
 */

import type { CardDef, ContentIndex, FactionId, LeaderCardDef, Rarity } from "../../engine/types";
import { collectibleCards, selectableLeaders } from "../../engine/content";
import { nextInt, seedRng } from "../../engine/rng";
import {
  affinityConfig,
  factionMasteryConfig,
  leaderMasteryConfig,
  xpConfig,
  type AffinityConfig,
  type MasteryReward,
  type TrackConfig,
} from "./data";

export type { MasteryReward } from "./data";

/** Which of the three trackers a view describes. */
export type MasteryTrack = "faction" | "leader" | "affinity";

// ---------------------------------------------------------------------------
// What a match pays
// ---------------------------------------------------------------------------

/**
 * The XP one finished match is worth — the same number the account level gets.
 *
 * §4's "the match XP you earn" is not "some XP proportional to the match": it is
 * literally the match's own XP, which is why this is the single definition both
 * callers read.
 */
export function matchXp(won: boolean): number {
  const xp = xpConfig();
  return xp.matchComplete + (won ? xp.matchWin : 0);
}

// ---------------------------------------------------------------------------
// The curve
// ---------------------------------------------------------------------------

/**
 * What it costs to reach `rank` from the one below it.
 *
 * Bands are written as "every rank up to and including `throughRank` costs
 * this", so the band that owns a rank is the first one it fits in. Rank 1 is
 * where every track starts and is therefore free.
 */
export function xpToReach(config: TrackConfig, rank: number): number {
  if (rank <= 1) return 0;
  const band = config.curve.find((entry) => rank <= entry.throughRank) ?? config.curve[config.curve.length - 1]!;
  return band.xpPerRank;
}

/** Cumulative XP needed to sit exactly at `rank`. */
export function xpForRank(config: TrackConfig, rank: number): number {
  let total = 0;
  for (let step = 2; step <= Math.min(rank, config.ranks); step++) total += xpToReach(config, step);
  return total;
}

export interface RankState {
  rank: number;
  /** XP banked toward the next rank */
  intoRank: number;
  /** XP the next rank costs, or 0 at the cap */
  toNext: number;
  maxed: boolean;
}

/** Where `xp` puts a track. */
export function rankFor(config: TrackConfig, xp: number): RankState {
  let rank = 1;
  let remaining = Math.max(0, xp);
  while (rank < config.ranks) {
    const cost = xpToReach(config, rank + 1);
    if (remaining < cost) break;
    remaining -= cost;
    rank += 1;
  }
  const maxed = rank >= config.ranks;
  return { rank, intoRank: maxed ? 0 : remaining, toNext: maxed ? 0 : xpToReach(config, rank + 1), maxed };
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * Cosmetic reward types the design's tables promise and the game still cannot
 * deliver, each with the reason it is deferred rather than granted.
 *
 * This is the project's usual bargain: a gap is either closed or written down
 * with a justification, and a test walks both directions — every ungranted
 * `cosmetic` in `progression.json` must appear here (nothing is deferred
 * silently) and every entry here must still be in use (nothing stays deferred
 * after it ships).
 *
 * The rule they all follow is the one `grantTutorialReward` already states:
 * granting an invisible reward is worse than not granting it, because the player
 * cannot tell they received it and it double-pays the day the real system lands.
 *
 * **Five kinds left this list when the cosmetics layer shipped** — card backs,
 * emotes, frames, titles and badges are all worn and rendered now. What remains
 * is what still has no surface at all.
 */
export const DEFERRED_COSMETICS: ReadonlyMap<string, string> = new Map([
  ["portrait", "no alternate-portrait system — card art is procedural and keyed by card id alone"],
  [
    "emote",
    "only the Bias Board's tier-4 signature emote: faction and leader emotes ship, " +
      "but one written phrase per character is several hundred jokes, not a system",
  ],
  ["premiumVariant", "no Premium variant rendering; `variantOf` exists on cards but nothing grants one"],
  ["voiceLine", "no audio files — the manifest is wired and every slot is empty"],
  ["intro", "no match intro animation to vary"],
  ["skin", "no leader skin system — same blocker as portraits"],
]);

/**
 * Can this reward actually be handed to a player today?
 *
 * For a cosmetic the answer is whether it names a `ref` — the id of a real
 * cosmetic something can wear. That is a better test than a list of kinds,
 * because it is the same fact the granting code acts on: if `payReward` can
 * resolve it, it is grantable, and if it cannot, the row says what it is waiting
 * for. The two cannot disagree.
 */
export const isGrantable = (reward: MasteryReward): boolean =>
  reward.kind !== "cosmetic" || Boolean(reward.ref);

/** The rewards a rank pays, or an empty list for a rank that pays nothing. */
export function rewardsAt(config: TrackConfig, rank: number): MasteryReward[] {
  return config.rewards[String(rank)] ?? [];
}

// ---------------------------------------------------------------------------
// Track views
// ---------------------------------------------------------------------------

export interface MasteryRow {
  rank: number;
  rewards: MasteryReward[];
  /** the track has reached this rank */
  earned: boolean;
  claimed: boolean;
  /**
   * Earned, unclaimed, and holding at least one reward that can be granted.
   *
   * A rank whose whole payout is deferred cosmetics is deliberately **not**
   * claimable: pressing a button that pays nothing and then reports the rank as
   * collected is the same lie as granting the cosmetic invisibly. Those rows read
   * as earned, and say what they are waiting for.
   */
  claimable: boolean;
}

export interface MasteryView {
  track: MasteryTrack;
  id: string;
  name: string;
  /** the faction a leader track belongs to; equal to `id` on a faction track */
  factionId: string;
  xp: number;
  rank: number;
  intoRank: number;
  toNext: number;
  maxed: boolean;
  rows: MasteryRow[];
  /** how many rows are `claimable` — what the lobby badge counts */
  unclaimed: number;
}

/** The key a claimed rank is remembered by. */
export const claimKey = (track: MasteryTrack, id: string, rank: number): string => `${track}:${id}:${rank}`;

function buildView(
  track: MasteryTrack,
  config: TrackConfig,
  id: string,
  name: string,
  factionId: string,
  xp: number,
  claimed: ReadonlySet<string>
): MasteryView {
  const state = rankFor(config, xp);
  const rows: MasteryRow[] = [];
  let unclaimed = 0;
  /**
   * A track nobody has played has earned nothing — not even rank 1.
   *
   * Rank 1 is where the curve starts, so it costs no XP, and §4.2 hangs a reward
   * on it. Taken literally that pays a new account 100 Clout per faction, ten
   * times over, for never having played. Rank 1 is the reward for *turning up*
   * with a faction, so it wants one match, and the cheapest honest way to say
   * that is: a track with no XP has no ranks.
   */
  const started = xp > 0;
  for (let rank = 1; rank <= config.ranks; rank++) {
    const rewards = rewardsAt(config, rank);
    if (rewards.length === 0) continue;
    const earned = started && state.rank >= rank;
    const wasClaimed = claimed.has(claimKey(track, id, rank));
    const claimable = earned && !wasClaimed && rewards.some(isGrantable);
    if (claimable) unclaimed += 1;
    rows.push({ rank, rewards, earned, claimed: wasClaimed, claimable });
  }
  return { track, id, name, factionId, xp, ...state, rows, unclaimed };
}

/** One view per faction, in the content's faction order, `neutral` excluded. */
export function factionTracks(
  content: ContentIndex,
  xpByFaction: Readonly<Record<string, number>>,
  claimed: readonly string[]
): MasteryView[] {
  const config = factionMasteryConfig();
  const seen = new Set(claimed);
  return Object.values(content.factions)
    .filter((faction) => faction.id !== "neutral")
    .map((faction) =>
      buildView("faction", config, faction.id, faction.name, faction.id, xpByFaction[faction.id] ?? 0, seen)
    );
}

/** One view per selectable leader — boss and tutorial leaders have no track. */
export function leaderTracks(
  content: ContentIndex,
  xpByLeader: Readonly<Record<string, number>>,
  claimed: readonly string[]
): MasteryView[] {
  const config = leaderMasteryConfig();
  const seen = new Set(claimed);
  return selectableLeaders(content)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((leader) => buildView("leader", config, leader.id, leader.name, leader.faction, xpByLeader[leader.id] ?? 0, seen));
}

/** The leaders whose track belongs to a faction, for the faction's detail panel. */
export function leadersOfFaction(content: ContentIndex, factionId: string): LeaderCardDef[] {
  return selectableLeaders(content)
    .filter((leader) => leader.faction === factionId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Faction packs and picks
// ---------------------------------------------------------------------------

/** Every collectible card belonging to a faction, in a stable order. */
export function factionPool(content: ContentIndex, factionId: string): CardDef[] {
  return collectibleCards(content)
    .filter((card) => card.faction === factionId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * A stable seed from a string.
 *
 * FNV-1a, so the three cards a pick offers are decided by *what the pick is*
 * rather than by anything stored — the same offer on every render, after every
 * reload, and on a re-install with the same save. Nothing about the player's
 * collection goes in: an offer that changed as you opened packs would be a
 * different offer every time you looked at it.
 */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The cards a "pick 1 of N" reward offers.
 *
 * Deterministic in the faction, the rank and the rarity. Returns fewer than `n`
 * only when the faction genuinely has fewer cards of that rarity, which
 * `checkMasteryData` reports as a content problem rather than leaving to be
 * discovered by whoever reaches rank 9 first.
 */
export function pickCandidates(
  content: ContentIndex,
  factionId: string,
  rank: number,
  rarity: Rarity,
  count: number
): CardDef[] {
  const pool = factionPool(content, factionId).filter((card) => card.rarity === rarity);
  if (pool.length <= count) return pool;

  const rng = seedRng(hashSeed(`${factionId}:${rank}:${rarity}`));
  const remaining = pool.slice();
  const chosen: CardDef[] = [];
  while (chosen.length < count && remaining.length > 0) {
    chosen.push(remaining.splice(nextInt(rng, remaining.length), 1)[0]!);
  }
  return chosen.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Is `cardId` one of the cards this rank's pick actually offers? */
export function canPick(
  content: ContentIndex,
  factionId: string,
  rank: number,
  rarity: Rarity,
  count: number,
  cardId: string
): boolean {
  return pickCandidates(content, factionId, rank, rarity, count).some((card) => card.id === cardId);
}

// ---------------------------------------------------------------------------
// Affinity — the Bias Board
// ---------------------------------------------------------------------------

export interface AffinityTierState {
  id: string;
  name: string;
  ap: number;
  rewards: MasteryReward[];
  earned: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface AffinityView {
  cardId: string;
  name: string;
  factionId: string;
  ap: number;
  /** the highest tier reached, 0 when none */
  tier: number;
  tierName: string | null;
  /** AP the next tier needs, or 0 at the top */
  nextAt: number;
  tiers: AffinityTierState[];
  unclaimed: number;
}

/** The affinity view for one character card. */
export function affinityView(
  card: CardDef,
  ap: number,
  claimed: ReadonlySet<string>,
  config: AffinityConfig = affinityConfig()
): AffinityView {
  let tier = 0;
  const tiers: AffinityTierState[] = config.tiers.map((entry, index) => {
    const earned = ap >= entry.ap;
    if (earned) tier = index + 1;
    const wasClaimed = claimed.has(claimKey("affinity", card.id, index + 1));
    return {
      id: entry.id,
      name: entry.name,
      ap: entry.ap,
      rewards: entry.rewards,
      earned,
      claimed: wasClaimed,
      claimable: earned && !wasClaimed && entry.rewards.some(isGrantable),
    };
  });
  return {
    cardId: card.id,
    name: card.name,
    factionId: card.faction,
    ap,
    tier,
    tierName: tier > 0 ? (config.tiers[tier - 1]?.name ?? null) : null,
    nextAt: tier >= config.tiers.length ? 0 : (config.tiers[tier]?.ap ?? 0),
    tiers,
    unclaimed: tiers.filter((entry) => entry.claimable).length,
  };
}

/**
 * Every character with affinity, plus every character the player owns.
 *
 * The Bias Board is a record of devotion, so a character you have never played
 * still belongs on it at zero — otherwise the board only ever shows what you
 * already main, which is the opposite of what §6 is for.
 */
export function affinityBoard(
  content: ContentIndex,
  apByCard: Readonly<Record<string, number>>,
  claimed: readonly string[],
  owned: Readonly<Record<string, number>>
): AffinityView[] {
  const seen = new Set(claimed);
  const config = affinityConfig();
  return collectibleCards(content)
    .filter((card) => card.type === "character")
    .filter((card) => (apByCard[card.id] ?? 0) > 0 || (owned[card.id] ?? 0) > 0)
    .map((card) => affinityView(card, apByCard[card.id] ?? 0, seen, config))
    .sort((a, b) => b.ap - a.ap || (a.name < b.name ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Content checks
// ---------------------------------------------------------------------------

/**
 * Every way the shipped content could fail to satisfy the reward tables.
 *
 * Run as a test rather than at load, for the same reason the starter-deck check
 * is: a reward that cannot be paid is a content bug, and the person who should
 * find it is whoever changes the content — not the player who reaches rank 9 of
 * a faction whose Rare pool has two cards in it.
 */
export function checkMasteryData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const factions = Object.values(content.factions).filter((faction) => faction.id !== "neutral");

  const checkTrack = (label: string, config: TrackConfig): void => {
    const last = config.curve[config.curve.length - 1];
    if (!last || last.throughRank < config.ranks) {
      problems.push(`${label}: the curve stops at ${last?.throughRank ?? 0} but the track has ${config.ranks} ranks`);
    }
    for (const key of Object.keys(config.rewards)) {
      const rank = Number(key);
      if (!Number.isInteger(rank) || rank < 1 || rank > config.ranks) {
        problems.push(`${label}: reward for rank "${key}", which is outside 1..${config.ranks}`);
      }
    }
    for (const rewards of Object.values(config.rewards)) {
      for (const reward of rewards) {
        if (reward.kind !== "cosmetic") continue;
        if (!reward.ref && !DEFERRED_COSMETICS.has(reward.cosmetic)) {
          problems.push(`${label}: cosmetic "${reward.cosmetic}" is neither granted nor in DEFERRED_COSMETICS`);
        }
        if (reward.ref && !reward.ref.includes("{id}")) {
          problems.push(`${label}: cosmetic ref "${reward.ref}" has no {id}, so it would grant the same thing on every track`);
        }
      }
    }
  };

  checkTrack("factionMastery", factionMasteryConfig());
  checkTrack("leaderMastery", leaderMasteryConfig());

  const packSize = content.balance.economy.packSize;
  for (const faction of factions) {
    const pool = factionPool(content, faction.id);
    if (pool.length < packSize) {
      problems.push(`${faction.id}: ${pool.length} collectible cards, a Faction Pack needs ${packSize}`);
    }
    if (leadersOfFaction(content, faction.id).length === 0) {
      problems.push(`${faction.id}: no selectable leader, so its Leader Mastery track would be empty`);
    }
    for (const [key, rewards] of Object.entries(factionMasteryConfig().rewards)) {
      for (const reward of rewards) {
        if (reward.kind !== "pick") continue;
        const available = pool.filter((card) => card.rarity === reward.rarity).length;
        if (available < reward.choices) {
          problems.push(
            `${faction.id}: rank ${key} offers ${reward.choices} ${reward.rarity}s and the faction has ${available}`
          );
        }
      }
    }
  }
  return problems;
}
