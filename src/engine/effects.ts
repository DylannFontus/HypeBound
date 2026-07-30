/**
 * The effects-DSL interpreter: target resolution, amount/condition evaluation,
 * and every opcode. This is what makes cards data rather than code — adding a
 * card that uses existing ops requires no change here.
 *
 * Everything runs against an EffectContext so nested ops (forEach, chooseOne,
 * randomOp) share the same event log, target bindings, and trigger budget.
 */

import type {
  AmountExpr,
  CardDef,
  CardInstance,
  CharacterInstance,
  ConditionExpr,
  ContentIndex,
  CurrentId,
  EffectDef,
  EffectOp,
  EngineEvent,
  LeaderCardDef,
  MatchState,
  PlayerState,
  Seat,
  StatusId,
  TargetFilter,
  TargetRef,
  TargetSpec,
  TriggerId,
} from "./types";
import { getCard } from "./content";
import { nextInt, pickMany, pickWeightedIndex, shuffle } from "./rng";
import {
  allCharacters,
  boardOf,
  cloneState,
  findCharacter,
  firstEmptySlot,
  instantiateCharacter,
  isCharacter,
  nextId,
  otherSeat,
  refOf,
  removeCharacter,
  turnCounterForOwnTurn,
} from "./state";
import {
  absorbDamage,
  applyStatus,
  canBeHealed,
  effectiveAttack,
  effectiveMaxHealth,
  hasStatus,
  isTargetable,
  removeOneStatus,
  removeStatus,
} from "./statuses";
import { advanceResonance } from "./currents";
import { collectTriggers, type TriggerSource } from "./triggers";

/**
 * Triggers that belong to one player and must not fire for the other.
 *
 * types.ts defines each of these in terms of the *controller* — "end of
 * controller's turn", "start of controller's turn", "controller plays another
 * card" — and every card in the game words them the same way ("Afterparty:
 * triggers at the end of **your** turn"). Only three were actually scoped, so
 * the rest fired for both seats:
 *
 * - `afterparty` and `startOfTurn` fired on BOTH players' turns, so every card
 *   with either resolved twice per round. That is an entire faction's mechanic
 *   at double rate, and Juniper Vale's "deal 2 damage at the start of your turn"
 *   dealing 4.
 * - `onCardPlayed` fired for both seats, so Ashvyre's Overclock granted Raid and
 *   Scorched to the ENEMY's character and Chairperson Nobody copied cards the
 *   opponent played into her own hand.
 * - `eventTick` ticked event cards down twice as fast as their duration says.
 *
 * There is no way to express "when the enemy does X" with any of these anyway —
 * that is what Reaction cards are for.
 */
const CONTROLLER_SCOPED: ReadonlySet<TriggerId> = new Set<TriggerId>([
  "afterparty",
  "startOfTurn",
  "eventTick",
  "onCardPlayed",
  "inspire",
  "flow",
  "onConfluenceActivated",
]);

export type Holder = CharacterInstance | PlayerState;

export interface EffectContext {
  state: MatchState;
  content: ContentIndex;
  events: EngineEvent[];
  /** the seat that controls the effect */
  seat: Seat;
  /** the card the effect came from (for event attribution and status sources) */
  sourceCardId: string;
  /** the character the effect belongs to, if any */
  sourceCharacter: CharacterInstance | null;
  /** what `{ select: "triggering" }` resolves to right now */
  binding: TargetRef[];
  /**
   * The hand card that caused the current trigger, for the `onCardDrawn` family.
   *
   * A card in hand is not a TargetRef — TargetRef addresses things on the board —
   * so it cannot ride in `binding`. `modifyTriggeringCardCost` is the only op
   * that reads it.
   */
  triggerCard: CardInstance | null;
  /** player-chosen targets, consumed in order as `choose` selectors are met */
  chosenTargets: TargetRef[];
  /** player-chosen branch indexes, consumed in order by chooseOne ops */
  choices: number[];
  /** cascade depth, capped by balance.rules.triggerCap */
  depth: number;
  /** number of triggered effects resolved so far in this cascade */
  budget: { used: number };
  /**
   * Triggers currently resolving in this cascade, as `sourceId:trigger`.
   * Prevents a listener from re-entering itself — an Inspire that buffs its own
   * character would otherwise re-trigger Inspire until the cascade cap.
   * Shared by reference with child contexts.
   */
  active: Set<string>;
}

export function makeContext(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  sourceCardId: string,
  options: Partial<EffectContext> = {}
): EffectContext {
  return {
    state,
    content,
    events: options.events ?? [],
    seat,
    sourceCardId,
    sourceCharacter: options.sourceCharacter ?? null,
    binding: options.binding ?? [],
    triggerCard: options.triggerCard ?? null,
    chosenTargets: options.chosenTargets ?? [],
    choices: options.choices ?? [],
    depth: options.depth ?? 0,
    budget: options.budget ?? { used: 0 },
    active: options.active ?? new Set<string>(),
  };
}

const emit = (ctx: EffectContext, event: EngineEvent): void => {
  ctx.events.push(event);
};

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function matchesFilter(
  ctx: EffectContext,
  character: CharacterInstance,
  filter: TargetFilter | undefined
): boolean {
  if (!filter) return true;
  const card = ctx.content.cards[character.cardId];
  if (filter.current && !filter.current.includes(character.current)) return false;
  if (filter.faction && (!card || !filter.faction.includes(card.faction))) return false;
  if (filter.tag && !filter.tag.some((t) => character.tags.includes(t))) return false;
  if (filter.type && (!card || !filter.type.includes(card.type))) return false;
  if (filter.costMax !== undefined && (!card || card.cost > filter.costMax)) return false;
  if (filter.costMin !== undefined && (!card || card.cost < filter.costMin)) return false;
  if (filter.hasKeyword && !character.keywords.includes(filter.hasKeyword)) return false;
  if (filter.hasStatus && !hasStatus(character, filter.hasStatus)) return false;
  if (filter.isDamaged !== undefined) {
    const damaged = character.health < effectiveMaxHealth(ctx.content, character);
    if (damaged !== filter.isDamaged) return false;
  }
  if (filter.excludeSelf && ctx.sourceCharacter && character.instanceId === ctx.sourceCharacter.instanceId) return false;
  return true;
}

function seatsForSide(ctx: EffectContext, side: TargetSpec["side"]): Seat[] {
  const own = ctx.seat;
  const foe = otherSeat(ctx.seat);
  if (side === "enemy") return [foe];
  if (side === "any") return [own, foe];
  return [own];
}

/** Board characters legal for this spec, before count limiting. */
function candidateCharacters(ctx: EffectContext, spec: TargetSpec): CharacterInstance[] {
  const out: CharacterInstance[] = [];
  for (const seat of seatsForSide(ctx, spec.side)) {
    for (const character of ctx.state.players[seat].board) {
      if (!character) continue;
      const isEnemyOfActor = seat !== ctx.seat;
      if (isEnemyOfActor && !isTargetable(character, true)) continue;
      if (!matchesFilter(ctx, character, spec.filter)) continue;
      out.push(character);
    }
  }
  return out;
}

/**
 * Resolve a target spec to concrete refs.
 * `choose` pulls from the intent's pre-validated target list; everything else
 * is computed from state (with rng for `random`), keeping resolution
 * deterministic under replay.
 */
