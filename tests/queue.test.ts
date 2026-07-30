/**
 * The casual queue's pairing loop (§9), tested without a server.
 *
 * The band schedule and the score are the only places matchmaking has an
 * opinion, and both are arithmetic over a few numbers — so they are cheap to
 * test and expensive to get wrong. A widening rule that is subtly off does not
 * throw; it just quietly pairs a beginner with an expert, or leaves someone in
 * a queue for ever, and neither shows up anywhere except in how the game feels.
 */

import { describe, expect, it } from "vitest";
import { Queue, QUEUE_TUNING, effectiveBand, pairScore, type Ticket } from "../server/src/queue/queue";

const T0 = 1_700_000_000_000;

let counter = 0;
function ticket(overrides: Partial<Ticket> = {}): Ticket {
  counter += 1;
  return {
    ticketId: `t${counter}`,
    accountId: `acct-${counter}`,
    queueId: "casual",
    rating: 1500,
    rd: 50,
    enqueuedAtMs: T0,
    build: "build-1",
    contentHash: "hash-1",
    deckHash: `deck-${counter}`,
    leaderCardId: "goth-leader-morvina-vane",
    recentOpponents: [],
    flags: { newPlayer: false, riskFlagged: false },
    ...overrides,
  };
}

const makeQueue = (): Queue => new Queue({ mintMatchId: (index) => `match-${index}` });

