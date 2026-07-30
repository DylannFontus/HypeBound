/**
 * `LocalTransport` — `MatchTransport` over an in-process `LocalMatch`.
 * `docs/tech/03-multiplayer-architecture.md` §15, phase 1.
 *
 * This is the offline game: the local process holds the authoritative
 * `MatchState`, the AI takes the other seat, and nothing crosses a network. The
 * reason it is worth wrapping in a transport at all is that it makes the
 * offline build **exercise every online code path except the socket** —
 * sequence numbers, batches, snapshots, view hashes, clocks and typed refusals
 * all exist here, are used here, and are therefore wrong here first, where a
 * test can see it, rather than in production against a real opponent.
 *
 * Nothing in this file is a stub. Every number it reports is true:
 *
 * - `seq` really does count batches, and really is gap-free.
 * - `clocks` are computed from `balance.timer` and the wall clock since the
 *   active seat last changed — real remaining time, not a placeholder.
 * - `viewHash` really is FNV-1a over the seat's view, so a bug that makes two
 *   sides of the same match disagree is detectable offline.
 * - `status` is permanently `live` at 0 ms RTT, because an in-process match
 *   genuinely cannot be unstable. That is a fact about the transport, not a
 *   missing feature.
 */

import type {
  ConfluenceAvailability,
  ContentIndex,
  EngineEvent,
  MatchRecord,
  PlayerIntent,
  PlayerView,
  Seat,
} from "../engine/types";
import { LocalMatch, type LocalMatchOptions } from "../game/localMatch";
import { redactEvents } from "../engine/state";
import {
  attackableBy,
  canActivateLocation,
  canUseFixation,
  checkPlayable,
} from "../engine/intents";
import {
  EMPTY_LEGALITY,
  isYourTurn,
  type EventBatch,
  type HotseatControls,
  type Legality,
  type MatchClocks,
  type MatchSnapshot,
  type MatchTransport,
  type SubmitResult,
  type TransportStatus,
} from "./transport";

/**
 * FNV-1a over a canonicalized subset of the seat's view (§4.6).
 *
 * The same technique as the engine's `stateHash()`, deliberately: this is the
 * client-side half of the same divergence check. It hashes what the *seat can
 * see* — its own side in full, the opponent's public zones and counts — because
 * hashing anything else would compare two things a real client and a real
 * server do not both possess.
 */
