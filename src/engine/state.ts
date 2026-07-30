/**
 * Match construction, zone helpers, and per-seat redaction.
 * All ids are allocated from a deterministic counter so replays stay exact.
 */

import type {
  CardInstance,
  CharacterCardDef,
  CharacterInstance,
  ContentIndex,
  DeckList,
  EquipmentCardDef,
  LeaderCardDef,
  MatchConfig,
  MatchState,
  PlayerState,
  PlayerView,
  RedactedOpponent,
  Seat,
  SetupOp,
  StatusId,
  TargetRef,
} from "./types";
import { getCard, getLeader } from "./content";
import { seedRng, shuffle, nextInt } from "./rng";
import { deckPureCurrent } from "./currents";

export const SCHEMA_VERSION = 1;

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/**
 * The globalTurnCounter value at the start of `seat`'s Nth upcoming turn.
 *
 * The counter ticks once per seat-turn, so "the start of your next turn" is one
 * tick away during the opponent's turn but two during your own. Comeback,
 * Banish and scheduleDelayed all schedule against this.
 */
export function turnCounterForOwnTurn(state: MatchState, seat: Seat, turnsAhead = 1): number {
  const base = state.activeSeat === seat ? state.globalTurnCounter + 2 : state.globalTurnCounter + 1;
  return base + (Math.max(1, turnsAhead) - 1) * 2;
}

/** Allocate the next deterministic instance id. */
export function nextId(state: MatchState, prefix: string): string {
  const n = state.nextInstanceId++;
  return `${prefix}${n}`;
}

function makeCardInstance(state: MatchState, cardId: string): CardInstance {
  return { instanceId: nextId(state, "c"), cardId, costDelta: 0, addedKeywords: [], removedKeywords: [] };
}

function emptyPlayer(seat: Seat, deck: DeckList, leader: LeaderCardDef, content: ContentIndex): PlayerState {
  return {
    seat,
    leaderCardId: deck.leaderCardId,
    leaderCurrent: leader.primaryCurrent,
    leaderHealth: leader.health,
    leaderMaxHealth: leader.health,
    armor: 0,
    statuses: [],
    hype: 0,
    hypeMax: 0,
    bonusHypeMax: 0,
    hypeLockedNextTurn: 0,
    tempHypeThisTurn: 0,
    obsession: 0,
    fixationUsedThisTurn: false,
    ultimateUsed: false,
    supportObsessionGainedThisTurn: false,
    deck: [],
    hand: [],
    discard: [],
    board: new Array<CharacterInstance | null>(content.balance.board.characterSlots).fill(null),
    banished: [],
    location: null,
    reactions: [],
    activeEvent: null,
    fatigueCounter: 0,
    cardsPlayedThisTurn: 0,
    cardsPlayedLastTurn: 0,
    currentsPlayedThisTurn: [],
    hypeSpentThisTurn: 0,
    confluenceUsedThisTurn: false,
    pureCurrent: deckPureCurrent(content, deck),
    resonanceProgress: 0,
    resonanceActivated: false,
    refractionCurrent: null,
    afterpartyRepeatThisTurn: false,
    counters: {},
    mulliganDone: false,
    leaderFiredOnce: [],
    leaderFiredThisTurn: [],
  };
}

/**
 * Create a match in the mulligan phase. Decks are shuffled and opening hands
 * dealt; the second player also receives a Borrowed Clout token (canon §2).
 */
export function createMatch(config: MatchConfig, content: ContentIndex): MatchState {
  const leaderA = getLeader(content, config.decks[0].leaderCardId);
  const leaderB = getLeader(content, config.decks[1].leaderCardId);

  const state: MatchState = {
    schemaVersion: SCHEMA_VERSION,
    config,
    rngState: seedRng(config.seed),
    turn: 1,
    turnOfSeat: [0, 0],
    activeSeat: 0,
    phase: "mulligan",
    players: [emptyPlayer(0, config.decks[0], leaderA, content), emptyPlayer(1, config.decks[1], leaderB, content)],
    delayed: [],
    comebacks: [],
    aurasDisabledUntilTurn: 0,
    globalTurnCounter: 0,
    winner: null,
    intentCount: 0,
    nextInstanceId: 1,
    wavesLanded: 0,
  };

  // coin flip (deterministic from the seed) unless the caller fixed it
  state.activeSeat = config.firstSeat ?? ((nextInt(state.rngState, 2) as Seat));

  const scenario = config.scenario;

  for (const seat of [0, 1] as Seat[]) {
    const player = state.players[seat];
    const deck = config.decks[seat];
    player.deck = deck.cards.map((cardId) => makeCardInstance(state, cardId));
    // A scripted encounter that wants its authored order also consumes no RNG
    // here, so its seed still lines up with a hand-written intent log.
    if (scenario?.shuffle !== false) shuffle(state.rngState, player.deck);

    if (scenario?.deal !== false) {
      const handSize = seat === state.activeSeat ? content.balance.hand.first : content.balance.hand.second;
      for (let i = 0; i < handSize; i++) {
        const card = player.deck.shift();
        if (card) player.hand.push(card);
      }
      if (seat !== state.activeSeat && scenario?.borrowedClout !== false) {
        player.hand.push(makeCardInstance(state, "token-borrowed-clout"));
      }
    }
  }

  if (scenario?.setup) applySetupOps(state, content, scenario.setup);

  /**
   * A scenario that skips the mulligan is NOT started here. Beginning a turn
   * grants Hype and draws, and that logic lives with the reducer; setting the
   * phase from here would hand the player a main phase with zero Hype and no
   * opening draw. `beginScriptedMatch` in reducer.ts does it properly, and both
   * the driver and `replay()` call it, so a scripted match and its replay begin
   * identically.
   */
  return state;
}

