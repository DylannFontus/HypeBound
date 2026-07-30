/**
 * Evaluating a mission objective against the matches a player has finished.
 *
 * Pure: a list of match outcomes in, progress out. No storage, no clock. The
 * profile keeps the outcome list for the current period and hands it here, so
 * "how far along am I" is always **recomputed from evidence** rather than
 * incremented into a counter.
 *
 * That choice is worth stating, because the incrementing version is easier and
 * this project has been burned by it twice. A counter cannot be re-derived, so a
 * bug in it is permanent and invisible; and a mission issued today would have to
 * decide what to do about matches already played. Recomputing means a rerolled
 * mission starts from the same evidence every other mission sees, and a mission
 * that looks wrong can be checked by replaying the records it was scored from.
 */

import type {
  MatchFilter,
  MatchOutcome,
  MissionProgress,
  Objective,
  Requirement,
  RequirementProgress,
  SumStat,
} from "./types";

/** Human-readable names for the statistics, used on the mission card. */
const STAT_LABEL: Record<SumStat, string> = {
  cardsPlayed: "cards played",
  cardsDrawn: "cards drawn",
  charactersDefeated: "enemy characters defeated",
  damageToEnemyLeader: "damage to enemy leaders",
  healingToFriendlies: "health restored",
  supportsGiven: "friendly characters supported",
  confluencesActivated: "Confluences activated",
  perfectResonances: "Perfect Resonances",
  obsessionGained: "Obsession gained",
  fixationsUsed: "Fixations used",
  ultimatesUsed: "Ultimates used",
  elementalBonusHits: "elemental bonus hits",
  afterpartyTriggers: "Afterparty effects",
  equipmentPlayed: "Equipment played",
  expensiveCardsPlayed: "cards costing 6 or more",
  cancelledApplied: "Cancelled applied",
  negativeStatusesCleared: "negative statuses cleared",
  mostOfOneCurrent: "cards of one Current in a match",
};

/**
 * Does this match count toward the requirement?
 *
 * `modes` matches by prefix so a filter can say "any AI practice match" without
 * enumerating six difficulty tiers, and so a mode gaining a suffix later does
 * not silently stop satisfying missions written against it.
 */
export function matchesFilter(outcome: MatchOutcome, filter?: MatchFilter): boolean {
  if (!filter) return true;
  if (filter.won !== undefined && outcome.stats.won !== filter.won) return false;
  if (filter.modes && !filter.modes.some((mode) => outcome.mode === mode || outcome.mode.startsWith(`${mode}-`))) {
    return false;
  }
  if (filter.primaryCurrents && !filter.primaryCurrents.includes(outcome.stats.primaryCurrent)) return false;
  if (filter.atLeast && outcome.stats[filter.atLeast.stat] < filter.atLeast.value) return false;
  if (filter.deckEditedThisPeriod !== undefined && outcome.deckEditedThisPeriod !== filter.deckEditedThisPeriod) {
    return false;
  }
  /**
   * Mastery filters read the rank stamped at play time, and an outcome with no
   * stamp never qualifies.
   *
   * The stamp is absent on matches recorded before mastery shipped and on any
   * leader with no track. Treating that as "below rank 10" would pay *Second
   * Bias* out of evidence that cannot answer the question — the reason the
   * mission was held back in the first place was that a condition which is
   * always true pays for nothing.
   */
  if (filter.factionMasteryBelow !== undefined) {
    const rank = outcome.masteryAtPlay?.faction;
    if (rank === undefined || rank >= filter.factionMasteryBelow) return false;
  }
  if (filter.leaderMasteryBelow !== undefined) {
    const rank = outcome.masteryAtPlay?.leader;
    if (rank === undefined || rank >= filter.leaderMasteryBelow) return false;
  }
  return true;
}

/** The value a `distinct` requirement groups on. */
const distinctKey = (outcome: MatchOutcome, of: "faction" | "primaryCurrent" | "mode"): string => {
  if (of === "faction") return outcome.stats.factionId;
  if (of === "primaryCurrent") return outcome.stats.primaryCurrent;
  // the base mode, so `ai-casual` and `ai-expert` are one mode rather than two
  return outcome.mode.split("-")[0] ?? outcome.mode;
};

function requirementProgress(requirement: Requirement, outcomes: readonly MatchOutcome[]): RequirementProgress {
  const qualifying = outcomes.filter((outcome) => matchesFilter(outcome, requirement.filter));

  if (requirement.need === "sum") {
    const have = qualifying.reduce((total, outcome) => total + outcome.stats[requirement.stat], 0);
    return { label: STAT_LABEL[requirement.stat], have, need: requirement.target };
  }
  if (requirement.need === "matches") {
    const won = requirement.filter?.won === true;
    return { label: won ? "matches won" : "matches played", have: qualifying.length, need: requirement.target };
  }
  const distinct = new Set(qualifying.map((outcome) => distinctKey(outcome, requirement.of)).filter(Boolean));
  const label =
    requirement.of === "faction" ? "different factions" : requirement.of === "mode" ? "different modes" : "different Currents";
  return { label, have: distinct.size, need: requirement.target };
}

/**
 * How far along an objective is.
 *
 * For `all`, the fraction is the *least* complete requirement — a mission that
 * needs four wins across two factions is not 90% done because the wins are
 * there. For `any`, it is the most complete one, which is what an "or" means.
 */
export function progressFor(objective: Objective, outcomes: readonly MatchOutcome[]): MissionProgress {
  const requirements = objective.all ?? objective.any ?? [];
  const parts = requirements.map((requirement) => requirementProgress(requirement, outcomes));
  if (parts.length === 0) return { parts, fraction: 0, complete: false };

  const fractions = parts.map((part) => (part.need <= 0 ? 1 : Math.min(1, part.have / part.need)));
  if (objective.any) {
    const fraction = Math.max(...fractions);
    return { parts, fraction, complete: fraction >= 1 };
  }
  const fraction = Math.min(...fractions);
  return { parts, fraction, complete: fraction >= 1 };
}

/** Convenience wrapper — the screen and the claim path both ask this. */
export const isComplete = (objective: Objective, outcomes: readonly MatchOutcome[]): boolean =>
  progressFor(objective, outcomes).complete;
