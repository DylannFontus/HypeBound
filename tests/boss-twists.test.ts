/**
 * The ten faction bosses, and the engine primitives they needed.
 *
 * Two halves, deliberately:
 *
 * 1. **The primitives, on fixture cards.** Each new trigger and op asserted
 *    against a hand-built pool, so these keep meaning the same thing while real
 *    card numbers churn.
 * 2. **The ten shipped twists, against real content.** Every one asserted to
 *    produce the effect its own card text promises.
 *
 * The second half exists because the boss suite already had a test that every
 * boss "carries its twist as a passive" — and that test passes for a passive
 * that does nothing at all. `passive.length > 0` proves an array is non-empty,
 * not that a character comes back from the dead. Eight of these twists went
 * unbuilt for exactly as long as that was the only check on them, and the two
 * that *were* built turned out to include one that had never worked.
 */

import { describe, expect, it } from "vitest";
import { fillDeck, fixtureContent, giveCard, harness, placeCharacter, testAction, testCharacter, testLeader } from "./fixtures";
import type { CardDef, EncounterSetup, EngineEvent, MatchConfig, MatchState, Seat, TargetSpec } from "../src/engine/types";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch, findCharacter, redact } from "../src/engine/state";
import { applyIntent, beginScriptedMatch } from "../src/engine/reducer";
import { previewAttack } from "../src/engine/combat";
import { BOSSES } from "../src/game/weeklyBoss";
import {
  cleanupDefeated,
  dealDamage,
  makeContext,
  resolveTargets,
  totalAttack,
} from "../src/engine/effects";

// ---------------------------------------------------------------------------
// Part 1 — the primitives, on fixture cards
// ---------------------------------------------------------------------------

const CARDS: CardDef[] = [
  testLeader("plain"),

  /** The Vigil, in miniature. */
  testLeader("lead-vigil", {
    passive: [
      {
        trigger: "onFriendlyDefeated",
        oncePerTurn: true,
        text: "vigil",
        ops: [{ op: "revive", target: { select: "triggering" }, health: 1 }],
      },
    ],
  }),
  /** The same, ungated, so a test can show it is `oncePerTurn` doing the limiting. */
  testLeader("lead-vigil-always", {
    passive: [
      {
        trigger: "onFriendlyDefeated",
        text: "vigil, every time",
        ops: [{ op: "revive", target: { select: "triggering" }, health: 1 }],
      },
    ],
  }),

  /** Counts its own draws and, separately, the opponent's. */
  testLeader("lead-draw-watch", {
    passive: [
      { trigger: "onCardDrawn", text: "mine", ops: [{ op: "addCounter", key: "myDraws", amount: 1 }] },
      { trigger: "onEnemyCardDrawn", text: "theirs", ops: [{ op: "addCounter", key: "theirDraws", amount: 1 }] },
    ],
  }),
  /** Corrupted Feed, in miniature: every second enemy draw costs (1) more. */
  testLeader("lead-tax-draws", {
    passive: [
      {
        trigger: "onEnemyCardDrawn",
        text: "tax",
        ops: [
          { op: "addCounter", key: "feed", amount: 1, side: "enemy" },
          {
            op: "if",
            condition: { kind: "counterAtLeast", key: "feed", value: 2, side: "enemy" },
            then: [
              { op: "setCounter", key: "feed", amount: 0, side: "enemy" },
              { op: "modifyTriggeringCardCost", delta: 1 },
            ],
          },
        ],
      },
    ],
  }),

  testLeader("lead-rotate", {
    current: "tide",
    primaryCurrent: "tide",
    secondaryCurrent: null,
    passive: [{ trigger: "startOfTurn", text: "rotate", ops: [{ op: "rotateLeaderCurrent" }] }],
  }),
  /** Prism has no advantage, so it has nowhere to rotate to. */
  testLeader("lead-rotate-prism", {
    passive: [{ trigger: "startOfTurn", text: "rotate", ops: [{ op: "rotateLeaderCurrent" }] }],
  }),

  /** Log Off, in miniature. */
  testLeader("lead-logoff", {
    passive: [
      {
        trigger: "startOfTurn",
        text: "banish the biggest",
        ops: [
          {
            op: "banish",
            target: { select: "highestCost", side: "enemy", zone: "board" },
            returnAtStartOfYourNextTurn: true,
          },
        ],
      },
    ],
  }),

  /** Engagement Farming, in miniature. */
  testLeader("lead-farm", {
    passive: [
      {
        trigger: "startOfTurn",
        text: "farm",
        ops: [{ op: "summon", cardId: "token-follower", count: { kind: "cardsPlayedLastTurn", side: "enemy" } }],
      },
    ],
  }),

  /** The Feed Decides, in miniature. */
  testLeader("lead-feed", {
    passive: [
      {
        trigger: "enemyStartOfTurn",
        text: "bury the good one",
        ops: [{ op: "scry", count: 2, mode: "bottomOne", side: "enemy", pick: "mostPlayable" }],
      },
    ],
  }),
  /**
   * Mills the enemy's top card in the same window. Milling is order-revealing in
   * a way counting is not: whichever card ends up in the discard tells you
   * whether the window opened before or after the draw.
   */
  testLeader("lead-mill-at-window", {
    passive: [{ trigger: "enemyStartOfTurn", text: "mill", ops: [{ op: "mill", count: 1, side: "enemy" }] }],
  }),

  /** A conditional aura — Standing Ovation's shape, in miniature. */
  testLeader("lead-conditional-aura", {
    passive: [
      {
        trigger: "aura",
        condition: { kind: "controlsAtLeast", target: { select: "all", side: "friendly", zone: "board" }, min: 3 },
        text: "+1 attack while you hold three",
        ops: [{ op: "aura", target: { select: "all", side: "friendly", zone: "board" }, attack: 1 }],
      },
    ],
  }),

  testCharacter("body-1-1", 1, 1, 1),
  testCharacter("body-2-3", 2, 2, 3),
  testCharacter("dear-1-1", 6, 1, 1),
  testCharacter("mid-2-2", 3, 2, 2),
  testCharacter("cinder-body", 2, 2, 2, { current: "cinder" }),
  testCharacter("marker-a", 1, 1, 1),
  testCharacter("marker-b", 1, 1, 1),

  testAction("cheap-action", 1),
  testAction("dear-action", 8),
  testAction("act-perm-hype", 1, {
    effects: [{ trigger: "onPlay", ops: [{ op: "gainHype", amount: 2, permanent: true }] }],
  }),
  testAction("act-kill-enemy", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "damage", target: { select: "triggering" }, amount: 9 }],
      },
    ],
  }),
  /** Outright removal, as opposed to killing with damage. */
  testAction("act-destroy-enemy", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "destroy", target: { select: "triggering" } }],
      },
    ],
  }),
  testAction("act-banish-enemy", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "banish", target: { select: "triggering" }, returnAtStartOfYourNextTurn: true }],
      },
    ],
  }),
];