export function resolveTargets(ctx: EffectContext, spec: TargetSpec | undefined): TargetRef[] {
  if (!spec) return [];
  const count = spec.count ?? 1;

  switch (spec.select) {
    case "self":
      return ctx.sourceCharacter ? [refOf(ctx.sourceCharacter)] : [];

    case "triggering":
      return [...ctx.binding];

    case "leader": {
      return seatsForSide(ctx, spec.side ?? "friendly").map((seat) => ({ kind: "leader" as const, seat }));
    }

    case "all": {
      if (spec.zone === "location" || spec.zone === "hand" || spec.zone === "deck" || spec.zone === "discard") return [];
      return candidateCharacters(ctx, spec).map(refOf);
    }

    case "adjacent": {
      /**
       * Neighbours are the characters standing either side of the source in
       * the row as the PLAYER SEES IT, not the raw board array indices.
       *
       * The board array is a fixed 6-slot list with holes, but the row is laid
       * out densely and re-centres when a character dies. Using raw indices
       * would make two characters that are visibly side by side count as
       * non-adjacent whenever a gap sat between their slots — the UI would be
       * telling the player something the rules disagreed with. Adjacency reads
       * over the occupied sequence so the two always match.
       */
      const source = ctx.sourceCharacter;
      if (!source) return [];
      const occupied = ctx.state.players[source.controller].board.filter(
        (c): c is CharacterInstance => c !== null
      );
      const index = occupied.findIndex((c) => c.instanceId === source.instanceId);
      if (index < 0) return [];

      const refs: TargetRef[] = [];
      for (const offset of [-1, 1]) {
        const neighbour = occupied[index + offset];
        if (neighbour) refs.push(refOf(neighbour));
      }
      return refs;
    }

    case "random": {
      const pool: TargetRef[] = candidateCharacters(ctx, spec).map(refOf);
      if (spec.side === "enemy" || spec.side === "any") {
        // leaders are only random targets when explicitly allowed by zone
      }
      return pickMany(ctx.state.rngState, pool, count);
    }

    case "highestCost":
    case "lowestCost": {
      const candidates = candidateCharacters(ctx, spec);
      if (candidates.length === 0) return [];
      const costOf = (c: CharacterInstance): number => ctx.content.cards[c.cardId]?.cost ?? 0;
      /**
       * Sort is stable and `candidateCharacters` walks seats then slots, so ties
       * resolve to the leftmost matching character. That is deliberate: breaking
       * them randomly would draw from the shared RNG stream, and an effect whose
       * target depends on how much randomness happened to run before it is not
       * reproducible from a replay's intent log.
       */
      const ordered = [...candidates].sort((a, b) =>
        spec.select === "highestCost" ? costOf(b) - costOf(a) : costOf(a) - costOf(b)
      );
      return ordered.slice(0, count).map(refOf);
    }

    case "choose": {
      const taken = ctx.chosenTargets.splice(0, count);
      return taken;
    }

    default:
      return [];
  }
}

function holderOf(ctx: EffectContext, ref: TargetRef): Holder | null {
  if (ref.kind === "leader") return ctx.state.players[ref.seat];
  return findCharacter(ctx.state, ref.instanceId);
}

/** Legal `choose` targets for the UI and for intent validation. */
/**
 * A state that is safe to ask *questions* about.
 *
 * `resolveTargets`' `select: "random"` branch calls `pickMany(ctx.state.rngState, …)`,
 * and `nextU32` writes the four words of the RNG back **in place**. That is
 * correct while an effect is resolving — the roll is part of the match — and
 * catastrophic in a query: the UI asking "what could this target?" would advance
 * the authoritative RNG, and `MatchState.rngState` is what `replay()` reproduces
 * a match from. A hover would desync the replay of a match still being played.
 *
 * Shallow, with only the RNG copied, because that is the only thing a query is
 * able to write to. `tests/query-purity.test.ts` does not take that on trust: it
 * hashes the whole state before and after every query helper.
 *
 * Today no shipped card reaches the random branch from a query — all 25 leader
 * abilities and every confluence target are `select: "choose"`, and
 * `cardTargetSpecs` admits nothing else. But `legalFixationTargets` forwards
 * `ability.target` verbatim, so the distance between "latent" and "live" is one
 * line of card data, and the failure it would produce (a replay that diverges
 * from the match it recorded) is about the hardest kind there is to trace back
 * to a mouse moving.
 */
function queryState(state: MatchState): MatchState {
  return { ...state, rngState: [...state.rngState] as MatchState["rngState"] };
}

export function legalChooseTargets(
  state: MatchState,
  content: ContentIndex,
  seat: Seat,
  spec: TargetSpec,
  sourceCharacter: CharacterInstance | null = null
): TargetRef[] {
  const ctx = makeContext(queryState(state), content, seat, "", { sourceCharacter });
  if (spec.select !== "choose") return resolveTargets(ctx, spec);
  const refs: TargetRef[] = candidateCharacters(ctx, spec).map(refOf);
  if (spec.zone === undefined || spec.zone === "board") {
    // leaders are valid choose targets only when the filter does not demand
    // character-only properties
    const characterOnly =
      spec.filter?.tag || spec.filter?.hasKeyword || spec.filter?.hasStatus ||
      spec.filter?.current || spec.filter?.isDamaged !== undefined;
    if (!characterOnly && spec.filter?.type?.includes("leader")) {
      for (const s of seatsForSide(ctx, spec.side)) refs.push({ kind: "leader", seat: s });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Amount / condition evaluation
// ---------------------------------------------------------------------------

export function evalAmount(ctx: EffectContext, expr: AmountExpr): number {
  if (typeof expr === "number") return expr;
  switch (expr.kind) {
    case "count":
      return resolveTargets(ctx, expr.target).length;
    case "perTurnCardsPlayed":
      return ctx.state.players[ctx.seat].cardsPlayedThisTurn;
    case "cardsPlayedLastTurn":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].cardsPlayedLastTurn;
    case "obsession":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].obsession;
    case "hypeSpentThisTurn":
      return ctx.state.players[ctx.seat].hypeSpentThisTurn;
    case "fatigueCounter":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].fatigueCounter;
    case "counter":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].counters[expr.key] ?? 0;
    default:
      return 0;
  }
}

export function evalCondition(ctx: EffectContext, expr: ConditionExpr): boolean {
  switch (expr.kind) {
    case "controlsAtLeast":
      return resolveTargets(ctx, expr.target).length >= expr.min;
    case "obsessionAtLeast":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].obsession >= expr.value;
    case "handSizeAtLeast":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].hand.length >= expr.value;
    case "cardsPlayedThisTurnAtLeast":
      return ctx.state.players[ctx.seat].cardsPlayedThisTurn >= expr.value;
    case "leaderHealthAtMost":
      return ctx.state.players[expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat].leaderHealth <= expr.value;
    case "currentPlayedThisTurn":
      return ctx.state.players[ctx.seat].currentsPlayedThisTurn.includes(expr.current);
    case "counterAtLeast": {
      const seat = expr.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      return (ctx.state.players[seat].counters[expr.key] ?? 0) >= expr.value;
    }
    case "topOfDeckMatches": {
      const top = ctx.state.players[ctx.seat].deck[0];
      if (!top) return false;
      const card = ctx.content.cards[top.cardId];
      if (!card) return false;
      const f = expr.filter;
      if (f.current && !f.current.includes(card.current)) return false;
      if (f.faction && !f.faction.includes(card.faction)) return false;
      if (f.type && !f.type.includes(card.type)) return false;
      if (f.tag && !f.tag.some((t) => card.tags.includes(t))) return false;
      if (f.costMax !== undefined && card.cost > f.costMax) return false;
      if (f.costMin !== undefined && card.cost < f.costMin) return false;
      if (f.hasKeyword && !card.keywords.includes(f.hasKeyword)) return false;
      return true;
    }
    case "not":
      return !evalCondition(ctx, expr.c);
    case "and":
      return expr.list.every((c) => evalCondition(ctx, c));
    case "or":
      return expr.list.some((c) => evalCondition(ctx, c));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Core mutations (shared by ops, combat, and the reducer)
