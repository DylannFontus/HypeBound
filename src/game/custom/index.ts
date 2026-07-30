/**
 * The Custom Lobby — `09-game-modes.md` §17.
 *
 * *"A lobby with explicit knobs, all clearly displayed to both seats before
 * start."* Every knob in §17's list is here, and every one of them is either a
 * number the engine already reads out of `balance` or a filter on which cards
 * exist for the match. Nothing new is invented:
 *
 * | §17 knob | How it is expressed |
 * |---|---|
 * | starting health (20–40) | `balanceOverrides["leader.startingHealth"]` |
 * | starting hand sizes | `balanceOverrides["hand.first"]`, `["hand.second"]` |
 * | turn timer (30–120s, or off) | `balanceOverrides["timer.turnSeconds"]` |
 * | any Remix modifier (§12) | `remixMatchConfig`, unchanged |
 * | card / faction ban list | filters the pool a deck is checked against |
 * | deck-size override (20–40) | `balanceOverrides["deck.size"]` |
 * | AI seat fill (any difficulty) | the AI profile the battle already takes |
 * | Hotseat pass-and-play | `opponent: "human"` on the local match driver |
 *
 * ## The anti-farming rule is a rule, not a vibe
 *
 * §17: *"Custom results never touch MMR, missions progress at casual rates only
 * when no modifiers reduce match integrity (flagged combos pay zero to prevent
 * farming)."*
 *
 * "Reduce match integrity" needs a definition or it is decoration, so this
 * module states one: **a setting pays nothing if it makes winning easier than
 * the standard game.** Harder-than-standard is always fine and always pays —
 * nobody farms a game they made harder. That single asymmetry is the whole
 * policy, it is checkable, and `integrityFlags` returns the human-readable list
 * so the lobby can print exactly why a configuration will pay zero *before* the
 * match rather than after it.
 *
 * Hotseat pays nothing regardless, per §17's reward line, and for the obvious
 * reason that both seats are the same account.
 */

import type { AiDifficulty, CardDef, ContentIndex, DeckList, FactionId, MatchConfig } from "../../engine/types";
import { collectibleCards } from "../../engine/content";
import { modifierById, playableModifiers, remixMatchConfig, type RemixModifierDef } from "../remix";

/** Who fills the second seat. */
export type CustomOpponent = "ai" | "hotseat";

export interface CustomSettings {
  opponent: CustomOpponent;
  /** only meaningful when `opponent` is "ai" */
  difficulty: AiDifficulty;
  startingHealth: number;
  handFirst: number;
  handSecond: number;
  /** seconds, or null for "off" — §17 allows a timer-free game */
  turnSeconds: number | null;
  deckSize: number;
  /** a Remix modifier id from §12's catalogue, or null */
  modifierId: string | null;
  bannedCardIds: string[];
  bannedFactionIds: string[];
}

/** §17's stated ranges, in one place so the lobby and the check agree. */
export const CUSTOM_LIMITS = {
  health: { min: 20, max: 40 },
  hand: { min: 1, max: 8 },
  timer: { min: 30, max: 120 },
  deck: { min: 20, max: 40 },
} as const;

