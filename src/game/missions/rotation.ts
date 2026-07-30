/**
 * Issuing, banking and rerolling missions.
 *
 * Pure: state and a timestamp in, new state out. No storage, no `Date.now()`,
 * no RNG stream of its own — the caller passes the clock and the PRNG, which is
 * what lets the whole rotation be tested by handing it a Tuesday.
 *
 * ## The banking rules are policy, not decoration
 *
 * `07-economy-and-monetization.md` §6 makes **F6** binding: *"No unhealthy-
 * playtime pressure. No streak resets, no lose-it-if-you-miss-it daily grants,
 * no 'play within X hours' mechanics."* Everything below follows from that:
 *
 * - A daily is **issued** at the 09:00 UTC reset only if you hold fewer than 3,
 *   and once issued it **never expires**. Miss a week and you still hold three
 *   missions; you simply stopped accruing at three. That cap is what §3.5 means
 *   by "dailies hold up to 3 days of missions".
 * - Weeklies persist **one extra week** (max 6 held), so a missed week loses
 *   nothing.
 * - The reroll is one per period and does **not** accumulate — but not using it
 *   costs nothing either, because nothing expires.
 *
 * There is deliberately no code path that removes an unclaimed mission.
 *
 * ## Progress is evidence, not a counter
 *
 * Each active mission records **when it was issued**, and its progress is
 * computed from the matches played since. That is what makes banking coherent:
 * a daily received on Monday and finished on Thursday counts Monday-to-Thursday,
 * while one received on Thursday counts only Thursday — without either of them
 * needing a counter that could drift.
 */

import type { RngState } from "../../engine/rng";
import { nextInt } from "../../engine/rng";
import type { MissionCadence, MissionDef } from "./types";

/** Missions held at once, per §7 (dailies) and §8 (weeklies, 3 issued + 3 carried). */
export const DAILY_SLOTS = 3;
export const WEEKLY_SLOTS = 6;
/** How many weeklies are issued each Monday. */
export const WEEKLY_ISSUE = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Daily and weekly reset, per §7: 09:00 UTC. */
export const RESET_HOUR_UTC = 9;
/** 1970-01-01 was a Thursday, so Monday sits 4 days into the epoch's first week. */
const MONDAY_OFFSET = 4;

/** Which mission-day a timestamp falls in. Increments at 09:00 UTC. */
export const dayIndex = (now: number): number => Math.floor((now - RESET_HOUR_UTC * HOUR_MS) / DAY_MS);

/** Which mission-week a timestamp falls in. Increments Monday 09:00 UTC. */
export const weekIndex = (now: number): number => Math.floor((dayIndex(now) - MONDAY_OFFSET) / 7);

/** The instant a mission-day began, so a newly issued mission dates from it. */
export const dayStart = (index: number): number => index * DAY_MS + RESET_HOUR_UTC * HOUR_MS;
export const weekStart = (index: number): number => dayStart(index * 7 + MONDAY_OFFSET);

export interface ActiveMission {
  missionId: string;
  cadence: MissionCadence;
  /** matches played at or after this instant count toward it */
  issuedAt: number;
  /** the day (or week) index it was issued for — the Weekly Wrap groups on this */
  periodIndex: number;
}

export interface RotationState {
  daily: ActiveMission[];
  weekly: ActiveMission[];
  /** the last day/week index that has been issued for; -1 means "never" */
  lastDayIssued: number;
  lastWeekIssued: number;
  /** the period in which the free reroll was spent */
  rerollSpentDay: number;
  rerollSpentWeek: number;
}

export const emptyRotation = (): RotationState => ({
  daily: [],
  weekly: [],
  lastDayIssued: -1,
  lastWeekIssued: -1,
  rerollSpentDay: -1,
  rerollSpentWeek: -1,
});

/**
 * Pick a mission from `pool` that is not already held.
 *
 * The slot constraint from §7 lives here: *"at most one faction- or
 * Current-specific mission held at a time"*. Without it a player can be handed
 * three missions that all demand a deck they do not own, which is the one way a
 * banked-forever mission still manages to feel like pressure.
 */
export function pickMission(
  pool: readonly MissionDef[],
  held: readonly ActiveMission[],
  rng: RngState
): MissionDef | null {
  const heldIds = new Set(held.map((mission) => mission.missionId));
  const holdsSpecific = held.some((active) => pool.find((m) => m.id === active.missionId)?.specific);

  const eligible = pool.filter((mission) => !heldIds.has(mission.id) && !(holdsSpecific && mission.specific));
  // if the constraint leaves nothing, relax it rather than issue nothing at all
  const candidates = eligible.length > 0 ? eligible : pool.filter((mission) => !heldIds.has(mission.id));
  if (candidates.length === 0) return null;
  return candidates[nextInt(rng, candidates.length)] ?? null;
}

/**
 * Bring a rotation up to date for `now`.
 *
 * A brand-new account (`lastDayIssued === -1`) is filled to three immediately,
 * per §7's *"New accounts start with 3"*. After that, one daily is issued per
 * elapsed reset while a slot is free — so an account that has not played for a
 * month is topped up to three, not to thirty.
 */