// ---------------------------------------------------------------------------

/** Apply damage to a holder, honouring Shielded/Armor and the Obsessed penalty. */
export function dealDamage(
  ctx: EffectContext,
  ref: TargetRef,
  rawAmount: number,
  options: { elementalBonus?: boolean; ignoresShield?: boolean; cantBeHealedUntilNextTurn?: boolean; sourceInstanceId?: string } = {}
): number {
  const holder = holderOf(ctx, ref);
  if (!holder || rawAmount <= 0) return 0;

  let amount = rawAmount;
  const balance = ctx.content.balance;

  // Obsessed leaders take extra damage from every enemy source (canon §3.2)
  if (!isCharacter(holder)) {
    const isEnemySource = holder.seat !== ctx.seat;
    if (isEnemySource && holder.obsession >= balance.obsession.obsessedThreshold) {
      amount += balance.obsession.obsessedExtraDamageTaken;
    }
  }

  const { applied, shieldConsumed, armorAbsorbed } = absorbDamage(holder, amount, options.ignoresShield ?? false);

  if (isCharacter(holder)) {
    holder.health -= applied;
    holder.damagedThisTurn = holder.damagedThisTurn || applied > 0;
    if (options.cantBeHealedUntilNextTurn) {
      holder.healingDisabledUntilTurn = ctx.state.globalTurnCounter + 2;
    }
  } else {
    holder.leaderHealth -= applied;
  }

  emit(ctx, {
    e: "damageDealt",
    target: ref,
    amount: applied,
    elementalBonus: options.elementalBonus ?? false,
    absorbedByShield: shieldConsumed,
    absorbedByArmor: armorAbsorbed,
    source: { cardId: ctx.sourceCardId, ...(options.sourceInstanceId ? { instanceId: options.sourceInstanceId } : {}) },
  });

  if (isCharacter(holder) && applied > 0) {
    fireTrigger(ctx, "onDamaged", [ref]);
  }
  return applied;
}

export function healTarget(ctx: EffectContext, ref: TargetRef, amount: number): number {
  const holder = holderOf(ctx, ref);
  if (!holder || amount <= 0) return 0;

  if (!canBeHealed(ctx.state, holder)) {
    emit(ctx, { e: "healed", target: ref, amount: 0, blocked: true });
    return 0;
  }

  let healed = 0;
  if (isCharacter(holder)) {
    const max = effectiveMaxHealth(ctx.content, holder);
    healed = Math.min(amount, Math.max(0, max - holder.health));
    holder.health += healed;
  } else {
    healed = Math.min(amount, Math.max(0, holder.leaderMaxHealth - holder.leaderHealth));
    holder.leaderHealth += healed;
  }

  emit(ctx, { e: "healed", target: ref, amount: healed, blocked: false });
  if (healed > 0) {
    fireTrigger(ctx, "onHealed", [ref]);
    fireSupportTriggers(ctx, ref);
    /**
     * Flow channel 3 of 4: healed — "on a friendly character **or your
     * leader**", and only when the heal actually restored something (ruling 1:
     * overhealing never triggers, which the `healed > 0` guard already gives).
     *
     * Fired here rather than inside `fireSupportTriggers`, which is also the
     * buff / shield / equip path: those are Inspire's clauses, not Flow's.
     */
    fireFlow(ctx, ref, isCharacter(holder) ? holder.controller : holder.seat);
  }
  return healed;
}

export function buffTarget(ctx: EffectContext, ref: TargetRef, attack: number, health: number): void {
  const holder = holderOf(ctx, ref);
  if (!holder || !isCharacter(holder)) return;
  holder.attack += attack;
  holder.maxHealth += health;
  holder.health += health;
  emit(ctx, { e: "buffApplied", target: ref, attack, health });
  if (attack !== 0 || health !== 0) fireSupportTriggers(ctx, ref);
}

/**
 * "Supporting" a friendly character (heal, shield, buff, equip) fires Inspire,
 * Parasocial, and the once-per-turn Obsession gain (canon §3.2).
 */
export function fireSupportTriggers(ctx: EffectContext, ref: TargetRef): void {
  const holder = holderOf(ctx, ref);
  if (!holder || !isCharacter(holder)) return;
  if (holder.controller !== ctx.seat) return;

  const player = ctx.state.players[ctx.seat];
  const balance = ctx.content.balance;

  if (!player.supportObsessionGainedThisTurn) {
    player.supportObsessionGainedThisTurn = true;
    changeObsession(ctx, ctx.seat, balance.obsession.supportPerTurn, "support");
  }

  if (holder.keywords.includes("parasocial")) {
    holder.attack += 1;
    holder.maxHealth += 1;
    holder.health += 1;
    emit(ctx, { e: "keywordTriggered", seat: holder.controller, instanceId: holder.instanceId, cardId: holder.cardId, keyword: "parasocial" });
    emit(ctx, { e: "buffApplied", target: ref, attack: 1, health: 1 });
    changeObsession(ctx, ctx.seat, 1, "parasocial");
  }

  fireTrigger(ctx, "inspire", [ref]);
}

export function changeObsession(
  ctx: EffectContext,
  seat: Seat,
  delta: number,
  reason: "support" | "parasocial" | "effect" | "fixation" | "fullFixationReset"
): void {
  const player = ctx.state.players[seat];
  const balance = ctx.content.balance;
  const before = player.obsession;
  player.obsession = Math.max(0, Math.min(balance.obsession.max, player.obsession + delta));
  if (player.obsession === before) return;

  emit(ctx, { e: "obsessionChanged", seat, obsession: player.obsession, reason });

  const wasObsessed = before >= balance.obsession.obsessedThreshold;
  const isObsessed = player.obsession >= balance.obsession.obsessedThreshold;
  if (wasObsessed !== isObsessed) {
    emit(ctx, { e: "obsessedThresholdCrossed", seat, nowObsessed: isObsessed });
  }
  if (player.obsession >= balance.obsession.max && before < balance.obsession.max) {
    emit(ctx, { e: "fullFixation", seat });
  }
}

/** Summon a character into the first free slot; returns null if the board is full. */
export function summonCharacter(
  ctx: EffectContext,
  cardId: string,
  seat: Seat,
  fromCardPlay: boolean,
  preferredSlot?: number
): CharacterInstance | null {
  const player = ctx.state.players[seat];
  let slot = preferredSlot;
  if (slot === undefined || slot < 0 || slot >= player.board.length || player.board[slot] !== null) {
    slot = firstEmptySlot(player);
  }
  if (slot < 0) return null;

  const character = instantiateCharacter(ctx.state, ctx.content, cardId, seat, slot);
  player.board[slot] = character;
  emit(ctx, { e: "characterSummoned", seat, instance: structuredClone(character), fromCardPlay });

  if (character.keywords.includes("raid")) {
    emit(ctx, { e: "keywordTriggered", seat, instanceId: character.instanceId, cardId, keyword: "raid" });
  }
  return character;
}

