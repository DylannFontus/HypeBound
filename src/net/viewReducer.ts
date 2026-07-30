/**
 * `applyEventsToView` — presentation bookkeeping, not rules.
 * `docs/tech/03-multiplayer-architecture.md` §4.6.
 *
 * A networked client is sent event batches, not states. Between authoritative
 * snapshots it keeps its own `PlayerView` current by applying those events. §4.6
 * is precise about the division of labour, and it is what bounds this file:
 *
 * > *Events are the truth for **animation**; snapshots are the truth for
 * > **state**.*
 *
 * The worker sends a full snapshot at match start, at **every turn boundary**,
 * on resume and on demand, and every batch carries a `viewHash` the client
 * compares — a mismatch asks for a snapshot. So drift is bounded by one turn and
 * self-healing, and this reducer's job is to be right *within* a turn, not to be
 * a second copy of the engine. **It never decides an outcome.** If it is wrong,
 * the animation is briefly wrong and the next snapshot corrects it; if it were
 * allowed to decide legality, it would be a second rules implementation and the
 * two would drift for real.
 *
 * ## Three traps, all of which cost a real bug if missed
 *
 * **1. `turnStarted.turn` is not `view.turn`.** The event carries
 * `state.turnOfSeat[seat]`, the *per-seat* counter; `view.turn` is the round
 * counter, which moves only when seat 1's turn ends. They coincide only for seat
 * 0 in a match seat 0 opened, so assigning one to the other looks correct in
 * every casual test and breaks under `firstSeat: 1`.
 *
 * **2. A redacted event still moves counts.** `cardDrawn` arrives with
 * `cardId: null` for the opponent's draw — the identity is hidden, but a card
 * still left their deck and entered their hand. Skipping the event because it
 * "has no card" silently desynchronises `handCount` and `deckCount` for the rest
 * of the match.
 *
 * **3. The opponent has no hand.** `RedactedOpponent` carries `handCount`,
 * `deckCount`, `reactionCount` and `banishedCount` — numbers, not arrays. Every
 * rule below has to branch on whose seat it is, and the two branches are not
 * symmetrical.
 *
 * ## Mutation
 *
 * This mutates the view it is given and returns it. That is safe *because*
 * `LocalTransport.view()` now deep-clones — `redact()` hands out the live
 * `PlayerState`, so before that clone existed a reducer like this one would have
 * been writing directly into the running match. Callers holding a view from
 * anywhere else must clone first.
 */

import type { CharacterInstance, ContentIndex, EngineEvent, PlayerView, Seat, TargetRef } from "../engine/types";

/** Find a character on either board, and say which side it was on. */
function locate(
  view: PlayerView,
  instanceId: string
): { character: CharacterInstance; mine: boolean } | null {
  for (const character of view.you.board) {
    if (character?.instanceId === instanceId) return { character, mine: true };
  }
  for (const character of view.opponent.board) {
    if (character?.instanceId === instanceId) return { character, mine: false };
  }
  return null;
}

/** Resolve a `TargetRef` to the thing it names, on either side. */
function resolveRef(view: PlayerView, ref: TargetRef): CharacterInstance | "yourLeader" | "theirLeader" | null {
  if (ref.kind === "leader") return ref.seat === view.seat ? "yourLeader" : "theirLeader";
  return locate(view, ref.instanceId)?.character ?? null;
}

/** Put a character into the first free slot on the right board. */
function place(view: PlayerView, seat: Seat, instance: CharacterInstance): void {
  const board = seat === view.seat ? view.you.board : view.opponent.board;
  const existing = board.findIndex((c) => c?.instanceId === instance.instanceId);
  if (existing >= 0) {
    board[existing] = instance;
    return;
  }
  /**
   * The instance names its own slot, and it is authoritative.
   *
   * The first draft took the first free slot instead, which is right for a
   * plain summon and wrong for a transform: the engine keeps the transformed
   * body where it stood, and a client that shuffled it left would draw the
   * board in a different order from its opponent's screen.
   */
  if (instance.slot >= 0 && instance.slot < board.length && board[instance.slot] === null) {
    board[instance.slot] = instance;
    return;
  }
  const free = board.findIndex((c) => c === null);
  if (free >= 0) board[free] = instance;
  // No free slot at all: the server said it landed, so our board model is
  // already wrong. The turn-boundary snapshot repairs it; guessing here would
  // only add a second wrong answer.
}

/** Remove a character from whichever board holds it. */
function lift(view: PlayerView, instanceId: string): CharacterInstance | null {
  for (const board of [view.you.board, view.opponent.board]) {
    const index = board.findIndex((c) => c?.instanceId === instanceId);
    if (index >= 0) {
      const character = board[index]!;
      board[index] = null;
      return character;
    }
  }
  return null;
}