export function issueDue(
  state: RotationState,
  now: number,
  rng: RngState,
  pools: { daily: readonly MissionDef[]; weekly: readonly MissionDef[] }
): RotationState {
  const today = dayIndex(now);
  const thisWeek = weekIndex(now);
  const next: RotationState = {
    ...state,
    daily: [...state.daily],
    weekly: [...state.weekly],
  };

  // --- dailies -------------------------------------------------------------
  if (next.lastDayIssued < 0) {
    while (next.daily.length < DAILY_SLOTS) {
      const mission = pickMission(pools.daily, next.daily, rng);
      if (!mission) break;
      next.daily.push({ missionId: mission.id, cadence: "daily", issuedAt: now, periodIndex: today });
    }
  } else {
    // one per elapsed reset, and only while a slot is free — the cap is the bank
    const elapsed = Math.max(0, today - next.lastDayIssued);
    for (let step = 0; step < elapsed && next.daily.length < DAILY_SLOTS; step++) {
      const mission = pickMission(pools.daily, next.daily, rng);
      if (!mission) break;
      const periodIndex = next.lastDayIssued + step + 1;
      next.daily.push({
        missionId: mission.id,
        cadence: "daily",
        issuedAt: dayStart(periodIndex),
        periodIndex,
      });
    }
  }
  next.lastDayIssued = today;

  // --- weeklies ------------------------------------------------------------
  if (next.lastWeekIssued < thisWeek) {
    /**
     * Three every Monday, capped at six held. The cap is what "persist one extra
     * week" means in practice: last week's unfinished three plus this week's
     * three, and no more, so a long absence does not return a wall of twelve.
     */
    const issuedAt = next.lastWeekIssued < 0 ? now : weekStart(thisWeek);
    for (let i = 0; i < WEEKLY_ISSUE && next.weekly.length < WEEKLY_SLOTS; i++) {
      const mission = pickMission(pools.weekly, next.weekly, rng);
      if (!mission) break;
      next.weekly.push({ missionId: mission.id, cadence: "weekly", issuedAt, periodIndex: thisWeek });
    }
    next.lastWeekIssued = thisWeek;
  }

  return next;
}

/** Is the free reroll available for this cadence right now? */
export function canReroll(state: RotationState, cadence: MissionCadence, now: number): boolean {
  return cadence === "daily" ? state.rerollSpentDay !== dayIndex(now) : state.rerollSpentWeek !== weekIndex(now);
}

/**
 * Swap one held mission for another from the same pool.
 *
 * The replacement inherits the original's `issuedAt`, which matters and is easy
 * to get wrong: rerolling is meant to change *which* goal you have, not to throw
 * away the matches you already played today. Dating it from now would quietly
 * punish rerolling late in a session.
 */
export function reroll(
  state: RotationState,
  cadence: MissionCadence,
  missionId: string,
  now: number,
  rng: RngState,
  pools: { daily: readonly MissionDef[]; weekly: readonly MissionDef[] },
  /**
   * Skip the once-per-period limit.
   *
   * §11's check-in track pays "2 daily-mission reroll tokens", and a token that
   * could not do anything the free reroll cannot would be a reward in name only.
   * The caller is responsible for having spent one — this function does not know
   * what a token is, and should not.
   */
  options: { force?: boolean } = {}
): RotationState | null {
  if (!options.force && !canReroll(state, cadence, now)) return null;
  const list = cadence === "daily" ? state.daily : state.weekly;
  const index = list.findIndex((mission) => mission.missionId === missionId);
  if (index < 0) return null;

  const pool = cadence === "daily" ? pools.daily : pools.weekly;
  const replacement = pickMission(pool, list, rng);
  if (!replacement) return null;

  const updated = [...list];
  updated[index] = { ...list[index]!, missionId: replacement.id };
  /**
   * A forced reroll does not spend the free one.
   *
   * The token paid for this swap, so burning the period's free reroll alongside
   * it would charge twice for one thing — and would make a token strictly worse
   * than useless on a day you had not rerolled yet.
   */
  if (options.force) {
    return cadence === "daily" ? { ...state, daily: updated } : { ...state, weekly: updated };
  }
  return cadence === "daily"
    ? { ...state, daily: updated, rerollSpentDay: dayIndex(now) }
    : { ...state, weekly: updated, rerollSpentWeek: weekIndex(now) };
}

/** Remove a claimed mission, freeing its slot for the next reset. */
export function removeMission(state: RotationState, cadence: MissionCadence, missionId: string): RotationState {
  if (cadence === "daily") {
    return { ...state, daily: state.daily.filter((mission) => mission.missionId !== missionId) };
  }
  return { ...state, weekly: state.weekly.filter((mission) => mission.missionId !== missionId) };
}

/**
 * The oldest instant any held mission still needs evidence from.
 *
 * Used to prune the stored outcome log: a match older than every active
 * mission's `issuedAt` can no longer affect anything.
 */
export function evidenceHorizon(state: RotationState): number {
  const all = [...state.daily, ...state.weekly];
  if (all.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...all.map((mission) => mission.issuedAt));
}
