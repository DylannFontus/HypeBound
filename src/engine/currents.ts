/**
 * Current advantage, Confluence availability, and Perfect Resonance tracking.
 * Rules: docs/design/00-core-rules.md §8.
 */

import type {
  ConfluenceAvailability,
  ConfluenceDef,
  ConfluenceId,
  ContentIndex,
  CurrentId,
  DeckList,
  MatchState,
  PlayerState,
  Seat,
} from "./types";
import { getCard } from "./content";

/**
 * Does `attacker` have elemental advantage over `defender`?
 * Natural cycle from data (each beats exactly one); Halo/Veil is mutual;
 * Prism is neutral until Refract sets its current.
 */
export function hasAdvantage(content: ContentIndex, attacker: CurrentId, defender: CurrentId): boolean {
  const def = content.currents[attacker];
  if (!def) return false;
  return def.beats.includes(defender);
}

/** Extra damage from elemental advantage (canonically 1, from balance.json). */
export function advantageBonus(content: ContentIndex, attacker: CurrentId, defender: CurrentId): number {
  return hasAdvantage(content, attacker, defender) ? content.balance.rules.elementalBonusDamage : 0;
}

/** Full 8x8 matrix for the UI's elemental guide. */
export function advantageMatrix(content: ContentIndex): Record<CurrentId, Record<CurrentId, boolean>> {
  const ids = Object.keys(content.currents) as CurrentId[];
  const matrix = {} as Record<CurrentId, Record<CurrentId, boolean>>;
  for (const a of ids) {
    matrix[a] = {} as Record<CurrentId, boolean>;
    for (const d of ids) matrix[a][d] = hasAdvantage(content, a, d);
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Confluences
// ---------------------------------------------------------------------------

/** The Confluence for a pair of Currents, if one exists. */
export function confluenceFor(content: ContentIndex, a: CurrentId, b: CurrentId): ConfluenceDef | null {
  for (const conf of Object.values(content.confluences)) {
    if (!conf.currents) continue;
    const [x, y] = conf.currents;
    if ((x === a && y === b) || (x === b && y === a)) return conf;
  }
  return null;
}

/**
 * Every Confluence the player could activate right now, annotated with why
 * it is unavailable. The UI shows both Current symbols plus the rules text.
 */
export function availableConfluences(state: MatchState, content: ContentIndex, seat: Seat): ConfluenceAvailability[] {
  const player = state.players[seat];
  const played = player.currentsPlayedThisTurn;
  const out: ConfluenceAvailability[] = [];

  const naturalPairs = new Set<string>();
  for (const a of played) {
    for (const b of played) {
      if (a === b) continue;
      const conf = confluenceFor(content, a, b);
      if (!conf) continue;
      const key = conf.id;
      if (naturalPairs.has(key)) continue;
      naturalPairs.add(key);
      out.push({
        confluence: conf.id,
        currents: conf.currents ?? [a, b],
        available: !player.confluenceUsedThisTurn,
        ...(player.confluenceUsedThisTurn ? { reasonUnavailable: "alreadyUsed" as const } : {}),
      });
    }
  }

  // Refraction: Prism + any other Current played this turn
  if (played.includes("prism")) {
    const partner = played.find((c) => c !== "prism");
    if (partner) {
      out.push({
        confluence: "refraction",
        currents: ["prism", partner],
        available: !player.confluenceUsedThisTurn,
        ...(player.confluenceUsedThisTurn ? { reasonUnavailable: "alreadyUsed" as const } : {}),
      });
    }
  }

  return out;
}

/** Is this specific Confluence legal for the seat right now? */
export function canActivateConfluence(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  id: ConfluenceId
): boolean {
  return availableConfluences(state, content, seat).some((c) => c.confluence === id && c.available);
}

/**
 * For Refraction, which Current partners with Prism this turn.
 * Returns null when Refraction is not currently available.
 */
export function refractionPartner(state: MatchState, seat: Seat): CurrentId | null {
  const played = state.players[seat].currentsPlayedThisTurn;
  if (!played.includes("prism")) return null;
  return played.find((c) => c !== "prism") ?? null;
}

// ---------------------------------------------------------------------------
// Perfect Resonance (pure decks)
// ---------------------------------------------------------------------------

/**
 * A deck is "pure" when every non-token card in it shares one natural Current
 * (no Prism splash, and the Current itself is not Prism).
 * Pure decks unlock Perfect Resonance; dual decks get Confluences instead.
 */
export function deckPureCurrent(content: ContentIndex, deck: DeckList): CurrentId | null {
  let found: CurrentId | null = null;
  for (const cardId of deck.cards) {
    const card = getCard(content, cardId);
    if (card.current === "prism") return null;
    if (found === null) found = card.current;
    else if (found !== card.current) return null;
  }
  return found;
}

/** Advance resonance progress when a card of the pure Current is played. */
export function advanceResonance(player: PlayerState, content: ContentIndex, cardCurrent: CurrentId): "progressed" | "activated" | "none" {
  if (!player.pureCurrent || player.resonanceActivated) return "none";
  if (cardCurrent !== player.pureCurrent) return "none";
  player.resonanceProgress += 1;
  if (player.resonanceProgress >= content.balance.resonance.threshold) {
    player.resonanceActivated = true;
    return "activated";
  }
  return "progressed";
}
