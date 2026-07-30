/**
 * Limited-time events — `09-game-modes.md` §14 and `03-screens-and-navigation.md`
 * §4.4.3.
 *
 * The live-ops container, built for a game with no live ops. §14's ship status is
 * *"Online-later (live scheduling requires the service). Concluded PvE event
 * content is archived into the offline Event Hub as replayable 'Rerun' entries
 * with base rewards."* — so what ships is the offline half, honestly: events
 * whose schedule is **published data** rather than a server broadcast, and an
 * archive that says when each one comes back.
 *
 * ## What is derived and what is stored
 *
 * Derived, every time: which run an event is in, whether it is active, upcoming
 * or ended, when it ends, what a mission still needs, what the shop still has.
 * All of it falls out of `(data/events.json, the save, the clock)`.
 *
 * Stored, because it genuinely cannot be recomputed: currency earned, what was
 * bought, which mission rewards were taken, and which finished runs have already
 * paid their leftovers out.
 *
 * ## Why mission progress is credited rather than recomputed
 *
 * The missions system recomputes progress from `profile.missions.outcomes` — a
 * log deliberately pruned to `evidenceHorizon()`, which is *"the oldest held
 * mission's `issuedAt`"*, roughly a week, and hard-capped at 200 entries. An
 * event runs a fortnight. Recomputing from that log would silently drop the
 * event's first week, and a player would watch progress they had earned walk
 * backwards.
 *
 * So event progress is **credited additively at match end**, in the same place
 * `achievements.tally` already credits. That is only correct for requirements
 * that decompose over matches, which `sum` and `matches` do and `distinct` does
 * not: a running total cannot know whether today's faction was already counted.
 * `checkEventData` refuses `distinct` in an event mission for exactly that
 * reason, so the limitation is enforced rather than remembered.
 *
 * What is *not* re-implemented: the objective vocabulary and `matchesFilter` are
 * the missions system's, imported. Only the accumulation differs.
 */

import type { ContentIndex } from "../../engine/types";
import type { MatchOutcome, Objective, Requirement } from "../missions/types";
import { matchesFilter } from "../missions/objectives";
import { cosmeticById } from "../cosmetics";
import { eventsData, type EventDef, type EventRun, type EventShopEntry } from "./data";

export type { EventDef, EventRun, EventCurrency, EventMissionDef, EventShopEntry } from "./data";
export { eventsData, eventById } from "./data";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

export const runStart = (run: EventRun): number => Date.parse(run.startAt);
export const runEnd = (run: EventRun): number => runStart(run) + run.days * DAY_MS;

/** Every event, in the order the file lists them. */
export const allEvents = (): EventDef[] => eventsData().events;

// `eventById` lives in ./data — see the note there about the cosmetics cycle

/** The run happening right now, or null. Windows never overlap — `checkEventData` forbids it. */
export function activeRun(event: EventDef, now: number): EventRun | null {
  return event.runs.find((run) => now >= runStart(run) && now < runEnd(run)) ?? null;
}

/** The next run that has not started yet, or null when the calendar is exhausted. */
export function nextRun(event: EventDef, now: number): EventRun | null {
  return (
    [...event.runs]
      .sort((a, b) => runStart(a) - runStart(b))
      .find((run) => runStart(run) > now) ?? null
  );
}

/** The most recent run that has finished, or null. */
export function lastEndedRun(event: EventDef, now: number): EventRun | null {
  return (
    [...event.runs]
      .filter((run) => runEnd(run) <= now)
      .sort((a, b) => runEnd(b) - runEnd(a))[0] ?? null
  );
}

export type EventPhase = "active" | "upcoming" | "ended";

/**
 * Where an event stands right now.
 *
 * "ended" means *this run* has ended, not that the event is gone — an ended
 * event with a `nextRun` is the archive's rerun notice, which is the whole
 * reason §14 can promise nothing is permanently missable.
 */
export function eventPhase(event: EventDef, now: number): EventPhase {
  if (activeRun(event, now)) return "active";
  if (lastEndedRun(event, now)) return "ended";
  return "upcoming";
}

