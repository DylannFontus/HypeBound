/**
 * The client's end of the queue (§9).
 *
 * Separate from `MatchTransport` because a queue is not a match: there is no
 * seat, no room, no sequence number and nothing to redact. Trying to express
 * "I am waiting" through an interface built around an authoritative game state
 * would mean inventing an empty one.
 *
 * ## The offer is the feature
 *
 * §9.3's last row says casual should "offer *Play the AI instead* (never a fake
 * human)" after four minutes. For a game with the player population this one has
 * today, that is not a fallback — it is the expected outcome of most attempts to
 * queue. `onAiOffer` is therefore part of the interface rather than a detail of
 * some future polish pass, and the honest counts in `onSearching` are the other
 * half: telling somebody that nobody else is queuing is a much better experience
 * than an endless spinner, and it is the difference between a game that is quiet
 * and a game that looks broken.
 */

import { PROTOCOL_VERSION, WIRE_LIMITS, zLobbyServerEnvelope } from "./protocol";
import type { DeckList, Seat } from "../engine/types";
import type { SocketFactory } from "./wsTransport";

export interface QueueStatus {
  readonly waitedMs: number;
  /** The current rating band, so the UI can say "looking wider" and mean it. */
  readonly band: number;
  /** How many people are in this queue, truthfully. Usually zero. */
  readonly waiting: number;
}

export interface MatchFound {
  readonly matchId: string;
  readonly seat: Seat;
  readonly opponentLeaderCardId: string;
}

export interface QueueRejection {
  readonly code: "invalidDeck" | "buildMismatch" | "notAuthenticated" | "alreadyQueued" | "unavailable";
  readonly message: string;
}

export interface LobbyHandlers {
  onQueued?: (ticketId: string, waiting: number) => void;
  onSearching?: (status: QueueStatus) => void;
  /** Fired once, after §16's `mm.aiOfferAfterSeconds`. The player stays queued. */
  onAiOffer?: (waitedMs: number) => void;
  onMatchFound?: (found: MatchFound) => void;
  onRejected?: (rejection: QueueRejection) => void;
  onClosed?: (reason: string) => void;
}

export interface LobbySocketOptions {
  url: string;
  connect: SocketFactory;
  build: string;
  contentHash: string;
  now?: () => number;
  handlers?: LobbyHandlers;
}

export type LobbyState = "idle" | "connecting" | "queued" | "matched" | "closed";

export class LobbySocket {
  private socket: ReturnType<SocketFactory> | null = null;
  /** Frames written before `connect()` returned its socket. See `enqueue()`. */
  private outbox: string[] = [];
  private state: LobbyState = "idle";
  private pendingDeck: DeckList | null = null;
  private ticketId: string | null = null;
  private readonly now: () => number;

  constructor(private readonly options: LobbySocketOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get status(): LobbyState {
    return this.state;
  }

  get ticket(): string | null {
    return this.ticketId;
  }

  /**
   * Join the queue with a deck.
   *
   * The deck goes on the wire because the server validates it at ticket
   * creation (§9.2) — "an illegal deck never reaches a room". There is nowhere
   * for the server to look one up by id until cloud saves exist, and even then
   * sending it keeps the check on the thing actually being played rather than on
   * whatever was last saved under that name.
   */
  enqueue(deck: DeckList): void {
    if (this.state === "queued" || this.state === "connecting") return;
    this.pendingDeck = deck;
    this.state = "connecting";
    this.outbox = [];
    // `connect` is allowed to call `onOpen` synchronously, before it has
    // returned the socket to assign. See the same note in `wsTransport.ts`:
    // without the buffer the `enqueue` frame is dropped and the player waits in
    // a queue the server never put them in.
    const socket = this.options.connect(this.options.url, {
      onOpen: () => this.sendEnqueue(),
      onMessage: (text) => this.receive(text),
      onClose: (code, reason) => this.closed(`${reason || "connection closed"} (${code})`),
      onError: (detail) => this.closed(detail),
    });
    this.socket = socket;
    const buffered = this.outbox;
    this.outbox = [];
    for (const text of buffered) socket.send(text);
  }

  /** Leave. Tells the server first, so the ticket goes rather than timing out. */
  dequeue(): void {
    if (this.socket && this.state === "queued") {
      this.send({ v: PROTOCOL_VERSION, t: "dequeue", ts: this.now() });
    }
    this.close("left the queue");
  }

  close(reason = "closed"): void {
    this.socket?.close(1000, reason);
    this.socket = null;
    this.pendingDeck = null;
    if (this.state !== "closed") {
      this.state = "closed";
      this.options.handlers?.onClosed?.(reason);
    }
  }

  ping(): void {
    this.send({ v: PROTOCOL_VERSION, t: "lobbyPing", ts: this.now() });
  }

  // --- internals --------------------------------------------------------------

  private sendEnqueue(): void {
    if (!this.pendingDeck) return;
    this.send({
      v: PROTOCOL_VERSION,
      t: "enqueue",
      ts: this.now(),
      queueId: "casual",
      deck: this.pendingDeck,
      build: this.options.build,
      contentHash: this.options.contentHash,
    });
  }

  private receive(text: string): void {
    if (text.length > WIRE_LIMITS.maxFrameBytes) return this.closed(`server frame of ${text.length} bytes is over the cap`);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return this.closed("server sent unparseable JSON");
    }

    // Same discipline as the match protocol: the client validates the server.
    const parsed = zLobbyServerEnvelope.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return this.closed(`server frame failed validation: ${issue ? `${issue.path.join(".")} ${issue.message}` : "unknown"}`);
    }

    const frame = parsed.data;
    const handlers = this.options.handlers;

    switch (frame.t) {
      case "queued":
        this.state = "queued";
        this.ticketId = frame.ticketId;
        handlers?.onQueued?.(frame.ticketId, frame.waiting);
        return;

      case "searching":
        handlers?.onSearching?.({ waitedMs: frame.waitedMs, band: frame.band, waiting: frame.waiting });
        return;

      case "aiOffer":
        handlers?.onAiOffer?.(frame.waitedMs);
        return;

      case "matchFound":
        /**
         * The queue's job ends here. The caller opens a `WsTransport` against
         * `matchId`; this socket is closed rather than kept, because a lobby
         * connection held open through a match is a socket nobody is reading and
         * a ticket the server has to keep deciding not to pair.
         */
        this.state = "matched";
        handlers?.onMatchFound?.({
          matchId: frame.matchId,
          seat: frame.seat,
          opponentLeaderCardId: frame.opponentLeaderCardId,
        });
        this.socket?.close(1000, "matched");
        this.socket = null;
        return;

      case "queueRejected":
        handlers?.onRejected?.({ code: frame.code, message: frame.message });
        this.close(`refused: ${frame.code}`);
        return;

      case "lobbyPong":
        return;
    }
  }

  private closed(reason: string): void {
    this.socket = null;
    // A match being found closes the socket on purpose; that is not a failure,
    // and reporting it as one would show an error over the loading screen of a
    // game that is about to start.
    if (this.state === "matched") return;
    if (this.state === "closed") return;
    this.state = "closed";
    this.options.handlers?.onClosed?.(reason);
  }

  private send(frame: unknown): void {
    const text = JSON.stringify(frame);
    if (!this.socket) {
      this.outbox.push(text);
      return;
    }
    this.socket.send(text);
  }
}
