/**
 * `MatchTransport` over a WebSocket — the same interface, a different authority.
 *
 * Everything above `src/net/` was written once, against the interface, and does
 * not change here (§15). What changes is where the answers come from: legality
 * is derived from a view instead of from the match, `finishRecord()` is `null`
 * because a client cannot assemble a replay it does not hold the seed for, and
 * `hotseat` is absent because two people cannot share one socket.
 *
 * ## The three rules this file exists to obey
 *
 * **Events lead, snapshots correct (§4.6).** A batch is applied to the local
 * view by `viewReducer`, and then `viewHash` is compared against the server's.
 * On a mismatch the client asks for a snapshot rather than trying to work out
 * what it got wrong. Drift is therefore bounded by one batch and self-healing,
 * and — importantly — the reducer is never trusted to be right, only to be fast.
 *
 * **One intent in flight (§4.3).** `submit()` refuses to send a second intent
 * while the first is unanswered, rather than queueing it. Queueing would make
 * the client's idea of causality differ from the room's, and the room's is the
 * one that decides the game.
 *
 * **The client validates the server (§7).** Every inbound frame goes through
 * `zServerEnvelope`. Skipping this is the tempting half — the server is "ours" —
 * and it is what turns a bug in the room into "the opponent's board renders
 * strangely for the rest of the match" instead of one loud error naming the
 * field.
 *
 * ## Sockets are injected
 *
 * `SocketFactory` exists so the whole of this can be driven against a real
 * `Room` in-process, through `tests/helpers/loopback.ts`, with no server and no
 * network. That is what makes §15's rule 4 — the same conformance script run
 * against both transports — possible at all, and it is the only way `resume` is
 * testable, since the offline build has nothing to reconnect to.
 */

import type {
  ConfluenceAvailability,
  ContentIndex,
  MatchRecord,
  PlayerIntent,
  PlayerView,
  Seat,
} from "../engine/types";
import {
  PROTOCOL_VERSION,
  WIRE_LIMITS,
  zServerEnvelope,
  type ServerEnvelope,
} from "./protocol";
import { applyEventsToView } from "./viewReducer";
import { legalityFromView } from "./viewToState";
import { viewHash } from "./view";
import {
  EMPTY_LEGALITY,
  type EventBatch,
  type Legality,
  type MatchSnapshot,
  type MatchTransport,
  type SubmitResult,
  type TransportStatus,
} from "./transport";

// ---------------------------------------------------------------------------
// The socket seam
// ---------------------------------------------------------------------------

export interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface SocketHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
  onError(detail: string): void;
}

/**
 * Opens a socket and wires it to the handlers.
 *
 * Deliberately not shaped like the DOM `WebSocket`. Mirroring `onmessage`,
 * `MessageEvent` and the rest would drag the browser's type surface into a file
 * that needs four operations, and would make the test double a fake `WebSocket`
 * rather than a small object. `browserSockets()` below is the adapter, and it is
 * ten lines.
 */
export type SocketFactory = (url: string, handlers: SocketHandlers) => Socket;

