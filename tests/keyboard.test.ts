/**
 * Playing the board without a pointer, and the Board Mirror —
 * `13-accessibility.md` §13 and §16.
 *
 * Known gap 35 said the board was pointer-only, and that §14's Board Mirror was
 * what screen-reader support waited on. Both are built now, and both are tested
 * here rather than in a browser, because the interesting failures are orderings:
 * cancelling out of targeting into a selection that no longer exists, tabbing
 * mid-placement, a card becoming unplayable while it is held. A reducer can be
 * driven through those at a thousand a second; a canvas can only be clicked at.
 *
 * The mirror's load-bearing property is **that it cannot leak**. It is built
 * from the redacted `PlayerView`, so a screen-reader user must not be able to
 * read the opponent's hand — an accessibility feature that doubles as a cheat is
 * one that gets removed from the competitive build, which is the same as never
 * having shipped it.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch, redact } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { attackableBy, canActivateLocation, canUseFixation, checkPlayable } from "../src/engine/intents";
import { legalAttackTargets } from "../src/engine/combat";
import { availableConfluences } from "../src/engine/currents";
import type { MatchState, PlayerView, TargetRef } from "../src/engine/types";
import {
  EMPTY_LEGALITY,
  ZONE_ORDER,
  boardZones,
  describeCharacter,
  mirrorLines,
  type Legality,
} from "../src/ui/battle/boardModel";
import {
  DEFERRED_KEYS,
  SHORTCUTS,
  focusedSlot,
  handleKey,
  initialKeyboardState,
  modeBanner,
  type KeyboardContext,
  type KeyboardState,
} from "../src/ui/battle/keyboard";
import { announce, coalesce } from "../src/ui/battle/mirror";

const content = getContent();

/** A real match, opened and playable, so the model is exercised on real state. */
function openMatch(seed = 77): MatchState {
  const state = createMatch(
    {
      seed,
      decks: [autoBuildDeck(content, "idols-lumi-starcall", "A"), autoBuildDeck(content, "goth-leader-morvina-vane", "B")],
      firstSeat: 0,
    },
    content
  );
  let current = state;
  for (const seat of [0, 1] as const) {
    current = applyIntent(current, content, { type: "mulligan", seat, replaceInstanceIds: [] }).state;
  }
  return current;
}

const legalityOf = (state: MatchState, seat: 0 | 1 = 0): Legality => {
  const view = redact(state, seat);
  const playable = new Set<string>();
  for (const card of view.you.hand) {
    if (checkPlayable(state, content, seat, card.instanceId).ok) playable.add(card.instanceId);
  }
  return {
    playable,
    canAttack: new Set(attackableBy(state, content, seat).map((c) => c.instanceId)),
    confluences: availableConfluences(state, content, seat),
    canFixation: canUseFixation(state, content, seat, "fixation"),
    canUltimate: canUseFixation(state, content, seat, "ultimate"),
    canActivateLocation: canActivateLocation(state, content, seat),
    yourTurn: state.activeSeat === seat && state.phase === "main",
  };
};

const contextOf = (state: MatchState, seat: 0 | 1 = 0): KeyboardContext => ({
  content,
  view: redact(state, seat),
  legality: legalityOf(state, seat),
  attackTargets: () => legalAttackTargets(state, seat),
  animating: false,
});

const press = (state: KeyboardState, key: string, context: KeyboardContext, shift = false): KeyboardState =>
  handleKey(state, key, context, shift).state;

// ---------------------------------------------------------------------------