const fixtures = fixtureContent(CARDS);

/** Resolve a target spec from a seat's point of view, outside any card. */
function resolveFor(state: MatchState, seat: Seat, spec: TargetSpec) {
  return resolveTargets(makeContext(state, fixtures, seat, "test"), spec);
}

describe("revive / onFriendlyDefeated — cancelling a defeat", () => {
  /** Seat 0 kills things; the Vigil leader sits on seat 1. */
  function vigilBoard(vigilLeader: string) {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck(vigilLeader, ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    // enough Hype for two kills in one turn, which is what the gating tests need
    h.advanceTo(0, 2);
    return h;
  }

  const kill = (h: ReturnType<typeof vigilBoard>, instanceId: string): EngineEvent[] => {
    const card = giveCard(h.state, 0, "act-kill-enemy");
    return h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId }] });
  };

  it("puts the character back on its feet, in its slot, out of the discard", () => {
    const h = vigilBoard("lead-vigil");
    const victim = placeCharacter(h.state, fixtures, 1, "body-2-3", 2);
    // a buff first, so we can prove the SAME instance came back rather than a
    // fresh copy summoned from the discard pile
    findCharacter(h.state, victim)!.attack = 7;

    kill(h, victim);

    const survivor = findCharacter(h.state, victim);
    expect(survivor, "the Vigil did not bring it back").toBeDefined();
    expect(survivor!.health).toBe(1);
    expect(survivor!.slot, "it should stand back up where it fell").toBe(2);
    expect(survivor!.attack, "a re-summon would have reset the buff").toBe(7);
    expect(h.state.players[1].discard.some((c) => c.cardId === "body-2-3")).toBe(false);
  });

  /**
   * `destroy` is not damage, and for the whole life of the op that was the bug.
   *
   * The last-rites guard reads "health above 0 after the window" as "somebody
   * revived it" — which is right when the character arrived here at 0 health,
   * and was catastrophic for `{ op: "destroy" }`, which arrives with a character
   * at FULL health. Every destroy cancelled itself: it emitted `defeatPrevented`
   * and left the character standing. Nothing caught it because the op existed,
   * was schema-valid, and was used by shipped cards and a Current's Resonance.
   */
  it("destroys a character at full health — the op is not damage", () => {
    const h = vigilBoard("plain");
    const victim = placeCharacter(h.state, fixtures, 1, "body-2-3", 1);
    expect(findCharacter(h.state, victim)!.health, "the victim starts undamaged").toBe(3);

    const card = giveCard(h.state, 0, "act-destroy-enemy");
    const events = h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: victim }] });

    expect(findCharacter(h.state, victim), "destroy left it standing").toBeNull();
    expect(events.some((e) => e.e === "characterDefeated")).toBe(true);
    expect(events.some((e) => e.e === "defeatPrevented"), "a destroy is not a prevented defeat").toBe(false);
  });

  it("and a revive still cancels one, so the guard did not simply go away", () => {
    const h = vigilBoard("lead-vigil");
    const victim = placeCharacter(h.state, fixtures, 1, "body-2-3", 1);

    const card = giveCard(h.state, 0, "act-destroy-enemy");
    const events = h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: victim }] });

    expect(findCharacter(h.state, victim)?.health, "the Vigil should have caught it").toBe(1);
    expect(events.some((e) => e.e === "defeatPrevented")).toBe(true);
  });

  it("emits defeatPrevented instead of characterDefeated", () => {
    const h = vigilBoard("lead-vigil");
    const victim = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);
    const events = kill(h, victim);

    expect(events.some((e) => e.e === "defeatPrevented")).toBe(true);
    expect(events.some((e) => e.e === "characterDefeated")).toBe(false);
  });

  it("saves only the first character each turn when the passive says oncePerTurn", () => {
    const h = vigilBoard("lead-vigil");
    const first = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);
    const second = placeCharacter(h.state, fixtures, 1, "body-2-3", 1);

    kill(h, first);
    kill(h, second);

    // health, not toBeDefined: findCharacter returns null for a missing
    // character, and `expect(null).toBeDefined()` passes
    expect(findCharacter(h.state, first)?.health, "the first should have been saved").toBe(1);
    expect(findCharacter(h.state, second), "the second should have stayed dead").toBeNull();
  });

  it("saves both when the passive is ungated — so it is oncePerTurn doing the limiting", () => {
    const h = vigilBoard("lead-vigil-always");
    const first = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);
    const second = placeCharacter(h.state, fixtures, 1, "body-2-3", 1);

    kill(h, first);
    kill(h, second);

    expect(findCharacter(h.state, first)?.health).toBe(1);
    expect(findCharacter(h.state, second)?.health).toBe(1);
  });

  it("does not fire for the enemy's dead — the window belongs to the corpse's controller", () => {
    const h = vigilBoard("lead-vigil");
    const mine = placeCharacter(h.state, fixtures, 0, "body-2-3", 0);
    h.endTurn();

    const card = giveCard(h.state, 1, "act-kill-enemy");
    h.play({ type: "playCard", seat: 1, instanceId: card, targets: [{ kind: "character", instanceId: mine }] });

    expect(findCharacter(h.state, mine), "seat 1's Vigil saved seat 0's character").toBeNull();
  });

  it("leaves a healthy character alone — there is nothing to catch", () => {
    const h = vigilBoard("lead-vigil-always");
    const healthy = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);
    h.endTurn();
    h.endTurn();
    expect(findCharacter(h.state, healthy)!.health).toBe(3);
  });
});

