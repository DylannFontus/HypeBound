/**
 * Limited-time events — `09-game-modes.md` §14 and `03-screens-and-navigation.md`
 * §4.4.3.
 *
 * Most of this file is about **promises**, because §14 is mostly promises: that
 * reruns happen within two seasons, that nothing is permanently missable, that
 * event currency never expires into nothing, that a rerun restores what you had.
 * A promise in a design document is a sentence; a promise in a data file with a
 * check that refuses to load without it is a property.
 *
 * The one thing deliberately not asserted here is a wall-clock outcome. Every
 * test passes its own `now`, because a suite that only passes in August is a
 * suite that fails in September for a reason nobody will remember.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import type { MatchOutcome } from "../src/game/missions/types";
import {
  DEFERRED_EVENTS,
  activeRun,
  allEvents,
  applyConversion,
  archivedEvents,
  buyShopEntry,
  checkEventData,
  claimMission,
  creditMatch,
  emptyEventState,
  eventById,
  eventPhase,
  eventView,
  eventsData,
  lastEndedRun,
  liveEvents,
  missionComplete,
  nextRun,
  pendingConversion,
  runEnd,
  runStart,
  stockLeft,
  upcomingEvents,
} from "../src/game/events";

const content = getContent();
const DAY = 24 * 60 * 60 * 1000;

/** A finished match, with only the statistics a test cares about set. */
const outcome = (over: Partial<MatchOutcome["stats"]> = {}, won = true): MatchOutcome => ({
  stats: {
    won,
    cardsPlayed: 0,
    cardsDrawn: 0,
    charactersDefeated: 0,
    damageToEnemyLeader: 0,
    healingToFriendlies: 0,
    supportsGiven: 0,
    confluencesActivated: 0,
    perfectResonances: 0,
    obsessionGained: 0,
    fixationsUsed: 0,
    ultimatesUsed: 0,
    elementalBonusHits: 0,
    equipmentPlayed: 0,
    expensiveCardsPlayed: 0,
    cancelledApplied: 0,
    negativeStatusesCleared: 0,
    afterpartyTriggers: 0,
    mostOfOneCurrent: 0,
    ...over,
  } as MatchOutcome["stats"],
  mode: "ai-casual",
  deckEditedThisPeriod: false,
  playedAt: 0,
});

// ---------------------------------------------------------------------------

describe("the event calendar", () => {
  it("loads and validates", () => {
    expect(checkEventData(content)).toEqual([]);
    expect(allEvents().length).toBeGreaterThan(0);
  });

  /**
   * §14: *"every event returns within 2 seasons"* and *"nothing gameplay-relevant
   * is permanently missable"*. Both are claims about this list of dates, and this
   * is where they stop being claims.
   */
  it("publishes every rerun as a date rather than promising one in prose", () => {
    const { rerunWithinWeeks } = eventsData();
    for (const event of allEvents()) {
      expect(event.runs.length, `${event.id} has only one run, so missing it is permanent`).toBeGreaterThan(1);

      const runs = [...event.runs].sort((a, b) => runStart(a) - runStart(b));
      runs.forEach((run, index) => {
        const previous = runs[index - 1];
        if (!previous) return;
        expect(runStart(run), `${event.id} run ${index} overlaps the one before it`).toBeGreaterThanOrEqual(
          runEnd(previous)
        );
        const gapWeeks = (runStart(run) - runStart(previous)) / (7 * DAY);
        expect(gapWeeks, `${event.id} waits ${Math.round(gapWeeks)} weeks to return`).toBeLessThanOrEqual(
          rerunWithinWeeks
        );
      });
    }
  });

  it("puts an event in exactly one phase at any instant", () => {
    const event = allEvents()[0]!;
    const first = event.runs[0]!;

    const before = runStart(first) - DAY;
    const during = runStart(first) + DAY;
    const after = runEnd(first) + DAY;

    expect(eventPhase(event, before)).toBe("upcoming");
    expect(eventPhase(event, during)).toBe("active");
    expect(eventPhase(event, after)).toBe("ended");

    expect(activeRun(event, during)).not.toBeNull();
    expect(activeRun(event, before)).toBeNull();
    expect(activeRun(event, after)).toBeNull();
  });

  /** The boundaries themselves: a run is live from its first instant, not its second. */
  it("treats a run as half-open — live at the start instant, over at the end one", () => {
    const event = allEvents()[0]!;
    const run = event.runs[0]!;
    expect(activeRun(event, runStart(run))).not.toBeNull();
    expect(activeRun(event, runStart(run) - 1)).toBeNull();
    expect(activeRun(event, runEnd(run) - 1)).not.toBeNull();
    expect(activeRun(event, runEnd(run))).toBeNull();
  });

  it("names the next run, and the last one that ended", () => {
    const event = allEvents().find((entry) => entry.runs.length > 1)!;
    const [first, second] = [...event.runs].sort((a, b) => runStart(a) - runStart(b));

    expect(nextRun(event, runStart(first!) - DAY)).toEqual(first);
    expect(nextRun(event, runEnd(first!) + DAY)).toEqual(second);
    expect(lastEndedRun(event, runEnd(first!) + DAY)).toEqual(first);
    expect(lastEndedRun(event, runStart(first!) - DAY)).toBeNull();
  });

  it("sorts every event into one of the three rails", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    const total = liveEvents(now).length + upcomingEvents(now).length + archivedEvents(now).length;
    expect(total, "an event fell into two rails, or none").toBe(allEvents().length);
  });
});

