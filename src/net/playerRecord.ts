/**
 * Reading your own record back from the server.
 *
 * The counterpart to `server/src/player/record.ts`. There is exactly one route
 * and it takes no parameter naming whose record to fetch — the id comes from
 * the verified token — so there is no request shape that can ask for somebody
 * else's, rather than a check that refuses one.
 */

import { ONLINE, type OnlineConfig } from "../config";
import { accessToken } from "../auth/account";

export interface RecentResult {
  readonly matchId: string;
  readonly outcome: "win" | "loss" | "draw";
  readonly leaderCardId: string;
  readonly opponentLeaderCardId: string;
  readonly turns: number;
  readonly endedAtMs: number;
  readonly reason: "leaderDefeated" | "concede" | "finale" | "draw";
}

export interface PlayerRecordView {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly drawn: number;
  /** Null when nothing has been played — see the note in `record.ts`. */
  readonly winRate: number | null;
  readonly recent: readonly RecentResult[];
}

/**
 * Fetch the record, or null.
 *
 * Null covers signed out, offline, and the server being unreachable, and the
 * caller is expected to say nothing rather than say zero. A record line that
 * reads `0–0` when the request simply failed is a worse lie than an absent one,
 * because it looks like an answer.
 */
export async function fetchMyRecord(config: OnlineConfig = ONLINE): Promise<PlayerRecordView | null> {
  const token = await accessToken(config);
  if (!token) return null;

  try {
    const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/me/record`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as PlayerRecordView;
  } catch {
    return null;
  }
}

/**
 * Erase everything the server holds about this account.
 *
 * Returns false rather than throwing when the server cannot be reached, so the
 * caller can say "nothing was deleted" instead of implying success. A deletion
 * that silently failed is the worst possible outcome for the one action on the
 * page a player might genuinely depend on.
 *
 * Deletes the **record**, not the login. Removing a Supabase user needs the
 * admin API and a service-role key, which this server does not hold and which
 * putting anywhere reachable would undo the reason it does not.
 */
export async function deleteMyServerData(config: OnlineConfig = ONLINE): Promise<boolean> {
  const token = await accessToken(config);
  if (!token) return false;
  try {
    const response = await fetch(`${config.serverUrl.replace(/\/+$/, "")}/me/record`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** "3–1" or "3–1–1", and never a bare zero for someone who has played nothing. */
export function describeRecord(record: PlayerRecordView | null): string | null {
  if (!record || record.played === 0) return null;
  const core = record.drawn > 0 ? `${record.won}–${record.lost}–${record.drawn}` : `${record.won}–${record.lost}`;
  return record.winRate === null ? core : `${core} · ${record.winRate}%`;
}
