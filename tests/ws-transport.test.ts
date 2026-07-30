/**
 * `WsTransport` against the real server, through a fake socket.
 *
 * The other end of every socket here is `RoomProtocol` wrapping a real `Room` —
 * the same class the Durable Object calls — so these are not tests of a mock.
 * What is faked is the wire, which is the one part that genuinely cannot be
 * exercised offline.
 *
 * Resume is the reason this file exists. Nothing in the offline build has a
 * connection to lose, so §8's entire reconnection path had no test that could
 * exist before now, and §15's rule 4 asks for exactly this: "drop at every
 * `seq`, resume, assert identical final view".
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { enumerateLegalIntents } from "../src/engine/intents";
import { viewHash } from "../src/net/view";
import { WsTransport } from "../src/net/wsTransport";
import { Loopback, settle } from "./helpers/loopback";
import type { EventBatch, TransportStatus } from "../src/net/transport";
import type { MatchConfig, PlayerIntent, Seat } from "../src/engine/types";

const content = getContent();

function roomOptions(seed = 21): { matchId: string; build: string; contentHash: string; match: MatchConfig } {
  return {
    matchId: "loop-1",
    build: "test",
    contentHash: "abcdef01",
    match: {
      seed,
      decks: [
        autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
        autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
      ],
      firstSeat: 0,
    },
  };
}

interface Harness {
  loop: Loopback;
  transports: [WsTransport, WsTransport];
  batches: [EventBatch[], EventBatch[]];
  statuses: [TransportStatus[], TransportStatus[]];
}

/**
 * Two connected clients on one room.
 *
 * `heartbeatMs: 0` because a heartbeat on an injected clock that never advances
 * would spin for ever; the ping/pong path is tested on its own below.
 */
async function connectBoth(seed = 21, extra: Partial<ConstructorParameters<typeof WsTransport>[0]> = {}): Promise<Harness> {
  const loop = new Loopback({ content, room: roomOptions(seed) });
  const batches: [EventBatch[], EventBatch[]] = [[], []];
  const statuses: [TransportStatus[], TransportStatus[]] = [[], []];

  const make = (seat: Seat): WsTransport => {
    const transport = new WsTransport({
      url: `wss://example.invalid/match/loop-1/socket?access_token=t${seat}`,
      content,
      connect: loop.socketFor(seat),
      now: () => loop.now(),
      heartbeatMs: 0,
      ...extra,
    });
    transport.onBatch((batch) => void batches[seat].push(batch));
    transport.onStatus((status) => void statuses[seat].push(status));
    return transport;
  };

  const zero = make(0);
  const one = make(1);
  await Promise.all([zero.connect(), one.connect()]);
  return { loop, transports: [zero, one], batches, statuses };
}

/** Submit for whichever seat is to move, and let the frames land. */
async function play(h: Harness, intent?: PlayerIntent): Promise<void> {
  const state = h.loop.room.authoritativeState();
  const seat = state.activeSeat;
  const chosen = intent ?? enumerateLegalIntents(state, content, seat).find((i) => i.type !== "concede");
  if (!chosen) throw new Error("no legal intent");
  const result = await h.transports[seat].submit(chosen);
  // Asserted, not assumed. A disconnected transport answers every submit with a
  // refusal, so without this a harness bug reads as a match that simply played
  // out differently.
  if (!result.ok) throw new Error(`seat ${seat} could not play ${chosen.type}: ${result.error.code} ${result.error.message}`);
  await settle();
}

const mulligan = (seat: Seat): PlayerIntent => ({ type: "mulligan", seat, replaceInstanceIds: [] });

async function openingMulligans(h: Harness): Promise<void> {
  await h.transports[0].submit(mulligan(0));
  await settle();
  await h.transports[1].submit(mulligan(1));
  await settle();
}

