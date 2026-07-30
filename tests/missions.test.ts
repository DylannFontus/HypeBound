/**
 * Missions, and the income contract behind them.
 *
 * `07-economy-and-monetization.md` §3.5 is titled *"Reliable free weekly income
 * (**the contract**)"* and publishes a weekly total. §6 makes **F6** binding —
 * *"No unhealthy-playtime pressure. No streak resets, no lose-it-if-you-miss-it
 * daily grants."* Both are policy rather than flavour, so both are asserted here
 * rather than described in a comment.
 *
 * The sharpest test in the file is the coverage one. A mission is a promise that
 * something you do will be counted, and a mission whose statistic never moves is
 * indistinguishable from a player who has not got round to it — no error, no
 * crash, just a bar that stays at zero forever. So every statistic any shipped
 * mission depends on has to be **demonstrated moving in a real simulated match**,
 * or be listed with a written reason.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { seedRng } from "../src/engine/rng";
import {
  allMissions,
  checkMissionData,
  dailyPool,
  dayIndex,
  DAILY_SLOTS,
  emptyRotation,
  emptyStats,
  EXPENSIVE_COST,
  issueDue,
  matchStats,
  missionById,
  progressFor,
  reroll,
  weeklyPool,
  weekIndex,
  WEEKLY_SLOTS,
  type MatchOutcome,
  type MissionDef,
  type RotationState,
  type SumStat,
} from "../src/game/missions";
import {
  claimMission,
  claimWeeklyRestock,
  getProfile,
  missionViews,
  profileStore,
  recordMatch,
  restockAvailable,
  syncMissions,
} from "../src/save/profile";
import type { MatchConfig, MatchRecord, MatchState, PlayerIntent, Seat } from "../src/engine/types";

const content = getContent();
const DAY_MS = 86_400_000;
/** A Wednesday at 12:00 UTC — safely inside a mission-day and a mission-week. */
const MONDAY_NOON = Date.UTC(2026, 6, 22, 12, 0, 0);

beforeEach(() => {
  profileStore.reset();
});

// ---------------------------------------------------------------------------
// A real match, played by the AI, so the statistics come from the engine
// ---------------------------------------------------------------------------

function playRecord(seed: number, a: string, b: string): MatchRecord {
  const config: MatchConfig = {
    seed,
    decks: [autoBuildDeck(content, a, "A"), autoBuildDeck(content, b, "B")],
    firstSeat: 0,
  };
  let state: MatchState = createMatch(config, content);
  const intents: PlayerIntent[] = [];
  const profiles = [getAiProfile("casual"), getAiProfile("casual")];

  while (state.phase === "mulligan") {
    const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    intents.push(decision.intent);
    state = applyIntent(state, content, decision.intent).state;
  }
  let guard = 0;
  while (state.winner === null && guard++ < 700) {
    const seat = state.activeSeat;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    intents.push(decision.intent);
    try {
      state = applyIntent(state, content, decision.intent).state;
    } catch {
      break;
    }
  }
  return { config, intents, result: { winner: state.winner, turns: state.turn } } as MatchRecord;
}

/** An outcome fixture, for tests about scoring rather than about the engine. */
const outcomeOf = (over: Partial<MatchOutcome["stats"]> & { mode?: string; playedAt?: number }): MatchOutcome => {
  const { mode = "ai-casual", playedAt = MONDAY_NOON, ...stats } = over;
  return {
    mode,
    playedAt,
    deckEditedThisPeriod: false,
    stats: {
      ...emptyStats(0),
      leaderCardId: "x",
      factionId: "neon-idols",
      primaryCurrent: "pulse",
      ...stats,
    },
  };
};

// ---------------------------------------------------------------------------

