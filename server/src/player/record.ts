/**
 * What the server remembers about one account's matches.
 *
 * Pure, like `Room` and `Queue`, for the same reason: this is the number a
 * future ladder is built on, and arithmetic that decides a rating deserves a
 * test more than it deserves a database.
 *
 * ## Why this is not in Supabase
 *
 * The obvious home for results is the Postgres that already holds the accounts.
 * It is rejected because of what it would cost: this server holds **no**
 * Supabase credential, and writing to that database means giving it a
 * service-role key — a secret that, if it leaked from a Worker config, owns
 * every table including the auth schema. That property has been protected
 * deliberately since the auth path was written, and "we used to have nothing
 * worth stealing" is a bad thing to say in the past tense.
 *
 * The alternative — letting the *client* write its own results — is worse and
 * not a real option: a client that reports its own wins reports wins it did not
 * have, and the whole point of an authoritative server is that it is the one
 * that knows.
 *
 * So results live where the authority already is. The cost, stated rather than
 * discovered: this is a per-account key-value store, not a queryable table, so
 * a global leaderboard cannot be a `SELECT`. That is a real limit and it is the
 * right time to accept it — a leaderboard does not exist, and taking a
 * database credential now for a feature that does not exist is how a system
 * ends up holding things it cannot justify.
 */

export type Outcome = "win" | "loss" | "draw";

export interface MatchResult {
  /** The room's id. Also the idempotency key — see `apply`. */
  readonly matchId: string;
  readonly outcome: Outcome;
  readonly leaderCardId: string;
  readonly opponentLeaderCardId: string;
  readonly turns: number;
  readonly endedAtMs: number;
  /** How the match ended, straight from the engine's own `matchEnded`. */
  readonly reason: "leaderDefeated" | "concede" | "finale" | "draw";
}

export interface PlayerRecordData {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly drawn: number;
  /** Most recent first, bounded. Not a replay archive — see `HISTORY_LIMIT`. */
  readonly recent: readonly MatchResult[];
  /** Match ids already counted, so a retry cannot double-count a win. */
  readonly seen: readonly string[];
}

export const EMPTY_RECORD: PlayerRecordData = { played: 0, won: 0, lost: 0, drawn: 0, recent: [], seen: [] };

/**
 * How many results to keep.
 *
 * Small on purpose. This is a summary, not the match history the player already
 * has on their own device — and unlike that one it can never carry a replay,
 * because the room discards its journal when it dies. Keeping a thousand rows
 * would be keeping a thousand rows of something nobody can watch.
 */
export const HISTORY_LIMIT = 25;

/**
 * The same match twice must not count twice.
 *
 * The room writes a result once, but "once" is a property of a code path, not
 * of a distributed system: a retried write, a rebuilt room, or an alarm firing
 * either side of an eviction can all produce a second attempt. Idempotency by
 * `matchId` is what makes the retry safe, and the retry is what makes the write
 * reliable — you cannot have the second without the first.
 *
 * `seen` is bounded to the same window as `recent`, which is the honest limit:
 * a duplicate arriving after twenty-five further matches would double-count. It
 * cannot, because a room is destroyed long before then, and saying so is better
 * than an unbounded list that grows for ever to guard against nothing.
 */
export function apply(record: PlayerRecordData, result: MatchResult): PlayerRecordData {
  if (record.seen.includes(result.matchId)) return record;

  return {
    played: record.played + 1,
    won: record.won + (result.outcome === "win" ? 1 : 0),
    lost: record.lost + (result.outcome === "loss" ? 1 : 0),
    drawn: record.drawn + (result.outcome === "draw" ? 1 : 0),
    recent: [result, ...record.recent].slice(0, HISTORY_LIMIT),
    seen: [result.matchId, ...record.seen].slice(0, HISTORY_LIMIT),
  };
}

/**
 * Win rate as a percentage, or null when there is nothing to divide by.
 *
 * Null rather than 0, because "no matches" and "no wins" are different facts
 * and a new player shown `0%` has been told something untrue about themselves.
 * Draws stay in the denominator: they are matches that were played.
 */
export function winRate(record: PlayerRecordData): number | null {
  if (record.played === 0) return null;
  return Math.round((record.won / record.played) * 1000) / 10;
}

/** The shape sent to a client asking about itself. `seen` is bookkeeping and stays here. */
export function publicView(record: PlayerRecordData): Omit<PlayerRecordData, "seen"> & { winRate: number | null } {
  return {
    played: record.played,
    won: record.won,
    lost: record.lost,
    drawn: record.drawn,
    recent: record.recent,
    winRate: winRate(record),
  };
}
