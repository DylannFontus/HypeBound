/**
 * The casual queue — multiplayer §9, with the parts that describe a data centre
 * left out rather than faked.
 *
 * Pure, for the same reason `Room` is: the pairing loop is where the judgement
 * lives, and judgement is worth testing. Time is an argument, ids come from an
 * injected counter, and `pair()` returns pairings instead of creating rooms.
 *
 * ## What §9 asks for that this does not do, and why
 *
 * §9.4's score has a `latencyPenalty(rttEstimate)` term and §9.3's schedule
 * relaxes by region — "same region only", then "adjacent region if RTT <
 * 120 ms". Both assume the server chose where the match runs. On Cloudflare it
 * did not: a Durable Object lives near whoever created it and every player
 * reaches the edge nearest them regardless. There is no region to widen to and
 * no RTT estimate to score with, so those terms are **absent**, not zeroed —
 * a zeroed term reads like a value that happens to be small, and this is a
 * dimension that does not exist here.
 *
 * §9.1 also lists six other queues. Only `casual` is built, because §15 puts a
 * public casual queue first and because a queue with no players in it is the
 * one thing more embarrassing than no queue at all.
 *
 * ## The honest offer is not a polish item
 *
 * §9.3's last row: at 240 s, casual "offers *Play the AI instead* (never a fake
 * human)". At this game's population that is not an edge case — it is the
 * expected outcome of most queue attempts, and it is built here from the first
 * commit rather than added once someone notices the queue is a waiting room.
 */

/** Everything §9.2's ticket carries that means something in this topology. */
export interface Ticket {
  readonly ticketId: string;
  readonly accountId: string;
  readonly queueId: "casual";
  readonly rating: number;
  /** Glicko-2 deviation. Widens the band, so new and returning players find games. */
  readonly rd: number;
  readonly enqueuedAtMs: number;
  /** §14.5: never widened. Two machines simulating different code is not a match. */
  readonly build: string;
  readonly contentHash: string;
  readonly deckHash: string;
  readonly leaderCardId: string;
  /** Last few opponents, for the rematch damping that is also §11.3's first line against win-trading. */
  readonly recentOpponents: readonly string[];
  readonly flags: { readonly newPlayer: boolean; readonly riskFlagged: boolean };
}

export interface Pairing {
  readonly matchId: string;
  readonly seats: readonly [Ticket, Ticket];
  readonly score: number;
}

export const QUEUE_TUNING = {
  /** §9.3's published baseline (game-modes §7.3). */
  bandStart: 150,
  bandMax: 400,
  /** Uncertainty widening, applied at **all** times — see the note in `effectiveBand`. */
  rdFactor: 1.5,
  rdCap: 200,
  /** §16's `mm.rematchPenalty`, and how long casual applies it for. */
  rematchPenalty: 120,
  casualRematchForgivenAfterMs: 60_000,
  smurfPenalty: 300,
  /** §16's `mm.aiOfferAfterSeconds`. */
  aiOfferAfterMs: 240_000,
  /** Beyond this, casual pairs anyone left. §9.3: "unbounded within tier". */
  unboundedAfterMs: 240_000,
} as const;

/**
 * How far apart two ratings may be, for a ticket that has waited this long.
 *
 * §9.3's table and the bullet under it disagree, and the bullet wins. The table
 * adds `min(200, 1.5 × RD)` only in the 150–240 s row; the bullet says "the
 * effective band is `band + min(200, 1.5 × RD)` **at all times**, so freshly
 * placed and returning players (high RD) find games quickly". The bullet states
 * a purpose, the table states a number, and a high-RD player who has to wait
 * 150 seconds before their uncertainty is taken into account is not finding
 * games quickly. Recorded as C19.
 */
export function effectiveBand(waitedMs: number, rd: number): number {
  const uncertainty = Math.min(QUEUE_TUNING.rdCap, QUEUE_TUNING.rdFactor * rd);
  if (waitedMs >= QUEUE_TUNING.unboundedAfterMs) return Number.POSITIVE_INFINITY;

  const seconds = waitedMs / 1000;
  let base: number;
  if (seconds <= 15) base = QUEUE_TUNING.bandStart;
  else if (seconds <= 45) base = QUEUE_TUNING.bandStart + (seconds - 15) * (100 / 30);
  else if (seconds <= 90) base = 250 + (seconds - 45) * (150 / 45);
  else base = QUEUE_TUNING.bandMax;

  return base + uncertainty;
}

export interface QueueOptions {
  /** Produces match ids. Injected so pairing is reproducible in a test. */
  readonly mintMatchId: (index: number) => string;
}

export class Queue {
  private readonly tickets = new Map<string, Ticket>();
  private readonly offered = new Set<string>();
  private paired = 0;

  constructor(private readonly options: QueueOptions) {}

  get size(): number {
    return this.tickets.size;
  }

  all(): Ticket[] {
    return [...this.tickets.values()];
  }

