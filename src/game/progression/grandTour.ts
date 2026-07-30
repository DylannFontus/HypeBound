/**
 * The Grand Tour — play the other nine factions to earn them.
 *
 * `docs/design/07-economy-and-monetization.md` §3.4, in one sentence: *"win 1
 * match (AI Practice counts) with each remaining faction's loaner deck to
 * permanently unlock that faction's starter deck. Completing all 10 grants 1,000
 * Clout + 10 Merch Drops + 1 Legendary of your choice from the launch set."*
 *
 * That sentence is the whole feature, and it is what closes the loop the starter
 * picker opened: an account chooses one faction on its first screen, and until
 * now had **no way to ever reach the other nine**. The picker's own promise —
 * *"you can unlock the other nine by playing them"* — was a claim about software
 * that did not exist.
 *
 * This module is deliberately pure: content and a read-only view of the account
 * in, plain data out. Nothing here touches storage, the DOM or the clock, so the
 * rules the design states can be asserted directly rather than through a save
 * file. The granting lives in `save/profile.ts`, and the screen in
 * `ui/screens/grandTourScreen.ts`.
 *
 * ## The one thing a loaner deck is
 *
 * A loaner deck is **the faction's starter deck, lent for one match**. Not a
 * variant, not an auto-build: the same thirty cards the win is playing for. That
 * is the point of the tour — you try the deck, and if you like it you keep it.
 * Building the loaner from `autoBuildDeck` instead would let a player win with
 * one deck and be handed a different one, which is the kind of quiet mismatch
 * this project keeps finding in shipped code.
 */

import type { CardDef, ContentIndex, DeckList, FactionId } from "../../engine/types";
import { collectibleCards } from "../../engine/content";
import { playableCap } from "../economy/drops";
import { asDeckList, type StarterDeck } from "./starterDecks";
import { starterDeckFor, starterDecks } from "./data";

/** As much of an account as the tour needs to know. Keeps this module pure. */
export interface TourView {
  /** every faction whose starter deck the account owns */
  unlockedFactions: readonly FactionId[];
  /** the faction chosen on the first screen, or null for a legacy save */
  starterFaction: FactionId | null;
  /** owned copies by card id, for the Legendary choice */
  owned: Readonly<Record<string, number>>;
  /** true once the completion reward has been paid */
  rewardClaimed: boolean;
}

export interface TourStop {
  factionId: FactionId;
  factionName: string;
  leaderCardId: string;
  /** the name the deck takes once it is won */
  deckName: string;
  unlocked: boolean;
  /** the faction the account started with — unlocked without ever being toured */
  isStarter: boolean;
}

export interface TourProgress {
  stops: TourStop[];
  unlocked: number;
  total: number;
  complete: boolean;
  /** true when every stop is done and the reward is still owed */
  rewardReady: boolean;
  /** what completion pays, read from balance so the screen cannot overpromise */
  reward: { clout: number; drops: number; legendaryChoices: number };
}

/** The key the completion reward is banked under, so it can never pay twice. */
export const GRAND_TOUR_REWARD_KEY = "grand-tour:complete";

/**
 * The deck the tour lends for one match.
 *
 * Named for what it is on the battle screen and in match history — "Neon Idols
 * Loaner" — because the deck that arrives in the collection afterwards is the
 * *Starter*, and a history full of two identically-named decks would make the
 * one interesting question ("did I win this with my own cards?") unanswerable.
 */
export function loanerDeckFor(content: ContentIndex, factionId: FactionId): DeckList | null {
  const starter = starterDeckFor(factionId);
  if (!starter || !content.leaders[starter.leaderCardId]) return null;
  const faction = content.factions[factionId];
  return { ...asDeckList(starter), name: `${faction?.name ?? factionId} Loaner` };
}