export const liveEvents = (now: number): EventDef[] => allEvents().filter((e) => eventPhase(e, now) === "active");
export const upcomingEvents = (now: number): EventDef[] =>
  allEvents()
    .filter((e) => eventPhase(e, now) === "upcoming")
    .sort((a, b) => (nextRun(a, now) ? runStart(nextRun(a, now)!) : 0) - (nextRun(b, now) ? runStart(nextRun(b, now)!) : 0));
export const archivedEvents = (now: number): EventDef[] => allEvents().filter((e) => eventPhase(e, now) === "ended");

// ---------------------------------------------------------------------------
// Save state
// ---------------------------------------------------------------------------

/** One leftover-currency payout, kept so the inbox can derive its receipt. */
export interface EventConversion {
  /** the run that ended, by its start timestamp */
  runStart: number;
  tokens: number;
  clout: number;
  at: number;
}

export interface EventState {
  eventId: string;
  /**
   * Per mission, per requirement, the running total. Indexed by the requirement's
   * position in its objective, which is stable because the objective is data.
   */
  progress: Record<string, number[]>;
  /** missions whose reward has been taken — a mission pays once, ever, across reruns */
  claimed: string[];
  /** spendable balance */
  balance: number;
  /** lifetime earned, for the screen's "you have earned N" line */
  earned: number;
  /** shop entry id → copies bought, across every run, which is what makes a rerun restore stock */
  bought: Record<string, number>;
  /** leftovers already paid out, so a finished run converts exactly once */
  conversions: EventConversion[];
  /** the completion meta-reward has been granted */
  completionGranted: boolean;
}

export const emptyEventState = (eventId: string): EventState => ({
  eventId,
  progress: {},
  claimed: [],
  balance: 0,
  earned: 0,
  bought: {},
  conversions: [],
  completionGranted: false,
});

/** Read a state out of a bag that may not have one yet. */
export const stateFor = (states: Readonly<Record<string, EventState>>, eventId: string): EventState =>
  states[eventId] ?? emptyEventState(eventId);

// ---------------------------------------------------------------------------
// Mission progress
// ---------------------------------------------------------------------------

const requirementsOf = (objective: Objective): Requirement[] => objective.all ?? objective.any ?? [];

/**
 * What one finished match adds to one requirement.
 *
 * `matchesFilter` is the missions system's, so "which matches count" has exactly
 * one answer in this codebase. Only the accumulation lives here.
 */
function creditFor(requirement: Requirement, outcome: MatchOutcome): number {
  if (!matchesFilter(outcome, requirement.filter)) return 0;
  if (requirement.need === "matches") return 1;
  if (requirement.need === "sum") return outcome.stats[requirement.stat] ?? 0;
  // `distinct` cannot be credited additively, and `checkEventData` refuses it in
  // event data — this is the unreachable arm, kept explicit rather than silent
  return 0;
}

/** Is this mission's objective satisfied by its running totals? */
export function missionComplete(objective: Objective, totals: readonly number[]): boolean {
  const requirements = requirementsOf(objective);
  const met = requirements.map((requirement, index) => (totals[index] ?? 0) >= requirement.target);
  return objective.any ? met.some(Boolean) : met.every(Boolean);
}

/**
 * Credit one finished match to an event, returning the next state.
 *
 * Pure: the caller writes the result. Credits **only while a run is active** —
 * a match played between runs is not played at the event.
 */
export function creditMatch(event: EventDef, state: EventState, outcome: MatchOutcome, now: number): EventState {
  if (!activeRun(event, now)) return state;

  const progress: Record<string, number[]> = { ...state.progress };
  for (const mission of event.missions) {
    const requirements = requirementsOf(mission.objective);
    const totals = [...(progress[mission.id] ?? new Array<number>(requirements.length).fill(0))];
    let moved = false;
    requirements.forEach((requirement, index) => {
      const gain = creditFor(requirement, outcome);
      if (gain <= 0) return;
      // capped at the target: a total that runs away is a number nothing reads
      // and a progress bar that cannot draw itself
      totals[index] = Math.min(requirement.target, (totals[index] ?? 0) + gain);
      moved = true;
    });
    if (moved) progress[mission.id] = totals;
  }
  return { ...state, progress };
}

