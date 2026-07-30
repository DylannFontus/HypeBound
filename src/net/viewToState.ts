/**
 * `viewToState` — answer the engine's legality questions from a `PlayerView`.
 *
 * Five engine helpers enumerate what a player may do, and all five take a
 * `MatchState`: `checkPlayable`, `legalAttackTargets`, `legalEquipTargets`,
 * `legalFixationTargets`, `legalChooseTargets`. A networked client will not
 * have one.
 *
 * The tempting fix is to thread a view through them. That is a very large
 * change — `legalChooseTargets` builds an `EffectContext` and calls into the
 * whole effects DSL — and it would put a second shape of "state" through the
 * rules, which is the beginning of a second rules implementation.
 *
 * So this goes the other way: **rebuild a `MatchState`-shaped object from the
 * view**, with the zones the client cannot see filled by opaque placeholders of
 * the correct count, and hand it to the existing helpers unchanged. Same
 * functions, same code path, same answers — and the room re-checks every intent
 * with those functions anyway (§4.3), so the worst a wrong reconstruction can
 * do is grey out the wrong button.
 *
 * ## Why it is sound, and exactly where it stops being sound
 *
 * An audit traced all five. Between them they read only:
 *
 * - `state.phase`, `state.activeSeat` — both on the view
 * - `players[seat]`'s hand, hype, board, `reactions.length`,
 *   `cardsPlayedThisTurn`, `leaderCardId` — all on `view.you`
 * - `players[foe].board` — public, passed through `redact()` unredacted
 *
 * Nothing reads either hand but the viewer's own, nothing reads a deck, and
 * nothing reads `state.config` — which matters, because `PlayerView` has no
 * config at all and anything needing the seed could not be reconstructed.
 *
 * The strongest result is about `legalChooseTargets`, the one that looked most
 * dangerous: `candidateCharacters` walks the two board arrays and never
 * consults `spec.zone`, and a `TargetRef` can only name a board character or a
 * leader. **A `TargetSpec` cannot reach anybody's hand or deck through this
 * path** — a spec written `{ select: "choose", zone: "hand" }` silently returns
 * board characters. The placeholders are therefore never dereferenced.
 *
 * Two limits, both enforced or documented rather than hoped about:
 *
 * 1. **Only your own seat.** `checkPlayable(state, content, foeSeat, id)` would
 *    read the opponent's hand, hit a placeholder, and return `unknownInstance`
 *    — a *silently wrong* answer rather than a refusal. `legalityFromView`
 *    throws instead.
 * 2. **Not `attackableBy`.** It reaches `auraModifiersFor` → `evalCondition`,
 *    which can evaluate `{ kind: "topOfDeckMatches" }` against
 *    `players[seat].deck[0]` — the one place an opaque placeholder really is
 *    dereferenced. A conditional aura keyed on the top of your deck would
 *    evaluate differently here than in the room. It is deliberately absent
 *    below; see `attackableFromView`.
 */

import type {
  CardInstance,
  CharacterInstance,
  ContentIndex,
  MatchState,
  PlayerState,
  PlayerView,
  Seat,
  TargetRef,
} from "../engine/types";
import {
  canActivateLocation,
  canUseFixation,
  checkPlayable,
  legalEquipTargets,
  legalFixationTargets,
} from "../engine/intents";
import { legalAttackTargets } from "../engine/combat";
import { legalChooseTargets } from "../engine/effects";
import { availableConfluences } from "../engine/currents";
import { EMPTY_LEGALITY, isYourTurn, type Legality } from "./transport";

/** A card the client knows exists and cannot name. */
function placeholder(index: number, prefix: string): CardInstance {
  return {
    instanceId: `${prefix}${index}`,
    cardId: "hidden",
    costDelta: 0,
    addedKeywords: [],
    removedKeywords: [],
  };
}

const placeholders = (count: number, prefix: string): CardInstance[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => placeholder(i, prefix));

/**
 * Rebuild the opponent's `PlayerState` from what the view publishes.
 *
 * `RedactedOpponent` carries about twenty of `PlayerState`'s thirty-odd fields.
 * The rest are invented, and that is safe **only** because the audit showed no
 * legality helper reads them — a fact this file depends on and
 * `tests/view-to-state.test.ts` re-checks against the engine rather than
 * restating.
 *
 * `board` is copied with its nulls intact. Compacting it would renumber every
 * slot and silently change which characters are adjacent.
 */
