/**
 * Does every part of the effects DSL actually do anything?
 *
 * Five bugs of one shape have been found in this project, each by accident and
 * each separately: **Flow** fired on one of its four canonical channels;
 * `balanceOverrides "obsession.fixationCost"` bent a number nothing charged;
 * `{ op: "destroy" }` had never destroyed anything; `buff.permanent` was read by
 * no code; and `resurrect` ignored the filter on its own target. In every case
 * the thing existed, validated, and was used by shipped content — which is
 * exactly why nobody looked at it.
 *
 * So this stops looking for them one at a time. It enumerates the DSL **from the
 * schema itself**, and for each op and each optional field asks one question by
 * running the engine: *does the outcome differ when this is there?* An op that
 * changes nothing, or a field that changes nothing when set, fails.
 *
 * The coverage test at the bottom is the part that keeps it honest: a new op or
 * a new optional field that nobody has proved does something fails the suite by
 * name. It is the same assert-against-a-justified-list pattern used for the
 * deck-pool invariant, the story branch-truth check and the card-text audit —
 * an exemption is allowed, but it has to be written down with its reason.
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
import type { CardDef, EffectDef, EffectOp, MatchState, Seat } from "../src/engine/types";
import { zEffectDef, zEffectOp } from "../src/engine/validation";
import { cleanupDefeated, makeContext, runEffect, runOps } from "../src/engine/effects";
import { findCharacter } from "../src/engine/state";

// ---------------------------------------------------------------------------
// The DSL surface, read back out of the schema rather than typed out here
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const unwrap = (schema: any): any => {
  let s = schema;
  for (let i = 0; i < 20; i++) {
    const kind = s?._def?.typeName;
    if (kind === "ZodLazy") s = s._def.getter();
    else if (kind === "ZodEffects") s = s._def.schema;
    else break;
  }
  return s;
};
const isOptional = (schema: any): boolean => {
  const kind = schema?._def?.typeName;
  return kind === "ZodOptional" || kind === "ZodDefault";
};

/** Every op in the union, with the names of its optional fields. */
export function dslSurface(): { op: string; optional: string[] }[] {
  const options: any[] = unwrap(zEffectOp)?._def?.options ?? [];
  return options
    .map((option) => {
      const shape = unwrap(option)?._def?.shape?.() ?? {};
      return {
        op: String(shape["op"]?._def?.value ?? "?"),
        optional: Object.entries(shape)
          .filter(([key, value]) => key !== "op" && isOptional(value))
          .map(([key]) => key),
      };
    })
    .sort((a, b) => (a.op < b.op ? -1 : 1));
}

