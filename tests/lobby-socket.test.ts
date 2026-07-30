/**
 * The client's end of the queue.
 *
 * Unlike `ws-transport.test.ts`, the other end here is written by the test —
 * the queue's Durable Object is thin glue over `Queue`, which
 * `tests/queue.test.ts` covers on its own, and standing up workerd to test
 * fifteen lines of socket plumbing would be a poor trade.
 *
 * The fake still goes through the **real schemas** in both directions:
 * `parseLobbyFrame` on what the client sends, `zLobbyServerEnvelope` on what it
 * is sent. So a frame either side gets wrong is caught here even though the
 * server object is not the real one, which is where most of the risk in a
 * hand-written double actually lives.
 */

import { describe, expect, it } from "vitest";
import {
  LobbySocket,
  type LobbyHandlers,
  type MatchFound,
  type QueueRejection,
  type QueueStatus,
} from "../src/net/lobbySocket";
import {
  PROTOCOL_VERSION,
  parseLobbyFrame,
  zLobbyServerEnvelope,
  type LobbyClientEnvelope,
  type LobbyServerEnvelope,
} from "../src/net/protocol";
import type { SocketFactory } from "../src/net/wsTransport";
import type { DeckList } from "../src/engine/types";

const DECK: DeckList = { name: "Test", leaderCardId: "goth-leader-morvina-vane", cards: ["goth-mourning-glory"] };
const NOW = 1_700_000_000_000;

interface Fake {
  factory: SocketFactory;
  /** Frames the client sent, already validated against the real client schema. */
  inbox: LobbyClientEnvelope[];
  /** Frames the client could not parse, so a schema slip is visible. */
  rejected: string[];
  send: (frame: LobbyServerEnvelope) => void;
  drop: (code?: number, reason?: string) => void;
  opened: () => boolean;
}

function fakeQueueServer(): Fake {
  const inbox: LobbyClientEnvelope[] = [];
  const rejected: string[] = [];
  let handlers: Parameters<SocketFactory>[1] | null = null;
  let open = false;

  const factory: SocketFactory = (_url, h) => {
    handlers = h;
    open = true;
    h.onOpen();
    return {
      send: (text) => {
        const parsed = parseLobbyFrame(text);
        if (parsed.ok) inbox.push(parsed.frame);
        else rejected.push(`${parsed.code}: ${parsed.detail}`);
      },
      close: () => {
        open = false;
      },
    };
  };

  return {
    factory,
    inbox,
    rejected,
    send: (frame) => {
      // Validated before it goes out: a test double that sends a frame the real
      // server could not is a test that passes for the wrong reason.
      const check = zLobbyServerEnvelope.safeParse(frame);
      if (!check.success) throw new Error(`the fake server built an invalid frame: ${check.error.issues[0]?.message}`);
      handlers?.onMessage(JSON.stringify(frame));
    },
    drop: (code = 1006, reason = "connection lost") => {
      open = false;
      handlers?.onClose(code, reason);
    },
    opened: () => open,
  };
}

const envelope = { v: PROTOCOL_VERSION as 1, ts: NOW };

function makeSocket(fake: Fake, handlers: LobbyHandlers = {}): LobbySocket {
  return new LobbySocket({
    url: "wss://example.invalid/queue/casual/socket?access_token=t",
    connect: fake.factory,
    build: "build-1",
    contentHash: "hash-1",
    now: () => NOW,
    handlers,
  });
}

describe("joining", () => {
  it("sends a valid enqueue carrying the deck and the build", () => {
    const fake = fakeQueueServer();
    makeSocket(fake).enqueue(DECK);

    expect(fake.rejected, "the client sent a frame the server schema refuses").toEqual([]);
    expect(fake.inbox).toHaveLength(1);
    const frame = fake.inbox[0]!;
    expect(frame.t).toBe("enqueue");
    if (frame.t !== "enqueue") return;
    // §9.2: the deck is validated at ticket creation, so it has to be here.
    expect(frame.deck.leaderCardId).toBe(DECK.leaderCardId);
    // §14.5: refused rather than widened, so it is checked before a ticket exists.
    expect(frame.build).toBe("build-1");
    expect(frame.contentHash).toBe("hash-1");
  });

  it("reports being queued, with the true number of people waiting", () => {
    const fake = fakeQueueServer();
    let queued: { ticketId: string; waiting: number } | null = null;
    const lobby = makeSocket(fake, { onQueued: (ticketId, waiting) => void (queued = { ticketId, waiting }) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "tkt-1", waiting: 1 });

    expect(queued).toEqual({ ticketId: "tkt-1", waiting: 1 });
    expect(lobby.status).toBe("queued");
    expect(lobby.ticket).toBe("tkt-1");
  });

  it("does not enqueue twice", () => {
    const fake = fakeQueueServer();
    const lobby = makeSocket(fake);
    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "tkt-1", waiting: 1 });
    lobby.enqueue(DECK);
    expect(fake.inbox.filter((f) => f.t === "enqueue")).toHaveLength(1);
  });
});

