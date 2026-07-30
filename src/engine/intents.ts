/**
 * Intent legality: cost computation, playability checks, legal-target queries,
 * and full legal-intent enumeration (used by the AI and by the UI to grey out
 * illegal actions before the player can attempt them).
 */

import type {
  CardDef,
  CardInstance,
  CharacterInstance,
  ContentIndex,
  EffectDef,
  LeaderCardDef,
  MatchState,
  PlayerIntent,
  PlayerState,
  RulesErrorShape,
  Seat,
  TargetRef,
  TargetSpec,
} from "./types";
import { boardOf, findCharacter, firstEmptySlot, otherSeat } from "./state";
import { canAttack, legalAttackTargets } from "./combat";
import { availableConfluences } from "./currents";
import { legalChooseTargets, makeContext, resolveTargets } from "./effects";
import { hasStatus } from "./statuses";

export class RulesError extends Error implements RulesErrorShape {
  constructor(public readonly code: RulesErrorShape["code"], message: string) {
    super(message);
    this.name = "RulesError";
  }
}

/**
 * A card's current Hype cost: base cost, plus per-instance modifiers, minus
 * the Trending discount (1 per other card played this turn). Never below 0,
 * and Trending never takes a card below 1 (canon keyword text).
 */
export function effectiveCost(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  instance: CardInstance
): number {
  const card = content.cards[instance.cardId];
  if (!card) return 0;

  let cost = card.cost + instance.costDelta;

  const keywords = [...card.keywords, ...instance.addedKeywords].filter((k) => !instance.removedKeywords.includes(k));
  if (keywords.includes("trending")) {
    const discount = state.players[seat].cardsPlayedThisTurn;
    cost = Math.max(1, cost - discount);
  }

  return Math.max(0, cost);
}

/** Available Hype for a seat (current pool already includes temporary Hype). */
export const availableHype = (player: PlayerState): number => player.hype;

/** Does this card require the player to pick targets before it can be played? */
export function cardTargetSpecs(card: CardDef): TargetSpec[] {
  const specs: TargetSpec[] = [];
  for (const effect of card.effects) {
    if (effect.trigger !== "onPlay") continue;
    if (effect.target && effect.target.select === "choose") specs.push(effect.target);
  }
  return specs;
}

/** How many chooseOne branches the player must answer for this card. */
export function cardChoiceCount(card: CardDef): number {
  let count = 0;
  const walk = (ops: unknown[]): void => {
    for (const raw of ops) {
      const op = raw as Record<string, unknown>;
      if (op["op"] === "chooseOne") count += 1;
      for (const key of ["ops", "then", "else"]) {
        if (Array.isArray(op[key])) walk(op[key] as unknown[]);
      }
      if (Array.isArray(op["options"])) {
        for (const option of op["options"] as { ops?: unknown[] }[]) {
          if (Array.isArray(option.ops)) walk(option.ops);
        }
      }
    }
  };
  for (const effect of card.effects) {
    if (effect.trigger === "onPlay") walk(effect.ops);
  }
  return count;
}

export interface Playability {
  ok: boolean;
  reason?: RulesErrorShape["code"];
  cost: number;
  /** target specs the player must satisfy, with their legal options */
  targetSpecs: { spec: TargetSpec; legal: TargetRef[] }[];
  needsSlot: boolean;
  choiceCount: number;
  needsRefractChoice: boolean;
}

