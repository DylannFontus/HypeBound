/**
 * The authoritative match room — multiplayer §4 and §14.2's "one match = one
 * room", with none of Cloudflare in it.
 *
 * This class holds the `MatchState`, applies intents, redacts per seat, numbers
 * the stream and runs the clock. It does **no** I/O: it takes the current time
 * as an argument, and it answers with a list of frames somebody else is
 * responsible for delivering. `matchRoom.ts` is that somebody, and it is thin on
 * purpose.
 *
 * The split is not decoration. It is what lets the entire authoritative path be
 * tested in the ordinary vitest suite, on a machine with no workerd on it, the
 * same way phase 2 insisted redaction be provable offline rather than
 * discovered in production. A room that called `Date.now()` and `WebSocket.send`
 * inline would be testable only by standing up a server, which in practice means
 * tested by playing.
 *
 * ## Three things the design document asks for that this does differently
 *
 * **There is no broadcast.** §4.3's "Broadcast" stage and §7's frame list read
 * as though a batch goes out to the room. It cannot: `redactEvents` produces a
 * *different* event list per seat, and the two seats' `viewHash` values are
 * different by construction. Every method here returns frames individually
 * addressed to a seat, so "send this to everyone" is not expressible — which is
 * the point, because the one thing that must never happen is a batch built for
 * seat 0 reaching seat 1.
 *
 * **§4.3's idempotency rule cannot be implemented with the state it names.** It
 * specifies `lastAppliedClientId[seat]` — one number — and then requires that a
 * re-sent intent be "answered with the original batch `seq`", which needs a
 * mapping from id to answer. With one number you can detect a duplicate but you
 * cannot answer it truthfully. Since §4.3 also forbids pipelining (one intent in
 * flight per seat), the only re-send that can legitimately occur is of the most
 * recent intent, so this room remembers the last `(id → answer)` pair per seat
 * and replays it exactly. An id *older* than that is refused rather than
 * guessed at: inventing a `seq` for it would tell a client its move landed when
 * the room has no idea whether it did.
 *
 * **The "second in-flight intent" guard is not implemented, because it cannot
 * fire.** §4.3 says the server rejects a concurrent second intent. Inside a
 * Durable Object, handlers are serialized by the input gate and `applyIntent` is
 * synchronous, so by the time a second frame is read the first has already been
 * answered. Writing the guard anyway would mean writing a branch no test can
 * reach and no reviewer can check.
 */

import {
  applyIntent,
  createMatch,
  recordIntent,
  redact,
  redactEvents,
  replay,
  startRecord,
  RulesError,
  type ContentIndex,
  type EngineEvent,
  type MatchConfig,
  type MatchRecord,
  type MatchState,
  type PlayerIntent,
  type RulesErrorShape,
  type Seat,
} from "../shared/engine";
import { sanitizeView, viewHash, type EventCause, type MatchClocks, type MatchSnapshot } from "../shared/wire";

/** Frames are always addressed. See the header: hidden information forbids a broadcast. */
export interface Addressed {
  readonly seat: Seat;
  readonly frame: RoomFrame;
}

/**
 * What the room produces, before an envelope is put round it.
 *
 * Deliberately not `ServerEnvelope`: `v` and `ts` belong to the delivery layer,
 * and a room that stamped them would be reading a clock it was given as an
 * argument precisely so it would not have to.
 */
export type RoomFrame =
  | { t: "accepted"; id: number; seq: number }
  | { t: "rejected"; id: number; error: RulesErrorShape }
  | {
      t: "batch";
      seq: number;
      cause: EventCause;
      events: EngineEvent[];
      clocks: MatchClocks;
      viewHash: string;
      snapshot?: MatchSnapshot;
    }
  | { t: "snapshot"; snapshot: MatchSnapshot }
  | { t: "clock"; clocks: MatchClocks }
  | {
      t: "ended";
      winner: Seat | "draw";
      reason: "leaderDefeated" | "concede" | "finale" | "draw";
      /**
       * Required by `zServerEnded`, and omitted here until a client validated a
       * real one. The frame went out without it, the client refused the frame,
       * and the match ended with the players still connected to a room that
       * thought it had told them — which is exactly the failure §7's
       * "validated on BOTH ends" exists to catch, caught by the end that was
       * supposed to catch it.
       */
      matchId: string;
      replayAvailable: boolean;
    };