describe("connecting", () => {
  it("hands each seat its own snapshot, and only its own", async () => {
    const h = await connectBoth();

    expect(h.transports[0].seat).toBe(0);
    expect(h.transports[1].seat).toBe(1);
    expect(h.transports[0].view().seat).toBe(0);
    expect(h.transports[1].view().seat).toBe(1);

    // The opponent's hand is a count on both sides, and neither can see a deck.
    for (const seat of [0, 1] as Seat[]) {
      const view = h.transports[seat].view();
      expect(view.opponent.handCount).toBeGreaterThan(0);
      expect(view.you.deck.every((c) => c.cardId === "hidden")).toBe(true);
      expect(view.you.hand.every((c) => c.cardId !== "hidden")).toBe(true);
    }
  });

  it("sends hello before it is welcomed, not in reply to it", async () => {
    // The real server sends `welcome` on the upgrade. A client that waited for a
    // reply to `hello` would hang, and the harness reproduces that ordering.
    const h = await connectBoth();
    expect(h.loop.received.filter((r) => r.frame.t === "hello")).toHaveLength(2);
  });

  it("reports live, and reports closing", async () => {
    const h = await connectBoth();
    expect(h.statuses[0].map((s) => s.kind)).toEqual(["connecting", "live"]);

    h.transports[0].close("done");
    expect(h.statuses[0].at(-1)).toEqual({ kind: "closed", reason: "done" });
  });

  it("has no replay record to give, and says so rather than inventing one", async () => {
    const h = await connectBoth();
    expect(h.transports[0].finishRecord()).toBeNull();
    expect(h.transports[0].hotseat).toBeUndefined();
  });
});

