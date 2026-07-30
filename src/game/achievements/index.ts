/**
 * Achievements — `08-progression.md` §9.
 *
 * One-time objectives with points, Clout, Fragments and, for the memorable ones,
 * titles and profile frames. No rotation, no reset clock: an achievement is
 * earned once and stays earned.
 *
 * ## Why this is an accumulator, and missions are not
 *
 * Mission progress is **recomputed from evidence** — a bounded log of finished
 * matches — so any claim can be re-derived and audited. That is the better
 * design and it is not available here. The log holds 200 matches and is pruned
 * to the oldest held mission's window; *"complete 500 matches"* and *"activate
 * all 9 Confluences (lifetime)"* both reach back further than it goes.
 *
 * So achievements keep a running tally, credited once per finished match, in the
 * same shape and for the same reason Faction Mastery does. The cost is the one
 * mastery already pays: there is nothing to recompute from, so the credit has to
 * be right the first time.
 *
 * Two consequences worth stating, because both are deliberate:
 *
 * **Everything gets tallied, not just what an achievement asks about today.**
 * Twenty-nine per-match statistics go into the tally and roughly a third are
 * read. That looks like waste and is the opposite: an accumulator cannot
 * reconstruct history, so a statistic that is not banked today can never be
 * asked about retroactively. An achievement added next month would start every
 * existing account at zero. Fifty-eight small numbers in `localStorage` is a
 * cheap price for not doing that to people.
 *
 * **A requirement may only read the four kinds below.** Anything that cannot be
 * phrased as a lifetime total, a single-match best, a count of distinct values,
 * or a fact about the account is an achievement that cannot be verified — and
 * this project has shipped enough rewards that quietly failed to track.
 */

import type { ContentIndex } from "../../engine/types";
import type { MatchStats } from "../missions/stats";
import { cosmeticById } from "../cosmetics";
import {
  achievementsData,
  type AchievementDef,
  type AchievementRequirement,
  type AchievementReward,
  type PointMilestone,
} from "./data";

export { achievementsData, resetAchievementsData, AchievementsDataError } from "./data";
export type {
  AchievementCategory,
  AchievementDef,
  AchievementRequirement,
  AchievementReward,
  PointMilestone,
} from "./data";

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

/**
 * The per-match statistics banked into the tally.
 *
 * Typed against `MatchStats` below, so a rename in the deriver is a compile
 * error here rather than an achievement that silently stops advancing.
 */
export const TALLIED_STATS = [
  "cardsPlayed",
  "cardsDrawn",
  "charactersDefeated",
  "damageToEnemyLeader",
  "healingToFriendlies",
  "supportsGiven",
  "confluencesActivated",
  "perfectResonances",
  "obsessionGained",
  "fixationsUsed",
  "ultimatesUsed",
  "elementalBonusHits",
  "afterpartyTriggers",
  "equipmentPlayed",
  "expensiveCardsPlayed",
  "cancelledApplied",
  "negativeStatusesCleared",
  "mostOfOneCurrent",
  "fullFixations",
  "charactersBanished",
  "leaderDamageTaken",
  "fatigueTaken",
  "reactionsTriggered",
  "elementalBonusDamage",
  "mostLeaderDamageInATurn",
  "widestWinningBoard",
  "flawlessWin",
  "burnoutWin",
  "shutoutWin",
] as const;

export type TalliedStat = (typeof TALLIED_STATS)[number];

/** Compile-time proof that every tallied name is a real numeric statistic. */
const _statsExist: readonly (keyof MatchStats)[] = TALLIED_STATS;
void _statsExist;

/**
 * Counters that are not statistics of a match but facts about having played one.
 *
 * `bossWins` is here rather than as a match filter because achievements have no
 * filter vocabulary at all — deliberately. Missions need filters because they
 * are scored over a window and rerolled; an achievement is a single lifetime
 * number, and giving it a filter language would be building a second, subtly
 * different copy of the mission objective compiler.
 */