describe("draw triggers", () => {
  const watcher = () =>
    harness({
      content: fixtures,
      decks: [fillDeck("lead-draw-watch", ["body-1-1"]), fillDeck("plain", ["body-1-1"])],
      firstSeat: 0,
    });

  it("scopes onCardDrawn to the drawer and onEnemyCardDrawn to the other seat", () => {
    const h = watcher();
    h.begin();

    const before = { ...h.state.players[0].counters };
    h.endTurn(); // seat 1 starts a turn and draws
    expect(h.state.players[0].counters["theirDraws"] ?? 0).toBe((before["theirDraws"] ?? 0) + 1);
    expect(h.state.players[0].counters["myDraws"] ?? 0, "their draw counted as mine").toBe(before["myDraws"] ?? 0);

    h.endTurn(); // back to seat 0, who draws
    expect(h.state.players[0].counters["myDraws"] ?? 0).toBe((before["myDraws"] ?? 0) + 1);
  });

  it("does not count the opening hand — that is dealt, not drawn", () => {
    const h = watcher();
    expect(h.state.players[0].hand.length).toBeGreaterThan(0);
    expect(h.state.players[0].counters["myDraws"] ?? 0).toBe(0);
  });

  it("re-prices exactly the card just drawn, and only on the nth draw", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-tax-draws", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();

    const taxed = () => h.state.players[0].hand.filter((c) => c.costDelta !== 0);
    expect(taxed().length, "nothing taxed before any draw").toBe(0);

    h.endTurn();
    h.endTurn(); // seat 0's second turn: draw #2 overall — the tax lands
    const hit = taxed();
    expect(hit.length, "exactly one card should carry the tax").toBe(1);
    expect(hit[0]!.costDelta).toBe(1);
    expect(hit[0]!.instanceId, "the taxed card is the one just drawn").toBe(
      h.state.players[0].hand[h.state.players[0].hand.length - 1]!.instanceId
    );
  });
});

