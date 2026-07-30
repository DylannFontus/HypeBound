/**
 * The AI opponent.
 *
 * Chooses one intent at a time by simulating every legal intent through the
 * real engine and scoring the result. It never sees hidden information beyond
 * what the engine would give a human at the same seat, and it never mutates
 * the live match state — only clones produced by applyIntent.
 *
 * Difficulty is expressed entirely through the AiProfile: evaluation noise,
 * how reliably it spots lethal, whether it uses Confluences, and how many
 * plies of its own turn it looks ahead.
 */

import type { AiProfile, ContentIndex, MatchState, PlayerIntent, Seat } from "../engine/types";
import { enumerateLegalIntents } from "../engine/intents";
import { applyIntent } from "../engine/reducer";
import { nextInt, seedRng, type RngState } from "../engine/rng";
import { detectLethal, evaluate, weightsFor } from "./evaluator";

export interface AiDecision {
  intent: PlayerIntent;
  score: number;
  consideredCount: number;
}

/**
 * The AI's randomness is DERIVED, never carried.
 *
 * A long-lived stream makes the AI a function of every decision made so far in
 * this process rather than of the match. Re-simulating from the intent log
 * rewinds the engine but not that stream, so a rewound tutorial beat or a Lab
 * undo would get a different reply to an identical prefix. Deriving per
 * decision from values already inside MatchState makes "same prefix implies
 * same move" true by construction, and costs a few dozen integer ops against a
 * decision that deep-clones the whole match many times over.
 *
 * The keys: the match seed separates matches; `intentCount` separates the
 * several decisions made within one turn (the reducer bumps it on every applied
 * intent, so it strictly increases between consecutive asks); `seat` matters
 * because a mirror mulligan asks both seats at the same count; and the profile
 * id keeps the same position at two difficulties from sharing a roll.
 */
export function deriveAiRng(state: MatchState, seat: Seat, profile: AiProfile): RngState {
  let h = (state.config.seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (state.intentCount + 1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (seat + 1), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ hashProfileId(profile.id), 0x27d4eb2f) >>> 0;
  return seedRng(h >>> 0);
}

/** FNV-1a over a profile id; ids are short ASCII. */
function hashProfileId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Gaussian-ish noise from the seeded rng (sum of uniforms, no Math.random). */
function noise(rng: RngState, magnitude: number): number {
  if (magnitude <= 0) return 0;
  const sum = nextInt(rng, 1000) + nextInt(rng, 1000) + nextInt(rng, 1000);
  return ((sum / 3000) * 2 - 1) * magnitude;
}

/**
 * Score one candidate intent by applying it and evaluating the resulting
 * state, optionally recursing to model the rest of this turn.
 */
function scoreIntent(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  intent: PlayerIntent,
  profile: AiProfile,
  depth: number
): number {
  let next: MatchState;
  try {
    next = applyIntent(state, content, intent).state;
  } catch {
    return -Infinity; // illegal in practice; never chosen
  }

  const weights = weightsFor(profile);
  let score = evaluate(next, content, seat, weights);

  // ending the turn early is slightly discouraged so the AI uses its resources
  if (intent.type === "endTurn") score -= 1.5;

  // look ahead through the rest of our own turn
  if (depth > 1 && next.activeSeat === seat && next.winner === null && intent.type !== "endTurn") {
    const follow = enumerateLegalIntents(next, content, seat, { maxPerCard: 4 })
      .filter((i) => i.type !== "endTurn")
      .slice(0, 14);
    let best = score;
    for (const candidate of follow) {
      const value = scoreIntent(next, content, seat, candidate, profile, depth - 1);
      if (value > best) best = value;
    }
    score = best;
  }

  return score;
}

/**
 * Pick the AI's next intent. Returns null only if no legal intent exists
 * (which the driver treats as "end turn").
 */
export function chooseIntent(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  profile: AiProfile
): AiDecision | null {
  const rng = deriveAiRng(state, seat, profile);
  if (state.phase === "mulligan") {
    return { intent: mulliganDecision(state, content, seat, profile, rng), score: 0, consideredCount: 1 };
  }
  if (state.activeSeat !== seat || state.winner !== null) return null;

  let candidates = enumerateLegalIntents(state, content, seat, { maxPerCard: profile.searchDepth > 2 ? 8 : 5 });
  if (candidates.length === 0) return null;

  // Confluence awareness: weaker AIs simply do not see them
  if (nextInt(rng, 1000) / 1000 > profile.confluenceAwareness) {
    const withoutConfluence = candidates.filter((i) => i.type !== "activateConfluence");
    if (withoutConfluence.length > 0) candidates = withoutConfluence;
  }

  // Lethal awareness: when lethal is on the table, weaker AIs may still fumble
  const hasLethal = detectLethal(state, content, seat);
  if (hasLethal && nextInt(rng, 1000) / 1000 <= profile.lethalAwareness) {
    const attacks = candidates.filter((i) => i.type === "attack" && i.target.kind === "leader");
    if (attacks.length > 0) {
      return { intent: attacks[0]!, score: Infinity, consideredCount: candidates.length };
    }
  }

  let bestIntent: PlayerIntent = candidates[candidates.length - 1]!; // endTurn fallback
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const raw = scoreIntent(state, content, seat, candidate, profile, profile.searchDepth);
    if (raw === -Infinity) continue;
    const scored = raw + noise(rng, profile.noise);
    if (scored > bestScore) {
      bestScore = scored;
      bestIntent = candidate;
    }
  }

  return { intent: bestIntent, score: bestScore, consideredCount: candidates.length };
}

/**
 * Mulligan policy: throw back what the deck cannot support this early.
 * Stronger profiles keep a tighter curve; beginners keep almost everything.
 */
function mulliganDecision(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  profile: AiProfile,
  rng: RngState
): PlayerIntent {
  const player = state.players[seat];
  const keepCurve = profile.difficulty === "beginner" ? 6 : profile.difficulty === "casual" ? 5 : 4;

  const replace = player.hand
    .filter((instance) => {
      const card = content.cards[instance.cardId];
      if (!card) return false;
      if (card.id === "token-borrowed-clout") return false;
      if (card.cost > keepCurve) return true;
      // beginners occasionally throw back a fine card
      if (profile.difficulty === "beginner" && nextInt(rng, 100) < 15) return true;
      return false;
    })
    .map((instance) => instance.instanceId);

  return { type: "mulligan", seat, replaceInstanceIds: replace };
}

/**
 * Play out a whole AI turn, returning the intents in order. The driver feeds
 * these to the engine one at a time so the presenter can animate each step.
 */
export function planTurn(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  profile: AiProfile,
  maxActions = 30
): PlayerIntent[] {
  const intents: PlayerIntent[] = [];
  let current = state;

  for (let i = 0; i < maxActions; i++) {
    // each iteration advances `current`, so intentCount rises and the derived
    // stream differs per decision without anything being threaded through
    const decision = chooseIntent(current, content, seat, profile);
    if (!decision) break;
    intents.push(decision.intent);
    try {
      current = applyIntent(current, content, decision.intent).state;
    } catch {
      break;
    }
    if (decision.intent.type === "endTurn" || current.winner !== null) break;
  }

  if (intents.length === 0 || intents[intents.length - 1]?.type !== "endTurn") {
    if (current.winner === null && current.activeSeat === seat && current.phase === "main") {
      intents.push({ type: "endTurn", seat });
    }
  }
  return intents;
}