export const MATCH_COUNTERS = ["matches", "wins", "bossWins"] as const;
export type MatchCounter = (typeof MATCH_COUNTERS)[number];

/** Everything a `total` or `best` requirement may name. */
export const TOTAL_STATS: readonly string[] = [...TALLIED_STATS, ...MATCH_COUNTERS];

/**
 * The distinct-value dimensions.
 *
 * A count cannot answer any of these. *Weather Machine* wants all nine
 * Confluences, not nine activations; *Multifandom Menace* wants ten factions,
 * not ten wins.
 */
export const SET_DIMENSIONS = ["factionsWon", "confluences", "modes"] as const;
export type SetDimension = (typeof SET_DIMENSIONS)[number];

/**
 * Facts about the account rather than about matches.
 *
 * Assembled by the save layer and passed in, so this module stays pure and can
 * be tested against a literal. Reading the profile from here would also make
 * `roguelikeRunsCleared` — which lives in the Doomscroll's own store — a reason
 * for the achievements module to import a second save file.
 */
export const ACCOUNT_FACTS = [
  "distinctCards",
  "cosmeticsOwned",
  "legendariesCrafted",
  "accountLevel",
  "bestFactionMastery",
  "bestLeaderMastery",
  "bestAffinityTier",
  "roguelikeRunsCleared",
  "matchesSpectated",
] as const;
export type AccountFact = (typeof ACCOUNT_FACTS)[number];

export type AccountFacts = Record<AccountFact, number>;

/**
 * Facts the game cannot actually compute yet, and why.
 *
 * The same justified-allowlist bargain `DEFERRED_COSMETICS` makes: an
 * achievement reading one of these can never complete, so rather than let it sit
 * on the screen looking merely difficult, it is labelled with the reason. The
 * companion test asserts each entry is still true — the day spectating ships,
 * whoever wires it has to delete the line here to make the number move, and the
 * achievement becomes earnable in the same commit.
 */
export const DEFERRED_FACTS: ReadonlyMap<AccountFact, string> = new Map([
  ["matchesSpectated", "no spectating — it needs the server, along with friends, guilds and the rest of §12"],
]);

// ---------------------------------------------------------------------------
// The tally
// ---------------------------------------------------------------------------

export interface AchievementTally {
  /** lifetime sums, by statistic name */
  totals: Record<string, number>;
  /** the largest single-match value ever seen, by statistic name */
  bests: Record<string, number>;
  /** distinct values seen, by dimension */
  sets: Record<string, string[]>;
}

export const emptyTally = (): AchievementTally => ({ totals: {}, bests: {}, sets: {} });

/** The base mode, so `ai-casual` and `ai-expert` are one mode rather than two. */
export const baseMode = (mode: string): string => mode.split("-")[0] ?? mode;

/**
 * Bank one finished match.
 *
 * Writes into the tally it is given rather than returning a new one, because the
 * caller is a save-store draft and copying it back would be a second place for
 * the two to disagree. Nothing else here touches storage or the clock.
 *
 * Idempotency is the caller's problem, and it matters: calling this twice for
 * one match double-counts, and there is nothing to re-derive from. `recordMatch`
 * is the only call site, and it runs once per finished match.
 */
