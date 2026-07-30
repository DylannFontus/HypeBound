/**
 * Wire protocol v1 — `docs/tech/03-multiplayer-architecture.md` §7.
 *
 * §15 phase 2 asks for this file to be "unused by the local path, but validated
 * in tests", and the validation that matters is not a handful of hand-written
 * frames. It is the two directions of the same question:
 *
 * 1. **Does the schema accept everything the engine can legitimately produce?**
 *    A rejected legal intent is an unplayable card, and it would be discovered
 *    by a player rather than by us. So the engine itself generates the corpus:
 *    `enumerateLegalIntents` across real matches, every one of which must pass.
 *
 * 2. **Does it reject what a hostile client can send?** `PlayerIntent` is the
 *    entire client→server attack surface (§2), so the interesting cases are the
 *    ones a modified client produces, not the ones a UI does.
 *
 * The first is the one people skip, and it is the one with a user-visible
 * failure mode.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { enumerateLegalIntents } from "../src/engine/intents";
import { nextInt, seedRng } from "../src/engine/rng";
import { getAiProfile } from "../src/ai/profiles";
import { LocalTransport } from "../src/net/localTransport";
import {
  PROTOCOL_VERSION,
  WIRE_LIMITS,
  parseClientFrame,
  zClientEnvelope,
  zEventBatch,
  zMatchSnapshot,
  zPlayerIntent,
  zServerBatch,
  zServerEnvelope,
  zTargetRef,
} from "../src/net/protocol";
import type { PlayerIntent } from "../src/engine/types";

const content = getContent();

/** Every legal intent the engine offers across a few real matches. */
function harvestIntents(seeds: number[], maxSteps = 120): PlayerIntent[] {
  const harvested: PlayerIntent[] = [];
  for (const seed of seeds) {
    let state = createMatch(
      {
        seed,
        decks: [
          autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
          autoBuildDeck(content, "algo-leader-cassia-cache", "P2"),
        ],
        firstSeat: 0,
      },
      content
    );
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;
    harvested.push({ type: "mulligan", seat: 0, replaceInstanceIds: [] });

    const rng = seedRng(seed ^ 0xabcdef);
    for (let i = 0; i < maxSteps && state.winner === null; i++) {
      const legal = enumerateLegalIntents(state, content, state.activeSeat);
      if (legal.length === 0) break;
      harvested.push(...legal);
      const doing = legal.filter((intent) => intent.type !== "endTurn");
      const pool = doing.length > 0 && nextInt(rng, 100) < 80 ? doing : legal;
      state = applyIntent(state, content, pool[nextInt(rng, pool.length)]!).state;
    }
  }
  return harvested;
}

describe("the schema accepts every intent the engine can produce", () => {
  it("validates the whole legal corpus, and sees every variant", () => {
    const intents = harvestIntents([2, 20, 200, 2024]);
    const seen = new Set(intents.map((intent) => intent.type));
    const rejected: string[] = [];

    for (const intent of intents) {
      const result = zPlayerIntent.safeParse(intent);
      if (!result.success) {
        rejected.push(`${intent.type}: ${result.error.issues[0]?.message} — ${JSON.stringify(intent)}`);
      }
    }

    expect(rejected.slice(0, 5), "the schema rejected an intent the engine offered").toEqual([]);
    expect(intents.length, "no intents were harvested").toBeGreaterThan(500);

    /**
     * Coverage, because "0 rejected out of 3 kinds" is not the same claim as
     * "0 rejected out of 8". `concede` never appears in `enumerateLegalIntents`
     * (it is always legal and never *offered*), so it is checked separately
     * below; the other seven must all show up.
     */
    for (const type of [
      "mulligan",
      "playCard",
      "attack",
      "useFixation",
      "activateLocation",
      "activateConfluence",
      "endTurn",
    ]) {
      expect(seen.has(type as PlayerIntent["type"]), `no ${type} intent was ever produced`).toBe(true);
    }
  });

  it("accepts concede, which is legal but never offered", () => {
    expect(zPlayerIntent.safeParse({ type: "concede", seat: 1 }).success).toBe(true);
  });

  it("keeps playCard.choices and activateConfluence.choice apart", () => {
    /**
     * Two fields one letter apart on the same wire: a plural array of branch
     * indexes, and a singular number. Merging them is the kind of mistake that
     * validates fine and resolves the wrong card half.
     */
    expect(zPlayerIntent.safeParse({ type: "playCard", seat: 0, instanceId: "c1", choices: [0, 1] }).success).toBe(true);
    expect(zPlayerIntent.safeParse({ type: "playCard", seat: 0, instanceId: "c1", choice: 0 }).success).toBe(false);
    expect(
      zPlayerIntent.safeParse({ type: "activateConfluence", seat: 0, confluence: "bloom", choice: 1 }).success
    ).toBe(true);
    expect(
      zPlayerIntent.safeParse({ type: "activateConfluence", seat: 0, confluence: "bloom", choices: [1] }).success
    ).toBe(false);
  });
});