/** Move a defeated character to the discard pile and run its death triggers. */
export function destroyCharacter(ctx: EffectContext, character: CharacterInstance, killerCardId: string | null): void {
  const ref = refOf(character);

  /**
   * The character is dead from here on, whatever its health said a moment ago.
   *
   * `cleanupDefeated` only ever arrives here with health already at or below 0,
   * but the `destroy` op arrives with a character at FULL health — and the
   * last-rites guard below reads "health above 0" as "a revive put it back".
   * Without this line that guard fired on every outright destroy, so `{ op:
   * "destroy" }` cancelled itself: it emitted `defeatPrevented` and returned,
   * leaving the character standing. Zeroing here is what makes the guard mean
   * one thing — *somebody intervened* — on both paths.
   */
  character.health = Math.min(0, character.health);

  const previousSource = ctx.sourceCharacter;
  ctx.sourceCharacter = character;
  fireTrigger(ctx, "onDefeat", [ref], { onlyFor: character });
  ctx.sourceCharacter = previousSource;

  /**
   * Last rites: the controller's other permanents get a say before the body is
   * moved. This is the only window in which a character is both defeated and
   * still standing in its slot, so it is the only place `revive` can put one
   * back without re-summoning it as a fresh instance that lost its buffs.
   */
  fireTrigger(ctx, "onFriendlyDefeated", [ref], { forController: character.controller });
  if (character.health > 0 && findCharacter(ctx.state, character.instanceId)) {
    emit(ctx, {
      e: "defeatPrevented",
      instanceId: character.instanceId,
      cardId: character.cardId,
      health: character.health,
    });
    return;
  }

  removeCharacter(ctx.state, character.instanceId);
  const player = ctx.state.players[character.controller];

  const card = ctx.content.cards[character.cardId];
  if (card && !card.token) {
    player.discard.push({
      instanceId: nextId(ctx.state, "c"),
      cardId: character.cardId,
      costDelta: 0,
      addedKeywords: [],
      removedKeywords: [],
    });
  }
  if (character.equipment) {
    emit(ctx, { e: "equipmentDestroyed", characterInstanceId: character.instanceId, cardId: character.equipment.cardId });
  }

  emit(ctx, { e: "characterDefeated", instance: structuredClone(character), killerCardId });

  // Comeback: schedule the return
  if (card?.comeback && character.keywords.includes("comeback")) {
    const returnsOnTurn = turnCounterForOwnTurn(ctx.state, character.controller, card.comeback.delayTurns);
    ctx.state.comebacks.push({
      cardId: character.cardId,
      mode: card.comeback.mode,
      returnsOnTurn,
      ownerSeat: character.controller,
    });
    emit(ctx, {
      e: "comebackScheduled",
      seat: character.controller,
      cardId: character.cardId,
      returnsOnTurn,
      mode: card.comeback.mode,
    });
  }
}

/** Remove every character whose health has dropped to 0 or below. */
export function cleanupDefeated(ctx: EffectContext, killerCardId: string | null): void {
  let guard = 0;
  for (;;) {
    const dead = allCharacters(ctx.state).find((c) => c.health <= 0);
    if (!dead) break;
    destroyCharacter(ctx, dead, killerCardId);
    if (++guard > 64) break; // structural safety net; cascades are also budget-capped
  }
}

export function drawCards(ctx: EffectContext, seat: Seat, count: number): void {
  const player = ctx.state.players[seat];
  const balance = ctx.content.balance;

  for (let i = 0; i < count; i++) {
    const card = player.deck.shift();
    if (!card) {
      player.fatigueCounter += balance.fatigue.increment;
      const damage = balance.fatigue.start + (player.fatigueCounter - 1) * balance.fatigue.increment;
      player.leaderHealth -= damage;
      emit(ctx, { e: "fatigueDamage", seat, amount: damage });
      continue;
    }
    if (player.hand.length >= balance.hand.limit) {
      player.discard.push(card);
      emit(ctx, { e: "cardBurned", seat, cardId: card.cardId, reason: "handFull" });
      continue;
    }
    player.hand.push(card);
    emit(ctx, { e: "cardDrawn", seat, instanceId: card.instanceId, cardId: card.cardId });

    /**
     * Only cards genuinely drawn from the deck reach here — opening hands are
     * dealt straight off the deck array by `createMatch`, which is the behaviour
     * "every third card you draw" needs: an eight-card mulligan should not have
     * already spent a boss's counter before the first turn.
     */
    const previousCard = ctx.triggerCard;
    ctx.triggerCard = card;
    fireTrigger(ctx, "onCardDrawn", [], { forController: seat });
    fireTrigger(ctx, "onEnemyCardDrawn", [], { forController: otherSeat(seat) });
    ctx.triggerCard = previousCard;
  }
}

export function addCardToHand(
  ctx: EffectContext,
  seat: Seat,
  cardId: string,
  source: "viral" | "copy" | "steal" | "comeback" | "effect",
  costDelta = 0
): void {
  const player = ctx.state.players[seat];
  if (player.hand.length >= ctx.content.balance.hand.limit) {
    emit(ctx, { e: "cardBurned", seat, cardId, reason: "handFull" });
    return;
  }
  const instance = {
    instanceId: nextId(ctx.state, "c"),
    cardId,
    costDelta,
    addedKeywords: [],
    removedKeywords: [],
    ...(source === "viral" ? { viralCopy: true } : {}),
  };
  player.hand.push(instance);
  emit(ctx, { e: "cardAddedToHand", seat, instanceId: instance.instanceId, cardId, source });
}

export function returnCharacterToHand(ctx: EffectContext, character: CharacterInstance): void {
  const card = ctx.content.cards[character.cardId];
  removeCharacter(ctx.state, character.instanceId);
  const player = ctx.state.players[character.controller];

  if (card && !card.token) {
    if (player.hand.length < ctx.content.balance.hand.limit) {
      player.hand.push({
        instanceId: nextId(ctx.state, "c"),
        cardId: character.cardId,
        costDelta: 0,
        addedKeywords: [],
        removedKeywords: [],
        // playing it again is a "replay", Flow's third clause
        returnedFromPlay: true,
      });
      emit(ctx, { e: "characterReturnedToHand", seat: character.controller, instanceId: character.instanceId, cardId: character.cardId });
    } else {
      emit(ctx, { e: "cardBurned", seat: character.controller, cardId: character.cardId, reason: "handFull" });
    }
  } else {
    emit(ctx, { e: "characterDefeated", instance: structuredClone(character), killerCardId: null });
  }

  // Flow channel 1 of 4: returned
  fireFlow(ctx, refOf(character), character.controller);
}

/**
 * Flow, canon's way: `05-keyword-glossary.md` §3.12.
 *
 * The keyword has four channels — **returned**, **replayed**, **healed** and
 * **exchanged** — and only "returned" was implemented, so every card printed
 * with Flow promised three triggers it did not have. Nothing caught it because
 * Flow had no test at all: the keyword existed, so it looked finished.
 *
 * The scope is the subtle part, and the glossary is explicit about it (ruling
 * 3): the channel is relative to **the controller of the card that moved**, not
 * to whoever caused it. An enemy bouncing your character fires *your* Flow —
 * "bouncing a Tide board is a real cost" — and returning an enemy card to their
 * hand fires nothing of yours (ruling 4). Passing `forController` is what buys
 * both, since `flow` is otherwise scoped to the acting seat like any other
 * controller-scoped trigger.
 */
