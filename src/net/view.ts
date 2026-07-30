/**
 * Turning authoritative state into what one seat is allowed to hold, and
 * fingerprinting it.
 *
 * Both functions were born in `localTransport.ts`, which was the right home
 * while the only thing that needed them was the offline transport. It stopped
 * being the right home the moment the server needed them too: `localTransport`
 * imports `../game/localMatch`, which is client code, and a Workers bundle that
 * pulled that in would be dragging the AI and the match driver into a room whose
 * job is to be the authority over both.
 *
 * They live here so there is exactly one implementation. That matters more than
 * the tidiness: `viewHash` is a **comparison between two machines** (§11.5), and
 * a second copy of a hash function is not a duplicate — it is a slow-motion
 * divergence bug that reports itself as cheating.
 */

import type { PlayerView } from "../engine/types";

/**
 * FNV-1a over a canonicalized subset of the seat's view (§4.6).
 *
 * The same technique as the engine's `stateHash()`, deliberately: this is the
 * client-side half of the same divergence check. It hashes what the *seat can
 * see* — its own side in full, the opponent's public zones and counts — because
 * hashing anything else would compare two things a real client and a real
 * server do not both possess.
 */
export function viewHash(view: PlayerView): string {
  const canonical = {
    seat: view.seat,
    turn: view.turn,
    activeSeat: view.activeSeat,
    phase: view.phase,
    winner: view.winner,
    you: {
      health: view.you.leaderHealth,
      armor: view.you.armor,
      hype: `${view.you.hype}/${view.you.hypeMax}`,
      obsession: view.you.obsession,
      hand: view.you.hand.map((c) => `${c.cardId}:${c.costDelta}`),
      deckCount: view.you.deck.length,
      board: view.you.board.map(describeCharacter),
      discard: view.you.discard.map((c) => c.cardId),
      resonance: view.you.resonanceProgress,
    },
    opponent: {
      health: view.opponent.leaderHealth,
      armor: view.opponent.armor,
      hype: `${view.opponent.hype}/${view.opponent.hypeMax}`,
      obsession: view.opponent.obsession,
      handCount: view.opponent.handCount,
      deckCount: view.opponent.deckCount,
      board: view.opponent.board.map(describeCharacter),
      discard: view.opponent.discard.map((c) => c.cardId),
      resonance: view.opponent.resonanceProgress,
    },
  };

  const json = JSON.stringify(canonical);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function describeCharacter(
  c: { cardId: string; attack: number; health: number; keywords: readonly string[] } | null
): string {
  if (!c) return "-";
  return `${c.cardId}/${c.attack}/${c.health}/${[...c.keywords].sort().join("+")}`;
}

/**
 * The placeholder a hidden deck entry becomes on the wire (§5.2).
 *
 * `PlayerView.you` is the full `PlayerState`, which includes `deck` in exact
 * order. That is correct when the local process is the authority and a leak the
 * moment it is not: a seat may not read its own next draw.
 */
export const HIDDEN_CARD_ID = "hidden";

/**
 * Replace the seat's own deck with count-preserving placeholders.
 *
 * Only `.length` is read anywhere in the battle UI — the HUD's deck chip and
 * the mirror's spoken line — so nothing visible changes. That is the point: if
 * something *had* been reading deck identities, this is where it would start
 * failing.
 *
 * Not a mutation. `redact()` returns `you` as a live reference into the match
 * state, so building a new object here is what keeps this from quietly emptying
 * the real deck.
 */
export function sanitizeView(view: PlayerView): PlayerView {
  return {
    ...view,
    you: {
      ...view.you,
      deck: view.you.deck.map((instance) => ({
        instanceId: instance.instanceId,
        cardId: HIDDEN_CARD_ID,
        costDelta: 0,
        addedKeywords: [],
        removedKeywords: [],
      })),
    },
  };
}