export interface RoomTimer {
  readonly turnMs: number;
  readonly ropeMs: number;
  /** §4.4: three consecutive rope turns with no intent at all ⇒ auto-concede. */
  readonly idleRopeTurnsToConcede: number;
}

export interface RoomOptions {
  readonly matchId: string;
  readonly build: string;
  readonly contentHash: string;
  readonly match: MatchConfig;
  readonly timer?: Partial<RoomTimer>;
}

/** The last answer given to a seat, so a re-send can be answered identically. */
interface LastAnswer {
  readonly id: number;
  readonly frame: RoomFrame;
}

const SEATS: readonly Seat[] = [0, 1];

/**
 * Timer defaults come from `balance.timer` when the room is built from content;
 * these are the fallback for a content index that somehow lacks them, and match
 * canon §2 (75 s + 15 s rope).
 */
const DEFAULT_TIMER: RoomTimer = { turnMs: 75_000, ropeMs: 15_000, idleRopeTurnsToConcede: 3 };

export class Room {
  readonly matchId: string;
  readonly build: string;
  readonly contentHash: string;
  readonly timer: RoomTimer;

  private readonly content: ContentIndex;
  private readonly options: RoomOptions;
  private state: MatchState;
  private record: MatchRecord;

  /** §7.5: batch sequence numbers start at 1, so 0 means "nothing sent yet". */
  private seqCounter = 0;
  private turnStartedAtMs: number;
  private clockedSeat: Seat;
  private readonly lastAnswer: (LastAnswer | null)[] = [null, null];
  private readonly actedThisTurn: boolean[] = [false, false];
  private readonly idleRopeTurns: number[] = [0, 0];
  private endedAnnounced = false;

  constructor(content: ContentIndex, options: RoomOptions, nowMs: number) {
    this.content = content;
    this.options = options;
    this.matchId = options.matchId;
    this.build = options.build;
    this.contentHash = options.contentHash;
    this.timer = resolveTimer(content, options.timer);

    this.state = createMatch(options.match, content);
    this.record = startRecord(this.state);
    this.turnStartedAtMs = nowMs;
    this.clockedSeat = this.state.activeSeat;
  }

  /**
   * Rebuild a room from storage — §14.3, which is also the hibernation path.
   *
   * A Durable Object with only idle sockets on it is evicted from memory, so
   * "crash recovery" and "the players are thinking" are the same code path here,
   * and it therefore runs constantly rather than once a fortnight. That is a
   * feature: the recovery path in this architecture cannot rot unnoticed.
   *
   * Costs one full re-simulation of the match — roughly 0.3–2 ms per intent
   * (§14.1), so under 200 ms for a long game. Paid on wake, not per message.
   */
  static restore(content: ContentIndex, saved: RoomSave): Room {
    const room = new Room(content, saved.options, saved.turnStartedAtMs);
    const result = replay(saved.record, content);
    if (result.errors.length > 0) {
      // Determinism failed, which means the journal and this build disagree.
      // Continuing would serve both players a match neither of them played.
      const first = result.errors[0]!;
      throw new Error(
        `room ${saved.options.matchId} could not be rebuilt: intent ${first.index} — ${first.message}. ` +
          `Journal has ${saved.record.intents.length} intents; build ${saved.options.build}, content ${saved.options.contentHash}.`
      );
    }

    room.state = result.state;
    room.record = saved.record;
    /**
     * Not stored, because it cannot disagree: `apply()` journals exactly once
     * and increments exactly once, so the counter *is* the journal length. A
     * stored copy would be a second source of truth for a number that already
     * has one. `tests/room.test.ts` pins the invariant.
     */
    room.seqCounter = saved.record.intents.length;
    room.turnStartedAtMs = saved.turnStartedAtMs;
    room.clockedSeat = result.state.activeSeat;
    room.lastAnswer[0] = saved.lastAnswer[0] ?? null;
    room.lastAnswer[1] = saved.lastAnswer[1] ?? null;
    room.actedThisTurn[0] = saved.actedThisTurn[0] ?? false;
    room.actedThisTurn[1] = saved.actedThisTurn[1] ?? false;
    room.idleRopeTurns[0] = saved.idleRopeTurns[0] ?? 0;
    room.idleRopeTurns[1] = saved.idleRopeTurns[1] ?? 0;
    room.endedAnnounced = saved.endedAnnounced;
    return room;
  }