describe("intents", () => {
  it("resolves submit with the server's sequence number", async () => {
    const h = await connectBoth();
    const result = await h.transports[0].submit(mulligan(0));
    expect(result).toEqual({ ok: true, seq: 1 });
    await settle();
  });

  it("resolves with the canonical refusal when the room says no", async () => {
    const h = await connectBoth();
    // `wrongPhase`, not `notYourTurn`: the mulligan is still open, and the
    // engine's own code is the one that reaches the client — the room never
    // authors a refusal of its own.
    const result = await h.transports[1].submit({ type: "endTurn", seat: 1 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("wrongPhase");
  });

  it("refuses a second intent while one is in flight (§4.3)", async () => {
    const h = await connectBoth();
    const first = h.transports[0].submit(mulligan(0));
    expect(h.transports[0].isBusy()).toBe(true);

    const second = await h.transports[0].submit(mulligan(0));
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error.message).toContain("already in flight");

    await first;
    await settle();
    expect(h.transports[0].isBusy()).toBe(false);
  });

  it("delivers a batch to both seats with the hash each of them should compute", async () => {
    const h = await connectBoth();
    await openingMulligans(h);

    for (const seat of [0, 1] as Seat[]) {
      expect(h.batches[seat].length, `seat ${seat} received no batches`).toBeGreaterThan(0);
      const last = h.batches[seat].at(-1)!;
      expect(last.viewHash).toBe(viewHash(h.transports[seat].view()));
    }
    // and the two seats genuinely received different bytes
    expect(h.batches[0].at(-1)!.viewHash).not.toBe(h.batches[1].at(-1)!.viewHash);
  });
});

describe("the view tracks the room", () => {
  it("stays hash-identical to the server across a whole opening", async () => {
    const h = await connectBoth(404);
    await openingMulligans(h);

    let moves = 0;
    for (let i = 0; i < 24 && h.loop.room.winner === null; i++) {
      await play(h);
      moves += 1;
      for (const seat of [0, 1] as Seat[]) {
        expect(viewHash(h.transports[seat].view()), `seat ${seat} drifted after move ${moves}`).toBe(
          h.loop.room.viewHashFor(seat)
        );
      }
    }
    expect(moves, "no moves were played, so nothing was compared").toBeGreaterThan(15);
  });

  it("asks for a snapshot when the reducer and the room disagree", async () => {
    /**
     * The self-healing path, forced by corrupting the client's view behind its
     * back. The client does not try to work out which side is wrong — it cannot
     * be the room — so it sends `resync` and adopts what comes back.
     */
    const h = await connectBoth();
    await openingMulligans(h);

    const damaged = h.transports[0].view();
    damaged.you.leaderHealth -= 5;
    (h.transports[0] as unknown as { currentView: unknown }).currentView = damaged;
    expect(viewHash(h.transports[0].view())).not.toBe(h.loop.room.viewHashFor(0));

    await play(h);
    await settle();

    expect(h.loop.received.some((r) => r.seat === 0 && r.frame.t === "resync")).toBe(true);
    expect(viewHash(h.transports[0].view())).toBe(h.loop.room.viewHashFor(0));
  });

  it("acknowledges every batch it applies", async () => {
    const h = await connectBoth();
    await openingMulligans(h);

    const acks = h.loop.received.filter((r) => r.seat === 0 && r.frame.t === "ack");
    expect(acks.length).toBe(h.batches[0].length);
    expect(acks.at(-1)!.frame.seq).toBe(h.batches[0].at(-1)!.seq);
  });

  it("ignores a batch it has already applied", async () => {
    const h = await connectBoth();
    await openingMulligans(h);

    const before = h.batches[0].length;
    const replayed = h.loop.sent.find((s) => s.seat === 0 && s.frame.t === "batch")!;
    const client = h.transports[0] as unknown as { enqueue: (fn: () => Promise<void>) => void; receive: (t: string) => Promise<void> };
    client.enqueue(() => client.receive(JSON.stringify(replayed.frame)));
    await settle();

    expect(h.batches[0].length, "a duplicate batch was applied twice").toBe(before);
  });
});

describe("resume (§8, and the only path with no offline analogue)", () => {
  it("reconnects after the socket dies and comes back to the same view", async () => {
    const h = await connectBoth(77, { reconnect: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 } });
    await openingMulligans(h);
    await play(h);

    const before = viewHash(h.transports[0].view());
    h.loop.drop(0);
    await settle(8);
    // `disconnected` is asserted as something that *happened*, not as the
    // current state: with a zero backoff the reconnect lands inside the same
    // settle, and checking `.at(-1)` would be asserting that recovery is slow.
    expect(h.statuses[0].map((s) => s.kind)).toContain("disconnected");

    await settle(8);
    expect(h.loop.connected(0), "the client never reconnected").toBe(true);
    expect(h.statuses[0].at(-1)?.kind).toBe("live");
    expect(viewHash(h.transports[0].view())).toBe(before);
    expect(viewHash(h.transports[0].view())).toBe(h.loop.room.viewHashFor(0));
  });

  it("keeps playing after a resume, and the opponent never noticed", async () => {
    const h = await connectBoth(88, { reconnect: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 } });
    await openingMulligans(h);

    h.loop.drop(0);
    await settle(8);
    await play(h);
    await play(h);

    for (const seat of [0, 1] as Seat[]) {
      expect(viewHash(h.transports[seat].view())).toBe(h.loop.room.viewHashFor(seat));
    }
  });

  it("comes back to an identical view whichever seq it was dropped at", async () => {
    /**
     * §15 rule 4, literally: drop at every `seq`, resume, assert an identical
     * final view. Each run plays the same scripted opening, drops seat 0 after a
     * different number of moves, and must finish indistinguishable from the run
     * that was never interrupted.
     */
    const script = async (dropAfter: number | null): Promise<string> => {
      const h = await connectBoth(303, { reconnect: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 } });
      await openingMulligans(h);
      for (let move = 0; move < 6 && h.loop.room.winner === null; move++) {
        if (move === dropAfter) {
          h.loop.drop(0);
          await settle(8);
        }
        await play(h);
      }
      await settle();
      expect(viewHash(h.transports[0].view())).toBe(h.loop.room.viewHashFor(0));
      return viewHash(h.transports[0].view());
    };

    const uninterrupted = await script(null);
    for (let dropAfter = 0; dropAfter < 6; dropAfter++) {
      expect(await script(dropAfter), `dropping after move ${dropAfter} changed the outcome`).toBe(uninterrupted);
    }
    // Seven full matches, each draining real timers between every frame. Given a
    // real budget rather than thinned out: the whole point is *every* seq.
  }, 30_000);

  it("replays what was missed, without playing it twice (§8.3)", async () => {
    /**
     * The reconnect is held rather than instant, and that is the whole setup.
     *
     * With a zero backoff the client is back before the test can make anything
     * happen, so the first version of this asserted a replay of nothing and
     * reported the feature broken. Capturing the scheduled reconnect and firing
     * it by hand is what makes "while they were away" a real interval.
     */
    const timers: (() => void)[] = [];
    const h = await connectBoth(606, {
      reconnect: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1 },
      schedule: (fn) => {
        timers.push(fn);
        return () => {
          const at = timers.indexOf(fn);
          if (at >= 0) timers.splice(at, 1);
        };
      },
    });
    await openingMulligans(h);

    // The seat that leaves must be the one NOT on the clock, or there is nobody
    // able to make the moves it is supposed to miss.
    const away = (h.loop.room.activeSeat === 0 ? 1 : 0) as Seat;
    h.loop.drop(away);
    await settle(4);
    expect(h.loop.connected(away), "the reconnect was not held").toBe(false);

    const before = h.batches[away].length;
    await play(h);
    await play(h);
    expect(h.batches[away].length, "a disconnected client received a live batch").toBe(before);

    // Now let it back in.
    timers.shift()?.();
    await settle(16);
    expect(h.loop.connected(away), "never reconnected").toBe(true);

    const arrived = h.batches[away].slice(before);
    const replayed = arrived.filter((b) => b.catchUp === true);
    expect(replayed.length, "nothing was replayed, so the absence is invisible").toBeGreaterThan(0);
    // and the view is the room's, not the room's applied twice
    expect(viewHash(h.transports[away].view())).toBe(h.loop.room.viewHashFor(away));
  });

  it("does not resync on the hash of a moment that has passed", async () => {
    // A catch-up batch carries the viewHash of when it happened. Comparing that
    // to the present view reports drift that is not drift.
    const timers: (() => void)[] = [];
    const h = await connectBoth(707, {
      reconnect: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1 },
      schedule: (fn) => {
        timers.push(fn);
        return () => {};
      },
    });
    await openingMulligans(h);
    const away = (h.loop.room.activeSeat === 0 ? 1 : 0) as Seat;
    h.loop.drop(away);
    await settle(4);
    await play(h);
    timers.shift()?.();
    await settle(16);

    const resyncs = h.loop.received.filter((r) => r.seat === away && r.frame.t === "resync");
    expect(resyncs, "a reconnect asked for a resync it did not need").toEqual([]);
  });

  it("fails the in-flight intent rather than leaving the caller waiting", async () => {
    // The answer to that intent was on a socket that no longer exists. §4.3's
    // idempotency is what makes re-sending it after the resume safe.
    const h = await connectBoth(99, { reconnect: { maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 } });
    const inFlight = h.transports[0].submit(mulligan(0));
    h.loop.drop(0);

    const result = await inFlight;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.message).toContain("connection lost");
  });

  it("gives up honestly instead of reconnecting for ever", async () => {
    const h = await connectBoth(11, { reconnect: { maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 } });
    h.loop.drop(0);
    await settle(8);
    expect(h.statuses[0].at(-1)).toEqual({ kind: "closed", reason: "gave up reconnecting after 0 attempts" });
  });
});

