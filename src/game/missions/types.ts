/**
 * The mission objective vocabulary.
 *
 * `08-progression.md` §7.1 and §8.1 list 28 missions in prose — "defeat 8 enemy
 * characters", "win 4 matches using at least 2 different factions". This is the
 * small language those sentences compile into, and it is deliberately small:
 * three requirement kinds cover every entry in both pools, and a new mission is
 * a line of JSON rather than a line of code.
 *
 * A requirement reads either a **per-match statistic** (`MatchStats`, derived by
 * `stats.ts` from the replayed record) or a **property of the match itself**
 * (won, mode, the leader's faction and Current). Nothing else is available, on
 * purpose: an objective that needs to know something the record cannot answer is
 * an objective that cannot be verified, and this project has been bitten enough
 * by rewards that quietly fail to track.
 */

import type { CurrentId } from "../../engine/types";
import type { MatchStats } from "./stats";

/** The `MatchStats` fields a mission may total up across matches. */
export type SumStat =
  | "cardsPlayed"
  | "cardsDrawn"
  | "charactersDefeated"
  | "damageToEnemyLeader"
  | "healingToFriendlies"
  | "supportsGiven"
  | "confluencesActivated"
  | "perfectResonances"
  | "obsessionGained"
  | "fixationsUsed"
  | "ultimatesUsed"
  | "elementalBonusHits"
  | "afterpartyTriggers"
  | "equipmentPlayed"
  | "expensiveCardsPlayed"
  | "cancelledApplied"
  | "negativeStatusesCleared"
  | "mostOfOneCurrent";

/** Every `SumStat`, as a value — the coverage test walks this. */
export const SUM_STATS: readonly SumStat[] = [
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
] as const;

/** Which matches a requirement looks at. Omitted fields mean "any". */
export interface MatchFilter {
  won?: boolean;
  /** the mode string `recordMatch` stored, matched by prefix so `ai-casual` matches `ai` */
  modes?: string[];
  /** the leader's primary Current must be one of these */
  primaryCurrents?: CurrentId[];
  /** at least this much of a statistic **in a single match** */
  atLeast?: { stat: SumStat; value: number };
  /** the deck was created or edited within the mission's own window */
  deckEditedThisPeriod?: boolean;
  /**
   * The faction's Mastery rank was below this **when the match was played**.
   *
   * §8.1's *Second Bias* — "win 3 matches with a faction below Faction Mastery
   * rank 10". The rank is a property of the match, not of the account, and it
   * has to be: it climbs while you play, so scoring against today's rank would
   * make matches stop counting retroactively and a mission you had half finished
   * would walk backwards. So the rank is stamped on the outcome at play time,
   * exactly like `deckEditedThisPeriod`, and read from there.
   */
  factionMasteryBelow?: number;
  /** the leader's Mastery level was below this when the match was played (§8.1 *Understudy Arc*) */
  leaderMasteryBelow?: number;
}

export type Requirement =
  /** total a statistic across every qualifying match */
  | { need: "sum"; stat: SumStat; target: number; filter?: MatchFilter }
  /** count qualifying matches */
  | { need: "matches"; target: number; filter?: MatchFilter }
  /** count distinct values of a property across qualifying matches */
  | { need: "distinct"; of: "faction" | "primaryCurrent" | "mode"; target: number; filter?: MatchFilter };

/**
 * An objective is either a conjunction or a disjunction of requirements.
 *
 * `all` covers 26 of the 28 shipped missions. `any` exists because two weeklies
 * are written with an explicit "or" — *"Activate 6 Confluences, **or** trigger
 * Perfect Resonance twice"* — and collapsing that into two separate missions
 * would change what the design asked for.
 */
export interface Objective {
  all?: Requirement[];
  any?: Requirement[];
}

export type MissionCadence = "daily" | "weekly";

export interface MissionDef {
  id: string;
  name: string;
  /** the sentence the player reads; checked against the objective in tests */
  text: string;
  cadence: MissionCadence;
  objective: Objective;
  /**
   * Faction- or Current-specific missions are limited to one held slot at a
   * time (§7 "slot constraint"), so the pool has to say which ones they are.
   */
  specific?: boolean;
}

/** One line of progress, for the screen and for `isComplete`. */
export interface RequirementProgress {
  label: string;
  have: number;
  need: number;
}

export interface MissionProgress {
  /** every requirement, in order, so the screen can show what is left */
  parts: RequirementProgress[];
  /** 0..1 */
  fraction: number;
  complete: boolean;
}

/** What a finished match contributes, as missions see it. */
export interface MatchOutcome {
  stats: MatchStats;
  /** the mode string recorded with the match (`ai-casual`, `story`, `doomfight`, …) */
  mode: string;
  /** true when the deck played was created or edited inside the current period */
  deckEditedThisPeriod: boolean;
  /**
   * When it was played. A mission only counts matches from `issuedAt` onward,
   * which is what lets a banked mission measure the right window rather than
   * every match in the log.
   */
  playedAt: number;
  /**
   * The Mastery ranks this match *started* at, for the two mastery weeklies.
   *
   * Absent on outcomes recorded before mastery shipped, and on any match whose
   * leader has no track. Absent must not satisfy a `below` filter: a mission
   * that paid out for evidence it cannot actually check would be worse than one
   * that takes a week longer to finish.
   */
  masteryAtPlay?: { faction: number; leader: number };
}