// ---------------------------------------------------------------------------
// Claiming, buying, and the payout a finished run owes
// ---------------------------------------------------------------------------

export interface ClaimResult {
  state: EventState;
  /** currency paid, 0 when there was nothing to claim */
  paid: number;
}

/** Take a completed mission's reward. Idempotent: a mission pays once, ever. */
export function claimMission(event: EventDef, state: EventState, missionId: string): ClaimResult {
  const mission = event.missions.find((entry) => entry.id === missionId);
  if (!mission) return { state, paid: 0 };
  if (state.claimed.includes(missionId)) return { state, paid: 0 };
  if (!missionComplete(mission.objective, state.progress[missionId] ?? [])) return { state, paid: 0 };

  return {
    state: {
      ...state,
      claimed: [...state.claimed, missionId],
      balance: state.balance + mission.reward,
      earned: state.earned + mission.reward,
    },
    paid: mission.reward,
  };
}

/** Copies of a shop row still on the shelf. Bought counts persist across reruns. */
export const stockLeft = (state: EventState, entry: EventShopEntry): number =>
  Math.max(0, entry.stock - (state.bought[entry.id] ?? 0));

export interface PurchaseResult {
  state: EventState;
  entry: EventShopEntry | null;
  problem: string | null;
}

/**
 * Buy one copy of a shop row.
 *
 * Returns the row so the caller can pay it out — this module moves the event's
 * own currency and nothing else. Clout, Signal, Drops and cosmetics belong to
 * the profile, and granting them from here would be a second owner for each.
 */
export function buyShopEntry(event: EventDef, state: EventState, entryId: string, now: number): PurchaseResult {
  const entry = event.shop.find((row) => row.id === entryId) ?? null;
  if (!entry) return { state, entry: null, problem: "no such item" };
  if (!activeRun(event, now)) return { state, entry: null, problem: "the shop is open only while the event is running" };
  if (stockLeft(state, entry) <= 0) return { state, entry: null, problem: "sold out" };
  if (state.balance < entry.cost) {
    return { state, entry: null, problem: `${entry.cost - state.balance} more ${event.currency.name} needed` };
  }

  return {
    state: {
      ...state,
      balance: state.balance - entry.cost,
      bought: { ...state.bought, [entry.id]: (state.bought[entry.id] ?? 0) + 1 },
    },
    entry,
    problem: null,
  };
}

/** Missions completed and claimed — what the completion meta-reward counts. */
export const claimedCount = (state: EventState): number => state.claimed.length;

export const completionEarned = (event: EventDef, state: EventState): boolean =>
  claimedCount(state) >= event.completion.missionsRequired;

/**
 * What a finished run owes the player, if anything.
 *
 * `07-economy-and-monetization.md`: *"Event currency never expires into nothing:
 * when an event ends, leftover event currency auto-converts to Clout at 1 : 5,
 * logged in the inbox."* The rate is `conversionToClout` in the data file, in
 * one place, so the sentence the screen prints and the number the profile pays
 * cannot drift apart.
 *
 * Returns null when there is nothing to settle — no finished run, nothing left
 * over, or this run has already been paid.
 */
export function pendingConversion(event: EventDef, state: EventState, now: number): EventConversion | null {
  const ended = lastEndedRun(event, now);
  if (!ended) return null;
  const startedAt = runStart(ended);
  if (state.conversions.some((entry) => entry.runStart === startedAt)) return null;
  if (state.balance <= 0) return null;

  return {
    runStart: startedAt,
    tokens: state.balance,
    clout: state.balance * eventsData().conversionToClout,
    at: now,
  };
}

