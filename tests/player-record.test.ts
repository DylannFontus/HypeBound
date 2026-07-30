/**
 * The server's record of what an account has played.
 *
 * Small arithmetic, and worth testing precisely because it is small: this is
 * the number a rating would eventually be computed from, and the failure mode
 * of a miscounted win is not a crash — it is a ladder that is quietly wrong for
 * everybody.
 *
 * Idempotency gets the most attention here. The room writes a result once, but
 * "once" is a property of a code path, not of a system where an object can be
 * evicted between a write and the flag that records the write.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_RECORD,
  HISTORY_LIMIT,
  apply,
  publicView,
  winRate,
  type MatchResult,
  type PlayerRecordData,
} from "../server/src/player/record";

const T0 = 1_800_000_000_000;

const result = (over: Partial<MatchResult> = {}): MatchResult => ({
  matchId: "casual-0-aaaa",
  outcome: "win",
  leaderCardId: "idols-lumi-starcall",
  opponentLeaderCardId: "goth-leader-morvina-vane",
  turns: 9,
  endedAtMs: T0,
  reason: "leaderDefeated",
  ...over,
});

const build = (outcomes: MatchResult["outcome"][]): PlayerRecordData =>
  outcomes.reduce((acc, outcome, i) => apply(acc, result({ matchId: `m${i}`, outcome })), EMPTY_RECORD);

describe("counting", () => {
  it("starts empty, and says so rather than saying zero per cent", () => {
    expect(EMPTY_RECORD.played).toBe(0);
    // Null, not 0: "no matches" and "no wins" are different facts, and a new
    // player shown 0% has been told something untrue about themselves.
    expect(winRate(EMPTY_RECORD)).toBeNull();
  });

  it("tallies each outcome into its own column", () => {
    const record = build(["win", "loss", "win", "draw"]);
    expect(record).toMatchObject({ played: 4, won: 2, lost: 1, drawn: 1 });
  });

  it("keeps draws in the denominator, because they were played", () => {
    expect(winRate(build(["win", "draw"]))).toBe(50);
    expect(winRate(build(["win", "win", "win", "loss"]))).toBe(75);
  });

  it("reports one decimal place rather than a repeating fraction", () => {
    expect(winRate(build(["win", "loss", "loss"]))).toBe(33.3);
  });

  it("puts the newest match first", () => {
    const record = apply(apply(EMPTY_RECORD, result({ matchId: "older" })), result({ matchId: "newer" }));
    expect(record.recent.map((r) => r.matchId)).toEqual(["newer", "older"]);
  });
});

describe("the same match cannot count twice", () => {
  it("ignores a repeat of the id it already has", () => {
    /**
     * The retry that makes the write reliable is the same retry that would
     * double a win. Idempotency is what lets the room retry at all.
     */
    const once = apply(EMPTY_RECORD, result({ matchId: "m1", outcome: "win" }));
    const twice = apply(once, result({ matchId: "m1", outcome: "win" }));
    expect(twice).toBe(once);
    expect(twice.played).toBe(1);
  });

  it("ignores a repeat even if the outcome disagrees", () => {
    // A second write claiming the opposite result is a bug somewhere, and the
    // first answer is the one the room actually adjudicated.
    const once = apply(EMPTY_RECORD, result({ matchId: "m1", outcome: "win" }));
    const contradicted = apply(once, result({ matchId: "m1", outcome: "loss" }));
    expect(contradicted.won).toBe(1);
    expect(contradicted.lost).toBe(0);
    expect(contradicted.played).toBe(1);
  });

  it("still counts two genuinely different matches", () => {
    // The obvious way to break the guard is to make it too broad.
    const record = apply(apply(EMPTY_RECORD, result({ matchId: "m1" })), result({ matchId: "m2" }));
    expect(record.played).toBe(2);
  });
});

describe("bounded, and honest about the bound", () => {
  it("keeps only the most recent results", () => {
    const many = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) =>
      result({ matchId: `m${i}`, endedAtMs: T0 + i })
    ).reduce(apply, EMPTY_RECORD);

    expect(many.played, "the totals are not bounded, only the list is").toBe(HISTORY_LIMIT + 10);
    expect(many.recent).toHaveLength(HISTORY_LIMIT);
    expect(many.recent[0]!.matchId).toBe(`m${HISTORY_LIMIT + 9}`);
  });

  it("bounds the dedupe window to the same length, which is the stated limit", () => {
    /**
     * A duplicate arriving after `HISTORY_LIMIT` further matches would count
     * twice. That is written down in `record.ts` rather than defended against,
     * because a room is destroyed long before then — and an unbounded list
     * growing for ever to guard against nothing is the worse trade. This test
     * exists so the limit is a decision rather than a surprise.
     */
    const many = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => result({ matchId: `m${i}` })).reduce(
      apply,
      EMPTY_RECORD
    );
    expect(many.seen).toHaveLength(HISTORY_LIMIT);
    expect(many.seen).not.toContain("m0");

    const resurrected = apply(many, result({ matchId: "m0" }));
    expect(resurrected.played, "the documented limit changed without the note changing").toBe(HISTORY_LIMIT + 2);
  });
});

describe("what a client is told", () => {
  it("gets the totals and the list, and not the bookkeeping", () => {
    const record = build(["win", "loss"]);
    const view = publicView(record);

    expect(view).toMatchObject({ played: 2, won: 1, lost: 1, drawn: 0, winRate: 50 });
    expect(view.recent).toHaveLength(2);
    // `seen` is how the server avoids double-counting; it is not information
    // about the player and there is no reason to put it on a wire.
    expect("seen" in view).toBe(false);
  });

  it("carries which leaders played, so a client can say more than win or lose", () => {
    const view = publicView(apply(EMPTY_RECORD, result()));
    expect(view.recent[0]).toMatchObject({
      leaderCardId: "idols-lumi-starcall",
      opponentLeaderCardId: "goth-leader-morvina-vane",
      reason: "leaderDefeated",
      turns: 9,
    });
  });
});