export function browserSockets(): SocketFactory {
  return (url, handlers) => {
    const ws = new WebSocket(url);
    ws.onopen = () => handlers.onOpen();
    ws.onmessage = (event: MessageEvent) => handlers.onMessage(String(event.data));
    ws.onclose = (event: CloseEvent) => handlers.onClose(event.code, event.reason);
    ws.onerror = () => handlers.onError("socket error");
    return {
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
    };
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ReconnectPolicy {
  /** Attempts before giving up and reporting `closed`. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = { maxAttempts: 8, baseDelayMs: 500, maxDelayMs: 8_000 };

export interface WsTransportOptions {
  /** Full socket URL including the access token query parameter. */
  url: string;
  /** The resolved rulebook for this match, as `MatchTransport.content` requires. */
  content: ContentIndex;
  connect: SocketFactory;
  /** Injected so tests are not at the mercy of a real clock. */
  now?: () => number;
  /** Injected timers; returns a cancel function. */
  schedule?: (fn: () => void, delayMs: number) => () => void;
  reconnect?: ReconnectPolicy;
  /** Client build id, sent in `hello` for §14.5's build pinning. */
  build?: string;
  contentHash?: string;
  /** 0 disables the heartbeat, which is what the conformance harness wants. */
  heartbeatMs?: number;
}

type Pending = {
  id: number;
  resolve: (result: SubmitResult) => void;
};

export class WsTransport implements MatchTransport {
  readonly content: ContentIndex;

  /**
   * Declared, not merely omitted.
   *
   * `MatchTransport.hotseat` is optional, so leaving it off would satisfy the
   * interface — and would also make `transport.hotseat` a compile error on this
   * concrete type, which is the opposite of useful for a caller asking "can two
   * people share this?". Stating `undefined` answers the question instead of
   * refusing it.
   */
  readonly hotseat: undefined;

  private socket: Socket | null = null;
  private readonly options: WsTransportOptions;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, delayMs: number) => () => void;
  private readonly policy: ReconnectPolicy;

  private currentSeat: Seat = 0;
  private currentView: PlayerView | null = null;
  private sessionId: string | null = null;
  private resumeToken: string | null = null;

  /** Highest batch `seq` applied. Also the ack cursor and the resume cursor. */
  private lastSeq = 0;
  private nextIntentId = 1;
  private pending: Pending | null = null;

  private status: TransportStatus = { kind: "connecting" };
  private batchListeners: ((batch: EventBatch) => void | Promise<void>)[] = [];
  private statusListeners: ((status: TransportStatus) => void)[] = [];

  private connectResolve: ((snapshot: MatchSnapshot) => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private attempts = 0;
  private cancelReconnect: (() => void) | null = null;
  private cancelHeartbeat: (() => void) | null = null;
  private closedByUs = false;
  private matchOver = false;

  /**
   * Inbound frames are handled one at a time, in arrival order.
   *
   * Batch listeners may be async — the presenter animates inside one — so
   * without this a second frame arriving mid-animation would be applied to the
   * view while the first was still being presented, and the two would interleave.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Frames written before `connect()` returned its socket. See `open()`. */
  private outbox: string[] = [];

  constructor(options: WsTransportOptions) {
    this.options = options;
    this.content = options.content;
    this.now = options.now ?? (() => Date.now());
    this.policy = options.reconnect ?? DEFAULT_RECONNECT;
    this.schedule =
      options.schedule ??
      ((fn, delayMs) => {
        const handle = setTimeout(fn, delayMs);
        return () => clearTimeout(handle);
      });
  }

  // --- identity ---------------------------------------------------------------

  get seat(): Seat {
    return this.currentSeat;
  }

  // --- lifecycle --------------------------------------------------------------

  connect(): Promise<MatchSnapshot> {
    return new Promise<MatchSnapshot>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.open();
    });
  }

  private open(): void {
    this.setStatus({ kind: "connecting" });
    this.outbox = [];
    /**
     * `connect` may call `onOpen` **before it returns**.
     *
     * A browser `WebSocket` never does — the open event is always a later task —
     * so this looks safe and is not: any synchronous socket makes `sendHello()`
     * run while `this.socket` is still null, and the `hello` is silently
     * dropped. The transport then waits for a `welcome` that will never come.
     *
     * Found by the lobby's test double, which opens synchronously because there
     * is no reason for a fake not to. The loopback harness happens to defer
     * `onOpen` to a microtask, which is exactly why it did not catch this — a
     * test double that is realistic in every respect tests only the paths the
     * real thing takes.
     */
    const socket = this.options.connect(this.options.url, {
      onOpen: () => this.sendHello(),
      onMessage: (text) => this.enqueue(() => this.receive(text)),
      onClose: (code, reason) => this.enqueue(() => this.handleClose(code, reason)),
      onError: (detail) => this.enqueue(() => this.handleClose(1006, detail)),
    });
    this.socket = socket;
    const buffered = this.outbox;
    this.outbox = [];
    for (const text of buffered) socket.send(text);
  }

  private sendHello(): void {
    this.send({
      v: PROTOCOL_VERSION,
      t: "hello",
      ts: this.now(),
      matchToken: tokenFromUrl(this.options.url),
      build: this.options.build ?? "dev",
      contentHash: this.options.contentHash ?? "unknown",
      ...(this.sessionId && this.resumeToken
        ? { resume: { sessionId: this.sessionId, resumeToken: this.resumeToken, lastAckSeq: this.lastSeq } }
        : {}),
    });
  }

  close(reason = "client closed"): void {
    this.closedByUs = true;
    this.cancelReconnect?.();
    this.cancelHeartbeat?.();
    this.socket?.close(1000, reason);
    this.socket = null;
    this.setStatus({ kind: "closed", reason });
    // A caller awaiting `connect()` when the match is torn down would otherwise
    // wait for ever.
    this.connectReject?.(new Error(`transport closed before connecting: ${reason}`));
    this.connectResolve = null;
    this.connectReject = null;
    this.failPending({ code: "invalidIntent", message: "transport closed" });
  }

  // --- reading ----------------------------------------------------------------

  view(): PlayerView {
    if (!this.currentView) throw new Error("view() before connect() resolved; there is nothing authoritative to show yet");
    // Cloned for the same reason `LocalTransport` clones: a caller that mutates
    // the returned view must not be able to corrupt the transport's own copy.
    return structuredClone(this.currentView);
  }

  isBusy(): boolean {
    return this.pending !== null;
  }

  legality(): Legality {
    if (!this.currentView) return EMPTY_LEGALITY;
    return legalityFromView(this.currentView, this.content);
  }

  confluences(): readonly ConfluenceAvailability[] {
    return this.legality().confluences;
  }

  /**
   * Always `null`, and typed that way on the interface since phase 1.
   *
   * A `MatchRecord` is `{ seed, decks, intents }`. A client holds none of the
   * three: `PlayerView` carries no seed and no decklist, by design, because
   * either would tell it what it is about to draw. The server writes the replay
   * (§13.4) and hands back a reference.
   */
  finishRecord(): MatchRecord | null {
    return null;
  }

  // --- writing ----------------------------------------------------------------

  async submit(intent: PlayerIntent): Promise<SubmitResult> {
    if (!this.socket || this.status.kind === "closed") {
      return { ok: false, error: { code: "invalidIntent", message: "not connected" } };
    }
    if (this.pending) {
      // §4.3 forbids pipelining. Refused rather than queued: a queue would let
      // the client's causality differ from the room's, and the room's decides.
      return { ok: false, error: { code: "invalidIntent", message: "an intent is already in flight" } };
    }

    const id = this.nextIntentId++;
    const answer = new Promise<SubmitResult>((resolve) => {
      this.pending = { id, resolve };
    });
    this.send({ v: PROTOCOL_VERSION, t: "intent", ts: this.now(), id, intent });
    return answer;
  }

  onBatch(listener: (batch: EventBatch) => void | Promise<void>): () => void {
    this.batchListeners.push(listener);
    return () => {
      this.batchListeners = this.batchListeners.filter((l) => l !== listener);
    };
  }

  onStatus(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.push(listener);
    /**
     * A late subscriber is told the current status immediately.
     *
     * `LocalTransport` has always done this — "a listener attached after
     * connect() would sit on 'connecting' forever" — and this one did not, so
     * the two implementations behaved differently for any HUD that subscribed
     * after connecting. Found by the conformance suite on its first run, which
     * is the entire argument for having one: neither transport's own tests
     * would ever have noticed, because each was consistent with itself.
     */
    listener(this.status);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  // --- inbound ----------------------------------------------------------------

  private enqueue(work: () => Promise<void> | void): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      this.setStatus({ kind: "closed", reason: error instanceof Error ? error.message : String(error) });
    });
  }

  private async receive(text: string): Promise<void> {
    if (text.length > WIRE_LIMITS.maxFrameBytes) {
      return this.fatal(`server frame of ${text.length} bytes exceeds the ${WIRE_LIMITS.maxFrameBytes} cap`);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return this.fatal("server sent unparseable JSON");
    }

    const parsed = zServerEnvelope.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return this.fatal(`server frame failed validation: ${issue ? `${issue.path.join(".")} ${issue.message}` : "unknown"}`);
    }
    const frame = parsed.data as ServerEnvelope;

    switch (frame.t) {
      case "welcome":
        return this.onWelcome(frame);
      case "batch":
        return this.onBatchFrame(frame);
      case "snapshot":
        this.adoptSnapshot({
          seq: frame.seq,
          view: frame.view as PlayerView,
          revealedDeckInstanceIds: frame.revealedDeckInstanceIds,
          clocks: frame.clocks,
          spectatorCount: frame.spectatorCount,
        });
        return;
      case "accepted":
        return this.settle(frame.id, { ok: true, seq: frame.seq });
      case "rejected":
        return this.settle(frame.id, { ok: false, error: frame.error });
      case "pong": {
        const rtt = Math.max(0, this.now() - frame.clientTs);
        this.setStatus({ kind: "live", rttMs: rtt });
        return;
      }
      case "presence":
        /**
         * Only the opponent's presence changes this client's status — its own
         * connection is something it can observe directly and more accurately.
         *
         * The `connected` branch is not symmetry for its own sake: without it
         * the status stuck on `opponentDisconnected` for the rest of the match,
         * so a player who dropped and came back left the other one staring at a
         * "waiting for them" banner through a game that had already resumed.
         */
        if (frame.seat === this.currentSeat) return;
        if (frame.status === "disconnected") {
          this.setStatus({ kind: "opponentDisconnected", graceRemainingMs: frame.graceRemainingMs });
        } else if (this.status.kind === "opponentDisconnected") {
          this.setStatus({ kind: "live", rttMs: 0 });
        }
        return;
      case "ended":
        // The `matchEnded` event in the batch is what the presenter animates;
        // this frame only tells the transport to stop trying to reconnect.
        this.matchOver = true;
        this.cancelHeartbeat?.();
        return;
      case "fatal":
        return this.fatal(`${frame.code}: ${frame.message}`);
      case "clock":
      case "emote":
        return;
    }
  }

  private onWelcome(frame: Extract<ServerEnvelope, { t: "welcome" }>): void {
    this.currentSeat = frame.seat;
    this.sessionId = frame.sessionId;
    this.resumeToken = frame.resumeToken;
    this.attempts = 0;

    const snapshot: MatchSnapshot = {
      seq: frame.snapshot.seq,
      view: frame.snapshot.view as PlayerView,
      revealedDeckInstanceIds: frame.snapshot.revealedDeckInstanceIds,
      clocks: frame.snapshot.clocks,
      spectatorCount: frame.snapshot.spectatorCount,
    };
    this.adoptSnapshot(snapshot);
    this.setStatus({ kind: "live", rttMs: 0 });
    this.startHeartbeat(frame.netConfig.heartbeatSeconds * 1000);

    const resolve = this.connectResolve;
    this.connectResolve = null;
    this.connectReject = null;
    resolve?.(snapshot);
  }

  private async onBatchFrame(frame: Extract<ServerEnvelope, { t: "batch" }>): Promise<void> {
    /**
     * At-least-once delivery with dedupe by `seq` (§4.3). A resumed socket may
     * legitimately re-send a batch this client already applied, and applying it
     * twice would double every draw and every point of damage in it.
     *
     * `catchUp` is the exception, and the reason the flag exists: after a
     * reconnect the server replays what was missed so the *animation* is not
     * lost. Those seqs are all "already applied" — the resume snapshot includes
     * them — so without the flag they are indistinguishable from duplicates and
     * would be correctly dropped along with the thing they were sent for.
     */
    const catchUp = frame.catchUp === true;
    if (!catchUp && frame.seq <= this.lastSeq) return;

    const batch: EventBatch = {
      ...(catchUp ? { catchUp: true } : {}),
      seq: frame.seq,
      cause: frame.cause,
      events: frame.events as EventBatch["events"],
      clocks: frame.clocks,
      viewHash: frame.viewHash,
      ...(frame.snapshot
        ? {
            snapshot: {
              seq: frame.snapshot.seq,
              view: frame.snapshot.view as PlayerView,
              revealedDeckInstanceIds: frame.snapshot.revealedDeckInstanceIds,
              clocks: frame.snapshot.clocks,
              spectatorCount: frame.snapshot.spectatorCount,
            },
          }
        : {}),
    };

    /**
     * A catch-up batch is shown, never applied.
     *
     * §4.6: events are the truth for animation, snapshots are the truth for
     * state — and the snapshot this client resumed with already contains every
     * one of these events. Applying them again would deal the same cards twice.
     */
    if (this.currentView && !catchUp) {
      this.currentView = applyEventsToView(this.currentView, batch.events, this.content);
    }
    // A snapshot in the batch outranks whatever the reducer just produced. §4.6:
    // events are the truth for animation, snapshots are the truth for state.
    if (batch.snapshot && !catchUp) this.currentView = batch.snapshot.view;
    if (!catchUp) this.lastSeq = frame.seq;

    // A catch-up batch describes a moment in the past, so its hash is a hash of
    // the past. Comparing it to the present view would report drift that is not
    // drift and trigger a resync on every reconnect.
    const local = this.currentView ? viewHash(this.currentView) : null;
    const agreed = catchUp || local === frame.viewHash;

    // Listeners run before the resync request, so the animation of what did
    // happen is not dropped on the floor by a correction.
    for (const listener of [...this.batchListeners]) await listener(batch);

    if (!catchUp) {
      this.send({ v: PROTOCOL_VERSION, t: "ack", ts: this.now(), seq: this.lastSeq, ...(local ? { viewHash: local } : {}) });
    }

    if (!agreed) {
      /**
       * The reducer and the room disagree about what this seat can see. The
       * client does not try to work out which of them is wrong — it is always
       * the client, because the room holds the state — so it asks for the
       * authoritative view and adopts it.
       */
      this.send({ v: PROTOCOL_VERSION, t: "resync", ts: this.now(), reason: "hashMismatch" });
    }
  }

  private adoptSnapshot(snapshot: MatchSnapshot): void {
    this.currentView = snapshot.view;
    this.currentSeat = snapshot.view.seat;
    this.lastSeq = Math.max(this.lastSeq, snapshot.seq);
  }

  private settle(id: number, result: SubmitResult): void {
    if (!this.pending || this.pending.id !== id) return;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(result);
  }

  private failPending(error: { code: SubmitFailure; message: string }): void {
    if (!this.pending) return;
    const { resolve } = this.pending;
    this.pending = null;
    resolve({ ok: false, error });
  }

  // --- connection health ------------------------------------------------------

  private startHeartbeat(intervalMs: number): void {
    this.cancelHeartbeat?.();
    const period = this.options.heartbeatMs ?? intervalMs;
    if (period <= 0) return;

    const beat = (): void => {
      if (this.matchOver || this.status.kind === "closed") return;
      this.send({ v: PROTOCOL_VERSION, t: "ping", ts: this.now(), ackSeq: this.lastSeq });
      this.cancelHeartbeat = this.schedule(beat, period);
    };
    this.cancelHeartbeat = this.schedule(beat, period);
  }

  private handleClose(code: number, reason: string): void {
    this.socket = null;
    this.outbox = [];
    this.cancelHeartbeat?.();
    if (this.closedByUs || this.matchOver) {
      this.setStatus({ kind: "closed", reason: this.matchOver ? "match ended" : reason });
      return;
    }

    // An in-flight intent cannot be answered by a socket that no longer exists.
    // Resolved rather than left hanging: the caller is awaiting it, and §4.3's
    // idempotency means re-sending after the resume is safe.
    this.failPending({ code: "invalidIntent", message: `connection lost (${code})` });

    if (this.attempts >= this.policy.maxAttempts) {
      this.setStatus({ kind: "closed", reason: `gave up reconnecting after ${this.attempts} attempts` });
      return;
    }

    const delay = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** this.attempts);
    this.attempts += 1;
    this.setStatus({ kind: "disconnected", graceRemainingMs: delay });
    this.cancelReconnect = this.schedule(() => this.open(), delay);
  }

  private fatal(reason: string): void {
    this.closedByUs = true;
    this.cancelHeartbeat?.();
    this.socket?.close(1002, "protocol");
    this.socket = null;
    this.failPending({ code: "invalidIntent", message: reason });
    this.setStatus({ kind: "closed", reason });
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    reject?.(new Error(reason));
  }

  /**
   * `closed` is terminal, and its reason is the *first* one.
   *
   * Without this guard the useful reason is always lost. Closing because a
   * server frame failed validation calls `socket.close()`, which fires
   * `onClose`, which sets the status again — with the socket's generic close
   * reason on top of the diagnosis. The first status to arrive is the one that
   * says why; every later one is an echo of the tidying up.
   */
  private setStatus(status: TransportStatus): void {
    if (this.status.kind === "closed" && status.kind === "closed") return;
    // A status *stream* should report changes. Re-announcing `connecting` when
    // it was already connecting makes a HUD flicker for no reason, and makes
    // the sequence useless as a record of what happened. `live` carries an RTT,
    // so equality has to compare the payload rather than just the kind.
    if (JSON.stringify(this.status) === JSON.stringify(status)) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  private send(frame: unknown): void {
    const text = JSON.stringify(frame);
    // Buffered only across the synchronous gap in `open()`; anything queued when
    // a socket dies is dropped in `handleClose`, because re-sending a frame from
    // the connection that failed is worse than not sending it.
    if (!this.socket) {
      this.outbox.push(text);
      return;
    }
    this.socket.send(text);
  }
}

type SubmitFailure = Extract<SubmitResult, { ok: false }>["error"]["code"];

/**
 * The `hello` frame repeats the token from the URL.
 *
 * It is already in the query string — browser `WebSocket` cannot set an
 * `Authorization` header, so there is nowhere else to put it — and the gateway
 * authenticates from there. `hello.matchToken` is required by the schema, so it
 * is filled from the same place rather than left as a second value that could
 * disagree with the first.
 */
function tokenFromUrl(url: string): string {
  const query = url.slice(url.indexOf("?") + 1);
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (key === "access_token" && value) return decodeURIComponent(value);
  }
  return "none";
}