describe("waiting", () => {
  it("passes on the honest queue statistics", () => {
    /**
     * `waiting: 0` is the normal answer for this game today, and it must reach
     * the UI. A spinner that cannot distinguish "searching" from "there is
     * nobody here" is how a quiet game gets mistaken for a broken one.
     */
    const fake = fakeQueueServer();
    const seen: QueueStatus[] = [];
    const lobby = makeSocket(fake, { onSearching: (status) => void seen.push(status) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "tkt-1", waiting: 1 });
    fake.send({ ...envelope, t: "searching", waitedMs: 3_000, band: 150, waiting: 0 });
    fake.send({ ...envelope, t: "searching", waitedMs: 60_000, band: 325, waiting: 0 });

    expect(seen).toEqual([
      { waitedMs: 3_000, band: 150, waiting: 0 },
      { waitedMs: 60_000, band: 325, waiting: 0 },
    ]);
  });

  it("surfaces the AI offer without leaving the queue", () => {
    // §9.3: "offer *Play the AI instead* (never a fake human)". An offer, not a
    // surrender — a player who ignores it must still be paired if someone shows
    // up, so the state stays `queued`.
    const fake = fakeQueueServer();
    let offered: number | null = null;
    const lobby = makeSocket(fake, { onAiOffer: (waitedMs) => void (offered = waitedMs) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "tkt-1", waiting: 1 });
    fake.send({ ...envelope, t: "aiOffer", waitedMs: 240_000 });

    expect(offered).toBe(240_000);
    expect(lobby.status).toBe("queued");
    expect(fake.opened()).toBe(true);
  });
});

describe("being paired", () => {
  it("reports the match and closes the socket", () => {
    const fake = fakeQueueServer();
    let found: MatchFound | null = null;
    const lobby = makeSocket(fake, { onMatchFound: (m) => void (found = m) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "tkt-1", waiting: 2 });
    fake.send({
      ...envelope,
      t: "matchFound",
      matchId: "casual-0-abcd1234",
      seat: 1,
      opponentLeaderCardId: "after-leader-dj-last-call",
    });

    expect(found).toEqual({ matchId: "casual-0-abcd1234", seat: 1, opponentLeaderCardId: "after-leader-dj-last-call" });
    expect(lobby.status).toBe("matched");
    // Holding the lobby socket through a match is a connection nobody reads and
    // a ticket the server keeps deciding not to pair.
    expect(fake.opened()).toBe(false);
  });

  it("does not report a failure when the socket closes because a match started", () => {
    /**
     * The order is: `matchFound`, then the close. Without the guard the player
     * gets an error toast over the loading screen of the game they are about to
     * play.
     */
    const fake = fakeQueueServer();
    const closes: string[] = [];
    const lobby = makeSocket(fake, { onClosed: (reason) => void closes.push(reason) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "t", waiting: 2 });
    fake.send({ ...envelope, t: "matchFound", matchId: "m", seat: 0, opponentLeaderCardId: "x" });
    fake.drop(1000, "matched");

    expect(closes).toEqual([]);
    expect(lobby.status).toBe("matched");
  });
});

describe("refusals and failures", () => {
  it("passes a rejection through with its code, and stops", () => {
    const fake = fakeQueueServer();
    let rejection: QueueRejection | null = null;
    const lobby = makeSocket(fake, { onRejected: (r) => void (rejection = r) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queueRejected", code: "invalidDeck", message: "deck must contain 30 cards" });

    expect(rejection).toEqual({ code: "invalidDeck", message: "deck must contain 30 cards" });
    expect(lobby.status).toBe("closed");
  });

  it("reports a build mismatch as itself, not as a deck problem", () => {
    // The player's deck is fine; their tab is old. Told apart because the fix is
    // completely different — reload, versus edit the deck.
    const fake = fakeQueueServer();
    const rejections: QueueRejection[] = [];
    makeSocket(fake, { onRejected: (r) => void rejections.push(r) }).enqueue(DECK);
    fake.send({ ...envelope, t: "queueRejected", code: "buildMismatch", message: "reload to get the current build" });
    expect(rejections.map((r) => r.code)).toEqual(["buildMismatch"]);
  });

  it("closes on a server frame that fails validation", () => {
    const fake = fakeQueueServer();
    const closes: string[] = [];
    const lobby = makeSocket(fake, { onClosed: (reason) => void closes.push(reason) });
    lobby.enqueue(DECK);

    // Delivered straight into `receive`, bypassing the fake's own outgoing
    // validation on purpose: the fake refuses to build an invalid frame, and
    // this is a test about what happens when a real server sends one anyway.
    const raw = JSON.stringify({ v: 1, t: "queued", ts: NOW, ticketId: "", waiting: -3 });
    (lobby as unknown as { receive: (t: string) => void }).receive(raw);

    expect(closes[0]).toContain("failed validation");
    expect(lobby.status).toBe("closed");
  });

  it("reports a dropped connection once", () => {
    const fake = fakeQueueServer();
    const closes: string[] = [];
    const lobby = makeSocket(fake, { onClosed: (reason) => void closes.push(reason) });

    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "t", waiting: 1 });
    fake.drop();
    fake.drop();

    expect(closes).toHaveLength(1);
    expect(closes[0]).toContain("1006");
    expect(lobby.status).toBe("closed");
  });

  it("tells the server before leaving, so the ticket goes now rather than later", () => {
    const fake = fakeQueueServer();
    const lobby = makeSocket(fake);
    lobby.enqueue(DECK);
    fake.send({ ...envelope, t: "queued", ticketId: "t", waiting: 1 });
    lobby.dequeue();

    expect(fake.inbox.map((f) => f.t)).toEqual(["enqueue", "dequeue"]);
    expect(fake.opened()).toBe(false);
    expect(lobby.status).toBe("closed");
  });
});