describe("the client does not trust the server either (§7)", () => {
  it("closes on a frame that fails validation, naming the field", async () => {
    const h = await connectBoth();
    const client = h.transports[0] as unknown as { enqueue: (fn: () => Promise<void>) => void; receive: (t: string) => Promise<void> };

    client.enqueue(() => client.receive(JSON.stringify({ v: 1, t: "batch", ts: 1, seq: "not-a-number", events: [] })));
    await settle();

    const status = h.statuses[0].at(-1)!;
    expect(status.kind).toBe("closed");
    expect(status.kind === "closed" && status.reason).toContain("failed validation");
  });

  it("closes on an oversized frame before parsing it", async () => {
    const h = await connectBoth();
    const client = h.transports[0] as unknown as { enqueue: (fn: () => Promise<void>) => void; receive: (t: string) => Promise<void> };

    client.enqueue(() => client.receive("x".repeat(70_000)));
    await settle();

    const status = h.statuses[0].at(-1)!;
    expect(status.kind === "closed" && status.reason).toContain("exceeds the 65536 cap");
  });

  it("stops reconnecting once the match is over", async () => {
    const h = await connectBoth(5, { reconnect: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 } });
    await openingMulligans(h);
    await h.transports[1].submit({ type: "concede", seat: 1 });
    await settle();

    h.loop.drop(0);
    await settle(8);
    expect(h.statuses[0].at(-1)).toEqual({ kind: "closed", reason: "match ended" });
  });
});

describe("the heartbeat", () => {
  it("pings, and reports the round trip", async () => {
    /**
     * The client's clock is its own here, and moves *between* the ping and the
     * pong — which is what a round trip is. Driving both ends off the harness
     * clock measures zero every time, because nothing advances it while the
     * frames are in the air, and the test would pass for the wrong reason if it
     * asserted `rttMs >= 0`.
     */
    const timers: (() => void)[] = [];
    let clientNow = 5_000_000;
    const h = await connectBoth(31, {
      heartbeatMs: 5_000,
      now: () => clientNow,
      schedule: (fn) => {
        timers.push(fn);
        return () => {
          const index = timers.indexOf(fn);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    });

    expect(timers.length, "no heartbeat was scheduled").toBeGreaterThan(0);
    timers.shift()!(); // sends the ping, stamped with the clock as it is now
    clientNow += 120; // the flight
    await settle();

    expect(h.loop.received.some((r) => r.frame.t === "ping")).toBe(true);
    const status = h.statuses[0].at(-1)!;
    expect(status.kind).toBe("live");
    expect(status.kind === "live" && status.rttMs).toBe(120);
  });
});
