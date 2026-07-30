/**
 * Fixture content for rules tests.
 *
 * Rules tests build their own tiny card pool rather than using data/cards/, so
 * they assert engine behaviour rather than whatever the current card balance
 * happens to be — and they keep passing while content churns.
 */

import { buildContent } from "../src/engine/content";
import type { CardDef, ContentIndex, DeckList, EncounterSetup, MatchConfig, MatchState } from "../src/engine/types";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";

import currents from "../data/currents.json";
import factions from "../data/factions.json";
import confluences from "../data/confluences.json";
import statuses from "../data/statuses.json";
import keywords from "../data/keywords.json";
import balance from "../data/balance.json";
import tokens from "../data/cards/tokens.json";

/** A minimal leader; `overrides` customises Currents and abilities per test. */
export function testLeader(id: string, overrides: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: id,
    faction: "neutral",
    current: "prism",
    type: "leader",
    rarity: "legendary",
    cost: 0,
    health: 30,
    primaryCurrent: "prism",
    secondaryCurrent: null,
    tags: [],
    keywords: [],
    passive: [],
    fixation: { name: "Test Fixation", obsessionCost: 3, ops: [{ op: "draw", count: 1 }], text: "Draw a card." },
    ultimate: { name: "Test Ultimate", obsessionCost: 7, ops: [{ op: "draw", count: 2 }], text: "Draw 2 cards." },
    title: "Test Leader",
    effects: [],
    text: "",
    ...overrides,
  } as CardDef;
}

/** A vanilla character with no text unless overridden. */
export function testCharacter(id: string, cost: number, attack: number, health: number, overrides: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: id,
    faction: "neutral",
    current: "prism",
    type: "character",
    rarity: "common",
    cost,
    attack,
    health,
    tags: [],
    keywords: [],
    effects: [],
    text: "",
    ...overrides,
  } as CardDef;
}

export function testAction(id: string, cost: number, overrides: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: id,
    faction: "neutral",
    current: "prism",
    type: "action",
    rarity: "common",
    cost,
    tags: [],
    keywords: [],
    effects: [],
    text: "test action",
    ...overrides,
  } as CardDef;
}

/** Build a ContentIndex from the real data files plus extra test cards. */
export function fixtureContent(extra: CardDef[]): ContentIndex {
  return buildContent({
    cardArrays: [tokens as CardDef[], extra],
    currents,
    factions,
    confluences,
    statuses,
    keywords,
    balance,
  });
}

/** A legal 30-card deck made by repeating `cardIds` until it is full. */
export function fillDeck(leaderCardId: string, cardIds: string[], name = "Test Deck"): DeckList {
  const cards: string[] = [];
  let i = 0;
  while (cards.length < 30) {
    cards.push(cardIds[i % cardIds.length]!);
    i++;
  }
  return { name, leaderCardId, cards };
}

export interface Harness {
  state: MatchState;
  content: ContentIndex;
  /** apply an intent and keep the resulting state; returns the events */
  play: (intent: Parameters<typeof applyIntent>[2]) => ReturnType<typeof applyIntent>["events"];
  /** skip the mulligan phase for both seats */
  begin: () => void;
  /** end the current turn (whoever is active) */
  endTurn: () => ReturnType<typeof applyIntent>["events"];
  /** advance until it is `seat`'s turn with at least `hype` max Hype */
  advanceTo: (seat: 0 | 1, hype: number) => void;
}

/**
 * Build a match harness. Deck order is deterministic, and `stack` lets a test
 * put exact cards on top of a player's deck so draws are predictable.
 */
export function harness(options: {
  content: ContentIndex;
  decks: [DeckList, DeckList];
  seed?: number;
  firstSeat?: 0 | 1;
  stack?: [string[], string[]];
  /** scripted deal and/or waves, exactly as a real encounter carries them */
  scenario?: EncounterSetup;
}): Harness {
  const config: MatchConfig = {
    seed: options.seed ?? 4242,
    decks: options.decks,
    firstSeat: options.firstSeat ?? 0,
    ...(options.scenario ? { scenario: options.scenario } : {}),
  };
  let state = createMatch(config, options.content);

  // put chosen cards on top of each deck for predictable draws
  if (options.stack) {
    for (const seat of [0, 1] as const) {
      const wanted = options.stack[seat];
      const player = state.players[seat];
      for (let i = wanted.length - 1; i >= 0; i--) {
        const cardId = wanted[i]!;
        const index = player.deck.findIndex((c) => c.cardId === cardId);
        if (index >= 0) {
          const [instance] = player.deck.splice(index, 1);
          if (instance) player.deck.unshift(instance);
        }
      }
    }
  }

  const api: Harness = {
    get state() {
      return state;
    },
    content: options.content,
    play(intent) {
      const result = applyIntent(state, options.content, intent);
      state = result.state;
      return result.events;
    },
    begin() {
      api.play({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
      api.play({ type: "mulligan", seat: 1, replaceInstanceIds: [] });
    },
    endTurn() {
      return api.play({ type: "endTurn", seat: state.activeSeat });
    },
    advanceTo(seat, hype) {
      let guard = 0;
      while ((state.activeSeat !== seat || state.players[seat].hypeMax < hype) && guard++ < 40) {
        api.endTurn();
        if (state.winner !== null) break;
      }
    },
  } as Harness;

  // `state` is reassigned, so expose it through a getter
  Object.defineProperty(api, "state", { get: () => state });
  return api;
}

/** Find a card instance in a seat's hand by card id. */
export function handCard(state: MatchState, seat: 0 | 1, cardId: string): string {
  const instance = state.players[seat].hand.find((c) => c.cardId === cardId);
  if (!instance) throw new Error(`${cardId} not in seat ${seat}'s hand`);
  return instance.instanceId;
}

/** Put a specific card directly into a seat's hand (bypassing draw). */
export function giveCard(state: MatchState, seat: 0 | 1, cardId: string): string {
  const instanceId = `test-${state.nextInstanceId++}`;
  state.players[seat].hand.push({ instanceId, cardId, costDelta: 0, addedKeywords: [], removedKeywords: [] });
  return instanceId;
}

/** Put a character directly onto the board (bypassing play). */
export function placeCharacter(
  state: MatchState,
  content: ContentIndex,
  seat: 0 | 1,
  cardId: string,
  slot = 0
): string {
  const card = content.cards[cardId];
  if (!card || card.type !== "character") throw new Error(`${cardId} is not a character`);
  const instanceId = `unit-${state.nextInstanceId++}`;
  state.players[seat].board[slot] = {
    instanceId,
    cardId,
    controller: seat,
    slot,
    attack: card.attack,
    health: card.health,
    maxHealth: card.health,
    baseAttack: card.attack,
    baseHealth: card.health,
    current: card.current,
    tags: [...card.tags],
    keywords: [...card.keywords],
    statuses: [],
    equipment: null,
    // entered on a previous turn, so it can attack immediately
    enteredOnTurn: -5,
    attacksUsedThisTurn: 0,
    maxAttacksPerTurn: 1,
    growProgress: 0,
    growComplete: false,
    firedOnce: [],
    firedThisTurn: [],
    damagedThisTurn: false,
  };
  return instanceId;
}
