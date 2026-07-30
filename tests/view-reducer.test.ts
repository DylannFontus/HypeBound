/**
 * The view reducer, checked against the only oracle worth using: the engine.
 *
 * `applyEventsToView` exists so a networked client can keep its `PlayerView`
 * current between snapshots. Reasoning about it event by event is how it gets
 * written; it is not how it gets *verified*, because the failure mode is a
 * quiet divergence in one field of one event that only shows up in a match
 * nobody thought to try.
 *
 * So this plays whole matches and, **after every batch**, compares the reduced
 * view field-by-field against `sanitizeView(redact(state, seat))` — what the
 * server would have sent had it snapshotted right then. Any drift is named,
 * with the batch that caused it.
 *
 * ## What counts as a failure here
 *
 * Not all drift is a bug. §4.6 sends a snapshot at every turn boundary, so the
 * contract is that the view is right **within a turn** and repaired between
 * them; a few fields are also structurally unrecoverable from events alone and
 * are documented as such rather than faked. `TOLERATED` lists them, each with a
 * reason, and the list is asserted to be *small* — an escape hatch that grew
 * without anyone noticing would defeat the whole test.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch, redact, redactEvents } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { enumerateLegalIntents } from "../src/engine/intents";
import { nextInt, seedRng } from "../src/engine/rng";
import { sanitizeView } from "../src/net/localTransport";
import { applyEventsToView } from "../src/net/viewReducer";
import type { EngineEvent, PlayerView, Seat } from "../src/engine/types";

const content = getContent();

/**
 * Fields the reducer is not expected to track, with the reason each one is
 * genuinely unrecoverable from the event stream rather than merely unwritten.
 */
const TOLERATED: { path: string; why: string }[] = [
  // --- deliberately unrecoverable: order and identity the wire does not send -
  {
    path: "you.hand",
    why: "a mulligan swaps cards with no per-card event and reshuffles with an RNG the client does not have; §4.6's match-start snapshot is what makes the hand right",
  },
  {
    path: "you.deck",
    why: "sanitized to placeholders by §5.2, and its ORDER changes on scry/shuffle with no event carrying the new order",
  },
  {
    path: "you.discard",
    why: "ordering depends on the engine's internal resolution order, which events do not fully pin down",
  },
  {
    path: "opponent.discard",
    why: "the same resolution-order problem as you.discard, and the opponent's pile is rebuilt from public events that do not pin the order down",
  },
];

/**
 * Fields that change with **no event carrying them at all**.
 *
 * A separate list from `TOLERATED` because it is a different fact. Those above
 * are things the wire deliberately withholds; these are things nobody thought
 * to send. A view-based client cannot track them by any amount of care — only
 * §4.6's turn-boundary snapshot repairs them.
 *
 * Found by running this oracle, one at a time, each surfacing after the
 * previous was fixed. Recorded here rather than papered over, because the list
 * is the actual deliverable: it is what a future protocol revision has to
 * either emit or consciously accept.
 */
const NO_EVENT_CARRIES_IT: { path: string; why: string; matters: string }[] = [
  {
    path: "you.reactions[].cardId",
    why: "`reactionSet` carries no cardId by design (§5.1) so a face-down card stays face-down on the wire — with the side effect that even the OWNER cannot recover which card they set",
    matters: "moderate: the owner's own Reaction shows as unknown until the next snapshot",
  },
  {
    path: "you.refractionCurrent",
    why: "the Refraction confluence sets it and `confluenceActivated` carries only the confluence id, not the Current it armed",
    matters: "moderate: the client cannot show that the next card of that Current will trigger twice",
  },
  {
    path: "you.supportObsessionGainedThisTurn",
    why: "the once-per-turn support gain is a private flag and `obsessionChanged` reports the total, not which clause spent the allowance",
    matters: "low: affects only whether a preview predicts a second support gain the room will refuse",
  },
  {
    path: "you.board[].firedThisTurn",
    why: "per-trigger bookkeeping written directly on the instance with no event; `triggerQueued` names the source card, not the instance's fired list",
    matters: "none: no client path reads it, and viewHash omits it",
  },
  {
    path: "opponent.board[].firedThisTurn",
    why: "the same per-instance trigger bookkeeping as the friendly side, written directly on the instance with no accompanying event",
    matters: "none: no client path reads it, and viewHash omits it",
  },
  {
    path: "you.afterpartyRepeatThisTurn",
    why: "the Afterparty Crew's end-of-turn doubling is armed by a card effect that emits nothing naming the flag; the played card is public but the state it set is not on the wire",
    matters: "low: a preview cannot tell the player their end-of-turn triggers will resolve twice",
  },
];