describe("the schema rejects what a modified client can send", () => {
  const bad: [string, unknown][] = [
    ["an unknown intent type", { type: "drawSevenCards", seat: 0 }],
    ["a third seat", { type: "endTurn", seat: 2 }],
    ["a string seat", { type: "endTurn", seat: "0" }],
    ["a missing seat", { type: "endTurn" }],
    ["a fractional seat", { type: "endTurn", seat: 0.5 }],
    ["an attack with no target", { type: "attack", seat: 0, attackerInstanceId: "c1" }],
    ["a target naming neither a character nor a leader", { type: "attack", seat: 0, attackerInstanceId: "c1", target: { kind: "deck" } }],
    ["a negative slot", { type: "playCard", seat: 0, instanceId: "c1", slot: -1 }],
    ["an unknown confluence", { type: "activateConfluence", seat: 0, confluence: "supernova" }],
    ["an unknown fixation kind", { type: "useFixation", seat: 0, kind: "superUltimate" }],
    ["an unknown refract Current", { type: "playCard", seat: 0, instanceId: "c1", refractChoice: "plasma" }],
    ["an oversized mulligan", { type: "mulligan", seat: 0, replaceInstanceIds: Array(500).fill("c1") }],
    ["an oversized target list", { type: "attack", seat: 0, attackerInstanceId: "c1", target: { kind: "leader", seat: 1 }, targets: Array(99).fill({ kind: "leader", seat: 1 }) }],
    ["an instance id long enough to be a payload", { type: "playCard", seat: 0, instanceId: "x".repeat(5000) }],
  ];

  for (const [label, payload] of bad) {
    it(`rejects ${label}`, () => {
      expect(zPlayerIntent.safeParse(payload).success).toBe(false);
    });
  }

  it("rejects a TargetRef that names a leader with no seat", () => {
    expect(zTargetRef.safeParse({ kind: "leader" }).success).toBe(false);
    expect(zTargetRef.safeParse({ kind: "leader", seat: 1 }).success).toBe(true);
    expect(zTargetRef.safeParse({ kind: "character", instanceId: "u3" }).success).toBe(true);
  });
});

describe("frames", () => {
  const now = 1_700_000_000_000;

  it("accepts a well-formed intent frame", () => {
    const frame = {
      v: PROTOCOL_VERSION,
      t: "intent",
      ts: now,
      id: 7,
      intent: { type: "endTurn", seat: 0 },
    };
    expect(zClientEnvelope.safeParse(frame).success).toBe(true);
  });

  it("refuses a frame from another protocol version", () => {
    const frame = { v: 2, t: "intent", ts: now, id: 1, intent: { type: "endTurn", seat: 0 } };
    expect(zClientEnvelope.safeParse(frame).success).toBe(false);
  });

  it("checks the size cap before parsing, not after", () => {
    /**
     * Order matters and is not cosmetic. A 10 MB frame that fails validation
     * has already cost the room the allocation and the JSON parse — which is
     * the whole point of sending it.
     */
    const huge = JSON.stringify({ v: 1, t: "ping", ts: now, pad: "x".repeat(WIRE_LIMITS.maxFrameBytes) });
    const result = parseClientFrame(huge);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("tooLarge");
  });

  it("reports malformed JSON and schema failures differently", () => {
    const malformed = parseClientFrame("{not json");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe("malformed");

    const wrong = parseClientFrame(JSON.stringify({ v: 1, t: "intent", ts: now, id: 1, intent: { type: "nope" } }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.code).toBe("schema");
      // the detail names a path, so a failure is debuggable from a log line
      expect(wrong.detail.length).toBeGreaterThan(0);
    }
  });

  it("accepts a ping carrying a piggybacked ack", () => {
    // §7.2 says a ping "also carries the latest ack" and gives it no field;
    // these are those fields.
    expect(
      zClientEnvelope.safeParse({ v: 1, t: "ping", ts: now, ackSeq: 12, viewHash: "0a1b2c3d" }).success
    ).toBe(true);
    expect(zClientEnvelope.safeParse({ v: 1, t: "ping", ts: now }).success).toBe(true);
  });

  it("insists a view hash is eight lowercase hex characters", () => {
    const base = { v: 1, t: "ack", ts: now, seq: 3 };
    expect(zClientEnvelope.safeParse({ ...base, viewHash: "0a1b2c3d" }).success).toBe(true);
    expect(zClientEnvelope.safeParse({ ...base, viewHash: "0A1B2C3D" }).success).toBe(false);
    expect(zClientEnvelope.safeParse({ ...base, viewHash: "abc" }).success).toBe(false);
  });
});

