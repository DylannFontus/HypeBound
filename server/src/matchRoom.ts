/**
 * The Durable Object wrapper around `Room`.
 *
 * Everything Cloudflare-specific lives here and nothing else does: sockets,
 * storage, alarms, and the envelope stamping that needs a clock. The rules, the
 * redaction, the sequence numbers and the timer arithmetic are all in
 * `room/room.ts`, which knows none of it and is tested without any of it.
 *
 * ## Why a Durable Object is exactly §14.2
 *
 * The design specifies "one match = one room": a single object graph owned by
 * one process, mutated only by `applyIntent`, addressed through a directory so
 * any gateway can route to it. A Durable Object is that, minus the directory —
 * Cloudflare routes by id, so `room:{id} → {workerId, endpoint}` and its 15
 * minute TTL and its heartbeat simply do not need to exist. The DO's storage
 * replaces the specced Redis journal in the same way.
 *
 * Two platform behaviours are load-bearing and worth naming, because the code
 * below looks unguarded without them:
 *
 * - **The input gate serializes handlers.** While a storage operation is in
 *   flight, no other event is delivered to the object. Combined with a
 *   synchronous `applyIntent`, that is §4.3's "intents for a room are strictly
 *   serialized" for free — and it is why the "reject a second in-flight intent"
 *   rule has no implementation here.
 * - **The output gate holds outbound messages until pending writes confirm.**
 *   That is §4.3's durability rule — "the intent is durably appended before any
 *   batch is broadcast" — provided by the platform. The code still writes before
 *   it sends, because relying on a subtlety without also expressing the
 *   intention is how the subtlety gets optimised away by a later edit.
 *
 * ## Hibernation
 *
 * Sockets outlive the object in memory: with `acceptWebSocket` the DO is evicted
 * while players think, and rebuilt on the next message. So the room is restored
 * from the journal on essentially every turn, not once per crash — see
 * `Room.restore`. Anything held only in a field would be silently lost, which is
 * why seat assignment rides on the socket itself via `serializeAttachment`
 * rather than in a `Map` here.
 */

import { DurableObject } from "cloudflare:workers";
import { getContent, contentHash, type ContentIndex, type MatchConfig, type Seat } from "./shared/engine";
import { PROTOCOL_VERSION, type ServerEnvelope } from "./shared/wire";
import { MonotonicClock } from "./room/clock";
import { Room, type RoomSave } from "./room/room";
import { RoomProtocol, type Outgoing } from "./room/roomProtocol";
import type { Env } from "./env";

/** What a socket remembers about itself across a hibernation cycle. */
interface SocketIdentity {
  readonly seat: Seat;
  readonly role: "player" | "spectator";
  readonly sessionId: string;
  readonly userId: string;
}

/** The body of the internal `init` call that creates a match (sent by the queue in phase 4). */
export interface InitBody {
  readonly matchId: string;
  readonly build: string;
  readonly config: MatchConfig;
  /** Supabase user ids, indexed by seat. A socket is admitted only if its token names one. */
  readonly players: [string, string];
}

const STORAGE_SAVE = "save";
const STORAGE_PLAYERS = "players";

/** How often the room wakes itself to check the turn clock. */
const ALARM_INTERVAL_MS = 1_000;

export class MatchRoom extends DurableObject<Env> {
  private content: ContentIndex | null = null;
  private protocol: RoomProtocol | null = null;
  private readonly clock = new MonotonicClock();