/** Match a dotted path against a pattern where `[]` stands for any index. */
function matches(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\[\]/g, "\\[\\d+\\]");
  return new RegExp(`^${escaped}(\\.|\\[|$)`).test(path);
}

const tolerated = (path: string): boolean =>
  TOLERATED.some((entry) => matches(path, entry.path)) ||
  NO_EVENT_CARRIES_IT.some((entry) => matches(path, entry.path));

/** Every leaf difference between two views, as dotted paths. */
function diff(actual: unknown, expected: unknown, path = ""): string[] {
  if (tolerated(path)) return [];
  if (actual === expected) return [];

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: not an array`];
    if (actual.length !== expected.length) return [`${path}.length: ${actual.length} != ${expected.length}`];
    return expected.flatMap((item, i) => diff(actual[i], item, `${path}[${i}]`));
  }

  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return [`${path}: ${String(actual)} != object`];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual as object)]);
    return [...keys].flatMap((key) =>
      diff(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key
      )
    );
  }

  return [`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`];
}

interface Replay {
  drift: string[];
  batches: number;
  events: number;
  kinds: Set<string>;
}

/**
 * Play a match, feeding each batch through the reducer for one seat, and record
 * every divergence from the authoritative view.
 *
 * The reducer is seeded from the opening snapshot and then **never re-seeded**,
 * which is deliberately harsher than production: online it would be corrected at
 * every turn boundary. Drift that a snapshot would have wiped still shows up
 * here, so the test measures the reducer rather than the snapshot cadence.
 */
function replayThroughReducer(seed: number, viewer: Seat, maxIntents = 160): Replay {
  let state = createMatch(
    {
      seed,
      decks: [
        autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
        autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
      ],
      firstSeat: 0,
    },
    content
  );

  const step = (intent: Parameters<typeof applyIntent>[2]): EngineEvent[] => {
    const result = applyIntent(state, content, intent);
    state = result.state;
    return redactEvents(result.events, viewer);
  };

  // Both mulligans happen before the client's view is seeded, exactly as
  // online: the room deals, then sends the opening snapshot.
  step({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
  step({ type: "mulligan", seat: 1, replaceInstanceIds: [] });

  let view: PlayerView = structuredClone(sanitizeView(redact(state, viewer)));
  const out: Replay = { drift: [], batches: 0, events: 0, kinds: new Set() };

  const rng = seedRng(seed ^ 0x13579bdf);
  for (let i = 0; i < maxIntents && state.winner === null; i++) {
    const legal = enumerateLegalIntents(state, content, state.activeSeat);
    if (legal.length === 0) break;
    const doing = legal.filter((intent) => intent.type !== "endTurn");
    const pool = doing.length > 0 && nextInt(rng, 100) < 78 ? doing : legal;

    const events = step(pool[nextInt(rng, pool.length)]!);
    if (events.length === 0) continue;

    out.batches += 1;
    out.events += events.length;
    for (const event of events) out.kinds.add(event.e);

    view = applyEventsToView(view, events, content);

    const authoritative = sanitizeView(redact(state, viewer));
    for (const line of diff(view, authoritative)) {
      out.drift.push(`seed ${seed} seat ${viewer} batch ${out.batches} [${events.map((e) => e.e).join(",")}] — ${line}`);
    }
    if (out.drift.length > 0) break; // first divergence is the informative one
  }

  return out;
}

describe("the view reducer tracks the authoritative view", () => {
  /**
   * Given a long timeout rather than thinned out.
   *
   * Ten full matches, both seats, with a deep field-by-field comparison of the
   * entire view after **every batch** — up to ~1,600 diffs of a ~20 KB
   * structure. It runs in about a second alone and overruns vitest's 5 s
   * default under full-suite contention. Comparing less often would make it
   * cheap and would also be the one change that stops it finding things: every
   * one of the ten bugs it caught was located by knowing exactly which batch
   * first diverged.
   */
  it("stays in step for both seats across whole matches", { timeout: 30_000 }, () => {
    const failures: string[] = [];
    let batches = 0;
    let events = 0;
    const kinds = new Set<string>();

    for (const seed of [3, 17, 101, 2718, 31415]) {
      for (const viewer of [0, 1] as Seat[]) {
        const run = replayThroughReducer(seed, viewer);
        batches += run.batches;
        events += run.events;
        for (const kind of run.kinds) kinds.add(kind);
        failures.push(...run.drift.slice(0, 3));
      }
    }

    /**
     * Drift is asserted first on purpose. A run stops at its first divergence,
     * so drift also depresses the volume counters below — and a failure saying
     * "only 27 batches ran" hides the failure that says which field was wrong.
     */
    expect(failures.slice(0, 12), "the reduced view drifted from the authoritative one").toEqual([]);

    // Proof the comparison ran on something substantial, so an empty failure
    // list is a result rather than an accident.
    expect(batches, "no batch was ever reduced").toBeGreaterThan(100);
    expect(events, "no event was ever applied").toBeGreaterThan(400);
    expect(kinds.size, "too few distinct event kinds to be meaningful").toBeGreaterThan(15);
  });

  it("keeps the opponent's counts right even though their cards are hidden", () => {
    /**
     * Trap 2 from the reducer's header, isolated. `cardDrawn` arrives with
     * `cardId: null` for the opponent — the identity is hidden, but a card still
     * left their deck and entered their hand. A reducer that skipped the event
     * for having no card would desynchronise both counts for the rest of the
     * match, and nothing on screen would say so.
     */
    let sawHiddenDraw = false;
    for (const seed of [3, 17, 101]) {
      for (const viewer of [0, 1] as Seat[]) {
        const run = replayThroughReducer(seed, viewer);
        if (run.kinds.has("cardDrawn")) sawHiddenDraw = true;
        const countDrift = run.drift.filter((d) => /handCount|deckCount/.test(d));
        expect(countDrift).toEqual([]);
      }
    }
    expect(sawHiddenDraw, "no draw happened, so nothing was hidden").toBe(true);
  });

  it("does not treat the per-seat turn counter as the round counter", () => {
    /**
     * Trap 1. `turnStarted.turn` is `turnOfSeat[seat]`; `view.turn` is the round
     * counter and moves only when seat 1 ends a turn. They agree for seat 0 in a
     * match seat 0 opened, which is every casual test, and diverge the moment
     * seat 1 goes first — so this asserts it under exactly that condition.
     */
    let state = createMatch(
      {
        seed: 8675309,
        decks: [
          autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
          autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
        ],
        firstSeat: 1,
      },
      content
    );
    const collect = (intent: Parameters<typeof applyIntent>[2]): EngineEvent[] => {
      const result = applyIntent(state, content, intent);
      state = result.state;
      return redactEvents(result.events, 0);
    };
    collect({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
    collect({ type: "mulligan", seat: 1, replaceInstanceIds: [] });

    let view = structuredClone(sanitizeView(redact(state, 0)));
    for (let i = 0; i < 8 && state.winner === null; i++) {
      view = applyEventsToView(view, collect({ type: "endTurn", seat: state.activeSeat }), content);
      expect(view.turn, `round counter drifted on step ${i}`).toBe(state.turn);
      expect(view.globalTurnCounter, `global counter drifted on step ${i}`).toBe(state.globalTurnCounter);
    }
  });

  it("keeps both exemption lists short and justified", () => {
    /**
     * An escape hatch that grows quietly is how a test like this stops meaning
     * anything. Both lists are capped at what the analysis actually justified;
     * one more entry in either needs an argument, not a nudge to the number.
     */
    expect(TOLERATED.length, "the wire-withholds list grew").toBeLessThanOrEqual(4);
    expect(NO_EVENT_CARRIES_IT.length, "the missing-event list grew").toBeLessThanOrEqual(6);

    for (const entry of [...TOLERATED, ...NO_EVENT_CARRIES_IT]) {
      expect(entry.why.length, `${entry.path} needs a real reason`).toBeGreaterThan(40);
    }
    // Every missing-event entry states its consequence, so "we accepted this"
    // is a decision on the record rather than an omission nobody priced.
    for (const entry of NO_EVENT_CARRIES_IT) {
      expect(entry.matters.length, `${entry.path} must say what it costs`).toBeGreaterThan(10);
    }
  });

  it("the wildcard matcher does not tolerate more than it was asked to", () => {
    /**
     * `you.reactions[].cardId` must exempt the identity and NOT the count — an
     * over-broad pattern would silently stop checking `you.reactions.length`,
     * which is the part that actually has to be right.
     */
    expect(matches("you.reactions[0].cardId", "you.reactions[].cardId")).toBe(true);
    expect(matches("you.reactions[12].cardId", "you.reactions[].cardId")).toBe(true);
    expect(matches("you.reactions.length", "you.reactions[].cardId")).toBe(false);
    expect(matches("you.reactions[0].setOnTurn", "you.reactions[].cardId")).toBe(false);
    expect(matches("you.handCount", "you.hand")).toBe(false);
    expect(matches("you.hand[3].cardId", "you.hand")).toBe(true);
  });
});
