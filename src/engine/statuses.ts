/**
 * Status application, queries, expiry, and effective-stat computation.
 * Canon: docs/design/00-core-rules.md §5.4.
 */

import type {
  CharacterInstance,
  ContentIndex,
  MatchState,
  PlayerState,
  StatusId,
  StatusInstance,
} from "./types";
import { equipmentBonus, isCharacter } from "./state";

type Holder = CharacterInstance | PlayerState;

export function statusesOf(holder: Holder): StatusInstance[] {
  return holder.statuses;
}

export function hasStatus(holder: Holder, id: StatusId): boolean {
  return holder.statuses.some((s) => s.id === id);
}

export function statusAmount(holder: Holder, id: StatusId): number {
  return holder.statuses.filter((s) => s.id === id).reduce((sum, s) => sum + (s.amount ?? 0), 0);
}

/**
 * Apply a status. Stacking rules:
 *  - armor / weakened / empowered accumulate their amounts on one instance
 *  - shielded / lurking / warded / scorched / cancelled / cursed are boolean
 *    (re-applying refreshes the longer duration)
 * Armor on a leader goes to PlayerState.armor instead of the status list.
 */
export function applyStatus(
  holder: Holder,
  id: StatusId,
  amount: number | undefined,
  durationTurns: number | undefined,
  sourceCardId: string
): StatusInstance | null {
  if (id === "armor" && !isCharacter(holder)) {
    holder.armor += amount ?? 0;
    return null;
  }

  const remainingTurns = durationTurns ?? null;
  const stacking = id === "armor" || id === "weakened" || id === "empowered";
  const existing = holder.statuses.find((s) => s.id === id);

  if (existing) {
    if (stacking) {
      existing.amount = (existing.amount ?? 0) + (amount ?? 0);
    }
    // keep the longest duration; null (permanent) always wins
    if (existing.remainingTurns !== null) {
      existing.remainingTurns = remainingTurns === null ? null : Math.max(existing.remainingTurns, remainingTurns);
    }
    return existing;
  }

  const instance: StatusInstance = {
    id,
    ...(amount !== undefined ? { amount } : {}),
    remainingTurns,
    sourceCardId,
  };
  holder.statuses.push(instance);
  return instance;
}

/** Remove a specific status, or all statuses of a polarity. Returns removed ids. */
export function removeStatus(
  content: ContentIndex,
  holder: Holder,
  id?: StatusId,
  polarity?: "positive" | "negative"
): StatusId[] {
  const removed: StatusId[] = [];
  holder.statuses = holder.statuses.filter((s) => {
    const matchesId = id !== undefined && s.id === id;
    const matchesPolarity = polarity !== undefined && content.statuses[s.id]?.polarity === polarity;
    if (matchesId || matchesPolarity) {
      removed.push(s.id);
      return false;
    }
    return true;
  });
  return removed;
}

/** Remove exactly one status matching the polarity (Sanctuary-style). */
export function removeOneStatus(
  content: ContentIndex,
  holder: Holder,
  polarity: "positive" | "negative"
): StatusId | null {
  const index = holder.statuses.findIndex((s) => content.statuses[s.id]?.polarity === polarity);
  if (index < 0) return null;
  const [removed] = holder.statuses.splice(index, 1);
  return removed?.id ?? null;
}

/**
 * Consume one point of protection against an incoming hit.
 * Shielded negates the whole instance; Armor absorbs point-for-point.
 * Returns the damage that gets through plus what absorbed it.
 */
export function absorbDamage(
  holder: Holder,
  amount: number,
  ignoresShield: boolean
): { applied: number; shieldConsumed: boolean; armorAbsorbed: number } {
  if (amount <= 0) return { applied: 0, shieldConsumed: false, armorAbsorbed: 0 };

  if (!ignoresShield && hasStatus(holder, "shielded")) {
    holder.statuses = holder.statuses.filter((s) => s.id !== "shielded");
    return { applied: 0, shieldConsumed: true, armorAbsorbed: 0 };
  }

  let remaining = amount;
  let armorAbsorbed = 0;

  if (isCharacter(holder)) {
    const armorStatus = holder.statuses.find((s) => s.id === "armor");
    if (armorStatus && (armorStatus.amount ?? 0) > 0) {
      armorAbsorbed = Math.min(armorStatus.amount ?? 0, remaining);
      armorStatus.amount = (armorStatus.amount ?? 0) - armorAbsorbed;
      remaining -= armorAbsorbed;
      if ((armorStatus.amount ?? 0) <= 0) {
        holder.statuses = holder.statuses.filter((s) => s !== armorStatus);
      }
    }
  } else if (holder.armor > 0) {
    armorAbsorbed = Math.min(holder.armor, remaining);
    holder.armor -= armorAbsorbed;
    remaining -= armorAbsorbed;
  }

  return { applied: remaining, shieldConsumed: false, armorAbsorbed };
}

// ---------------------------------------------------------------------------
// Effective stats
// ---------------------------------------------------------------------------

/** A character's attack after equipment, Empowered, Weakened and Cancelled. */
export function effectiveAttack(content: ContentIndex, character: CharacterInstance): number {
  if (hasStatus(character, "cancelled")) return 0;
  const equip = equipmentBonus(content, character);
  const raw =
    character.attack +
    equip.attack +
    statusAmount(character, "empowered") -
    statusAmount(character, "weakened");
  return Math.max(0, raw);
}

/** A character's max health including equipment. */
export function effectiveMaxHealth(content: ContentIndex, character: CharacterInstance): number {
  return character.maxHealth + equipmentBonus(content, character).health;
}

/** Current health including equipment health grants. */
export function effectiveHealth(content: ContentIndex, character: CharacterInstance): number {
  return character.health + equipmentBonus(content, character).health;
}

/** Can this character be targeted by the given side's cards and abilities? */
export function isTargetable(character: CharacterInstance, byEnemy: boolean): boolean {
  if (!byEnemy) return true;
  return !hasStatus(character, "lurking") && !hasStatus(character, "warded");
}

/** Can this character be attacked by the enemy? (Warded still allows attacks.) */
export function isAttackable(character: CharacterInstance): boolean {
  return !hasStatus(character, "lurking");
}

/**
 * Tick timed statuses at the end of the holder's controller's turn.
 * Returns the statuses that expired so the reducer can emit events.
 */
export function tickStatuses(holder: Holder): StatusId[] {
  const expired: StatusId[] = [];
  holder.statuses = holder.statuses.filter((s) => {
    if (s.remainingTurns === null) return true;
    s.remainingTurns -= 1;
    if (s.remainingTurns <= 0) {
      expired.push(s.id);
      return false;
    }
    return true;
  });
  return expired;
}

/** Lurking drops the moment the character acts. */
export function breakLurking(character: CharacterInstance): boolean {
  if (!hasStatus(character, "lurking")) return false;
  character.statuses = character.statuses.filter((s) => s.id !== "lurking");
  return true;
}

/** Blackflame-style healing lock. */
export function canBeHealed(state: MatchState, holder: Holder): boolean {
  if (!isCharacter(holder)) return true;
  return (holder.healingDisabledUntilTurn ?? -1) < state.globalTurnCounter;
}