describe("the mission pool", () => {
  it("loads, and everything it names exists", () => {
    const problems = checkMissionData(content);
    expect(problems, problems.length === 0 ? "" : `\ndata/missions.json:\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });

  it("ships the pools the design asks for", () => {
    // §7.1 lists 18 dailies and §8.1 lists 10 weeklies. All ten ship: the two
    // that were held back — Understudy Arc and Second Bias — arrived with the
    // Mastery tracks they read.
    expect(dailyPool()).toHaveLength(18);
    expect(weeklyPool()).toHaveLength(10);
    expect(new Set(allMissions().map((m) => m.id)).size).toBe(allMissions().length);
  });

  /**
   * The sentence and the objective have to agree, because the sentence is the
   * promise and the objective is what is enforced. Every number printed in the
   * text must appear as a target somewhere in the objective.
   */
  it("prints numbers that match what it enforces", () => {
    const mismatched: string[] = [];
    for (const mission of allMissions()) {
      const requirements = mission.objective.all ?? mission.objective.any ?? [];
      const targets = new Set<number>([EXPENSIVE_COST]);
      for (const requirement of requirements) {
        targets.add(requirement.target);
        if (requirement.filter?.atLeast) targets.add(requirement.filter.atLeast.value);
        // a mastery threshold is printed in the sentence and enforced by the
        // filter, so it is exactly the kind of number this test exists for
        if (requirement.filter?.factionMasteryBelow) targets.add(requirement.filter.factionMasteryBelow);
        if (requirement.filter?.leaderMasteryBelow) targets.add(requirement.filter.leaderMasteryBelow);
      }
      const printed = [...mission.text.matchAll(/\b(\d+)\b/g)].map((match) => Number(match[1]));
      for (const number of printed) {
        if (!targets.has(number)) {
          mismatched.push(`${mission.id}: text says ${number}, objective targets ${[...targets].join("/")}`);
        }
      }
    }
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  /**
   * One number in the pool is not in the data at all: "cards that cost 6 or
   * more" reads `EXPENSIVE_COST` from the stats module. That makes the printed
   * 6 a promise about a constant in code, so it is bound here — otherwise
   * lowering the constant would silently make the mission text a lie.
   */
  it("binds the printed cost threshold to the constant that enforces it", () => {
    const mission = missionById("certified-banger")!;
    expect(mission.text).toContain(String(EXPENSIVE_COST));
  });
});

describe("what the statistics can actually see", () => {
  /**
   * The coverage test. Every statistic a shipped mission depends on is played
   * for real until it moves; anything that cannot be demonstrated is listed here
   * **with a reason**, and a second test fails when an entry stops being needed.
   *
   * This is the same assert-against-a-justified-list shape as the deck-pool
   * invariant, the card-text audit and the DSL sweep — and it exists because the
   * failure it guards against is silent. A mission counting a statistic that
   * never moves does not throw; it just never completes.
   */
  const UNPROVEN: Record<string, string> = {
    cancelledApplied:
      "'Damage Control' is an either/or weekly and its other half (negative statuses cleared) is proved " +
      "below, so the mission is completable. Cancel is rare in auto-built decks.",
    perfectResonances:
      "'Signal Boost' is an either/or weekly whose other half (Confluences) is proved below. Perfect " +
      "Resonance needs 7 resonance progress in one match, which auto-built decks reach rarely.",
    afterpartyTriggers:
      "proved by construction rather than by sampling: the Gothic Royalty leader Alaric Thornheart has an " +
      "Afterparty passive, and the dedicated test below asserts it counts for its controller and not the " +
      "opponent.",
  };

  const used = new Set<SumStat>();
  for (const mission of allMissions()) {
    for (const requirement of mission.objective.all ?? mission.objective.any ?? []) {
      if (requirement.need === "sum") used.add(requirement.stat);
      if (requirement.filter?.atLeast) used.add(requirement.filter.atLeast.stat);
    }
  }

  it("moves every statistic a shipped mission depends on", () => {
    const seen = new Map<SumStat, number>();
    const pairs: [string, string][] = [
      ["idols-lumi-starcall", "goth-leader-alaric-thornheart"],
      ["grass-leader-juniper-vale", "demon-leader-ashvyre-dropped-frames"],
      ["corp-leader-cressida-vale", "meme-leader-chairperson-nobody"],
    ];
    let seed = 900;
    for (const [a, b] of pairs) {
      for (let round = 0; round < 2; round++) {
        const record = playRecord((seed += 101), a, b);
        for (const seat of [0, 1] as Seat[]) {
          const stats = matchStats(record, content, seat);
          for (const stat of used) {
            if (stats[stat] > 0) seen.set(stat, (seen.get(stat) ?? 0) + stats[stat]);
          }
        }
      }
    }

    const missing = [...used].filter((stat) => !seen.has(stat) && !(stat in UNPROVEN));
    expect(
      missing,
      `these statistics never moved in any simulated match, so the missions using them can never be ` +
        `completed — fix the deriver or justify them in UNPROVEN:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("has no stale exemption", () => {
    const stale = Object.keys(UNPROVEN).filter((stat) => !used.has(stat as SumStat));
    expect(stale, `UNPROVEN names statistics no mission uses any more: ${stale.join(", ")}`).toEqual([]);
  });

  /**
   * `triggerQueued` carries no seat, so Afterparty is attributed to whoever's
   * turn it is. Alaric Thornheart has an Afterparty passive and Lumi Starcall
   * does not, which makes this a clean two-sided check: all of them belong to
   * one seat and none to the other.
   */
  it("attributes Afterparty to the leader who has it", () => {
    const record = playRecord(11, "idols-lumi-starcall", "goth-leader-alaric-thornheart");
    const mine = matchStats(record, content, 0);
    const theirs = matchStats(record, content, 1);
    expect(theirs.afterpartyTriggers).toBeGreaterThan(0);
    expect(mine.afterpartyTriggers).toBe(0);
  });

  it("reads the two sides of a match as opposites", () => {
    const record = playRecord(77, "idols-lumi-starcall", "goth-leader-alaric-thornheart");
    const a = matchStats(record, content, 0);
    const b = matchStats(record, content, 1);
    expect(a.won).not.toBe(b.won);
    // damage each dealt to the other's face, counted by target on both sides
    expect(a.damageToEnemyLeader).toBeGreaterThan(0);
    expect(b.damageToEnemyLeader).toBeGreaterThan(0);
    expect(a.leaderCardId).not.toBe(b.leaderCardId);
  });
});

describe("scoring an objective", () => {
  const missionFor = (id: string): MissionDef => missionById(id)!;

  it("totals a statistic across matches", () => {
    const objective = missionFor("feed-the-algorithm").objective;
    expect(progressFor(objective, [outcomeOf({ cardsPlayed: 12 })]).complete).toBe(false);
    expect(progressFor(objective, [outcomeOf({ cardsPlayed: 12 }), outcomeOf({ cardsPlayed: 8 })]).complete).toBe(true);
  });

  /** "6 cards of one Current **in a single match**" must not add up across two. */
  it("does not let a single-match requirement accumulate", () => {
    const objective = missionFor("on-brand").objective;
    const twoHalves = [outcomeOf({ mostOfOneCurrent: 3 }), outcomeOf({ mostOfOneCurrent: 3 })];
    expect(progressFor(objective, twoHalves).complete).toBe(false);
    expect(progressFor(objective, [outcomeOf({ mostOfOneCurrent: 6 })]).complete).toBe(true);
  });

  it("requires every part of an `all` objective", () => {
    const objective = missionFor("variety-streamer").objective;
    const oneFaction = Array.from({ length: 4 }, () => outcomeOf({ won: true, factionId: "neon-idols" }));
    const scored = progressFor(objective, oneFaction);
    expect(scored.complete, "four wins with one faction is not four wins across two").toBe(false);
    expect(scored.parts.some((part) => part.have >= part.need)).toBe(true);

    oneFaction[3] = outcomeOf({ won: true, factionId: "gothic-royalty" });
    expect(progressFor(objective, oneFaction).complete).toBe(true);
  });

  it("accepts either half of an `any` objective", () => {
    const objective = missionFor("signal-boost").objective;
    expect(progressFor(objective, [outcomeOf({ confluencesActivated: 6 })]).complete).toBe(true);
    expect(progressFor(objective, [outcomeOf({ perfectResonances: 2 })]).complete).toBe(true);
    expect(progressFor(objective, [outcomeOf({ confluencesActivated: 3, perfectResonances: 1 })]).complete).toBe(false);
  });

  it("filters on the match, not just the totals", () => {
    const objective = missionFor("touch-some-grass").objective;
    expect(progressFor(objective, [outcomeOf({ won: true, primaryCurrent: "pulse" })]).complete).toBe(false);
    expect(progressFor(objective, [outcomeOf({ won: false, primaryCurrent: "root" })]).complete).toBe(false);
    expect(progressFor(objective, [outcomeOf({ won: true, primaryCurrent: "root" })]).complete).toBe(true);
  });

  /** Modes are matched by prefix, so `ai-casual` and `ai-expert` are one mode. */
  it("counts difficulty tiers of one mode as one mode", () => {
    const objective = missionFor("mode-hopper").objective;
    const sameMode = [
      outcomeOf({ mode: "ai-casual" }),
      outcomeOf({ mode: "ai-expert" }),
      outcomeOf({ mode: "ai-beginner" }),
      outcomeOf({ mode: "ai-casual" }),
      outcomeOf({ mode: "ai-casual" }),
    ];
    expect(progressFor(objective, sameMode).complete).toBe(false);
    sameMode[4] = outcomeOf({ mode: "story-encore-please" });
    expect(progressFor(objective, sameMode).complete).toBe(true);
  });
});

describe("issuing and banking (F6)", () => {
  const pools = { daily: dailyPool(), weekly: weeklyPool() };
  const rollTo = (state: RotationState, now: number, seed = 5): RotationState =>
    issueDue(state, now, seedRng(seed), pools);

  it("starts a new account with a full set", () => {
    const state = rollTo(emptyRotation(), MONDAY_NOON);
    expect(state.daily).toHaveLength(DAILY_SLOTS);
    expect(state.weekly.length).toBeGreaterThan(0);
  });

  /**
   * The heart of F6. An account that stops playing for a month must come back to
   * three missions, not thirty — and must not have lost the three it held.
   */
  it("tops a month away up to the cap rather than piling up", () => {
    let state = rollTo(emptyRotation(), MONDAY_NOON);
    const heldBefore = state.daily.map((mission) => mission.missionId);

    state = rollTo(state, MONDAY_NOON + 30 * DAY_MS);
    expect(state.daily).toHaveLength(DAILY_SLOTS);
    expect(state.daily.map((m) => m.missionId), "a banked mission was silently replaced").toEqual(heldBefore);
    expect(state.weekly.length).toBeLessThanOrEqual(WEEKLY_SLOTS);
  });

  it("issues one daily per reset into a freed slot", () => {
    let state = rollTo(emptyRotation(), MONDAY_NOON);
    state = { ...state, daily: state.daily.slice(0, 1) };
    state = rollTo(state, MONDAY_NOON + DAY_MS);
    expect(state.daily).toHaveLength(2);
    state = rollTo(state, MONDAY_NOON + 2 * DAY_MS);
    expect(state.daily).toHaveLength(3);
  });

  it("never expires anything", () => {
    let state = rollTo(emptyRotation(), MONDAY_NOON);
    const ids = new Set(state.daily.map((m) => m.missionId));
    for (let day = 1; day <= 14; day++) state = rollTo(state, MONDAY_NOON + day * DAY_MS);
    for (const id of ids) {
      expect(state.daily.some((mission) => mission.missionId === id), `${id} vanished`).toBe(true);
    }
  });

  /**
   * §7: at most one faction- or Current-specific mission held at a time.
   *
   * The shipped daily pool contains exactly **one** deck-specific mission, so
   * this rule cannot bind against real data — asserting over the real pool
   * passed happily against a build with the constraint deleted. It is driven
   * against a fixture pool that *can* violate it instead, which is the only way
   * to tell a rule that holds from a rule that never runs.
   */
  const fakeMission = (id: string, specific: boolean): MissionDef => ({
    id,
    name: id,
    text: id,
    cadence: "daily",
    ...(specific ? { specific: true } : {}),
    objective: { all: [{ need: "matches", target: 1 }] },
  });

  it("holds at most one deck-specific mission", () => {
    // two specific and five plain: a pool where the rule CAN be honoured, so a
    // build that ignores it visibly hands out two
    const fixture = [
      fakeMission("specific-a", true),
      fakeMission("specific-b", true),
      ...["p1", "p2", "p3", "p4", "p5"].map((id) => fakeMission(id, false)),
    ];

    for (let seed = 1; seed <= 25; seed++) {
      const state = issueDue(emptyRotation(), MONDAY_NOON, seedRng(seed), { daily: fixture, weekly: pools.weekly });
      const specific = state.daily.filter((active) => fixture.find((m) => m.id === active.missionId)?.specific);
      expect(specific.length, `seed ${seed} issued ${specific.length} deck-specific dailies`).toBeLessThanOrEqual(1);
    }

    // …and the shipped pool respects it too
    for (let seed = 1; seed <= 25; seed++) {
      const state = issueDue(emptyRotation(), MONDAY_NOON, seedRng(seed), pools);
      const specific = state.daily.filter((active) => missionById(active.missionId)?.specific);
      expect(specific.length).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The constraint yields rather than starving the player.
   *
   * If every mission left in the pool is deck-specific, honouring the rule would
   * mean issuing nothing and leaving a slot empty until tomorrow — which is the
   * pressure F6 exists to prevent, arriving through the door meant to stop it.
   */
  it("fills the slots anyway when every remaining mission is specific", () => {
    const allSpecific = ["a", "b", "c", "d"].map((id) => fakeMission(`specific-${id}`, true));
    const state = issueDue(emptyRotation(), MONDAY_NOON, seedRng(7), { daily: allSpecific, weekly: pools.weekly });
    expect(state.daily, "the slot constraint starved the rotation").toHaveLength(DAILY_SLOTS);
  });

  it("allows one reroll per day, and keeps the evidence window", () => {
    const state = rollTo(emptyRotation(), MONDAY_NOON);
    const target = state.daily[0]!;
    /**
     * Rerolled several hours after issue, on purpose. Doing it at the issue
     * instant makes "kept the window" and "restarted the window" the same
     * number, and the assertion passed against a build that restarted it.
     */
    const later = MONDAY_NOON + 5 * 3_600_000;
    const after = reroll(state, "daily", target.missionId, later, seedRng(3), pools);
    expect(after).toBeTruthy();
    expect(after!.daily[0]!.missionId).not.toBe(target.missionId);
    // rerolling changes the goal, not the window: matches already played today
    // still count toward the replacement
    expect(after!.daily[0]!.issuedAt, "rerolling threw away today's matches").toBe(target.issuedAt);
    expect(after!.daily[0]!.issuedAt).not.toBe(later);

    expect(reroll(after!, "daily", after!.daily[1]!.missionId, later, seedRng(4), pools)).toBeNull();
    // …and it comes back tomorrow
    expect(reroll(after!, "daily", after!.daily[1]!.missionId, later + DAY_MS, seedRng(4), pools)).toBeTruthy();
  });

  it("puts the reset at 09:00 UTC, not midnight", () => {
    const justBefore = Date.UTC(2026, 6, 22, 8, 59, 0);
    const justAfter = Date.UTC(2026, 6, 22, 9, 1, 0);
    expect(dayIndex(justAfter), "the day did not turn over at 09:00").toBe(dayIndex(justBefore) + 1);
    // and midnight is NOT a boundary — 23:00 and 01:00 either side of it agree
    expect(dayIndex(Date.UTC(2026, 6, 22, 23, 0, 0))).toBe(dayIndex(Date.UTC(2026, 6, 23, 1, 0, 0)));
  });

  it("starts the week on Monday at 09:00 UTC", () => {
    // 2026-07-20 is a Monday
    const mondayBefore = Date.UTC(2026, 6, 20, 8, 59, 0);
    const mondayAfter = Date.UTC(2026, 6, 20, 9, 1, 0);
    const sunday = Date.UTC(2026, 6, 26, 12, 0, 0);
    expect(weekIndex(mondayAfter), "the week did not turn over on Monday morning").toBe(weekIndex(mondayBefore) + 1);
    expect(weekIndex(sunday), "Sunday belongs to the week that began on Monday").toBe(weekIndex(mondayAfter));
  });
});

describe("claiming", () => {
  const completeADaily = (now: number): string => {
    const views = syncMissions(content, now);
    const view = views.find((entry) => entry.active.cadence === "daily")!;
    // satisfy whatever it happens to be, generously
    profileStore.update((draft) => {
      draft.missions.outcomes.push(
        outcomeOf({
          playedAt: now,
          won: true,
          cardsPlayed: 99,
          cardsDrawn: 99,
          charactersDefeated: 99,
          damageToEnemyLeader: 99,
          healingToFriendlies: 99,
          supportsGiven: 99,
          confluencesActivated: 99,
          obsessionGained: 99,
          fixationsUsed: 99,
          elementalBonusHits: 99,
          afterpartyTriggers: 99,
          equipmentPlayed: 99,
          expensiveCardsPlayed: 99,
          mostOfOneCurrent: 99,
          primaryCurrent: "root",
          factionId: "touch-grass-order",
        }),
        outcomeOf({ playedAt: now, won: true, factionId: "neon-idols", primaryCurrent: "pulse" })
      );
    });
    return view.active.missionId;
  };

  it("pays the published amount and takes the mission away", () => {
    // pin the account's age so the Rookie Road multiplier is not a coin flip
    profileStore.update((draft) => {
      draft.createdAt = MONDAY_NOON;
    });
    const missionId = completeADaily(MONDAY_NOON);
    const before = getProfile();
    const paid = claimMission(content, "daily", missionId, MONDAY_NOON);

    const published = content.balance.economy.missions;
    expect(paid).toBeTruthy();
    expect(paid!.clout).toBe(published.dailyClout * published.rookieRoadMultiplier); // new account
    expect(paid!.xp).toBe(published.dailyXp);
    expect(getProfile().clout).toBe(before.clout + paid!.clout);
    expect(getProfile().missions.rotation.daily.some((m) => m.missionId === missionId)).toBe(false);
  });

  it("refuses a mission that is not finished", () => {
    const views = syncMissions(content, MONDAY_NOON);
    const view = views.find((entry) => entry.active.cadence === "daily")!;
    expect(view.progress.complete).toBe(false);
    expect(claimMission(content, "daily", view.active.missionId, MONDAY_NOON)).toBeNull();
    expect(getProfile().clout).toBe(500);
  });

  it("cannot be claimed twice", () => {
    const missionId = completeADaily(MONDAY_NOON);
    expect(claimMission(content, "daily", missionId, MONDAY_NOON)).toBeTruthy();
    const after = getProfile().clout;
    expect(claimMission(content, "daily", missionId, MONDAY_NOON)).toBeNull();
    expect(getProfile().clout).toBe(after);
  });

  /** §8.1: dailies pay double for the account's first 28 days, then normally. */
  it("pays the Rookie Road rate, and stops when it ends", () => {
    profileStore.update((draft) => {
      draft.createdAt = MONDAY_NOON;
    });
    const published = content.balance.economy.missions;

    const early = completeADaily(MONDAY_NOON + DAY_MS);
    expect(claimMission(content, "daily", early, MONDAY_NOON + DAY_MS)!.clout).toBe(
      published.dailyClout * published.rookieRoadMultiplier
    );

    const late = MONDAY_NOON + (published.rookieRoadDays + 1) * DAY_MS;
    const later = completeADaily(late);
    expect(claimMission(content, "daily", later, late)!.clout).toBe(published.dailyClout);
  });
});

describe("the rest of the contract", () => {
  it("pays the first win of the day once, and only for a win", () => {
    const record = playRecord(11, "idols-lumi-starcall", "goth-leader-alaric-thornheart");
    const published = content.balance.economy.missions.firstWinOfDayClout;

    const loss = recordMatch(record, "loss", {
      deckName: "A",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "x",
      mode: "ai-casual",
      content,
      now: MONDAY_NOON,
    });
    expect(loss.firstWinBonus).toBe(0);

    const first = recordMatch(record, "win", {
      deckName: "A",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "x",
      mode: "ai-casual",
      content,
      now: MONDAY_NOON,
    });
    expect(first.firstWinBonus).toBe(published);

    const second = recordMatch(record, "win", {
      deckName: "A",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "x",
      mode: "ai-casual",
      content,
      now: MONDAY_NOON + 3600_000,
    });
    expect(second.firstWinBonus, "the day's bonus paid twice").toBe(0);

    const tomorrow = recordMatch(record, "win", {
      deckName: "A",
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "x",
      mode: "ai-casual",
      content,
      now: MONDAY_NOON + DAY_MS,
    });
    expect(tomorrow.firstWinBonus).toBe(published);
  });

  it("hands out the Weekly Restock once a week", () => {
    const published = content.balance.economy.missions.weeklyRestockDrops;
    expect(restockAvailable(content, MONDAY_NOON)).toBe(published);
    expect(claimWeeklyRestock(content, MONDAY_NOON)).toBe(published);
    expect(getProfile().pendingDrops).toBe(published);
    expect(claimWeeklyRestock(content, MONDAY_NOON)).toBe(0);
    expect(claimWeeklyRestock(content, MONDAY_NOON + 7 * DAY_MS)).toBe(published);
  });

  /**
   * §3.5's own table has to add up, and what ships has to be a subset of it that
   * is accounted for line by line. The remainder is not a rounding error — it is
   * ranked chests, the login cycle and the season pass, none of which exist.
   */
  it("reconciles with the published weekly total", () => {
    const m = content.balance.economy.missions;
    const shipped =
      7 * DAILY_SLOTS * m.dailyClout + // 3 dailies a day
      7 * m.firstWinOfDayClout + // first win of the day
      3 * m.weeklyClout; // 3 weeklies a week

    // the design's own line items for the parts that ship
    expect(7 * DAILY_SLOTS * m.dailyClout).toBe(1050);
    expect(7 * m.firstWinOfDayClout).toBe(210);
    expect(3 * m.weeklyClout).toBe(600);
    expect(shipped).toBe(1860);

    // …and the published total, with the unbuilt sources named rather than
    // absorbed: ranked weekly chest 150, login cycle 100, season pass 190
    const PUBLISHED_WEEKLY_TOTAL = 2300;
    const NOT_BUILT = 150 + 100 + 190;
    expect(shipped + NOT_BUILT).toBe(PUBLISHED_WEEKLY_TOTAL);
  });
});

describe("progress is evidence, not a counter", () => {
  /**
   * Pinned to a known mission rather than whatever the rotation rolled. The
   * first version guarded the assertion with `if (view)` and so did nothing at
   * all on most seeds — it passed against a deliberately broken evidence window.
   */
  it("ignores matches played before the mission was issued", () => {
    syncMissions(content, MONDAY_NOON);
    profileStore.update((draft) => {
      draft.missions.rotation.daily = [
        { missionId: "feed-the-algorithm", cadence: "daily", issuedAt: MONDAY_NOON, periodIndex: dayIndex(MONDAY_NOON) },
      ];
      draft.missions.outcomes.push(outcomeOf({ playedAt: MONDAY_NOON - DAY_MS, cardsPlayed: 99 }));
    });
    const view = missionViews(content, MONDAY_NOON).find(
      (entry) => entry.active.missionId === "feed-the-algorithm"
    )!;
    expect(view.progress.parts[0]!.have, "a mission counted a match from before it existed").toBe(0);
  });

  /**
   * A banked mission measures from when it was issued, so two matches on two
   * later days both count. Pinned to a known mission rather than whatever the
   * rotation rolled, so the assertion is about the window and not about luck.
   */
  it("counts matches played after it, across days", () => {
    syncMissions(content, MONDAY_NOON);
    profileStore.update((draft) => {
      draft.missions.rotation.daily = [
        { missionId: "feed-the-algorithm", cadence: "daily", issuedAt: MONDAY_NOON, periodIndex: dayIndex(MONDAY_NOON) },
      ];
      draft.missions.outcomes.push(
        outcomeOf({ playedAt: MONDAY_NOON + DAY_MS, cardsPlayed: 12 }),
        outcomeOf({ playedAt: MONDAY_NOON + 2 * DAY_MS, cardsPlayed: 8 })
      );
    });
    const view = missionViews(content, MONDAY_NOON + 2 * DAY_MS).find(
      (entry) => entry.active.missionId === "feed-the-algorithm"
    )!;
    expect(view.progress.parts[0]!.have, "a banked mission lost the days it was open for").toBe(20);
    expect(view.progress.complete).toBe(true);
  });
});
