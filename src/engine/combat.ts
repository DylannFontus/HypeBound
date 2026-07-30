/**
 * Attack legality and resolution.
 * Canon: docs/design/00-core-rules.md §5.1-5.3.
 */

import type {
  AttackPreview,
  CharacterInstance,
  ContentIndex,
  MatchState,
  Seat,
  TargetRef,
} from "./types";
import { boardOf, findCharacter, otherSeat, refOf } from "./state";
import { breakLurking, hasStatus, isAttackable } from "./statuses";
import {
  cleanupDefeated,
  dealDamage,
  fireTrigger,
  makeContext,
  totalAttack,
  type EffectContext,
} from "./effects";
import { advantageBonus } from "./currents";

/** Can this character attack at all right now? */
export function canAttack(state: MatchState, content: ContentIndex, character: CharacterInstance): boolean {
  if (character.controller !== state.activeSeat) return false;
  if (state.phase !== "main") return false;
  if (hasStatus(character, "cancelled")) return false;
  if (totalAttack(state, content, character) <= 0) return false;
  if (character.attacksUsedThisTurn >= character.maxAttacksPerTurn) return false;

  const summoningSick = character.enteredOnTurn >= state.globalTurnCounter && !character.keywords.includes("raid");
  return !summoningSick;
}

/**
 * Legal attack targets: enemy characters plus the enemy leader, unless any
 * enemy character has Spotlight — then only Spotlight characters are legal.
 */
export function legalAttackTargets(state: MatchState, seat: Seat): TargetRef[] {
  const foe = otherSeat(seat);
  const enemies = boardOf(state, foe).filter(isAttackable);
  const spotlighted = enemies.filter((c) => c.keywords.includes("spotlight"));

  if (spotlighted.length > 0) return spotlighted.map(refOf);
  return [...enemies.map(refOf), { kind: "leader" as const, seat: foe }];
}

export function isLegalAttackTarget(state: MatchState, seat: Seat, target: TargetRef): boolean {
  return legalAttackTargets(state, seat).some((t) =>
    t.kind === target.kind && (t.kind === "leader" ? t.seat === (target as { seat: Seat }).seat : t.instanceId === (target as { instanceId: string }).instanceId)
  );
}

/**
 * The Current an attack is considered to have (used for the advantage bonus).
 *
 * A leader's Current is read from STATE, not from its card: `rotateLeaderCurrent`
 * moves it during a match, and reading the card def would make every rotation
 * invisible to the only rule that consults it.
 */
function defenderCurrent(state: MatchState, target: TargetRef, content: ContentIndex): string | null {
  if (target.kind === "leader") {
    const player = state.players[target.seat];
    return player.leaderCurrent ?? content.leaders[player.leaderCardId]?.current ?? null;
  }
  return findCharacter(state, target.instanceId)?.current ?? null;
}

/**
 * Preview an attack for the UI: both damage numbers, whether the elemental
 * bonus applies, who dies, and whether it is lethal on the leader.
 */