  get(ticketId: string): Ticket | undefined {
    return this.tickets.get(ticketId);
  }

  /**
   * Join the queue.
   *
   * One ticket per account: a second `enqueue` replaces the first rather than
   * doubling the account's chances and, worse, making it possible to be paired
   * with yourself.
   */
  add(ticket: Ticket): void {
    for (const [id, existing] of this.tickets) {
      if (existing.accountId === ticket.accountId) this.tickets.delete(id);
    }
    this.tickets.set(ticket.ticketId, ticket);
  }

  remove(ticketId: string): Ticket | undefined {
    const ticket = this.tickets.get(ticketId);
    this.tickets.delete(ticketId);
    this.offered.delete(ticketId);
    return ticket;
  }

  /** Tickets that have waited long enough to be offered the AI, each returned once. */
  offerAi(nowMs: number): Ticket[] {
    const out: Ticket[] = [];
    for (const ticket of this.tickets.values()) {
      if (this.offered.has(ticket.ticketId)) continue;
      if (nowMs - ticket.enqueuedAtMs < QUEUE_TUNING.aiOfferAfterMs) continue;
      this.offered.add(ticket.ticketId);
      out.push(ticket);
    }
    return out;
  }

  /**
   * One pass of §9.4's loop. Committed tickets leave the pool.
   *
   * Oldest first, which is what stops a steady trickle of new arrivals from
   * starving whoever has been waiting longest — together with the wait bonus in
   * the score, ageing is the anti-starvation mechanism and both halves matter.
   */
  pair(nowMs: number): Pairing[] {
    const pairings: Pairing[] = [];
    const remaining = [...this.tickets.values()].sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs);
    const taken = new Set<string>();

    for (const ticket of remaining) {
      if (taken.has(ticket.ticketId)) continue;

      let best: { candidate: Ticket; score: number } | null = null;
      for (const candidate of remaining) {
        if (candidate.ticketId === ticket.ticketId || taken.has(candidate.ticketId)) continue;
        if (!compatible(ticket, candidate)) continue;
        if (!withinBand(ticket, candidate, nowMs)) continue;

        const score = pairScore(ticket, candidate, nowMs);
        if (!best || score > best.score) best = { candidate, score };
      }
      if (!best) continue;

      taken.add(ticket.ticketId);
      taken.add(best.candidate.ticketId);
      pairings.push({
        matchId: this.options.mintMatchId(this.paired++),
        seats: [ticket, best.candidate],
        score: best.score,
      });
    }

    for (const pairing of pairings) {
      for (const seat of pairing.seats) this.remove(seat.ticketId);
    }
    return pairings;
  }
}

/**
 * The things that are never relaxed, at any wait, for any rating.
 *
 * §9.3: "Never widened, ever: `build` and `contentHash` must match exactly
 * (§14.5); queue id must match." Determinism across two machines means nothing
 * for two different builds, and a mismatch here does not produce a bad match —
 * it produces two players watching different games.
 */
function compatible(a: Ticket, b: Ticket): boolean {
  if (a.accountId === b.accountId) return false;
  if (a.queueId !== b.queueId) return false;
  if (a.build !== b.build) return false;
  if (a.contentHash !== b.contentHash) return false;
  return true;
}

/** Both sides must accept the gap: the one who waited less has the tighter band. */
function withinBand(a: Ticket, b: Ticket, nowMs: number): boolean {
  const gap = Math.abs(a.rating - b.rating);
  return gap <= effectiveBand(nowMs - a.enqueuedAtMs, a.rd) && gap <= effectiveBand(nowMs - b.enqueuedAtMs, b.rd);
}

/**
 * §9.4's score, minus the two terms this topology has no input for.
 *
 * `latencyPenalty` and the region relaxations are absent — see the file header.
 */
export function pairScore(a: Ticket, b: Ticket, nowMs: number): number {
  const waitedA = nowMs - a.enqueuedAtMs;
  const waitedB = nowMs - b.enqueuedAtMs;

  let score = 1000 - Math.abs(a.rating - b.rating);

  // Casual forgives a rematch once someone has waited a minute, because in a
  // small population the alternative to a rematch is no match.
  const rematch = a.recentOpponents.includes(b.accountId) || b.recentOpponents.includes(a.accountId);
  if (rematch && Math.min(waitedA, waitedB) < QUEUE_TUNING.casualRematchForgivenAfterMs) {
    score -= QUEUE_TUNING.rematchPenalty;
  }

  // game-modes §7.8: a flagged account is preferentially paired with another
  // flagged account, which is a penalty on the *mixed* pairing, not on either
  // account. Two flagged players are a fine match for each other.
  if (a.flags.riskFlagged !== b.flags.riskFlagged) score -= QUEUE_TUNING.smurfPenalty;

  score += Math.min(240, Math.max(waitedA, waitedB) / 1000) * 2;
  return score;
}
