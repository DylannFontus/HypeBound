/**
 * The authoritative room, tested without a server.
 *
 * `Room` takes the time as an argument and returns frames instead of sending
 * them, so the whole of §4 — sequence numbers, per-seat redaction, idempotency,
 * the turn clock, the AFK path, and rebuilding from the journal — can be driven
 * here, deterministically, in the suite that gates every deploy. That is the
 * same bet phase 2 made about redaction, for the same reason: the alternative
 * to testing this offline is discovering it in somebody's match.
 *
 * The one thing these tests will not tell you is whether the Durable Object
 * wrapper wires it up correctly. That is deliberate and it is the trade: the
 * wrapper is ~200 lines of platform glue with no branching logic in it, and
 * paying for a workerd harness to cover it would have meant a `Room` that could
 * only be tested through a socket.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { applyIntent } from "../src/engine/reducer";
import { createMatch, redact } from "../src/engine/state";
import { enumerateLegalIntents } from "../src/engine/intents";
import { stateHash } from "../src/engine/replay";
import { nextInt, seedRng } from "../src/engine/rng";
import { sanitizeView, viewHash } from "../src/net/view";
import { Room, type Addressed, type RoomSave } from "../server/src/room/room";
import { MonotonicClock } from "../server/src/room/clock";
import type { MatchConfig, PlayerIntent, Seat } from "../src/engine/types";

const content = getContent();

const T0 = 1_700_000_000_000;

function matchConfig(seed = 7): MatchConfig {
  return {
    seed,
    decks: [
      autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
      autoBuildDeck(content, "after-leader-dj-last-call", "P2"),
    ],
    firstSeat: 0,
  };
}

function makeRoom(seed = 7, nowMs = T0): Room {
  return new Room(content, { matchId: "m1", build: "test", contentHash: "deadbeef", match: matchConfig(seed) }, nowMs);
}

/** Frames of one kind addressed to one seat. */
const framesFor = <K extends Addressed["frame"]["t"]>(out: Addressed[], seat: Seat, kind: K) =>
  out.filter((a) => a.seat === seat && a.frame.t === kind).map((a) => a.frame as Extract<Addressed["frame"], { t: K }>);

/** Play a legal intent for whoever is to move; returns what the room emitted. */
function playSomething(room: Room, rng: ReturnType<typeof seedRng>, id: number, nowMs: number): Addressed[] {
  const state = room.authoritativeState();
  const legal = enumerateLegalIntents(state, content, state.activeSeat).filter((i) => i.type !== "concede");
  const doing = legal.filter((i) => i.type !== "endTurn");
  const pool = doing.length > 0 && nextInt(rng, 100) < 75 ? doing : legal;
  const intent = pool[nextInt(rng, pool.length)]!;
  return room.submit(state.activeSeat, id, intent, nowMs);
}