/** The standard game, read from balance — the baseline every knob is judged against. */
export function defaultSettings(content: ContentIndex): CustomSettings {
  return {
    opponent: "ai",
    difficulty: "intermediate",
    startingHealth: content.balance.leader.startingHealth,
    handFirst: content.balance.hand.first,
    handSecond: content.balance.hand.second,
    turnSeconds: content.balance.timer.turnSeconds,
    deckSize: content.balance.deck.size,
    modifierId: null,
    bannedCardIds: [],
    bannedFactionIds: [],
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** Force a settings object inside §17's ranges. The lobby cannot produce an illegal match. */
export function clampSettings(content: ContentIndex, settings: CustomSettings): CustomSettings {
  return {
    ...settings,
    startingHealth: clamp(settings.startingHealth, CUSTOM_LIMITS.health.min, CUSTOM_LIMITS.health.max),
    handFirst: clamp(settings.handFirst, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max),
    handSecond: clamp(settings.handSecond, CUSTOM_LIMITS.hand.min, CUSTOM_LIMITS.hand.max),
    turnSeconds:
      settings.turnSeconds === null
        ? null
        : clamp(settings.turnSeconds, CUSTOM_LIMITS.timer.min, CUSTOM_LIMITS.timer.max),
    deckSize: clamp(settings.deckSize, CUSTOM_LIMITS.deck.min, CUSTOM_LIMITS.deck.max),
    // a modifier id that is not playable is not a modifier
    modifierId:
      settings.modifierId && playableModifiers().some((entry) => entry.id === settings.modifierId)
        ? settings.modifierId
        : null,
    bannedCardIds: [...new Set(settings.bannedCardIds)],
    bannedFactionIds: [...new Set(settings.bannedFactionIds)],
  };
}

// ---------------------------------------------------------------------------
// The ban list
// ---------------------------------------------------------------------------

/** Is this card banned by id or by its faction? */
export function isBanned(settings: CustomSettings, card: CardDef): boolean {
  return (
    settings.bannedCardIds.includes(card.id) ||
    settings.bannedFactionIds.includes(card.faction as string)
  );
}

/** Every collectible card the match allows. */
export const allowedPool = (content: ContentIndex, settings: CustomSettings): CardDef[] =>
  collectibleCards(content).filter((card) => !isBanned(settings, card));

/**
 * Which cards in a deck the ban list refuses, with duplicates collapsed.
 *
 * Returned rather than thrown, because the lobby's job is to say *"this deck
 * cannot play under these settings, and here is what to change"* before the
 * match — not to fail at the point of dealing.
 */
export function bannedInDeck(content: ContentIndex, settings: CustomSettings, deck: DeckList): CardDef[] {
  const seen = new Set<string>();
  const out: CardDef[] = [];
  for (const cardId of deck.cards) {
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    const card = content.cards[cardId];
    if (card && isBanned(settings, card)) out.push(card);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Integrity — §17's anti-farming rule
// ---------------------------------------------------------------------------

/**
 * Why this configuration pays nothing, or an empty list when it pays.
 *
 * The rule in one sentence: **easier than standard pays zero.** Every flag below
 * is a comparison against the shipped balance, so "standard" cannot drift away
 * from what the rest of the game means by it.
 *
 * Deliberately *not* flagged: anything harder than standard, a Remix modifier
 * (both seats get it, and §12 modifiers are balanced for constructed play), a
 * ban list (bans cut both ways and mostly make the game harder), and the AI
 * difficulty (a Sparring win against a beginner already pays the Sparring
 * schedule everywhere else in the game — customs must not be stricter than the
 * mode they are imitating).
 */
export function integrityFlags(content: ContentIndex, settings: CustomSettings): string[] {
  const flags: string[] = [];
  const standard = defaultSettings(content);

  if (settings.opponent === "hotseat") {
    flags.push("Hotseat pays nothing — both seats are the same account.");
  }
  if (settings.startingHealth < standard.startingHealth) {
    flags.push(
      `Starting health is ${settings.startingHealth}, below the standard ${standard.startingHealth} — a shorter game is an easier one.`
    );
  }
  if (settings.deckSize < standard.deckSize) {
    flags.push(
      `Deck size is ${settings.deckSize}, below the standard ${standard.deckSize} — a smaller deck draws its best cards more often.`
    );
  }
  if (settings.handFirst > standard.handFirst || settings.handSecond > standard.handSecond) {
    flags.push("Opening hands are larger than standard.");
  }
  return flags;
}

/** §17: customs pay the Sparring schedule, unless a flag says they pay nothing. */
export const paysRewards = (content: ContentIndex, settings: CustomSettings): boolean =>
  integrityFlags(content, settings).length === 0;

// ---------------------------------------------------------------------------
// Assembling the match
// ---------------------------------------------------------------------------

/** The chosen Remix modifier, or null. */
export function chosenModifier(settings: CustomSettings, now: number): RemixModifierDef | null {
  if (!settings.modifierId) return null;
  const modifier = modifierById(settings.modifierId, now);
  return modifier.id === settings.modifierId ? modifier : null;
}

/**
 * Everything the battle route needs, assembled — the same shape
 * `bossMatchConfig` and `remixMatchConfig` return.
 *
 * The knobs are applied first and the Remix modifier second, so a modifier that
 * names the same balance key as a knob wins. That is the right way round: the
 * knobs are the room's house rules, and the modifier is a named rule from a
 * published catalogue that both seats agreed to play under.
 */
export function customMatchConfig(
  content: ContentIndex,
  settings: CustomSettings,
  leaderCardIds: readonly string[],
  now: number
): Pick<MatchConfig, "balanceOverrides" | "cardOverrides"> {
  const standard = defaultSettings(content);
  const balanceOverrides: Record<string, number> = {};

  if (settings.startingHealth !== standard.startingHealth) {
    balanceOverrides["leader.startingHealth"] = settings.startingHealth;
  }
  if (settings.handFirst !== standard.handFirst) balanceOverrides["hand.first"] = settings.handFirst;
  if (settings.handSecond !== standard.handSecond) balanceOverrides["hand.second"] = settings.handSecond;
  if (settings.deckSize !== standard.deckSize) balanceOverrides["deck.size"] = settings.deckSize;
  /**
   * "Off" is expressed as a very large number rather than a new concept.
   * The HUD counts down from whatever it is given; a timer of one day is a
   * timer nobody will ever see, and it needs no special case anywhere.
   */
  if (settings.turnSeconds === null) balanceOverrides["timer.turnSeconds"] = 86_400;
  else if (settings.turnSeconds !== standard.turnSeconds) {
    balanceOverrides["timer.turnSeconds"] = settings.turnSeconds;
  }

  const modifier = chosenModifier(settings, now);
  const fromModifier = modifier ? remixMatchConfig(content, modifier, leaderCardIds) : {};

  const merged = { ...balanceOverrides, ...(fromModifier.balanceOverrides ?? {}) };

  return {
    ...(Object.keys(merged).length > 0 ? { balanceOverrides: merged } : {}),
    ...(fromModifier.cardOverrides ? { cardOverrides: fromModifier.cardOverrides } : {}),
  };
}

// ---------------------------------------------------------------------------
// Deferred
// ---------------------------------------------------------------------------

export const DEFERRED_CUSTOM: ReadonlyMap<string, string> = new Map([
  [
    "Online custom lobbies",
    "§17's ship status is explicit that vs AI and Hotseat are offline-now and online lobbies are online-later; a lobby code nobody can join is a text box that does nothing",
  ],
  [
    "Friend invites",
    "§17 lists a friend invite as an entry point and §18 is Challenge a Friend, both of which need a friends list, which needs accounts, which needs the server",
  ],
  [
    "Per-seat deck choice in Hotseat",
    "both hotseat seats currently play a deck chosen from this account's own slots, because there is one account on the device; a second player bringing their own collection needs a second collection, which is an account",
  ],
]);

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** Everything wrong with a settings object, in words the lobby can print. */
export function checkCustomSettings(content: ContentIndex, settings: CustomSettings): string[] {
  const problems: string[] = [];
  const { health, hand, timer, deck } = CUSTOM_LIMITS;

  if (settings.startingHealth < health.min || settings.startingHealth > health.max) {
    problems.push(`starting health must be ${health.min}–${health.max}`);
  }
  if (settings.deckSize < deck.min || settings.deckSize > deck.max) {
    problems.push(`deck size must be ${deck.min}–${deck.max}`);
  }
  if (settings.turnSeconds !== null && (settings.turnSeconds < timer.min || settings.turnSeconds > timer.max)) {
    problems.push(`the turn timer must be ${timer.min}–${timer.max} seconds, or off`);
  }
  if (settings.handFirst < hand.min || settings.handSecond < hand.min) {
    problems.push("an opening hand of nothing is not a game");
  }
  if (settings.modifierId && !playableModifiers().some((entry) => entry.id === settings.modifierId)) {
    problems.push(`"${settings.modifierId}" is not a playable Remix modifier`);
  }
  for (const factionId of settings.bannedFactionIds) {
    if (!content.factions[factionId as FactionId]) problems.push(`banned faction "${factionId}" does not exist`);
  }
  for (const cardId of settings.bannedCardIds) {
    if (!content.cards[cardId]) problems.push(`banned card "${cardId}" does not exist`);
  }
  if (allowedPool(content, settings).length === 0) {
    problems.push("the ban list removes every card in the game");
  }
  for (const [name, reason] of DEFERRED_CUSTOM) {
    if (reason.trim().length < 40) problems.push(`DEFERRED_CUSTOM "${name}": deferred without a real reason`);
  }
  return problems;
}