function fireFlow(ctx: EffectContext, ref: TargetRef, controller: Seat): void {
  fireTrigger(ctx, "flow", [ref], { forController: controller });
}

// ---------------------------------------------------------------------------
// Trigger dispatch
// ---------------------------------------------------------------------------

export interface TriggerOptions {
  /** only this character's own listeners — deathrattles, "when THIS attacks" */
  onlyFor?: CharacterInstance;
  /** the card just played, matched against each listener's `playedFilter` */
  playedCard?: CardDef;
  /**
   * Only listeners controlled by this seat.
   *
   * The default scope is "whoever's effect is resolving" (`ctx.seat`), which is
   * right for a card acting on its own behalf but wrong for anything dispatched
   * *about* a player: a death belongs to the dead character's controller and a
   * draw to the drawer, neither of whom need be the seat that caused it. Passing
   * the seat explicitly keeps that out of the caller's ambient context.
   */
  forController?: Seat;
}

/**
 * Fire every listener for `trigger`. Nested triggers share the cascade budget
 * so a loop between two cards fizzles deterministically at the cap.
 */
export function fireTrigger(
  ctx: EffectContext,
  trigger: TriggerId,
  binding: TargetRef[],
  options: TriggerOptions = {}
): void {
  const cap = ctx.content.balance.rules.triggerCap;
  if (ctx.budget.used >= cap) return;

  const { onlyFor, playedCard } = options;
  const scopedTo: Seat | null =
    options.forController ?? (CONTROLLER_SCOPED.has(trigger) ? ctx.seat : null);

  const sources = collectTriggers(ctx.state, ctx.content, trigger).filter((source) => {
    if (onlyFor && source.character?.instanceId !== onlyFor.instanceId) return false;
    if (scopedTo !== null && source.controller !== scopedTo) return false;
    // "the first time each turn" / "once per game" gating
    if (source.effect.once || source.effect.oncePerTurn) {
      const index = effectIndexOf(ctx.content, source.cardId, source.effect);
      const fired = firedLists(ctx.state, source);
      if (fired) {
        if (source.effect.once && fired.once.includes(index)) return false;
        if (source.effect.oncePerTurn && fired.thisTurn.includes(index)) return false;
      }
    }
    // filtered card triggers ("when the enemy plays a character costing 3+")
    if (source.effect.playedFilter && playedCard) {
      if (!cardMatchesFilter(playedCard, source.effect.playedFilter)) return false;
    }
    return true;
  });

  for (const source of sources) {
    if (ctx.budget.used >= cap) {
      emit(ctx, { e: "triggerCapReached", dropped: sources.length });
      return;
    }
    // a character that died mid-cascade stops listening
    if (source.character && !findCharacter(ctx.state, source.character.instanceId) && trigger !== "onDefeat") continue;

    // re-entrancy guard: this listener is already resolving further up the cascade
    const activeKey = `${source.character?.instanceId ?? source.cardId}:${trigger}`;
    if (ctx.active.has(activeKey)) continue;

    ctx.budget.used += 1;
    emit(ctx, { e: "triggerQueued", sourceCardId: source.cardId, trigger, depth: ctx.depth + 1 });

    if (source.effect.once || source.effect.oncePerTurn) {
      const index = effectIndexOf(ctx.content, source.cardId, source.effect);
      const fired = firedLists(ctx.state, source);
      if (fired) {
        if (source.effect.once && !fired.once.includes(index)) fired.once.push(index);
        if (source.effect.oncePerTurn && !fired.thisTurn.includes(index)) fired.thisTurn.push(index);
      }
    }

    const childCtx: EffectContext = {
      ...ctx,
      seat: source.controller,
      sourceCardId: source.cardId,
      sourceCharacter: source.character,
      binding,
      depth: ctx.depth + 1,
      chosenTargets: [], // triggered effects never prompt; they use auto selectors
      choices: [],
    };

    ctx.active.add(activeKey);
    try {
      runEffect(childCtx, source.effect);
    } finally {
      ctx.active.delete(activeKey);
    }
  }
}

/**
 * Where a trigger source's once/oncePerTurn bookkeeping lives.
 *
 * A character keeps it on its own instance. A leader has no instance, so it
 * lives on the player — which is what makes "the first character you play each
 * turn" work on a leader passive at all. Locations and events return null: they
 * have their own `usedThisTurn` gating and no card uses once/oncePerTurn on one,
 * so inventing storage for them would be untested machinery.
 */
function firedLists(
  state: MatchState,
  source: TriggerSource
): { once: number[]; thisTurn: number[] } | null {
  if (source.character) return { once: source.character.firedOnce, thisTurn: source.character.firedThisTurn };
  const player = state.players[source.controller];
  if (player.leaderCardId === source.cardId) {
    return { once: player.leaderFiredOnce, thisTurn: player.leaderFiredThisTurn };
  }
  return null;
}

/**
 * Index of an effect within its card, used to key once/oncePerTurn tracking.
 *
 * Leader passives live in their own array, so they are keyed in their own range
 * — sharing the numbering with `effects` would let a leader's second passive and
 * its second effect mark each other as already fired.
 */
const PASSIVE_INDEX_BASE = 1000;

function effectIndexOf(content: ContentIndex, cardId: string, effect: EffectDef): number {
  const card = content.cards[cardId];
  if (!card) return -1;
  const direct = card.effects.indexOf(effect);
  if (direct >= 0) return direct;

  const passives = (card as LeaderCardDef).passive;
  if (passives) {
    const exact = passives.indexOf(effect);
    if (exact >= 0) return PASSIVE_INDEX_BASE + exact;
    const byShape = passives.findIndex((e) => e.trigger === effect.trigger && e.text === effect.text);
    if (byShape >= 0) return PASSIVE_INDEX_BASE + byShape;
  }
  return card.effects.findIndex((e) => e.trigger === effect.trigger && e.text === effect.text);
}

/** Does a played card satisfy a playedFilter? (card-level, not instance-level) */
export function cardMatchesFilter(card: CardDef, filter: TargetFilter): boolean {
  if (filter.current && !filter.current.includes(card.current)) return false;
  if (filter.faction && !filter.faction.includes(card.faction)) return false;
  if (filter.type && !filter.type.includes(card.type)) return false;
  if (filter.tag && !filter.tag.some((t) => card.tags.includes(t))) return false;
  if (filter.costMax !== undefined && card.cost > filter.costMax) return false;
  if (filter.costMin !== undefined && card.cost < filter.costMin) return false;
  if (filter.hasKeyword && !card.keywords.includes(filter.hasKeyword)) return false;
  return true;
}

/** Run one effect definition: check its condition, resolve its target, run ops. */
export function runEffect(ctx: EffectContext, effect: EffectDef): void {
  if (effect.condition && !evalCondition(ctx, effect.condition)) return;

  if (effect.target) {
    const refs = resolveTargets(ctx, effect.target);
    if (refs.length === 0 && !effect.target.optional && effect.target.select === "choose") return;
    ctx.binding = refs;
  }
  runOps(ctx, effect.ops);
}

// ---------------------------------------------------------------------------
// Opcode interpreter
// ---------------------------------------------------------------------------

export function runOps(ctx: EffectContext, ops: EffectOp[]): void {
  for (const op of ops) runOp(ctx, op);
}