describe("the widening schedule (§9.3)", () => {
  it("starts at the published ±150 and holds at ±400", () => {
    // Uncertainty is added at all times, so a settled player (RD 0) is the only
    // one who sees the published numbers exactly. That is the point of the test.
    expect(effectiveBand(0, 0)).toBe(150);
    expect(effectiveBand(15_000, 0)).toBe(150);
    expect(effectiveBand(45_000, 0)).toBe(250);
    expect(effectiveBand(90_000, 0)).toBe(400);
    expect(effectiveBand(120_000, 0)).toBe(400);
  });

  it("widens linearly between the published points", () => {
    expect(effectiveBand(30_000, 0)).toBeCloseTo(200, 5);
    expect(effectiveBand(67_500, 0)).toBeCloseTo(325, 5);
  });

  it("adds uncertainty from the first second, not after 150 of them", () => {
    /**
     * §9.3's table adds `min(200, 1.5 × RD)` only in the 150–240 s row, and the
     * bullet under it says the effective band is `band + min(200, 1.5 × RD)`
     * **at all times**, "so freshly placed and returning players (high RD) find
     * games quickly". A player who must wait 150 seconds for their uncertainty
     * to count is not finding games quickly, so the bullet wins. C19.
     */
    expect(effectiveBand(0, 100)).toBe(300);
    expect(effectiveBand(0, 350)).toBe(350); // capped at +200, not +525
  });

  it("goes unbounded once the AI has been offered", () => {
    // §9.3's last row. By this point casual has already told the player it
    // cannot find them a human, so pairing anyone left is strictly better than
    // continuing to refuse.
    expect(effectiveBand(QUEUE_TUNING.unboundedAfterMs, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("what is never relaxed", () => {
  it("refuses to pair across builds or content, however long the wait", () => {
    /**
     * §14.5's invariant, and the one that cannot be softened by patience:
     * determinism across two machines is meaningless for two different builds.
     * Tested at a wait where the rating band is literally infinite, so the only
     * thing that can be refusing is this.
     */
    const queue = makeQueue();
    queue.add(ticket({ build: "build-1" }));
    queue.add(ticket({ build: "build-2" }));
    expect(queue.pair(T0 + 600_000)).toEqual([]);

    const other = makeQueue();
    other.add(ticket({ contentHash: "hash-1" }));
    other.add(ticket({ contentHash: "hash-2" }));
    expect(other.pair(T0 + 600_000)).toEqual([]);
  });

  it("never pairs an account with itself", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "a", accountId: "same" }));
    queue.add(ticket({ ticketId: "b", accountId: "same" }));
    // Re-queueing replaces rather than stacking, so there is only one ticket.
    expect(queue.size).toBe(1);
    expect(queue.pair(T0 + 600_000)).toEqual([]);
  });
});

describe("pairing", () => {
  it("pairs two close ratings immediately", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "a", rating: 1500 }));
    queue.add(ticket({ ticketId: "b", rating: 1520 }));

    const pairs = queue.pair(T0);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.matchId).toBe("match-0");
    expect(pairs[0]!.seats.map((s) => s.ticketId).sort()).toEqual(["a", "b"]);
    expect(queue.size, "paired tickets must leave the pool").toBe(0);
  });

  it("refuses a gap the band does not yet cover, then allows it later", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "a", rating: 1000, rd: 0 }));
    queue.add(ticket({ ticketId: "b", rating: 1300, rd: 0 }));

    // 300 apart: outside ±150 at zero wait, inside ±400 after 90 s.
    expect(queue.pair(T0)).toEqual([]);
    expect(queue.pair(T0 + 90_000)).toHaveLength(1);
  });

  it("serves the longest wait first", () => {
    /**
     * Ageing is what stops a trickle of arrivals from starving the person who
     * has been there longest. With three compatible tickets and one pair
     * available per pass, the oldest must be in it.
     */
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "young", rating: 1500, enqueuedAtMs: T0 + 20_000 }));
    queue.add(ticket({ ticketId: "old", rating: 1500, enqueuedAtMs: T0 }));
    queue.add(ticket({ ticketId: "middle", rating: 1500, enqueuedAtMs: T0 + 10_000 }));

    const pairs = queue.pair(T0 + 30_000);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.seats.map((s) => s.ticketId)).toContain("old");
    expect(queue.size, "the odd one out stays in the queue").toBe(1);
  });

  it("prefers the closer rating when both are legal", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "seeker", rating: 1500 }));
    queue.add(ticket({ ticketId: "far", rating: 1640 }));
    queue.add(ticket({ ticketId: "near", rating: 1510 }));

    const pairs = queue.pair(T0);
    expect(pairs[0]!.seats.map((s) => s.ticketId).sort()).toEqual(["near", "seeker"]);
  });

  it("prefers a stranger over a rematch, but takes the rematch over nobody", () => {
    const rematch = makeQueue();
    rematch.add(ticket({ ticketId: "a", accountId: "A", rating: 1500, recentOpponents: ["B"] }));
    rematch.add(ticket({ ticketId: "b", accountId: "B", rating: 1500, recentOpponents: ["A"] }));

    // Nobody else is here. A rematch beats an empty queue.
    expect(rematch.pair(T0)).toHaveLength(1);

    const withChoice = makeQueue();
    const a = ticket({ ticketId: "a", accountId: "A", rating: 1500, recentOpponents: ["B"] });
    withChoice.add(a);
    withChoice.add(ticket({ ticketId: "b", accountId: "B", rating: 1500, recentOpponents: ["A"] }));
    withChoice.add(ticket({ ticketId: "c", accountId: "C", rating: 1560 }));

    // 60 points further away, but not someone they just played: the 120-point
    // rematch penalty outweighs the 60-point rating gap.
    const pairs = withChoice.pair(T0);
    expect(pairs[0]!.seats.map((s) => s.accountId).sort()).toEqual(["A", "C"]);
  });

  it("forgives the rematch once someone has waited a minute", () => {
    const a = ticket({ ticketId: "a", accountId: "A", recentOpponents: ["B"] });
    const b = ticket({ ticketId: "b", accountId: "B", recentOpponents: ["A"] });
    expect(pairScore(a, b, T0)).toBeLessThan(pairScore(a, b, T0 + 61_000) - 120);
  });

  it("keeps flagged accounts away from unflagged ones while it can", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "clean", accountId: "A", rating: 1500 }));
    queue.add(ticket({ ticketId: "flagged", accountId: "B", rating: 1500, flags: { newPlayer: false, riskFlagged: true } }));
    queue.add(ticket({ ticketId: "clean2", accountId: "C", rating: 1620 }));

    // 120 points further away beats a 300-point mixed-flag penalty.
    const pairs = queue.pair(T0);
    expect(pairs[0]!.seats.map((s) => s.accountId).sort()).toEqual(["A", "C"]);
    expect(queue.size).toBe(1);
  });

  it("is happy to pair two flagged accounts with each other", () => {
    // game-modes §7.8 wants them together, so the penalty is on the *mixed*
    // pairing. Two flagged players are a perfectly good match.
    const flagged = { newPlayer: false, riskFlagged: true };
    const a = ticket({ accountId: "A", flags: flagged });
    const b = ticket({ accountId: "B", flags: flagged });
    expect(pairScore(a, b, T0)).toBe(pairScore(ticket({ accountId: "C" }), ticket({ accountId: "D" }), T0));
  });

  it("pairs several at once and mints a distinct id for each", () => {
    const queue = makeQueue();
    for (let i = 0; i < 6; i++) queue.add(ticket({ ticketId: `p${i}`, rating: 1500 + i }));

    const pairs = queue.pair(T0);
    expect(pairs).toHaveLength(3);
    expect(new Set(pairs.map((p) => p.matchId)).size).toBe(3);
    expect(queue.size).toBe(0);
    // and nobody was placed in two matches at once
    const seated = pairs.flatMap((p) => p.seats.map((s) => s.ticketId));
    expect(new Set(seated).size).toBe(6);
  });
});