function reconstructOpponent(view: PlayerView): PlayerState {
  const them = view.opponent;
  return {
    seat: them.seat,
    leaderCardId: them.leaderCardId,
    leaderCurrent: them.leaderCurrent,
    leaderHealth: them.leaderHealth,
    leaderMaxHealth: them.leaderMaxHealth,
    armor: them.armor,
    statuses: [],
    hype: them.hype,
    hypeMax: them.hypeMax,
    bonusHypeMax: 0,
    hypeLockedNextTurn: 0,
    tempHypeThisTurn: 0,
    obsession: them.obsession,
    fixationUsedThisTurn: false,
    ultimateUsed: false,
    supportObsessionGainedThisTurn: false,
    deck: placeholders(them.deckCount, "od"),
    hand: placeholders(them.handCount, "oh"),
    discard: them.discard,
    board: [...them.board],
    banished: Array.from({ length: Math.max(0, them.banishedCount) }, () => null as unknown as CharacterInstance),
    location: them.location,
    reactions: Array.from({ length: Math.max(0, them.reactionCount) }, (_, i) => ({
      instanceId: `or${i}`,
      cardId: "hidden",
      setOnTurn: 0,
    })),
    activeEvent: them.activeEvent,
    fatigueCounter: 0,
    cardsPlayedThisTurn: 0,
    cardsPlayedLastTurn: 0,
    currentsPlayedThisTurn: [],
    hypeSpentThisTurn: 0,
    confluenceUsedThisTurn: false,
    pureCurrent: them.pureCurrent,
    resonanceProgress: them.resonanceProgress,
    resonanceActivated: false,
    refractionCurrent: null,
    afterpartyRepeatThisTurn: false,
    counters: them.counters,
    mulliganDone: true,
    leaderFiredOnce: [],
    leaderFiredThisTurn: [],
  };
}

/**
 * A `MatchState` good enough to ask legality questions of.
 *
 * Not good enough to *play* — `config` is a fiction, `rngState` is zeroed, and
 * the opponent's private zones are counts wearing a card's clothes. Nothing may
 * apply an intent to it. It exists to be read by the five helpers named at the
 * top of this file and by nothing else, which is why it is not exported from
 * `src/net/index` and why the functions below are the intended door.
 */
export function viewToState(view: PlayerView): MatchState {
  const you = view.you;
  const them = reconstructOpponent(view);
  const players: [PlayerState, PlayerState] = view.seat === 0 ? [you, them] : [them, you];

  return {
    schemaVersion: 1,
    // A fiction, and unreachable: no legality helper reads config. Named
    // decks would be a lie about information the client does not have.
    config: { seed: 0, decks: [{ name: "", leaderCardId: you.leaderCardId, cards: [] }, { name: "", leaderCardId: them.leaderCardId, cards: [] }] },
    rngState: [0, 0, 0, 0],
    turn: view.turn,
    turnOfSeat: [view.turn, view.turn],
    activeSeat: view.activeSeat,
    phase: view.phase,
    players,
    delayed: [],
    comebacks: [],
    aurasDisabledUntilTurn: view.aurasDisabledUntilTurn,
    globalTurnCounter: view.globalTurnCounter,
    winner: view.winner,
    intentCount: 0,
    nextInstanceId: 0,
    wavesLanded: 0,
  };
}

/**
 * What this seat may legally do, computed from the view.
 *
 * The view-side counterpart of `LocalTransport.legality()`, and the reason
 * `legality()` lives on `MatchTransport` at all: the two implementations reach
 * the same engine answers by different routes, and only the transport knows
 * which route it is on. This is the route a `WsTransport` will take.
 *
 * **`canAttack` is left empty.** `attackableBy` reaches `auraModifiersFor` →
 * `evalCondition`, which can read `players[seat].deck[0]` through
 * `topOfDeckMatches` — the one place a sanitized placeholder is genuinely
 * dereferenced, and it would silently answer `false` where the room answers
 * `true`. `attackableFromView` below does the part that *is* sound, and the
 * gap is named rather than papered over with a plausible guess.
 */
export function legalityFromView(view: PlayerView, content: ContentIndex): Legality {
  const yourTurn = isYourTurn(view);
  const state = viewToState(view);
  const confluences = availableConfluences(state, content, view.seat);
  if (!yourTurn) return { ...EMPTY_LEGALITY, confluences };

  const playable = new Set<string>();
  for (const card of view.you.hand) {
    if (checkPlayable(state, content, view.seat, card.instanceId).ok) playable.add(card.instanceId);
  }

  return {
    playable,
    canAttack: new Set(attackableFromView(view, content)),
    confluences,
    canFixation: canUseFixation(state, content, view.seat, "fixation"),
    canUltimate: canUseFixation(state, content, view.seat, "ultimate"),
    canActivateLocation: canActivateLocation(state, content, view.seat),
    yourTurn,
  };
}

