/**
 * Rules tests: keywords, statuses, Currents, Confluences, Obsession and the
 * turn sequence, each asserted against fixture cards so the suite is immune to
 * card-balance changes.
 */

import { describe, expect, it } from "vitest";
import {
  fillDeck,
  fixtureContent,
  giveCard,
  harness,
  placeCharacter,
  testAction,
  testCharacter,
  testLeader,
} from "./fixtures";
import type { CardDef, CurrentId } from "../src/engine/types";
import { hasStatus, statusAmount } from "../src/engine/statuses";
import { availableConfluences } from "../src/engine/currents";
import { previewAttack } from "../src/engine/combat";
import { boardOf, findCharacter, redact } from "../src/engine/state";
import { effectiveCost } from "../src/engine/intents";
import { cleanupDefeated, makeContext, resolveTargets, runOps } from "../src/engine/effects";

/** Standard fixture set used by most tests. */
const CARDS: CardDef[] = [
  testLeader("lead-prism"),
  testLeader("lead-cinder", { current: "cinder", primaryCurrent: "cinder", secondaryCurrent: "tide" }),
  testLeader("lead-halo", { current: "halo", primaryCurrent: "halo", secondaryCurrent: "veil" }),
  /**
   * A leader whose passives claim "the first ... each turn" and "the first time
   * this match". Three shipped leaders make exactly that claim, and a leader has
   * no instance to hang the bookkeeping off, so it has to live on the player.
   */
  testLeader("lead-gated", {
    passive: [
      {
        trigger: "onCardPlayed",
        oncePerTurn: true,
        text: "first card each turn",
        ops: [{ op: "addCounter", key: "leaderPerTurn", amount: 1 }],
      },
      {
        trigger: "onCardPlayed",
        once: true,
        text: "first card this match",
        ops: [{ op: "addCounter", key: "leaderOnce", amount: 1 }],
      },
      {
        trigger: "onCardPlayed",
        text: "every card",
        ops: [{ op: "addCounter", key: "leaderAlways", amount: 1 }],
      },
    ],
  }),

  testCharacter("v-1-1", 1, 1, 1),
  /** Carries a tag, so a filtered selection can be told from an unfiltered one. */
  testCharacter("tagged-idol", 1, 1, 1, { tags: ["idol"] }),
  testCharacter("v-2-2", 2, 2, 2),
  testCharacter("v-3-3", 3, 3, 3),
  testCharacter("v-big", 5, 5, 6),

  testCharacter("cinder-2-2", 2, 2, 2, { current: "cinder" }),
  testCharacter("gale-2-2", 2, 2, 2, { current: "gale" }),
  testCharacter("halo-2-2", 2, 2, 2, { current: "halo" }),
  testCharacter("veil-2-2", 2, 2, 2, { current: "veil" }),

  testCharacter("kw-spotlight", 2, 1, 4, { keywords: ["spotlight"] }),
  testCharacter("kw-raid", 2, 3, 1, { keywords: ["raid"] }),
  testCharacter("kw-viral", 2, 2, 2, { keywords: ["viral"] }),
  testCharacter("kw-parasocial", 2, 1, 3, { keywords: ["parasocial"] }),
  testCharacter("kw-comeback", 3, 2, 2, {
    keywords: ["comeback"],
    comeback: { mode: "hand", delayTurns: 1 },
  }),
  testCharacter("kw-grow", 2, 1, 3, {
    keywords: ["grow"],
    grow: { turns: 2, ops: [{ op: "buff", target: { select: "self" }, attack: 2, health: 2 }] },
  }),
  testCharacter("kw-inspire", 3, 2, 3, {
    keywords: ["inspire"],
    text: "**Inspire:** this gains +1/+0.",
    effects: [{ trigger: "inspire", ops: [{ op: "buff", target: { select: "self" }, attack: 1 }] }],
  }),
  testCharacter("tick-afterparty", 1, 1, 9, {
    text: "**Afterparty:** add a counter.",
    effects: [{ trigger: "afterparty", ops: [{ op: "addCounter", key: "apTick", amount: 1 }] }],
  }),
  testCharacter("tick-startofturn", 1, 1, 9, {
    text: "At the start of your turn, add a counter.",
    effects: [{ trigger: "startOfTurn", ops: [{ op: "addCounter", key: "sotTick", amount: 1 }] }],
  }),
  testCharacter("kw-once", 2, 1, 5, {
    text: "The first time you play another card each turn, add a counter.",
    effects: [
      {
        trigger: "onCardPlayed",
        oncePerTurn: true,
        ops: [{ op: "addCounter", key: "onceTest", amount: 1 }],
      },
    ],
  }),

  testAction("act-trending", 4, { keywords: ["trending"] }),
  testAction("act-overload", 2, {
    keywords: ["overload"],
    overload: 2,
    effects: [{ trigger: "onPlay", ops: [{ op: "damage", target: { select: "leader", side: "enemy" }, amount: 4 }] }],
  }),
  // Flow's four canonical clauses (canon §6) each need a way to be caused
  testCharacter("kw-flow", 2, 1, 6, {
    keywords: ["flow"],
    text: "**Flow:** add a counter.",
    effects: [{ trigger: "flow", ops: [{ op: "addCounter", key: "flowTick", amount: 1 }] }],
  }),
  testAction("act-return", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "returnToHand", target: { select: "triggering" } }],
      },
    ],
  }),
  testAction("act-heal", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "heal", target: { select: "triggering" }, amount: 2 }],
      },
    ],
  }),
  testAction("act-buff", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "buff", target: { select: "triggering" }, attack: 1, health: 1 }],
      },
    ],
  }),
  testAction("act-heal-leader", 1, {
    effects: [{ trigger: "onPlay", ops: [{ op: "heal", target: { select: "leader", side: "friendly" }, amount: 3 }] }],
  }),
  testAction("act-swap", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "swapAttackHealth", target: { select: "triggering" } }],
      },
    ],
  }),
  testAction("act-bounce-enemy", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "returnToHand", target: { select: "triggering" } }],
      },
    ],
  }),

  testAction("act-shield", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "applyStatus", target: { select: "triggering" }, status: "shielded" }],
      },
    ],
  }),
  testAction("act-scorch", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "applyStatus", target: { select: "triggering" }, status: "scorched" }],
      },
    ],
  }),
  testAction("act-armor", 1, {
    effects: [{ trigger: "onPlay", ops: [{ op: "applyStatus", target: { select: "leader", side: "friendly" }, status: "armor", amount: 3 }] }],
  }),
  testAction("act-cinder-ping", 1, {
    current: "cinder",
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "damage", target: { select: "triggering" }, amount: 1 }],
      },
    ],
  }),
  testAction("act-tide-ping", 1, {
    current: "tide",
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "enemy", zone: "board" },
        ops: [{ op: "damage", target: { select: "triggering" }, amount: 1 }],
      },
    ],
  }),
  testAction("act-adjacent", 1, {
    effects: [
      {
        trigger: "onPlay",
        target: { select: "choose", side: "friendly", zone: "board" },
        ops: [{ op: "damage", target: { select: "adjacent" }, amount: 1 }],
      },
    ],
    text: "Deal 1 damage to the characters beside the chosen one.",
  }),
  testCharacter("adj-source", 1, 1, 9, {
    effects: [
      {
        trigger: "onPlay",
        ops: [{ op: "buff", target: { select: "adjacent" }, attack: 1 }],
      },
    ],
    text: "On play: give adjacent characters +1/+0.",
  }),

  testAction("act-finale", 3, {
    effects: [
      {
        trigger: "onPlay",
        ops: [
          { op: "addCounter", key: "finale", amount: 3 },
          { op: "if", condition: { kind: "counterAtLeast", key: "finale", value: 3 }, then: [{ op: "winMatch" }] },
        ],
      },
    ],
    finale: true,
  }),
];

