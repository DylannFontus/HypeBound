/**
 * Shared kit for puzzle solution tests.
 *
 * Every puzzle asserts the same two things — the intended line wins, and the
 * plausible wrong line does not — so the machinery for expressing a line lives
 * here and each puzzle stays a short, readable script.
 *
 * The important design decision is that a line is a list of *thunks*, resolved
 * one at a time against the state as it currently is. Building the whole list up
 * front against the opening state looks equivalent and is not: "the first card
 * called X in hand" resolves to the same instance twice, so playing two copies
 * of a card silently addresses one of them and the second play is refused. That
 * bug is invisible in the intent list and obvious in the failure.
 */

import { getContent } from "../src/engine/content";
import { getEncounters } from "../src/engine/encounters";
import { createMatch } from "../src/engine/state";
import { applyIntent, beginScriptedMatch } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import type {
  AiDifficulty,
  CardInstance,
  CharacterInstance,
  ConfluenceId,
  MatchConfig,
  MatchState,
  PlayerIntent,
  Seat,
  TargetRef,
} from "../src/engine/types";

export const content = getContent();
export const puzzles = getEncounters(new Set(Object.keys(content.cards)))["puzzles"]!;

export const stageOf = (stageId: string) => {
  const stage = puzzles.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`no puzzle ${stageId}`);
  return stage;
};