describe("the honest AI offer (§9.3, and the reason it ships on day one)", () => {
  it("says nothing before four minutes", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "waiting" }));
    expect(queue.offerAi(T0 + 239_000)).toEqual([]);
  });

  it("offers once four minutes have passed", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "waiting" }));
    const offered = queue.offerAi(T0 + QUEUE_TUNING.aiOfferAfterMs);
    expect(offered.map((t) => t.ticketId)).toEqual(["waiting"]);
  });

  it("offers once, not once per tick", () => {
    // The alarm runs every second. A player who has waited five minutes must
    // not be asked three hundred times whether they would like to play the AI.
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "waiting" }));
    expect(queue.offerAi(T0 + 300_000)).toHaveLength(1);
    expect(queue.offerAi(T0 + 301_000)).toHaveLength(0);
    expect(queue.offerAi(T0 + 400_000)).toHaveLength(0);
  });

  it("keeps the player in the queue after offering", () => {
    /**
     * The offer is an offer. §9.3 says "never a fake human" — it does not say
     * to give up, and a player who ignores the prompt should still be paired the
     * moment somebody else appears.
     */
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "patient", rating: 1500 }));
    queue.offerAi(T0 + 300_000);
    expect(queue.size).toBe(1);

    queue.add(ticket({ ticketId: "newcomer", rating: 1500 }));
    expect(queue.pair(T0 + 301_000)).toHaveLength(1);
  });

  it("re-offers to a player who leaves and comes back", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "again" }));
    expect(queue.offerAi(T0 + 300_000)).toHaveLength(1);
    queue.remove("again");
    queue.add(ticket({ ticketId: "again", enqueuedAtMs: T0 + 400_000 }));
    expect(queue.offerAi(T0 + 400_000 + QUEUE_TUNING.aiOfferAfterMs)).toHaveLength(1);
  });
});

describe("leaving", () => {
  it("takes the ticket out of the pool", () => {
    const queue = makeQueue();
    queue.add(ticket({ ticketId: "a", rating: 1500 }));
    queue.add(ticket({ ticketId: "b", rating: 1500 }));
    expect(queue.remove("a")?.ticketId).toBe("a");
    expect(queue.pair(T0)).toEqual([]);
    expect(queue.size).toBe(1);
  });

  it("is harmless for a ticket that is not there", () => {
    expect(makeQueue().remove("ghost")).toBeUndefined();
  });
});
