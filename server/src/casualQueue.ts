/**
 * The casual queue as a Durable Object — one global shard.
 *
 * §14.1 sizes matchmaking at "2 vCPU per (queue, region) shard, 20,000 tickets".
 * There is one shard here and there will be for a long time, because sharding a
 * queue is a fix for having too many players and the failure mode at the other
 * end — a shard so thin nobody is ever in it with you — is the one this game
 * actually faces. `idFromName("casual")` is the whole placement strategy.
 *
 * Thin, like `matchRoom.ts`: sockets, storage, alarms, and the one thing only
 * the platform can do — creating the match room. The pairing lives in
 * `queue/queue.ts` and is tested without any of this.
 */

import { DurableObject } from "cloudflare:workers";
import {
  contentHash,
  getContent,
  isDeckLegal,
  validateDeck,
  type ContentIndex,
  type DeckList,
  type Seat,
} from "./shared/engine";
import { PROTOCOL_VERSION, WIRE_LIMITS, parseLobbyFrame, type LobbyServerEnvelope } from "./shared/wire";
import { MonotonicClock } from "./room/clock";
import { Queue, effectiveBand, type Ticket } from "./queue/queue";
import type { InitBody } from "./matchRoom";
import type { Env } from "./env";

interface SocketIdentity {
  readonly userId: string;
  readonly ticketId: string;
}

const STORAGE_TICKETS = "tickets";
const STORAGE_MINTED = "minted";

/** §9.4's loop runs at 1 Hz. Also the cadence of the honest `searching` update. */
const TICK_MS = 1_000;

/**
 * Every account rates 1500 with a wide deviation, because there is nowhere to
 * read a real one from yet — ratings land with the results writes in phase 5.
 *
 * A wide RD is the honest default rather than a convenient one: §9.3 widens the
 * band by `min(200, 1.5 × RD)` precisely so that players the system knows
 * nothing about are matched loosely and converge fast. Pretending to a
 * confidence we do not have would make the queue *stricter* than it should be,
 * which in an empty queue means never pairing at all.
 */
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;