/** Everything the UI needs to know about playing one card from hand. */
export function checkPlayable(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  instanceId: string
): Playability {
  const player = state.players[seat];
  const instance = player.hand.find((c) => c.instanceId === instanceId);
  const empty: Playability = { ok: false, cost: 0, targetSpecs: [], needsSlot: false, choiceCount: 0, needsRefractChoice: false };

  if (!instance) return { ...empty, reason: "unknownInstance" };
  const card = content.cards[instance.cardId];
  if (!card) return { ...empty, reason: "unknownInstance" };

  const cost = effectiveCost(state, content, seat, instance);
  const targetSpecs = cardTargetSpecs(card).map((spec) => ({
    spec,
    legal: legalChooseTargets(state, content, seat, spec),
  }));
  const needsSlot = card.type === "character";
  const choiceCount = cardChoiceCount(card);
  const needsRefractChoice = card.keywords.includes("refract");

  const base: Playability = { ok: true, cost, targetSpecs, needsSlot, choiceCount, needsRefractChoice };

  if (state.phase !== "main") return { ...base, ok: false, reason: "wrongPhase" };
  if (state.activeSeat !== seat) return { ...base, ok: false, reason: "notYourTurn" };
  if (cost > availableHype(player)) return { ...base, ok: false, reason: "notEnoughHype" };
  if (needsSlot && firstEmptySlot(player) < 0) return { ...base, ok: false, reason: "boardFull" };
  if (card.type === "reaction" && player.reactions.length >= content.balance.board.maxSetReactions) {
    return { ...base, ok: false, reason: "reactionLimit" };
  }
  if (card.type === "equipment") {
    if (boardOf(state, seat).length === 0) return { ...base, ok: false, reason: "invalidTarget" };
  }
  // a card whose mandatory choose-target has no legal options cannot be played
  for (const entry of targetSpecs) {
    if (!entry.spec.optional && entry.legal.length === 0) return { ...base, ok: false, reason: "invalidTarget" };
  }

  return base;
}

/** Equipment needs a friendly character to attach to. */
export function legalEquipTargets(state: MatchState, seat: Seat): TargetRef[] {
  return boardOf(state, seat).map((c) => ({ kind: "character" as const, instanceId: c.instanceId }));
}

/** Legal targets for a leader ability. */
export function legalFixationTargets(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  kind: "fixation" | "ultimate"
): TargetRef[] {
  const leader = content.leaders[state.players[seat].leaderCardId] as LeaderCardDef | undefined;
  if (!leader) return [];
  const ability = kind === "fixation" ? leader.fixation : leader.ultimate;
  if (!ability.target) return [];
  return legalChooseTargets(state, content, seat, ability.target);
}

export function canUseFixation(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  kind: "fixation" | "ultimate"
): boolean {
  if (state.phase !== "main" || state.activeSeat !== seat) return false;
  const player = state.players[seat];
  const leader = content.leaders[player.leaderCardId] as LeaderCardDef | undefined;
  if (!leader) return false;

  const balance = content.balance.obsession;
  if (kind === "fixation") {
    if (player.fixationUsedThisTurn) return false;
    return player.obsession >= leader.fixation.obsessionCost;
  }
  if (player.ultimateUsed) return false;
  // Full Fixation: at max Obsession the Ultimate costs nothing this turn
  if (player.obsession >= balance.max) return true;
  return player.obsession >= leader.ultimate.obsessionCost;
}

/** Locations with an activated ability that has not been used this turn. */
export function canActivateLocation(state: MatchState, content: ContentIndex, seat: Seat): boolean {
  const player = state.players[seat];
  if (state.phase !== "main" || state.activeSeat !== seat) return false;
  if (!player.location) return false;
  if (player.location.usedThisTurn) return false;
  if (player.location.durability !== null && player.location.durability <= 0) return false;
  const card = content.cards[player.location.cardId];
  return card?.effects.some((e: EffectDef) => e.trigger === "activate") ?? false;
}

// ---------------------------------------------------------------------------
// Legal-intent enumeration (AI + UI affordances)
// ---------------------------------------------------------------------------

/**
 * Every legal intent for a seat right now. Cards needing player choices are
 * expanded into one intent per legal target/branch combination, capped so a
 * wide board cannot blow up the AI's search space.
 */
