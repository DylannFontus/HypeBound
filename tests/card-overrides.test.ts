/**
 * `MatchConfig.cardOverrides` — the per-player counterpart to balanceOverrides.
 *
 * Balance is one rulebook shared by both seats, so "your Fixation costs 2"
 * written as a balance override discounts the opponent's too. A leader card
 * belongs to exactly one player, so patching it is how a run artifact, a card
 * upgrade or a boss twist changes the game for one side only.
 *
 * The load-bearing claim is that patches live in config: `replay()` rebuilds
 * from config, so a card bent anywhere else would be its unbent self on replay.
 */

import { describe, expect, it } from "vitest";
import { ContentError, resolveMatchContent } from "../src/engine/content";
import { getContent } from "../src/engine/content";
import { fillDeck, fixtureContent, giveCard, harness, testCharacter, testLeader } from "./fixtures";
import { replay, stateHash } from "../src/engine/replay";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { effectiveCost } from "../src/engine/intents";
import type { CardDef, LeaderCardDef, MatchConfig } from "../src/engine/types";

const CARDS: CardDef[] = [
  testLeader("lead-a"),
  testLeader("lead-b"),
  testCharacter("c-3-3", 3, 3, 3),
  testCharacter("c-0-1", 0, 1, 1),
  testCharacter("c-1-1", 1, 1, 1),
];
const content = fixtureContent(CARDS);

describe("applying a patch", () => {
  it("shifts cost, attack and health by the delta", () => {
    const patched = resolveMatchContent(content, undefined, {
      "c-3-3": { cost: -1, attack: 2, health: 1 },
    });
    const card = patched.cards["c-3-3"]!;
    expect(card.cost).toBe(2);
    expect(card).toMatchObject({ attack: 5, health: 4 });
    // the original index is untouched, so the next match deals the real card
    expect(content.cards["c-3-3"]).toMatchObject({ cost: 3, attack: 3, health: 3 });
  });

  it("clamps to what the card schema allows rather than producing an illegal card", () => {
    // "cost -1 (minimum 0)" is exactly how the design words the upgrade
    const floored = resolveMatchContent(content, undefined, { "c-0-1": { cost: -3, attack: -5, health: -9 } });
    expect(floored.cards["c-0-1"]!.cost).toBe(0);
    expect(floored.cards["c-0-1"]).toMatchObject({ attack: 0, health: 1 });

    const capped = resolveMatchContent(content, undefined, { "c-3-3": { cost: 40 } });
    expect(capped.cards["c-3-3"]!.cost).toBe(12);
  });

  it("adds keywords without duplicating them, and appends to the rules text", () => {
    const patched = resolveMatchContent(content, undefined, {
      "c-3-3": { keywords: ["rushwind", "rushwind"], textSuffix: "Remastered." },
    });
    expect(patched.cards["c-3-3"]!.keywords).toEqual(["rushwind"]);
    expect(patched.cards["c-3-3"]!.text).toContain("Remastered.");
  });

  it("only clones the cards it patches", () => {
    const patched = resolveMatchContent(content, undefined, { "c-3-3": { cost: -1 } });
    expect(patched.cards["c-1-1"]).toBe(content.cards["c-1-1"]);
    expect(patched.cards["c-3-3"]).not.toBe(content.cards["c-3-3"]);
  });

  it("returns the index untouched when there is nothing to patch", () => {
    expect(resolveMatchContent(content, undefined, {})).toBe(content);
    expect(resolveMatchContent(content)).toBe(content);
  });
});

describe("leader patches", () => {
  it("appends passives and keeps the leader index in step", () => {
    const patched = resolveMatchContent(content, undefined, {
      "lead-a": {
        passive: [{ trigger: "startOfTurn", text: "artifact", ops: [{ op: "gainHype", amount: 1 }] }],
      },
    });
    const leader = patched.leaders["lead-a"] as LeaderCardDef;
    expect(leader.passive).toHaveLength(1);
    // cards and leaders must not disagree about what the leader is
    expect(patched.cards["lead-a"]).toBe(leader);
  });

  it("moves Fixation and Ultimate costs, floored at zero", () => {
    const patched = resolveMatchContent(content, undefined, {
      "lead-a": { fixationCost: -1, ultimateCost: -1 },
    });
    expect(patched.leaders["lead-a"]!.fixation.obsessionCost).toBe(2);
    expect(patched.leaders["lead-a"]!.ultimate.obsessionCost).toBe(6);

    const free = resolveMatchContent(content, undefined, { "lead-a": { fixationCost: -99 } });
    expect(free.leaders["lead-a"]!.fixation.obsessionCost).toBe(0);
  });
});

describe("refusing a patch that would do nothing or produce nonsense", () => {
  const refuse = (patch: Record<string, unknown>): string => {
    try {
      resolveMatchContent(content, undefined, patch as never);
    } catch (error) {
      return error instanceof ContentError ? error.problems.join("; ") : String(error);
    }
    return "";
  };

  it("rejects an unknown card", () => {
    expect(refuse({ "no-such-card": { cost: -1 } })).toContain("unknown card");
  });

  it("rejects leader-only fields on a non-leader", () => {
    // a silently dropped patch is how an artifact ships doing nothing
    expect(refuse({ "c-3-3": { fixationCost: -1 } })).toContain("not a leader");
    expect(refuse({ "c-3-3": { passive: [] } })).toContain("not a leader");
  });

  it("rejects a stat patch aimed at a card with no such stat", () => {
    expect(refuse({ "lead-a": { attack: 1 } })).toContain("has no attack");
  });

  it("re-validates the result against the card schema", () => {
    // health is clamped, so reach for something clamping cannot save
    expect(refuse({ "c-3-3": { keywords: ["collab"] } })).toContain("collab requires the collab field");
  });
});