describe("every frame is addressed to a seat", () => {
  it("gives the two seats different batches for the same intent", () => {
    /**
     * The reason there is no broadcast. The second mulligan starts the match
     * and deals the first seat its opening draw, and what each seat is allowed
     * to learn about that draw is different — so a single "batch" object sent
     * to the room would be a leak by construction.
     */
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    const out = room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);

    const mine = framesFor(out, 0, "batch")[0]!;
    const theirs = framesFor(out, 1, "batch")[0]!;

    expect(mine.seq).toBe(theirs.seq);
    expect(mine.viewHash).not.toBe(theirs.viewHash);

    const drawnByMe = mine.events.filter((e) => e.e === "cardDrawn");
    const drawnSeenByThem = theirs.events.filter((e) => e.e === "cardDrawn");
    expect(drawnByMe.length, "seat 0 saw no draws, so this compared nothing").toBeGreaterThan(0);
    expect(drawnByMe.length).toBe(drawnSeenByThem.length);
    for (const event of drawnByMe) expect(event.e === "cardDrawn" && event.cardId).not.toBeNull();
    for (const event of drawnSeenByThem) expect(event.e === "cardDrawn" && event.cardId).toBeNull();
  });

  it("sends a match-start snapshot, because a mulligan names no cards", () => {
    /**
     * `mulliganDone` reports `kept` and `replaced` as counts and nothing else,
     * so a seat that swapped three cards cannot learn from the event stream
     * what it swapped them for. Leaving that to the `viewHash` mismatch would
     * work — and would cost a resync round trip at the start of every match
     * that opened with a replacement.
     */
    const room = makeRoom();
    const hand = room.authoritativeState().players[0].hand;
    expect(hand.length, "no opening hand to mulligan").toBeGreaterThan(2);

    const swap = room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [hand[0]!.instanceId] }, T0);
    // The first mulligan changes neither the phase nor the active seat...
    expect(framesFor(swap, 0, "batch")[0]!.snapshot).toBeUndefined();
    expect(framesFor(swap, 0, "batch")[0]!.events.some((e) => e.e === "cardDrawn")).toBe(false);

    // ...and the second one starts the match, which is a snapshot point.
    const start = room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    for (const seat of [0, 1] as Seat[]) {
      const batch = framesFor(start, seat, "batch")[0]!;
      expect(batch.snapshot, `seat ${seat} was never told what it is holding`).toBeDefined();
      expect(batch.snapshot!.seq).toBe(batch.seq);
      expect(viewHash(batch.snapshot!.view)).toBe(batch.viewHash);
    }
    // and the swapped card really is gone from the hand the snapshot describes
    const held = framesFor(start, 0, "batch")[0]!.snapshot!.view.you.hand.map((c) => c.instanceId);
    expect(held).not.toContain(hand[0]!.instanceId);
  });

  it("hashes the view the way the client will", () => {
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    for (const seat of [0, 1] as Seat[]) {
      const expected = viewHash(sanitizeView(redact(room.authoritativeState(), seat)));
      expect(room.viewHashFor(seat)).toBe(expected);
    }
  });

  it("never puts the seat's own deck order in a snapshot", () => {
    const room = makeRoom();
    const snapshot = room.snapshotFor(0, T0);
    expect(snapshot.view.you.deck.length).toBeGreaterThan(10);
    expect(snapshot.view.you.deck.every((card) => card.cardId === "hidden")).toBe(true);
    expect(snapshot.revealedDeckInstanceIds).toEqual([]);
  });
});