export function creditMatch(tally: AchievementTally, stats: MatchStats, mode: string): void {
  const add = (key: string, amount: number): void => {
    if (amount <= 0) return;
    tally.totals[key] = (tally.totals[key] ?? 0) + amount;
  };
  const best = (key: string, value: number): void => {
    if (value <= 0) return;
    tally.bests[key] = Math.max(tally.bests[key] ?? 0, value);
  };
  const see = (dimension: SetDimension, value: string): void => {
    if (!value) return;
    const seen = (tally.sets[dimension] ??= []);
    if (!seen.includes(value)) seen.push(value);
  };

  for (const stat of TALLIED_STATS) {
    const value = stats[stat];
    add(stat, value);
    best(stat, value);
  }

  const base = baseMode(mode);
  add("matches", 1);
  if (stats.won) {
    add("wins", 1);
    if (base === "boss") add("bossWins", 1);
    see("factionsWon", stats.factionId);
  }
  see("modes", base);
  for (const confluence of stats.confluencesUsed) see("confluences", confluence);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const achievementKey = (id: string): string => `ach:${id}`;
export const milestoneKey = (points: number): string => `points:${points}`;

/**
 * Can this reward be handed over today?
 *
 * Identical rule to Mastery's, for the identical reason: for a cosmetic the
 * answer is whether it names a `ref` that resolves, which is the same fact the
 * granting code acts on. What a row offers and what it pays cannot disagree.
 */
export const isGrantable = (reward: AchievementReward): boolean =>
  reward.kind !== "cosmetic" || Boolean(reward.ref);

/** The deferred fact an achievement depends on, or null when it is earnable. */
export function deferralOf(def: AchievementDef): string | null {
  if (def.requirement.need !== "account") return null;
  return DEFERRED_FACTS.get(def.requirement.of as AccountFact) ?? null;
}

/** How far along one requirement is. */
export function haveFor(
  requirement: AchievementRequirement,
  tally: AchievementTally,
  account: AccountFacts
): number {
  switch (requirement.need) {
    case "total":
      return tally.totals[requirement.stat] ?? 0;
    case "best":
      return tally.bests[requirement.stat] ?? 0;
    case "distinct":
      return (tally.sets[requirement.of] ?? []).length;
    case "account":
      return account[requirement.of as AccountFact] ?? 0;
  }
}

export interface AchievementView {
  def: AchievementDef;
  have: number;
  need: number;
  unlocked: boolean;
  claimed: boolean;
  claimable: boolean;
  /** why this cannot be earned yet, or null */
  deferred: string | null;
  /** a Hidden-category entry nobody has unlocked yet, shown as ??? */
  concealed: boolean;
}

export function achievementViews(
  tally: AchievementTally,
  account: AccountFacts,
  claimed: readonly string[]
): AchievementView[] {
  const done = new Set(claimed);
  return achievementsData().achievements.map((def) => {
    const have = haveFor(def.requirement, tally, account);
    const need = def.requirement.target;
    const unlocked = have >= need;
    const wasClaimed = done.has(achievementKey(def.id));
    return {
      def,
      have: Math.min(have, need),
      need,
      unlocked,
      claimed: wasClaimed,
      claimable: unlocked && !wasClaimed && def.rewards.some(isGrantable),
      deferred: deferralOf(def),
      concealed: def.category === "hidden" && !unlocked,
    };
  });
}

/**
 * Achievement points earned.
 *
 * Counted from what is **unlocked**, not from what is claimed. Doing the thing
 * is what earns the trophy; the Claim button only pays the Clout. Otherwise a
 * player who never opened the screen would find the point milestones locked
 * behind a chore they did not know existed.
 */
export const pointsFrom = (views: readonly AchievementView[]): number =>
  views.reduce((total, view) => total + (view.unlocked ? view.def.points : 0), 0);

/** Every point achievable by an account that never goes online. */
export const reachablePoints = (): number =>
  achievementsData()
    .achievements.filter((def) => deferralOf(def) === null)
    .reduce((total, def) => total + def.points, 0);

export interface MilestoneView {
  milestone: PointMilestone;
  have: number;
  unlocked: boolean;
  claimed: boolean;
  claimable: boolean;
}

export function milestoneViews(points: number, claimed: readonly string[]): MilestoneView[] {
  const done = new Set(claimed);
  return achievementsData().milestones.map((milestone) => {
    const unlocked = points >= milestone.points;
    const wasClaimed = done.has(milestoneKey(milestone.points));
    return {
      milestone,
      have: Math.min(points, milestone.points),
      unlocked,
      claimed: wasClaimed,
      claimable: unlocked && !wasClaimed && isGrantable(milestone.reward),
    };
  });
}

/** What the lobby badge counts. */
export const unclaimedCount = (views: readonly AchievementView[], milestones: readonly MilestoneView[]): number =>
  views.filter((view) => view.claimable).length + milestones.filter((view) => view.claimable).length;

// ---------------------------------------------------------------------------
// Data checks
// ---------------------------------------------------------------------------

/**
 * Everything wrong with `data/achievements.json`, checked against real content.
 *
 * The schema proves the file is well-formed. This proves it is *true*: that
 * every statistic named exists, every cosmetic promised resolves, and every
 * point milestone can actually be reached by the achievements that ship.
 */
export function checkAchievementsData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = achievementsData();
  const categories = new Set(data.categories.map((category) => category.id));
  const totals = new Set(TOTAL_STATS);
  const dimensions = new Set<string>(SET_DIMENSIONS);
  const facts = new Set<string>(ACCOUNT_FACTS);

  const seen = new Set<string>();
  for (const def of data.achievements) {
    const label = def.id;
    if (seen.has(def.id)) problems.push(`${label}: duplicate id`);
    seen.add(def.id);
    if (!categories.has(def.category)) problems.push(`${label}: no such category "${def.category}"`);

    const requirement = def.requirement;
    if (requirement.need === "total" || requirement.need === "best") {
      if (!totals.has(requirement.stat)) problems.push(`${label}: "${requirement.stat}" is not a tallied statistic`);
    } else if (requirement.need === "distinct") {
      if (!dimensions.has(requirement.of)) problems.push(`${label}: "${requirement.of}" is not a set dimension`);
    } else if (!facts.has(requirement.of)) {
      problems.push(`${label}: "${requirement.of}" is not an account fact`);
    }

    /**
     * A hint is what a Hidden achievement shows instead of its text, so one on
     * any other category is a string nothing ever renders, and a Hidden entry
     * without one shows "???" and nothing else — which is not a secret, it is a
     * bug that looks like a secret.
     */
    if (def.category === "hidden" && !def.hint) problems.push(`${label}: a hidden achievement with no hint`);
    if (def.category !== "hidden" && def.hint) problems.push(`${label}: only hidden achievements show a hint`);

    if (def.rewards.length === 0) problems.push(`${label}: pays nothing at all`);
    for (const reward of def.rewards) {
      if (reward.kind !== "cosmetic") continue;
      if (!reward.ref) {
        problems.push(`${label}: cosmetic "${reward.name}" names no ref, so claiming it would pay nothing`);
        continue;
      }
      if (!cosmeticById(content, reward.ref)) problems.push(`${label}: "${reward.ref}" resolves to no cosmetic`);
    }
  }

  for (const category of data.categories) {
    if (!data.achievements.some((def) => def.category === category.id)) {
      problems.push(`category ${category.id}: no achievement uses it`);
    }
  }

  /**
   * A milestone nobody can reach is an invisible reward.
   *
   * §9 puts frames at 250 / 500 / 1,000 points. Whichever of those the shipped
   * set can actually reach are listed in the file; this is what makes the
   * omission of the rest self-reporting rather than a silent decision — add
   * enough achievements and nothing complains, list one too early and it does.
   */
  const reachable = reachablePoints();
  for (const milestone of data.milestones) {
    if (milestone.points > reachable) {
      problems.push(
        `milestone ${milestone.points}: only ${reachable} points are reachable offline, so nobody can ever claim it`
      );
    }
    if (milestone.reward.kind === "cosmetic") {
      if (!milestone.reward.ref) problems.push(`milestone ${milestone.points}: cosmetic names no ref`);
      else if (!cosmeticById(content, milestone.reward.ref)) {
        problems.push(`milestone ${milestone.points}: "${milestone.reward.ref}" resolves to no cosmetic`);
      }
    }
  }

  return problems;
}