/** Deal a puzzle and open it, exactly as the driver does. */
export function openPuzzle(stageId: string): MatchState {
  const stage = stageOf(stageId);
  const config: MatchConfig = {
    seed: stage.seed,
    decks: [puzzles.decks[stage.decks[0]]!, puzzles.decks[stage.decks[1]]!],
    ...(stage.firstSeat !== undefined ? { firstSeat: stage.firstSeat } : {}),
    ...(stage.scenario ? { scenario: stage.scenario } : {}),
  };
  const state = createMatch(config, content);
  beginScriptedMatch(state, content);
  return state;
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

export const boardOf = (state: MatchState, seat: Seat): CharacterInstance[] =>
  state.players[seat].board.filter((c): c is CharacterInstance => c !== null);

/** The nth character of this card on a seat's board (0-based). */
export function unitAt(state: MatchState, seat: Seat, cardId: string, nth = 0): CharacterInstance {
  const matches = boardOf(state, seat).filter((c) => c.cardId === cardId);
  const found = matches[nth];
  if (!found) throw new Error(`no ${cardId}[${nth}] on seat ${seat} (${matches.length} present)`);
  return found;
}

/** The nth copy of this card in the player's hand (0-based). */
export function handCard(state: MatchState, cardId: string, nth = 0): CardInstance {
  const matches = state.players[0].hand.filter((c) => c.cardId === cardId);
  const found = matches[nth];
  if (!found) throw new Error(`no ${cardId}[${nth}] in hand (${matches.length} present)`);
  return found;
}

// ---------------------------------------------------------------------------
// Writing a line
// ---------------------------------------------------------------------------

/** One move, resolved against the state as it is when its turn comes. */
export type Step = (state: MatchState) => PlayerIntent;

export interface PlayOptions {
  /** which copy in hand, when the puzzle holds more than one */
  nth?: number;
  slot?: number;
  targets?: TargetRef[];
  /** targets named by the card on the board they sit on */
  at?: { seat: Seat; cardId: string; nth?: number }[];
  choices?: number[];
}

export const playCard =
  (cardId: string, options: PlayOptions = {}): Step =>
  (state) => {
    const targets =
      options.targets ??
      (options.at ?? []).map((ref) => ({
        kind: "character" as const,
        instanceId: unitAt(state, ref.seat, ref.cardId, ref.nth).instanceId,
      }));
    const slot = options.slot ?? state.players[0].board.findIndex((c) => c === null);
    return {
      type: "playCard",
      seat: 0,
      instanceId: handCard(state, cardId, options.nth).instanceId,
      ...(slot >= 0 ? { slot } : {}),
      ...(targets.length > 0 ? { targets } : {}),
      ...(options.choices ? { choices: options.choices } : {}),
    };
  };

export const attackLeader =
  (cardId: string, nth = 0): Step =>
  (state) => ({
    type: "attack",
    seat: 0,
    attackerInstanceId: unitAt(state, 0, cardId, nth).instanceId,
    target: { kind: "leader", seat: 1 },
  });

export const attackUnit =
  (cardId: string, enemyCardId: string, nth = 0, enemyNth = 0): Step =>
  (state) => ({
    type: "attack",
    seat: 0,
    attackerInstanceId: unitAt(state, 0, cardId, nth).instanceId,
    target: { kind: "character", instanceId: unitAt(state, 1, enemyCardId, enemyNth).instanceId },
  });

export const fixation =
  (kind: "fixation" | "ultimate", at?: { seat: Seat; cardId: string; nth?: number }): Step =>
  (state) => ({
    type: "useFixation",
    seat: 0,
    kind,
    ...(at ? { targets: [{ kind: "character", instanceId: unitAt(state, at.seat, at.cardId, at.nth).instanceId }] } : {}),
  });

export const confluence =
  (
    id: ConfluenceId,
    options: {
      choice?: number;
      at?: { seat: Seat; cardId: string; nth?: number };
      /** several targets, for the Confluences that sweep (Tempest's first mode) */
      ats?: { seat: Seat; cardId: string; nth?: number }[];
    } = {}
  ): Step =>
  (state) => {
    const refs = [...(options.at ? [options.at] : []), ...(options.ats ?? [])].map((ref) => ({
      kind: "character" as const,
      instanceId: unitAt(state, ref.seat, ref.cardId, ref.nth).instanceId,
    }));
    return {
      type: "activateConfluence",
      seat: 0,
      confluence: id,
      ...(options.choice !== undefined ? { choice: options.choice } : {}),
      ...(refs.length > 0 ? { targets: refs } : {}),
    };
  };

/** Every character of this card id on a seat's board, as target refs. */
export const allOf = (state: MatchState, seat: Seat, cardId: string) =>
  boardOf(state, seat)
    .filter((c) => c.cardId === cardId)
    .map((_, nth) => ({ seat, cardId, nth }));

export const endTurn: Step = (state) => ({ type: "endTurn", seat: state.activeSeat });

/** Run a line, one step at a time. Throws with the step index if one is refused. */
export function walk(state: MatchState, line: Step[]): MatchState {
  let current = state;
  line.forEach((step, index) => {
    try {
      current = applyIntent(current, content, step(current)).state;
    } catch (error) {
      throw new Error(`step ${index + 1} of ${line.length}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return current;
}

/** Run a line, stopping at the first refusal instead of throwing. */
export function tryWalk(state: MatchState, line: Step[]): { state: MatchState; stoppedAt: number | null } {
  let current = state;
  for (const [index, step] of line.entries()) {
    try {
      current = applyIntent(current, content, step(current)).state;
    } catch {
      return { state: current, stoppedAt: index };
    }
  }
  return { state: current, stoppedAt: null };
}

/**
 * End the player's turn and let the opponent take its whole turn.
 *
 * The difficulty comes from the stage rather than being named here: a Survival
 * puzzle is decided by what the enemy does with its turn, which makes "which AI"
 * part of the puzzle's definition rather than a detail of the harness.
 */
export function passToTheEnemy(state: MatchState, stageId: string): MatchState {
  const opponent = stageOf(stageId).opponent;
  const difficulty = (opponent.kind === "ai" ? opponent.difficulty : "beginner") as AiDifficulty;
  let current = applyIntent(state, content, { type: "endTurn", seat: 0 }).state;
  for (let guard = 0; guard < 60 && current.activeSeat === 1 && current.winner === null; guard++) {
    const decision = chooseIntent(current, content, 1, getAiProfile(difficulty));
    if (!decision) break;
    current = applyIntent(current, content, decision.intent).state;
  }
  return current;
}

/** Everything a puzzle's opening board should be checked against. */
export const enemyHealth = (state: MatchState): number => state.players[1].leaderHealth;
export const myHealth = (state: MatchState): number => state.players[0].leaderHealth;