/**
 * Apply scripted setup writes, in order.
 *
 * Consumes no randomness and allocates instance ids from the same counter as
 * everything else, so a re-simulation from the same config reproduces every id
 * exactly — which is what lets a rewind re-key the UI's per-instance caches.
 */
function applySetupOps(state: MatchState, content: ContentIndex, ops: SetupOp[]): void {
  for (const op of ops) {
    const player = state.players[op.seat];
    switch (op.op) {
      case "deckOrder": {
        const front = op.cards.map((cardId) => makeCardInstance(state, cardId));
        player.deck = op.rest === "empty" ? front : [...front, ...player.deck];
        break;
      }
      case "hand":
        player.hand = op.cards.map((cardId) => makeCardInstance(state, cardId));
        break;
      case "board": {
        /**
         * An opening board defaults to *not* summoning-sick: it has been standing
         * there since before the match. A wave defaults the other way — see
         * `dealCharacter`, which both go through.
         */
        const dealt = dealCharacter(state, content, op.seat, op.slot, op, op.ready !== false);
        if (dealt) player.board[op.slot] = dealt;
        break;
      }
      case "leaderHealth":
        player.leaderHealth = op.value;
        if (op.max !== undefined) player.leaderMaxHealth = op.max;
        // a scripted health below the card's maximum must not read as "healed"
        player.leaderMaxHealth = Math.max(player.leaderMaxHealth, op.value);
        break;
      case "armor":
        player.armor = op.value;
        break;
      case "hype":
        player.hype = op.value;
        player.hypeMax = op.max ?? Math.max(player.hypeMax, op.value);
        break;
      case "obsession":
        player.obsession = op.value;
        break;
      case "reaction":
        player.reactions.push({
          instanceId: nextId(state, "r"),
          cardId: op.cardId,
          // set before this turn, so it is armed rather than freshly played
          setOnTurn: -1,
        });
        break;
      case "turn":
        // startTurn increments this and then derives Hype from it, so store one
        // less than the turn the author asked for
        state.turnOfSeat[op.seat] = Math.max(0, op.value - 1);
        if (op.seat === 0) state.turn = Math.max(1, op.value);
        break;
    }
  }
}

/**
 * Build one scripted character — the single path shared by the `board` setup op
 * and by wave arrivals.
 *
 * They are the same act performed at two different moments, and keeping them one
 * function is what stops them drifting: a stat clamp or a status field added for
 * one would otherwise silently not apply to the other. The only thing the two
 * callers disagree about is summoning sickness, so that is the argument.
 *
 * Returns null for a card that is missing or is not a character, which the
 * callers treat as "nothing was dealt" — the data validators refuse both long
 * before a match is built, so this is a floor rather than a behaviour.
 */
export function dealCharacter(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  slot: number,
  spec: {
    cardId: string;
    attack?: number;
    health?: number;
    maxHealth?: number;
    statuses?: { id: StatusId; amount?: number; remainingTurns?: number | null }[];
  },
  ready: boolean
): CharacterInstance | null {
  const card = content.cards[spec.cardId];
  if (!card || card.type !== "character") return null;
  const character = card as CharacterCardDef;
  const attack = spec.attack ?? character.attack;
  const health = spec.health ?? character.health;
  /**
   * The ceiling follows `health` unless the scenario says otherwise, which keeps
   * every existing encounter dealing exactly what it dealt before. An explicit
   * `maxHealth` is what lets a scenario place a character that has already taken
   * damage and can therefore be healed.
   */
  const maxHealth = Math.max(health, spec.maxHealth ?? health);
  return {
    instanceId: nextId(state, "u"),
    cardId: spec.cardId,
    controller: seat,
    slot,
    attack,
    health,
    maxHealth,
    baseAttack: character.attack,
    baseHealth: character.health,
    current: character.current,
    tags: [...character.tags],
    keywords: [...character.keywords],
    statuses: (spec.statuses ?? []).map((st) => ({
      id: st.id,
      ...(st.amount !== undefined ? { amount: st.amount } : {}),
      remainingTurns: st.remainingTurns ?? null,
      sourceCardId: spec.cardId,
    })),
    equipment: null,
    // -1 reads as "has been here since before this turn", which is what clears
    // summoning sickness without a special case in combat
    enteredOnTurn: ready ? -1 : state.globalTurnCounter,
    attacksUsedThisTurn: 0,
    maxAttacksPerTurn: 1,
    growProgress: 0,
    growComplete: false,
    damagedThisTurn: false,
    firedOnce: [],
    firedThisTurn: [],
  };
}