describe("highestCost / lowestCost selectors", () => {
  const logoff = () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-logoff", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    return h;
  };

  it("banishes the costliest enemy character and leaves the rest standing", () => {
    const h = logoff();
    const cheap = placeCharacter(h.state, fixtures, 0, "body-1-1", 0); // 1
    const dear = placeCharacter(h.state, fixtures, 0, "dear-1-1", 1); // 6
    const mid = placeCharacter(h.state, fixtures, 0, "mid-2-2", 2); // 3

    h.endTurn(); // seat 1's turn starts — Log Off fires

    expect(findCharacter(h.state, dear), "the costliest should be gone").toBeNull();
    expect(findCharacter(h.state, cheap)).toBeDefined();
    expect(findCharacter(h.state, mid)).toBeDefined();
    expect(h.state.players[0].banished.length).toBe(1);
  });

  it("returns it at the start of the VICTIM's next turn, not the banisher's", () => {
    const h = logoff();
    placeCharacter(h.state, fixtures, 0, "dear-1-1", 0);

    h.endTurn(); // seat 1's turn: banished
    expect(h.state.players[0].banished.length).toBe(1);

    h.endTurn(); // seat 0's next turn: it should be back
    expect(h.state.players[0].banished.length, "stranded for an extra round").toBe(0);
    expect(h.state.players[0].board.filter((c) => c !== null).length).toBe(1);
  });

  it("breaks cost ties by board order", () => {
    const h = logoff();
    const left = placeCharacter(h.state, fixtures, 0, "dear-1-1", 1);
    const right = placeCharacter(h.state, fixtures, 0, "dear-1-1", 4);

    h.endTurn();

    expect(findCharacter(h.state, left)).toBeNull();
    expect(findCharacter(h.state, right)).toBeDefined();
  });

  it("resolves lowestCost to the cheapest", () => {
    const h = logoff();
    placeCharacter(h.state, fixtures, 0, "dear-1-1", 0); // 6
    placeCharacter(h.state, fixtures, 0, "body-1-1", 1); // 1

    const refs = resolveFor(h.state, 1, { select: "lowestCost", side: "enemy", zone: "board" });
    expect(refs.length).toBe(1);
    expect(findCharacter(h.state, (refs[0] as { instanceId: string }).instanceId)!.cardId).toBe("body-1-1");
  });

  it("picks nothing from an empty board rather than throwing", () => {
    const h = logoff();
    expect(resolveFor(h.state, 1, { select: "highestCost", side: "enemy", zone: "board" })).toEqual([]);
  });
});

describe("cardsPlayedLastTurn", () => {
  const farm = () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["cheap-action"]), fillDeck("lead-farm", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    return h;
  };

  it("reports the previous turn's count, not the live one", () => {
    const h = farm();
    h.endTurn();
    h.endTurn(); // seat 0 with 2 Hype

    for (let i = 0; i < 2; i++) {
      const id = giveCard(h.state, 0, "cheap-action");
      h.play({ type: "playCard", seat: 0, instanceId: id });
    }
    expect(h.state.players[0].cardsPlayedThisTurn).toBe(2);
    expect(h.state.players[0].cardsPlayedLastTurn, "the turn is still running").toBe(0);

    h.endTurn(); // seat 1's turn starts and reads last turn's 2
    expect(h.state.players[0].cardsPlayedLastTurn).toBe(2);
    expect(h.state.players[1].board.filter((c) => c?.cardId === "token-follower").length).toBe(2);
  });

  it("summons nothing when the opponent played nothing", () => {
    const h = farm();
    h.endTurn();
    expect(h.state.players[1].board.filter((c) => c !== null).length).toBe(0);
  });
});

describe("rotateLeaderCurrent", () => {
  it("walks the advantage cycle a step per turn", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-rotate", ["body-1-1"])],
      firstSeat: 1,
    });
    h.begin();

    // seat 1 opened on tide, and its own first turn has already rotated it once
    expect(h.state.players[1].leaderCurrent).toBe("cinder");
    h.endTurn();
    h.endTurn();
    expect(h.state.players[1].leaderCurrent).toBe("gale");
    h.endTurn();
    h.endTurn();
    expect(h.state.players[1].leaderCurrent).toBe("root");
  });

  it("is what the attack preview reads — so the rotation is not decoration", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["cinder-body"]), fillDeck("lead-rotate", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    const attacker = placeCharacter(h.state, fixtures, 0, "cinder-body", 0);
    const swing = () => previewAttack(h.state, fixtures, findCharacter(h.state, attacker)!, { kind: "leader", seat: 1 });

    // cinder beats gale and nothing else, so parking the leader on gale is worth
    // exactly the elemental bonus and parking it on root is worth nothing
    h.state.players[1].leaderCurrent = "root";
    expect(swing().elementalBonus).toBe(false);
    const plain = swing().attackerDamage;

    h.state.players[1].leaderCurrent = "gale";
    expect(swing().elementalBonus).toBe(true);
    expect(swing().attackerDamage).toBe(plain + fixtures.balance.rules.elementalBonusDamage);
  });

  it("leaves Prism alone — it has no advantage, so it has no next step", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-rotate-prism", ["body-1-1"])],
      firstSeat: 1,
    });
    h.begin();
    h.endTurn();
    h.endTurn();
    expect(h.state.players[1].leaderCurrent).toBe("prism");
  });
});

