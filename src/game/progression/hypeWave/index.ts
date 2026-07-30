/**
 * The Hype Wave — the seasonal battle pass, `08-progression.md` §10.
 *
 * Fifty tiers fed by the account's own XP stream: no separate currency, no
 * separate grind. A match and a mission already pay XP; the pass is what that XP
 * does over a season.
 *
 * Pure — a state object and a clock reading in, views out. No storage, no DOM,
 * and no `Date.now()`: every function that cares about time takes `now`, because
 * a season boundary is exactly the kind of thing that is impossible to test if
 * the module reads the clock itself.
 *
 * ## The four rules §10.6 makes binding
 *
 * **Nothing expires.** A season ending converts an unfinished pass to an
 * **Archive Pass**, which keeps earning at half rate until tier 50 — forever.
 * Not "for a grace period". `advance()` credits every archive on the same XP the
 * live pass gets, which is why archives are a list rather than one slot: a
 * player who misses two seasons has two unfinished passes, and quietly dropping
 * the older one would take rewards away.
 *
 * **Falling behind is recoverable, automatically.** Wave Rebound (§10.5.1) pays
 * +50% while your tier is under the pace line of five tiers per completed week.
 * It needs no button and is never announced as urgency.
 *
 * **Every tier pays something.** A tier with no entry in the tables pays the
 * filler — 75 Clout on the free track. There are no dead tiers.
 *
 * **The pacing is a calibration, not a guess.** §10.6.8 makes it release-
 * blocking: the pass must complete comfortably below 40 min/day. `xpPerTier` is
 * therefore derived from what the shipped game actually pays, and the test
 * re-derives §10.4's three player models from the same constants.
 */

import type { CardDef, ContentIndex } from "../../../engine/types";
import { nextInt, seedRng } from "../../../engine/rng";
import { cosmeticById } from "../../cosmetics";
import { hypeWaveData, type PassReward, type SeasonDef } from "./data";

export { hypeWaveData, resetHypeWaveData, HypeWaveDataError } from "./data";
export type { PassReward, SeasonDef } from "./data";

export type PassTrack = "free" | "backstage";

const WEEK_MS = 604_800_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export const seasonStart = (season: SeasonDef): number => Date.parse(season.startAt);
export const seasonEnd = (season: SeasonDef): number => seasonStart(season) + season.weeks * WEEK_MS;

/** The season `now` falls inside, or null between seasons and before the first. */
export function seasonAt(now: number): SeasonDef | null {
  return hypeWaveData().seasons.find((season) => now >= seasonStart(season) && now < seasonEnd(season)) ?? null;
}

export const seasonById = (id: string): SeasonDef | null =>
  hypeWaveData().seasons.find((season) => season.id === id) ?? null;

/**
 * Completed weeks of a season, for the Rebound pace line.
 *
 * Floored and clamped: in week one nothing is behind, and after the season's
 * last week the pace line stops climbing rather than demanding tiers that do not
 * exist.
 */
