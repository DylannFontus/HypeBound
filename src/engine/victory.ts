/**
 * Win / loss / draw evaluation. Called after every intent.
 * Canon: docs/design/00-core-rules.md §2.
 */

import type { EngineEvent, MatchState, Seat } from "./types";

export function checkVictory(state: MatchState, events: EngineEvent[]): void {
  if (state.winner !== null) return;

  const dead: Seat[] = [];
  for (const seat of [0, 1] as Seat[]) {
    if (state.players[seat].leaderHealth <= 0) dead.push(seat);
  }
  if (dead.length === 0) return;

  if (dead.length === 2) {
    state.winner = "draw";
    state.phase = "ended";
    events.push({ e: "matchEnded", winner: "draw", reason: "draw" });
    return;
  }

  const loser = dead[0]!;
  state.winner = loser === 0 ? 1 : 0;
  state.phase = "ended";
  events.push({ e: "matchEnded", winner: state.winner, reason: "leaderDefeated" });
}

/** Convenience for the UI/AI: how close a leader is to defeat, 0..1. */
export function leaderPressure(state: MatchState, seat: Seat): number {
  const player = state.players[seat];
  if (player.leaderMaxHealth <= 0) return 1;
  return 1 - Math.max(0, player.leaderHealth) / player.leaderMaxHealth;
}