/**
 * Apply one batch of engine events to a view, in order.
 *
 * Returns the same object it was given. Unknown or purely presentational events
 * fall through untouched — that is the correct handling for the majority of the
 * union, and `tests/view-reducer.test.ts` is what proves the ones that *do*
 * matter are here, by replaying whole matches and comparing against the
 * authoritative view after every single batch.
 */
export function applyEventsToView(
  view: PlayerView,
  events: readonly EngineEvent[],
  content: ContentIndex
): PlayerView {
  for (const event of events) applyOne(view, event, content);
  return view;
}

function applyOne(view: PlayerView, event: EngineEvent, content: ContentIndex): void {
  const mine = "seat" in event ? event.seat === view.seat : false;

  switch (event.e) {
    // --- turn structure ------------------------------------------------------

    case "matchStarted":
      view.phase = "main";
      view.activeSeat = event.firstSeat;
      // the scripted path sets mulliganDone without ever emitting mulliganDone
      view.you.mulliganDone = true;
      break;

    case "mulliganDone":
      // Counts do not move: N cards leave the hand and N return. Which cards
      // were swapped is unrecoverable — the event carries only totals, and the
      // client cannot reproduce the reshuffle. The match-start snapshot is what
      // makes the hand right, so guessing here would only be wrong louder.
      if (mine) view.you.mulliganDone = true;
      break;

    case "turnStarted": {
      view.activeSeat = event.seat;
      // NOT view.turn — see trap 1 in the file header.
      const player = mine ? view.you : view.opponent;
      player.hype = event.hype;
      player.hypeMax = event.hypeMax;
      if (mine) {
        view.you.hypeLockedNextTurn = 0;
        view.you.tempHypeThisTurn = 0;
        view.you.cardsPlayedThisTurn = 0;
        view.you.currentsPlayedThisTurn = [];
        view.you.hypeSpentThisTurn = 0;
        view.you.confluenceUsedThisTurn = false;
        view.you.fixationUsedThisTurn = false;
        view.you.supportObsessionGainedThisTurn = false;
        view.you.refractionCurrent = null;
        view.you.afterpartyRepeatThisTurn = false;
        view.you.leaderFiredThisTurn = [];
      }
      // Per-turn flags live on the public instances, so both sides need them
      // reset. Leaving the opponent's set draws every enemy attacker as spent.
      const board = mine ? view.you.board : view.opponent.board;
      for (const character of board) {
        if (!character) continue;
        character.attacksUsedThisTurn = 0;
        character.firedThisTurn = [];
      }
      const location = mine ? view.you.location : view.opponent.location;
      if (location) location.usedThisTurn = false;
      break;
    }

    case "turnEnded":
      view.globalTurnCounter += 1;
      // The round counter advances only when seat 1 finishes, matching
      // `reducer.ts`. Deriving it any other way drifts under `firstSeat: 1`.
      if (event.seat === 1) view.turn += 1;
      if (mine) view.you.cardsPlayedLastTurn = view.you.cardsPlayedThisTurn;
      /**
       * `damagedThisTurn` clears for the **ending seat's** board only —
       * `reducer.ts` loops `boardOf(state, seat)`, not both sides. Missed in the
       * first draft (a body stayed flagged as damaged forever after its first
       * hit), and then over-corrected to clear both boards, which would have
       * been just as wrong in the other direction.
       */
      const ending = mine ? view.you.board : view.opponent.board;
      for (const character of ending) {
        if (character) character.damagedThisTurn = false;
      }
      break;

    case "matchEnded":
      view.winner = event.winner;
      view.phase = "ended";
      break;

    // --- resources -----------------------------------------------------------

    case "hypeChanged": {
      const player = mine ? view.you : view.opponent;
      player.hype = event.hype;
      player.hypeMax = event.hypeMax;
      if (mine) view.you.tempHypeThisTurn = event.temp;
      break;
    }

    case "hypeLocked":
      if (mine) view.you.hypeLockedNextTurn += event.amount;
      break;

    case "obsessionChanged": {
      const player = mine ? view.you : view.opponent;
      player.obsession = event.obsession;
      break;
    }

    case "fixationUsed":
      if (mine) {
        if (event.kind === "ultimate") view.you.ultimateUsed = true;
        else view.you.fixationUsedThisTurn = true;
      }
      break;

    case "confluenceActivated":
      if (mine) view.you.confluenceUsedThisTurn = true;
      break;

    case "counterChanged": {
      const player = mine ? view.you : view.opponent;
      player.counters[event.key] = event.value;
      break;
    }

    case "resonanceAdvanced": {
      const player = mine ? view.you : view.opponent;
      player.resonanceProgress = event.progress;
      break;
    }

    case "resonanceActivated":
      if (mine) view.you.resonanceActivated = true;
      break;

    case "leaderCurrentChanged": {
      if (mine) view.you.leaderCurrent = event.to;
      else view.opponent.leaderCurrent = event.to;
      break;
    }

    case "aurasDisabled":
      view.aurasDisabledUntilTurn = event.untilTurn;
      break;

    case "aurasReenabled":
      view.aurasDisabledUntilTurn = 0;
      break;

    // --- private zones -------------------------------------------------------

    case "cardDrawn":
      // Trap 2: the opponent's draw is redacted to `cardId: null`, and the
      // counts must still move. A card left their deck and entered their hand
      // whether or not we are allowed to know which one.
      if (mine) {
        const index = view.you.deck.findIndex((c) => c.instanceId === event.instanceId);
        const drawn =
          index >= 0
            ? view.you.deck.splice(index, 1)[0]!
            : { instanceId: event.instanceId, cardId: event.cardId ?? "hidden", costDelta: 0, addedKeywords: [], removedKeywords: [] };
        if (event.cardId) drawn.cardId = event.cardId;
        view.you.hand.push(drawn);
      } else {
        view.opponent.handCount += 1;
        view.opponent.deckCount = Math.max(0, view.opponent.deckCount - 1);
      }
      break;

    case "cardAddedToHand":
      if (mine) {
        view.you.hand.push({
          instanceId: event.instanceId,
          cardId: event.cardId ?? "hidden",
          costDelta: 0,
          addedKeywords: [],
          removedKeywords: [],
        });
      } else {
        view.opponent.handCount += 1;
      }
      break;

    case "cardBurned":
      // Hand was full, so the drawn card never landed; it left the deck.
      if (mine) view.you.deck.shift();
      else view.opponent.deckCount = Math.max(0, view.opponent.deckCount - 1);
      break;

    case "cardDiscarded":
      if (mine) {
        const index = view.you.hand.findIndex((c) => c.cardId === event.cardId);
        if (index >= 0) view.you.discard.push(view.you.hand.splice(index, 1)[0]!);
      } else {
        view.opponent.handCount = Math.max(0, view.opponent.handCount - 1);
      }
      break;

    case "cardMilled":
      if (mine) {
        const milled = view.you.deck.shift();
        if (milled) view.you.discard.push({ ...milled, cardId: event.cardId });
      } else {
        view.opponent.deckCount = Math.max(0, view.opponent.deckCount - 1);
      }
      break;

    case "deckScryed":
      // Order changed, identities did not travel in the event. The owner's
      // snapshot carries the peeked cards; nothing to do here.
      break;

    case "costModified":
      if (mine) {
        const card = view.you.hand.find((c) => c.instanceId === event.instanceId);
        if (card) card.costDelta += event.delta;
      }
      break;

    /**
     * A Reaction is set face-down, and `reactionSet` carries no `cardId` — by
     * design (§5.1), so that a face-down card stays face-down on the wire. The
     * consequence is that even the **owner** cannot reconstruct which card it
     * was from events alone; only the count is recoverable here, and the
     * identity arrives with the next snapshot.
     */
    case "reactionSet":
      if (mine) {
        view.you.reactions.push({
          instanceId: event.instanceId,
          cardId: "hidden",
          setOnTurn: view.globalTurnCounter,
        });
      } else {
        view.opponent.reactionCount += 1;
      }
      break;

    /** A Reaction that fires leaves the set and is revealed. */
    case "reactionTriggered":
      if (mine) {
        view.you.reactions = view.you.reactions.filter((r) => r.instanceId !== event.instanceId);
      } else {
        view.opponent.reactionCount = Math.max(0, view.opponent.reactionCount - 1);
      }
      break;

    // --- the board -----------------------------------------------------------

    case "cardPlayed":
      if (mine) {
        const index = view.you.hand.findIndex((c) => c.instanceId === event.instanceId);
        if (index >= 0) view.you.hand.splice(index, 1);
        view.you.cardsPlayedThisTurn += 1;
        view.you.hypeSpentThisTurn += event.cost;
        /**
         * The played Current, which the engine pushes for **every** card
         * (`reducer.ts`), not only refracted ones.
         *
         * Missed in the first draft — the reducer pushed only on `refracted`,
         * so `currentsPlayedThisTurn` stayed empty all match. It is read by
         * `availableConfluences`, so the client would have offered no Confluence
         * ever, which is a silent wrong answer rather than a visible break. The
         * oracle test caught it on the very first batch of every single match.
         *
         * A `refracted` event in the same batch overwrites this with the chosen
         * Current — it is emitted *before* `cardPlayed`, so the order below
         * matters and the refract case checks for a duplicate.
         */
        const current = content.cards[event.cardId]?.current;
        if (current && !view.you.currentsPlayedThisTurn.includes(current)) {
          view.you.currentsPlayedThisTurn.push(current);
        }
      } else {
        view.opponent.handCount = Math.max(0, view.opponent.handCount - 1);
      }
      break;

    case "characterSummoned":
      place(view, event.seat, structuredClone(event.instance));
      break;

    case "characterDefeated": {
      const removed = lift(view, event.instance.instanceId);
      const owner = event.instance.controller;
      const side = owner === view.seat ? view.you : null;
      if (side && removed) {
        side.discard.push({
          instanceId: removed.instanceId,
          cardId: removed.cardId,
          costDelta: 0,
          addedKeywords: [],
          removedKeywords: [],
        });
      } else if (!side && removed) {
        view.opponent.discard.push({
          instanceId: removed.instanceId,
          cardId: removed.cardId,
          costDelta: 0,
          addedKeywords: [],
          removedKeywords: [],
        });
      }
      break;
    }

    case "characterBanished": {
      lift(view, event.instanceId);
      break;
    }

    case "characterReturnedFromBanish":
      place(view, event.instance.controller, structuredClone(event.instance));
      break;

    case "characterResurrected":
      place(view, event.seat, structuredClone(event.instance));
      break;

    case "characterTransformed":
      lift(view, event.oldInstanceId);
      place(view, event.instance.controller, structuredClone(event.instance));
      break;

    case "characterReturnedToHand": {
      lift(view, event.instanceId);
      if (mine) {
        view.you.hand.push({
          instanceId: event.instanceId,
          cardId: event.cardId,
          costDelta: 0,
          addedKeywords: [],
          removedKeywords: [],
        });
      } else {
        view.opponent.handCount += 1;
      }
      break;
    }

    case "waveArrived":
      for (const instance of event.instances) place(view, event.seat, structuredClone(instance));
      break;

    case "defeatPrevented": {
      const found = locate(view, event.instanceId);
      if (found) found.character.health = event.health;
      break;
    }

    case "growProgressed": {
      const found = locate(view, event.instanceId);
      if (found) found.character.growProgress = event.progress;
      break;
    }

    case "growCompleted": {
      const found = locate(view, event.instanceId);
      if (found) found.character.growComplete = true;
      break;
    }

    case "armorChanged": {
      const player = mine ? view.you : view.opponent;
      player.armor = event.armor;
      break;
    }

    case "refracted": {
      const found = locate(view, event.instanceId);
      if (found) found.character.current = event.intoCurrent;
      // The played Current is what Confluences are counted from, and crediting
      // it to the wrong seat makes the client offer one the room will refuse —
      // which is why this event now carries a seat at all.
      if (mine && !view.you.currentsPlayedThisTurn.includes(event.intoCurrent)) {
        view.you.currentsPlayedThisTurn.push(event.intoCurrent);
      }
      break;
    }

    // --- combat and stats ----------------------------------------------------

    case "damageDealt": {
      const target = resolveRef(view, event.target);
      if (target === "yourLeader") {
        view.you.armor = Math.max(0, view.you.armor - event.absorbedByArmor);
        view.you.leaderHealth -= event.amount;
      } else if (target === "theirLeader") {
        view.opponent.armor = Math.max(0, view.opponent.armor - event.absorbedByArmor);
        view.opponent.leaderHealth -= event.amount;
      } else if (target) {
        target.health -= event.amount;
        target.damagedThisTurn = true;
      }
      break;
    }

    case "healed": {
      const target = resolveRef(view, event.target);
      if (event.blocked) break;
      if (target === "yourLeader") view.you.leaderHealth += event.amount;
      else if (target === "theirLeader") view.opponent.leaderHealth += event.amount;
      else if (target) target.health += event.amount;
      break;
    }

    case "buffApplied": {
      const target = resolveRef(view, event.target);
      if (target && target !== "yourLeader" && target !== "theirLeader") {
        target.attack += event.attack;
        target.maxHealth += event.health;
        target.health += event.health;
      }
      break;
    }

    case "statsSet": {
      const target = resolveRef(view, event.target);
      if (target && target !== "yourLeader" && target !== "theirLeader") {
        target.attack = event.attack;
        target.health = event.health;
        target.maxHealth = Math.max(target.maxHealth, event.health);
      }
      break;
    }

    case "keywordAdded": {
      const target = resolveRef(view, event.target);
      if (target && target !== "yourLeader" && target !== "theirLeader") {
        if (!target.keywords.includes(event.keyword)) target.keywords.push(event.keyword);
      }
      break;
    }

    case "keywordRemoved": {
      const target = resolveRef(view, event.target);
      if (target && target !== "yourLeader" && target !== "theirLeader") {
        target.keywords = target.keywords.filter((k) => k !== event.keyword);
      }
      break;
    }

    case "statusApplied": {
      const target = resolveRef(view, event.target);
      const list =
        target === "yourLeader" ? view.you.statuses : target === "theirLeader" ? null : target?.statuses;
      if (list) list.push(structuredClone(event.status));
      break;
    }

    case "statusRemoved": {
      const target = resolveRef(view, event.target);
      const list =
        target === "yourLeader" ? view.you.statuses : target === "theirLeader" ? null : target?.statuses;
      if (list) {
        const index = list.findIndex((s) => s.id === event.status);
        if (index >= 0) list.splice(index, 1);
      }
      break;
    }

    case "attackDeclared": {
      const found = locate(view, event.attackerInstanceId);
      if (found) found.character.attacksUsedThisTurn += 1;
      break;
    }

    case "equipped": {
      const found = locate(view, event.characterInstanceId);
      if (!found) break;
      found.character.equipment = structuredClone(event.equipment);
      /**
       * Equipment grants keywords, and the engine pushes them onto the
       * character (`reducer.ts`). The event carries the equipment instance but
       * not the granted list, so the client re-derives it from content — the
       * same content the room is pinned to, so the two cannot disagree.
       */
      const card = content.cards[event.equipment.cardId];
      const granted = card && "grantKeywords" in card ? card.grantKeywords : undefined;
      for (const keyword of granted ?? []) {
        if (!found.character.keywords.includes(keyword)) found.character.keywords.push(keyword);
      }
      break;
    }

    case "equipmentDestroyed": {
      if (event.characterInstanceId === null) break;
      const found = locate(view, event.characterInstanceId);
      if (found) found.character.equipment = null;
      break;
    }

    // --- locations and events ------------------------------------------------

    /**
     * Both of these are fully reconstructible from content, so deferring them
     * to the snapshot (as the first draft did) was laziness rather than a
     * limitation: the event carries the `instanceId` and `cardId`, and the only
     * other fields — durability and duration — are printed on the card the
     * client already has.
     */
    case "locationPlayed": {
      const card = content.cards[event.cardId];
      const durability = card && "durability" in card ? (card.durability ?? null) : null;
      const location = { instanceId: event.instanceId, cardId: event.cardId, durability, usedThisTurn: false };
      if (mine) view.you.location = location;
      else view.opponent.location = location;
      break;
    }

    case "eventStarted": {
      const active = { instanceId: event.instanceId, cardId: event.cardId, remainingTurns: event.duration };
      if (mine) view.you.activeEvent = active;
      else view.opponent.activeEvent = active;
      break;
    }

    case "locationActivated": {
      const location = mine ? view.you.location : view.opponent.location;
      if (!location) break;
      location.usedThisTurn = true;
      if (event.durabilityLeft !== null) location.durability = event.durabilityLeft;
      /**
       * Spent locations leave the board — `reducer.ts` nulls the slot when
       * durability reaches zero. `null` durability means unlimited and must not
       * be confused with zero, which is why the check is explicit rather than
       * falsy. Missed first time round: the client kept drawing a dead location
       * for the rest of the match.
       */
      if (event.durabilityLeft !== null && event.durabilityLeft <= 0) {
        if (mine) view.you.location = null;
        else view.opponent.location = null;
      }
      break;
    }

    case "eventTicked": {
      const active = mine ? view.you.activeEvent : view.opponent.activeEvent;
      if (active) active.remainingTurns = event.remaining;
      break;
    }

    case "eventEnded":
      if (mine) view.you.activeEvent = null;
      else view.opponent.activeEvent = null;
      break;

    /**
     * Everything else is animation, or is corrected by the next snapshot.
     *
     * `locationPlayed` and `eventStarted` carry a `cardId` but not the built
     * instance, so a client cannot construct one faithfully — durability and
     * duration are computed engine-side. Rather than invent a half-right object
     * that would then disagree with the authoritative one, they are left for the
     * turn-boundary snapshot, which §4.6 guarantees arrives within one turn.
     */
    default:
      break;
  }
}