/** Apply a pending conversion. The caller credits the Clout — the profile owns that. */
export function applyConversion(state: EventState, conversion: EventConversion): EventState {
  return {
    ...state,
    balance: 0,
    conversions: [...state.conversions, conversion],
  };
}

// ---------------------------------------------------------------------------
// The view the screen draws
// ---------------------------------------------------------------------------

export interface EventMissionView {
  id: string;
  name: string;
  text: string;
  reward: number;
  /** 0..1 across every requirement, for one bar */
  fraction: number;
  complete: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface EventShopView {
  entry: EventShopEntry;
  left: number;
  affordable: boolean;
  soldOut: boolean;
}

export interface EventView {
  event: EventDef;
  phase: EventPhase;
  /** the run in progress, or null */
  run: EventRun | null;
  /** real end time of the active run — no countdown outlives its event */
  endsAt: number | null;
  /** when it next opens, for an upcoming event or an archived one's rerun notice */
  returnsAt: number | null;
  balance: number;
  earned: number;
  missions: EventMissionView[];
  shop: EventShopView[];
  claimedCount: number;
  missionsRequired: number;
  completionEarned: boolean;
  completionGranted: boolean;
}

export function eventView(event: EventDef, state: EventState, now: number): EventView {
  const run = activeRun(event, now);
  const phase = eventPhase(event, now);
  const upcoming = nextRun(event, now);
  const live = run !== null;

  const missions: EventMissionView[] = event.missions.map((mission) => {
    const requirements = requirementsOf(mission.objective);
    const totals = state.progress[mission.id] ?? [];
    const fractions = requirements.map((requirement, index) =>
      Math.min(1, (totals[index] ?? 0) / requirement.target)
    );
    // an `any` objective is as done as its best branch; an `all` as its worst
    const fraction =
      fractions.length === 0 ? 0 : mission.objective.any ? Math.max(...fractions) : Math.min(...fractions);
    const complete = missionComplete(mission.objective, totals);
    const claimed = state.claimed.includes(mission.id);
    return {
      id: mission.id,
      name: mission.name,
      text: mission.text,
      reward: mission.reward,
      fraction,
      complete,
      claimed,
      claimable: complete && !claimed,
    };
  });

  return {
    event,
    phase,
    run,
    endsAt: run ? runEnd(run) : null,
    returnsAt: upcoming ? runStart(upcoming) : null,
    balance: state.balance,
    earned: state.earned,
    missions,
    shop: event.shop.map((entry) => {
      const left = stockLeft(state, entry);
      return {
        entry,
        left,
        soldOut: left <= 0,
        // an item you cannot buy because the doors are shut is not "unaffordable"
        affordable: live && state.balance >= entry.cost && left > 0,
      };
    }),
    claimedCount: claimedCount(state),
    missionsRequired: event.completion.missionsRequired,
    completionEarned: completionEarned(event, state),
    completionGranted: state.completionGranted,
  };
}

// ---------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------

/**
 * What §14 asks for that this build does not do, and why.
 *
 * The same allowlist discipline the cosmetics, achievements and accessibility
 * blocks use: an entry earns its place by naming a blocker that is *currently
 * true*, and `checkEventData` fails the day one stops being true.
 */
export const DEFERRED_EVENTS: ReadonlyMap<string, string> = new Map([
  [
    "Live-ops scheduling",
    "§14 ships events from a service that pushes schedules and can start one at an hour's notice; there is no service, so every run window in this build is published in data months ahead and the calendar cannot change without a release",
  ],
  [
    "Event leaderboards",
    "§4.4.3 asks for a leaderboard tab per event, which ranks an account against other accounts — there are no other accounts offline, and a board showing one name is a mirror rather than a ranking",
  ],
  [
    "Distinct-value event missions",
    "an event mission is credited additively as each match finishes, because the outcome log is pruned to roughly a week and an event runs a fortnight; a distinct count needs the whole set of matches at once, so a running total cannot tell whether today's faction was already counted",
  ],
  [
    "Event card variants in the shop",
    "§14 lists event card variants as shop stock and the variant system exists, but a variant is art — the build renders cards procedurally and every variant would draw identically to the card it is a variant of, which is a reward you cannot see",
  ],
  [
    "Event-scoped rule modifiers",
    "§14's data bundle includes modifiers that change how a match plays, and the mechanism now exists — the Remix Queue's `remixMatchConfig` turns a data-authored rule into balance overrides and a leader passive for any mode; what is missing is the smaller half, an event naming which rule it wants and the battle routes its featured modes use honouring it",
  ],
]);

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** Everything wrong with `data/events.json`. */
export function checkEventData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const data = eventsData();
  const seenIds = new Set<string>();
  const seenCurrencies = new Set<string>();