/**
 * Who the loaner match is played against: **another faction's starter deck**.
 *
 * The practice route's ordinary rival is `autoBuildDeck` over a Leader's whole
 * legal pool — Epics, Legendaries and all — which is a fair opponent for a
 * constructed deck and is not one for a list that is seventeen Commons with
 * three Epics and one Legendary. Sending a new player at it to earn the deck
 * would make the unlock a grind rather than an introduction.
 *
 * §3.4's own last line decides it: *"Starter decks are legal in every
 * constructed mode and are the **baseline used for new-player matchmaking
 * pools**."* The Grand Tour is that pool, so the tour plays starter against
 * starter. The opponent is the next faction on the list, wrapping — a fixed
 * choice rather than a random one, because the match seed is meant to reproduce
 * the whole match and an opponent rolled elsewhere would not be in the config.
 */
export function tourOpponentDeck(content: ContentIndex, factionId: FactionId): DeckList | null {
  const stops = starterDecks().filter((deck) => content.factions[deck.factionId]);
  const index = stops.findIndex((deck) => deck.factionId === factionId);
  if (index < 0 || stops.length < 2) return null;
  return asDeckList(stops[(index + 1) % stops.length]!);
}

/** Every stop on the tour, in the order the frozen lists are stored. */
export function tourProgress(content: ContentIndex, view: TourView): TourProgress {
  const unlocked = new Set(view.unlockedFactions);
  const stops: TourStop[] = starterDecks()
    .filter((deck: StarterDeck) => content.factions[deck.factionId])
    .map((deck) => ({
      factionId: deck.factionId,
      factionName: content.factions[deck.factionId]?.name ?? deck.factionId,
      leaderCardId: deck.leaderCardId,
      deckName: deck.name,
      unlocked: unlocked.has(deck.factionId),
      isStarter: view.starterFaction === deck.factionId,
    }));

  const done = stops.filter((stop) => stop.unlocked).length;
  const complete = stops.length > 0 && done === stops.length;
  return {
    stops,
    unlocked: done,
    total: stops.length,
    complete,
    rewardReady: complete && !view.rewardClaimed,
    reward: content.balance.economy.grandTour,
  };
}

export interface LegendaryChoice {
  card: CardDef;
  /** already held at the playable cap, so choosing it would grant a dead copy */
  owned: boolean;
}

/**
 * The Legendaries the completion reward may be spent on.
 *
 * "from the launch set" is every collectible Legendary in the game. Ones already
 * held at the playable cap are listed and marked rather than hidden: a picker
 * that silently omits the card somebody is looking for reads as a bug, and the
 * point of a choice reward is being able to see the whole shelf.
 */
export function legendaryChoices(content: ContentIndex, owned: Readonly<Record<string, number>>): LegendaryChoice[] {
  return collectibleCards(content)
    .filter((card) => card.rarity === "legendary")
    .sort((a, b) => (a.faction === b.faction ? (a.name < b.name ? -1 : 1) : a.faction < b.faction ? -1 : 1))
    .map((card) => ({ card, owned: (owned[card.id] ?? 0) >= playableCap(content, card) }));
}

/**
 * Is this a Legendary the reward can actually be spent on?
 *
 * The grant refuses anything else rather than handing over a copy the player can
 * never put in a deck — the playable cap for a Legendary is one.
 */
export function canChooseLegendary(content: ContentIndex, owned: Readonly<Record<string, number>>, cardId: string): boolean {
  return legendaryChoices(content, owned).some((choice) => choice.card.id === cardId && !choice.owned);
}

/**
 * What a Legendary the player already owns is worth instead.
 *
 * Only reachable by an account holding **every** Legendary in the game, which is
 * possible and would otherwise strand the Clout and the Drops behind a choice
 * with nothing left to choose. It converts at the same published rate a Drop's
 * duplicate does (§3.3, §5 step 6) rather than at a rate invented here.
 */
export function legendaryFallbackSignal(content: ContentIndex): number {
  const { dustValue, dupeConversionBonus } = content.balance.economy;
  return Math.round((dustValue.legendary ?? 0) * dupeConversionBonus);
}
