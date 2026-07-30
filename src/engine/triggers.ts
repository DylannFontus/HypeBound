/**
 * Trigger collection and ordering.
 *
 * Canonical order (docs/design/00-core-rules.md §5.5): the ACTIVE player's
 * triggers resolve first, then the opponent's. Within a player: board
 * characters left to right (with their equipment), then location, then active
 * event, then the leader's passive. This module is pure — it only decides
 * *what* would trigger and in *what order*; effects.ts executes.
 */

import type {
  CharacterInstance,
  ContentIndex,
  EffectDef,
  LeaderCardDef,
  MatchState,
  PlayerState,
  Seat,
  TriggerId,
} from "./types";
import { hasStatus } from "./statuses";

export interface TriggerSource {
  /** the character the effect belongs to, if any (null for location/event/leader) */
  character: CharacterInstance | null;
  cardId: string;
  controller: Seat;
  effect: EffectDef;
  /** stable ordering key for deterministic resolution */
  order: number;
}

function pushEffects(
  out: TriggerSource[],
  content: ContentIndex,
  cardId: string,
  controller: Seat,
  character: CharacterInstance | null,
  trigger: TriggerId,
  orderBase: number
): void {
  const card = content.cards[cardId];
  if (!card) return;
  card.effects.forEach((effect, index) => {
    if (effect.trigger !== trigger) return;
    out.push({ character, cardId, controller, effect, order: orderBase + index });
  });
}

/**
 * Every effect in play that listens for `trigger`, in canonical order.
 * Cancelled characters contribute nothing (their text is blank).
 */
export function collectTriggers(state: MatchState, content: ContentIndex, trigger: TriggerId): TriggerSource[] {
  const out: TriggerSource[] = [];
  const seats: Seat[] = state.activeSeat === 0 ? [0, 1] : [1, 0];

  seats.forEach((seat, seatIndex) => {
    const player: PlayerState = state.players[seat];
    const seatBase = seatIndex * 100000;

    player.board.forEach((character, slot) => {
      if (!character) return;
      if (hasStatus(character, "cancelled")) return;
      const slotBase = seatBase + slot * 100;
      pushEffects(out, content, character.cardId, seat, character, trigger, slotBase);
      if (character.equipment) {
        pushEffects(out, content, character.equipment.cardId, seat, character, trigger, slotBase + 50);
      }
    });

    if (player.location) {
      pushEffects(out, content, player.location.cardId, seat, null, trigger, seatBase + 900);
    }
    if (player.activeEvent) {
      pushEffects(out, content, player.activeEvent.cardId, seat, null, trigger, seatBase + 950);
    }

    const leader = content.leaders[player.leaderCardId] as LeaderCardDef | undefined;
    if (leader) {
      leader.passive.forEach((effect, index) => {
        if (effect.trigger !== trigger) return;
        out.push({ character: null, cardId: leader.id, controller: seat, effect, order: seatBase + 990 + index });
      });
    }
  });

  return out.sort((a, b) => a.order - b.order);
}

/**
 * Aura sources currently in play. Auras are recomputed on read rather than
 * applied as mutations, so Eclipse can suspend them cleanly.
 */
export function collectAuras(state: MatchState, content: ContentIndex): TriggerSource[] {
  if (state.aurasDisabledUntilTurn > state.globalTurnCounter) return [];
  return collectTriggers(state, content, "aura");
}
