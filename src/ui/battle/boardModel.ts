/**
 * The board, as a list of places you can be — `13-accessibility.md` §13.1 and
 * §16.2.
 *
 * The board is three.js, which means it is opaque to a keyboard and completely
 * opaque to a screen reader. §13 is explicit about the answer: *"keyboard
 * interaction runs on an explicit **selection model** … (never on the canvas).
 * Selection state is mirrored 1:1 in the Board Mirror, so keyboard and
 * screen-reader users share one model."*
 *
 * This is that model. It is a pure function of the redacted `PlayerView` the
 * presenter already consumes, so it cannot drift from the board: there is no
 * second copy of the game state to keep in step, and anything the mirror says is
 * something the view actually contains.
 *
 * **Legality is not decided here.** Which cards are playable, which targets are
 * legal and whether a character may attack are the engine's answers, passed in
 * as `Legality`. A second opinion about the rules is the one thing this file
 * must never grow — the whole point of routing keyboard play through the same
 * `checkPlayable` and `legalTargets` the pointer uses is that a keyboard player
 * and a mouse player are playing the same game.
 */

import type {
  CharacterInstance,
  CurrentId,
  ConfluenceAvailability,
  ContentIndex,
  PlayerView,
  Seat,
  TargetRef,
} from "../../engine/types";

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export type ZoneId =
  | "hand"
  | "yourBoard"
  | "yourLocation"
  | "yourLeader"
  | "confluence"
  | "enemyBoard"
  | "enemyLocation"
  | "enemyLeader"
  | "reactions"
  | "events"
  | "history"
  | "endTurn";

/**
 * §13.1's order, verbatim. `Tab` walks it forward, `Shift+Tab` back.
 *
 * Fixed rather than derived from what happens to be on the board, because a
 * zone order that reshuffles as characters die is one nobody can build muscle
 * memory for. Empty zones are skipped when tabbing, not reordered.
 */
export const ZONE_ORDER: readonly ZoneId[] = [
  "hand",
  "yourBoard",
  "yourLocation",
  "yourLeader",
  "confluence",
  "enemyBoard",
  "enemyLocation",
  "enemyLeader",
  "reactions",
  "events",
  "history",
  "endTurn",
];

export const ZONE_LABEL: Record<ZoneId, string> = {
  hand: "Your hand",
  yourBoard: "Your board",
  yourLocation: "Your location",
  yourLeader: "Your leader",
  confluence: "Confluence bar",
  enemyBoard: "Opponent board",
  enemyLocation: "Opponent location",
  enemyLeader: "Opponent leader",
  reactions: "Reactions",
  events: "Events",
  history: "History",
  endTurn: "End turn",
};

/** What a focusable position points at, in terms the intent layer understands. */
export type SlotRef =
  | { kind: "handCard"; instanceId: string }
  | { kind: "character"; instanceId: string }
  | { kind: "leader"; seat: Seat }
  | { kind: "emptySlot"; slot: number }
  | { kind: "location"; seat: Seat }
  | { kind: "confluence"; confluenceId: string }
  | { kind: "reaction"; instanceId: string }
  | { kind: "event"; instanceId: string }
  | { kind: "button"; id: "endTurn" | "history" };

export interface BoardSlot {
  zone: ZoneId;
  /** position within the zone, 0-based */
  index: number;
  ref: SlotRef;
  /** what the focus banner and the screen reader say when you land here */
  label: string;
  /** false for a slot you may look at but not act on */
  actionable: boolean;
}

export interface BoardZone {
  id: ZoneId;
  label: string;
  slots: BoardSlot[];
}

/**
 * Everything the engine knows and this model must not re-decide.
 *
 * **Defined in [`../../net/transport.ts`](../../net/transport.ts), re-exported
 * here.** It used to live in this file, computed by the battle screen from a
 * full `MatchState`. It moved because the screen will not have a `MatchState`
 * once the transport is a socket: a network client holds only a `PlayerView`,
 * so "what may I do right now" becomes a question the transport answers, and
 * the two implementations reach the engine's answer by different routes.
 *
 * Re-exported rather than relocated outright so the keyboard, the mirror and
 * their tests keep importing it from where they always have.
 */
import type { Legality } from "../../net/transport";
export type { Legality };
export { EMPTY_LEGALITY } from "../../net/transport";

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const nameOf = (content: ContentIndex, cardId: string): string => content.cards[cardId]?.name ?? cardId;