const content = fixtureContent(CARDS);

function makeHarness(options: { leaders?: [string, string]; cards?: [string[], string[]]; firstSeat?: 0 | 1 } = {}) {
  const [leaderA, leaderB] = options.leaders ?? ["lead-prism", "lead-prism"];
  const [cardsA, cardsB] = options.cards ?? [["v-1-1"], ["v-1-1"]];
  return harness({
    content,
    decks: [fillDeck(leaderA, cardsA, "A"), fillDeck(leaderB, cardsB, "B")],
    firstSeat: options.firstSeat ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Elemental advantage
// ---------------------------------------------------------------------------

describe("elemental advantage", () => {
  const cases: [CurrentId, CurrentId, boolean][] = [
    ["cinder", "gale", true],
    ["gale", "root", true],
    ["root", "pulse", true],
    ["pulse", "tide", true],
    ["tide", "cinder", true],
    ["halo", "veil", true],
    ["veil", "halo", true],
    ["gale", "cinder", false],
    ["prism", "cinder", false],
    ["cinder", "prism", false],
    ["cinder", "cinder", false],
  ];

  for (const [attacker, defender, expected] of cases) {
    it(`${attacker} vs ${defender} → ${expected ? "+1" : "no bonus"}`, () => {
      const beats = content.currents[attacker].beats.includes(defender);
      expect(beats).toBe(expected);
    });
  }

  it("adds exactly 1 damage on an advantaged attack, never more", () => {
    const h = makeHarness();
    h.begin();
    const attacker = placeCharacter(h.state, content, 0, "cinder-2-2", 0);
    const defender = placeCharacter(h.state, content, 1, "gale-2-2", 0);

    const attackerUnit = findCharacter(h.state, attacker)!;
    const preview = previewAttack(h.state, content, attackerUnit, { kind: "character", instanceId: defender });
    expect(preview.elementalBonus).toBe(true);
    expect(preview.attackerDamage).toBe(3); // 2 attack + 1 elemental

    h.play({ type: "attack", seat: 0, attackerInstanceId: attacker, target: { kind: "character", instanceId: defender } });
    // 2/2 gale took 3 → dead; cinder took 2 counter (no bonus back) → dead too
    expect(findCharacter(h.state, defender)).toBeNull();
  });

  it("makes Halo and Veil mutually dangerous", () => {
    const h = makeHarness();
    h.begin();
    const halo = placeCharacter(h.state, content, 0, "halo-2-2", 0);
    const veil = placeCharacter(h.state, content, 1, "veil-2-2", 0);

    const preview = previewAttack(h.state, content, findCharacter(h.state, halo)!, {
      kind: "character",
      instanceId: veil,
    });
    expect(preview.elementalBonus).toBe(true);
    expect(preview.attackerDamage).toBe(3);
    expect(preview.defenderDamage).toBe(3); // veil hits back with its own bonus
    expect(preview.attackerDies).toBe(true);
    expect(preview.defenderDies).toBe(true);
  });

  it("gives no advantage to or from Prism by default", () => {
    const h = makeHarness();
    h.begin();
    const prism = placeCharacter(h.state, content, 0, "v-2-2", 0);
    const cinder = placeCharacter(h.state, content, 1, "cinder-2-2", 0);
    const preview = previewAttack(h.state, content, findCharacter(h.state, prism)!, {
      kind: "character",
      instanceId: cinder,
    });
    expect(preview.elementalBonus).toBe(false);
    expect(preview.attackerDamage).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

describe("statuses", () => {
  it("Shielded negates one whole instance of damage, then falls off", () => {
    const h = makeHarness({ cards: [["act-shield", "v-2-2"], ["v-1-1"]] });
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "v-3-3", 0);
    const shield = giveCard(h.state, 0, "act-shield");
    h.play({ type: "playCard", seat: 0, instanceId: shield, targets: [{ kind: "character", instanceId: unit }] });
    expect(hasStatus(findCharacter(h.state, unit)!, "shielded")).toBe(true);

    const attacker = placeCharacter(h.state, content, 1, "v-big", 0);
    h.endTurn(); // hand the turn to seat 1
    h.play({ type: "attack", seat: 1, attackerInstanceId: attacker, target: { kind: "character", instanceId: unit } });

    const survivor = findCharacter(h.state, unit);
    expect(survivor, "shielded character survives a 5-damage hit").not.toBeNull();
    expect(survivor!.health).toBe(3);
    expect(hasStatus(survivor!, "shielded")).toBe(false);
  });

  /**
   * The difference a card that reads "Defeat a friendly character" depends on.
   *
   * Widow's Bargain shipped spelling "defeat" as 99 damage — the only use of
   * that idiom in the pool — and a Shielded character therefore survived its own
   * sacrifice while the card still paid out. `destroy` is not damage and no
   * shield stops it, which is why the card now uses it. Asserted both ways here,
   * because a test that only proved `destroy` kills would pass just as happily
   * against the broken version.
   */
  it("Shielded stops enormous damage, and does not stop destroy", () => {
    const h = makeHarness({ cards: [["act-shield", "v-2-2"], ["v-1-1"]] });
    h.begin();

    const shielded = placeCharacter(h.state, content, 0, "v-3-3", 0);
    const shield = giveCard(h.state, 0, "act-shield");
    h.play({ type: "playCard", seat: 0, instanceId: shield, targets: [{ kind: "character", instanceId: shielded } ] });

    const ctx = makeContext(h.state, content, 0, "test");
    runOps(ctx, [{ op: "damage", target: { select: "all", side: "friendly", zone: "board" }, amount: 99 }]);
    expect(findCharacter(h.state, shielded), "a shield eats a 99-damage 'defeat'").not.toBeNull();

    runOps(ctx, [{ op: "destroy", target: { select: "all", side: "friendly", zone: "board" } }]);
    cleanupDefeated(ctx, null);
    expect(findCharacter(h.state, shielded), "destroy is not damage, so no shield stops it").toBeNull();
  });

  /**
   * `resurrect` reads the filter on its target, which for its whole life it did
   * not: it hardcoded "any character in the discard" and ignored the spec it was
   * handed. Every shipped use filters on `type: character`, which is what the op
   * already did, so the two agreed by luck — and a card written to return "a
   * random Idol" would quietly have returned anything. Same shape as the inert
   * `permanent` flag on `buff`, and the reason both are now gone or real.
   */
  it("resurrect honours the filter on its target", () => {
    const h = makeHarness({ cards: [["v-1-1"], ["v-1-1"]] });
    h.begin();
    const player = h.state.players[0];
    player.discard = [
      { instanceId: "d1", cardId: "v-1-1", costDelta: 0, addedKeywords: [], removedKeywords: [] },
      { instanceId: "d2", cardId: "tagged-idol", costDelta: 0, addedKeywords: [], removedKeywords: [] },
    ];

    const ctx = makeContext(h.state, content, 0, "test");
    runOps(ctx, [
      { op: "resurrect", target: { select: "all", side: "friendly", zone: "discard", filter: { tag: ["idol"] } }, count: 2 },
    ]);

    const returned = boardOf(h.state, 0).map((c) => c.cardId);
    expect(returned, "only the Idol matches the filter").toEqual(["tagged-idol"]);
    expect(player.discard.map((c) => c.cardId), "the unmatched card stays in the discard").toEqual(["v-1-1"]);
  });

  it("Armor absorbs damage point-for-point on the leader", () => {
    const h = makeHarness({ cards: [["act-armor"], ["v-1-1"]] });
    h.begin();
    const armor = giveCard(h.state, 0, "act-armor");
    h.play({ type: "playCard", seat: 0, instanceId: armor });
    expect(h.state.players[0].armor).toBe(3);

    const attacker = placeCharacter(h.state, content, 1, "v-big", 0);
    h.endTurn();
    h.play({ type: "attack", seat: 1, attackerInstanceId: attacker, target: { kind: "leader", seat: 0 } });

    // 5 damage: 3 absorbed by armor, 2 to health
    expect(h.state.players[0].armor).toBe(0);
    expect(h.state.players[0].leaderHealth).toBe(28);
  });

  it("Scorched burns for 1 at end of its controller's turn, then expires", () => {
    const h = makeHarness({ cards: [["act-scorch"], ["v-1-1"]] });
    h.begin();
    const victim = placeCharacter(h.state, content, 1, "v-3-3", 0);
    const scorch = giveCard(h.state, 0, "act-scorch");
    h.play({ type: "playCard", seat: 0, instanceId: scorch, targets: [{ kind: "character", instanceId: victim }] });
    expect(hasStatus(findCharacter(h.state, victim)!, "scorched")).toBe(true);

    h.endTurn(); // seat 0 ends; scorched is on a seat-1 character so it does not burn yet
    expect(findCharacter(h.state, victim)!.health).toBe(3);

    h.endTurn(); // seat 1 ends → burn
    const after = findCharacter(h.state, victim)!;
    expect(after.health).toBe(2);
    expect(hasStatus(after, "scorched"), "Scorched falls off after triggering").toBe(false);
  });

  it("Weakened reduces attack and never below zero", () => {
    const h = makeHarness();
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "v-2-2", 0);
    const character = findCharacter(h.state, unit)!;
    character.statuses.push({ id: "weakened", amount: 5, remainingTurns: null, sourceCardId: "test" });
    const preview = previewAttack(h.state, content, character, { kind: "leader", seat: 1 });
    expect(preview.attackerDamage).toBe(0);
    expect(statusAmount(character, "weakened")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

describe("keywords", () => {
  it("Spotlight forces attacks onto it", () => {
    const h = makeHarness();
    h.begin();
    const attacker = placeCharacter(h.state, content, 0, "v-3-3", 0);
    const spotlight = placeCharacter(h.state, content, 1, "kw-spotlight", 0);
    placeCharacter(h.state, content, 1, "v-2-2", 1);

    // attacking the leader past a Spotlight is illegal
    expect(() =>
      h.play({ type: "attack", seat: 0, attackerInstanceId: attacker, target: { kind: "leader", seat: 1 } })
    ).toThrow();

    // attacking the Spotlight character is fine
    h.play({ type: "attack", seat: 0, attackerInstanceId: attacker, target: { kind: "character", instanceId: spotlight } });
    expect(findCharacter(h.state, spotlight)!.health).toBe(1);
  });

  it("Raid lets a character attack the turn it is played", () => {
    const h = makeHarness({ cards: [["kw-raid"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 2);
    const card = giveCard(h.state, 0, "kw-raid");
    h.play({ type: "playCard", seat: 0, instanceId: card, slot: 0 });

    const unit = boardOf(h.state, 0)[0]!;
    const before = h.state.players[1].leaderHealth;
    h.play({ type: "attack", seat: 0, attackerInstanceId: unit.instanceId, target: { kind: "leader", seat: 1 } });
    expect(h.state.players[1].leaderHealth).toBe(before - 3);
  });

  it("summoning sickness stops a character without Raid", () => {
    const h = makeHarness({ cards: [["v-2-2"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 2);
    const card = giveCard(h.state, 0, "v-2-2");
    h.play({ type: "playCard", seat: 0, instanceId: card, slot: 0 });
    const unit = boardOf(h.state, 0)[0]!;
    expect(() =>
      h.play({ type: "attack", seat: 0, attackerInstanceId: unit.instanceId, target: { kind: "leader", seat: 1 } })
    ).toThrow();
  });

  it("Viral adds a discounted copy to hand", () => {
    const h = makeHarness({ cards: [["kw-viral"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 2);
    const card = giveCard(h.state, 0, "kw-viral");
    const handBefore = h.state.players[0].hand.length;
    h.play({ type: "playCard", seat: 0, instanceId: card, slot: 0 });

    const copies = h.state.players[0].hand.filter((c) => c.cardId === "kw-viral");
    expect(copies.length).toBeGreaterThan(0);
    const copy = copies.find((c) => c.viralCopy);
    expect(copy, "the copy is marked so it cannot chain forever").toBeDefined();
    expect(copy!.costDelta).toBe(-1);
    expect(h.state.players[0].hand.length).toBe(handBefore); // played one, gained one
  });

  it("Trending gets cheaper with each card played this turn, never below 1", () => {
    const h = makeHarness({ cards: [["v-1-1", "act-trending"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 7);

    const trendingId = giveCard(h.state, 0, "act-trending");
    const instance = () => h.state.players[0].hand.find((c) => c.instanceId === trendingId)!;

    expect(effectiveCost(h.state, content, 0, instance())).toBe(4);

    for (let i = 0; i < 2; i++) {
      h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "v-1-1"), slot: i });
    }
    expect(effectiveCost(h.state, content, 0, instance())).toBe(2); // 4 - 2 played

    for (let i = 2; i < 5; i++) {
      h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "v-1-1"), slot: i });
    }
    expect(effectiveCost(h.state, content, 0, instance()), "Trending floors at 1").toBe(1);
  });

  it("Overload locks Hype on the following turn", () => {
    const h = makeHarness({ cards: [["act-overload"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 4);
    const card = giveCard(h.state, 0, "act-overload");
    h.play({ type: "playCard", seat: 0, instanceId: card });
    expect(h.state.players[0].hypeLockedNextTurn).toBe(2);

    const maxBefore = h.state.players[0].hypeMax;
    h.endTurn(); // seat 1
    h.endTurn(); // back to seat 0
    expect(h.state.players[0].hypeMax).toBe(maxBefore + 1);
    expect(h.state.players[0].hype).toBe(maxBefore + 1 - 2);
    expect(h.state.players[0].hypeLockedNextTurn, "the debt is paid once").toBe(0);
  });

  it("Comeback returns the character to hand on a later turn", () => {
    const h = makeHarness();
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "kw-comeback", 0);
    const killer = placeCharacter(h.state, content, 1, "v-big", 0);

    h.endTurn();
    h.play({ type: "attack", seat: 1, attackerInstanceId: killer, target: { kind: "character", instanceId: unit } });
    expect(findCharacter(h.state, unit)).toBeNull();
    expect(h.state.comebacks.length).toBe(1);

    h.endTurn(); // seat 1 ends → seat 0's turn starts, comeback resolves
    expect(h.state.players[0].hand.some((c) => c.cardId === "kw-comeback")).toBe(true);
  });

  it("Grow upgrades after surviving the stated number of turns", () => {
    const h = makeHarness();
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "kw-grow", 0);
    expect(findCharacter(h.state, unit)!.attack).toBe(1);

    h.endTurn(); // seat 0 end → grow tick 1
    h.endTurn(); // seat 1
    h.endTurn(); // seat 0 end → grow tick 2 → complete

    const grown = findCharacter(h.state, unit)!;
    expect(grown.growComplete).toBe(true);
    expect(grown.attack).toBe(3);
    expect(grown.maxHealth).toBe(5);
  });

  it("Inspire fires when a friendly character is buffed", () => {
    const h = makeHarness({ cards: [["act-shield"], ["v-1-1"]] });
    h.begin();
    const inspired = placeCharacter(h.state, content, 0, "kw-inspire", 0);
    const other = placeCharacter(h.state, content, 0, "v-2-2", 1);

    const shield = giveCard(h.state, 0, "act-shield");
    h.play({ type: "playCard", seat: 0, instanceId: shield, targets: [{ kind: "character", instanceId: other }] });

    // shielding another friendly character is a "support" → Inspire triggers
    expect(findCharacter(h.state, inspired)!.attack).toBe(3);
  });

  /**
   * Flow, clause by clause.
   *
   * Canon §6 defines Flow as "returned to your hand, replayed, healed, or
   * exchanged" and the engine fired on the first of those only, so every Flow
   * card in the game promised three triggers it did not have — including the
   * whole of Cassia Cache's recursion kit, which is the Algorithm Syndicate's
   * only archetype. Nothing caught it because Flow had no test at all: the
   * keyword was implemented, so it looked done.
   *
   * "Exchanged" is not tested because there is no exchange mechanic in the
   * game — no op, no event, nothing in the DSL. The word described nothing and
   * has been removed from the keyword's reminder text and from canon.
   */
  describe("Flow", () => {
    const flowCount = (h: ReturnType<typeof makeHarness>, seat: 0 | 1 = 0): number =>
      h.state.players[seat].counters["flowTick"] ?? 0;

    it("fires when a friendly character is returned to hand", () => {
      const h = makeHarness({ cards: [["act-return"], ["v-1-1"]] });
      h.begin();
      placeCharacter(h.state, content, 0, "kw-flow", 0);
      const body = placeCharacter(h.state, content, 0, "v-2-2", 1);

      const card = giveCard(h.state, 0, "act-return");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: body }] });
      expect(flowCount(h)).toBe(1);
    });

    it("fires when a friendly character is healed", () => {
      const h = makeHarness({ cards: [["act-heal"], ["v-1-1"]] });
      h.begin();
      const watcher = placeCharacter(h.state, content, 0, "kw-flow", 0);
      // damage it first, or the heal is a no-op and nothing should fire
      findCharacter(h.state, watcher)!.health = 3;

      const card = giveCard(h.state, 0, "act-heal");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: watcher }] });
      expect(flowCount(h)).toBe(1);
    });

    it("does not fire when the heal restores nothing", () => {
      const h = makeHarness({ cards: [["act-heal"], ["v-1-1"]] });
      h.begin();
      const watcher = placeCharacter(h.state, content, 0, "kw-flow", 0);

      const card = giveCard(h.state, 0, "act-heal");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: watcher }] });
      expect(flowCount(h), "healing a character at full health heals 0").toBe(0);
    });

    it("fires again when a returned character is replayed", () => {
      const h = makeHarness({ cards: [["act-return"], ["v-1-1"]] });
      h.begin();
      h.advanceTo(0, 4);
      placeCharacter(h.state, content, 0, "kw-flow", 0);
      const body = placeCharacter(h.state, content, 0, "v-2-2", 1);

      const card = giveCard(h.state, 0, "act-return");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: body }] });
      expect(flowCount(h), "the return itself").toBe(1);

      // it is now in hand carrying "I have been in play"; casting it is a replay
      const returned = h.state.players[0].hand.find((c) => c.cardId === "v-2-2")!;
      expect(returned.returnedFromPlay).toBe(true);
      h.play({ type: "playCard", seat: 0, instanceId: returned.instanceId, targets: [] });
      expect(flowCount(h), "and the replay").toBe(2);
    });

    it("does not fire for a card played from hand for the first time", () => {
      const h = makeHarness({ cards: [["v-2-2"], ["v-1-1"]] });
      h.begin();
      h.advanceTo(0, 3);
      placeCharacter(h.state, content, 0, "kw-flow", 0);

      const fresh = giveCard(h.state, 0, "v-2-2");
      h.play({ type: "playCard", seat: 0, instanceId: fresh, targets: [] });
      expect(flowCount(h)).toBe(0);
    });

    it("fires when your leader is healed, not only a character", () => {
      const h = makeHarness({ cards: [["act-heal-leader"], ["v-1-1"]] });
      h.begin();
      placeCharacter(h.state, content, 0, "kw-flow", 0);
      h.state.players[0].leaderHealth = 20;

      const card = giveCard(h.state, 0, "act-heal-leader");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [] });
      expect(flowCount(h)).toBe(1);
    });

    it("fires on an exchange — swapping a character's stats", () => {
      const h = makeHarness({ cards: [["act-swap"], ["v-1-1"]] });
      h.begin();
      placeCharacter(h.state, content, 0, "kw-flow", 0);
      const body = placeCharacter(h.state, content, 0, "v-2-2", 1);

      const card = giveCard(h.state, 0, "act-swap");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: body }] });
      expect(flowCount(h)).toBe(1);
    });

    /**
     * Glossary ruling 3: the channel is relative to the controller of the card
     * that MOVED, not to whoever caused it. "Bouncing a Tide board is a real
     * cost" — so the victim's Flow pays out, and the bouncer's does not.
     */
    it("pays the owner of a bounced character, not the player who bounced it", () => {
      const h = makeHarness({ cards: [["v-1-1"], ["act-bounce-enemy"]] });
      h.begin();
      placeCharacter(h.state, content, 0, "kw-flow", 0); // seat 0 is watching
      placeCharacter(h.state, content, 1, "kw-flow", 0); // and so is seat 1
      const victim = placeCharacter(h.state, content, 0, "v-2-2", 1);

      h.endTurn(); // hand the turn to seat 1, who does the bouncing
      const card = giveCard(h.state, 1, "act-bounce-enemy");
      h.play({ type: "playCard", seat: 1, instanceId: card, targets: [{ kind: "character", instanceId: victim }] });

      expect(flowCount(h, 0), "the bounced card was seat 0's").toBe(1);
      expect(flowCount(h, 1), "seat 1 moved someone else's card").toBe(0);
    });

    it("does not fire on a buff or a shield — those are Inspire's clauses", () => {
      const h = makeHarness({ cards: [["act-buff", "act-shield"], ["v-1-1"]] });
      h.begin();
      h.advanceTo(0, 4);
      const watcher = placeCharacter(h.state, content, 0, "kw-flow", 0);

      const buff = giveCard(h.state, 0, "act-buff");
      h.play({ type: "playCard", seat: 0, instanceId: buff, targets: [{ kind: "character", instanceId: watcher }] });
      const shield = giveCard(h.state, 0, "act-shield");
      h.play({ type: "playCard", seat: 0, instanceId: shield, targets: [{ kind: "character", instanceId: watcher }] });

      expect(flowCount(h)).toBe(0);
    });

    it("fires only for the player whose card it was", () => {
      const h = makeHarness({ cards: [["act-return"], ["v-1-1"]] });
      h.begin();
      placeCharacter(h.state, content, 1, "kw-flow", 0); // the OPPONENT is watching
      const body = placeCharacter(h.state, content, 0, "v-2-2", 1);

      const card = giveCard(h.state, 0, "act-return");
      h.play({ type: "playCard", seat: 0, instanceId: card, targets: [{ kind: "character", instanceId: body }] });
      expect(flowCount(h, 1), "seat 0 returning its own card is not seat 1's Flow").toBe(0);
    });
  });

  it("Parasocial buffs the character and grants Obsession when targeted", () => {
    const h = makeHarness({ cards: [["act-shield"], ["v-1-1"]] });
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "kw-parasocial", 0);
    const shield = giveCard(h.state, 0, "act-shield");
    h.play({ type: "playCard", seat: 0, instanceId: shield, targets: [{ kind: "character", instanceId: unit }] });

    const character = findCharacter(h.state, unit)!;
    expect(character.attack).toBe(2); // 1 base +1 from Parasocial
    expect(character.maxHealth).toBe(4);
    // 1 from the once-per-turn support gain + 1 from Parasocial
    expect(h.state.players[0].obsession).toBe(2);
  });

  it("oncePerTurn fires at most once per controller turn", () => {
    const h = makeHarness({ cards: [["v-1-1"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 5);
    placeCharacter(h.state, content, 0, "kw-once", 5);

    for (let i = 0; i < 3; i++) {
      const filler = giveCard(h.state, 0, "v-1-1");
      h.play({ type: "playCard", seat: 0, instanceId: filler, slot: i });
    }
    expect(h.state.players[0].counters["onceTest"]).toBe(1);

    h.endTurn();
    h.endTurn(); // back to seat 0, the flag resets
    const filler = giveCard(h.state, 0, "v-1-1");
    h.play({ type: "playCard", seat: 0, instanceId: filler, slot: 4 });
    expect(h.state.players[0].counters["onceTest"]).toBe(2);
  });

  it("gates a LEADER passive by once and oncePerTurn too", () => {
    /**
     * A leader has no instance to keep `firedOnce` on, so this was silently
     * ungated: three shipped leaders say "the first character you play each
     * turn" and fired on every one. Chairperson Nobody copied every Repost card
     * rather than the first.
     */
    const h = makeHarness({ leaders: ["lead-gated", "lead-prism"], cards: [["v-1-1"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 5);

    for (let i = 0; i < 3; i++) {
      const filler = giveCard(h.state, 0, "v-1-1");
      h.play({ type: "playCard", seat: 0, instanceId: filler, slot: i });
    }
    const counters = () => h.state.players[0].counters;
    expect(counters()["leaderPerTurn"]).toBe(1);
    expect(counters()["leaderOnce"]).toBe(1);
    // the ungated passive on the same card still fires every time, so the
    // gating is per effect rather than per leader
    expect(counters()["leaderAlways"]).toBe(3);

    h.endTurn();
    h.endTurn(); // back to seat 0
    const filler = giveCard(h.state, 0, "v-1-1");
    h.play({ type: "playCard", seat: 0, instanceId: filler, slot: 3 });
    expect(counters()["leaderPerTurn"], "oncePerTurn should reset between turns").toBe(2);
    expect(counters()["leaderOnce"], "once is once per match").toBe(1);
    expect(counters()["leaderAlways"]).toBe(4);
  });

  it("fires Afterparty and startOfTurn once per round, on their controller's turn only", () => {
    /**
     * Both are documented as "controller's turn" and every card says "your
     * turn" — the Afterparty keyword's own reminder text is "triggers at the end
     * of your turn". They fired on BOTH players' turns, so an entire faction's
     * mechanic resolved at double rate and Juniper Vale's "deal 2 damage at the
     * start of your turn" dealt 4 a round. No test caught it, so here is one.
     */
    const h = makeHarness({ cards: [["v-1-1"], ["v-1-1"]] });
    h.begin();
    placeCharacter(h.state, content, 0, "tick-afterparty", 0);
    placeCharacter(h.state, content, 0, "tick-startofturn", 1);
    const counters = () => h.state.players[0].counters;

    h.endTurn(); // seat 0 ends: its own Afterparty fires
    expect(counters()["apTick"]).toBe(1);
    h.endTurn(); // seat 1 ends: seat 0's cards must stay quiet, then seat 0 starts
    expect(counters()["apTick"], "the enemy ending their turn is not your Afterparty").toBe(1);
    expect(counters()["sotTick"]).toBe(1);

    h.endTurn();
    h.endTurn();
    expect(counters()["apTick"]).toBe(2);
    expect(counters()["sotTick"]).toBe(2);
  });

  it("fires onCardPlayed only for the player who played the card", () => {
    /**
     * types.ts calls this trigger "controller plays another card" and every card
     * using it says "you play", but it fired for both seats: Ashvyre's Overclock
     * granted Raid and Scorched to the ENEMY's character, and Chairperson Nobody
     * copied whatever the opponent played into her own hand.
     */
    const h = makeHarness({ leaders: ["lead-gated", "lead-gated"], cards: [["v-1-1"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 5);
    const a = giveCard(h.state, 0, "v-1-1");
    h.play({ type: "playCard", seat: 0, instanceId: a, slot: 0 });
    expect(h.state.players[0].counters["leaderAlways"]).toBe(1);
    expect(h.state.players[1].counters["leaderAlways"], "the enemy leader must not react to your play").toBeUndefined();

    h.endTurn();
    const b = giveCard(h.state, 1, "v-1-1");
    h.play({ type: "playCard", seat: 1, instanceId: b, slot: 0 });
    expect(h.state.players[0].counters["leaderAlways"]).toBe(1);
    expect(h.state.players[1].counters["leaderAlways"]).toBe(1);
    expect(h.state.players[1].counters["leaderPerTurn"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Obsession
// ---------------------------------------------------------------------------

describe("Obsession", () => {
  it("grants at most one support point per turn", () => {
    const h = makeHarness({ cards: [["act-shield"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 3); // enough Hype for two 1-cost supports in one turn
    const a = placeCharacter(h.state, content, 0, "v-2-2", 0);
    const b = placeCharacter(h.state, content, 0, "v-3-3", 1);

    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-shield"), targets: [{ kind: "character", instanceId: a }] });
    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-shield"), targets: [{ kind: "character", instanceId: b }] });
    expect(h.state.players[0].obsession).toBe(1);
  });

  it("makes an Obsessed leader take 1 extra damage from enemy sources", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[0].obsession = content.balance.obsession.obsessedThreshold;
    const attacker = placeCharacter(h.state, content, 1, "v-3-3", 0);

    h.endTurn();
    const before = h.state.players[0].leaderHealth;
    h.play({ type: "attack", seat: 1, attackerInstanceId: attacker, target: { kind: "leader", seat: 0 } });
    expect(h.state.players[0].leaderHealth).toBe(before - 4); // 3 attack + 1 Obsessed penalty
  });

  it("spends Obsession on Fixation and enforces once per turn", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[0].obsession = 5;
    h.play({ type: "useFixation", seat: 0, kind: "fixation" });
    expect(h.state.players[0].obsession).toBe(2);
    expect(() => h.play({ type: "useFixation", seat: 0, kind: "fixation" })).toThrow();
  });

  it("makes the Ultimate free at max Obsession, then resets to the canonical value", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[0].obsession = content.balance.obsession.max;
    h.play({ type: "useFixation", seat: 0, kind: "ultimate" });
    expect(h.state.players[0].obsession).toBe(content.balance.obsession.fullFixationResetTo);
    expect(h.state.players[0].ultimateUsed).toBe(true);
  });

  it("allows the Ultimate only once per match", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[0].obsession = 7;
    h.play({ type: "useFixation", seat: 0, kind: "ultimate" });
    h.state.players[0].obsession = 7;
    expect(() => h.play({ type: "useFixation", seat: 0, kind: "ultimate" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Confluences
// ---------------------------------------------------------------------------

describe("Confluences", () => {
  it("becomes available after playing both Currents in one turn", () => {
    const h = harness({
      content,
      decks: [fillDeck("lead-cinder", ["act-cinder-ping", "act-tide-ping"], "A"), fillDeck("lead-prism", ["v-1-1"], "B")],
      firstSeat: 0,
    });
    h.begin();
    h.advanceTo(0, 4);
    placeCharacter(h.state, content, 1, "v-3-3", 0);

    expect(availableConfluences(h.state, content, 0)).toHaveLength(0);

    const target = { kind: "character" as const, instanceId: boardOf(h.state, 1)[0]!.instanceId };
    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-cinder-ping"), targets: [target] });
    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-tide-ping"), targets: [target] });

    const available = availableConfluences(h.state, content, 0);
    expect(available.map((c) => c.confluence)).toContain("steamveil");
    expect(available[0]!.available).toBe(true);
  });

  it("allows only one Confluence per player per turn", () => {
    const h = harness({
      content,
      decks: [fillDeck("lead-cinder", ["act-cinder-ping", "act-tide-ping"], "A"), fillDeck("lead-prism", ["v-1-1"], "B")],
      firstSeat: 0,
    });
    h.begin();
    h.advanceTo(0, 4);
    placeCharacter(h.state, content, 1, "v-3-3", 0);
    const friendly = placeCharacter(h.state, content, 0, "v-2-2", 0);
    const enemy = { kind: "character" as const, instanceId: boardOf(h.state, 1)[0]!.instanceId };

    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-cinder-ping"), targets: [enemy] });
    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-tide-ping"), targets: [enemy] });

    h.play({
      type: "activateConfluence",
      seat: 0,
      confluence: "steamveil",
      targets: [{ kind: "character", instanceId: friendly }],
    });
    expect(hasStatus(findCharacter(h.state, friendly)!, "warded")).toBe(true);

    expect(() =>
      h.play({
        type: "activateConfluence",
        seat: 0,
        confluence: "steamveil",
        targets: [{ kind: "character", instanceId: friendly }],
      })
    ).toThrow();
  });

  it("defines every canonical Confluence pair exactly once", () => {
    const pairs = Object.values(content.confluences)
      .filter((c) => c.currents)
      .map((c) => [...c.currents!].sort().join("+"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toHaveLength(8); // 8 natural pairs + refraction (null currents)
  });
});

// ---------------------------------------------------------------------------
// Turn sequence, fatigue, hand limit, counters
// ---------------------------------------------------------------------------

describe("turn sequence and edges", () => {
  it("deals escalating Burnout damage when drawing from an empty deck", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[0].deck = [];
    const before = h.state.players[0].leaderHealth;

    h.endTurn();
    h.endTurn(); // seat 0 draws with an empty deck → 1 damage
    expect(h.state.players[0].leaderHealth).toBe(before - 1);

    h.endTurn();
    h.endTurn(); // → 2 more damage
    expect(h.state.players[0].leaderHealth).toBe(before - 3);
  });

  it("burns drawn cards once the hand is full", () => {
    const h = makeHarness();
    h.begin();
    const limit = content.balance.hand.limit;
    while (h.state.players[0].hand.length < limit) giveCard(h.state, 0, "v-1-1");
    expect(h.state.players[0].hand.length).toBe(limit);

    h.endTurn();
    const events = h.endTurn(); // seat 0 draws into a full hand
    expect(events.some((e) => e.e === "cardBurned")).toBe(true);
    expect(h.state.players[0].hand.length).toBe(limit);
  });

  it("resets attacks at the start of each of your turns", () => {
    const h = makeHarness();
    h.begin();
    const unit = placeCharacter(h.state, content, 0, "v-3-3", 0);
    h.play({ type: "attack", seat: 0, attackerInstanceId: unit, target: { kind: "leader", seat: 1 } });
    expect(findCharacter(h.state, unit)!.attacksUsedThisTurn).toBe(1);

    h.endTurn();
    h.endTurn();
    expect(findCharacter(h.state, unit)!.attacksUsedThisTurn).toBe(0);
  });

  it("treats adjacency as the row the player sees, not raw board slots", () => {
    const h = makeHarness();
    h.begin();
    // occupy slots 0 and 4, leaving a three-slot hole between them. The row is
    // laid out densely, so these two stand side by side on screen.
    const left = placeCharacter(h.state, content, 0, "v-2-2", 0);
    const right = placeCharacter(h.state, content, 0, "v-3-3", 4);
    const source = placeCharacter(h.state, content, 0, "adj-source", 2);

    const ctx = makeContext(h.state, content, 0, "adj-source", { sourceCharacter: findCharacter(h.state, source)! });
    const neighbours = resolveTargets(ctx, { select: "adjacent" });
    const ids = neighbours.map((n) => (n.kind === "character" ? n.instanceId : "leader"));

    // raw-index adjacency would find nothing here (slots 1 and 3 are empty)
    expect(ids).toHaveLength(2);
    expect(ids).toContain(left);
    expect(ids).toContain(right);
  });

  it("supports counter-driven alternate victory", () => {
    const h = makeHarness({ cards: [["act-finale"], ["v-1-1"]] });
    h.begin();
    h.advanceTo(0, 3);
    h.play({ type: "playCard", seat: 0, instanceId: giveCard(h.state, 0, "act-finale") });
    expect(h.state.players[0].counters["finale"]).toBe(3);
    expect(h.state.winner).toBe(0);
    expect(h.state.phase).toBe("ended");
  });

  it("exposes counters publicly so Finale progress is always visible", () => {
    const h = makeHarness();
    h.begin();
    h.state.players[1].counters["finale"] = 2;
    const view = redact(h.state, 0);
    expect(view.opponent.counters["finale"]).toBe(2);
  });
});