describe("a patched match", () => {
  const makeMatch = (overrides?: MatchConfig["cardOverrides"]) => {
    const config: MatchConfig = {
      seed: 99,
      decks: [fillDeck("lead-a", ["c-3-3"], "A"), fillDeck("lead-b", ["c-1-1"], "B")],
      firstSeat: 0,
      ...(overrides ? { cardOverrides: overrides } : {}),
    };
    const resolved = resolveMatchContent(content, config.balanceOverrides, config.cardOverrides);
    return { config, content: resolved, state: createMatch(config, resolved) };
  };

  it("charges the patched cost when the card is played", () => {
    const cheap = makeMatch({ "c-3-3": { cost: -2 } });
    const h = harness({ content: cheap.content, decks: cheap.config.decks, seed: 99, firstSeat: 0 });
    h.begin();
    h.advanceTo(0, 1); // one Hype: enough only if the patch applied
    const instance = giveCard(h.state, 0, "c-3-3");
    expect(effectiveCost(h.state, cheap.content, 0, h.state.players[0].hand.find((c) => c.instanceId === instance)!)).toBe(1);
    h.play({ type: "playCard", seat: 0, instanceId: instance, slot: 0 });
    expect(h.state.players[0].board[0]).not.toBeNull();
  });

  it("puts the patched stats on the board", () => {
    const buffed = makeMatch({ "c-3-3": { attack: 2, health: 2 } });
    const h = harness({ content: buffed.content, decks: buffed.config.decks, seed: 99, firstSeat: 0 });
    h.begin();
    h.advanceTo(0, 3);
    const instance = giveCard(h.state, 0, "c-3-3");
    h.play({ type: "playCard", seat: 0, instanceId: instance, slot: 0 });
    expect(h.state.players[0].board[0]).toMatchObject({ attack: 5, health: 5, baseAttack: 5, baseHealth: 5 });
  });

  it("bends one seat only — the other player's leader is untouched", () => {
    const patched = resolveMatchContent(content, undefined, { "lead-a": { fixationCost: -3 } });
    expect(patched.leaders["lead-a"]!.fixation.obsessionCost).toBe(0);
    expect(patched.leaders["lead-b"]!.fixation.obsessionCost).toBe(3);
  });

  /**
   * A record whose ONLY legal reading is the patched one.
   *
   * The scenario deals seat 0 a single 3-cost card and the log plays it on turn
   * one, when the seat has exactly 1 Hype. That is affordable at cost 1 and
   * illegal at cost 3, so the replay either honours `cardOverrides` or throws.
   * Without this the record would replay identically either way and the test
   * would pass while proving nothing.
   */
  const buildLethalToIgnorePatch = () => {
    const config: MatchConfig = {
      seed: 99,
      decks: [fillDeck("lead-a", ["c-3-3"], "A"), fillDeck("lead-b", ["c-1-1"], "B")],
      firstSeat: 0,
      scenario: { setup: [{ op: "hand", seat: 0, cards: ["c-3-3"] }] },
      cardOverrides: { "c-3-3": { cost: -2, attack: 2 } },
    };
    const resolved = resolveMatchContent(content, undefined, config.cardOverrides);
    let state = createMatch(config, resolved);
    const intents: Parameters<typeof applyIntent>[2][] = [];
    const push = (intent: Parameters<typeof applyIntent>[2]) => {
      state = applyIntent(state, resolved, intent).state;
      intents.push(intent);
    };

    push({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
    push({ type: "mulligan", seat: 1, replaceInstanceIds: [] });
    const inHand = state.players[0].hand.find((c) => c.cardId === "c-3-3")!;
    expect(state.players[0].hype, "the point of the test is 1 Hype against a 3-cost card").toBe(1);
    push({ type: "playCard", seat: 0, instanceId: inHand.instanceId, slot: 0 });
    expect(state.players[0].board[0]).toMatchObject({ attack: 5 });

    return { config, state, record: { schemaVersion: 1, config, intents } };
  };

  it("survives a replay, because the patch lives in config", () => {
    const { state, record } = buildLethalToIgnorePatch();
    // replay() gets the UNPATCHED index and has to rebuild the patch from config
    const result = replay(record, content);
    expect(result.errors).toEqual([]);
    expect(stateHash(result.state)).toBe(stateHash(state));
  });

  it("would fail that replay if the patch were dropped", () => {
    const { record } = buildLethalToIgnorePatch();
    const stripped = { ...record, config: { ...record.config, cardOverrides: undefined } };
    const result = replay(stripped, content);
    expect(result.errors.length, "a 3-cost card on 1 Hype must be refused").toBeGreaterThan(0);
    expect(result.errors[0]!.message).toMatch(/hype/i);
  });
});

describe("against real content", () => {
  it("patches a shipped leader without breaking validation", () => {
    const real = getContent();
    const patched = resolveMatchContent(real, undefined, {
      "idols-lumi-starcall": {
        fixationCost: -1,
        passive: [
          {
            trigger: "afterparty",
            text: "Merch Cannon",
            ops: [{ op: "damage", target: { select: "random", side: "enemy", zone: "board" }, amount: 1 }],
          },
        ],
        textSuffix: "Carrying artifacts.",
      },
    });
    const leader = patched.leaders["idols-lumi-starcall"]!;
    expect(leader.fixation.obsessionCost).toBe(2);
    expect(leader.passive.length).toBe(real.leaders["idols-lumi-starcall"]!.passive.length + 1);
  });
});