const currentName = (content: ContentIndex, current: string): string =>
  content.currents[current as CurrentId]?.name ?? current;

/**
 * A character, said out loud.
 *
 * "Chatstorm Piper, 4 attack 5 health, Tide, Parasocial. Ready." — §16.2's
 * shape, with attack and health spelled out rather than written "4/5", because
 * a screen reader reads a slash as "slash" and the two numbers are the two most
 * important things on the card.
 */
export function describeCharacter(
  content: ContentIndex,
  character: CharacterInstance,
  view: PlayerView,
  legality: Legality
): string {
  const parts: string[] = [
    nameOf(content, character.cardId),
    `${character.attack} attack ${character.health} health`,
    currentName(content, character.current),
  ];
  for (const keyword of character.keywords) {
    parts.push(content.keywords[keyword]?.name ?? String(keyword));
  }
  for (const status of character.statuses) {
    const definition = content.statuses[status.id];
    const turns = status.remainingTurns;
    parts.push(`${definition?.name ?? status.id}${turns && turns > 0 ? ` ${turns} turn${turns === 1 ? "" : "s"}` : ""}`);
  }
  if (character.equipment) parts.push(`equipped with ${nameOf(content, character.equipment.cardId)}`);

  const own = character.controller === view.seat;
  if (own) {
    // "Summoning sick" is the single most common reason a player thinks the
    // game is broken, so it is said rather than implied by the absence of "ready"
    parts.push(legality.canAttack.has(character.instanceId) ? "Ready" : sickReason(character, view));
  }
  return `${parts.join(", ")}.`;
}

function sickReason(character: CharacterInstance, view: PlayerView): string {
  if (character.enteredOnTurn >= view.globalTurnCounter) return "Summoning sick";
  if (character.attacksUsedThisTurn >= character.maxAttacksPerTurn) return "Already attacked";
  return "Not ready";
}

