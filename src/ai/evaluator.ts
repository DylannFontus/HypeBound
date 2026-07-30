/**
 * Board evaluation for the AI.
 *
 * Scores a match state from one seat's perspective. Positive is good for that
 * seat. Weights are deliberately explicit and tunable — the AI design doc
 * (docs/design/14-ai-design.md) explains what each term is modelling.
 */

import type { AiProfile, ContentIndex, MatchState, Seat } from "../engine/types";
import { boardOf, otherSeat } from "../engine/state";
import { totalAttack } from "../engine/effects";
import { hasStatus } from "../engine/statuses";
import { hasAdvantage } from "../engine/currents";

export interface EvalWeights {
  leaderHealth: number;
  enemyLeaderHealth: number;
  boardAttack: number;
  boardHealth: number;
  characterCount: number;
  cardAdvantage: number;
  hypeEfficiency: number;
  obsession: number;
  obsessionRisk: number;
  currentAdvantage: number;
  spotlight: number;
  shielded: number;
  lethalBonus: number;
}

export const BASE_WEIGHTS: EvalWeights = {
  leaderHealth: 2.4,
  enemyLeaderHealth: 2.8,
  boardAttack: 1.35,
  boardHealth: 0.9,
  characterCount: 0.7,
  cardAdvantage: 1.8,
  hypeEfficiency: 1.1,
  obsession: 0.55,
  obsessionRisk: 1.6,
  currentAdvantage: 0.8,
  spotlight: 0.5,
  shielded: 0.6,
  lethalBonus: 1000,
};

/** Style modifiers layered on top of the base weights. */
export function weightsFor(profile: AiProfile): EvalWeights {
  const w = { ...BASE_WEIGHTS };
  switch (profile.style) {
    case "aggressive":
      w.enemyLeaderHealth *= 1.6;
      w.leaderHealth *= 0.65;
      w.boardAttack *= 1.25;
      w.obsessionRisk *= 0.6;
      break;
    case "defensive":
      w.leaderHealth *= 1.5;
      w.boardHealth *= 1.35;
      w.enemyLeaderHealth *= 0.75;
      w.spotlight *= 1.6;
      break;
    case "combo":
      w.cardAdvantage *= 1.7;
      w.hypeEfficiency *= 1.3;
      w.obsession *= 1.4;
      break;
    default:
      break;
  }
  return w;
}

/**
 * Score `state` for `seat`. Called on simulated states, so it must be cheap
 * and must never mutate anything.
 */
export function evaluate(state: MatchState, content: ContentIndex, seat: Seat, weights: EvalWeights = BASE_WEIGHTS): number {
  const foe = otherSeat(seat);
  const me = state.players[seat];
  const them = state.players[foe];

  if (state.winner === seat) return weights.lethalBonus;
  if (state.winner === foe) return -weights.lethalBonus;
  if (state.winner === "draw") return -weights.lethalBonus * 0.5;

  let score = 0;

  // --- leader health ---------------------------------------------------------
  score += (me.leaderHealth + me.armor) * weights.leaderHealth;
  score -= (them.leaderHealth + them.armor) * weights.enemyLeaderHealth;

  // --- board presence --------------------------------------------------------
  const myBoard = boardOf(state, seat);
  const theirBoard = boardOf(state, foe);

  for (const character of myBoard) {
    score += totalAttack(state, content, character) * weights.boardAttack;
    score += character.health * weights.boardHealth;
    score += weights.characterCount;
    if (character.keywords.includes("spotlight")) score += weights.spotlight;
    if (hasStatus(character, "shielded")) score += weights.shielded;
    if (hasStatus(character, "cancelled")) score -= weights.characterCount * 2;
  }
  for (const character of theirBoard) {
    score -= totalAttack(state, content, character) * weights.boardAttack;
    score -= character.health * weights.boardHealth;
    score -= weights.characterCount;
    if (character.keywords.includes("spotlight")) score -= weights.spotlight;
    if (hasStatus(character, "shielded")) score -= weights.shielded;
  }

  // --- elemental positioning: value having the favourable matchups on board ---
  for (const mine of myBoard) {
    for (const theirs of theirBoard) {
      if (hasAdvantage(content, mine.current, theirs.current)) score += weights.currentAdvantage;
      if (hasAdvantage(content, theirs.current, mine.current)) score -= weights.currentAdvantage;
    }
  }

  // --- resources -------------------------------------------------------------
  score += (me.hand.length - them.hand.length) * weights.cardAdvantage;
  // unspent Hype is wasted tempo
  score -= me.hype * weights.hypeEfficiency;
  // Overload debt costs future tempo
  score -= me.hypeLockedNextTurn * weights.hypeEfficiency * 0.8;

  // --- Obsession: valuable up to the danger zone, then a liability -----------
  const threshold = content.balance.obsession.obsessedThreshold;
  score += Math.min(me.obsession, threshold - 1) * weights.obsession;
  if (me.obsession >= threshold) {
    score -= (me.obsession - threshold + 1) * weights.obsessionRisk;
  }
  if (them.obsession >= threshold) {
    score += (them.obsession - threshold + 1) * weights.obsessionRisk * 0.7;
  }

  // --- Perfect Resonance progress is real value for pure decks ---------------
  if (me.pureCurrent && !me.resonanceActivated) {
    score += me.resonanceProgress * 0.4;
  }

  // --- fatigue looms ---------------------------------------------------------
  if (me.deck.length < 5) score -= (5 - me.deck.length) * 1.2;

  return score;
}

/** Is there a lethal attack sequence available right now? (cheap check) */
export function detectLethal(state: MatchState, content: ContentIndex, seat: Seat): boolean {
  const foe = otherSeat(seat);
  const them = state.players[foe];
  const enemyBoard = boardOf(state, foe);
  // Spotlight blocks face damage
  if (enemyBoard.some((c) => c.keywords.includes("spotlight") && !hasStatus(c, "lurking"))) return false;

  let potential = 0;
  for (const character of boardOf(state, seat)) {
    const summoningSick = character.enteredOnTurn >= state.globalTurnCounter && !character.keywords.includes("raid");
    if (summoningSick || character.attacksUsedThisTurn >= character.maxAttacksPerTurn) continue;
    potential += totalAttack(state, content, character);
  }
  return potential >= them.leaderHealth + them.armor;
}