  save(): RoomSave {
    return {
      options: this.options,
      record: this.record,
      turnStartedAtMs: this.turnStartedAtMs,
      lastAnswer: [...this.lastAnswer],
      actedThisTurn: [...this.actedThisTurn],
      idleRopeTurns: [...this.idleRopeTurns],
      endedAnnounced: this.endedAnnounced,
    };
  }

  // --- reading ---------------------------------------------------------------

  get seq(): number {
    return this.seqCounter;
  }

  get winner(): Seat | "draw" | null {
    return this.state.winner;
  }

  get activeSeat(): Seat {
    return this.state.activeSeat;
  }

  /** The journal. Recovery is `replay(record, content)` — §14.3, unchanged. */
  get journal(): MatchRecord {
    return this.record;
  }

  /**
   * The authoritative state, for a caller that has to persist or hash it.
   *
   * Not on any interface a client can reach, and named so that a reviewer
   * noticing it in the delivery layer asks why.
   */
  authoritativeState(): MatchState {
    return this.state;
  }

  clocks(nowMs: number): MatchClocks {
    // A turn boundary can arrive through an intent, a timer, or a scripted
    // effect, so the reset is detected here rather than trusted to a caller
    // remembering to announce it.
    if (this.state.activeSeat !== this.clockedSeat) {
      this.clockedSeat = this.state.activeSeat;
      this.turnStartedAtMs = nowMs;
    }
    const elapsed = Math.max(0, nowMs - this.turnStartedAtMs);
    return {
      activeSeat: this.state.activeSeat,
      turnMsRemaining: Math.max(0, this.timer.turnMs - elapsed),
      // Same expression as `LocalTransport.clocks()`. The two must agree: the
      // client renders one countdown and does not know which one produced it.
      ropeMsRemaining: Math.max(0, Math.min(this.timer.ropeMs, this.timer.turnMs + this.timer.ropeMs - elapsed)),
      serverNowMs: nowMs,
    };
  }

  snapshotFor(seat: Seat, nowMs: number): MatchSnapshot {
    return {
      seq: this.seqCounter,
      view: sanitizeView(redact(this.state, seat)),
      /**
       * Empty, and correct. This engine's scry resolves inside the reducer and
       * shows the peeked cards to nobody, so there is no instance a seat has
       * legitimately learned the identity of (§7.7 C14). The field stays for a
       * future reveal effect.
       */
      revealedDeckInstanceIds: [],
      clocks: this.clocks(nowMs),
      spectatorCount: 0,
    };
  }

  /** The view hash for a seat, as the client will compute it from the same view (§4.6). */
  viewHashFor(seat: Seat): string {
    return viewHash(sanitizeView(redact(this.state, seat)));
  }

  // --- writing ---------------------------------------------------------------

  /**
   * Apply one intent from one seat.
   *
   * Returns everything that must go out as a result, addressed. The caller
   * delivers it *after* persisting the journal — §4.3's durability rule — which
   * in a Durable Object is the output gate rather than anything written here.
   */
  submit(seat: Seat, id: number, intent: PlayerIntent, nowMs: number): Addressed[] {
    const replayed = this.replayAnswer(seat, id);
    if (replayed) return replayed;

    if (this.state.winner !== null) {
      return this.refuse(seat, id, { code: "notYourTurn", message: "the match is over" });
    }
    // The gateway checks this too. It is checked again here because the gateway
    // is a different object, and the room is the thing that must not be wrong.
    if (intent.seat !== seat) {
      return this.refuse(seat, id, { code: "notYourTurn", message: `seat ${seat} may not act as seat ${intent.seat}` });
    }

    return this.apply(intent, { kind: "intent", seat, clientIntentId: id }, id, nowMs);
  }

  /**
   * Advance the clock. Called by the delivery layer on an alarm, never on a
   * message, so an idle room still ends.
   *
   * Returns the frames caused by an expiry — nothing at all if the turn still
   * has time on it, which is the common case and must stay cheap.
   */
  tick(nowMs: number): Addressed[] {
    if (this.state.winner !== null) return [];
    const clocks = this.clocks(nowMs);
    if (clocks.turnMsRemaining > 0 || clocks.ropeMsRemaining > 0) return [];

    const seat = this.state.activeSeat;

    /**
     * §4.4: the room injects a real `endTurn` rather than branching the engine
     * on a timeout. The injected intent is journaled exactly like a played one,
     * so a replay of this match plays the timeout too — there is no "the clock
     * ran out here" annotation to lose.
     */
    if (!this.actedThisTurn[seat]) {
      this.idleRopeTurns[seat] = (this.idleRopeTurns[seat] ?? 0) + 1;
    } else {
      this.idleRopeTurns[seat] = 0;
    }

    if ((this.idleRopeTurns[seat] ?? 0) >= this.timer.idleRopeTurnsToConcede) {
      // Also a real intent, for the same reason. `matchEnded.reason` is then
      // "concede", which is why §7.7 C8 says there is no "timeout" reason on the
      // wire: the engine never learns one happened.
      return this.apply({ type: "concede", seat }, { kind: "timer", seat }, null, nowMs);
    }

    return this.apply({ type: "endTurn", seat }, { kind: "timer", seat }, null, nowMs);
  }