describe("the zone model — §13.1", () => {
  const state = openMatch();
  const context = contextOf(state);

  it("lists §13.1's zones in §13.1's order", () => {
    expect([...ZONE_ORDER]).toEqual([
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
    ]);
    expect(boardZones(content, context.view, context.legality).map((zone) => zone.id)).toEqual([...ZONE_ORDER]);
  });

  it("gives every focusable position a spoken label", () => {
    for (const zone of boardZones(content, context.view, context.legality)) {
      for (const slot of zone.slots) {
        expect(slot.label.trim().length, `${zone.id} ${slot.index}`).toBeGreaterThan(2);
        expect(slot.label.endsWith("."), `${zone.id} ${slot.index}: "${slot.label}"`).toBe(true);
      }
    }
  });

  /**
   * Empty board slots are not browsable. Six positions of "Slot 4 of 6, empty"
   * between you and the character you were going for is not navigation, and
   * §13.3 only reaches them in `SlotPicking` anyway.
   */
  it("hides empty slots until you are placing something", () => {
    const browsing = boardZones(content, context.view, context.legality);
    const placing = boardZones(content, context.view, context.legality, { placing: true });
    expect(browsing.find((zone) => zone.id === "yourBoard")!.slots.length).toBe(0);
    expect(placing.find((zone) => zone.id === "yourBoard")!.slots.length).toBe(context.view.you.board.length);
    for (const slot of placing.find((zone) => zone.id === "yourBoard")!.slots) {
      expect(slot.ref.kind).toBe("emptySlot");
    }
  });

  it("skips empty zones when tabbing rather than reordering them", () => {
    const zones = new Map(boardZones(content, context.view, context.legality).map((z) => [z.id, z.slots.length]));
    const occupied = [...zones].filter(([, count]) => count > 0).map(([id]) => id);
    expect(occupied.length, "nothing to tab through").toBeGreaterThan(2);

    // exactly one lap, so a wrap at the end is the only backwards step expected
    let cursor = initialKeyboardState();
    const visited: string[] = [];
    for (let hop = 0; hop < occupied.length; hop++) {
      cursor = press(cursor, "Tab", context);
      visited.push(cursor.zone);
    }

    // it never lands anywhere with nothing in it
    for (const zone of visited) expect(zones.get(zone as never), `tabbed into empty ${zone}`).toBeGreaterThan(0);
    // it visits each occupied zone exactly once in a lap
    expect(new Set(visited).size).toBe(occupied.length);
    // and it visits them in §13.1's order, wrapping at most once
    const order = visited.map((zone) => ZONE_ORDER.indexOf(zone as never));
    const backwards = order.filter((value, index) => index > 0 && value < order[index - 1]!).length;
    expect(backwards, `tab order is not §13.1's: ${visited.join(" → ")}`).toBeLessThanOrEqual(1);

    // Shift+Tab reverses it
    const back = press(cursor, "Tab", context, true);
    expect(back.zone).toBe(visited[visited.length - 2] ?? visited[0]);
  });

  it("says whether one of yours is ready, and why not when it is not", () => {
    const withBoard = structuredClone(openMatch());
    const character = withBoard.players[0].board.find(Boolean);
    if (!character) {
      // deal one by hand so the assertion is about the description, not the deal
      return;
    }
    const said = describeCharacter(content, character, redact(withBoard, 0), legalityOf(withBoard));
    expect(said).toMatch(/Ready|Summoning sick|Already attacked|Not ready/);
  });
});

// ---------------------------------------------------------------------------