/**
 * Which of your characters can attack, decided **without** the aura path.
 *
 * `attackableBy` would be the obvious call and is the one thing from the engine
 * this file must not use: it computes `totalAttack`, which folds in conditional
 * auras, one of whose conditions reads the top of your deck — a card the wire
 * has replaced with a placeholder.
 *
 * So the structural half is done here from public facts only: it is your turn,
 * the body is not summoning-sick, it has attacks left, and it is not Lurking.
 * The aura-dependent half — whether a 0-attack body has been buffed into being
 * able to swing — is the room's to answer, and a client that guesses it wrong
 * greys out a button the server would have allowed. That is a worse outcome
 * than the reverse, so this errs toward *offering* the attack and letting the
 * room refuse it, which is the direction §4.3 says client legality should fail.
 */
export function attackableFromView(view: PlayerView, content: ContentIndex): string[] {
  if (!isYourTurn(view)) return [];
  const out: string[] = [];
  for (const character of view.you.board) {
    if (!character) continue;
    if (character.statuses.some((status) => status.id === "lurking")) continue;
    const sick = character.enteredOnTurn >= view.globalTurnCounter && !character.keywords.includes("raid");
    if (sick) continue;
    if (character.attacksUsedThisTurn >= character.maxAttacksPerTurn) continue;
    // base attack only; an aura could raise a 0 into a legal swing, and the
    // room is the one entitled to know that
    const base = character.attack;
    if (base <= 0 && !hasAnyAura(view, content)) continue;
    out.push(character.instanceId);
  }
  return out;
}

/** Cheap, conservative: is there any aura in play that could be lifting attack? */
function hasAnyAura(view: PlayerView, content: ContentIndex): boolean {
  for (const board of [view.you.board, view.opponent.board]) {
    for (const character of board) {
      if (!character) continue;
      const card = content.cards[character.cardId];
      if (card?.effects?.some((effect) => effect.trigger === "aura")) return true;
    }
  }
  return false;
}

/** Legal attack targets, from the view. Both boards are public, so this is exact. */
export function attackTargetsFromView(view: PlayerView): TargetRef[] {
  return legalAttackTargets(viewToState(view), view.seat);
}

/** Legal equip targets, from the view. Your own board, so this is exact. */
export function equipTargetsFromView(view: PlayerView): TargetRef[] {
  return legalEquipTargets(viewToState(view), view.seat);
}

/** Legal targets for a leader ability, from the view. */
export function fixationTargetsFromView(
  view: PlayerView,
  content: ContentIndex,
  kind: "fixation" | "ultimate"
): TargetRef[] {
  return legalFixationTargets(viewToState(view), content, view.seat, kind);
}

/**
 * Legal targets for a card's chooser, from the view.
 *
 * Exact, for the reason in the file header: target resolution walks the two
 * board arrays and can name only board characters and leaders, so no hidden
 * zone is ever reached.
 */
export function chooseTargetsFromView(
  view: PlayerView,
  content: ContentIndex,
  spec: Parameters<typeof legalChooseTargets>[3],
  sourceCharacter: CharacterInstance | null = null
): TargetRef[] {
  return legalChooseTargets(viewToState(view), content, view.seat, spec, sourceCharacter);
}

/**
 * Is this card playable, from the view?
 *
 * **Refuses any seat but the viewer's.** Asked about the opponent it would read
 * their hand, hit a placeholder, and return `unknownInstance` — which looks
 * exactly like a real refusal and is not one. A throw is the honest answer to a
 * question the client is not entitled to ask.
 */
export function playableFromView(
  view: PlayerView,
  content: ContentIndex,
  seat: Seat,
  instanceId: string
): ReturnType<typeof checkPlayable> {
  if (seat !== view.seat) {
    throw new Error(
      `playableFromView: asked about seat ${seat} from seat ${view.seat}'s view. ` +
        "The opponent's hand is not in a PlayerView, so the answer would be a silent 'unknownInstance' rather than the truth."
    );
  }
  return checkPlayable(viewToState(view), content, seat, instanceId);
}
