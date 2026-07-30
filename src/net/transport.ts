/**
 * `MatchTransport` — the one interface that does not change when the game goes
 * online. `docs/tech/03-multiplayer-architecture.md` §6.
 *
 * Everything above this file (the battle screen, the presenter, the 3D board,
 * the HUD) is written once. Below it there are two implementations: today's
 * `LocalTransport`, which wraps the in-process `LocalMatch` and its AI, and a
 * future `WsTransport` speaking §7's protocol to an authoritative room. Nothing
 * upstairs is allowed to know which one it has.
 *
 * ## The rule that gives this file its shape
 *
 * **A network client never holds a `MatchState`.** It holds a `PlayerView` —
 * its own side in full, the opponent's redacted to counts and public zones. So
 * this interface exposes a view and never a state, and every question the UI
 * used to answer by reading the state has to be answered some other way:
 *
 * | The UI needs | Where it comes from now |
 * |---|---|
 * | Whose turn, which phase, the winner, the turn number | `PlayerView` — it carries all four |
 * | Either player's board, discard, location, counters | `PlayerView` — public zones are not redacted |
 * | *"What may I legally do right now?"* | `legality()` — see below |
 *
 * ## Why legality is a transport method and not a free function
 *
 * The obvious objection is that legality is a rules question and rules belong
 * in the engine. They do, and they stay there — but the two implementations
 * reach the same engine answers by different routes, and only the transport
 * knows which route it is on.
 *
 * `LocalTransport` is the authority. It holds the real `MatchState` and calls
 * `checkPlayable`, `attackableBy` and `canUseFixation` directly, which is why
 * the offline game's greyed-out cards are exactly the engine's opinion.
 * `WsTransport` holds no state at all and must derive the same answers from its
 * view. Putting `legality()` here is what lets that difference exist in one
 * place instead of leaking into every screen that wants to grey out a button.
 *
 * This is not a new idea, it is the existing one applied consistently: §6
 * already puts `confluences()` on the transport for precisely this reason
 * ("local impl computes it, ws impl computes it from the view").
 *
 * And to be clear about what this is worth: **legality here is UX, not
 * security** (§4.3). It decides what looks pressable. The server re-checks
 * every intent with the same engine code before it changes anything, so a
 * client that lies to itself about legality gets a `rejected` frame and
 * nothing else.
 */

import type {
  ConfluenceAvailability,
  ContentIndex,
  EngineEvent,
  MatchRecord,
  PlayerIntent,
  PlayerView,
  RulesErrorShape,
  Seat,
} from "../engine/types";

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/**
 * The match clocks, as reported by whoever owns them.
 *
 * Online that is the server and only the server (§4.4): the client interpolates
 * a countdown from these numbers and never decides that time is up. Offline
 * `LocalTransport` fills them from a local timer, so the HUD's countdown code is
 * the same code in both builds — which is the point of stating them here rather
 * than letting the HUD keep its own clock.
 */
export interface MatchClocks {
  activeSeat: Seat;
  turnMsRemaining: number;
  /** Canon §2's 15-second "Stream Buffering" rope, once the turn timer is out. */
  ropeMsRemaining: number;
  /** Sender's monotonic clock at send time; the client derives an offset from it. */
  serverNowMs: number;
}

// ---------------------------------------------------------------------------
// Server → client payloads
// ---------------------------------------------------------------------------

/**
 * A full state correction. Events are the truth for *animation*; snapshots are
 * the truth for *state* (§4.6).
 *
 * `view.you.deck` is sanitized on the wire — a seat may not read its own deck
 * order, or a modified client would know its next draw (§5.2). The instances it
 * has legitimately learned (Algorithm Syndicate scry, and any future reveal)
 * come back named in `revealedDeckInstanceIds`, which rides in the envelope so
 * that no canonical type has to change.
 */