  /**
   * Concede on a seat's behalf — the disconnect path (§8.2) and `leave`.
   *
   * Injected as a player intent for the third time in this file, and for the
   * third reason: the engine has exactly one way for a match to end early, and
   * every route to it goes through the same door so that replays, results and
   * the `ended` frame cannot disagree about what happened.
   */
  concede(seat: Seat, nowMs: number): Addressed[] {
    if (this.state.winner !== null) return [];
    return this.apply({ type: "concede", seat }, { kind: "system", seat }, null, nowMs);
  }

  // --- internals -------------------------------------------------------------

  private apply(intent: PlayerIntent, cause: EventCause, clientIntentId: number | null, nowMs: number): Addressed[] {
    const seatBefore = this.state.activeSeat;
    const phaseBefore = this.state.phase;
    let events: EngineEvent[];

    try {
      const result = applyIntent(this.state, this.content, intent);
      this.state = result.state;
      events = result.events;
    } catch (error) {
      // A rules refusal is an ordinary event at this boundary; anything else is
      // a bug in the engine and must not be reported to a player as if they had
      // done something wrong.
      if (error instanceof RulesError && clientIntentId !== null) {
        return this.refuse(cause.seat ?? seatBefore, clientIntentId, { code: error.code, message: error.message });
      }
      throw error;
    }

    recordIntent(this.record, intent);
    if (cause.kind === "intent") this.actedThisTurn[intent.seat] = true;

    /**
     * §4.6 lists four snapshot points: match start, every turn boundary, every
     * resume, and on demand. "Match start" is a *phase* change, not a turn
     * change, and reading it as one is wrong in a way that only shows up on the
     * mulligan.
     *
     * A mulligan puts different cards in a seat's hand and emits nothing that
     * names any of them — `mulliganDone` carries `kept` and `replaced` counts
     * and no ids — so a client driven by events alone cannot know what it is
     * now holding. The correction is the match-start snapshot. Without this
     * clause it never arrives, because the active seat is the same before and
     * after: the drift would instead be caught by the `viewHash` mismatch and
     * healed by a resync, meaning a wasted round trip at the start of every
     * match that opened with a replacement. Bounded, self-healing, and still
     * wrong.
     *
     * Recorded in §5.3 as a seventh entry rather than fixed in the engine, for
     * the same reason as the other six: the snapshot repairs it, and the
     * alternative is a canonical event type carrying private card identities
     * that would need redacting per seat anyway.
     */
    const turnChanged = this.state.activeSeat !== seatBefore;
    const phaseChanged = this.state.phase !== phaseBefore;
    if (turnChanged) {
      this.turnStartedAtMs = nowMs;
      this.clockedSeat = this.state.activeSeat;
      this.actedThisTurn[this.state.activeSeat] = false;
    }

    const seq = ++this.seqCounter;
    const clocks = this.clocks(nowMs);
    const out: Addressed[] = [];

    for (const seat of SEATS) {
      const frame: RoomFrame = {
        t: "batch",
        seq,
        cause,
        events: redactEvents(events, seat),
        clocks,
        viewHash: this.viewHashFor(seat),
        /**
         * §4.6: a full snapshot on every turn boundary and at match end, so
         * drift is bounded by one turn. `snapshot.seq` must equal `seq` — the
         * protocol schema refuses the frame otherwise (§7.7 C5), and
         * `snapshotFor` reads the same counter, so they cannot disagree.
         */
        ...(turnChanged || phaseChanged || this.state.winner !== null ? { snapshot: this.snapshotFor(seat, nowMs) } : {}),
      };
      out.push({ seat, frame });
    }

    if (clientIntentId !== null) {
      // Ahead of the batch in the array, so a delivery layer that preserves
      // order tells the client its move landed before showing it landing.
      out.unshift(...this.answer(cause.seat ?? seatBefore, { t: "accepted", id: clientIntentId, seq }));
    }

    out.push(...this.endedFrames(events));
    return out;
  }