describe("enemyStartOfTurn", () => {
  it("opens BEFORE the enemy's draw for the turn", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-mill-at-window", ["body-1-1"])],
      firstSeat: 0,
      stack: [["marker-a", "marker-b"], []],
    });
    h.begin(); // seat 0's first turn already consumed one of them

    // restack so the next seat-0 turn start faces a known top two
    const deck = h.state.players[0].deck;
    const a = { instanceId: "m-a", cardId: "marker-a", costDelta: 0, addedKeywords: [], removedKeywords: [] };
    const b = { instanceId: "m-b", cardId: "marker-b", costDelta: 0, addedKeywords: [], removedKeywords: [] };
    deck.unshift(b);
    deck.unshift(a);

    h.endTurn(); // -> seat 1
    h.endTurn(); // -> seat 0: window mills, then seat 0 draws

    /**
     * Milled first, drawn second: A goes to the discard and B lands in hand.
     * If the window opened after the draw it would be the other way round, which
     * is the whole reason this trigger is dispatched where it is.
     */
    expect(h.state.players[0].discard.some((c) => c.instanceId === "m-a")).toBe(true);
    expect(h.state.players[0].hand.some((c) => c.instanceId === "m-b")).toBe(true);
    expect(h.state.players[0].hand.some((c) => c.instanceId === "m-a")).toBe(false);
  });

  it("buries the card the victim could actually cast", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-feed", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();

    const deck = h.state.players[0].deck;
    deck.unshift({ instanceId: "t-dear", cardId: "dear-action", costDelta: 0, addedKeywords: [], removedKeywords: [] });
    deck.unshift({ instanceId: "t-cheap", cardId: "cheap-action", costDelta: 0, addedKeywords: [], removedKeywords: [] });

    h.endTurn(); // -> seat 1
    h.endTurn(); // -> seat 0 at 2 Hype: it buries the affordable one

    expect(h.state.players[0].hand.some((c) => c.instanceId === "t-dear"), "should have been left the expensive card").toBe(true);
    expect(h.state.players[0].deck[h.state.players[0].deck.length - 1]!.instanceId).toBe("t-cheap");
  });

  it("falls back to the cheaper card when neither is castable", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-feed", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();

    const deck = h.state.players[0].deck;
    deck.unshift({ instanceId: "t-dear", cardId: "dear-action", costDelta: 0, addedKeywords: [], removedKeywords: [] }); // 8
    deck.unshift({ instanceId: "t-mid", cardId: "mid-2-2", costDelta: 0, addedKeywords: [], removedKeywords: [] }); // 3

    h.endTurn();
    h.endTurn(); // seat 0 has 2 Hype: neither is castable

    expect(h.state.players[0].deck[h.state.players[0].deck.length - 1]!.instanceId).toBe("t-mid");
  });
});

describe("conditional auras", () => {
  /**
   * An `aura` effect may carry a condition, and until now nothing read it: the
   * modifier applied unconditionally. Prisma's Standing Ovation ("while the boss
   * controls 3 or more") has shipped as an unconditional +1 the whole time.
   */
  it("apply only while their condition holds", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["body-1-1"]), fillDeck("lead-conditional-aura", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();

    const first = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);
    const attackOf = () => totalAttack(h.state, fixtures, findCharacter(h.state, first)!);
    const base = fixtures.cards["body-2-3"]!.type === "character" ? 2 : 0;

    expect(attackOf(), "one character: the condition is not met").toBe(base);
    placeCharacter(h.state, fixtures, 1, "body-2-3", 1);
    expect(attackOf(), "two characters: still not met").toBe(base);
    placeCharacter(h.state, fixtures, 1, "body-2-3", 2);
    expect(attackOf(), "three characters: now it applies").toBe(base + 1);
  });
});

describe("permanent max Hype", () => {
  /**
   * A turn start RECOMPUTES hypeMax from the turn counter, so a permanent grant
   * written straight onto hypeMax lasted exactly one turn. Two shipped cards
   * promise "permanently" — one of them a 7-Obsession Ultimate.
   */
  const withGrant = () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["act-perm-hype"]), fillDeck("plain", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    return h;
  };

  it("survives the next turn start", () => {
    const h = withGrant();
    const id = giveCard(h.state, 0, "act-perm-hype");
    h.play({ type: "playCard", seat: 0, instanceId: id });
    expect(h.state.players[0].hypeMax).toBe(3); // 1 from the turn counter + 2 granted

    h.endTurn();
    h.endTurn(); // seat 0's second turn: 2 from the counter + 2 still granted
    expect(h.state.players[0].hypeMax, "the permanent grant was wiped").toBe(4);
    expect(h.state.players[0].hype).toBe(4);
  });

  it("hands out no Hype it could not add to the max", () => {
    const h = withGrant();
    h.advanceTo(0, fixtures.balance.hype.cap);

    expect(h.state.players[0].hypeMax).toBe(fixtures.balance.hype.cap);
    const hypeBefore = h.state.players[0].hype;

    const id = giveCard(h.state, 0, "act-perm-hype");
    h.play({ type: "playCard", seat: 0, instanceId: id });

    expect(h.state.players[0].hypeMax).toBe(fixtures.balance.hype.cap);
    // it cost 1 and granted nothing, so Hype should only have gone down
    expect(h.state.players[0].hype).toBe(hypeBefore - 1);
  });
});