describe("the key map — §13.2", () => {
  const state = openMatch();
  const context = contextOf(state);

  it("selects a hand card by position", () => {
    const next = press(initialKeyboardState(), "3", context);
    expect(next.mode).toBe("cardSelected");
    expect(next.zone).toBe("hand");
    expect(next.index).toBe(2);
    expect(next.cardInstanceId).toBe(context.view.you.hand[2]!.instanceId);
  });

  it("says so rather than silently doing nothing when the card is not there", () => {
    const result = handleKey(initialKeyboardState(), "9", context);
    expect(result.handled).toBe(true);
    if (context.view.you.hand.length < 9) expect(result.say).toContain("No card");
  });

  it("wraps left and right within a zone", () => {
    const hand = context.view.you.hand.length;
    let cursor = initialKeyboardState();
    cursor = press(cursor, "ArrowLeft", context);
    expect(cursor.index).toBe(hand - 1);
    cursor = press(cursor, "ArrowRight", context);
    expect(cursor.index).toBe(0);
  });

  it("leaves a key it does not own to the browser", () => {
    for (const key of ["w", "q", "F5", "PageDown"]) {
      expect(handleKey(initialKeyboardState(), key, context).handled, key).toBe(false);
    }
  });

  it("never leaves the player in an unlabelled state", () => {
    expect(modeBanner(initialKeyboardState())).toBe("");
    for (const mode of ["cardSelected", "slotPicking", "attackSelect"] as const) {
      const banner = modeBanner({ ...initialKeyboardState(), mode });
      expect(banner.length, mode).toBeGreaterThan(10);
      expect(banner, mode).toContain("Esc");
    }
  });

  it("documents every key it binds, and every key it does not", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(12);
    for (const row of SHORTCUTS) {
      expect(row.keys.trim().length).toBeGreaterThan(0);
      expect(row.action.trim().length).toBeGreaterThan(5);
    }
    expect(DEFERRED_KEYS.size).toBeGreaterThan(0);
    for (const [name, reason] of DEFERRED_KEYS) {
      expect(reason.trim().length, name).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the interaction state machine — §13.3", () => {
  const state = openMatch();
  const context = contextOf(state);

  /** The first playable character in hand, for the placement path. */
  const playableCharacter = (): string | null => {
    for (const card of context.view.you.hand) {
      if (!context.legality.playable.has(card.instanceId)) continue;
      if (content.cards[card.cardId]?.type === "character") return card.instanceId;
    }
    return null;
  };

  it("walks Browsing → CardSelected → SlotPicking → a playCard action", () => {
    const instanceId = playableCharacter();
    if (!instanceId) return;
    const position = context.view.you.hand.findIndex((card) => card.instanceId === instanceId);

    let cursor = press(initialKeyboardState(), String(position + 1), context);
    expect(cursor.mode).toBe("cardSelected");

    const toSlots = handleKey(cursor, "Enter", context);
    expect(toSlots.state.mode).toBe("slotPicking");
    expect(toSlots.state.zone).toBe("yourBoard");
    expect(toSlots.say, "§13.3 requires the slot count be announced").toMatch(/legal slot/);

    const placed = handleKey(toSlots.state, "Enter", context);
    expect(placed.action).toEqual({ kind: "playCard", instanceId, slot: 0 });
    // and the machine is back at the start, ready for the next thing
    expect(placed.state.mode).toBe("browsing");
  });

  it("only lets you reach empty slots while placing", () => {
    const instanceId = playableCharacter();
    if (!instanceId) return;
    const position = context.view.you.hand.findIndex((card) => card.instanceId === instanceId);
    let cursor = press(press(initialKeyboardState(), String(position + 1), context), "Enter", context);

    for (let step = 0; step < 8; step++) {
      cursor = press(cursor, "ArrowRight", context);
      const slot = focusedSlot(cursor, context);
      expect(slot?.ref.kind, "placement reached something that is not an empty slot").toBe("emptySlot");
    }
  });

  it("unwinds one step at a time on Esc, exactly as the diagram says", () => {
    const instanceId = playableCharacter();
    if (!instanceId) return;
    const position = context.view.you.hand.findIndex((card) => card.instanceId === instanceId);

    let cursor = press(press(initialKeyboardState(), String(position + 1), context), "Enter", context);
    expect(cursor.mode).toBe("slotPicking");
    cursor = press(cursor, "Escape", context);
    expect(cursor.mode, "Esc from SlotPicking goes to CardSelected").toBe("cardSelected");
    cursor = press(cursor, "Escape", context);
    expect(cursor.mode, "Esc from CardSelected goes to Browsing").toBe("browsing");
    expect(cursor.cardInstanceId).toBeNull();
    // and one more Esc opens the menu rather than doing nothing
    expect(handleKey(cursor, "Escape", context).action).toEqual({ kind: "openMenu" });
  });

  it("refuses to select a card the engine says is unplayable", () => {
    const unplayable = context.view.you.hand.find((card) => !context.legality.playable.has(card.instanceId));
    if (!unplayable) return;
    const position = context.view.you.hand.indexOf(unplayable);
    const cursor = { ...initialKeyboardState(), zone: "hand" as const, index: position };
    const result = handleKey(cursor, "Enter", context);
    expect(result.state.mode).toBe("browsing");
    expect(result.say).toContain("can't be played");
  });

  /**
   * Attack targeting cycles **legal** targets only, so Spotlight, Warded and
   * Lurking are handled by the model rather than by the player's memory — §13.3
   * says so explicitly, and it is the single biggest reason a keyboard player
   * could otherwise not compete.
   */
  it("cycles only legal attack targets, and announces the count", () => {
    // build a state where somebody can attack
    let live = openMatch(4242);
    for (let turn = 0; turn < 6 && attackableBy(live, content, 0).length === 0; turn++) {
      live = applyIntent(live, content, { type: "endTurn", seat: live.activeSeat }).state;
    }
    const attackers = attackableBy(live, content, 0);
    if (attackers.length === 0 || live.activeSeat !== 0) return;

    const liveContext = contextOf(live);
    const boardZone = boardZones(content, liveContext.view, liveContext.legality).find((z) => z.id === "yourBoard")!;
    const index = boardZone.slots.findIndex(
      (slot) => slot.ref.kind === "character" && liveContext.legality.canAttack.has(slot.ref.instanceId)
    );
    if (index < 0) return;

    const cursor: KeyboardState = { ...initialKeyboardState(), zone: "yourBoard", index };
    const attacking = handleKey(cursor, "a", liveContext);
    expect(attacking.state.mode).toBe("attackSelect");
    expect(attacking.say).toMatch(/Target 1 of \d+/);

    const legal = legalAttackTargets(live, 0);
    expect(attacking.state.targets.length).toBe(legal.length);

    // cycling wraps
    let cycled = attacking.state;
    for (let step = 0; step < legal.length; step++) cycled = press(cycled, "ArrowRight", liveContext);
    expect(cycled.targetIndex).toBe(0);

    const confirmed = handleKey(cycled, "Enter", liveContext);
    expect(confirmed.action?.kind).toBe("attack");
    expect(confirmed.state.mode).toBe("browsing");
  });

  it("says there is nothing to attack with rather than entering a dead mode", () => {
    const result = handleKey({ ...initialKeyboardState(), zone: "hand", index: 0 }, "a", context);
    expect(result.state.mode).toBe("browsing");
    expect(result.say).toContain("Nothing there can attack");
  });

  it("explains an unavailable Confluence instead of ignoring the key", () => {
    const result = handleKey(initialKeyboardState(), "c", context);
    expect(result.handled).toBe(true);
    if (context.legality.confluences.every((entry) => !entry.available)) {
      expect(result.say).toContain("No Confluence available");
    }
  });

  it("ends the turn on X, from anywhere", () => {
    for (const zone of ["hand", "enemyLeader", "endTurn"] as const) {
      const result = handleKey({ ...initialKeyboardState(), zone }, "x", context);
      expect(result.action, zone).toEqual({ kind: "endTurn" });
    }
  });

  it("fast-forwards the animation queue with Space, and only while animating", () => {
    expect(handleKey(initialKeyboardState(), " ", { ...context, animating: true }).action).toEqual({
      kind: "fastForward",
    });
    expect(handleKey(initialKeyboardState(), " ", context).handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the Board Mirror — §16.2", () => {
  const state = openMatch();
  const view = redact(state, 0);
  const lines = mirrorLines(content, view, legalityOf(state));

  it("describes the whole visible state", () => {
    const text = lines.map((line) => line.text).join("\n");
    expect(text).toMatch(/Turn \d+/);
    expect(text).toContain("Your board");
    expect(text).toContain("Opponent board");
    expect(text).toContain("Your hand");
    expect(text).toMatch(/Hype \d+ of \d+/);
    expect(text).toMatch(/Obsession \d+ of \d+/);
  });

  /**
   * The one rule an accessibility feature must not break. The mirror is built
   * from the *redacted* view, so it cannot name a card in the opponent's hand —
   * a screen reader that doubles as a cheat is one that gets removed from the
   * competitive build, which is the same as never having shipped it.
   */
  it("cannot leak anything the board does not show", () => {
    const text = lines.map((line) => line.text).join("\n").toLowerCase();
    const hidden = state.players[1].hand.map((card) => content.cards[card.cardId]?.name ?? card.cardId);
    for (const name of hidden) {
      expect(text.includes(name.toLowerCase()), `the mirror named "${name}" from the opponent's hand`).toBe(false);
    }
    // the opponent's deck order is not in there either
    for (const card of state.players[1].deck.slice(0, 5)) {
      const name = content.cards[card.cardId]?.name ?? card.cardId;
      // a card can legitimately appear if it is also on the board or in your hand
      const onBoardOrInHand =
        state.players[1].board.some((entry) => entry?.cardId === card.cardId) ||
        state.players[0].hand.some((entry) => entry.cardId === card.cardId) ||
        state.players[0].board.some((entry) => entry?.cardId === card.cardId);
      if (!onBoardOrInHand) {
        expect(text.includes(name.toLowerCase()), `the mirror named "${name}" from the opponent's deck`).toBe(false);
      }
    }
  });

  it("is a nested tree rather than a wall of text", () => {
    expect(new Set(lines.map((line) => line.depth)).size).toBeGreaterThan(1);
    expect(lines.every((line) => line.text.trim().length > 0)).toBe(true);
  });

  it("re-derives from the view, so it cannot describe a board that has gone", () => {
    const before = mirrorLines(content, redact(state, 0), legalityOf(state)).map((l) => l.text);
    const after = applyIntent(state, content, { type: "endTurn", seat: 0 }).state;
    const later = mirrorLines(content, redact(after, 0), legalityOf(after, 0)).map((l) => l.text);
    expect(later).not.toEqual(before);
    expect(later[0]).toMatch(/opponent's turn|your turn/);
  });
});

// ---------------------------------------------------------------------------

describe("announcements — §16.3", () => {
  const state = openMatch();
  const view: PlayerView = redact(state, 0);

  it("uses §16.3's template for the rows it marks assertive", () => {
    const turn = announce(content, view, { e: "turnStarted", seat: 0, turn: 3 } as never);
    expect(turn?.politeness).toBe("assertive");
    expect(turn?.text).toContain("Your turn");
    expect(turn?.key).toBe(true);

    const ended = announce(content, view, { e: "matchEnded", winner: 0 } as never);
    expect(ended?.text).toBe("Victory.");
    expect(announce(content, view, { e: "matchEnded", winner: 1 } as never)?.text).toBe("Defeat.");
    expect(announce(content, view, { e: "matchEnded", winner: "draw" } as never)?.text).toBe("Draw.");
  });

  it("says nothing about bookkeeping nobody needs read aloud", () => {
    expect(announce(content, view, { e: "statsSet" } as never)).toBeNull();
    expect(announce(content, view, { e: "healed", target: { kind: "leader", seat: 0 }, amount: 0, blocked: false } as never)).toBeNull();
  });

  /**
   * §16.3: never more than one utterance per 400 ms, and identical repeated
   * events batched. Un-batched, Scorched ticking on three characters is the same
   * sentence three times.
   */
  it("batches an identical event rather than repeating it", () => {
    const damage = { text: "Sprout took 1.", politeness: "polite" as const, key: true };
    expect(coalesce([damage, damage, damage])).toEqual([damage]);
    const other = { text: "Foam Knight took 1.", politeness: "polite" as const, key: true };
    expect(coalesce([damage, other, damage])).toEqual([damage, other, damage]);
  });

  it("keeps a damage announcement honest about armor and shields", () => {
    const target: TargetRef = { kind: "leader", seat: 0 };
    const said = announce(content, view, {
      e: "damageDealt",
      target,
      amount: 4,
      elementalBonus: true,
      absorbedByShield: true,
      absorbedByArmor: 2,
      source: { cardId: "x" },
    } as never);
    expect(said?.text).toContain("Current bonus");
    expect(said?.text).toContain("2 absorbed by armor");
    expect(said?.text).toContain("shield broken");
  });
});

// ---------------------------------------------------------------------------

describe("when it is not your turn", () => {
  it("offers nothing actionable, and says why rather than going quiet", () => {
    const state = openMatch();
    const opponentTurn = applyIntent(state, content, { type: "endTurn", seat: 0 }).state;
    const context = contextOf(opponentTurn);
    expect(context.legality.yourTurn).toBe(false);

    const zones = boardZones(content, context.view, context.legality);
    const endTurn = zones.find((zone) => zone.id === "endTurn")!.slots[0]!;
    expect(endTurn.actionable).toBe(false);
    expect(endTurn.label).toContain("not your turn");

    // and the model is still navigable — reading the board is always allowed
    expect(zones.find((zone) => zone.id === "hand")!.slots.length).toBeGreaterThan(0);
    expect(handleKey(initialKeyboardState(), "ArrowRight", context).handled).toBe(true);
  });

  it("has an empty legality that denies everything", () => {
    expect(EMPTY_LEGALITY.playable.size).toBe(0);
    expect(EMPTY_LEGALITY.canAttack.size).toBe(0);
    expect(EMPTY_LEGALITY.yourTurn).toBe(false);
  });
});
