/**
 * Missions, as the rest of the game sees them.
 *
 * The layers underneath are deliberately separate and pure — `stats.ts` reads a
 * match, `objectives.ts` scores an objective, `rotation.ts` issues and banks,
 * `data.ts` loads the pool. This file is the one that knows about all four, and
 * it is still pure: the save layer owns the state and passes it in.
 */

export {
  emptyStats,
  matchStats,
  readMatch,
  EXPENSIVE_COST,
  type MatchAffinity,
  type MatchReading,
  type MatchStats,
} from "./stats";
export { progressFor, isComplete, matchesFilter } from "./objectives";
export {
  dailyPool,
  weeklyPool,
  allMissions,
  missionById,
  checkMissionData,
  resetMissionData,
  MissionDataError,
} from "./data";
export {
  DAILY_SLOTS,
  WEEKLY_SLOTS,
  WEEKLY_ISSUE,
  RESET_HOUR_UTC,
  dayIndex,
  weekIndex,
  dayStart,
  weekStart,
  emptyRotation,
  issueDue,
  canReroll,
  reroll,
  removeMission,
  evidenceHorizon,
  pickMission,
  type ActiveMission,
  type RotationState,
} from "./rotation";
export type {
  MatchFilter,
  MatchOutcome,
  MissionCadence,
  MissionDef,
  MissionProgress,
  Objective,
  Requirement,
  RequirementProgress,
  SumStat,
} from "./types";
export { SUM_STATS } from "./types";

import type { ContentIndex } from "../../engine/types";
import type { ActiveMission } from "./rotation";
import type { MatchOutcome, MissionDef, MissionProgress } from "./types";
import { missionById } from "./data";
import { progressFor } from "./objectives";

/** A held mission, its definition and how far along it is — what a screen needs. */
export interface MissionView {
  active: ActiveMission;
  def: MissionDef;
  progress: MissionProgress;
  /** what claiming it pays, from `balance.economy.missions` */
  reward: { clout: number; xp: number };
}

/**
 * Score one held mission against the stored evidence.
 *
 * Only outcomes at or after `issuedAt` count, which is what makes a banked
 * mission behave sensibly: it measures the matches played since you received it,
 * not every match in the log.
 */
export function viewMission(
  content: ContentIndex,
  active: ActiveMission,
  outcomes: readonly MatchOutcome[],
  options: { rookieRoad: boolean }
): MissionView | null {
  const def = missionById(active.missionId);
  if (!def) return null;

  const evidence = outcomes.filter((outcome) => outcome.playedAt >= active.issuedAt);
  const progress = progressFor(def.objective, evidence);
  const economy = content.balance.economy.missions;

  const reward =
    active.cadence === "daily"
      ? {
          clout: Math.round(economy.dailyClout * (options.rookieRoad ? economy.rookieRoadMultiplier : 1)),
          xp: economy.dailyXp,
        }
      : { clout: economy.weeklyClout, xp: economy.weeklyXp };

  return { active, def, progress, reward };
}
