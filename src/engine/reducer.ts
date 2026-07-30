/**
 * applyIntent — the ONLY way MatchState changes.
 *
 * Every call clones the incoming state, mutates the clone, and returns it with
 * the EngineEvent list the UI animates from. Randomness comes exclusively from
 * state.rngState, so (seed, intents[]) always reproduces the same match.
 */

import type {
  ApplyResult,
  CardDef,
  CardInstance,
  CharacterInstance,
  ContentIndex,
  CurrentId,
  EngineEvent,
  EquipmentCardDef,
  EventCardDef,
  LeaderCardDef,
  LocationCardDef,
  MatchState,
  PlayerIntent,
  PlayerState,
  ReactionConditionId,
  Seat,
  TargetRef,
} from "./types";
import { cloneState, dealCharacter, findCharacter, firstEmptySlot, nextId, otherSeat, refOf, boardOf } from "./state";
import { RulesError, canActivateLocation, canUseFixation, checkPlayable, effectiveCost } from "./intents";
import { canAttack, isLegalAttackTarget, resolveAttack } from "./combat";
import { advanceResonance, canActivateConfluence, refractionPartner } from "./currents";
import {
  addCardToHand,
  cardMatchesFilter,
  cleanupDefeated,
  drawCards,
  fireSupportTriggers,
  fireTrigger,
  makeContext,
  runEffect,
  runOps,
  summonCharacter,
  type EffectContext,
} from "./effects";
import { hasStatus, tickStatuses } from "./statuses";
import { checkVictory } from "./victory";

/**
 * Apply one intent. Throws RulesError for illegal intents — the UI is expected
 * to prevent these, and the match driver surfaces them without crashing.
 */
export function applyIntent(state: MatchState, content: ContentIndex, intent: PlayerIntent): ApplyResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [];
  next.intentCount += 1;

  if (next.winner !== null && intent.type !== "concede") {
    return { state: next, events };
  }

  switch (intent.type) {
    case "mulligan":
      applyMulligan(next, content, events, intent.seat, intent.replaceInstanceIds);
      break;
    case "playCard":
      applyPlayCard(next, content, events, intent);
      break;
    case "attack":
      applyAttack(next, content, events, intent);
      break;
    case "useFixation":
      applyFixation(next, content, events, intent);
      break;
    case "activateLocation":
      applyActivateLocation(next, content, events, intent);
      break;
    case "activateConfluence":
      applyConfluence(next, content, events, intent);
      break;
    case "endTurn":
      applyEndTurn(next, content, events, intent.seat);
      break;
    case "concede":
      next.winner = otherSeat(intent.seat);
      next.phase = "ended";
      events.push({ e: "matchEnded", winner: next.winner, reason: "concede" });
      break;
    default:
      throw new RulesError("invalidIntent", `Unknown intent: ${(intent as { type: string }).type}`);
  }

  checkVictory(next, events);
  return { state: next, events };
}

// ---------------------------------------------------------------------------
// Mulligan
// ---------------------------------------------------------------------------

function applyMulligan(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  seat: Seat,
  replaceIds: string[]
): void {
  if (state.phase !== "mulligan") throw new RulesError("wrongPhase", "Mulligan is over");
  const player = state.players[seat];
  if (player.mulliganDone) throw new RulesError("wrongPhase", "Already mulliganed");

  const replacing = player.hand.filter((c) => replaceIds.includes(c.instanceId));
  player.hand = player.hand.filter((c) => !replaceIds.includes(c.instanceId));

  const ctx = makeContext(state, content, seat, "mulligan", { events });
  // draw replacements first, then shuffle the returned cards back in — this is
  // what stops a mulliganed card from being redrawn immediately
  const drawnBefore = player.hand.length;
  for (let i = 0; i < replacing.length; i++) {
    const card = player.deck.shift();
    if (card) player.hand.push(card);
  }
  for (const card of replacing) player.deck.push(card);
  shuffleDeck(state, player);
  void drawnBefore;
  void ctx;

  player.mulliganDone = true;
  events.push({ e: "mulliganDone", seat, kept: player.hand.length - replacing.length, replaced: replacing.length });

  if (state.players[0].mulliganDone && state.players[1].mulliganDone) {
    state.phase = "main";
    events.push({
      e: "matchStarted",
      firstSeat: state.activeSeat,
      leaders: [state.players[0].leaderCardId, state.players[1].leaderCardId],
    });
    startTurn(state, content, events, state.activeSeat);
  }
}