/** The optional fields on an EffectDef, from the same schema. */
export function effectDefOptionalFields(): string[] {
  const shape = unwrap(zEffectDef)?._def?.shape?.() ?? {};
  return Object.entries(shape)
    .filter(([, value]) => isOptional(value))
    .map(([key]) => key)
    .sort();
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// One rich board, so most ops need no scenario of their own
// ---------------------------------------------------------------------------

const CARDS: CardDef[] = [
  testLeader("lead-a", { current: "cinder", primaryCurrent: "cinder", secondaryCurrent: "tide" }),
  testLeader("lead-b", { current: "gale", primaryCurrent: "gale", secondaryCurrent: "root" }),
  testCharacter("body", 2, 2, 4, { tags: ["idol"] }),
  testCharacter("token", 1, 1, 1, { token: true }),
  testCharacter("other", 3, 3, 3),
  testCharacter("keyworded", 2, 2, 2, { keywords: ["spotlight"], text: "**Spotlight.**" }),
  testAction("spell", 2),
  testAction("spell-b", 4),
];

const content = fixtureContent(CARDS);

/**
 * A board with something of everything on it: damaged bodies, a status, a piece
 * of equipment, cards in every zone, Obsession and Hype already moving. Most ops
 * can then be run against it unmodified, which is what keeps 44 scenarios from
 * becoming 44 bespoke fixtures nobody maintains.
 */
function richBoard(): ReturnType<typeof harness> {
  const h = harness({
    content,
    decks: [fillDeck("lead-a", ["body", "other", "spell"]), fillDeck("lead-b", ["body", "other", "spell"])],
    firstSeat: 0,
  });
  h.begin();

  const mine = placeCharacter(h.state, content, 0, "body", 0);
  placeCharacter(h.state, content, 0, "keyworded", 1);
  const theirs = placeCharacter(h.state, content, 1, "body", 0);
  placeCharacter(h.state, content, 1, "other", 1);

  // a damaged body, so heals have somewhere to land — and deliberately NOT a
  // square one, or `swapAttackHealth` swaps 2/2 into 2/2 and reads as inert
  findCharacter(h.state, mine)!.health = 3;
  // a status, so removeStatus has something to remove
  findCharacter(h.state, theirs)!.statuses.push({ id: "scorched", remainingTurns: null, sourceCardId: "spell" });
  // equipment, so destroyEquipment has something to destroy
  findCharacter(h.state, mine)!.equipment = { instanceId: "eq1", cardId: "spell" };
  // a character that has already swung, so attackAgain has something to refresh
  findCharacter(h.state, theirs)!.attacksUsedThisTurn = 1;

  giveCard(h.state, 0, "spell");
  giveCard(h.state, 0, "body");
  giveCard(h.state, 1, "spell-b");
  h.state.players[0].discard.push({ instanceId: "dz", cardId: "other", costDelta: 0, addedKeywords: [], removedKeywords: [] });
  h.state.players[0].obsession = 4;
  h.state.players[1].obsession = 4;
  h.state.players[0].hype = 5;
  h.state.players[0].hypeMax = 5;
  return h;
}

const ANY_CHARACTER = { select: "all", side: "enemy", zone: "board" } as const;
const MY_CHARACTER = { select: "all", side: "friendly", zone: "board" } as const;

/**
 * What the state looks like, minus the parts that change without anything
 * happening.
 *
 * `config` never moves, and `rngState` moves whenever an op merely *consults*
 * randomness — which would let an op that consumed a roll and then did nothing
 * pass as though it had worked.
 */
function fingerprint(state: MatchState): string {
  const { config: _config, rngState: _rng, ...rest } = state;
  return JSON.stringify(rest);
}

/**
 * Run ops against a fresh rich board and return what the state became.
 *
 * The context is deliberately fully furnished: several ops read something other
 * than their own target — `refract` acts on `ctx.sourceCharacter`,
 * `modifyTriggeringCardCost` on `ctx.triggerCard`, `select: "triggering"` on the
 * binding — and an unfurnished context makes those ops look inert when the fault
 * is in the harness. Each of those three reported a false positive here first.
 */
function outcome(ops: EffectOp[], arrange?: (h: ReturnType<typeof harness>) => void, seat: Seat = 0): string {
  const h = richBoard();
  arrange?.(h);
  const ctx = makeContext(h.state, content, seat, "spell", {
    binding: [{ kind: "character", instanceId: h.state.players[1].board[0]!.instanceId }],
    sourceCharacter: h.state.players[0].board[0],
    // a real instance sitting in a real hand, so a cost change is visible in state
    triggerCard: h.state.players[0].hand[0],
  });
  runOps(ctx, ops);
  cleanupDefeated(ctx, null);
  return fingerprint(h.state);
}

const NOTHING = outcome([]);

// ---------------------------------------------------------------------------
// Every op, and one instance of it that must change something
// ---------------------------------------------------------------------------

interface Case {
  ops: EffectOp[];
  arrange?: (h: ReturnType<typeof harness>) => void;
  seat?: Seat;
}

const OPS: Record<string, Case> = {
  damage: { ops: [{ op: "damage", target: ANY_CHARACTER, amount: 1 }] },
  heal: { ops: [{ op: "heal", target: MY_CHARACTER, amount: 1 }] },
  buff: { ops: [{ op: "buff", target: MY_CHARACTER, attack: 1, health: 1 }] },
  setStats: { ops: [{ op: "setStats", target: MY_CHARACTER, attack: 7, health: 7 }] },
  summon: { ops: [{ op: "summon", cardId: "token" }] },
  draw: { ops: [{ op: "draw", count: 1 }] },
  discard: { ops: [{ op: "discard", target: { select: "leader", side: "friendly" }, count: 1 }] },
  returnToHand: { ops: [{ op: "returnToHand", target: MY_CHARACTER }] },
  applyStatus: { ops: [{ op: "applyStatus", target: MY_CHARACTER, status: "shielded" }] },
  removeStatus: { ops: [{ op: "removeStatus", target: ANY_CHARACTER, status: "scorched" }] },
  destroy: { ops: [{ op: "destroy", target: ANY_CHARACTER }] },
  transform: { ops: [{ op: "transform", target: ANY_CHARACTER, intoCardId: "token" }] },
  // copies the CARD of a character on the board, not a card in hand — a hand
  // card has no TargetRef, so a hand-zone spec resolves to nothing
  copyCardToHand: { ops: [{ op: "copyCardToHand", target: ANY_CHARACTER }] },
  stealCopy: { ops: [{ op: "stealCopy", from: "enemyHand" }] },
  banish: { ops: [{ op: "banish", target: ANY_CHARACTER }] },
  cancel: { ops: [{ op: "cancel", target: ANY_CHARACTER }] },
  destroyEquipment: { ops: [{ op: "destroyEquipment", target: MY_CHARACTER }] },
  gainHype: { ops: [{ op: "gainHype", amount: 1 }] },
  lockHype: { ops: [{ op: "lockHype", amount: 2 }] },
  gainObsession: { ops: [{ op: "gainObsession", amount: 1 }] },
  removeObsession: { ops: [{ op: "removeObsession", amount: 1 }] },
  addKeyword: { ops: [{ op: "addKeyword", target: MY_CHARACTER, keyword: "raid" }] },
  removeKeyword: { ops: [{ op: "removeKeyword", target: MY_CHARACTER, keyword: "spotlight" }] },
  modifyCost: { ops: [{ op: "modifyCost", target: { select: "all", side: "friendly", zone: "hand" }, delta: -1 }] },
  modifyTriggeringCardCost: { ops: [{ op: "modifyTriggeringCardCost", delta: -1 }] },
  chooseOne: { ops: [{ op: "chooseOne", options: [{ label: "a", ops: [{ op: "gainHype", amount: 1 }] }] }] },
  randomOp: { ops: [{ op: "randomOp", options: [{ ops: [{ op: "gainHype", amount: 1 }] }] }] },
  forEach: { ops: [{ op: "forEach", target: MY_CHARACTER, ops: [{ op: "buff", target: { select: "triggering" }, attack: 1 }] }] },
  if: { ops: [{ op: "if", condition: { kind: "obsessionAtLeast", side: "friendly", value: 1 }, then: [{ op: "gainHype", amount: 1 }] }] },
  scheduleDelayed: { ops: [{ op: "scheduleDelayed", delayTurns: 1, label: "later", ops: [{ op: "gainHype", amount: 1 }] }] },
  disableAuras: { ops: [{ op: "disableAuras", durationTurns: 2 }] },
  resurrect: { ops: [{ op: "resurrect", target: { select: "all", side: "friendly", zone: "discard" } }] },
  revive: {
    ops: [{ op: "revive", target: ANY_CHARACTER, health: 3 }],
    // revive only catches a character mid-defeat, so one has to be at 0
    arrange: (h) => {
      findCharacter(h.state, h.state.players[1].board[0]!.instanceId)!.health = 0;
    },
  },
  rotateLeaderCurrent: { ops: [{ op: "rotateLeaderCurrent" }] },
  mill: { ops: [{ op: "mill", count: 1 }] },
  scry: { ops: [{ op: "scry", count: 2, mode: "bottomOne" }] },
  swapAttackHealth: { ops: [{ op: "swapAttackHealth", target: MY_CHARACTER }] },
  refract: { ops: [{ op: "refract", intoCurrent: "veil" }] },
  attackAgain: { ops: [{ op: "attackAgain", target: ANY_CHARACTER }] },
  addCounter: { ops: [{ op: "addCounter", key: "k", amount: 1 }] },
  setCounter: { ops: [{ op: "setCounter", key: "k", amount: 3 }] },
  winMatch: { ops: [{ op: "winMatch" }] },
  repeatAfterpartyThisTurn: { ops: [{ op: "repeatAfterpartyThisTurn" }] },
  /**
   * `aura` is the one op that is never executed: it is a continuous modifier
   * read by `auraModifiersFor` while the card is in play. Running it through
   * `runOps` proves nothing, so it is exempt here and proved in rules.test.ts,
   * which puts one on the board and reads the stat back.
   */
  aura: { ops: [] },
};

const AURA_IS_NOT_RUN = "aura";

describe("every op in the DSL does something", () => {
  for (const [name, entry] of Object.entries(OPS)) {
    if (name === AURA_IS_NOT_RUN) continue;
    it(name, () => {
      expect(outcome(entry.ops, entry.arrange, entry.seat), `"${name}" changed nothing about the match`).not.toBe(
        entry.arrange ? outcome([], entry.arrange, entry.seat) : NOTHING
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Every optional field, and proof that setting it changes the outcome
// ---------------------------------------------------------------------------

interface FieldCase {
  base: EffectOp[];
  set: EffectOp[];
  arrange?: (h: ReturnType<typeof harness>) => void;
  seat?: Seat;
}

const shielded = (h: ReturnType<typeof harness>): void => {
  findCharacter(h.state, h.state.players[1].board[0]!.instanceId)!.statuses.push({
    id: "shielded",
    remainingTurns: null,
    sourceCardId: "spell",
  });
};

const FIELDS: Record<string, FieldCase> = {
  "damage.ignoresShield": {
    arrange: shielded,
    base: [{ op: "damage", target: ANY_CHARACTER, amount: 1 }],
    set: [{ op: "damage", target: ANY_CHARACTER, amount: 1, ignoresShield: true }],
  },
  "damage.cantBeHealedUntilNextTurn": {
    base: [{ op: "damage", target: ANY_CHARACTER, amount: 1 }],
    set: [{ op: "damage", target: ANY_CHARACTER, amount: 1, cantBeHealedUntilNextTurn: true }],
  },
  "buff.attack": {
    base: [{ op: "buff", target: MY_CHARACTER, health: 1 }],
    set: [{ op: "buff", target: MY_CHARACTER, health: 1, attack: 1 }],
  },
  "buff.health": {
    base: [{ op: "buff", target: MY_CHARACTER, attack: 1 }],
    set: [{ op: "buff", target: MY_CHARACTER, attack: 1, health: 1 }],
  },
  "summon.count": {
    base: [{ op: "summon", cardId: "token" }],
    set: [{ op: "summon", cardId: "token", count: 2 }],
  },
  "summon.side": {
    base: [{ op: "summon", cardId: "token" }],
    set: [{ op: "summon", cardId: "token", side: "enemy" }],
  },
  "draw.side": {
    base: [{ op: "draw", count: 1 }],
    set: [{ op: "draw", count: 1, side: "enemy" }],
  },
  "discard.count": {
    base: [{ op: "discard", target: { select: "leader", side: "friendly" }, count: 1 }],
    set: [{ op: "discard", target: { select: "leader", side: "friendly" }, count: 2 }],
  },
  "applyStatus.amount": {
    base: [{ op: "applyStatus", target: MY_CHARACTER, status: "weakened" }],
    set: [{ op: "applyStatus", target: MY_CHARACTER, status: "weakened", amount: 3 }],
  },
  "applyStatus.durationTurns": {
    base: [{ op: "applyStatus", target: MY_CHARACTER, status: "weakened" }],
    set: [{ op: "applyStatus", target: MY_CHARACTER, status: "weakened", durationTurns: 2 }],
  },
  "removeStatus.status": {
    base: [{ op: "removeStatus", target: ANY_CHARACTER }],
    set: [{ op: "removeStatus", target: ANY_CHARACTER, status: "shielded" }],
    arrange: shielded,
  },
  "removeStatus.polarity": {
    arrange: shielded,
    base: [{ op: "removeStatus", target: ANY_CHARACTER, polarity: "negative" }],
    set: [{ op: "removeStatus", target: ANY_CHARACTER, polarity: "positive" }],
  },
  "copyCardToHand.costDelta": {
    base: [{ op: "copyCardToHand", target: ANY_CHARACTER }],
    set: [{ op: "copyCardToHand", target: ANY_CHARACTER, costDelta: 2 }],
  },
  "stealCopy.count": {
    base: [{ op: "stealCopy", from: "enemyHand" }],
    set: [{ op: "stealCopy", from: "enemyHand", count: 2 }],
    arrange: (h) => {
      giveCard(h.state, 1, "body");
      giveCard(h.state, 1, "other");
    },
  },
  /**
   * The default is `true`, not false: omitting the flag banishes *temporarily*,
   * and only an explicit `false` makes it permanent. So the two values have to
   * be compared against each other — undefined against true is the same banish
   * twice, which reads as an inert field and is not one.
   */
  "banish.returnAtStartOfYourNextTurn": {
    base: [{ op: "banish", target: ANY_CHARACTER, returnAtStartOfYourNextTurn: false }],
    set: [{ op: "banish", target: ANY_CHARACTER, returnAtStartOfYourNextTurn: true }],
  },
  "cancel.durationTurns": {
    base: [{ op: "cancel", target: ANY_CHARACTER }],
    set: [{ op: "cancel", target: ANY_CHARACTER, durationTurns: 3 }],
  },
  "gainHype.permanent": {
    base: [{ op: "gainHype", amount: 1 }],
    set: [{ op: "gainHype", amount: 1, permanent: true }],
  },
  "gainHype.side": {
    base: [{ op: "gainHype", amount: 1 }],
    set: [{ op: "gainHype", amount: 1, side: "enemy" }],
  },
  "gainObsession.side": {
    base: [{ op: "gainObsession", amount: 1 }],
    set: [{ op: "gainObsession", amount: 1, side: "enemy" }],
  },
  "removeObsession.side": {
    base: [{ op: "removeObsession", amount: 1 }],
    set: [{ op: "removeObsession", amount: 1, side: "enemy" }],
  },
  "mill.side": {
    base: [{ op: "mill", count: 1 }],
    set: [{ op: "mill", count: 1, side: "enemy" }],
  },
  "scry.side": {
    base: [{ op: "scry", count: 2, mode: "bottomOne" }],
    set: [{ op: "scry", count: 2, mode: "bottomOne", side: "enemy" }],
  },
  "scry.pick": { base: [], set: [] },
  "addCounter.side": {
    base: [{ op: "addCounter", key: "k", amount: 1 }],
    set: [{ op: "addCounter", key: "k", amount: 1, side: "enemy" }],
  },
  "setCounter.side": {
    base: [{ op: "setCounter", key: "k", amount: 2 }],
    set: [{ op: "setCounter", key: "k", amount: 2, side: "enemy" }],
  },
  "rotateLeaderCurrent.side": {
    base: [{ op: "rotateLeaderCurrent" }],
    set: [{ op: "rotateLeaderCurrent", side: "enemy" }],
  },
  "resurrect.count": {
    base: [{ op: "resurrect", target: { select: "all", side: "friendly", zone: "discard" }, count: 1 }],
    set: [{ op: "resurrect", target: { select: "all", side: "friendly", zone: "discard" }, count: 2 }],
    arrange: (h) => {
      h.state.players[0].discard.push({ instanceId: "dz2", cardId: "body", costDelta: 0, addedKeywords: [], removedKeywords: [] });
    },
  },
  "refract.intoCurrent": {
    base: [{ op: "refract" }],
    set: [{ op: "refract", intoCurrent: "veil" }],
  },
  "if.else": {
    base: [{ op: "if", condition: { kind: "obsessionAtLeast", side: "friendly", value: 99 }, then: [{ op: "gainHype", amount: 1 }] }],
    set: [
      {
        op: "if",
        condition: { kind: "obsessionAtLeast", side: "friendly", value: 99 },
        then: [{ op: "gainHype", amount: 1 }],
        else: [{ op: "gainObsession", amount: 1 }],
      },
    ],
  },
  "aura.attack": { base: [], set: [] },
  "aura.health": { base: [], set: [] },
  "aura.costDelta": { base: [], set: [] },
  "aura.grantKeyword": { base: [], set: [] },
};

/** Optional fields proved somewhere other than by the differential harness. */
const PROVED_ELSEWHERE: Record<string, string> = {
  "aura.attack": "aura is never executed — it is a continuous modifier read by auraModifiersFor; proved in rules.test.ts",
  "aura.health": "same as aura.attack",
  "aura.costDelta": "same as aura.attack",
  "aura.grantKeyword": "same as aura.attack",
  "scry.pick":
    'its two values are "random" and "mostPlayable", and a random pick can land on the same card the deliberate one would — ' +
    "so it gets the behavioural test below instead of a differential one",
};

/**
 * `scry.pick` decides which of the revealed cards `bottomOne` buries. Comparing
 * outcomes would be flaky, because a random pick can agree with the deliberate
 * one by chance; so this asserts the decision itself, on a deck where exactly
 * one revealed card is castable.
 */
describe("scry.pick", () => {
  it("buries the card that side could actually cast, not a random one", () => {
    const h = richBoard();
    const player = h.state.players[0];
    player.hype = 2;
    // top of deck: an affordable 2-cost, then an unaffordable 4-cost
    player.deck = [
      { instanceId: "s1", cardId: "spell", costDelta: 0, addedKeywords: [], removedKeywords: [] },
      { instanceId: "s2", cardId: "spell-b", costDelta: 0, addedKeywords: [], removedKeywords: [] },
      ...player.deck,
    ];

    const ctx = makeContext(h.state, content, 0, "spell");
    runOps(ctx, [{ op: "scry", count: 2, mode: "bottomOne", pick: "mostPlayable" }]);

    expect(player.deck[0]!.instanceId, "the castable card should have been buried").toBe("s2");
    expect(player.deck[player.deck.length - 1]!.instanceId).toBe("s1");
  });
});

describe("every optional field in the DSL changes something", () => {
  for (const [name, entry] of Object.entries(FIELDS)) {
    if (name in PROVED_ELSEWHERE) continue;
    it(name, () => {
      expect(
        outcome(entry.set, entry.arrange, entry.seat),
        `setting "${name}" changed nothing — the field is decoration`
      ).not.toBe(outcome(entry.base, entry.arrange, entry.seat));
    });
  }
});

// ---------------------------------------------------------------------------
// Coverage — a new op or field has to be proved, not merely added
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The same question one level up: does every field on an EffectDef do anything?
// ---------------------------------------------------------------------------

/**
 * Two of the five bugs this file exists for lived here rather than on an op —
 * **Flow** fired on one of four channels, and `once` / `oncePerTurn` did nothing
 * at all on a leader passive, because the bookkeeping hung off a character
 * instance and a leader has none. So the effect's own fields get the same
 * treatment as the ops'.
 */
const EFFECT_FIELDS: Record<string, { base: EffectDef; set: EffectDef }> = {
  target: {
    base: { trigger: "onPlay", ops: [{ op: "buff", target: { select: "triggering" }, attack: 1 }] },
    set: {
      trigger: "onPlay",
      target: MY_CHARACTER,
      ops: [{ op: "buff", target: { select: "triggering" }, attack: 1 }],
    },
  },
  condition: {
    base: { trigger: "onPlay", ops: [{ op: "gainHype", amount: 1 }] },
    set: {
      trigger: "onPlay",
      condition: { kind: "obsessionAtLeast", side: "friendly", value: 99 },
      ops: [{ op: "gainHype", amount: 1 }],
    },
  },
  playedFilter: { base: { trigger: "onPlay", ops: [] }, set: { trigger: "onPlay", ops: [] } },
  reactionOn: { base: { trigger: "onPlay", ops: [] }, set: { trigger: "onPlay", ops: [] } },
  once: { base: { trigger: "onPlay", ops: [] }, set: { trigger: "onPlay", ops: [] } },
  oncePerTurn: { base: { trigger: "onPlay", ops: [] }, set: { trigger: "onPlay", ops: [] } },
  text: { base: { trigger: "onPlay", ops: [] }, set: { trigger: "onPlay", ops: [] } },
};

const EFFECT_PROVED_ELSEWHERE: Record<string, string> = {
  playedFilter: "only meaningful under onCardPlayed, which needs a card actually played — covered in rules.test.ts",
  reactionOn: "reaction cards only, and it is the reducer that arms and fires them — covered in rules.test.ts",
  once: "needs the same effect offered twice to show; proved on a leader passive in boss-twists.test.ts, where it once did nothing",
  oncePerTurn: "same as `once` — the gated and ungated Vigil pair in boss-twists.test.ts is exactly this test",
  text: "display only: it is what the trigger rail shows while a cascade resolves, and changes no state by design",
};

function effectOutcome(effect: EffectDef): string {
  const h = richBoard();
  const ctx = makeContext(h.state, content, 0, "spell", {
    binding: [{ kind: "character", instanceId: h.state.players[1].board[0]!.instanceId }],
    sourceCharacter: h.state.players[0].board[0],
  });
  runEffect(ctx, effect);
  cleanupDefeated(ctx, null);
  return fingerprint(h.state);
}

describe("every optional field on an EffectDef changes something", () => {
  for (const [name, entry] of Object.entries(EFFECT_FIELDS)) {
    if (name in EFFECT_PROVED_ELSEWHERE) continue;
    it(name, () => {
      expect(effectOutcome(entry.set), `setting "${name}" changed nothing — the field is decoration`).not.toBe(
        effectOutcome(entry.base)
      );
    });
  }
});

describe("the DSL surface is fully covered", () => {
  const surface = dslSurface();

  it("has a case for every op the schema defines", () => {
    const missing = surface.map((entry) => entry.op).filter((op) => !(op in OPS));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `\n${missing.length} op(s) exist in the schema and nothing proves they do anything:\n  ${missing.join("\n  ")}\n\n` +
          "Add a case to OPS in this file. Five bugs of exactly this shape have shipped.\n"
    ).toEqual([]);
  });

  it("has a case for every optional field the schema defines", () => {
    const wanted = surface.flatMap((entry) => entry.optional.map((field) => `${entry.op}.${field}`));
    const missing = wanted.filter((key) => !(key in FIELDS));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `\n${missing.length} optional field(s) exist in the schema and nothing proves they change anything:\n  ${missing.join("\n  ")}\n\n` +
          "Add a case to FIELDS, or to PROVED_ELSEWHERE with the reason.\n"
    ).toEqual([]);
  });

  it("has no exemption that no longer names a real field", () => {
    const wanted = new Set(surface.flatMap((entry) => entry.optional.map((field) => `${entry.op}.${field}`)));
    const stale = Object.keys(PROVED_ELSEWHERE).filter((key) => !wanted.has(key));
    expect(stale, stale.length === 0 ? "" : `\nPROVED_ELSEWHERE excuses fields that no longer exist:\n  ${stale.join("\n  ")}\n`).toEqual([]);
  });

  /**
   * The mirror of the check above, and the one that would have saved a detour.
   *
   * `if.condition` was written up here as an optional field and "proved" with a
   * conditionless `{ op: "if" }`, which the schema does not accept and which
   * therefore only demonstrated that an invalid op behaves badly. A case naming
   * a field that is not optional is testing something that cannot occur.
   */
  it("tests no field that is not actually optional", () => {
    const wanted = new Set(surface.flatMap((entry) => entry.optional.map((field) => `${entry.op}.${field}`)));
    const imaginary = Object.keys(FIELDS).filter((key) => !wanted.has(key));
    expect(
      imaginary,
      imaginary.length === 0 ? "" : `\nFIELDS has cases for field(s) the schema does not make optional:\n  ${imaginary.join("\n  ")}\n`
    ).toEqual([]);
  });

  it("has a case for every optional field on an EffectDef", () => {
    const missing = effectDefOptionalFields().filter((field) => !(field in EFFECT_FIELDS));
    expect(
      missing,
      missing.length === 0
        ? ""
        : `\n${missing.length} EffectDef field(s) exist and nothing proves they change anything:\n  ${missing.join("\n  ")}\n\n` +
          "Add a case to EFFECT_FIELDS, or to EFFECT_PROVED_ELSEWHERE with the reason.\n"
    ).toEqual([]);
  });

  it("has no EffectDef exemption that no longer names a real field", () => {
    const wanted = new Set(effectDefOptionalFields());
    const stale = Object.keys(EFFECT_PROVED_ELSEWHERE).filter((key) => !wanted.has(key));
    expect(stale, stale.length === 0 ? "" : `\nEFFECT_PROVED_ELSEWHERE excuses fields that no longer exist:\n  ${stale.join("\n  ")}\n`).toEqual([]);
  });
});
