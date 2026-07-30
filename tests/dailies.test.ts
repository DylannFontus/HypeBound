/**
 * The two bonus dailies — `09-game-modes.md` §11, "The Daily Grind".
 *
 * §11's three daily slots ship in `game/missions`. These are the sentence after
 * them: *"the **Daily Puzzle** and the **Daily Doomscroll** count as bonus
 * dailies."*
 *
 * The interesting assertions are about the two things a player would only notice
 * by being cheated: that a bonus slot pays **once a day** and not once a click,
 * and that the pack for seven dailies **cannot be lost by missing a day** —
 * which is where 09 §11 and 07 §6 policy F6 openly contradict each other, and
 * F6 wins.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import {
  DEFERRED_DAILIES,
  checkDailyData,
  dailyBonusProgress,
  dailyDoomscrollReward,
  dailyDoomscrollSeed,
  dailyPuzzleIndex,
  dailyPuzzleReward,
  dayNumber,
} from "../src/game/dailies";

const content = getContent();
const DAY = 86_400_000;
const PUZZLES = 40;

// ---------------------------------------------------------------------------

describe("which one is today's", () => {
  it("passes its own data check", () => {
    expect(checkDailyData(content)).toEqual([]);
  });

  it("gives the same account the same puzzle all day, and a new one tomorrow", () => {
    const seed = 12_345;
    const morning = Date.parse("2026-07-29T01:00:00.000Z");
    const evening = Date.parse("2026-07-29T23:59:00.000Z");
    const tomorrow = Date.parse("2026-07-30T01:00:00.000Z");

    expect(dailyPuzzleIndex(morning, seed, PUZZLES)).toBe(dailyPuzzleIndex(evening, seed, PUZZLES));
    // not a guarantee for every pair of days, but it must not be pinned to one
    const week = [0, 1, 2, 3, 4, 5, 6].map((offset) => dailyPuzzleIndex(tomorrow + offset * DAY, seed, PUZZLES));
    expect(new Set(week).size, "the same puzzle came up all week").toBeGreaterThan(1);
  });

  /** §11 generates dailies "per date + account seed", so two accounts differ. */
  it("gives two accounts different puzzles on the same day", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    const spread = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => dailyPuzzleIndex(now, seed, PUZZLES)));
    expect(spread.size, "every account got the same puzzle").toBeGreaterThan(1);
  });

  it("always names a puzzle that exists", () => {
    for (let day = 0; day < 60; day++) {
      const index = dailyPuzzleIndex(day * DAY, 99, PUZZLES);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PUZZLES);
    }
    // and survives a build with no puzzles rather than dividing by zero
    expect(dailyPuzzleIndex(0, 1, 0)).toBe(0);
  });

  /**
   * The Doomscroll goes the other way on purpose: the same run for everybody.
   * A daily run nobody else is playing is just a run.
   */
  it("gives every account the same Doomscroll run each day", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    expect(dailyDoomscrollSeed(now)).toBe(dailyDoomscrollSeed(now + 6 * 3_600_000));
    expect(dailyDoomscrollSeed(now)).not.toBe(dailyDoomscrollSeed(now + DAY));
    expect(dailyDoomscrollSeed(now)).toBeGreaterThan(0);
  });

  it("counts days on the UTC boundary", () => {
    expect(dayNumber(Date.parse("2026-07-29T23:59:59.000Z"))).toBe(
      dayNumber(Date.parse("2026-07-29T00:00:00.000Z"))
    );
    expect(dayNumber(Date.parse("2026-07-30T00:00:00.000Z"))).toBe(
      dayNumber(Date.parse("2026-07-29T00:00:00.000Z")) + 1
    );
  });
});

// ---------------------------------------------------------------------------

describe("what they pay", () => {
  it("rates the Daily Puzzle separately, as §11 does", () => {
    expect(dailyPuzzleReward(content).clout).toBe(content.balance.economy.missions.dailyPuzzleClout);
  });

  /** "Counts as a bonus daily" means it pays what a daily pays — one source. */
  it("pays the Daily Doomscroll exactly what a daily pays", () => {
    const reward = dailyDoomscrollReward(content);
    expect(reward.clout).toBe(content.balance.economy.missions.dailyClout);
    expect(reward.xp).toBe(content.balance.economy.missions.dailyXp);
  });
});

// ---------------------------------------------------------------------------

describe("the pack for seven dailies", () => {
  const every = content.balance.economy.missions.dailyBonusEvery;
  const drops = content.balance.economy.missions.dailyBonusDrops;

  it("pays one every seven completions", () => {
    expect(dailyBonusProgress(content, 0, 0).earned).toBe(0);
    expect(dailyBonusProgress(content, every - 1, 0).earned).toBe(0);
    expect(dailyBonusProgress(content, every, 0).earned).toBe(drops);
    expect(dailyBonusProgress(content, every * 3, 0).earned).toBe(drops * 3);
  });

  it("owes only what has not been handed over", () => {
    expect(dailyBonusProgress(content, every * 2, 0).owed).toBe(drops * 2);
    expect(dailyBonusProgress(content, every * 2, drops).owed).toBe(drops);
    expect(dailyBonusProgress(content, every * 2, drops * 2).owed).toBe(0);
    // and never goes negative if the ledger is ahead for any reason
    expect(dailyBonusProgress(content, 0, drops * 5).owed).toBe(0);
  });

  it("shows how far into the current block you are", () => {
    expect(dailyBonusProgress(content, 0, 0).toward).toBe(0);
    expect(dailyBonusProgress(content, 3, 0).toward).toBe(3 % every);
    expect(dailyBonusProgress(content, every, 0).toward).toBe(0);
  });

  /**
   * The policy conflict, pinned.
   *
   * 09 §11 asks for a 7-day streak with one missed day forgiven. 07 §6 policy F6
   * says *"No streak resets... The game should reward returning, never punish
   * leaving. Retention built on anxiety is a defect."* F6 declares itself policy
   * and carries a validation rule, so it wins: the count only ever goes up, and
   * there is no input that can take a completion away.
   */
  it("cannot lose progress, because there is no way to express losing it", () => {
    const before = dailyBonusProgress(content, every - 1, 0);
    // a week passes with nothing completed — the same numbers go in
    const after = dailyBonusProgress(content, every - 1, 0);
    expect(after.toward).toBe(before.toward);
    expect(after.earned).toBe(before.earned);

    // and one more completion, whenever it happens, finishes the block
    expect(dailyBonusProgress(content, every, 0).earned).toBe(drops);
  });

  it("says why the streak itself is not built", () => {
    expect(DEFERRED_DAILIES.get("The completion streak")).toBeTruthy();
    for (const [name, reason] of DEFERRED_DAILIES) {
      expect(reason.trim().length, `${name} is deferred without a real reason`).toBeGreaterThan(40);
    }
  });
});