export interface MatchSnapshot {
  seq: number;
  view: PlayerView;
  revealedDeckInstanceIds: string[];
  clocks: MatchClocks;
  spectatorCount: number;
}

/**
 * Why a batch happened.
 *
 * A discriminated union rather than a flat `{ kind; seat; clientIntentId? }`,
 * because `Seat` has no null member and a `"system"` cause — match start, a
 * scripted wave landing — has no seat to name. The flat form forced a plausible
 * lie: `LocalTransport` was passing `activeSeat`, which reads like a fact.
 *
 * `zEventCause` in `protocol.ts` is declared as `z.ZodType<EventCause>`, so this
 * type and the wire schema cannot drift apart without failing to compile. That
 * is the same trick the file already uses for `PlayerIntent` and `TargetRef`,
 * and it is the reason this correction is worth making in one place instead of
 * two.
 */
export type EventCause =
  | { kind: "intent"; seat: Seat; clientIntentId?: number }
  | { kind: "timer"; seat: Seat }
  | { kind: "system"; seat?: Seat };

/**
 * One atomic, ordered group of engine facts.
 *
 * `cause` is what lets the presenter tell a played card from an expired rope:
 * a timeout injects a real `endTurn` intent server-side (§4.4) so that replays
 * stay faithful, and `cause.kind: "timer"` is the only thing distinguishing it.
 */
export interface EventBatch {
  /**
   * True for a batch replayed after a reconnect (§8.3).
   *
   * The presenter should show it instantly rather than at normal pacing, and
   * the view must **not** apply it: the resume snapshot already includes it.
   */
  catchUp?: boolean;
  seq: number;
  cause: EventCause;
  events: EngineEvent[];
  clocks: MatchClocks;
  /** FNV-1a over a canonicalized subset of the seat's view; drives resync (§4.6). */
  viewHash: string;
  /** Present on turn boundaries, resume and resync. */
  snapshot?: MatchSnapshot;
}

/**
 * The typed form of what `LocalMatch.submit()` already returned as a bare
 * string. The engine's `RulesError` has carried a canonical `code` since it was
 * written; only the message was being kept. Nothing here is new information —
 * it is information that was being thrown away.
 */
export type SubmitResult =
  | { ok: true; seq: number }
  | { ok: false; error: RulesErrorShape };

/**
 * Connection health, for the one HUD element that shows it.
 *
 * `LocalTransport` is permanently `live` with an RTT of zero. That is not a
 * placeholder — an in-process match genuinely cannot be unstable — and it means
 * the reconnection UI has a real state machine to render against from day one.
 */
export type TransportStatus =
  | { kind: "connecting" }
  | { kind: "live"; rttMs: number }
  | { kind: "unstable"; rttMs: number }
  | { kind: "disconnected"; graceRemainingMs: number }
  | { kind: "opponentDisconnected"; graceRemainingMs: number }
  | { kind: "closed"; reason: string };

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

/**
 * What the player may legally do right now, as the engine sees it.
 *
 * Previously computed inside the battle screen from a full `MatchState`. It
 * moved here unchanged, because the screen will not have a `MatchState` to
 * compute it from once the transport is a socket.
 *
 * `boardModel.ts` re-exports this so the keyboard, the mirror and their tests
 * keep importing it from where they always have.
 */
export interface Legality {
  /** hand instance ids that could be played right now */
  playable: ReadonlySet<string>;
  /** friendly character instance ids that could attack right now */
  canAttack: ReadonlySet<string>;
  confluences: readonly ConfluenceAvailability[];
  canFixation: boolean;
  canUltimate: boolean;
  canActivateLocation: boolean;
  yourTurn: boolean;
}

export const EMPTY_LEGALITY: Legality = {
  playable: new Set(),
  canAttack: new Set(),
  confluences: [],
  canFixation: false,
  canUltimate: false,
  canActivateLocation: false,
  yourTurn: false,
};