export function previewAttack(
  state: MatchState,
  content: ContentIndex,
  attacker: CharacterInstance,
  target: TargetRef
): AttackPreview {
  const attackerAttack = totalAttack(state, content, attacker);
  const defCurrent = defenderCurrent(state, target, content);
  const bonus = defCurrent ? advantageBonus(content, attacker.current, defCurrent as never) : 0;

  let attackerDamage = attackerAttack + (attackerAttack > 0 ? bonus : 0);
  let defenderDamage = 0;
  let defenderDies = false;
  let shieldAbsorbs = false;

  if (target.kind === "character") {
    const defender = findCharacter(state, target.instanceId);
    if (!defender) {
      return { attackerDamage: 0, defenderDamage: 0, elementalBonus: false, attackerDies: false, defenderDies: false, lethalOnLeader: false, shieldAbsorbs: false };
    }
    const counterAttack = totalAttack(state, content, defender);
    const counterBonus = counterAttack > 0 ? advantageBonus(content, defender.current, attacker.current) : 0;
    defenderDamage = counterAttack + counterBonus;
    shieldAbsorbs = hasStatus(defender, "shielded");
    if (shieldAbsorbs) attackerDamage = 0;
    defenderDies = !shieldAbsorbs && attackerDamage >= defender.health;
  } else {
    const foe = state.players[target.seat];
    const obsessedPenalty =
      foe.obsession >= content.balance.obsession.obsessedThreshold ? content.balance.obsession.obsessedExtraDamageTaken : 0;
    attackerDamage += attackerDamage > 0 ? obsessedPenalty : 0;
  }

  const attackerShielded = hasStatus(attacker, "shielded");
  const attackerDies = !attackerShielded && defenderDamage >= attacker.health;
  const lethalOnLeader = target.kind === "leader" && attackerDamage >= state.players[target.seat].leaderHealth + state.players[target.seat].armor;

  return {
    attackerDamage,
    defenderDamage,
    elementalBonus: bonus > 0,
    attackerDies,
    defenderDies,
    lethalOnLeader,
    shieldAbsorbs,
  };
}

/**
 * Resolve an attack. Damage is simultaneous: both sides are dealt their damage
 * before deaths are processed, so trades kill both characters.
 */
export function resolveAttack(
  ctx: EffectContext,
  attacker: CharacterInstance,
  target: TargetRef
): void {
  const { state, content } = ctx;

  attacker.attacksUsedThisTurn += 1;
  if (breakLurking(attacker)) {
    ctx.events.push({ e: "statusRemoved", target: refOf(attacker), status: "lurking" });
  }

  ctx.events.push({ e: "attackDeclared", attackerInstanceId: attacker.instanceId, target });

  const attackerCtx = makeContext(state, content, attacker.controller, attacker.cardId, {
    events: ctx.events,
    sourceCharacter: attacker,
    budget: ctx.budget,
    depth: ctx.depth,
  });
  fireTrigger(attackerCtx, "onAttack", [refOf(attacker)], { onlyFor: attacker });

  // the attack may have removed the target
  const stillValid =
    target.kind === "leader" || findCharacter(state, target.instanceId) !== null;
  if (!stillValid) {
    cleanupDefeated(attackerCtx, attacker.cardId);
    return;
  }

  const attackerAttack = totalAttack(state, content, attacker);
  const defenderRef = target;
  const defCurrent = defenderCurrent(state, defenderRef, content);
  const bonus = attackerAttack > 0 && defCurrent ? advantageBonus(content, attacker.current, defCurrent as never) : 0;

  // defender's counter-damage is computed BEFORE the attacker's damage lands
  let counterDamage = 0;
  let counterBonus = 0;
  let defender: CharacterInstance | null = null;
  if (defenderRef.kind === "character") {
    defender = findCharacter(state, defenderRef.instanceId);
    if (defender) {
      counterDamage = totalAttack(state, content, defender);
      counterBonus = counterDamage > 0 ? advantageBonus(content, defender.current, attacker.current) : 0;
    }
  }

  if (attackerAttack > 0) {
    dealDamage(attackerCtx, defenderRef, attackerAttack + bonus, {
      elementalBonus: bonus > 0,
      sourceInstanceId: attacker.instanceId,
    });
  }

  if (defender && counterDamage > 0) {
    const defenderCtx = makeContext(state, content, defender.controller, defender.cardId, {
      events: ctx.events,
      sourceCharacter: defender,
      budget: ctx.budget,
      depth: ctx.depth,
    });
    dealDamage(defenderCtx, refOf(attacker), counterDamage + counterBonus, {
      elementalBonus: counterBonus > 0,
      sourceInstanceId: defender.instanceId,
    });
  }

  cleanupDefeated(attackerCtx, attacker.cardId);
}