  // --- entry points -----------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/init")) {
      return this.handleInit(request);
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    return this.handleSocket(request, url);
  }

  /**
   * Create the match. Idempotent: the pairing service may retry, and a retry
   * must not deal a second, different game to two players already in the first.
   */
  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.ctx.storage.get<RoomSave>(STORAGE_SAVE);
    if (existing) {
      return Response.json({ ok: true, alreadyStarted: true, matchId: existing.options.matchId });
    }

    const body = (await request.json()) as InitBody;
    const content = this.getContentIndex();
    const now = this.clock.now();

    const room = new Room(content, {
      matchId: body.matchId,
      build: body.build,
      contentHash: contentHash(content),
      match: body.config,
    }, now);

    this.protocol = new RoomProtocol(room);
    await this.ctx.storage.put(STORAGE_SAVE, room.save());
    await this.ctx.storage.put(STORAGE_PLAYERS, body.players);
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    return Response.json({ ok: true, matchId: body.matchId, contentHash: room.contentHash });
  }

  private async handleSocket(request: Request, url: URL): Promise<Response> {
    const players = await this.ctx.storage.get<[string, string]>(STORAGE_PLAYERS);
    if (!players) return new Response("no such match", { status: 404 });

    /**
     * The gateway has already verified the token and put the caller's identity
     * on the request. It is re-derived from a header rather than re-verified
     * here because the DO is not reachable from the internet — only the Worker
     * can address it — so the Worker is the trust boundary and this is inside it.
     */
    const userId = request.headers.get("X-Hypebound-User");
    if (!userId) return new Response("unauthenticated", { status: 401 });

    const seatIndex = players.indexOf(userId);
    if (seatIndex < 0) return new Response("not a participant", { status: 403 });
    const seat = seatIndex as Seat;

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const identity: SocketIdentity = {
      seat,
      role: "player",
      sessionId: crypto.randomUUID(),
      userId,
    };
    // Rides on the socket, not in a field: the object is evicted between
    // messages and a field would not survive to the next one.
    server.serializeAttachment(identity);
    this.ctx.acceptWebSocket(server, [`seat:${seat}`]);

    const protocol = await this.load();
    const now = this.clock.now();
    this.send(server, protocol.welcome(seat, identity.sessionId, makeResumeToken(), now, identity.role));

    void url; // reserved for the spectator path (§13.3)
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- socket events ------------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) return ws.close(1011, "no identity on this socket");

    if (typeof message !== "string") {
      // Protocol v1 is JSON text. A binary frame is not a client that speaks a
      // dialect; it is a client that is not speaking this protocol.
      this.send(ws, {
        t: "fatal",
        v: PROTOCOL_VERSION,
        ts: this.clock.now(),
        code: "rateLimited",
        message: "binary frames are not part of protocol v1",
      });
      return ws.close(1008, "binary");
    }

    const protocol = await this.load();
    const now = this.clock.now();
    const { out, fatal } = protocol.handle(identity.seat, message, now);

    await this.commit(protocol.room, out, fatal);
    if (fatal) ws.close(1008, "protocol");
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) return;
    // §8.2's grace window is phase 4 work; until it exists, a dropped socket
    // must not silently forfeit a match, so nothing happens here beyond the
    // socket closing. The turn clock keeps running and will end the match on
    // its own through the AFK path, which is the honest behaviour.
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  override async alarm(): Promise<void> {
    const save = await this.ctx.storage.get<RoomSave>(STORAGE_SAVE);
    if (!save) return;

    const protocol = await this.load();
    const out = protocol.tick(this.clock.now());
    if (out.length > 0) await this.commit(protocol.room, out, false);

    if (protocol.room.winner === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  // --- plumbing -------------------------------------------------------------

  private getContentIndex(): ContentIndex {
    this.content ??= getContent();
    return this.content;
  }

  private async load(): Promise<RoomProtocol> {
    if (this.protocol) return this.protocol;
    const save = await this.ctx.storage.get<RoomSave>(STORAGE_SAVE);
    if (!save) throw new Error("room asked to act before it was initialized");
    this.clock.observe(save.turnStartedAtMs);
    this.protocol = new RoomProtocol(Room.restore(this.getContentIndex(), save));
    return this.protocol;
  }

  /**
   * Persist, then deliver. In that order, and with the write awaited.
   *
   * The output gate would enforce this anyway. It is written out because the
   * ordering is a rule from §4.3 — "a crash never loses a fact a client has
   * already seen" — and a rule that is only satisfied by an implicit platform
   * behaviour is one edit away from not being satisfied at all.
   *
   * A frame that is itself the report of a broken frame is not worth a storage
   * write, and the room did not change to produce it — hence `skipSave`.
   */
  private async commit(room: Room, out: Outgoing[], skipSave: boolean): Promise<void> {
    if (!skipSave) await this.ctx.storage.put(STORAGE_SAVE, room.save());
    for (const { seat, frame } of out) {
      for (const socket of this.ctx.getWebSockets(`seat:${seat}`)) {
        this.send(socket, frame);
      }
    }
  }

  private send(ws: WebSocket, frame: ServerEnvelope): void {
    ws.send(JSON.stringify(frame));
  }
}

/** 32 bytes base64url — 43 characters, which is what §7.5 and the schema expect. */
function makeResumeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