export function weeksElapsed(season: SeasonDef, now: number): number {
  const elapsed = Math.floor((now - seasonStart(season)) / WEEK_MS);
  return Math.max(0, Math.min(season.weeks, elapsed));
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface TierState {
  /** the tier reached, 0 before the first */
  tier: number;
  /** XP banked into the current tier */
  intoTier: number;
  /** XP one tier costs */
  perTier: number;
  /** true at the last numbered tier and beyond */
  complete: boolean;
  /** whole tiers earned past 50 — §10.1's endless Encore */
  encore: number;
}

export function tierFor(xp: number): TierState {
  const { tiers, xpPerTier } = hypeWaveData();
  const banked = Math.max(0, Math.floor(xp));
  const reached = Math.floor(banked / xpPerTier);
  const tier = Math.min(tiers, reached);
  return {
    tier,
    intoTier: reached >= tiers ? 0 : banked % xpPerTier,
    perTier: xpPerTier,
    complete: reached >= tiers,
    encore: Math.max(0, reached - tiers),
  };
}

/** The XP a given tier is reached at. */
export const xpForTier = (tier: number): number => tier * hypeWaveData().xpPerTier;

/**
 * The pace line — the tier a player is "on pace" for (§10.5.1).
 *
 * Five tiers per **completed** week, so somebody in week one is never behind.
 */
export function paceLine(season: SeasonDef, now: number): number {
  const { rebound, tiers } = hypeWaveData();
  return Math.min(tiers, weeksElapsed(season, now) * rebound.tiersPerWeek);
}

export type Pacing = "ahead" | "on-pace" | "rebound";

/**
 * How the pass describes where you are — §10.6.4's calm state, never a countdown.
 *
 * `forcedRebound` is the Welcome Back package (§10.5.4) turning Rebound on for a
 * week regardless of pace, which is the one case where somebody who is *ahead*
 * still earns the bonus.
 */
export function pacingOf(tier: number, season: SeasonDef, now: number, forcedRebound = false): Pacing {
  if (forcedRebound) return "rebound";
  const pace = paceLine(season, now);
  if (tier < pace) return "rebound";
  return tier > pace ? "ahead" : "on-pace";
}

/** The multiplier XP is credited at, per §10.5.1. */
export function reboundMultiplier(pacing: Pacing): number {
  return pacing === "rebound" ? 1 + hypeWaveData().rebound.bonus : 1;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/** What a tier pays on a track, filler included. */
export function rewardsAt(track: PassTrack, tier: number): PassReward[] {
  const data = hypeWaveData();
  if (tier < 1 || tier > data.tiers) return [];
  const table = track === "free" ? data.free : data.backstage;
  return table[String(tier)] ?? [track === "free" ? data.freeFiller : data.backstageFiller];
}

/**
 * Rewards the pass promises but cannot pay, and why.
 *
 * The same justified-allowlist bargain `DEFERRED_COSMETICS` and `DEFERRED_FACTS`
 * make. §10.3's Backstage track is largely things this build has no system for,
 * and they are kept in the data so the track shows what it will be rather than
 * pretending it is shorter than it is. Keyed by the reward's own name, because
 * that is what the screen prints next to the reason.
 *
 * The companion test asserts each entry is still un-grantable — a name that
 * gained a `ref` has to leave this list, in the same commit that gave it one.
 */
export const DEFERRED_PASS: ReadonlyMap<string, string> = new Map([
  ["Seasonal leader skin", "no leader skin system — card art is procedural and keyed by card id alone"],
  ["Evolved leader skin", "same blocker as the base skin, plus nothing animates a leader portrait"],
  ["Seasonal battlefield", "the 3D board has one dressing and no way to vary it"],
  ["Animated profile portrait", "no alternate-portrait system, and no animation layer for one"],
  ["Seasonal music pack", "no audio files — the manifest is wired and every slot is empty"],
  ["Alternate-art variant of a featured Legendary", "no Premium variant rendering; `variantOf` exists, nothing grants one"],
  ["Seasonal Event Variant of a featured card", "same blocker — a rules-identical variant needs variant art"],
  ["Animated upgrade of the tier-1 card back", "card backs are drawn to a static texture; nothing animates one"],
  ["Minor seasonal cosmetic", "poses and other minor cosmetics have no system; the card-back tints that do are granted"],
  [
    "Welcome Back mission slots",
    "§10.5.4's pre-banked dailies and extra weekly slot need the rotation to accept granted missions, which it cannot express",
  ],
]);

/**
 * Can this reward be handed over today?
 *
 * For a cosmetic the answer is whether it names a `ref` — the same fact the
 * granting code acts on, so what a tier offers and what it pays cannot disagree.
 */
export const isGrantable = (reward: PassReward): boolean =>
  reward.kind !== "cosmetic" || Boolean(reward.ref);

/** Resolve a reward's `{season}` placeholder to a real cosmetic id. */
export const refFor = (reward: PassReward, seasonId: string): string | null =>
  reward.kind === "cosmetic" && reward.ref ? reward.ref.replace("{season}", seasonId) : null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One pass — the live season's, or an archived one. */
export interface PassState {
  seasonId: string;
  xp: number;
  claimedFree: number[];
  claimedBackstage: number[];
  /** Encore tiers already paid out; §10.1 makes them endless, so this is a count */
  encoreClaimed: number;
  backstage: boolean;
}

export const emptyPass = (seasonId: string): PassState => ({
  seasonId,
  xp: 0,
  claimedFree: [],
  claimedBackstage: [],
  encoreClaimed: 0,
  backstage: false,
});

/** Is this pass finished, and therefore no longer worth archiving? */
export const passComplete = (pass: PassState): boolean => tierFor(pass.xp).complete;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface TierRow {
  tier: number;
  free: PassReward[];
  backstage: PassReward[];
  unlocked: boolean;
  freeClaimed: boolean;
  backstageClaimed: boolean;
  freeClaimable: boolean;
  backstageClaimable: boolean;
  /** the pace line runs through this tier — the screen draws a marker */
  onPaceLine: boolean;
}

export interface PassView {
  season: SeasonDef;
  /** null for an Archive Pass, which has no live pace line */
  live: boolean;
  state: TierState;
  pacing: Pacing;
  paceLine: number;
  multiplier: number;
  backstage: boolean;
  backstagePrice: number;
  tierSkipPrice: number;
  rows: TierRow[];
  /** Encore tiers earned but not yet collected, and what each pays */
  encoreOwed: number;
  encoreClout: number;
  /** how many claims are waiting, for the lobby badge */
  unclaimed: number;
}

export function passView(pass: PassState, now: number, options: { forcedRebound?: boolean } = {}): PassView | null {
  const data = hypeWaveData();
  const season = seasonById(pass.seasonId);
  if (!season) return null;

  const live = now >= seasonStart(season) && now < seasonEnd(season);
  const state = tierFor(pass.xp);
  const pacing = live ? pacingOf(state.tier, season, now, options.forcedRebound) : "on-pace";
  const claimedFree = new Set(pass.claimedFree);
  const claimedBackstage = new Set(pass.claimedBackstage);
  const pace = live ? paceLine(season, now) : 0;

  const rows: TierRow[] = [];
  for (let tier = 1; tier <= data.tiers; tier++) {
    const free = rewardsAt("free", tier);
    const backstage = rewardsAt("backstage", tier);
    const unlocked = state.tier >= tier;
    const freeClaimed = claimedFree.has(tier);
    const backstageClaimed = claimedBackstage.has(tier);
    rows.push({
      tier,
      free,
      backstage,
      unlocked,
      freeClaimed,
      backstageClaimed,
      freeClaimable: unlocked && !freeClaimed && free.some(isGrantable),
      /**
       * The Backstage column is claimable only for an owner. Buying the pass
       * later makes every already-earned tier claimable at once, which is
       * §10.1's retro-claim — it needs no separate code path precisely because
       * claimability is recomputed rather than stamped at unlock time.
       */
      backstageClaimable: pass.backstage && unlocked && !backstageClaimed && backstage.some(isGrantable),
      onPaceLine: live && tier === pace,
    });
  }

  const unclaimed =
    rows.filter((row) => row.freeClaimable).length +
    rows.filter((row) => row.backstageClaimable).length +
    Math.max(0, state.encore - pass.encoreClaimed);

  return {
    season,
    live,
    state,
    pacing,
    paceLine: pace,
    multiplier: reboundMultiplier(pacing),
    backstage: pass.backstage,
    backstagePrice: data.backstagePrice,
    tierSkipPrice: data.tierSkipPrice,
    rows,
    encoreOwed: Math.max(0, state.encore - pass.encoreClaimed),
    encoreClout: data.encoreClout,
    unclaimed,
  };
}

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

/**
 * How much pass XP an amount of account XP is worth to one pass.
 *
 * The live pass takes it at full rate, with Rebound applied when behind; an
 * Archive Pass takes it at `archiveRate` and never gets Rebound — it has no
 * season to be behind in. A completed pass takes nothing, so a finished archive
 * costs nothing to keep in the list.
 */
export function creditFor(
  pass: PassState,
  xp: number,
  now: number,
  options: { forcedRebound?: boolean } = {}
): number {
  const data = hypeWaveData();
  const season = seasonById(pass.seasonId);
  if (!season || xp <= 0) return 0;

  const live = now >= seasonStart(season) && now < seasonEnd(season);
  if (!live) {
    // an archive still climbs to 50, and stops there
    return passComplete(pass) ? 0 : Math.round(xp * data.archiveRate);
  }
  const pacing = pacingOf(tierFor(pass.xp).tier, season, now, options.forcedRebound);
  return Math.round(xp * reboundMultiplier(pacing));
}

/**
 * The threshold §10.5's guarantee is stated at, re-derived from shipped numbers.
 *
 * §10.5.1 asserts a specific figure ("any player averaging ≥3,400 XP/week")
 * against the design's 50,000-XP pass. The shipped pass costs less, so the true
 * threshold is lower — and computed rather than repeated, because a number
 * copied out of a document is a number that stops being true silently.
 */
export function reboundGuaranteeXpPerWeek(seasonWeeks: number): number {
  const data = hypeWaveData();
  const total = data.tiers * data.xpPerTier;
  return Math.ceil(total / ((1 + data.rebound.bonus) * seasonWeeks));
}

/** Has this account been away long enough for the Welcome Back package (§10.5.4)? */
export function welcomeBackDue(lastSeenAt: number, now: number): boolean {
  if (!lastSeenAt) return false;
  return now - lastSeenAt >= hypeWaveData().welcomeBack.afterDays * DAY_MS;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

/**
 * The cards a pass "pick 1 of N" offers.
 *
 * Drawn from the **whole** collectible pool rather than one faction's, which is
 * the difference between a pass pick and a Mastery pick and is the point of it:
 * a Mastery rank rewards devotion to a faction, and a season pays everybody the
 * same thing regardless of what they main.
 *
 * Deterministic in the season, the tier and the rarity — the same three cards on
 * every render and after every reload, and the same three for every player,
 * which is what makes "pick 1 of 3 Rares" a decision rather than a roll.
 */
export function passPickCandidates(
  content: ContentIndex,
  seasonId: string,
  tier: number,
  rarity: string,
  count: number
): CardDef[] {
  const pool = Object.values(content.cards)
    .filter((card) => !card.token && !card.variantOf && card.rarity === rarity && card.type !== "leader")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (pool.length <= count) return pool;

  const rng = seedRng(hashSeed(`hypewave:${seasonId}:${tier}:${rarity}`));
  const remaining = pool.slice();
  const chosen: CardDef[] = [];
  while (chosen.length < count && remaining.length > 0) {
    chosen.push(remaining.splice(nextInt(rng, remaining.length), 1)[0]!);
  }
  return chosen.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Is `cardId` one of the cards this tier's pick actually offers? */
export const canPassPick = (
  content: ContentIndex,
  seasonId: string,
  tier: number,
  rarity: string,
  count: number,
  cardId: string
): boolean => passPickCandidates(content, seasonId, tier, rarity, count).some((card) => card.id === cardId);

/**
 * FNV-1a, the same stable string hash the Mastery picks use.
 *
 * Duplicated deliberately rather than exported across modules: it is six lines,
 * and the alternative is `mastery.ts` and the pass depending on each other for a
 * hash function neither of them owns.
 */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Data checks
// ---------------------------------------------------------------------------

/**
 * Everything wrong with `data/hype-wave.json`, checked against real content.
 *
 * The schema proves the file is well-formed. This proves it is *true*: that the
 * seasons do not overlap or leave gaps, that every cosmetic promised resolves,
 * that nothing un-grantable is missing a written reason, and that no tier is
 * dead.
 */
export function checkHypeWaveData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = hypeWaveData();

  const seasons = [...data.seasons].sort((a, b) => seasonStart(a) - seasonStart(b));
  const seen = new Set<string>();
  for (const season of seasons) {
    if (seen.has(season.id)) problems.push(`season ${season.id}: duplicate id`);
    seen.add(season.id);
    if (!Number.isFinite(seasonStart(season))) problems.push(`season ${season.id}: unparsable startAt`);
  }
  for (let i = 1; i < seasons.length; i++) {
    const previous = seasons[i - 1]!;
    const next = seasons[i]!;
    if (seasonStart(next) < seasonEnd(previous)) {
      problems.push(`season ${next.id} starts before ${previous.id} has finished`);
    }
    /**
     * A gap between seasons is allowed — the pass says "between seasons" and the
     * archives keep paying — but it should be deliberate rather than an
     * off-by-one in somebody's date arithmetic, so it is reported.
     */
    if (seasonStart(next) > seasonEnd(previous)) {
      const days = Math.round((seasonStart(next) - seasonEnd(previous)) / DAY_MS);
      problems.push(`${days}-day gap between ${previous.id} and ${next.id}`);
    }
  }

  const checkTable = (track: PassTrack, table: Record<string, PassReward[]>): void => {
    for (const key of Object.keys(table)) {
      const tier = Number(key);
      if (!Number.isInteger(tier) || tier < 1 || tier > data.tiers) {
        problems.push(`${track} tier ${key}: outside 1..${data.tiers}`);
      }
      if ((table[key] ?? []).length === 0) problems.push(`${track} tier ${key}: pays nothing`);
    }
  };
  checkTable("free", data.free);
  checkTable("backstage", data.backstage);

  /**
   * §10.2 is explicit that cards, packs, wildcards and Glimmer are free-track
   * only, and §10.3 that the Backstage Pass is cosmetic-only. Glimmer is the
   * stated exception on the premium track — the design puts it there itself, so
   * the pass partially funds the next one.
   */
  for (const [tier, rewards] of Object.entries(data.backstage)) {
    for (const reward of rewards) {
      if (reward.kind !== "cosmetic" && reward.kind !== "glimmer") {
        problems.push(`backstage tier ${tier}: pays ${reward.kind}, but the Backstage Pass is cosmetic-only`);
      }
    }
  }

  for (const season of data.seasons) {
    for (const track of ["free", "backstage"] as PassTrack[]) {
      for (let tier = 1; tier <= data.tiers; tier++) {
        for (const reward of rewardsAt(track, tier)) {
          if (reward.kind !== "cosmetic") continue;
          const ref = refFor(reward, season.id);
          if (!ref) {
            if (!DEFERRED_PASS.has(reward.name)) {
              problems.push(`${track} tier ${tier}: "${reward.name}" is neither granted nor in DEFERRED_PASS`);
            }
            continue;
          }
          if (!cosmeticById(content, ref)) {
            problems.push(`${track} tier ${tier}: "${ref}" resolves to no cosmetic in ${season.id}`);
          }
        }
      }
    }
  }

  return problems;
}
