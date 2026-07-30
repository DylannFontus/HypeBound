/**
 * Replays. A MatchRecord is just { config, intents[] } — re-applying the same
 * intents to a fresh match must reproduce the identical final state, which is
 * also how the future server verifies clients.
 */

import type { ApplyResult, ContentIndex, EngineEvent, MatchRecord, MatchState, PlayerIntent } from "./types";
import { createMatch, SCHEMA_VERSION } from "./state";
import { resolveMatchContent } from "./content";
import { applyIntent, beginScriptedMatch } from "./reducer";

export function startRecord(state: MatchState): MatchRecord {
  return { schemaVersion: SCHEMA_VERSION, config: structuredClone(state.config), intents: [] };
}

export function recordIntent(record: MatchRecord, intent: PlayerIntent): void {
  record.intents.push(structuredClone(intent));
}

export interface ReplayResult {
  state: MatchState;
  events: EngineEvent[];
  /** intents that threw (index + message); an empty list means a clean replay */
  errors: { index: number; message: string }[];
}

/** Re-simulate a record from scratch. */
export function replay(record: MatchRecord, baseContent: ContentIndex): ReplayResult {
  // A boss or weekly-modifier match was played under a bent rulebook; replaying
  // it under the default one would diverge on the first intent that touches a
  // changed number. The overrides live in config precisely so this works.
  const content = resolveMatchContent(
    baseContent,
    record.config.balanceOverrides,
    record.config.cardOverrides,
    record.config.cardVariants
  );
  let state = createMatch(record.config, content);
  const events: EngineEvent[] = [];
  const errors: { index: number; message: string }[] = [];

  // A scripted encounter that skipped its mulligan never recorded one, so the
  // replay has to open the same way the live match did or every following
  // intent lands in the wrong phase.
  if (record.config.scenario?.mulligan === "none") {
    events.push(...beginScriptedMatch(state, content));
  }

  record.intents.forEach((intent, index) => {
    try {
      const result: ApplyResult = applyIntent(state, content, intent);
      state = result.state;
      events.push(...result.events);
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  });

  return { state, events, errors };
}

/**
 * A stable fingerprint of match state, used by determinism tests and by the
 * future server to compare its simulation against a client's.
 */
export function stateHash(state: MatchState): string {
  const canonical = {
    turn: state.turn,
    turnOfSeat: state.turnOfSeat,
    activeSeat: state.activeSeat,
    phase: state.phase,
    winner: state.winner,
    rng: state.rngState,
    nextInstanceId: state.nextInstanceId,
    // included because it decides what happens NEXT: two states with identical
    // boards but different wave progress are not the same match
    wavesLanded: state.wavesLanded,
    players: state.players.map((player) => ({
      leader: player.leaderCardId,
      health: player.leaderHealth,
      armor: player.armor,
      hype: player.hype,
      hypeMax: player.hypeMax,
      locked: player.hypeLockedNextTurn,
      obsession: player.obsession,
      deck: player.deck.map((c) => c.cardId),
      hand: player.hand.map((c) => `${c.cardId}:${c.costDelta}`),
      discard: player.discard.map((c) => c.cardId),
      board: player.board.map((c) =>
        c
          ? `${c.cardId}/${c.attack}/${c.health}/${c.current}/${[...c.keywords].sort().join("+")}/${c.statuses.map((s) => `${s.id}${s.amount ?? ""}`).sort().join(",")}`
          : "-"
      ),
      location: player.location ? `${player.location.cardId}:${player.location.durability}` : "-",
      event: player.activeEvent ? `${player.activeEvent.cardId}:${player.activeEvent.remainingTurns}` : "-",
      reactions: player.reactions.map((r) => r.cardId).sort(),
      fatigue: player.fatigueCounter,
      resonance: `${player.resonanceProgress}/${player.resonanceActivated}`,
    })),
    delayed: state.delayed.map((d) => `${d.label}@${d.triggersOnTurn}`).sort(),
    comebacks: state.comebacks.map((c) => `${c.cardId}@${c.returnsOnTurn}`).sort(),
  };

  const json = JSON.stringify(canonical);
  // FNV-1a 32-bit — small, dependency-free, adequate for test fingerprints
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