describe("server frames", () => {
  const now = 1_700_000_000_000;
  const clocks = { activeSeat: 0 as const, turnMsRemaining: 1000, ropeMsRemaining: 0, serverNowMs: now };
  const snapshot = { seq: 4, view: {}, revealedDeckInstanceIds: [], clocks, spectatorCount: 0 };

  it("requires a batch's snapshot to agree with the batch's own seq", () => {
    /**
     * §6 puts `seq` on both the batch and its optional snapshot with no stated
     * winner. Rather than leave a client to guess which is authoritative, they
     * are required to match — which is what the local implementation already
     * emits.
     */
    const good = { v: 1, t: "batch", ts: now, seq: 4, cause: { kind: "intent", seat: 0 }, events: [], clocks, viewHash: "0a1b2c3d", snapshot };
    expect(zServerBatch.safeParse(good).success).toBe(true);

    const mismatched = { ...good, snapshot: { ...snapshot, seq: 9 } };
    expect(zServerBatch.safeParse(mismatched).success).toBe(false);
  });

  it("lets a system cause omit the seat it does not have", () => {
    /**
     * §6 makes `cause.seat` required, and `Seat` has no null member, so a
     * system cause — match start, a scripted wave landing — had to name a seat
     * it does not have. `LocalTransport` passed `activeSeat`, which reads like
     * a fact and is not one.
     */
    const base = { v: 1, t: "batch", ts: now, seq: 1, events: [], clocks, viewHash: "0a1b2c3d" };
    expect(zServerBatch.safeParse({ ...base, cause: { kind: "system" } }).success).toBe(true);
    expect(zServerBatch.safeParse({ ...base, cause: { kind: "timer", seat: 1 } }).success).toBe(true);
    // a timer cause, by contrast, always knows whose clock ran out
    expect(zServerBatch.safeParse({ ...base, cause: { kind: "timer" } }).success).toBe(false);
  });

  it("allows a snapshot at seq 0, meaning 'before any batch'", () => {
    // §7.5 says sequence numbers start at 1 — true of batches. A snapshot taken
    // before the first batch is legitimately current as of none.
    expect(zMatchSnapshot.safeParse({ ...snapshot, seq: 0 }).success).toBe(true);
    expect(zMatchSnapshot.safeParse({ ...snapshot, seq: -1 }).success).toBe(false);
  });

  it("pins `ended` to the four canonical reasons", () => {
    const base = { v: 1, t: "ended", ts: now, winner: 0, matchId: "m1", replayAvailable: true };
    for (const reason of ["leaderDefeated", "concede", "finale", "draw"]) {
      expect(zServerEnvelope.safeParse({ ...base, reason }).success, reason).toBe(true);
    }
    // §4.4 and §8.2 surface timeouts and disconnects as an injected concede, so
    // a room inventing one of these would be breaking the canonical type.
    for (const reason of ["timeout", "disconnect", "abandoned"]) {
      expect(zServerEnvelope.safeParse({ ...base, reason }).success, reason).toBe(false);
    }
  });

  it("can tell a player from a spectator", () => {
    const base = {
      v: 1,
      t: "welcome",
      ts: now,
      sessionId: "s1",
      resumeToken: "a".repeat(43),
      seat: 0,
      matchId: "m1",
      netConfig: { heartbeatSeconds: 5, resumeGraceSeconds: 60, seatHoldSeconds: 90, maxFrameBytes: 65536, turnSeconds: 75, ropeSeconds: 15 },
      snapshot,
    };
    expect(zServerEnvelope.safeParse({ ...base, role: "player" }).success).toBe(true);
    expect(zServerEnvelope.safeParse({ ...base, role: "spectator" }).success).toBe(true);
    // the field is required: a client that cannot tell which it is would not
    // know whether to draw an End Turn button
    expect(zServerEnvelope.safeParse(base).success).toBe(false);
  });
});

describe("what LocalTransport actually emits validates", () => {
  /**
   * The local path does not speak the protocol, and §15 says so. But the
   * batches it builds are the same shape a room will send, so running them
   * through the wire schema is a free check that the two have not drifted —
   * and it is how a change to `EventBatch` gets noticed here rather than in
   * the first online match.
   */
  it("its event batches satisfy the wire schema", async () => {
    const transport = new LocalTransport({
      content,
      playerDeck: autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
      aiDeck: autoBuildDeck(content, "algo-leader-cassia-cache", "P2"),
      aiProfile: getAiProfile("intermediate"),
      seed: 90210,
      playerSeat: 0,
      firstSeat: 0,
    });

    const problems: string[] = [];
    let checked = 0;
    transport.onBatch((batch) => {
      checked += 1;
      const result = zEventBatch.safeParse(batch);
      if (!result.success) {
        problems.push(`seq ${batch.seq}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      }
    });

    await transport.connect();
    await transport.submit({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
    for (let i = 0; i < 4; i++) await transport.submit({ type: "endTurn", seat: 0 });

    expect(problems.slice(0, 3)).toEqual([]);
    expect(checked, "no batch was produced to check").toBeGreaterThan(3);
  });

  it("its snapshots satisfy the wire schema", async () => {
    const transport = new LocalTransport({
      content,
      playerDeck: autoBuildDeck(content, "goth-leader-morvina-vane", "P1"),
      aiDeck: autoBuildDeck(content, "algo-leader-cassia-cache", "P2"),
      aiProfile: getAiProfile("intermediate"),
      seed: 24680,
      playerSeat: 0,
      firstSeat: 0,
    });
    const opening = await transport.connect();
    const result = zMatchSnapshot.safeParse(opening);
    expect(result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`)).toEqual([]);
  });
});