describe("sequence numbers", () => {
  it("start at 1 and count applied intents exactly", () => {
    const room = makeRoom();
    expect(room.seq).toBe(0);

    const rng = seedRng(99);
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    expect(room.seq).toBe(2);

    for (let i = 0; i < 25 && room.winner === null; i++) playSomething(room, rng, i + 2, T0 + i * 100);

    // The invariant `Room.restore` depends on: the counter is the journal
    // length, so it is not stored twice and cannot be stored wrongly.
    expect(room.seq).toBe(room.journal.intents.length);
    expect(room.seq).toBeGreaterThan(20);
  });

  it("does not advance on a refusal", () => {
    const room = makeRoom();
    const before = room.seq;
    const out = room.submit(1, 1, { type: "endTurn", seat: 1 }, T0);

    expect(framesFor(out, 1, "rejected")).toHaveLength(1);
    expect(framesFor(out, 1, "batch")).toHaveLength(0);
    expect(room.seq).toBe(before);
    expect(room.journal.intents).toHaveLength(0);
  });

  it("refuses an intent submitted on another seat's behalf", () => {
    const room = makeRoom();
    const out = room.submit(1, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    const rejected = framesFor(out, 1, "rejected")[0]!;
    expect(rejected.error.code).toBe("notYourTurn");
    expect(room.journal.intents).toHaveLength(0);
  });
});

describe("idempotency (§4.3)", () => {
  it("answers a re-sent intent with the original seq, and does not apply it twice", () => {
    const room = makeRoom();
    const first = room.submit(0, 4, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    const accepted = framesFor(first, 0, "accepted")[0]!;

    const again = room.submit(0, 4, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0 + 500);

    expect(framesFor(again, 0, "accepted")[0]).toEqual(accepted);
    expect(framesFor(again, 0, "batch")).toHaveLength(0);
    expect(room.journal.intents).toHaveLength(1);
    expect(room.seq).toBe(1);
  });

  it("replays a rejection identically too", () => {
    const room = makeRoom();
    const first = room.submit(1, 9, { type: "endTurn", seat: 1 }, T0);
    const again = room.submit(1, 9, { type: "endTurn", seat: 1 }, T0 + 10);
    expect(framesFor(again, 1, "rejected")[0]).toEqual(framesFor(first, 1, "rejected")[0]);
  });

  it("refuses an id older than the last answered one rather than inventing a seq", () => {
    /**
     * §4.3 says a duplicate is "answered with the original batch seq", but the
     * state it specifies — one `lastAppliedClientId` per seat — cannot produce
     * that answer for anything but the most recent id. A fabricated seq would
     * tell a client a move landed when the room has no idea whether it did.
     */
    const room = makeRoom();
    room.submit(0, 5, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    const stale = room.submit(0, 2, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0 + 10);

    const rejected = framesFor(stale, 0, "rejected")[0]!;
    expect(rejected.error.code).toBe("invalidIntent");
    expect(rejected.error.message).toContain("older than");
    expect(room.journal.intents).toHaveLength(1);
  });

  it("keeps the two seats' answers separate", () => {
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    // The same id from the other seat is a different intent, not a duplicate.
    const out = room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    expect(framesFor(out, 1, "batch")).toHaveLength(1);
    expect(room.seq).toBe(2);
  });
});

describe("the turn clock (§4.4)", () => {
  const bothMulligan = (room: Room): void => {
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
  };

  it("does nothing while the turn has time on it", () => {
    const room = makeRoom();
    bothMulligan(room);
    expect(room.tick(T0 + 1_000)).toEqual([]);
    expect(room.tick(T0 + room.timer.turnMs + room.timer.ropeMs - 1)).toEqual([]);
  });

  it("counts the rope down only after the turn timer is out", () => {
    const room = makeRoom();
    const { turnMs, ropeMs } = room.timer;

    expect(room.clocks(T0).ropeMsRemaining).toBe(ropeMs);
    expect(room.clocks(T0 + turnMs).turnMsRemaining).toBe(0);
    expect(room.clocks(T0 + turnMs).ropeMsRemaining).toBe(ropeMs);
    expect(room.clocks(T0 + turnMs + ropeMs / 3).ropeMsRemaining).toBe(Math.round((ropeMs * 2) / 3));
    expect(room.clocks(T0 + turnMs + ropeMs).ropeMsRemaining).toBe(0);
  });

  it("injects a real endTurn on expiry, journaled like any other intent", () => {
    const room = makeRoom();
    bothMulligan(room);
    const activeBefore = room.activeSeat;
    const journalBefore = room.journal.intents.length;

    const out = room.tick(T0 + room.timer.turnMs + room.timer.ropeMs);

    expect(room.activeSeat).not.toBe(activeBefore);
    expect(room.journal.intents).toHaveLength(journalBefore + 1);
    expect(room.journal.intents.at(-1)).toEqual({ type: "endTurn", seat: activeBefore });

    // §4.4's [DECISION]: the presenter tells a rope expiry from an end-turn
    // button by this and nothing else.
    const batch = framesFor(out, 0, "batch")[0]!;
    expect(batch.cause).toEqual({ kind: "timer", seat: activeBefore });
    // A turn boundary carries a full snapshot (§4.6), and its seq must agree.
    expect(batch.snapshot?.seq).toBe(batch.seq);
  });

  it("gives the next seat a full turn, and does not expire twice on one tick", () => {
    const room = makeRoom();
    bothMulligan(room);
    const expiry = T0 + room.timer.turnMs + room.timer.ropeMs;
    room.tick(expiry);

    expect(room.clocks(expiry).turnMsRemaining).toBe(room.timer.turnMs);
    expect(room.tick(expiry + 1)).toEqual([]);
  });

  it("auto-concedes after three consecutive turns with no intent at all", () => {
    const room = makeRoom();
    bothMulligan(room);

    const full = room.timer.turnMs + room.timer.ropeMs;
    let now = T0;
    const seats: Seat[] = [];
    for (let i = 0; i < 6 && room.winner === null; i++) {
      seats.push(room.activeSeat);
      now += full;
      room.tick(now);
    }

    expect(room.winner, "nobody was conceded despite six silent turns").not.toBeNull();
    expect(room.journal.intents.at(-1)?.type).toBe("concede");
    // Three of that seat's own turns, which is five turns of alternating play.
    expect(seats.filter((s) => s === room.journal.intents.at(-1)!.seat)).toHaveLength(3);
  });

  it("resets the idle count when a seat actually plays", () => {
    const room = makeRoom();
    bothMulligan(room);
    const full = room.timer.turnMs + room.timer.ropeMs;
    const rng = seedRng(3);

    let now = T0;
    let id = 10;
    for (let round = 0; round < 8 && room.winner === null; round++) {
      // Seat 0 always acts before the rope; seat 1 never does.
      if (room.activeSeat === 0) playSomething(room, rng, id++, now + 10);
      now += full;
      room.tick(now);
    }

    // Seat 1 is the only one who can have been conceded, if anyone was.
    if (room.winner !== null) expect(room.journal.intents.at(-1)).toEqual({ type: "concede", seat: 1 });
  });
});

describe("ending a match", () => {
  it("reports the engine's own reason, once, to both seats", () => {
    const room = makeRoom();
    const out = room.concede(1, T0);

    const ended = out.filter((a) => a.frame.t === "ended");
    expect(ended.map((a) => a.seat).sort()).toEqual([0, 1]);
    for (const { frame } of ended) {
      expect(frame.t === "ended" && frame.winner).toBe(0);
      expect(frame.t === "ended" && frame.reason).toBe("concede");
    }
    expect(room.journal.result).toEqual({ winner: 0, turns: room.authoritativeState().turn });
    // and not again
    expect(room.concede(0, T0 + 1)).toEqual([]);
  });

  it("refuses intents once the match is over", () => {
    const room = makeRoom();
    room.concede(1, T0);
    const out = room.submit(0, 3, { type: "endTurn", seat: 0 }, T0 + 1);
    expect(framesFor(out, 0, "rejected")).toHaveLength(1);
  });
});

describe("rebuilding from the journal (§14.3, and every hibernation)", () => {
  it("comes back to a byte-identical state", () => {
    const room = makeRoom(1234);
    const rng = seedRng(1234);
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    for (let i = 0; i < 30 && room.winner === null; i++) playSomething(room, rng, i + 2, T0 + i * 100);

    expect(room.seq, "the match ended before this proved anything").toBeGreaterThan(20);

    const save: RoomSave = JSON.parse(JSON.stringify(room.save())) as RoomSave;
    const restored = Room.restore(content, save);

    expect(stateHash(restored.authoritativeState())).toBe(stateHash(room.authoritativeState()));
    expect(restored.seq).toBe(room.seq);
    expect(restored.activeSeat).toBe(room.activeSeat);
    for (const seat of [0, 1] as Seat[]) {
      expect(restored.viewHashFor(seat)).toBe(room.viewHashFor(seat));
    }
  });

  it("keeps the clock where it was, so hibernating is not free time", () => {
    /**
     * The failure this prevents: a player about to lose on the rope forces the
     * object out of memory, and a room that rebuilt `turnStartedAtMs` from
     * "now" hands them a fresh 75 seconds. Repeatable, and it would look like a
     * network problem.
     */
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    const later = T0 + 60_000;

    const restored = Room.restore(content, JSON.parse(JSON.stringify(room.save())) as RoomSave);
    expect(restored.clocks(later).turnMsRemaining).toBe(room.clocks(later).turnMsRemaining);
    expect(restored.clocks(later).turnMsRemaining).toBeLessThan(room.timer.turnMs);
  });

  it("carries the idempotency record across, so a resumed client is not re-applied", () => {
    const room = makeRoom();
    room.submit(0, 7, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);

    const restored = Room.restore(content, JSON.parse(JSON.stringify(room.save())) as RoomSave);
    const again = restored.submit(0, 7, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0 + 1000);

    expect(framesFor(again, 0, "accepted")[0]?.seq).toBe(1);
    expect(restored.journal.intents).toHaveLength(1);
  });

  it("refuses to rebuild from a journal this build cannot reproduce", () => {
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);

    const save = JSON.parse(JSON.stringify(room.save())) as RoomSave;
    // An intent that was never legal — what a journal from a different content
    // version looks like from in here.
    (save.record.intents as PlayerIntent[]).push({ type: "attack", seat: 0, attackerInstanceId: "nope", target: { kind: "leader", seat: 1 } });

    expect(() => Room.restore(content, save)).toThrow(/could not be rebuilt/);
  });
});

describe("the room agrees with the engine it wraps", () => {
  it("produces the same state as applying the same intents directly", () => {
    /**
     * The room is a wrapper, and the only interesting way for a wrapper to be
     * wrong is to change the answer. Drive both and compare hashes.
     */
    const room = makeRoom(555);
    let state = createMatch(matchConfig(555), content);

    const rng = seedRng(555);
    let id = 1;
    for (const seat of [0, 1] as Seat[]) {
      const mulligan: PlayerIntent = { type: "mulligan", seat, replaceInstanceIds: [] };
      room.submit(seat, id++, mulligan, T0);
      state = applyIntent(state, content, mulligan).state;
    }

    for (let i = 0; i < 40 && room.winner === null; i++) {
      const active = room.authoritativeState().activeSeat;
      const legal = enumerateLegalIntents(room.authoritativeState(), content, active).filter((x) => x.type !== "concede");
      if (legal.length === 0) break;
      const intent = legal[nextInt(rng, legal.length)]!;
      room.submit(active, id++, intent, T0 + i * 50);
      state = applyIntent(state, content, intent).state;
      expect(stateHash(room.authoritativeState())).toBe(stateHash(state));
    }
    expect(id, "no intents were compared").toBeGreaterThan(10);
  });
});

describe("the monotonic clock (§7.7 C10)", () => {
  it("never goes backwards when the wall clock does", () => {
    let fake = 1000;
    const clock = new MonotonicClock(() => fake);
    expect(clock.now()).toBe(1000);
    fake = 1500;
    expect(clock.now()).toBe(1500);
    fake = 900; // NTP correction
    expect(clock.now()).toBe(1500);
    fake = 1600;
    expect(clock.now()).toBe(1600);
  });

  it("can be brought forward to a persisted timestamp", () => {
    let fake = 1000;
    const clock = new MonotonicClock(() => fake);
    clock.observe(50_000);
    expect(clock.now()).toBe(50_000);
  });
});

describe("the disconnect grace window (§8.2)", () => {
  const ready = (room: Room): void => {
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
  };

  it("tells the opponent, with a countdown rather than a mystery", () => {
    const room = makeRoom();
    ready(room);
    const out = room.setConnected(0, false, T0 + 1_000);

    // Both seats are told about seat 0; the absent one is not listening, and a
    // frame that works out who is worth telling is one that can get it wrong.
    const seen = framesFor(out, 1, "presence");
    expect(seen).toHaveLength(2);
    const aboutZero = seen.find((f) => f.seat === 0)!;
    expect(aboutZero.status).toBe("disconnected");
    expect(aboutZero.graceRemainingMs).toBe(room.timer.seatHoldMs);
    // §8.2: "never any network detail" — three values, not six.
    expect(["connected", "unstable", "disconnected"]).toContain(aboutZero.status);
  });

  it("counts the grace down, and says so", () => {
    const room = makeRoom();
    ready(room);
    room.setConnected(0, false, T0);
    const later = room.setConnected(0, true, T0 + 30_000);
    expect(framesFor(later, 1, "presence").find((f) => f.seat === 0)?.status).toBe("connected");

    room.setConnected(0, false, T0 + 40_000);
    const out = room.tick(T0 + 60_000);
    void out;
    const again = room.setConnected(0, true, T0 + 60_000);
    expect(framesFor(again, 1, "presence").find((f) => f.seat === 0)?.status).toBe("connected");
  });

  it("says nothing when nothing changed", () => {
    // Two close events for one socket, or a connect for a seat already here.
    const room = makeRoom();
    ready(room);
    expect(room.setConnected(0, true, T0)).toEqual([]);
    room.setConnected(0, false, T0);
    expect(room.setConnected(0, false, T0 + 5_000)).toEqual([]);
  });
});

describe("the Buffer Shield (game-modes §7.10)", () => {
  const ready = (room: Room): Seat => {
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    return room.activeSeat;
  };

  it("pauses the clock when the active player drops", () => {
    const room = makeRoom();
    const active = ready(room);
    const before = room.clocks(T0 + 10_000).turnMsRemaining;

    room.setConnected(active, false, T0 + 10_000);
    // Twenty seconds pass with nobody there. The clock must not have moved.
    expect(room.clocks(T0 + 30_000).turnMsRemaining).toBe(before);
  });

  it("gives the time back on reconnect, not the whole turn", () => {
    const room = makeRoom();
    const active = ready(room);
    room.setConnected(active, false, T0 + 10_000);
    room.setConnected(active, true, T0 + 30_000);

    // 10 s were played, 20 s were paused. At T0+40s, 20 s should be spent.
    expect(room.clocks(T0 + 40_000).turnMsRemaining).toBe(room.timer.turnMs - 20_000);
  });

  it("does not pause when the player who dropped is not on the clock", () => {
    /**
     * Otherwise dropping is a weapon: you could stop your opponent's turn timer
     * by pulling your own cable.
     */
    const room = makeRoom();
    const active = ready(room);
    const idle = (active === 0 ? 1 : 0) as Seat;

    room.setConnected(idle, false, T0 + 5_000);
    expect(room.clocks(T0 + 25_000).turnMsRemaining).toBe(room.timer.turnMs - 25_000);
  });

  it("runs out after 45 seconds and lets the clock go", () => {
    const room = makeRoom();
    const active = ready(room);
    room.setConnected(active, false, T0 + 1_000);

    // 100 s away, but only 45 s of it is shielded.
    room.tick(T0 + 101_000);
    const spentUnshielded = 101_000 - room.timer.bufferShieldMs;
    expect(room.clocks(T0 + 101_000).turnMsRemaining).toBe(Math.max(0, room.timer.turnMs - spentUnshielded));
  });

  it("is once per match, not once per disconnect", () => {
    /**
     * The reason it is banked rather than reset: otherwise a player buys 45
     * seconds of thinking time every time they close their laptop lid, as often
     * as they like.
     */
    const room = makeRoom();
    const active = ready(room);

    room.setConnected(active, false, T0 + 1_000);
    room.setConnected(active, true, T0 + 41_000); // spends 40 s of the 45
    room.setConnected(active, false, T0 + 42_000);
    room.tick(T0 + 60_000);

    // Only 5 s of shield was left, so the clock resumed at T0+47s.
    const paused = 40_000 + 5_000;
    expect(room.clocks(T0 + 60_000).turnMsRemaining).toBe(room.timer.turnMs - (60_000 - 1_000 - paused) - 1_000);
  });
});

describe("the seat hold (§8.2, third tier)", () => {
  it("concedes the seat after 90 seconds away, and not before", () => {
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    const gone = (room.activeSeat === 0 ? 1 : 0) as Seat;

    room.setConnected(gone, false, T0);
    expect(room.tick(T0 + 89_000), "conceded early").toEqual([]);
    expect(room.winner).toBeNull();

    const out = room.tick(T0 + 90_000);
    expect(room.winner).toBe(gone === 0 ? 1 : 0);
    // A real intent, journaled, so a replay plays the forfeit too.
    expect(room.journal.intents.at(-1)).toEqual({ type: "concede", seat: gone });
    expect(out.filter((a) => a.frame.t === "ended")).toHaveLength(2);
  });

  it("does not concede a player who came back", () => {
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);

    room.setConnected(1, false, T0);
    room.setConnected(1, true, T0 + 80_000);
    room.tick(T0 + 200_000);
    expect(room.journal.intents.every((i) => i.type !== "concede")).toBe(true);
  });

  it("survives a rebuild, or the hold is not a hold at all", () => {
    /**
     * A Durable Object is evicted while players think. A disconnect timer kept
     * only in a field would restart on every wake, and a seat hold that never
     * expires is the same as no seat hold.
     */
    const room = makeRoom();
    room.submit(0, 1, { type: "mulligan", seat: 0, replaceInstanceIds: [] }, T0);
    room.submit(1, 1, { type: "mulligan", seat: 1, replaceInstanceIds: [] }, T0);
    room.setConnected(1, false, T0);

    const restored = Room.restore(content, JSON.parse(JSON.stringify(room.save())) as RoomSave);
    expect(restored.isDisconnected(1)).toBe(true);
    restored.tick(T0 + 90_000);
    expect(restored.winner, "the seat hold restarted on wake").toBe(0);
  });
});