function targetsFor(ctx: EffectContext, spec: TargetSpec): TargetRef[] {
  return resolveTargets(ctx, spec);
}

/**
 * Which of these cards would hurt `player` most to lose — used by `scry`'s
 * "bottomOne, pick: mostPlayable" to take a decision on their behalf.
 *
 * "The opponent chooses which of these you draw" is a real design idea and an
 * awkward one to implement: a genuine prompt would need the engine to suspend a
 * turn mid-resolution and wait on the other seat, and against an AI it would be
 * a pause with no visible decision behind it. This is the honest substitute — a
 * stated rule, applied identically every time, that any player can read off the
 * board: the card you could actually cast right now goes away, dearest first,
 * and if you could cast none of them the cheapest one goes instead.
 *
 * Ties keep the earlier card, so it consumes no randomness and replays exactly.
 */
function mostPlayableIndex(content: ContentIndex, cards: CardInstance[], player: PlayerState): number {
  let best = 0;
  let bestScore = -Infinity;
  cards.forEach((card, index) => {
    const cost = Math.max(0, (content.cards[card.cardId]?.cost ?? 0) + card.costDelta);
    const score = cost <= player.hype ? 100 + cost : -cost;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function eachCharacter(ctx: EffectContext, refs: TargetRef[], fn: (character: CharacterInstance, ref: TargetRef) => void): void {
  for (const ref of refs) {
    const holder = holderOf(ctx, ref);
    if (holder && isCharacter(holder)) fn(holder, ref);
  }
}

export function runOp(ctx: EffectContext, op: EffectOp): void {
  const { state, content } = ctx;

  switch (op.op) {
    case "damage": {
      const amount = evalAmount(ctx, op.amount);
      for (const ref of targetsFor(ctx, op.target)) {
        dealDamage(ctx, ref, amount, {
          ...(op.ignoresShield ? { ignoresShield: true } : {}),
          ...(op.cantBeHealedUntilNextTurn ? { cantBeHealedUntilNextTurn: true } : {}),
        });
      }
      cleanupDefeated(ctx, ctx.sourceCardId);
      break;
    }

    case "heal": {
      const amount = evalAmount(ctx, op.amount);
      for (const ref of targetsFor(ctx, op.target)) healTarget(ctx, ref, amount);
      break;
    }

    case "buff": {
      const attack = op.attack !== undefined ? evalAmount(ctx, op.attack) : 0;
      const health = op.health !== undefined ? evalAmount(ctx, op.health) : 0;
      for (const ref of targetsFor(ctx, op.target)) buffTarget(ctx, ref, attack, health);
      break;
    }

    case "setStats": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character, ref) => {
        character.attack = op.attack;
        character.maxHealth = op.health;
        character.health = op.health;
        emit(ctx, { e: "statsSet", target: ref, attack: op.attack, health: op.health });
      });
      break;
    }

    case "summon": {
      const count = op.count !== undefined ? evalAmount(ctx, op.count) : 1;
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      for (let i = 0; i < count; i++) summonCharacter(ctx, op.cardId, seat, false);
      break;
    }

    case "draw": {
      const count = evalAmount(ctx, op.count);
      drawCards(ctx, op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat, count);
      break;
    }

    case "discard": {
      const seat = op.target.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      const count = op.count !== undefined ? evalAmount(ctx, op.count) : 1;
      for (let i = 0; i < count && player.hand.length > 0; i++) {
        const index = nextInt(state.rngState, player.hand.length);
        const [card] = player.hand.splice(index, 1);
        if (!card) break;
        player.discard.push(card);
        emit(ctx, { e: "cardDiscarded", seat, cardId: card.cardId });
        const cardDef = content.cards[card.cardId];
        if (cardDef?.effects.some((e) => e.trigger === "onDiscard")) {
          const child = { ...ctx, seat, sourceCardId: card.cardId, sourceCharacter: null, binding: [] as TargetRef[] };
          for (const effect of cardDef.effects.filter((e) => e.trigger === "onDiscard")) runEffect(child, effect);
        }
      }
      break;
    }

    case "returnToHand": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => returnCharacterToHand(ctx, character));
      break;
    }

    case "applyStatus": {
      for (const ref of targetsFor(ctx, op.target)) {
        const holder = holderOf(ctx, ref);
        if (!holder) continue;
        const instance = applyStatus(holder, op.status, op.amount, op.durationTurns, ctx.sourceCardId);
        if (instance) emit(ctx, { e: "statusApplied", target: ref, status: structuredClone(instance) });
        /**
         * Armor on a leader is a scalar, not a status instance, so `applyStatus`
         * returns null for it and the line above emits nothing. Without this the
         * gain is silent and a view-based client never learns about it.
         */
        else if (op.status === "armor" && ref.kind === "leader") {
          emit(ctx, {
            e: "armorChanged",
            seat: ref.seat,
            armor: ctx.state.players[ref.seat].armor,
            delta: op.amount ?? 0,
          });
        }
        const positive = content.statuses[op.status]?.polarity === "positive";
        if (positive) fireSupportTriggers(ctx, ref);
      }
      break;
    }

    case "removeStatus": {
      for (const ref of targetsFor(ctx, op.target)) {
        const holder = holderOf(ctx, ref);
        if (!holder) continue;
        const removed = op.status !== undefined || op.polarity === undefined
          ? removeStatus(content, holder, op.status, op.polarity)
          : [removeOneStatus(content, holder, op.polarity)].filter((s): s is StatusId => s !== null);
        for (const status of removed) emit(ctx, { e: "statusRemoved", target: ref, status });
      }
      break;
    }

    case "destroy": {
      const refs = targetsFor(ctx, op.target);
      eachCharacter(ctx, refs, (character) => destroyCharacter(ctx, character, ctx.sourceCardId));
      break;
    }

    case "transform": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        const seat = character.controller;
        const slot = character.slot;
        removeCharacter(state, character.instanceId);
        const replacement = instantiateCharacter(state, content, op.intoCardId, seat, slot);
        state.players[seat].board[slot] = replacement;
        emit(ctx, { e: "characterTransformed", oldInstanceId: character.instanceId, instance: structuredClone(replacement) });
        // Flow channel 4: exchanged
        fireFlow(ctx, refOf(replacement), seat);
      });
      break;
    }

    case "copyCardToHand": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        addCardToHand(ctx, ctx.seat, character.cardId, "copy", op.costDelta ?? 0);
      });
      break;
    }

    case "stealCopy": {
      const foe = state.players[otherSeat(ctx.seat)];
      const pool = op.from === "enemyHand" ? foe.hand : op.from === "enemyDeck" ? foe.deck : foe.discard;
      const count = op.count ?? 1;
      for (let i = 0; i < count && pool.length > 0; i++) {
        const index = nextInt(state.rngState, pool.length);
        const card = pool[index];
        if (card) addCardToHand(ctx, ctx.seat, card.cardId, "steal");
      }
      break;
    }

    case "banish": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        removeCharacter(state, character.instanceId);
        /**
         * "Returns at the start of your next turn" is measured from the BANISHED
         * character's controller, not the caster's. Touch Grass banishes your own
         * character so the two coincide, which is why this went unnoticed; an
         * effect that banishes an enemy would have brought it back on the wrong
         * turn — and `returnBanished` only ever runs on its owner's turn, so a
         * seat-1 timestamp on a seat-0 character strands it an extra round.
         */
        const returnsOnTurn =
          op.returnAtStartOfYourNextTurn === false ? null : turnCounterForOwnTurn(state, character.controller, 1);
        const stripped: CharacterInstance = {
          ...structuredClone(character),
          attack: character.baseAttack,
          health: character.baseHealth,
          maxHealth: character.baseHealth,
          statuses: [],
          equipment: null,
          ...(returnsOnTurn !== null ? { banishedUntilTurn: returnsOnTurn } : {}),
        };
        if (returnsOnTurn !== null) state.players[character.controller].banished.push(stripped);
        if (character.equipment) {
          emit(ctx, { e: "equipmentDestroyed", characterInstanceId: character.instanceId, cardId: character.equipment.cardId });
        }
        emit(ctx, { e: "characterBanished", instanceId: character.instanceId, cardId: character.cardId, returnsOnTurn });
        // the source card's keyword, so the source's controller — not the
        // controller of the character being banished by it
        emit(ctx, { e: "keywordTriggered", seat: ctx.seat, instanceId: character.instanceId, cardId: ctx.sourceCardId, keyword: "touch-grass" });
      });
      break;
    }

    case "cancel": {
      for (const ref of targetsFor(ctx, op.target)) {
        const holder = holderOf(ctx, ref);
        if (!holder || !isCharacter(holder)) continue;
        const instance = applyStatus(holder, "cancelled", undefined, op.durationTurns, ctx.sourceCardId);
        if (instance) emit(ctx, { e: "statusApplied", target: ref, status: structuredClone(instance) });
      }
      break;
    }

    case "destroyEquipment": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        if (!character.equipment) return;
        const cardId = character.equipment.cardId;
        character.equipment = null;
        emit(ctx, { e: "equipmentDestroyed", characterInstanceId: character.instanceId, cardId });
      });
      break;
    }

    case "gainHype": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      const amount = evalAmount(ctx, op.amount);
      if (op.permanent) {
        /**
         * Recorded in `bonusHypeMax` as well, because a turn start RECOMPUTES
         * hypeMax from the turn counter instead of incrementing it. Writing only
         * to hypeMax made "permanently" last exactly one turn — which is what
         * Annual Shareholder Meeting (a 7-Obsession Ultimate) and Brand
         * Partnership were both quietly doing.
         *
         * The Hype it hands you now is the amount the cap actually allowed, so a
         * player already at 10 max gains nothing rather than a free floating point
         * of Hype every turn.
         */
        const before = player.hypeMax;
        const cap = content.balance.hype.cap;
        player.bonusHypeMax = Math.min(cap, player.bonusHypeMax + amount);
        player.hypeMax = Math.min(cap, player.hypeMax + amount);
        player.hype += player.hypeMax - before;
      } else {
        player.tempHypeThisTurn += amount;
        player.hype += amount;
      }
      emit(ctx, { e: "hypeChanged", seat, hype: player.hype, hypeMax: player.hypeMax, temp: player.tempHypeThisTurn });
      break;
    }

    case "lockHype": {
      const player = state.players[ctx.seat];
      player.hypeLockedNextTurn += op.amount;
      emit(ctx, { e: "hypeLocked", seat: ctx.seat, amount: op.amount });
      emit(ctx, { e: "keywordTriggered", seat: ctx.seat, instanceId: null, cardId: ctx.sourceCardId, keyword: "overload" });
      break;
    }

    case "gainObsession": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      changeObsession(ctx, seat, evalAmount(ctx, op.amount), "effect");
      break;
    }

    case "removeObsession": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      changeObsession(ctx, seat, -evalAmount(ctx, op.amount), "effect");
      break;
    }

    case "addKeyword": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character, ref) => {
        if (character.keywords.includes(op.keyword)) return;
        character.keywords.push(op.keyword);
        emit(ctx, { e: "keywordAdded", target: ref, keyword: op.keyword });
      });
      break;
    }

    case "removeKeyword": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character, ref) => {
        if (!character.keywords.includes(op.keyword)) return;
        character.keywords = character.keywords.filter((k) => k !== op.keyword);
        emit(ctx, { e: "keywordRemoved", target: ref, keyword: op.keyword });
      });
      break;
    }

    case "modifyCost": {
      const seat = op.target.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      for (const card of player.hand) {
        const def = content.cards[card.cardId];
        if (!def) continue;
        if (op.target.filter?.type && !op.target.filter.type.includes(def.type)) continue;
        if (op.target.filter?.current && !op.target.filter.current.includes(def.current)) continue;
        if (op.target.filter?.tag && !op.target.filter.tag.some((t) => def.tags.includes(t))) continue;
        card.costDelta += op.delta;
        emit(ctx, { e: "costModified", seat, instanceId: card.instanceId, delta: op.delta });
      }
      break;
    }

    case "chooseOne": {
      const index = ctx.choices.length > 0 ? (ctx.choices.shift() ?? 0) : 0;
      const option = op.options[Math.max(0, Math.min(op.options.length - 1, index))];
      if (option) {
        emit(ctx, { e: "chooseOneResolved", cardId: ctx.sourceCardId, optionLabel: option.label });
        runOps(ctx, option.ops);
      }
      break;
    }

    case "randomOp": {
      const index = pickWeightedIndex(state.rngState, op.options.map((o) => o.weight));
      const option = op.options[index];
      if (option) {
        emit(ctx, { e: "randomResolved", cardId: ctx.sourceCardId, optionIndex: index });
        runOps(ctx, option.ops);
      }
      break;
    }

    case "forEach": {
      const refs = targetsFor(ctx, op.target);
      const savedBinding = ctx.binding;
      for (const ref of refs) {
        ctx.binding = [ref];
        runOps(ctx, op.ops);
      }
      ctx.binding = savedBinding;
      break;
    }

    case "if": {
      if (evalCondition(ctx, op.condition)) runOps(ctx, op.then);
      else if (op.else) runOps(ctx, op.else);
      break;
    }

    case "scheduleDelayed": {
      const triggersOnTurn = turnCounterForOwnTurn(state, ctx.seat, op.delayTurns);
      state.delayed.push({
        triggersOnTurn,
        ownerSeat: ctx.seat,
        ops: structuredClone(op.ops),
        label: op.label,
        sourceCardId: ctx.sourceCardId,
      });
      emit(ctx, { e: "delayedScheduled", seat: ctx.seat, label: op.label, triggersOnTurn });
      break;
    }

    case "disableAuras": {
      state.aurasDisabledUntilTurn = state.globalTurnCounter + op.durationTurns * 2;
      emit(ctx, { e: "aurasDisabled", untilTurn: state.aurasDisabledUntilTurn });
      break;
    }

    case "resurrect": {
      const player = state.players[ctx.seat];
      const count = op.count ?? 1;
      /**
       * The op picks at random from the discard, and it reads its target's
       * FILTER — which it did not, for its whole life. Every shipped use happens
       * to filter on `type: character`, which the op already hardcoded, so the
       * two agreed by luck; a card written to return "a random Idol" would have
       * quietly returned anything. Same shape as `buff.permanent`: a field in the
       * schema that nothing read, waiting for somebody to rely on it.
       */
      const filter = op.target?.filter;
      const candidates = player.discard.filter((card) => {
        const def = content.cards[card.cardId];
        if (!def || def.type !== "character") return false;
        return filter ? cardMatchesFilter(def, filter) : true;
      });
      for (let i = 0; i < count && candidates.length > 0; i++) {
        const index = nextInt(state.rngState, candidates.length);
        const card = candidates.splice(index, 1)[0];
        if (!card) break;
        player.discard = player.discard.filter((c) => c.instanceId !== card.instanceId);
        const summoned = summonCharacter(ctx, card.cardId, ctx.seat, false);
        if (summoned) emit(ctx, { e: "characterResurrected", seat: ctx.seat, instance: structuredClone(summoned) });
      }
      break;
    }

    case "mill": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      const count = evalAmount(ctx, op.count);
      for (let i = 0; i < count; i++) {
        const card = player.deck.shift();
        if (!card) break;
        player.discard.push(card);
        emit(ctx, { e: "cardMilled", seat, cardId: card.cardId });
      }
      break;
    }

    case "scry": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      const top = player.deck.slice(0, op.count);
      if (op.mode === "bottomOne" && top.length > 0) {
        const index =
          op.pick === "mostPlayable" ? mostPlayableIndex(content, top, player) : nextInt(state.rngState, top.length);
        const card = top[index];
        if (card) {
          player.deck = player.deck.filter((c) => c.instanceId !== card.instanceId);
          player.deck.push(card);
        }
      } else if (op.mode === "reorder" && top.length > 1) {
        const reordered = [...top];
        shuffle(state.rngState, reordered);
        player.deck.splice(0, top.length, ...reordered);
      }
      emit(ctx, { e: "deckScryed", seat, count: op.count });
      break;
    }

    case "revive": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        // only catches a character mid-defeat; there is nothing to save otherwise
        if (character.health > 0) return;
        character.health = Math.max(1, Math.min(op.health, effectiveMaxHealth(content, character)));
      });
      break;
    }

    case "rotateLeaderCurrent": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      // the advantage relation IS the cycle: each natural Current beats exactly
      // one, validated at load time. Prism beats nothing, so it cannot rotate.
      const next = content.currents[player.leaderCurrent]?.beats[0];
      if (!next || next === player.leaderCurrent) break;
      const from = player.leaderCurrent;
      player.leaderCurrent = next;
      emit(ctx, { e: "leaderCurrentChanged", seat, from, to: next });
      break;
    }

    case "modifyTriggeringCardCost": {
      const card = ctx.triggerCard;
      if (!card) break;
      card.costDelta += op.delta;
      // the card is in the DRAWER's hand, who is not the listener's controller
      const owner = state.players.find((p) => p.hand.some((c) => c.instanceId === card.instanceId));
      emit(ctx, { e: "costModified", seat: owner?.seat ?? ctx.seat, instanceId: card.instanceId, delta: op.delta });
      break;
    }

    case "swapAttackHealth": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character, ref) => {
        const attack = character.attack;
        character.attack = character.health;
        character.health = attack;
        character.maxHealth = Math.max(character.maxHealth, character.health);
        emit(ctx, { e: "statsSet", target: ref, attack: character.attack, health: character.health });
        // Flow channel 4: exchanged
        fireFlow(ctx, ref, character.controller);
      });
      break;
    }

    case "refract": {
      const chosen: CurrentId = op.intoCurrent ?? "prism";
      if (ctx.sourceCharacter) {
        ctx.sourceCharacter.current = chosen;
        // the character's controller, not ctx.seat: an effect can refract a
        // body that is not its caster's
        emit(ctx, { e: "refracted", seat: ctx.sourceCharacter.controller, instanceId: ctx.sourceCharacter.instanceId, intoCurrent: chosen });
        // Flow channel 4: exchanged
        fireFlow(ctx, refOf(ctx.sourceCharacter), ctx.sourceCharacter.controller);
      }
      break;
    }

    case "attackAgain": {
      eachCharacter(ctx, targetsFor(ctx, op.target), (character) => {
        character.attacksUsedThisTurn = Math.max(0, character.attacksUsedThisTurn - 1);
      });
      break;
    }

    case "addCounter":
    case "setCounter": {
      const seat = op.side === "enemy" ? otherSeat(ctx.seat) : ctx.seat;
      const player = state.players[seat];
      const amount = evalAmount(ctx, op.amount);
      const before = player.counters[op.key] ?? 0;
      const next = op.op === "addCounter" ? before + amount : amount;
      player.counters[op.key] = Math.max(0, next);
      emit(ctx, { e: "counterChanged", seat, key: op.key, value: player.counters[op.key]!, delta: player.counters[op.key]! - before });
      break;
    }

    case "winMatch": {
      state.winner = ctx.seat;
      state.phase = "ended";
      emit(ctx, { e: "matchEnded", winner: ctx.seat, reason: "finale" });
      break;
    }

    case "repeatAfterpartyThisTurn": {
      state.players[ctx.seat].afterpartyRepeatThisTurn = true;
      break;
    }

    case "aura":
      // auras are read-time modifiers (see auraModifiers); nothing to run here
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Aura evaluation (read-time, so Eclipse can suspend it)
// ---------------------------------------------------------------------------