function shuffleDeck(state: MatchState, player: PlayerState): void {
  // Fisher-Yates using the match rng (kept local to avoid an import cycle)
  const deck = player.deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const [a, b, c, d] = state.rngState;
    let t = (a + b) | 0;
    state.rngState[0] = b ^ (b >>> 9);
    state.rngState[1] = (c + (c << 3)) | 0;
    state.rngState[3] = (d + 1) | 0;
    t = (t + state.rngState[3]) | 0;
    state.rngState[2] = ((((c << 21) | (c >>> 11)) >>> 0) + t) | 0;
    const j = (t >>> 0) % (i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Turn boundaries
// ---------------------------------------------------------------------------

/**
 * Begin a scripted match that skips the mulligan.
 *
 * Tutorial stages 1-6 teach before they test, so there is no mulligan to make.
 * This runs the exact transition the mulligan phase would have run — mark both
 * players done, announce the match, start the first turn — so the player gets
 * their Hype and opening draw like anyone else. It deliberately does not
 * reshuffle: a scripted stage authored its deck order on purpose.
 *
 * Safe to call twice; it no-ops once the match has left the mulligan phase.
 */
export function beginScriptedMatch(state: MatchState, content: ContentIndex): EngineEvent[] {
  if (state.phase !== "mulligan") return [];
  const events: EngineEvent[] = [];
  for (const player of state.players) player.mulliganDone = true;
  state.phase = "main";
  events.push({
    e: "matchStarted",
    firstSeat: state.activeSeat,
    leaders: [state.players[0].leaderCardId, state.players[1].leaderCardId],
  });
  startTurn(state, content, events, state.activeSeat);
  return events;
}

function startTurn(state: MatchState, content: ContentIndex, events: EngineEvent[], seat: Seat): void {
  const player = state.players[seat];
  const balance = content.balance;

  state.activeSeat = seat;
  state.turnOfSeat[seat] += 1;

  // Hype: max grows with your own turn count plus anything effects granted
  // permanently, capped; Overload locks part of it. This RECOMPUTES rather than
  // increments, which is why permanent grants have to be stored separately —
  // see PlayerState.bonusHypeMax.
  player.hypeMax = Math.min(balance.hype.cap, state.turnOfSeat[seat] + player.bonusHypeMax);
  const locked = player.hypeLockedNextTurn;
  player.hype = Math.max(0, player.hypeMax - locked);
  player.hypeLockedNextTurn = 0;
  player.tempHypeThisTurn = 0;
  player.cardsPlayedThisTurn = 0;
  player.currentsPlayedThisTurn = [];
  player.hypeSpentThisTurn = 0;
  player.confluenceUsedThisTurn = false;
  player.fixationUsedThisTurn = false;
  player.supportObsessionGainedThisTurn = false;
  player.refractionCurrent = null;
  player.afterpartyRepeatThisTurn = false;
  if (player.location) player.location.usedThisTurn = false;
  player.leaderFiredThisTurn = [];
  for (const character of boardOf(state, seat)) {
    character.attacksUsedThisTurn = 0;
    character.firedThisTurn = [];
  }

  events.push({
    e: "turnStarted",
    seat,
    turn: state.turnOfSeat[seat],
    hype: player.hype,
    hypeMax: player.hypeMax,
    lockedHype: locked,
  });

  const ctx = makeContext(state, content, seat, "turn-start", { events });

  returnBanished(ctx, seat);
  returnComebacks(ctx, seat);
  resolveDelayed(ctx, seat);

  /**
   * Reinforcements, after the returns and before anything reads the board.
   *
   * After the returns because a banished character walking back on means the
   * board is not actually empty, and "the board is empty" is one of the two cues
   * a wave can be written against. Before the triggers because a `startOfTurn`
   * passive that counts characters should count the ones standing in front of
   * it, not the ones that were there a moment ago.
   */
  landDueWave(state, content, events, seat);

  /**
   * The opponent's window, deliberately BEFORE the draw.
   *
   * Everything that wants this trigger wants to interfere with the draw that is
   * about to happen — "the boss decides which of your top two cards you get" is
   * not a rule if it only applies from your second turn onwards. `startOfTurn`
   * keeps firing after the draw, where a card can react to what it just drew.
   */
  fireTrigger(ctx, "enemyStartOfTurn", [], { forController: otherSeat(seat) });

  drawCards(ctx, seat, balance.draw.perTurn);

  tickEvent(ctx, seat);
  fireTrigger(ctx, "startOfTurn", []);
  cleanupDefeated(ctx, null);
}

/**
 * Land the next scripted wave, if this seat's turn is its cue.
 *
 * Waves are strictly ordered — only `waves[wavesLanded]` is ever considered — so
 * a wave whose cue is met while an earlier one is still pending waits its turn
 * rather than jumping the queue. That is what keeps "wave 2 of 3" true: the
 * number counts arrivals, and arrivals are the list.
 *
 * At most one wave lands per turn. Two arriving at once would be indistinguishable
 * from one big wave to the player, and the count would skip a number in the log.
 */
function landDueWave(state: MatchState, content: ContentIndex, events: EngineEvent[], seat: Seat): void {
  const waves = state.config.scenario?.waves;
  if (!waves || state.wavesLanded >= waves.length) return;

  const wave = waves[state.wavesLanded]!;
  if (wave.seat !== seat) return;

  const boardClear = wave.onBoardClear === true && boardOf(state, seat).length === 0;
  const onSchedule = wave.onTurn !== undefined && state.turnOfSeat[seat] >= wave.onTurn;
  if (!boardClear && !onSchedule) return;

  state.wavesLanded += 1;

  const player = state.players[seat];
  const instances: CharacterInstance[] = [];
  let dropped = 0;
  for (const spec of wave.characters) {
    const slot = firstEmptySlot(player);
    if (slot < 0) {
      // The board filled up mid-wave. Counted and announced rather than dropped
      // quietly, because silently delivering four of six bodies is a balance
      // change nobody wrote down.
      dropped += 1;
      continue;
    }
    const character = dealCharacter(state, content, seat, slot, spec, spec.ready === true);
    if (!character) continue;
    player.board[slot] = character;
    instances.push(character);
  }

  events.push({
    e: "waveArrived",
    seat,
    label: wave.label,
    index: state.wavesLanded,
    total: waves.length,
    instances: structuredClone(instances),
    dropped,
  });
}

function returnBanished(ctx: EffectContext, seat: Seat): void {
  const player = ctx.state.players[seat];
  const returning = player.banished.filter((c) => (c.banishedUntilTurn ?? 0) <= ctx.state.globalTurnCounter);
  if (returning.length === 0) return;
  player.banished = player.banished.filter((c) => (c.banishedUntilTurn ?? 0) > ctx.state.globalTurnCounter);

  for (const character of returning) {
    const slot = firstEmptySlot(player);
    if (slot < 0) continue;
    const restored = { ...character, slot, attacksUsedThisTurn: 0, enteredOnTurn: ctx.state.globalTurnCounter };
    delete restored.banishedUntilTurn;
    player.board[slot] = restored;
    ctx.events.push({ e: "characterReturnedFromBanish", instance: structuredClone(restored) });
  }
}

function returnComebacks(ctx: EffectContext, seat: Seat): void {
  const due = ctx.state.comebacks.filter((c) => c.ownerSeat === seat && c.returnsOnTurn <= ctx.state.globalTurnCounter);
  if (due.length === 0) return;
  ctx.state.comebacks = ctx.state.comebacks.filter((c) => !(c.ownerSeat === seat && c.returnsOnTurn <= ctx.state.globalTurnCounter));

  for (const entry of due) {
    if (entry.mode === "play") {
      summonCharacter(ctx, entry.cardId, seat, false);
    } else {
      addCardToHand(ctx, seat, entry.cardId, "comeback");
    }
    ctx.events.push({ e: "comebackReturned", seat, cardId: entry.cardId, mode: entry.mode });
    ctx.events.push({ e: "keywordTriggered", seat, instanceId: null, cardId: entry.cardId, keyword: "comeback" });
  }
}

function resolveDelayed(ctx: EffectContext, seat: Seat): void {
  const due = ctx.state.delayed.filter((d) => d.ownerSeat === seat && d.triggersOnTurn <= ctx.state.globalTurnCounter);
  if (due.length === 0) return;
  ctx.state.delayed = ctx.state.delayed.filter((d) => !(d.ownerSeat === seat && d.triggersOnTurn <= ctx.state.globalTurnCounter));

  for (const entry of due) {
    ctx.events.push({ e: "delayedTriggered", seat, label: entry.label });
    const child = { ...ctx, seat, sourceCardId: entry.sourceCardId, sourceCharacter: null, binding: [] as TargetRef[] };
    runOps(child, entry.ops);
  }
  cleanupDefeated(ctx, null);
}

function tickEvent(ctx: EffectContext, seat: Seat): void {
  const player = ctx.state.players[seat];
  if (!player.activeEvent) return;

  fireTrigger(ctx, "eventTick", []);

  player.activeEvent.remainingTurns -= 1;
  ctx.events.push({ e: "eventTicked", seat, instanceId: player.activeEvent.instanceId, remaining: player.activeEvent.remainingTurns });
  if (player.activeEvent.remainingTurns <= 0) {
    ctx.events.push({ e: "eventEnded", seat, cardId: player.activeEvent.cardId });
    player.activeEvent = null;
  }
}

function applyEndTurn(state: MatchState, content: ContentIndex, events: EngineEvent[], seat: Seat): void {
  if (state.phase !== "main") throw new RulesError("wrongPhase", "Not in the main phase");
  if (state.activeSeat !== seat) throw new RulesError("notYourTurn", "Not your turn");

  const ctx = makeContext(state, content, seat, "turn-end", { events });

  // canonical end-of-turn order: Afterparty -> Scorched -> Grow -> status ticks
  fireTrigger(ctx, "afterparty", []);
  if (state.players[seat].afterpartyRepeatThisTurn) {
    // Afterparty Crew: end-of-turn triggers resolve a second time
    for (const character of boardOf(state, seat)) character.firedThisTurn = [];
    state.players[seat].leaderFiredThisTurn = [];
    fireTrigger(ctx, "afterparty", []);
  }
  cleanupDefeated(ctx, null);

  applyScorched(ctx, seat);
  applyGrow(ctx, seat);

  for (const character of boardOf(state, seat)) {
    const expired = tickStatuses(character);
    for (const status of expired) events.push({ e: "statusRemoved", target: refOf(character), status });
    character.damagedThisTurn = false;
  }
  const player = state.players[seat];
  const expiredLeader = tickStatuses(player);
  for (const status of expiredLeader) events.push({ e: "statusRemoved", target: { kind: "leader", seat }, status });

  cleanupDefeated(ctx, null);

  /**
   * Snapshot before the next turn start clears the live counter. Taken here
   * rather than read across the table later, so "cards you played last turn"
   * means the same thing whoever asks and whenever they ask it.
   */
  player.cardsPlayedLastTurn = player.cardsPlayedThisTurn;

  events.push({ e: "turnEnded", seat });

  if (state.aurasDisabledUntilTurn > 0 && state.aurasDisabledUntilTurn <= state.globalTurnCounter + 1) {
    events.push({ e: "aurasReenabled" });
    state.aurasDisabledUntilTurn = 0;
  }

  state.globalTurnCounter += 1;
  if (seat === 1) state.turn += 1;

  if (state.winner === null) startTurn(state, content, events, otherSeat(seat));
}

function applyScorched(ctx: EffectContext, seat: Seat): void {
  for (const character of boardOf(ctx.state, seat)) {
    if (!hasStatus(character, "scorched")) continue;
    ctx.events.push({ e: "statusTriggered", target: refOf(character), status: "scorched" });
    const child = makeContext(ctx.state, ctx.content, seat, "scorched", { events: ctx.events, budget: ctx.budget });
    child.sourceCharacter = character;
    // Scorched burns for 1, then falls off unless renewed
    character.health -= 1;
    ctx.events.push({
      e: "damageDealt",
      target: refOf(character),
      amount: 1,
      elementalBonus: false,
      absorbedByShield: false,
      absorbedByArmor: 0,
      source: { cardId: "scorched" },
    });
    character.statuses = character.statuses.filter((s) => s.id !== "scorched");
    ctx.events.push({ e: "statusRemoved", target: refOf(character), status: "scorched" });
  }
  cleanupDefeated(ctx, "scorched");
}

function applyGrow(ctx: EffectContext, seat: Seat): void {
  for (const character of boardOf(ctx.state, seat)) {
    if (character.growComplete) continue;
    const card = ctx.content.cards[character.cardId];
    if (!card?.grow || !character.keywords.includes("grow")) continue;

    character.growProgress += 1;
    ctx.events.push({ e: "growProgressed", instanceId: character.instanceId, progress: character.growProgress, needed: card.grow.turns });

    if (character.growProgress >= card.grow.turns) {
      character.growComplete = true;
      ctx.events.push({ e: "growCompleted", instanceId: character.instanceId });
      const child = makeContext(ctx.state, ctx.content, seat, character.cardId, {
        events: ctx.events,
        sourceCharacter: character,
        binding: [refOf(character)],
        budget: ctx.budget,
      });
      runOps(child, card.grow.ops);
      fireTrigger(child, "growComplete", [refOf(character)], { onlyFor: character });
    }
  }
}

// ---------------------------------------------------------------------------
// Play a card
// ---------------------------------------------------------------------------

function applyPlayCard(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  intent: Extract<PlayerIntent, { type: "playCard" }>
): void {
  const { seat, instanceId } = intent;
  const playable = checkPlayable(state, content, seat, instanceId);
  if (!playable.ok) throw new RulesError(playable.reason ?? "invalidIntent", `Cannot play card: ${playable.reason}`);

  const player = state.players[seat];
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
  const instance = player.hand[handIndex];
  if (!instance) throw new RulesError("unknownInstance", "Card not in hand");
  const card = content.cards[instance.cardId];
  if (!card) throw new RulesError("unknownInstance", "Unknown card");

  const cost = effectiveCost(state, content, seat, instance);
  const targets = intent.targets ?? [];

  // validate every provided target against the card's specs
  for (let i = 0; i < playable.targetSpecs.length; i++) {
    const entry = playable.targetSpecs[i];
    const provided = targets[i];
    if (!entry) continue;
    if (!provided) {
      if (!entry.spec.optional) throw new RulesError("invalidTarget", "Missing target");
      continue;
    }
    const legal = entry.legal.some((t) => sameRef(t, provided));
    if (!legal) throw new RulesError("invalidTarget", "Illegal target");
  }

  player.hand.splice(handIndex, 1);
  player.hype -= cost;
  player.hypeSpentThisTurn += cost;

  events.push({ e: "cardPlayed", seat, instanceId, cardId: card.id, cost, targets });
  events.push({ e: "hypeChanged", seat, hype: player.hype, hypeMax: player.hypeMax, temp: player.tempHypeThisTurn });

  const isNotFirstCard = player.cardsPlayedThisTurn > 0;
  player.cardsPlayedThisTurn += 1;

  // Refract sets the card's Current before anything else reads it
  let playedCurrent: CurrentId = card.current;
  if (card.keywords.includes("refract") && intent.refractChoice) {
    playedCurrent = intent.refractChoice;
    events.push({ e: "refracted", instanceId, intoCurrent: playedCurrent });
  }
  if (!player.currentsPlayedThisTurn.includes(playedCurrent)) {
    player.currentsPlayedThisTurn.push(playedCurrent);
  }

  const ctx = makeContext(state, content, seat, card.id, {
    events,
    chosenTargets: [...targets],
    choices: [...(intent.choices ?? [])],
  });

  // --- place the card in its zone -------------------------------------------
  let summoned = null;
  switch (card.type) {
    case "character": {
      summoned = summonCharacter(ctx, card.id, seat, true, intent.slot);
      if (!summoned) throw new RulesError("boardFull", "No free board slot");
      summoned.current = playedCurrent;
      ctx.sourceCharacter = summoned;
      break;
    }
    case "equipment": {
      const targetRef = targets[0];
      const target = targetRef && targetRef.kind === "character" ? findCharacter(state, targetRef.instanceId) : null;
      if (!target) throw new RulesError("invalidTarget", "Equipment needs a friendly character");
      const replaced = target.equipment?.cardId ?? null;
      target.equipment = { instanceId: nextId(state, "e"), cardId: card.id, ...(card.type === "equipment" && (card as EquipmentCardDef).grantKeywords ? {} : {}) };
      for (const keyword of (card as EquipmentCardDef).grantKeywords ?? []) {
        if (!target.keywords.includes(keyword)) target.keywords.push(keyword);
      }
      events.push({ e: "equipped", seat, characterInstanceId: target.instanceId, equipment: structuredClone(target.equipment), replacedCardId: replaced });
      ctx.sourceCharacter = target;
      fireSupportTriggers(ctx, refOf(target));
      /**
       * Flow channel 4: exchanged — but only when something was actually
       * swapped out. `05-keyword-glossary.md` §3.12 ruling 6 is explicit:
       * equipping a bare character is not an exchange because nothing was
       * replaced; replacing existing Equipment is.
       */
      if (replaced !== null) {
        fireTrigger(ctx, "flow", [refOf(target)], { forController: target.controller });
      }
      break;
    }
    case "location": {
      const replaced = player.location?.cardId ?? null;
      const durability = (card as LocationCardDef).durability ?? null;
      player.location = { instanceId: nextId(state, "l"), cardId: card.id, durability, usedThisTurn: false };
      events.push({ e: "locationPlayed", seat, instanceId: player.location.instanceId, cardId: card.id, replacedCardId: replaced });
      break;
    }
    case "event": {
      const duration = (card as EventCardDef).durationTurns;
      player.activeEvent = { instanceId: nextId(state, "v"), cardId: card.id, remainingTurns: duration };
      events.push({ e: "eventStarted", seat, instanceId: player.activeEvent.instanceId, cardId: card.id, duration });
      break;
    }
    case "reaction": {
      const reaction = { instanceId: nextId(state, "r"), cardId: card.id, setOnTurn: state.globalTurnCounter };
      player.reactions.push(reaction);
      events.push({ e: "reactionSet", seat, instanceId: reaction.instanceId });
      break;
    }
    default:
      break; // actions and transformations resolve purely through effects
  }

  // --- on-play effects ------------------------------------------------------
  const onPlayEffects = card.effects.filter((e) => e.trigger === "onPlay");
  const refractionDouble = player.refractionCurrent !== null && player.refractionCurrent === playedCurrent;

  const runOnPlay = (): void => {
    for (const effect of onPlayEffects) {
      const child: EffectContext = {
        ...ctx,
        chosenTargets: [...targets],
        choices: [...(intent.choices ?? [])],
      };
      runEffect(child, effect);
    }
  };

  runOnPlay();
  if (refractionDouble) {
    events.push({ e: "confluenceActivated", seat, confluence: "refraction", currents: ["prism", playedCurrent] });
    runOnPlay();
    player.refractionCurrent = null;
  }

  // --- Rushwind -------------------------------------------------------------
  if (card.keywords.includes("rushwind") && isNotFirstCard) {
    events.push({ e: "keywordTriggered", seat, instanceId, cardId: card.id, keyword: "rushwind" });
    for (const effect of card.effects.filter((e) => e.trigger === "rushwind")) {
      const child: EffectContext = { ...ctx, chosenTargets: [...targets], choices: [] };
      runEffect(child, effect);
    }
  }

  // --- Viral ----------------------------------------------------------------
  if (card.keywords.includes("viral") && !instance.viralCopy) {
    const discount = -1;
    addCardToHand(ctx, seat, card.id, "viral", discount);
    events.push({ e: "keywordTriggered", seat, instanceId, cardId: card.id, keyword: "viral" });
  }

  // --- Overload -------------------------------------------------------------
  if (card.overload !== undefined && card.keywords.includes("overload")) {
    player.hypeLockedNextTurn += card.overload;
    events.push({ e: "hypeLocked", seat, amount: card.overload });
  }

  // --- discard non-permanent card types ------------------------------------
  if (card.type === "action" || card.type === "transformation") {
    player.discard.push({ instanceId: nextId(state, "c"), cardId: card.id, costDelta: 0, addedKeywords: [], removedKeywords: [] });
  }

  // --- Perfect Resonance ----------------------------------------------------
  const resonance = advanceResonance(player, content, playedCurrent);
  if (resonance === "progressed") {
    events.push({ e: "resonanceAdvanced", seat, progress: player.resonanceProgress, threshold: content.balance.resonance.threshold });
  } else if (resonance === "activated" && player.pureCurrent) {
    events.push({ e: "resonanceActivated", seat, current: player.pureCurrent });
    const resonanceDef = content.currents[player.pureCurrent]?.resonance;
    if (resonanceDef) {
      const child = makeContext(state, content, seat, `resonance-${player.pureCurrent}`, { events, budget: ctx.budget });
      runOps(child, resonanceDef.ops);
    }
  }

  // --- broadcast the play ---------------------------------------------------
  fireTrigger(ctx, "onCardPlayed", summoned ? [refOf(summoned)] : [], { playedCard: card });
  /**
   * Flow's "replayed" clause: this card has been in play before and is going
   * back down. Fired after the card has resolved, so a body that returns and is
   * recast sees its own on-play effect first, and only then pays out the Flow.
   */
  if (instance.returnedFromPlay) {
    fireTrigger(ctx, "flow", summoned ? [refOf(summoned)] : []);
  }
  fireReactions(
    state,
    content,
    events,
    otherSeat(seat),
    card.type === "character" ? "enemyPlaysCharacter" : "enemyPlaysAction",
    summoned ? [refOf(summoned)] : [],
    card
  );

  cleanupDefeated(ctx, card.id);
}

function sameRef(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "leader" && b.kind === "leader") return a.seat === b.seat;
  if (a.kind === "character" && b.kind === "character") return a.instanceId === b.instanceId;
  return false;
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Fire any face-down Reaction of `seat` whose condition matches. */
function fireReactions(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  seat: Seat,
  condition: ReactionConditionId,
  binding: TargetRef[],
  causingCard?: CardDef
): void {
  const player = state.players[seat];
  if (player.reactions.length === 0) return;

  const triggered = player.reactions.filter((reaction) => {
    const card = content.cards[reaction.cardId];
    return (
      card?.effects.some((e) => {
        if (e.trigger !== "reaction" || e.reactionOn !== condition) return false;
        // cost/type-filtered reactions ("when the enemy plays a Character costing (3) or more")
        if (e.playedFilter && causingCard) return cardMatchesFilter(causingCard, e.playedFilter);
        return true;
      }) ?? false
    );
  });
  if (triggered.length === 0) return;

  for (const reaction of triggered) {
    player.reactions = player.reactions.filter((r) => r.instanceId !== reaction.instanceId);
    const card = content.cards[reaction.cardId];
    if (!card) continue;

    events.push({ e: "reactionTriggered", seat, instanceId: reaction.instanceId, cardId: card.id, on: condition });

    const ctx = makeContext(state, content, seat, card.id, { events, binding });
    for (const effect of card.effects) {
      if (effect.trigger !== "reaction" || effect.reactionOn !== condition) continue;
      if (effect.playedFilter && causingCard && !cardMatchesFilter(causingCard, effect.playedFilter)) continue;
      runEffect(ctx, effect);
    }
    player.discard.push({ instanceId: nextId(state, "c"), cardId: card.id, costDelta: 0, addedKeywords: [], removedKeywords: [] });
    cleanupDefeated(ctx, card.id);
  }
}

// ---------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------

function applyAttack(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  intent: Extract<PlayerIntent, { type: "attack" }>
): void {
  if (state.phase !== "main") throw new RulesError("wrongPhase", "Not in the main phase");
  if (state.activeSeat !== intent.seat) throw new RulesError("notYourTurn", "Not your turn");

  const attacker = findCharacter(state, intent.attackerInstanceId);
  if (!attacker) throw new RulesError("unknownInstance", "Attacker not found");
  if (attacker.controller !== intent.seat) throw new RulesError("cannotAttack", "Not your character");
  if (!canAttack(state, content, attacker)) throw new RulesError("cannotAttack", "This character cannot attack right now");
  if (!isLegalAttackTarget(state, intent.seat, intent.target)) throw new RulesError("spotlightEnforced", "Illegal attack target");

  const ctx = makeContext(state, content, intent.seat, attacker.cardId, { events, sourceCharacter: attacker });

  const condition: ReactionConditionId = intent.target.kind === "leader" ? "enemyAttacksLeader" : "enemyAttacksCharacter";
  fireReactions(state, content, events, otherSeat(intent.seat), condition, [refOf(attacker)]);

  // the reaction may have removed the attacker or made the target illegal
  const attackerStillThere = findCharacter(state, intent.attackerInstanceId);
  if (!attackerStillThere || !canAttack(state, content, attackerStillThere)) {
    cleanupDefeated(ctx, null);
    return;
  }
  if (!isLegalAttackTarget(state, intent.seat, intent.target)) {
    cleanupDefeated(ctx, null);
    return;
  }

  resolveAttack(ctx, attackerStillThere, intent.target);
}

// ---------------------------------------------------------------------------
// Leader abilities
// ---------------------------------------------------------------------------

function applyFixation(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  intent: Extract<PlayerIntent, { type: "useFixation" }>
): void {
  const { seat, kind } = intent;
  if (!canUseFixation(state, content, seat, kind)) throw new RulesError("fixationUnavailable", "Fixation unavailable");

  const player = state.players[seat];
  const leader = content.leaders[player.leaderCardId] as LeaderCardDef | undefined;
  if (!leader) throw new RulesError("unknownInstance", "Unknown leader");

  const ability = kind === "fixation" ? leader.fixation : leader.ultimate;
  const balance = content.balance.obsession;
  const fullFixation = player.obsession >= balance.max;

  if (kind === "fixation") {
    player.fixationUsedThisTurn = true;
    player.obsession -= ability.obsessionCost;
  } else {
    player.ultimateUsed = true;
    if (!fullFixation) player.obsession -= ability.obsessionCost;
  }
  player.obsession = Math.max(0, player.obsession);

  events.push({ e: "fixationUsed", seat, kind, abilityName: ability.name });
  events.push({ e: "obsessionChanged", seat, obsession: player.obsession, reason: "fixation" });

  const ctx = makeContext(state, content, seat, leader.id, {
    events,
    chosenTargets: [...(intent.targets ?? [])],
  });
  if (ability.target) {
    const refs = intent.targets ?? [];
    ctx.binding = refs;
  }
  runOps(ctx, ability.ops);

  fireReactions(state, content, events, otherSeat(seat), "enemyUsesFixation", []);
  cleanupDefeated(ctx, leader.id);

  // Full Fixation resets Obsession at end of the ability, per canon §3.2
  if (fullFixation && kind === "ultimate") {
    player.obsession = balance.fullFixationResetTo;
    events.push({ e: "obsessionChanged", seat, obsession: player.obsession, reason: "fullFixationReset" });
  }
}

// ---------------------------------------------------------------------------
// Location activation
// ---------------------------------------------------------------------------

function applyActivateLocation(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  intent: Extract<PlayerIntent, { type: "activateLocation" }>
): void {
  const { seat } = intent;
  if (!canActivateLocation(state, content, seat)) throw new RulesError("invalidIntent", "Location cannot be activated");

  const player = state.players[seat];
  const location = player.location;
  if (!location) throw new RulesError("invalidIntent", "No location in play");
  const card = content.cards[location.cardId];
  if (!card) throw new RulesError("unknownInstance", "Unknown location card");

  location.usedThisTurn = true;
  if (location.durability !== null) location.durability -= 1;

  const ctx = makeContext(state, content, seat, card.id, {
    events,
    chosenTargets: [...(intent.targets ?? [])],
  });
  for (const effect of card.effects.filter((e) => e.trigger === "activate")) runEffect(ctx, effect);

  events.push({ e: "locationActivated", seat, instanceId: location.instanceId, durabilityLeft: location.durability });

  if (location.durability !== null && location.durability <= 0) {
    player.location = null;
    player.discard.push({ instanceId: nextId(state, "c"), cardId: card.id, costDelta: 0, addedKeywords: [], removedKeywords: [] });
  }
  cleanupDefeated(ctx, card.id);
}

// ---------------------------------------------------------------------------
// Confluences
// ---------------------------------------------------------------------------

function applyConfluence(
  state: MatchState,
  content: ContentIndex,
  events: EngineEvent[],
  intent: Extract<PlayerIntent, { type: "activateConfluence" }>
): void {
  const { seat, confluence } = intent;
  if (!canActivateConfluence(state, content, seat, confluence)) {
    throw new RulesError("confluenceUnavailable", "Confluence not available");
  }
  const def = content.confluences[confluence];
  if (!def) throw new RulesError("confluenceUnavailable", "Unknown confluence");

  const player = state.players[seat];
  player.confluenceUsedThisTurn = true;

  const currents: [CurrentId, CurrentId] =
    def.currents ?? ["prism", refractionPartner(state, seat) ?? "prism"];
  events.push({ e: "confluenceActivated", seat, confluence, currents });

  if (confluence === "refraction") {
    player.refractionCurrent = currents[1];
    const refractCtx = makeContext(state, content, seat, `confluence-${confluence}`, { events });
    fireTrigger(refractCtx, "onConfluenceActivated", []);
    return;
  }

  const ctx = makeContext(state, content, seat, `confluence-${confluence}`, {
    events,
    chosenTargets: [...(intent.targets ?? [])],
    choices: intent.choice !== undefined ? [intent.choice] : [],
  });

  if (def.target) ctx.binding = intent.targets ?? [];

  if (def.choice && def.choice.length > 0) {
    const index = Math.max(0, Math.min(def.choice.length - 1, intent.choice ?? 0));
    const branch = def.choice[index];
    if (branch) runOps(ctx, branch.ops);
  }
  runOps(ctx, def.ops);

  fireTrigger(ctx, "onConfluenceActivated", []);
  fireReactions(state, content, events, otherSeat(seat), "enemyActivatesConfluence", []);
  cleanupDefeated(ctx, `confluence-${confluence}`);
}

export { RulesError };