/** A hand card, said out loud, with its real cost and whether you can afford it. */
export function describeHandCard(
  content: ContentIndex,
  instanceId: string,
  cardId: string,
  cost: number,
  legality: Legality
): string {
  const card = content.cards[cardId];
  const type = card ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : "Card";
  const bits = [nameOf(content, cardId), `${cost} Hype`, currentName(content, card?.current ?? ""), type];
  bits.push(legality.playable.has(instanceId) ? "Playable" : "Not playable");
  return `${bits.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// The zones
// ---------------------------------------------------------------------------

/**
 * Every focusable position on the board, in §13.1's order.
 *
 * An empty board slot is included **only while you are placing a character** —
 * the caller passes `placing` — because an empty slot is not a thing to browse,
 * it is a thing to choose. Outside placement it would be six positions of
 * "Slot 4 of 6, empty" between you and the character you were going for.
 */
export function boardZones(
  content: ContentIndex,
  view: PlayerView,
  legality: Legality,
  options: { placing?: boolean } = {}
): BoardZone[] {
  const zones: BoardZone[] = [];
  const push = (id: ZoneId, slots: BoardSlot[]): void => {
    zones.push({ id, label: ZONE_LABEL[id], slots });
  };

  push(
    "hand",
    view.you.hand.map((instance, index) => ({
      zone: "hand" as const,
      index,
      ref: { kind: "handCard" as const, instanceId: instance.instanceId },
      label: describeHandCard(
        content,
        instance.instanceId,
        instance.cardId,
        Math.max(0, (content.cards[instance.cardId]?.cost ?? 0) + instance.costDelta),
        legality
      ),
      actionable: legality.playable.has(instance.instanceId),
    }))
  );

  const yourBoard: BoardSlot[] = [];
  view.you.board.forEach((character, slot) => {
    if (character) {
      yourBoard.push({
        zone: "yourBoard",
        index: yourBoard.length,
        ref: { kind: "character", instanceId: character.instanceId },
        label: `Slot ${slot + 1}: ${describeCharacter(content, character, view, legality)}`,
        actionable: legality.canAttack.has(character.instanceId),
      });
    } else if (options.placing) {
      yourBoard.push({
        zone: "yourBoard",
        index: yourBoard.length,
        ref: { kind: "emptySlot", slot },
        label: `Slot ${slot + 1} of ${view.you.board.length}, empty.`,
        actionable: true,
      });
    }
  });
  push("yourBoard", yourBoard);

  push(
    "yourLocation",
    view.you.location
      ? [
          {
            zone: "yourLocation" as const,
            index: 0,
            ref: { kind: "location" as const, seat: view.seat },
            label: `${nameOf(content, view.you.location.cardId)}, durability ${
              view.you.location.durability ?? "unlimited"
            }${view.you.location.usedThisTurn ? ", used this turn" : ""}.`,
            actionable: legality.canActivateLocation,
          },
        ]
      : []
  );

  push("yourLeader", [
    {
      zone: "yourLeader",
      index: 0,
      ref: { kind: "leader", seat: view.seat },
      label: describeLeader(content, view, "you", legality),
      actionable: legality.canFixation || legality.canUltimate,
    },
  ]);

  push(
    "confluence",
    legality.confluences.map((entry, index) => ({
      zone: "confluence" as const,
      index,
      ref: { kind: "confluence" as const, confluenceId: entry.confluence },
      label: `${content.confluences[entry.confluence]?.name ?? entry.confluence}: ${
        entry.available ? "available" : `unavailable, ${entry.reasonUnavailable ?? "not ready"}`
      }.`,
      actionable: entry.available,
    }))
  );

  const enemyBoard: BoardSlot[] = [];
  view.opponent.board.forEach((character, slot) => {
    if (!character) return;
    enemyBoard.push({
      zone: "enemyBoard",
      index: enemyBoard.length,
      ref: { kind: "character", instanceId: character.instanceId },
      label: `Slot ${slot + 1}: ${describeCharacter(content, character, view, legality)}`,
      actionable: false,
    });
  });
  push("enemyBoard", enemyBoard);

  push(
    "enemyLocation",
    view.opponent.location
      ? [
          {
            zone: "enemyLocation" as const,
            index: 0,
            ref: { kind: "location" as const, seat: (view.seat === 0 ? 1 : 0) as Seat },
            label: `${nameOf(content, view.opponent.location.cardId)}, durability ${
              view.opponent.location.durability ?? "unlimited"
            }.`,
            actionable: false,
          },
        ]
      : []
  );

  push("enemyLeader", [
    {
      zone: "enemyLeader",
      index: 0,
      ref: { kind: "leader", seat: (view.seat === 0 ? 1 : 0) as Seat },
      label: describeLeader(content, view, "opponent", legality),
      actionable: false,
    },
  ]);

  push(
    "reactions",
    view.you.reactions.map((reaction, index) => ({
      zone: "reactions" as const,
      index,
      ref: { kind: "reaction" as const, instanceId: reaction.instanceId },
      label: `${nameOf(content, reaction.cardId)}, set on turn ${reaction.setOnTurn}.`,
      actionable: false,
    }))
  );

  const events: BoardSlot[] = [];
  for (const [who, active] of [
    ["Yours", view.you.activeEvent],
    ["Opponent", view.opponent.activeEvent],
  ] as const) {
    if (!active) continue;
    events.push({
      zone: "events",
      index: events.length,
      ref: { kind: "event", instanceId: active.instanceId },
      label: `${who}: ${nameOf(content, active.cardId)}, ${active.remainingTurns} turn${
        active.remainingTurns === 1 ? "" : "s"
      } left.`,
      actionable: false,
    });
  }
  push("events", events);

  push("history", [
    { zone: "history", index: 0, ref: { kind: "button", id: "history" }, label: "History rail.", actionable: true },
  ]);

  push("endTurn", [
    {
      zone: "endTurn",
      index: 0,
      ref: { kind: "button", id: "endTurn" },
      label: legality.yourTurn ? "End turn." : "End turn, not your turn.",
      actionable: legality.yourTurn,
    },
  ]);

  return zones;
}

function describeLeader(
  content: ContentIndex,
  view: PlayerView,
  side: "you" | "opponent",
  legality: Legality
): string {
  const player = side === "you" ? view.you : view.opponent;
  const bits = [
    nameOf(content, player.leaderCardId),
    `${player.leaderHealth} of ${player.leaderMaxHealth} health`,
  ];
  if (player.armor > 0) bits.push(`${player.armor} armor`);
  bits.push(`Hype ${player.hype} of ${player.hypeMax}`);
  bits.push(`Obsession ${player.obsession} of ${content.balance.obsession.max}`);
  if (player.obsession >= content.balance.obsession.obsessedThreshold) bits.push("OBSESSED");
  if (side === "you") {
    if (view.you.pureCurrent) {
      bits.push(`Resonance ${view.you.resonanceProgress} of ${content.balance.resonance.threshold}`);
    }
    if (legality.canFixation) bits.push("Fixation ready");
    if (legality.canUltimate) bits.push("Ultimate ready");
  }
  return `${bits.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// The Board Mirror — §16.2
// ---------------------------------------------------------------------------

export interface MirrorLine {
  /** nesting depth, so the DOM can be a real nested list rather than a blob */
  depth: number;
  text: string;
}

/**
 * The whole visible match state, as text — §16.2's tree.
 *
 * Built from the same redacted view the presenter renders, which is what makes
 * "it can never drift from the board" true rather than aspirational: there is
 * one source, and this reads it.
 *
 * Note what it does **not** contain: the opponent's hand, their deck order,
 * their face-down Reactions. The view is redacted before it reaches here, so the
 * mirror cannot leak what the board does not show — a screen reader must not be
 * a cheat.
 */
export function mirrorLines(content: ContentIndex, view: PlayerView, legality: Legality): MirrorLine[] {
  const lines: MirrorLine[] = [];
  const add = (depth: number, text: string): void => {
    lines.push({ depth, text });
  };

  add(0, `Turn ${view.turn}, ${view.activeSeat === view.seat ? "your turn" : "opponent's turn"}.`);
  add(0, `You: ${describeLeader(content, view, "you", legality)}`);
  add(0, `Opponent: ${describeLeader(content, view, "opponent", legality)}`);

  const zones = boardZones(content, view, legality);
  const byId = new Map(zones.map((zone) => [zone.id, zone]));

  const yourBoard = byId.get("yourBoard")!;
  add(0, `Your board, ${yourBoard.slots.length} of ${view.you.board.length}.`);
  if (yourBoard.slots.length === 0) add(1, "Empty.");
  for (const slot of yourBoard.slots) add(1, slot.label);

  const enemyBoard = byId.get("enemyBoard")!;
  add(0, `Opponent board, ${enemyBoard.slots.length} of ${view.opponent.board.length}.`);
  if (enemyBoard.slots.length === 0) add(1, "Empty.");
  for (const slot of enemyBoard.slots) add(1, slot.label);

  const hand = byId.get("hand")!;
  add(0, `Your hand, ${hand.slots.length} card${hand.slots.length === 1 ? "" : "s"}.`);
  for (const slot of hand.slots) add(1, `Card ${slot.index + 1}: ${slot.label}`);

  const location = byId.get("yourLocation")!;
  add(0, location.slots[0] ? `Your location: ${location.slots[0].label}` : "Your location: none.");

  add(
    0,
    `Reactions: ${view.you.reactions.length} set. Events: ${
      view.you.activeEvent || view.opponent.activeEvent ? byId.get("events")!.slots.length : "none"
    }.`
  );

  const available = legality.confluences.filter((entry) => entry.available);
  add(
    0,
    available.length === 0
      ? "No Confluence available."
      : `Confluence available: ${available
          .map((entry) => content.confluences[entry.confluence]?.name ?? entry.confluence)
          .join(", ")}.`
  );

  add(0, `Deck ${view.you.deck.length}, discard ${view.you.discard.length}. Opponent hand ${view.opponent.handCount}, deck ${view.opponent.deckCount}.`);

  return lines;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** A legal target, said out loud — §13.3's "Target 2 of 3: Foam Knight, 3/4, Root." */
export function describeTarget(
  content: ContentIndex,
  view: PlayerView,
  legality: Legality,
  target: TargetRef,
  index: number,
  total: number
): string {
  const prefix = `Target ${index + 1} of ${total}: `;
  if (target.kind === "leader") {
    const side = target.seat === view.seat ? "your leader" : "opponent's leader";
    const player = target.seat === view.seat ? view.you : view.opponent;
    return `${prefix}${side}, ${nameOf(content, player.leaderCardId)}, ${player.leaderHealth} health.`;
  }
  const character =
    view.you.board.find((entry) => entry?.instanceId === target.instanceId) ??
    view.opponent.board.find((entry) => entry?.instanceId === target.instanceId);
  if (!character) return `${prefix}unknown.`;
  return `${prefix}${describeCharacter(content, character, view, legality)}`;
}