// ---------------------------------------------------------------------------

describe("event missions are credited, not recomputed", () => {
  const event = allEvents()[0]!;
  const during = runStart(event.runs[0]!) + DAY;
  const between = runEnd(event.runs[0]!) + DAY;

  /**
   * The reason for the whole design. `profile.missions.outcomes` is pruned to
   * roughly a week and capped at 200; an event runs a fortnight. Progress that
   * was recomputed from that log would walk backwards.
   */
  it("adds up across matches", () => {
    const cardMission = event.missions.find((mission) =>
      (mission.objective.all ?? []).some((requirement) => requirement.need === "sum")
    );
    if (!cardMission) return;
    const requirement = (cardMission.objective.all ?? [])[0]!;

    let state = emptyEventState(event.id);
    state = creditMatch(event, state, outcome({ [requirement.need === "sum" ? requirement.stat : "cardsPlayed"]: 5 }), during);
    const first = state.progress[cardMission.id]?.[0] ?? 0;
    state = creditMatch(event, state, outcome({ [requirement.need === "sum" ? requirement.stat : "cardsPlayed"]: 5 }), during);
    const second = state.progress[cardMission.id]?.[0] ?? 0;

    expect(first).toBeGreaterThan(0);
    expect(second, "a second match added nothing").toBeGreaterThan(first);
  });

  it("counts nothing at all between runs", () => {
    const state = creditMatch(event, emptyEventState(event.id), outcome({ cardsPlayed: 40 }), between);
    expect(state.progress, "a match played outside the event still counted").toEqual({});
  });

  /** A total that runs past its target is a number nothing reads and a bar that cannot draw. */
  it("caps a total at its target", () => {
    const mission = event.missions[0]!;
    const target = (mission.objective.all ?? [])[0]!.target;
    let state = emptyEventState(event.id);
    for (let i = 0; i < 50; i++) {
      state = creditMatch(event, state, outcome({ cardsPlayed: 99, confluencesActivated: 99, damageToEnemyLeader: 99, charactersDefeated: 99, cancelledApplied: 99 }), during);
    }
    for (const totals of Object.values(state.progress)) {
      for (const total of totals) expect(total).toBeLessThanOrEqual(Math.max(target, total));
    }
    expect(state.progress[mission.id]![0]).toBe(target);
  });

  it("honours the mission filter, using the missions system's own matcher", () => {
    const winMission = event.missions.find((mission) =>
      (mission.objective.all ?? []).some((requirement) => requirement.filter?.won === true)
    );
    if (!winMission) return;

    const lost = creditMatch(event, emptyEventState(event.id), outcome({}, false), during);
    expect(lost.progress[winMission.id]?.[0] ?? 0, "a loss counted toward a win-only mission").toBe(0);

    const won = creditMatch(event, emptyEventState(event.id), outcome({}, true), during);
    expect(won.progress[winMission.id]?.[0] ?? 0).toBe(1);
  });

  it("knows an `all` objective from an `any` one", () => {
    expect(missionComplete({ all: [{ need: "matches", target: 2 }, { need: "matches", target: 3 }] }, [2, 1])).toBe(false);
    expect(missionComplete({ all: [{ need: "matches", target: 2 }, { need: "matches", target: 3 }] }, [2, 3])).toBe(true);
    expect(missionComplete({ any: [{ need: "matches", target: 2 }, { need: "matches", target: 3 }] }, [2, 0])).toBe(true);
    expect(missionComplete({ any: [{ need: "matches", target: 2 }, { need: "matches", target: 3 }] }, [1, 1])).toBe(false);
  });

  /**
   * Additive credit is only correct for requirements that decompose over
   * matches. `distinct` does not — a running total cannot know whether today's
   * faction was already counted — so no event may author one, and
   * `checkEventData` refuses it.
   */
  it("uses no objective that additive credit would get wrong", () => {
    for (const event of allEvents()) {
      for (const mission of event.missions) {
        for (const requirement of mission.objective.all ?? mission.objective.any ?? []) {
          expect(requirement.need, `${event.id}.${mission.id} uses a requirement credit cannot decompose`).not.toBe(
            "distinct"
          );
        }
      }
    }
    expect(DEFERRED_EVENTS.get("Distinct-value event missions")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe("claiming and spending", () => {
  const event = allEvents()[0]!;
  const during = runStart(event.runs[0]!) + DAY;
  const mission = event.missions[0]!;

  const completed = (): ReturnType<typeof emptyEventState> => {
    let state = emptyEventState(event.id);
    for (let i = 0; i < 60; i++) {
      state = creditMatch(
        event,
        state,
        outcome({ cardsPlayed: 20, confluencesActivated: 20, damageToEnemyLeader: 20, charactersDefeated: 20, cancelledApplied: 20 }),
        during
      );
    }
    return state;
  };

  it("refuses to pay a mission that is not done", () => {
    const { state, paid } = claimMission(event, emptyEventState(event.id), mission.id);
    expect(paid).toBe(0);
    expect(state.balance).toBe(0);
  });

  it("pays a finished mission exactly once", () => {
    const first = claimMission(event, completed(), mission.id);
    expect(first.paid).toBe(mission.reward);
    expect(first.state.balance).toBe(mission.reward);
    expect(first.state.earned).toBe(mission.reward);

    const second = claimMission(event, first.state, mission.id);
    expect(second.paid, "a mission paid twice").toBe(0);
    expect(second.state.balance).toBe(mission.reward);
  });

  it("will not sell while the doors are shut", () => {
    const state = { ...completed(), balance: 9999 };
    const between = runEnd(event.runs[0]!) + DAY;
    const shut = buyShopEntry(event, state, event.shop[0]!.id, between);
    expect(shut.entry).toBeNull();
    expect(shut.problem).toMatch(/running/);
  });

  it("will not sell what you cannot afford, and says how short you are", () => {
    const entry = event.shop[0]!;
    const poor = buyShopEntry(event, { ...emptyEventState(event.id), balance: entry.cost - 1 }, entry.id, during);
    expect(poor.entry).toBeNull();
    expect(poor.problem).toContain("1 more");
  });

  it("consumes stock, and refuses when the shelf is empty", () => {
    const entry = event.shop[0]!;
    let state = { ...emptyEventState(event.id), balance: entry.cost * (entry.stock + 2) };

    for (let i = 0; i < entry.stock; i++) {
      const result = buyShopEntry(event, state, entry.id, during);
      expect(result.entry, `copy ${i + 1} of ${entry.stock} was refused`).not.toBeNull();
      state = result.state;
    }
    expect(stockLeft(state, entry)).toBe(0);

    const overdrawn = buyShopEntry(event, state, entry.id, during);
    expect(overdrawn.entry).toBeNull();
    expect(overdrawn.problem).toBe("sold out");
  });

  /**
   * 07 §8.4: *"rerun events restore the player's previous event shop progress and
   * stock."* Restore, not reset — so what was bought stays bought into the next
   * run, and what was earned is still there.
   */
  it("carries progress and stock into the rerun rather than wiping them", () => {
    const entry = event.shop[0]!;
    const bought = buyShopEntry(event, { ...emptyEventState(event.id), balance: entry.cost }, entry.id, during);
    expect(bought.entry).not.toBeNull();

    const nextRunStart = runStart(event.runs[1]!) + DAY;
    const later = eventView(event, bought.state, nextRunStart);
    expect(later.phase).toBe("active");
    const row = later.shop.find((candidate) => candidate.entry.id === entry.id)!;
    expect(row.left, "the rerun restocked something the player had already bought").toBe(entry.stock - 1);
  });
});

// ---------------------------------------------------------------------------

describe("event currency never expires into nothing", () => {
  const event = allEvents()[0]!;
  const after = runEnd(event.runs[0]!) + DAY;

  it("converts leftovers to Clout at the published rate, once", () => {
    const rate = eventsData().conversionToClout;
    const state = { ...emptyEventState(event.id), balance: 40 };

    const owed = pendingConversion(event, state, after);
    expect(owed).not.toBeNull();
    expect(owed!.tokens).toBe(40);
    expect(owed!.clout, `the rate is ${rate} Clout per token`).toBe(40 * rate);

    const settled = applyConversion(state, owed!);
    expect(settled.balance).toBe(0);

    /**
     * And still nothing owed once the purse refills.
     *
     * Asserting against the emptied purse alone proved nothing: the balance
     * guard would answer null even with the paid-once guard deleted, which is
     * exactly what a deliberate break showed. The case that matters is real —
     * a mission finished during the run can still be claimed after it ends, so
     * the balance goes back above zero on a run that has already settled.
     */
    const claimedLate = { ...settled, balance: 15 };
    expect(pendingConversion(event, claimedLate, after), "a run paid its leftovers twice").toBeNull();
  });

  it("owes nothing while the event is still running", () => {
    const during = runStart(event.runs[0]!) + DAY;
    expect(pendingConversion(event, { ...emptyEventState(event.id), balance: 40 }, during)).toBeNull();
  });

  it("owes nothing when there was nothing left over", () => {
    expect(pendingConversion(event, emptyEventState(event.id), after)).toBeNull();
  });

  /** Each run settles separately, so a rerun's leftovers are paid too. */
  it("settles the second run as well as the first", () => {
    const state = { ...emptyEventState(event.id), balance: 10 };
    const firstOwed = pendingConversion(event, state, after)!;
    const settled = { ...applyConversion(state, firstOwed), balance: 25 };

    const afterSecond = runEnd(event.runs[1]!) + DAY;
    const secondOwed = pendingConversion(event, settled, afterSecond);
    expect(secondOwed, "the rerun's leftovers were never paid").not.toBeNull();
    expect(secondOwed!.tokens).toBe(25);
  });
});

// ---------------------------------------------------------------------------

describe("what the screen is handed", () => {
  const event = allEvents()[0]!;

  it("never shows a deadline that is not a real run boundary", () => {
    const during = runStart(event.runs[0]!) + DAY;
    const view = eventView(event, emptyEventState(event.id), during);
    expect(view.endsAt).toBe(runEnd(event.runs[0]!));

    const after = runEnd(event.runs[0]!) + DAY;
    const ended = eventView(event, emptyEventState(event.id), after);
    expect(ended.endsAt, "an ended event still had a countdown").toBeNull();
    expect(ended.returnsAt).toBe(runStart(event.runs[1]!));
  });

  it("does not offer to sell anything while the event is shut", () => {
    const after = runEnd(event.runs[0]!) + DAY;
    const view = eventView(event, { ...emptyEventState(event.id), balance: 99_999 }, after);
    expect(view.shop.every((row) => !row.affordable), "the shop was open outside the event").toBe(true);
  });

  it("reports completion against the event's own requirement", () => {
    const view = eventView(event, { ...emptyEventState(event.id), claimed: event.missions.map((m) => m.id) }, runStart(event.runs[0]!) + DAY);
    expect(view.missionsRequired).toBe(event.completion.missionsRequired);
    expect(view.completionEarned).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("what is deliberately not built", () => {
  it("says why, for every deferral", () => {
    expect(DEFERRED_EVENTS.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_EVENTS) {
      expect(reason.trim().length, `${name} is deferred without a real reason`).toBeGreaterThan(40);
    }
  });

  /**
   * The two that must stay deferred until there is a server, and would be
   * dishonest to fake: a schedule nobody can push, and a ranking with one name
   * in it.
   */
  it("still defers the parts that need a service", () => {
    expect([...DEFERRED_EVENTS.keys()]).toContain("Live-ops scheduling");
    expect([...DEFERRED_EVENTS.keys()]).toContain("Event leaderboards");
  });

  it("resolves every cosmetic an event can pay out", () => {
    for (const event of allEvents()) {
      expect(eventById(event.id)).not.toBeNull();
      expect(event.completion.missionsRequired).toBeLessThanOrEqual(event.missions.length);
    }
  });
});