  /**
   * The `ended` frame, built from the engine's own `matchEnded` event.
   *
   * The reason is *read*, never authored. §7.7 C8 pins the wire enum to exactly
   * the four reasons the engine can produce, and the only way to keep that true
   * is for this room to have no opinion — a room that inferred "the winner
   * conceded, probably" would be the thing that eventually puts a fifth string
   * on the wire.
   *
   * `MatchRecord` cannot supply it: it stores `config` and `intents`, not
   * events, because a replay re-derives events from the intents. So the event
   * has to be caught in the batch that produced it, on the way past.
   */
  private endedFrames(events: readonly EngineEvent[]): Addressed[] {
    if (this.state.winner === null || this.endedAnnounced) return [];
    const ended = events.find((event) => event.e === "matchEnded");
    if (!ended || ended.e !== "matchEnded") {
      // The engine set a winner without saying why. That is an engine bug, and
      // guessing a reason here would hide it behind a plausible replay.
      throw new Error(`match ${this.matchId} ended with winner ${String(this.state.winner)} but emitted no matchEnded`);
    }
    this.endedAnnounced = true;
    this.record.result = { winner: ended.winner, turns: this.state.turn };

    return SEATS.map((seat) => ({
      seat,
      frame: {
        t: "ended" as const,
        winner: ended.winner,
        reason: ended.reason,
        matchId: this.matchId,
        replayAvailable: false,
      },
    }));
  }

  private refuse(seat: Seat, id: number, error: RulesErrorShape): Addressed[] {
    return this.answer(seat, { t: "rejected", id, error });
  }

  /** Record an answer so an identical re-send gets an identical reply (§4.3). */
  private answer(seat: Seat, frame: RoomFrame): Addressed[] {
    const id = "id" in frame ? frame.id : 0;
    if (id > 0) this.lastAnswer[seat] = { id, frame };
    return [{ seat, frame }];
  }

  private replayAnswer(seat: Seat, id: number): Addressed[] | null {
    const last = this.lastAnswer[seat];
    if (!last) return null;
    if (id === last.id) return [{ seat, frame: last.frame }];
    if (id < last.id) {
      // See the header. Nothing here knows what answer this id received, and a
      // fabricated `seq` is worse than a refusal.
      return this.refuse(seat, id, {
        code: "invalidIntent",
        message: `intent ${id} is older than ${last.id}; the room no longer holds its answer`,
      });
    }
    return null;
  }
}

/**
 * Everything about a room that is not re-derivable from the engine.
 *
 * Deliberately small. `MatchState` is 30–60 KB and is **not** in here, because
 * §14.3 already settled how a room comes back: re-apply the journal and let
 * determinism produce an identical state. Storing the state as well would mean
 * two representations of the same match that can disagree, and the one that
 * disagrees silently is always the cache.
 *
 * What *is* here is the bookkeeping the engine has no opinion about — when the
 * current turn started, which intent ids have been answered, how many rope turns
 * a seat has slept through. That is not derivable from the intents, and losing
 * it is not cosmetic: a room that forgot `turnStartedAtMs` would hand a stalling
 * player a fresh 75 seconds every time the object went to sleep.
 */
export interface RoomSave {
  readonly options: RoomOptions;
  readonly record: MatchRecord;
  readonly turnStartedAtMs: number;
  readonly lastAnswer: (LastAnswer | null)[];
  readonly actedThisTurn: boolean[];
  readonly idleRopeTurns: number[];
  readonly endedAnnounced: boolean;
}

function resolveTimer(content: ContentIndex, overrides?: Partial<RoomTimer>): RoomTimer {
  const timer = (content.balance as { timer?: { turnSeconds?: number; ropeSeconds?: number } }).timer;
  return {
    turnMs: overrides?.turnMs ?? (timer?.turnSeconds !== undefined ? timer.turnSeconds * 1000 : DEFAULT_TIMER.turnMs),
    ropeMs: overrides?.ropeMs ?? (timer?.ropeSeconds !== undefined ? timer.ropeSeconds * 1000 : DEFAULT_TIMER.ropeMs),
    idleRopeTurnsToConcede: overrides?.idleRopeTurnsToConcede ?? DEFAULT_TIMER.idleRopeTurnsToConcede,
  };
}