export function viewHash(view: PlayerView): string {
  const canonical = {
    seat: view.seat,
    turn: view.turn,
    activeSeat: view.activeSeat,
    phase: view.phase,
    winner: view.winner,
    you: {
      health: view.you.leaderHealth,
      armor: view.you.armor,
      hype: `${view.you.hype}/${view.you.hypeMax}`,
      obsession: view.you.obsession,
      hand: view.you.hand.map((c) => `${c.cardId}:${c.costDelta}`),
      deckCount: view.you.deck.length,
      board: view.you.board.map(describeCharacter),
      discard: view.you.discard.map((c) => c.cardId),
      resonance: view.you.resonanceProgress,
    },
    opponent: {
      health: view.opponent.leaderHealth,
      armor: view.opponent.armor,
      hype: `${view.opponent.hype}/${view.opponent.hypeMax}`,
      obsession: view.opponent.obsession,
      handCount: view.opponent.handCount,
      deckCount: view.opponent.deckCount,
      board: view.opponent.board.map(describeCharacter),
      discard: view.opponent.discard.map((c) => c.cardId),
      resonance: view.opponent.resonanceProgress,
    },
  };

  const json = JSON.stringify(canonical);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function describeCharacter(c: { cardId: string; attack: number; health: number; keywords: readonly string[] } | null): string {
  if (!c) return "-";
  return `${c.cardId}/${c.attack}/${c.health}/${[...c.keywords].sort().join("+")}`;
}

/**
 * The placeholder a hidden deck entry becomes on the wire (§5.2).
 *
 * `PlayerView.you` is the full `PlayerState`, which includes `deck` in exact
 * order. That is correct when the local process is the authority and a leak the
 * moment it is not: a seat may not read its own next draw.
 */
const HIDDEN_CARD_ID = "hidden";

/**
 * Replace the seat's own deck with count-preserving placeholders.
 *
 * Only `.length` is read anywhere in the battle UI — the HUD's deck chip and
 * the mirror's spoken line — so nothing visible changes. That is the point: if
 * something *had* been reading deck identities, this is where it would start
 * failing.
 *
 * Not a mutation. `redact()` returns `you` as a live reference into the match
 * state, so building a new object here is what keeps this from quietly emptying
 * the real deck.
 */
export function sanitizeView(view: PlayerView): PlayerView {
  return {
    ...view,
    you: {
      ...view.you,
      deck: view.you.deck.map((instance) => ({
        instanceId: instance.instanceId,
        cardId: HIDDEN_CARD_ID,
        costDelta: 0,
        addedKeywords: [],
        removedKeywords: [],
      })),
    },
  };
}

export class LocalTransport implements MatchTransport {
  private readonly match: LocalMatch;
  private seq = 0;
  private batchListeners: ((batch: EventBatch) => void | Promise<void>)[] = [];
  private statusListeners: ((status: TransportStatus) => void)[] = [];
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  /** Wall clock at which the current seat's turn began; drives `clocks`. */
  private turnStartedAt = Date.now();
  private clockedSeat: Seat;

  constructor(options: LocalMatchOptions) {
    this.match = new LocalMatch(options);
    this.clockedSeat = this.match.getState().activeSeat;

    /**
     * Bridge `LocalMatch`'s event stream into batches.
     *
     * The `await` chain matters and is why `onBatch` listeners may return a
     * promise: `LocalMatch.emit` awaits each listener, the presenter animates
     * inside one, and the AI moves the instant `submit()` resolves. Break the
     * chain and the rival's turn plays on top of the animation of yours.
     */
    this.unsubscribe = this.match.onEvents(async (events) => {
      await this.dispatch(events, { kind: "intent", seat: this.match.getState().activeSeat });
    });
  }

  // --- identity -------------------------------------------------------------

  /** A getter, not a field: Hotseat moves the seat, and this must follow it. */
  get seat(): Seat {
    return this.match.playerSeat;
  }

  get content(): ContentIndex {
    return this.match.content;
  }

  // --- lifecycle ------------------------------------------------------------

  async connect(): Promise<MatchSnapshot> {
    this.emitStatus({ kind: "live", rttMs: 0 });
    await this.match.start();
    return this.snapshot();
  }

  close(reason = "left"): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.emitStatus({ kind: "closed", reason });
    this.batchListeners = [];
    this.statusListeners = [];
  }

  // --- queries --------------------------------------------------------------

  /**
   * The redacted, **sanitized** view this seat is entitled to.
   *
   * Sanitized even offline, which is the whole point of §15 phase 2. Online,
   * `you.deck` in exact order is a real leak — a modified client would know its
   * next draw — so the wire replaces each entry with an opaque placeholder that
   * keeps the count and nothing else (§5.2). Doing that here too means the UI is
   * built against the information a networked client will actually have, and
   * anything that quietly depended on knowing its own deck order breaks now, in
   * a test, rather than later against a real opponent.
   *
   * `authoritativeState()` still holds the truth for the AI, the teaching
   * runner and the target-enumeration helpers — all of which are local-only.
   *
   * ## It is also a copy, and that is not an optimisation to remove
   *
   * `redact()` returns `you` as **the live `PlayerState`**, and `redactOpponent`
   * passes `board`, `discard`, `location` and `counters` through by reference
   * (`src/engine/state.ts`). Sanitizing alone replaces only `you.deck`, so
   * everything else a caller received was the array the engine is mutating —
   * write `board[i].attacksUsedThisTurn` on the "view" and you have written it
   * on the match.
   *
   * Online that cannot happen: the view arrives as deserialized JSON, which is
   * a copy by construction. So without this clone the offline build would be
   * *less* safe than the networked one, and a mutation bug would be invisible
   * in the build where it is harmless and fatal in the build where it is not —
   * exactly backwards from what phase 2 is for.
   *
   * Measured at **0.062 ms** per call, which at ten calls a frame is under a
   * millisecond. The correctness is worth more than the microseconds.
   */
  view(): PlayerView {
    return structuredClone(sanitizeView(this.match.getView()));
  }

  isBusy(): boolean {
    return this.match.isBusy();
  }

  confluences(): readonly ConfluenceAvailability[] {
    return this.match.confluences();
  }

  /**
   * The engine's own opinion about what is pressable, computed from the
   * authoritative state this process happens to own.
   *
   * `WsTransport` will answer the same question from a `PlayerView` instead.
   * Both are UX (§4.3) — the room re-checks every intent with this same code
   * before it changes anything.
   */
  legality(): Legality {
    const view = this.view();
    const state = this.match.getState();
    const content = this.match.content;
    const yourTurn = isYourTurn(view);
    if (!yourTurn) return { ...EMPTY_LEGALITY, confluences: this.confluences() };

    const playable = new Set<string>();
    for (const card of view.you.hand) {
      if (checkPlayable(state, content, view.seat, card.instanceId).ok) playable.add(card.instanceId);
    }

    return {
      playable,
      canAttack: new Set(attackableBy(state, content, view.seat).map((c) => c.instanceId)),
      confluences: this.confluences(),
      canFixation: canUseFixation(state, content, view.seat, "fixation"),
      canUltimate: canUseFixation(state, content, view.seat, "ultimate"),
      canActivateLocation: canActivateLocation(state, content, view.seat),
      yourTurn,
    };
  }

  finishRecord(): MatchRecord | null {
    return this.match.finishRecord();
  }

  // --- intents --------------------------------------------------------------

  async submit(intent: PlayerIntent): Promise<SubmitResult> {
    const error = await this.match.submit(intent);
    if (error) return { ok: false, error };
    return { ok: true, seq: this.seq };
  }

  // --- listeners ------------------------------------------------------------

  onBatch(listener: (batch: EventBatch) => void | Promise<void>): () => void {
    this.batchListeners.push(listener);
    return () => {
      this.batchListeners = this.batchListeners.filter((l) => l !== listener);
    };
  }

  onStatus(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.push(listener);
    // A late subscriber still learns the current status; otherwise a listener
    // attached after connect() would sit on "connecting" forever.
    if (!this.closed) listener({ kind: "live", rttMs: 0 });
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  // --- hotseat --------------------------------------------------------------

  /**
   * Present only when the other seat is a person at this device. A network
   * transport leaves this undefined — see `HotseatControls`.
   */
  get hotseat(): HotseatControls | undefined {
    if (!this.match.isHotseat()) return undefined;
    return {
      awaitingHandoff: () => this.match.awaitingHandoff(),
      setViewingSeat: (seat: Seat) => this.match.setViewingSeat(seat),
    };
  }

  // --- escape hatches -------------------------------------------------------

  /**
   * The authoritative state. **Local only, and deliberately not on
   * `MatchTransport`.**
   *
   * A network client cannot have this — it is the opponent's hand and the deck
   * order — so anything reached through it is code that will not survive going
   * online. It exists for two callers that are themselves local-only: the
   * teaching-stage runner, and the `window.hypeboundBattle` debug handle the
   * verify scripts drive. Reaching for it from a screen is a mistake the type
   * system cannot catch, so: don't.
   */
  authoritativeState() {
    return this.match.getState();
  }

  /** Swap the teaching gate as a scripted stage moves between beats. */
  setGate(gate: ((intent: PlayerIntent) => string | null) | null): void {
    this.match.setGate(gate);
  }

  // --- internals ------------------------------------------------------------

  private async dispatch(events: EngineEvent[], cause: EventBatch["cause"]): Promise<void> {
    if (this.closed) return;
    this.seq += 1;

    const view = this.view();
    const batch: EventBatch = {
      seq: this.seq,
      cause,
      /**
       * Redacted for the viewing seat, offline as well as on.
       *
       * The offline player has no more right to the AI's drawn cards than an
       * online one has to a human opponent's, and running the same redaction in
       * both builds means a presenter that had come to depend on omniscient
       * events fails here — in the suite — instead of in a real match.
       */
      events: redactEvents(events, this.match.playerSeat),
      clocks: this.clocks(),
      viewHash: viewHash(view),
      // A turn boundary is where the online build sends a corrective snapshot
      // (§4.6), so the offline build sends one too — same code path, same
      // frequency, and the presenter's snapshot handling is exercised.
      ...(events.some((e) => e.e === "turnStarted") ? { snapshot: this.snapshot() } : {}),
    };

    for (const listener of this.batchListeners) await listener(batch);
  }

  private snapshot(): MatchSnapshot {
    return {
      seq: this.seq,
      view: this.view(),
      /**
       * Empty, and correctly so — but not for the reason this comment used to
       * give.
       *
       * §5.2 has the worker re-populate deck entries a seat has *legitimately
       * learned*, naming the Algorithm Syndicate's scry. In this engine scry
       * never reveals anything to a player: `{ op: "scry" }` resolves entirely
       * inside the reducer, either bottoming a card or reordering the top, and
       * no UI ever shows the peeked cards. `deckScryed` carries a count and
       * nothing else for exactly that reason.
       *
       * So there is nothing to give back, and the earlier note here — that
       * phase 2 would make this list non-empty — was predicting a feature the
       * rules do not have. The field stays because a future reveal effect would
       * need it, and because the wire shape should not change when one lands.
       */
      revealedDeckInstanceIds: [],
      clocks: this.clocks(),
      spectatorCount: 0,
    };
  }

  /**
   * Real remaining turn time, from `balance.timer` and the wall clock.
   *
   * The HUD still runs its own countdown today; unifying the two is phase 4,
   * when the server's clock becomes the only one that may decide an expiry
   * (§4.4). Until then these numbers are correct and simply not yet the ones
   * being displayed — which is a different thing from being made up.
   */
  private clocks(): MatchClocks {
    const state = this.match.getState();
    if (state.activeSeat !== this.clockedSeat) {
      this.clockedSeat = state.activeSeat;
      this.turnStartedAt = Date.now();
    }

    const timer = this.match.content.balance.timer;
    const turnMs = timer.turnSeconds * 1000;
    const ropeMs = timer.ropeSeconds * 1000;
    const elapsed = Date.now() - this.turnStartedAt;

    return {
      activeSeat: state.activeSeat,
      turnMsRemaining: Math.max(0, turnMs - elapsed),
      ropeMsRemaining: Math.max(0, Math.min(ropeMs, turnMs + ropeMs - elapsed)),
      serverNowMs: Date.now(),
    };
  }

  private emitStatus(status: TransportStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