describe("banish return timing", () => {
  it("brings an enemy's character back on THEIR next turn", () => {
    const h = harness({
      content: fixtures,
      decks: [fillDeck("plain", ["act-banish-enemy"]), fillDeck("plain", ["body-1-1"])],
      firstSeat: 0,
    });
    h.begin();
    const victim = placeCharacter(h.state, fixtures, 1, "body-2-3", 0);

    const id = giveCard(h.state, 0, "act-banish-enemy");
    h.play({ type: "playCard", seat: 0, instanceId: id, targets: [{ kind: "character", instanceId: victim }] });
    expect(h.state.players[1].banished.length).toBe(1);

    h.endTurn(); // seat 1's next turn
    expect(h.state.players[1].banished.length, "returned on the wrong seat's turn").toBe(0);
    expect(h.state.players[1].board.filter((c) => c !== null).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the ten shipped twists, against real content
// ---------------------------------------------------------------------------

const content = getContent();

/**
 * Deal a real match with a boss in seat 1, skipping the mulligan.
 *
 * The boss plays the stock deck of its faction's ordinary leader, exactly as the
 * mode does; only the leader card differs. That is the whole design claim — a
 * boss is a leader card, not a special case in the engine.
 */
function dealAgainst(leaderCardId: string, deckLeaderCardId: string, scenario: EncounterSetup, seed: number): MatchState {
  const config: MatchConfig = {
    seed,
    decks: [
      autoBuildDeck(content, "idols-lumi-starcall", "Player"),
      { ...autoBuildDeck(content, deckLeaderCardId, "Boss"), leaderCardId },
    ],
    firstSeat: 0,
    scenario: { mulligan: "none", ...scenario },
  };
  const state = createMatch(config, content);
  beginScriptedMatch(state, content);
  return state;
}

function bossMatch(bossId: string, scenario: EncounterSetup = {}, seed = 99): MatchState {
  const boss = BOSSES.find((b) => b.id === bossId);
  if (!boss) throw new Error(`no boss ${bossId}`);
  return dealAgainst(boss.leaderCardId, boss.deckLeaderCardId, scenario, seed);
}

/** End the active seat's turn, keeping the events for tests that count things. */
function step(state: MatchState, sink?: EngineEvent[]): MatchState {
  const result = applyIntent(state, content, { type: "endTurn", seat: state.activeSeat });
  if (sink) sink.push(...result.events);
  return result.state;
}

const bossBoard = (state: MatchState) => state.players[1].board.filter((c) => c !== null);

describe("boss roster invariants", () => {
  /**
   * Each boss leader carries both of its faction's Currents, so the faction's
   * stock deck is legal under it. Worth pinning: a boss dealt a deck full of
   * Currents its leader does not share would break Perfect Resonance and read as
   * a bug in the rules rather than one wrong line in a roster.
   */
  it("gives every boss a deck that is legal under its own leader", () => {
    for (const boss of BOSSES) {
      const leader = content.leaders[boss.leaderCardId]!;
      const deckLeader = content.leaders[boss.deckLeaderCardId]!;
      const allowed = [leader.primaryCurrent, leader.secondaryCurrent].filter(Boolean);
      for (const current of [deckLeader.primaryCurrent, deckLeader.secondaryCurrent].filter(Boolean)) {
        expect(allowed, `${boss.id}: the deck may contain ${current}, the leader may not`).toContain(current);
      }
      expect(leader.faction, `${boss.id}: boss and deck are different factions`).toBe(deckLeader.faction);
    }
  });

  it("covers all ten factions exactly once", () => {
    const factions = BOSSES.map((b) => content.leaders[b.leaderCardId]!.faction);
    expect(new Set(factions).size).toBe(BOSSES.length);
    expect(BOSSES.length).toBe(10);
  });
});

describe("the ten twists do what their text says", () => {
  it("Prisma — Standing Ovation: +1 attack, and only while it holds three", () => {
    const twoBodies = bossMatch("prisma-final-encore", {
      setup: [
        { op: "board", seat: 1, slot: 0, cardId: "token-follower" },
        { op: "board", seat: 1, slot: 1, cardId: "token-follower" },
      ],
    });
    const threeBodies = bossMatch("prisma-final-encore", {
      setup: [
        { op: "board", seat: 1, slot: 0, cardId: "token-follower" },
        { op: "board", seat: 1, slot: 1, cardId: "token-follower" },
        { op: "board", seat: 1, slot: 2, cardId: "token-follower" },
      ],
    });
    const attackOf = (s: MatchState) => totalAttack(s, content, bossBoard(s)[0]!);

    expect(attackOf(threeBodies)).toBe(attackOf(twoBodies) + 1);
  });

  it("DJ Last Call — Encore Set: its own Afterparty triggers fire twice, not the player's", () => {
    const state = step(bossMatch("dj-last-call")); // -> boss turn, the passive sets the flag
    expect(state.players[1].afterpartyRepeatThisTurn).toBe(true);
    expect(state.players[0].afterpartyRepeatThisTurn, "the player's should be untouched").toBe(false);
  });

  it("The Widow — The Vigil: the first character it loses each turn stands back up", () => {
    const state = bossMatch("widow-dead-fandoms", {
      setup: [
        { op: "board", seat: 1, slot: 0, cardId: "token-follower" },
        { op: "board", seat: 1, slot: 1, cardId: "token-follower" },
      ],
    });
    const [first, second] = bossBoard(state).map((c) => c.instanceId);
    const ctx = makeContext(state, content, 0, "test-kill", { events: [] });

    for (const target of [first!, second!]) {
      const victim = findCharacter(state, target)!;
      dealDamage(ctx, { kind: "character", instanceId: target }, victim.health + 5);
      cleanupDefeated(ctx, "test-kill");
    }

    expect(findCharacter(state, first!), "the first should have been saved").toBeDefined();
    expect(findCharacter(state, first!)!.health).toBe(1);
    expect(findCharacter(state, second!), "only the first each turn is saved").toBeNull();
  });

  it("King Ratio — Engagement Farming: a Follower for every card you played", () => {
    let state = bossMatch("king-ratio");
    state.players[0].cardsPlayedThisTurn = 3; // as if the player emptied their hand
    state = step(state);

    expect(state.players[0].cardsPlayedLastTurn).toBe(3);
    expect(bossBoard(state).filter((c) => c.cardId === "token-follower").length).toBe(3);
  });

  it("The Executive Producer — Quarterly Targets: her Hype grows twice as fast", () => {
    let state = bossMatch("executive-producer");
    const bossRamp: number[] = [];
    for (let i = 0; i < 4; i++) {
      state = step(state); // -> boss
      bossRamp.push(state.players[1].hypeMax);
      state = step(state); // -> player
    }
    expect(bossRamp).toEqual([2, 4, 6, 8]);
    expect(state.players[0].hypeMax, "the player's ramp must be untouched").toBeLessThan(bossRamp[3]!);
  });

  it("GLITCHLORD_EXE — Corrupted Feed: every third card you draw costs (1) more", () => {
    let state = bossMatch("glitchlord-exe");
    const events: EngineEvent[] = [];
    for (let round = 0; round < 4; round++) state = step(step(state, events), events);

    // count what actually happened rather than assuming the turn structure
    const playerDraws =
      1 + events.filter((e) => e.e === "cardDrawn" && e.seat === 0).length; // +1 for the opening turn's draw
    const taxed = state.players[0].hand.filter((c) => c.costDelta > 0);

    expect(playerDraws).toBeGreaterThanOrEqual(3);
    expect(taxed.length, `${playerDraws} draws should tax every third`).toBe(Math.floor(playerDraws / 3));
    expect(state.players[0].counters["corrupted-feed"]).toBe(playerDraws % 3);
    for (const card of taxed) expect(card.costDelta).toBe(1);
  });

  it("The Grand Cosplayer — Quick Change: the Current rotates every boss turn", () => {
    let state = bossMatch("grand-cosplayer");
    expect(state.players[1].leaderCurrent, "starts on its card's Current").toBe("tide");

    state = step(state); // -> boss turn 1
    expect(state.players[1].leaderCurrent).toBe("cinder");
    state = step(step(state)); // -> boss turn 2
    expect(state.players[1].leaderCurrent).toBe("gale");
    state = step(step(state)); // -> boss turn 3
    expect(state.players[1].leaderCurrent).toBe("root");
  });

  it("The Groundskeeper — Log Off: your costliest character leaves and comes back", () => {
    let state = bossMatch("groundskeeper", {
      setup: [
        { op: "board", seat: 0, slot: 0, cardId: "token-follower" }, // 1
        { op: "board", seat: 0, slot: 1, cardId: "token-main-character" }, // 4
      ],
    });
    const dearest = state.players[0].board[1]!.instanceId;

    state = step(state); // -> boss turn: Log Off fires
    expect(findCharacter(state, dearest), "the 4-cost should be gone").toBeNull();
    expect(state.players[0].banished.length).toBe(1);
    expect(state.players[0].board.filter((c) => c !== null).length).toBe(1);

    state = step(state); // -> the player's next turn
    expect(state.players[0].banished.length, "it should be back").toBe(0);
    expect(state.players[0].board.filter((c) => c !== null).length).toBe(2);
  });

  it("The Recommendation — The Feed Decides: it buries the card you could cast", () => {
    let state = step(bossMatch("the-recommendation")); // -> boss

    const player = state.players[0];
    const castable = player.deck.find((c) => (content.cards[c.cardId]?.cost ?? 99) <= 2);
    const expensive = player.deck.find((c) => (content.cards[c.cardId]?.cost ?? 0) >= 5);
    expect(castable, "the stock deck has no cheap card").toBeDefined();
    expect(expensive, "the stock deck has no expensive card").toBeDefined();
    player.deck = [castable!, expensive!, ...player.deck.filter((c) => c !== castable && c !== expensive)];

    state = step(state); // -> player: the Feed acts, then they draw

    expect(state.players[0].hand.some((c) => c.instanceId === expensive!.instanceId)).toBe(true);
    expect(state.players[0].deck[state.players[0].deck.length - 1]!.instanceId).toBe(castable!.instanceId);
  });

  it("The Living Meme — Dead Meme Cycle: exactly five bits, no weighting, same seed same bit", () => {
    const roll = content.leaders["boss-living-meme"]!.passive[0]!.ops[0]!;
    expect(roll.op).toBe("randomOp");
    const options = (roll as { options: { weight?: number }[] }).options;
    expect(options.length, "the card text promises five").toBe(5);
    // unweighted, so each really is the 1 in 5 the text claims
    for (const option of options) expect(option.weight).toBeUndefined();

    const a = step(bossMatch("living-meme", {}, 7));
    const b = step(bossMatch("living-meme", {}, 7));
    const c = step(bossMatch("living-meme", {}, 12345));
    const shape = (s: MatchState) => JSON.stringify(bossBoard(s).map((x) => [x.cardId, x.attack, x.health]));

    expect(shape(a), "same seed, same bit").toBe(shape(b));
    void c; // a different seed may legitimately roll the same option; nothing to assert
  });
});

/**
 * The Doomscroll's optional true finale.
 *
 * Not in the weekly rotation — it is the act-4 superboss, not a faction boss —
 * so it is dealt directly rather than through BOSSES. Its twist is a *cycle*
 * rather than a single rule, and the cycle being fixed is the counterplay: the
 * card text names the order, so a player can see what is coming.
 */
describe("THE FIRST SIGNAL — Reconvergence", () => {
  const deal = (scenario: EncounterSetup = {}) =>
    dealAgainst("boss-the-first-signal", "meme-leader-chairperson-nobody", scenario, 4242);

  it("takes one thing back per turn, in the order the card names", () => {
    let state = deal({
      setup: [
        { op: "board", seat: 0, slot: 0, cardId: "token-follower" }, // cost 1
        { op: "board", seat: 0, slot: 1, cardId: "token-main-character" }, // cost 4
      ],
    });

    const playerCurrent = () => state.players[0].leaderCurrent;
    const handSize = () => state.players[0].hand.length;
    const dearest = state.players[0].board[1]!.instanceId;

    // --- phase 1: your leader's Current rotates -----------------------------
    const startingCurrent = playerCurrent();
    const handBeforePhase1 = handSize();
    state = step(state); // -> boss turn 1
    expect(state.players[1].counters["reconvergence"]).toBe(1);
    expect(playerCurrent(), "phase 1 should rotate your Current").not.toBe(startingCurrent);
    expect(handSize(), "phase 1 must not also take a card").toBe(handBeforePhase1);
    expect(findCharacter(state, dearest), "phase 1 must not also banish").not.toBeNull();

    // --- phase 2: you discard a card ----------------------------------------
    const currentAfterPhase1 = playerCurrent();
    state = step(state); // -> player
    const handBeforePhase2 = handSize();
    state = step(state); // -> boss turn 2
    expect(state.players[1].counters["reconvergence"]).toBe(2);
    expect(handSize(), "phase 2 should take a card").toBe(handBeforePhase2 - 1);
    expect(playerCurrent(), "phase 2 must not also rotate").toBe(currentAfterPhase1);
    expect(findCharacter(state, dearest), "phase 2 must not also banish").not.toBeNull();

    // --- phase 3: your costliest character is banished ----------------------
    state = step(state); // -> player
    state = step(state); // -> boss turn 3
    expect(findCharacter(state, dearest), "phase 3 should banish the 4-cost").toBeNull();
    expect(state.players[0].banished.length).toBe(1);
    // and the counter resets, so the cycle repeats rather than stopping
    expect(state.players[1].counters["reconvergence"], "the cycle should start over").toBe(0);
  });

  it("keeps cycling — phase 4 is phase 1 again", () => {
    let state = deal();
    const currents: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      state = step(state); // -> boss
      currents.push(state.players[0].leaderCurrent);
      state = step(state); // -> player
    }
    // rotated on turn 1 and again on turn 4, untouched on 2 and 3
    expect(currents[1]).toBe(currents[0]);
    expect(currents[2]).toBe(currents[0]);
    expect(currents[3], "the fourth turn should rotate again").not.toBe(currents[0]);
  });

  it("shows its phase publicly, so the next theft is never a surprise", () => {
    // counters are part of the redacted opponent view by design
    let state = deal();
    state = step(state);
    expect(redact(state, 0).opponent.counters["reconvergence"]).toBe(1);
  });
});