  for (const event of data.events) {
    const where = `events.${event.id}`;
    if (seenIds.has(event.id)) problems.push(`${where}: duplicate event id`);
    seenIds.add(event.id);

    if (seenCurrencies.has(event.currency.id)) {
      problems.push(`${where}: currency id "${event.currency.id}" is used by another event — two balances would share one purse`);
    }
    seenCurrencies.add(event.currency.id);

    /**
     * The rerun promise, held to.
     *
     * §14: *"every event returns within 2 seasons"* and *"nothing gameplay-relevant
     * is permanently missable"*. Both are properties of this list of dates or they
     * are not properties at all.
     */
    const runs = [...event.runs].sort((a, b) => runStart(a) - runStart(b));
    runs.forEach((run, index) => {
      if (!Number.isFinite(runStart(run))) problems.push(`${where}: run ${index} has an unparseable startAt`);
      const previous = runs[index - 1];
      if (!previous) return;
      if (runStart(run) < runEnd(previous)) {
        problems.push(`${where}: run ${index} starts before run ${index - 1} has ended — windows must not overlap`);
      }
      const gapWeeks = (runStart(run) - runStart(previous)) / WEEK_MS;
      if (gapWeeks > data.rerunWithinWeeks) {
        problems.push(
          `${where}: run ${index} is ${Math.round(gapWeeks)} weeks after run ${index - 1}, past the ${data.rerunWithinWeeks}-week rerun promise`
        );
      }
    });

    // missions
    const missionIds = new Set<string>();
    for (const mission of event.missions) {
      if (missionIds.has(mission.id)) problems.push(`${where}: duplicate mission id "${mission.id}"`);
      missionIds.add(mission.id);
      const requirements = mission.objective.all ?? mission.objective.any ?? [];
      for (const requirement of requirements) {
        if (requirement.need === "distinct") {
          problems.push(
            `${where}.${mission.id}: a "distinct" requirement cannot be credited additively, and event progress is credited per match — see DEFERRED_EVENTS`
          );
        }
      }
    }

    // shop
    const shopIds = new Set<string>();
    for (const entry of event.shop) {
      if (shopIds.has(entry.id)) problems.push(`${where}: duplicate shop id "${entry.id}"`);
      shopIds.add(entry.id);
      if (entry.kind === "cosmetic" && !cosmeticById(content, entry.ref)) {
        problems.push(`${where}.${entry.id}: cosmetic "${entry.ref}" does not resolve — it would cost currency and grant nothing`);
      }
    }

    // completion
    if (event.completion.missionsRequired > event.missions.length) {
      problems.push(
        `${where}: completion needs ${event.completion.missionsRequired} missions but the event only has ${event.missions.length}`
      );
    }
    if (!cosmeticById(content, event.completion.cosmeticId)) {
      problems.push(`${where}: completion cosmetic "${event.completion.cosmeticId}" does not resolve`);
    }
  }

  if (DEFERRED_EVENTS.size === 0) {
    problems.push("DEFERRED_EVENTS is empty — every part of §14 would have to be built");
  }
  for (const [name, reason] of DEFERRED_EVENTS) {
    if (reason.trim().length < 40) problems.push(`DEFERRED_EVENTS "${name}": deferred without a real reason`);
  }

  return problems;
}