export function enumerateLegalIntents(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  options: { maxPerCard?: number } = {}
): PlayerIntent[] {
  const out: PlayerIntent[] = [];
  if (state.phase !== "main" || state.activeSeat !== seat || state.winner !== null) return out;

  const player = state.players[seat];
  const maxPerCard = options.maxPerCard ?? 8;

  // --- play cards -----------------------------------------------------------
  for (const instance of player.hand) {
    const playable = checkPlayable(state, content, seat, instance.instanceId);
    if (!playable.ok) continue;
    const card = content.cards[instance.cardId];
    if (!card) continue;

    const slots = playable.needsSlot ? [firstEmptySlot(player)] : [undefined];
    const equipTargets = card.type === "equipment" ? legalEquipTargets(state, seat) : [];

    // build the target combinations (single choose-spec cards are the norm)
    let targetCombos: TargetRef[][] = [[]];
    if (card.type === "equipment") {
      targetCombos = equipTargets.slice(0, maxPerCard).map((t) => [t]);
    } else if (playable.targetSpecs.length > 0) {
      const first = playable.targetSpecs[0];
      if (first) {
        const legal = first.legal.slice(0, maxPerCard);
        targetCombos = legal.length > 0 ? legal.map((t) => [t]) : first.spec.optional ? [[]] : [];
      }
    }

    const choiceCombos: number[][] =
      playable.choiceCount > 0 ? [[0], [1]] : [[]];

    for (const slot of slots) {
      for (const targets of targetCombos) {
        for (const choices of choiceCombos) {
          out.push({
            type: "playCard",
            seat,
            instanceId: instance.instanceId,
            ...(slot !== undefined && slot >= 0 ? { slot } : {}),
            ...(targets.length > 0 ? { targets } : {}),
            ...(choices.length > 0 ? { choices } : {}),
            ...(playable.needsRefractChoice ? { refractChoice: player.pureCurrent ?? "prism" } : {}),
          });
        }
      }
    }
  }

  // --- attacks --------------------------------------------------------------
  for (const attacker of boardOf(state, seat)) {
    if (!canAttack(state, content, attacker)) continue;
    for (const target of legalAttackTargets(state, seat)) {
      out.push({ type: "attack", seat, attackerInstanceId: attacker.instanceId, target });
    }
  }

  // --- leader abilities -----------------------------------------------------
  for (const kind of ["fixation", "ultimate"] as const) {
    if (!canUseFixation(state, content, seat, kind)) continue;
    const targets = legalFixationTargets(state, content, seat, kind);
    if (targets.length === 0) out.push({ type: "useFixation", seat, kind });
    else for (const target of targets.slice(0, maxPerCard)) out.push({ type: "useFixation", seat, kind, targets: [target] });
  }

  // --- location -------------------------------------------------------------
  if (canActivateLocation(state, content, seat)) {
    out.push({ type: "activateLocation", seat });
  }

  // --- confluences ----------------------------------------------------------
  for (const entry of availableConfluences(state, content, seat)) {
    if (!entry.available) continue;
    const def = content.confluences[entry.confluence];
    if (!def) continue;
    const targets = def.target ? legalChooseTargets(state, content, seat, def.target) : [];
    const choiceCount = def.choice?.length ?? 0;

    if (choiceCount > 0) {
      for (let choice = 0; choice < choiceCount; choice++) {
        const branchTargets = def.choice?.[choice]?.ops.some((op) => "target" in op && (op as { target?: TargetSpec }).target?.select === "choose")
          ? legalChooseTargets(state, content, seat, { select: "choose", side: choice === 0 ? "enemy" : "friendly", zone: "board" })
          : [];
        if (branchTargets.length === 0) out.push({ type: "activateConfluence", seat, confluence: entry.confluence, choice });
        else for (const target of branchTargets.slice(0, maxPerCard)) {
          out.push({ type: "activateConfluence", seat, confluence: entry.confluence, choice, targets: [target] });
        }
      }
    } else if (targets.length > 0) {
      for (const target of targets.slice(0, maxPerCard)) {
        out.push({ type: "activateConfluence", seat, confluence: entry.confluence, targets: [target] });
      }
    } else if (!def.target) {
      out.push({ type: "activateConfluence", seat, confluence: entry.confluence });
    }
  }

  out.push({ type: "endTurn", seat });
  return out;
}

/** Characters that could be attacked this turn (for UI highlighting). */
export function attackableBy(state: MatchState, content: ContentIndex, seat: Seat): CharacterInstance[] {
  return boardOf(state, seat).filter((c) => canAttack(state, content, c));
}

export { hasStatus, findCharacter, otherSeat, makeContext, resolveTargets };