/**
 * Whether it is this seat's turn to act, derived from the view alone.
 *
 * A free function rather than a transport method on purpose: it is pure
 * derivation from three fields, so there is nothing for an implementation to
 * get differently, and one fewer method is one fewer place `WsTransport` can
 * disagree with `LocalTransport`.
 */
export function isYourTurn(view: PlayerView): boolean {
  return view.activeSeat === view.seat && view.phase === "main" && view.winner === null;
}

// ---------------------------------------------------------------------------
// Hotseat
// ---------------------------------------------------------------------------

/**
 * Two people, one device — `docs/design/09-game-modes.md` §17.
 *
 * Optional on the interface, and deliberately so: this is the one mode that
 * *cannot* have a network implementation, because its entire premise is a
 * single screen being physically passed between two players. A `WsTransport`
 * leaves it undefined rather than throwing, so "is this a hotseat?" stays a
 * question about capabilities instead of a question about class names.
 */
export interface HotseatControls {
  /** True while the device is waiting to be passed to the other player. */
  awaitingHandoff(): boolean;
  /** Move the viewing seat. Redaction does the rest — see `LocalMatch.setViewingSeat`. */
  setViewingSeat(seat: Seat): boolean;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface MatchTransport {
  /**
   * The seat this client plays. Not `readonly`: Hotseat moves it, and a getter
   * that silently disagreed with `view().seat` would be worse than a mutable
   * field that does not.
   */
  readonly seat: Seat;

  /**
   * The **resolved** rulebook for this match — balance overrides applied, cards
   * patched, variants cloned. Reading the globally loaded index instead would
   * draw an upgraded card at its printed cost and quietly disagree with the
   * board it is sitting on.
   */
  readonly content: ContentIndex;

  /** Join or rejoin; resolves with the authoritative starting snapshot. */
  connect(): Promise<MatchSnapshot>;

  /** The redacted view this seat is entitled to. */
  view(): PlayerView;

  /**
   * Submit an intent. One in flight per seat (§4.3) — the caller sends and
   * waits, exactly as `LocalMatch`'s `busy` guard already required.
   */
  submit(intent: PlayerIntent): Promise<SubmitResult>;

  /** True while an intent (or, offline, the AI's turn) is still resolving. */
  isBusy(): boolean;

  /** Which two-Current combos are available to this seat right now. */
  confluences(): readonly ConfluenceAvailability[];

  /** What this seat may legally do right now. UX only — the server re-checks. */
  legality(): Legality;

  /**
   * Subscribe to event batches.
   *
   * **The listener may return a promise, and the transport awaits it.** §6
   * writes this as returning `void`; that signature cannot work here. The
   * presenter animates inside this listener, and offline the AI takes its turn
   * the instant `submit()` resolves — so a transport that did not wait would
   * start the rival's turn on top of the animation of the player's.
   *
   * Awaiting is not merely the offline build's problem being pushed into the
   * interface. Online it is the behaviour you want anyway: the ack goes out
   * after the batch has been presented, which is precisely the backpressure
   * signal §7.5 measures, and batches arriving mid-animation queue instead of
   * racing. The existing `MatchListener` already had this shape.
   */
  onBatch(listener: (batch: EventBatch) => void | Promise<void>): () => void;
  onStatus(listener: (status: TransportStatus) => void): () => void;

  /**
   * The finished replay record, or `null` when this client is not the one that
   * owns it.
   *
   * Offline the local process is the authority and always has a record. Online
   * it never can: `PlayerView` carries no `MatchConfig`, so the client knows
   * neither the seed nor either decklist and *cannot* assemble one. The server
   * writes the replay (§13.4) and the client is handed a reference to it.
   *
   * Typed nullable from the start so that callers confront the online case now,
   * while it is a compiler error, rather than later as a crash.
   */
  finishRecord(): MatchRecord | null;

  /** Present only for a hotseat; see `HotseatControls`. */
  readonly hotseat?: HotseatControls;

  close(reason?: string): void;
}