export class CasualQueue extends DurableObject<Env> {
  private content: ContentIndex | null = null;
  private queue: Queue | null = null;
  private readonly clock = new MonotonicClock();
  private minted = 0;

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      // Useful for a status page and for checking the queue is alive without
      // joining it, which is not the same question.
      const queue = await this.load();
      return Response.json({ ok: true, waiting: queue.size });
    }

    const userId = request.headers.get("X-Hypebound-User");
    if (!userId) return new Response("unauthenticated", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const ticketId = crypto.randomUUID();

    server.serializeAttachment({ userId, ticketId } satisfies SocketIdentity);
    this.ctx.acceptWebSocket(server, [`ticket:${ticketId}`]);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) return ws.close(1011, "no identity on this socket");
    if (typeof message !== "string") return ws.close(1008, "binary frames are not part of protocol v1");

    const parsed = parseLobbyFrame(message);
    if (!parsed.ok) {
      this.send(ws, { t: "queueRejected", v: PROTOCOL_VERSION, ts: this.clock.now(), code: "unavailable", message: parsed.detail.slice(0, 512) });
      return ws.close(1008, "protocol");
    }

    const frame = parsed.frame;
    if (frame.v !== PROTOCOL_VERSION) return ws.close(1008, "protocolVersion");
    const now = this.clock.now();

    switch (frame.t) {
      case "lobbyPing":
        return this.send(ws, { t: "lobbyPong", v: PROTOCOL_VERSION, ts: now, clientTs: frame.ts, serverTs: now });

      case "dequeue":
        return this.leave(identity.ticketId);

      case "enqueue": {
        const rejection = await this.enqueue(identity, frame, now);
        if (rejection) return this.send(ws, rejection);
        const queue = await this.load();
        this.send(ws, { t: "queued", v: PROTOCOL_VERSION, ts: now, ticketId: identity.ticketId, waiting: queue.size });
        await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
        return;
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // Closing the tab leaves the queue. Unlike a match, there is nothing here
    // worth holding a place for — §8.2's grace window protects a game in
    // progress, and a ticket is not one.
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) return;
    await this.leave(identity.ticketId);
  }

  /**
   * Take a ticket out of the queue **and** delete the deck stored with it.
   *
   * One method rather than two lines at each call site, because the two lines
   * had already drifted apart: the deck row was deleted only in `startMatch`,
   * so the two ways of *not* being paired — pressing cancel, and closing the
   * tab — both left a decklist in Durable Object storage with nothing left to
   * reference it. Permanently, and including the deck's user-typed name.
   *
   * That is a privacy defect rather than a leak of disk: the deck was sent for
   * validation, the validation is over, and there is no reason to still have
   * it. Keeping removal in one place is what stops the third exit path from
   * forgetting again.
   */
  private async leave(ticketId: string): Promise<void> {
    const queue = await this.load();
    queue.remove(ticketId);
    await this.ctx.storage.delete(`deck:${ticketId}`);
    await this.persist(queue);
  }

  override async alarm(): Promise<void> {
    const queue = await this.load();
    const now = this.clock.now();

    for (const pairing of queue.pair(now)) {
      await this.startMatch(pairing.matchId, pairing.seats);
    }

    for (const ticket of queue.offerAi(now)) {
      this.toTicket(ticket.ticketId, {
        t: "aiOffer",
        v: PROTOCOL_VERSION,
        ts: now,
        waitedMs: now - ticket.enqueuedAtMs,
      });
    }

    /**
     * The honest status line. `waiting` is the true count, which is usually
     * zero, and saying zero is the difference between a game that is quiet and
     * a game that appears broken.
     */
    for (const ticket of queue.all()) {
      const waitedMs = now - ticket.enqueuedAtMs;
      this.toTicket(ticket.ticketId, {
        t: "searching",
        v: PROTOCOL_VERSION,
        ts: now,
        waitedMs,
        band: Math.round(effectiveBand(waitedMs, ticket.rd)),
        waiting: queue.size,
      });
    }

    await this.persist(queue);
    if (queue.size > 0) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  // --- enqueue ----------------------------------------------------------------

  private async enqueue(
    identity: SocketIdentity,
    frame: { deck: DeckList; build: string; contentHash: string },
    nowMs: number
  ): Promise<LobbyServerEnvelope | null> {
    const content = this.getContentIndex();

    /**
     * §14.5, checked here rather than at the room. A client on a different build
     * cannot be paired at all, so refusing at ticket creation is both earlier
     * and clearer than letting them wait in a queue they can never leave.
     */
    const expected = contentHash(content);
    if (frame.contentHash !== expected) {
      return {
        t: "queueRejected",
        v: PROTOCOL_VERSION,
        ts: nowMs,
        code: "buildMismatch",
        message: `this server is running content ${expected}; reload to get the current build`,
      };
    }

    /**
     * §9.2: "Deck legality … validated **at ticket creation**, not at match
     * start — an illegal deck never reaches a room." The same `validateDeck` the
     * deck builder uses, so a deck the client accepted and the server refuses is
     * a bug in one of them rather than a difference of opinion.
     */
    if (!isDeckLegal(content, frame.deck)) {
      const problems = validateDeck(content, frame.deck);
      return {
        t: "queueRejected",
        v: PROTOCOL_VERSION,
        ts: nowMs,
        code: "invalidDeck",
        message: problems.map((p) => p.message).join("; ").slice(0, 512) || "deck is not legal",
      };
    }

    const queue = await this.load();
    const ticket: Ticket = {
      ticketId: identity.ticketId,
      accountId: identity.userId,
      queueId: "casual",
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
      enqueuedAtMs: nowMs,
      build: frame.build,
      contentHash: frame.contentHash,
      deckHash: hashDeck(frame.deck),
      leaderCardId: frame.deck.leaderCardId,
      recentOpponents: [],
      flags: { newPlayer: true, riskFlagged: false },
    };
    queue.add(ticket);
    await this.ctx.storage.put(`deck:${ticket.ticketId}`, frame.deck);
    await this.persist(queue);
    return null;
  }

  private async startMatch(matchId: string, seats: readonly [Ticket, Ticket]): Promise<void> {
    const decks = await Promise.all(seats.map((t) => this.ctx.storage.get<DeckList>(`deck:${t.ticketId}`)));
    if (!decks[0] || !decks[1]) return; // a ticket vanished mid-pairing; both go back to waiting

    const seed = crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;
    const firstSeat = ((crypto.getRandomValues(new Uint8Array(1))[0]! & 1) as Seat);

    const body: InitBody = {
      matchId,
      build: this.env.BUILD ?? "dev",
      config: { seed, decks: [decks[0], decks[1]], firstSeat },
      players: [seats[0].accountId, seats[1].accountId],
    };

    const stub = this.env.MATCH_ROOM.get(this.env.MATCH_ROOM.idFromName(matchId));
    const created = await stub.fetch(
      new Request("https://room/init", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    );
    if (!created.ok) {
      // The room could not be created. Telling both players to connect to it
      // would strand them on a socket that 404s, so they are told nothing and
      // stay queued — the next tick tries again with fresh tickets.
      return;
    }

    const now = this.clock.now();
    for (const [index, ticket] of seats.entries()) {
      const other = seats[index === 0 ? 1 : 0]!;
      this.toTicket(ticket.ticketId, {
        t: "matchFound",
        v: PROTOCOL_VERSION,
        ts: now,
        matchId,
        seat: index as Seat,
        opponentLeaderCardId: other.leaderCardId,
      });
      await this.ctx.storage.delete(`deck:${ticket.ticketId}`);
    }
  }

  // --- plumbing ---------------------------------------------------------------

  private getContentIndex(): ContentIndex {
    this.content ??= getContent();
    return this.content;
  }

  private async load(): Promise<Queue> {
    if (this.queue) return this.queue;
    this.minted = (await this.ctx.storage.get<number>(STORAGE_MINTED)) ?? 0;
    const stored = (await this.ctx.storage.get<Ticket[]>(STORAGE_TICKETS)) ?? [];
    const queue = new Queue({
      // Ids must not repeat across a hibernation, or a second match would land
      // in the Durable Object of the first and be refused as already started.
      mintMatchId: (index) => `casual-${this.minted + index}-${crypto.randomUUID().slice(0, 8)}`,
    });
    for (const ticket of stored) {
      queue.add(ticket);
      this.clock.observe(ticket.enqueuedAtMs);
    }
    this.queue = queue;
    return queue;
  }

  private async persist(queue: Queue): Promise<void> {
    await this.ctx.storage.put(STORAGE_TICKETS, queue.all());
    await this.ctx.storage.put(STORAGE_MINTED, this.minted + queue.all().length);
  }

  private toTicket(ticketId: string, frame: LobbyServerEnvelope): void {
    for (const socket of this.ctx.getWebSockets(`ticket:${ticketId}`)) this.send(socket, frame);
  }

  private send(ws: WebSocket, frame: LobbyServerEnvelope): void {
    const text = JSON.stringify(frame);
    if (text.length > WIRE_LIMITS.maxFrameBytes) return;
    ws.send(text);
  }
}

/** FNV-1a over the decklist, for §9.2's `deckHash`. Identifies a deck; does not protect it. */
function hashDeck(deck: DeckList): string {
  const json = JSON.stringify([deck.leaderCardId, [...deck.cards].sort()]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