// ---------------------------------------------------------------------------
// Zone helpers
// ---------------------------------------------------------------------------

export function findCharacter(state: MatchState, instanceId: string): CharacterInstance | null {
  for (const player of state.players) {
    for (const slot of player.board) {
      if (slot && slot.instanceId === instanceId) return slot;
    }
  }
  return null;
}

export function allCharacters(state: MatchState): CharacterInstance[] {
  const out: CharacterInstance[] = [];
  for (const player of state.players) {
    for (const slot of player.board) if (slot) out.push(slot);
  }
  return out;
}

export function boardOf(state: MatchState, seat: Seat): CharacterInstance[] {
  return state.players[seat].board.filter((c): c is CharacterInstance => c !== null);
}

export function firstEmptySlot(player: PlayerState): number {
  return player.board.findIndex((slot) => slot === null);
}

export function removeCharacter(state: MatchState, instanceId: string): CharacterInstance | null {
  for (const player of state.players) {
    const index = player.board.findIndex((c) => c?.instanceId === instanceId);
    if (index >= 0) {
      const character = player.board[index]!;
      player.board[index] = null;
      return character;
    }
  }
  return null;
}

export function resolveRef(state: MatchState, ref: TargetRef): CharacterInstance | PlayerState | null {
  if (ref.kind === "leader") return state.players[ref.seat];
  return findCharacter(state, ref.instanceId);
}

export function refOf(entity: CharacterInstance | PlayerState): TargetRef {
  return "instanceId" in entity
    ? { kind: "character", instanceId: entity.instanceId }
    : { kind: "leader", seat: entity.seat };
}

export const isCharacter = (e: CharacterInstance | PlayerState): e is CharacterInstance => "instanceId" in e;

/**
 * Build a character instance from a card definition (used by play and summon).
 * Attack/health come from the card; keywords/tags are copied so effects can
 * mutate the instance without touching shared content.
 */
export function instantiateCharacter(
  state: MatchState,
  content: ContentIndex,
  cardId: string,
  controller: Seat,
  slot: number
): CharacterInstance {
  const card = getCard(content, cardId) as CharacterCardDef;
  return {
    instanceId: nextId(state, "u"),
    cardId,
    controller,
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
    enteredOnTurn: state.globalTurnCounter,
    attacksUsedThisTurn: 0,
    maxAttacksPerTurn: 1,
    growProgress: 0,
    growComplete: false,
    firedOnce: [],
    firedThisTurn: [],
    damagedThisTurn: false,
  };
}

/** Equipment stat contribution for a character (equipment is not an aura). */
export function equipmentBonus(content: ContentIndex, character: CharacterInstance): { attack: number; health: number } {
  if (!character.equipment) return { attack: 0, health: 0 };
  const card = content.cards[character.equipment.cardId] as EquipmentCardDef | undefined;
  return { attack: card?.equipAttack ?? 0, health: card?.equipHealth ?? 0 };
}

// ---------------------------------------------------------------------------
// Redaction — what a seat is allowed to see
// ---------------------------------------------------------------------------

function redactOpponent(player: PlayerState): RedactedOpponent {
  return {
    seat: player.seat,
    leaderCardId: player.leaderCardId,
    leaderCurrent: player.leaderCurrent,
    leaderHealth: player.leaderHealth,
    leaderMaxHealth: player.leaderMaxHealth,
    armor: player.armor,
    hype: player.hype,
    hypeMax: player.hypeMax,
    obsession: player.obsession,
    handCount: player.hand.length,
    deckCount: player.deck.length,
    discard: player.discard,
    board: player.board,
    banishedCount: player.banished.length,
    location: player.location,
    reactionCount: player.reactions.length,
    activeEvent: player.activeEvent,
    resonanceProgress: player.resonanceProgress,
    pureCurrent: player.pureCurrent,
    counters: player.counters,
  };
}

/** The per-seat view a client or AI is allowed to receive. */
export function redact(state: MatchState, seat: Seat): PlayerView {
  return {
    seat,
    you: state.players[seat],
    opponent: redactOpponent(state.players[otherSeat(seat)]),
    turn: state.turn,
    globalTurnCounter: state.globalTurnCounter,
    activeSeat: state.activeSeat,
    phase: state.phase,
    aurasDisabledUntilTurn: state.aurasDisabledUntilTurn,
    winner: state.winner,
  };
}

/** Deep clone used at every intent boundary (structuredClone keeps it JSON-safe). */
export function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}