export interface AuraModifier {
  attack: number;
  health: number;
  grantedKeywords: string[];
}

/** Total aura contribution affecting a character right now. */
export function auraModifiersFor(
  state: MatchState,
  content: ContentIndex,
  character: CharacterInstance
): AuraModifier {
  const result: AuraModifier = { attack: 0, health: 0, grantedKeywords: [] };
  if (state.aurasDisabledUntilTurn > state.globalTurnCounter) return result;

  /**
   * A query, and therefore RNG-safe — see `queryState`.
   *
   * This one is the less obvious of the two. A *conditional* aura evaluates its
   * condition below, `evalCondition` can count a `TargetSpec`, and a spec with
   * `select: "random"` would roll the dice. `totalAttack` calls this, and
   * `attackableBy` calls that, and the battle screen calls *that* on every
   * refresh — so the aura path is how a redraw would have advanced the match's
   * RNG.
   */
  const querySafe = queryState(state);
  for (const source of collectTriggers(querySafe, content, "aura")) {
    const ctx = makeContext(querySafe, content, source.controller, source.cardId, { sourceCharacter: source.character });

    /**
     * A conditional aura applies only while its condition holds.
     *
     * This was not checked at all, so "while you control three or more
     * characters, they have +1 attack" was simply "+1 attack" — and the only
     * shipped card with a conditional aura is a boss twist, where a permanently-on
     * modifier is exactly the kind of quiet wrongness a rule twist is supposed to
     * make legible. Auras are recomputed on every read, so the condition is
     * re-evaluated each time and the modifier comes and goes with the board.
     */
    if (source.effect.condition && !evalCondition(ctx, source.effect.condition)) continue;

    for (const op of source.effect.ops) {
      if (op.op !== "aura") continue;
      const affected = resolveTargets(ctx, op.target);
      if (!affected.some((ref) => ref.kind === "character" && ref.instanceId === character.instanceId)) continue;
      result.attack += op.attack ?? 0;
      result.health += op.health ?? 0;
      if (op.grantKeyword) result.grantedKeywords.push(op.grantKeyword);
    }
  }
  return result;
}

/** Attack value including auras — what combat and the UI should use. */
export function totalAttack(state: MatchState, content: ContentIndex, character: CharacterInstance): number {
  if (hasStatus(character, "cancelled")) return 0;
  return Math.max(0, effectiveAttack(content, character) + auraModifiersFor(state, content, character).attack);
}

export { boardOf, cloneState, otherSeat };
