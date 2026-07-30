/**
 * The two bonus dailies — `09-game-modes.md` §11, "The Daily Grind".
 *
 * §11's three daily slots, their deterministic generation and the free daily
 * reroll all ship in `game/missions`. What did not was the sentence after them:
 * *"Additionally: the **Daily Puzzle** (one Puzzle Rush scenario) and the
 * **Daily Doomscroll** (§9.9) count as bonus dailies."*
 *
 * So this is two extra slots that are not missions. They are not scored from the
 * outcome log like a mission is, because neither is a match: one is a scripted
 * puzzle and the other is a roguelike run. Each is simply *"the one the date
 * picked, done once today"*.
 *
 * ## Which one is today's, and why nothing stores it
 *
 * Both are derived from `(day, account seed)`. Deriving rather than storing is
 * the same choice the Weekly Boss and the Remix rotation make, and it buys the
 * same thing: every client agrees without a server, a reload is not a reroll,
 * and there is no second copy of the calendar to drift.
 *
 * The **account seed** is in there because §11 says the dailies are generated
 * *"per date + account seed"*. Two players on the same day get different
 * puzzles, which is what stops the answer being a thing you look up rather than
 * solve. The Daily Doomscroll goes the other way and is seeded by the date
 * **alone**: a shared daily run is the whole point of a daily run, and comparing
 * yours to somebody else's is the only social thing this build can offer.
 *
 * ## The streak that is not a streak
 *
 * §11 pays *"7-day completion streak: 1 pack (streak forgiveness: one missed day
 * per week is auto-excused)"*. `07-economy-and-monetization.md` §6 policy **F6**
 * says, bindingly: *"No unhealthy-playtime pressure. **No streak resets**, no
 * lose-it-if-you-miss-it daily grants."* Even a forgiving streak resets on the
 * second missed day.
 *
 * The two documents genuinely disagree, and F6 is the one that declares itself
 * policy and carries a validation rule, so it wins. The reward survives and the
 * mechanic does not: **every seven dailies completed pays the pack**, counted
 * cumulatively and never reset. Missing days delays it; nothing destroys it.
 * `missions.dailiesCompleted` was already a lifetime total, so this needs one
 * new number — how many packs have been handed over — and derives the rest.
 */

import type { ContentIndex } from "../../engine/types";
import { seedRng, nextInt, subSeed } from "../../engine/rng";

/** UTC day number. The same day boundary the missions rotation counts in. */
export const dayNumber = (now: number): number => Math.floor(now / 86_400_000);

// ---------------------------------------------------------------------------
// Which one is today's
// ---------------------------------------------------------------------------

/**
 * Today's puzzle, as an index into the Puzzle Rush list.
 *
 * Seeded from the day *and* the account, per §11's "per date + account seed".
 * `subSeed` is the same helper the Gauntlet and the Doomscroll derive their
 * sub-streams with, so this is one more consumer of a shared idiom rather than
 * a second way of turning two facts into a number.
 */
export function dailyPuzzleIndex(now: number, accountSeed: number, puzzleCount: number): number {
  if (puzzleCount <= 0) return 0;
  const rng = seedRng(subSeed(accountSeed, "daily-puzzle", String(dayNumber(now))));
  return nextInt(rng, puzzleCount);
}

/**
 * Today's Doomscroll seed — the **same run for everybody**.
 *
 * Deliberately not mixed with the account seed. A daily run that differs per
 * player is just a run; a shared one is a thing two people can talk about, and
 * §9.9's runs are already reproducible from a seed by design.
 */
export const dailyDoomscrollSeed = (now: number): number => (dayNumber(now) * 2_654_435_761) >>> 0;

// ---------------------------------------------------------------------------
// What they pay
// ---------------------------------------------------------------------------

export interface DailyBonusReward {
  clout: number;
  xp: number;
}

/** §11: the Daily Puzzle is rated separately from an ordinary daily. */
export const dailyPuzzleReward = (content: ContentIndex): DailyBonusReward => ({
  clout: content.balance.economy.missions.dailyPuzzleClout,
  xp: 0,
});

/**
 * §11: the Daily Doomscroll *"counts as a bonus daily"*, so it pays what a daily
 * pays. Read from the same two numbers the mission claim reads, rather than
 * copied, so "what a daily is worth" has one answer.
 */
export const dailyDoomscrollReward = (content: ContentIndex): DailyBonusReward => ({
  clout: content.balance.economy.missions.dailyClout,
  xp: content.balance.economy.missions.dailyXp,
});

// ---------------------------------------------------------------------------
// The pack every seven
// ---------------------------------------------------------------------------

export interface DailyBonusProgress {
  /** dailies completed, lifetime — including the two bonus slots */
  completed: number;
  /** how many are needed for the next pack */
  every: number;
  /** completed within the current block of `every` */
  toward: number;
  /** packs this account has earned in total */
  earned: number;
  /** packs already handed over */
  paid: number;
  /** packs owed right now */
  owed: number;
}

/**
 * How many packs seven-at-a-time have been earned, and how many are owed.
 *
 * A pure function of two stored numbers, which is what makes it safe: the count
 * only ever goes up, so a pack cannot be un-earned by a missed day, and paying
 * is recorded separately so it cannot be paid twice.
 */
export function dailyBonusProgress(content: ContentIndex, completed: number, paid: number): DailyBonusProgress {
  const { dailyBonusEvery, dailyBonusDrops } = content.balance.economy.missions;
  const earned = Math.floor(Math.max(0, completed) / dailyBonusEvery) * dailyBonusDrops;
  return {
    completed,
    every: dailyBonusEvery,
    toward: Math.max(0, completed) % dailyBonusEvery,
    earned,
    paid,
    owed: Math.max(0, earned - paid),
  };
}

// ---------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------

export const DEFERRED_DAILIES: ReadonlyMap<string, string> = new Map([
  [
    "The completion streak",
    "09 §11 pays its pack for a 7-day streak with one missed day per week forgiven; 07 §6 policy F6 forbids streak resets outright and calls retention built on anxiety a defect. The pack is paid for every seven dailies completed instead — the reward without the mechanic — so there is no streak to display or to break",
  ],
  [
    "Server-verified completions",
    "§11's ship status is offline-now for generation with 'server-side verification of completions' arriving with accounts-online; nothing here is verified against anything, because there is nothing to verify against",
  ],
]);

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function checkDailyData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const missions = content.balance.economy.missions;

  if (missions.dailyPuzzleClout <= 0) {
    problems.push("economy.missions.dailyPuzzleClout is zero, so the Daily Puzzle would pay nothing");
  }
  if (missions.dailyBonusEvery <= 0) {
    problems.push("economy.missions.dailyBonusEvery is zero, which would pay a pack per daily forever");
  }
  if (missions.dailyBonusDrops <= 0) {
    problems.push("economy.missions.dailyBonusDrops is zero, so completing dailies would earn no pack at all");
  }
  for (const [name, reason] of DEFERRED_DAILIES) {
    if (reason.trim().length < 40) problems.push(`DEFERRED_DAILIES "${name}": deferred without a real reason`);
  }
  return problems;
}
