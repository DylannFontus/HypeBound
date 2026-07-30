/**
 * Puzzle solutions, re-simulated.
 *
 * The mode spec is explicit that "solutions are validated by re-simulation;
 * every puzzle asserts its solution in the test suite". That is the only way a
 * hand-authored puzzle stays honest: the numbers that make a line exact are the
 * same numbers that card balance changes underneath you, and a puzzle whose
 * lethal no longer adds up is worse than no puzzle at all.
 *
 * Each puzzle asserts BOTH directions — the intended line wins, and the
 * plausible wrong line does not. A puzzle with two solutions is not a puzzle.
 */

import { describe, expect, it } from "vitest";
import { getContent, resolveMatchContent } from "../src/engine/content";
import { getEncounters } from "../src/engine/encounters";
import { createMatch } from "../src/engine/state";
import { applyIntent, beginScriptedMatch } from "../src/engine/reducer";
import { replay, startRecord, recordIntent, stateHash } from "../src/engine/replay";
import { effectiveCost } from "../src/engine/intents";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import type { AiDifficulty, MatchConfig, MatchState, PlayerIntent, Seat } from "../src/engine/types";

const content = getContent();
const encounters = getEncounters(new Set(Object.keys(content.cards)));
const puzzles = encounters["puzzles"]!;

/** Deal a puzzle and open it, exactly as the driver does. */
function openPuzzle(stageId: string): MatchState {
  const stage = puzzles.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`no puzzle ${stageId}`);
  const config: MatchConfig = {
    seed: stage.seed,
    decks: [puzzles.decks[stage.decks[0]]!, puzzles.decks[stage.decks[1]]!],
    ...(stage.firstSeat !== undefined ? { firstSeat: stage.firstSeat } : {}),
    ...(stage.scenario ? { scenario: stage.scenario } : {}),
  };
  const state = createMatch(config, content);
  beginScriptedMatch(state, content);
  return state;
}

const boardOf = (state: MatchState, seat: Seat) => state.players[seat].board.filter((c) => c !== null);
const unitAt = (state: MatchState, seat: Seat, cardId: string) =>
  boardOf(state, seat).find((c) => c!.cardId === cardId)!;
const handCard = (state: MatchState, cardId: string) =>
  state.players[0].hand.find((c) => c.cardId === cardId)!;

/** Apply a line of intents; returns the final state, or the error that stopped it. */
function play(state: MatchState, line: (s: MatchState) => PlayerIntent[]): MatchState {
  let current = state;
  for (const intent of line(current)) {
    current = applyIntent(current, content, intent).state;
  }
  return current;
}

describe("P1 — Ratio Required (Lethal / Currents)", () => {
  it("deals the board the brief describes", () => {
    const state = openPuzzle("p1-ratio-required");
    expect(state.phase).toBe("main");
    // 2 Hype, from `{ op: "turn", value: 2 }` — Hype is derived, not settable
    expect(state.players[0].hype).toBe(2);
    expect(state.players[1].leaderHealth).toBe(3);
    expect(boardOf(state, 1)).toHaveLength(1);
    expect(unitAt(state, 1, "corp-unpaid-intern").keywords).toContain("spotlight");
  });

  it("is solved by spending the SMALL attacker on the wall", () => {
    // Gale 2/1 into the Root 0/3 wall: Gale beats Root, so 2+1 = 3 kills it,
    // and a 0-attack wall cannot hit back. That leaves the 3/2 for the leader.
    const state = openPuzzle("p1-ratio-required");
    const solved = play(state, (s) => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(s, 0, "meme-first-poster").instanceId,
        target: { kind: "character", instanceId: unitAt(s, 1, "corp-unpaid-intern").instanceId },
      },
    ]);
    expect(boardOf(solved, 1)).toHaveLength(0);

    const finished = play(solved, (s) => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(s, 0, "viral-drama-channel").instanceId,
        target: { kind: "leader", seat: 1 },
      },
    ]);
    expect(finished.players[1].leaderHealth).toBeLessThanOrEqual(0);
    expect(finished.winner).toBe(0);
  });

  it("fails if the BIG attacker is spent on the wall — the puzzle has one answer", () => {
    const state = openPuzzle("p1-ratio-required");
    const wrong = play(state, (s) => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(s, 0, "viral-drama-channel").instanceId,
        target: { kind: "character", instanceId: unitAt(s, 1, "corp-unpaid-intern").instanceId },
      },
    ]);
    expect(boardOf(wrong, 1)).toHaveLength(0);

    const stalled = play(wrong, (s) => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(s, 0, "meme-first-poster").instanceId,
        target: { kind: "leader", seat: 1 },
      },
    ]);
    // 2 damage against 3 health — one short, which is the whole lesson
    expect(stalled.players[1].leaderHealth).toBeGreaterThan(0);
    expect(stalled.winner).toBeNull();
  });

  it("will not let you skip the bodyguard", () => {
    const state = openPuzzle("p1-ratio-required");
    expect(() =>
      applyIntent(state, content, {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(state, 0, "viral-drama-channel").instanceId,
        target: { kind: "leader", seat: 1 },
      })
    ).toThrow();
  });
});

describe("P2 — Encore, Encore (Lethal / Confluence)", () => {
  it("deals the board the brief describes", () => {
    const state = openPuzzle("p2-encore-encore");
    expect(state.players[0].hype).toBe(3);
    expect(state.players[1].leaderHealth).toBe(8);
    expect(unitAt(state, 0, "cosplay-token-hall-champion").attack).toBe(4);
    // the two authored cards plus the turn-start draw; the deck holds only an
    // unaffordable 5-cost so the draw can never open an alternate line
    const hand = state.players[0].hand.map((c) => c.cardId);
    expect(hand).toEqual(expect.arrayContaining(["algo-queue-jumper", "viral-first-follower"]));
    expect(hand).toHaveLength(3);
  });

  it("is solved by playing both Currents, then swinging twice", () => {
    let state = openPuzzle("p2-encore-encore");

    // Gale then Pulse, in the same turn — that is what lights Tempest
    state = play(state, (s) => [
      { type: "playCard", seat: 0, instanceId: handCard(s, "viral-first-follower").instanceId, targets: [], slot: 1 },
    ]);
    state = play(state, (s) => [
      { type: "playCard", seat: 0, instanceId: handCard(s, "algo-queue-jumper").instanceId, targets: [], slot: 2 },
    ]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(
      expect.arrayContaining(["gale", "pulse"])
    );

    const champion = unitAt(state, 0, "cosplay-token-hall-champion").instanceId;
    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: champion, target: { kind: "leader", seat: 1 } },
    ]);
    expect(state.players[1].leaderHealth).toBe(4);

    // Tempest, choosing "a friendly character may attack again" (choice index 1)
    state = play(state, () => [
      {
        type: "activateConfluence",
        seat: 0,
        confluence: "tempest",
        choice: 1,
        targets: [{ kind: "character", instanceId: champion }],
      },
    ]);
    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: champion, target: { kind: "leader", seat: 1 } },
    ]);

    expect(state.players[1].leaderHealth).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("falls two short without the Confluence", () => {
    // the freshly played characters are summoning-sick, so the only other
    // damage available this turn is nothing at all
    let state = openPuzzle("p2-encore-encore");
    const champion = unitAt(state, 0, "cosplay-token-hall-champion").instanceId;
    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: champion, target: { kind: "leader", seat: 1 } },
    ]);
    expect(state.players[1].leaderHealth).toBe(4);
    expect(state.winner).toBeNull();
  });
});

describe("every shipped puzzle", () => {
  it("declares an objective, since a puzzle with no goal cannot be solved", () => {
    for (const stage of puzzles.stages) {
      expect(stage.objective, `${stage.id} has no objective`).toBeDefined();
    }
  });

  it("opens straight into a playable main phase", () => {
    for (const stage of puzzles.stages) {
      const state = openPuzzle(stage.id);
      expect(state.phase, `${stage.id}`).toBe("main");
      expect(state.activeSeat, `${stage.id}`).toBe(0);
      expect(state.winner, `${stage.id} is already over`).toBeNull();
    }
  });
});

describe("P3 — Bait the Clip (Lethal / Reactions)", () => {
  it("deals the board the brief describes, Reaction armed", () => {
    const state = openPuzzle("p3-bait-the-clip");
    expect(state.players[1].reactions.map((r) => r.cardId)).toEqual(["goth-twenty-year-grudge"]);
    expect(state.players[1].leaderHealth).toBe(3);
    expect(unitAt(state, 1, "corp-unpaid-intern").keywords).toContain("spotlight");
    expect(boardOf(state, 0)).toHaveLength(3);
  });

  it("cancels the attack outright when the Reaction kills the attacker", () => {
    // The engine resolves the Reaction FIRST: reactionTriggered -> damageDealt
    // -> characterDefeated, and the attack never lands. That is the whole
    // puzzle — a bait does not trade, it simply dies.
    const state = openPuzzle("p3-bait-the-clip");
    const result = applyIntent(state, content, {
      type: "attack",
      seat: 0,
      attackerInstanceId: unitAt(state, 0, "meme-first-poster").instanceId,
      target: { kind: "character", instanceId: unitAt(state, 1, "corp-unpaid-intern").instanceId },
    });
    expect(result.events.map((e) => e.e)).toContain("reactionTriggered");
    // wall untouched, bait gone, Reaction spent
    expect(unitAt(result.state, 1, "corp-unpaid-intern").health).toBe(3);
    expect(boardOf(result.state, 0)).toHaveLength(2);
    expect(result.state.players[1].reactions).toHaveLength(0);
  });

  it("is solved by baiting with the 2/1, then clearing and finishing", () => {
    let state = openPuzzle("p3-bait-the-clip");
    const bait = unitAt(state, 0, "meme-first-poster").instanceId;
    const wallId = () => unitAt(state, 1, "corp-unpaid-intern").instanceId;

    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: bait, target: { kind: "character", instanceId: wallId() } },
    ]);

    // first 3/2 clears the wall (Cinder has no bonus on Root: 3 into 3 exactly)
    const breakers = boardOf(state, 0).filter((c) => c!.cardId === "viral-drama-channel");
    state = play(state, () => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: breakers[0]!.instanceId,
        target: { kind: "character", instanceId: wallId() },
      },
    ]);
    expect(boardOf(state, 1)).toHaveLength(0);

    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: breakers[1]!.instanceId, target: { kind: "leader", seat: 1 } },
    ]);
    expect(state.players[1].leaderHealth).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("fails if a 3/2 walks into the Reaction instead of the 2/1", () => {
    let state = openPuzzle("p3-bait-the-clip");
    const breakers = boardOf(state, 0).filter((c) => c!.cardId === "viral-drama-channel");
    const wallId = () => unitAt(state, 1, "corp-unpaid-intern").instanceId;

    // the 3/2 dies to the Reaction and its attack fizzles, so the SECOND 3/2
    // has to clear the wall — leaving only the 2/1 for a 3-health leader
    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: breakers[0]!.instanceId, target: { kind: "character", instanceId: wallId() } },
    ]);
    state = play(state, () => [
      { type: "attack", seat: 0, attackerInstanceId: breakers[1]!.instanceId, target: { kind: "character", instanceId: wallId() } },
    ]);
    expect(boardOf(state, 1)).toHaveLength(0);

    state = play(state, (s) => [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(s, 0, "meme-first-poster").instanceId,
        target: { kind: "leader", seat: 1 },
      },
    ]);
    expect(state.players[1].leaderHealth).toBe(1);
    expect(state.winner).toBeNull();
  });
});

/**
 * Scripted matches must replay.
 *
 * `replay()` rebuilds from `config` alone, so every scripted concession —
 * skipping the mulligan, dealing an authored board, bending balance — has to be
 * reachable from config or a stored record decodes into a different game. Each
 * of those paths was added separately during this work and none of them was
 * ever proven end to end.
 */
// ---------------------------------------------------------------------------
// P4–P6
// ---------------------------------------------------------------------------

describe("P4 — Terminally Devoted (Lethal / Obsession)", () => {
  const ROOKIE = "cosplay-hall-runway-rookie";
  const INTERN = "corp-unpaid-intern";

  const chant = (s: MatchState, onCardId: string): PlayerIntent => ({
    type: "playCard",
    seat: 0,
    instanceId: handCard(s, "idols-fan-chant").instanceId,
    targets: [{ kind: "character", instanceId: unitAt(s, 0, onCardId).instanceId }],
  });
  const fixate = (s: MatchState, onCardId: string): PlayerIntent => ({
    type: "useFixation",
    seat: 0,
    kind: "fixation",
    targets: [{ kind: "character", instanceId: unitAt(s, 0, onCardId).instanceId }],
  });
  const swing = (s: MatchState, cardId: string): PlayerIntent => ({
    type: "attack",
    seat: 0,
    attackerInstanceId: unitAt(s, 0, cardId).instanceId,
    target: { kind: "leader", seat: 1 },
  });

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p4-terminally-devoted");
    expect(state.players[0].hype).toBe(1);
    expect(state.players[0].obsession, "one short of a Fixation").toBe(2);
    expect(state.players[1].leaderHealth).toBe(8);
    expect(unitAt(state, 0, ROOKIE).keywords).toContain("parasocial");
    // the decoy has no attack, so unbuffed it can never contribute damage
    expect(unitAt(state, 0, INTERN).attack).toBe(0);
  });

  it("cannot open with the Fixation — the Obsession is not there yet", () => {
    const state = openPuzzle("p4-terminally-devoted");
    expect(() => applyIntent(state, content, fixate(state, ROOKIE))).toThrow();
  });

  it("is solved by supporting the Parasocial character first", () => {
    /**
     * Supporting a friendly character gives 1 Obsession, once per turn. Doing it
     * to the Parasocial one pays a second time — another Obsession AND +1/+1 —
     * which is both what makes the Fixation affordable and what makes the swing
     * lethal.
     */
    let state = openPuzzle("p4-terminally-devoted");
    state = play(state, (s) => [chant(s, ROOKIE)]);
    expect(state.players[0].obsession, "1 for the support, 1 for Parasocial").toBe(4);

    state = play(state, (s) => [fixate(s, ROOKIE), swing(s, ROOKIE)]);
    expect(state.players[1].leaderHealth).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("falls short if the support goes on the other character", () => {
    let state = openPuzzle("p4-terminally-devoted");
    state = play(state, (s) => [chant(s, INTERN)]);
    expect(state.players[0].obsession, "support only, no Parasocial").toBe(3);

    // the Fixation is affordable either way; the damage is what is missing
    state = play(state, (s) => [fixate(s, INTERN), swing(s, ROOKIE), swing(s, INTERN)]);
    expect(state.players[1].leaderHealth).toBeGreaterThan(0);
    expect(state.winner).toBeNull();
  });

  it("falls short if you skip the Fixation entirely", () => {
    const state = openPuzzle("p4-terminally-devoted");
    const stalled = play(state, (s) => [chant(s, ROOKIE), swing(s, ROOKIE)]);
    expect(stalled.players[1].leaderHealth).toBeGreaterThan(0);
  });
});

describe("P5 — Hold the Line (Survival / status timing)", () => {
  const WALL = "corp-unpaid-intern";

  /**
   * End the player's turn, then let the AI take its whole turn.
   *
   * The difficulty is read from the stage rather than named here, so this walks
   * the same opponent the route deals. A survival puzzle is decided entirely by
   * what the enemy does with its turn, which makes "which AI" part of the
   * puzzle's definition rather than a detail of the harness.
   */
  const stageOf = (id: string) => puzzles.stages.find((s) => s.id === id)!;
  function passToTheEnemy(state: MatchState): MatchState {
    const opponent = stageOf("p5-hold-the-line").opponent;
    const difficulty = (opponent.kind === "ai" ? opponent.difficulty : "beginner") as AiDifficulty;
    let current = applyIntent(state, content, { type: "endTurn", seat: 0 }).state;
    for (let guard = 0; guard < 40 && current.activeSeat === 1 && current.winner === null; guard++) {
      const decision = chooseIntent(current, content, 1, getAiProfile(difficulty));
      if (!decision) break;
      current = applyIntent(current, content, decision.intent).state;
    }
    return current;
  }

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p5-hold-the-line");
    expect(state.players[0].leaderHealth).toBe(3);
    const wall = unitAt(state, 0, WALL);
    expect(wall.health, "one burn from dead").toBe(1);
    expect(wall.keywords).toContain("spotlight");
    expect(wall.statuses.map((s) => s.id)).toContain("scorched");
    expect(boardOf(state, 1)).toHaveLength(1);
  });

  it("is survived by making the wall outlast its own Scorched", () => {
    /**
     * Scorched resolves at the end of YOUR turn, so an untreated 1-health wall
     * is already gone before the enemy declares anything. +2/+1 leaves it
     * standing after the burn, and Spotlight does the rest.
     */
    let state = openPuzzle("p5-hold-the-line");
    state = play(state, (s) => [
      {
        type: "playCard",
        seat: 0,
        instanceId: handCard(s, "idols-fan-chant").instanceId,
        targets: [{ kind: "character", instanceId: unitAt(s, 0, WALL).instanceId }],
      },
    ]);

    const after = passToTheEnemy(state);
    expect(after.players[0].leaderHealth, "the wall should have absorbed the swing").toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
    expect(after.turn, "surviving means reaching your next turn").toBeGreaterThanOrEqual(2);
  });

  it("dies if the wall is left to burn — which is the whole lesson", () => {
    const state = openPuzzle("p5-hold-the-line");
    const after = passToTheEnemy(state);
    expect(after.players[0].leaderHealth).toBeLessThanOrEqual(0);
    expect(after.winner).toBe(1);
  });
});

describe("P6 — Peaked Too Early (Economy / Trending)", () => {
  /**
   * `play` resolves its whole line against the state it was handed, so "the
   * poster" has to be addressed by which one — asking for the first matching
   * card twice names the same instance and the second play is refused.
   */
  const posters = (s: MatchState) => s.players[0].hand.filter((c) => c.cardId === "meme-first-poster");
  const poster = (s: MatchState, nth: number, slot: number): PlayerIntent => ({
    type: "playCard",
    seat: 0,
    instanceId: posters(s)[nth]!.instanceId,
    slot,
  });
  const frenzy = (s: MatchState): PlayerIntent => ({
    type: "playCard",
    seat: 0,
    instanceId: handCard(s, "viral-follower-frenzy").instanceId,
  });
  const swingAll = (s: MatchState): PlayerIntent[] =>
    boardOf(s, 0).map((unit) => ({
      type: "attack" as const,
      seat: 0 as const,
      attackerInstanceId: unit!.instanceId,
      target: { kind: "leader" as const, seat: 1 as const },
    }));

  const frenzyCost = (s: MatchState): number =>
    effectiveCost(s, content, 0, handCard(s, "viral-follower-frenzy"));

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p6-peaked-too-early");
    expect(state.players[0].hype).toBe(5);
    expect(state.players[1].leaderHealth).toBe(7);
    expect(frenzyCost(state), "full price until something else is played").toBe(5);
  });

  it("is solved by spending the cheap cards first", () => {
    /**
     * Two locks, both opened by the same move. Trending drops Follower Frenzy by
     * one per card already played, so two Raid bodies make it cost 3 instead of
     * 5 — and Rushwind only fires when it is NOT the first card of the turn,
     * which is what gives the Followers Raid so they can swing at all.
     */
    let state = openPuzzle("p6-peaked-too-early");
    state = play(state, (s) => [poster(s, 0, 0), poster(s, 1, 1)]);
    expect(frenzyCost(state), "Trending, two cards in").toBe(3);

    state = play(state, (s) => [frenzy(s)]);
    expect(boardOf(state, 0), "two posters and three Followers").toHaveLength(5);
    for (const unit of boardOf(state, 0)) {
      expect(unit!.keywords, `${unit!.cardId} should be able to attack`).toContain("raid");
    }

    state = play(state, swingAll);
    expect(state.players[1].leaderHealth).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("fails if Follower Frenzy goes first — full price, and the Followers cannot attack", () => {
    const state = play(openPuzzle("p6-peaked-too-early"), (s) => [frenzy(s)]);
    expect(state.players[0].hype, "full price, with nothing left").toBe(0);
    for (const unit of boardOf(state, 0)) {
      expect(unit!.keywords, "Rushwind never fired").not.toContain("raid");
    }

    // every Follower is summoning-sick, so not one of them can be declared
    for (const intent of swingAll(state)) {
      expect(() => applyIntent(state, content, intent), "a sick Follower attacked").toThrow();
    }
    // and the posters are now unaffordable, so nothing else can swing either
    expect(() => applyIntent(state, content, poster(state, 0, 3))).toThrow();
    expect(state.players[1].leaderHealth).toBe(7);
  });
});

describe("scripted matches replay exactly", () => {
  const puzzle = puzzles.stages[0]!;
  const scriptedConfig: MatchConfig = {
    seed: puzzle.seed,
    decks: [puzzles.decks[puzzle.decks[0]]!, puzzles.decks[puzzle.decks[1]]!],
    firstSeat: puzzle.firstSeat ?? 0,
    scenario: puzzle.scenario!,
  };

  it("reproduces a puzzle played to lethal", () => {
    const live = createMatch(scriptedConfig, content);
    const record = startRecord(live);
    beginScriptedMatch(live, content);

    // play P1's winning line, recording exactly what the driver would
    const line: PlayerIntent[] = [
      {
        type: "attack",
        seat: 0,
        attackerInstanceId: unitAt(live, 0, "meme-first-poster").instanceId,
        target: { kind: "character", instanceId: unitAt(live, 1, "corp-unpaid-intern").instanceId },
      },
    ];
    let state = live;
    for (const intent of line) {
      state = applyIntent(state, content, intent).state;
      recordIntent(record, intent);
    }
    const finisher: PlayerIntent = {
      type: "attack",
      seat: 0,
      attackerInstanceId: unitAt(state, 0, "viral-drama-channel").instanceId,
      target: { kind: "leader", seat: 1 },
    };
    state = applyIntent(state, content, finisher).state;
    recordIntent(record, finisher);
    expect(state.winner).toBe(0);

    const replayed = replay(record, content);
    expect(replayed.errors).toEqual([]);
    expect(stateHash(replayed.state)).toBe(stateHash(state));
    expect(replayed.state.winner).toBe(0);
  });

  it("reproduces a match played under bent balance", () => {
    // a boss modifier is only honest if its replay uses the same rulebook
    const config: MatchConfig = { ...scriptedConfig, balanceOverrides: { "hype.cap": 4 } };
    const bent = resolveMatchContent(content, config.balanceOverrides);
    const live = createMatch(config, bent);
    const record = startRecord(live);
    beginScriptedMatch(live, bent);

    expect(live.players[0].hypeMax).toBeLessThanOrEqual(4);

    // replay() resolves the overrides itself, from config
    const replayed = replay(record, content);
    expect(replayed.errors).toEqual([]);
    expect(stateHash(replayed.state)).toBe(stateHash(live));
  });

  it("decodes differently if the overrides are dropped — proving they are load-bearing", () => {
    // The Hype cap only bites once a turn starts, so both matches are opened.
    // This puzzle opens on turn 2, so a cap of 1 clamps what it would otherwise
    // grant — if replay() ignored the overrides, this is the divergence it
    // would silently produce.
    const config: MatchConfig = { ...scriptedConfig, balanceOverrides: { "hype.cap": 1 } };
    const bent = resolveMatchContent(content, config.balanceOverrides);
    const withOverride = createMatch(config, bent);
    beginScriptedMatch(withOverride, bent);

    const { balanceOverrides: _dropped, ...withoutOverride } = config;
    const plain = createMatch(withoutOverride as MatchConfig, content);
    beginScriptedMatch(plain, content);

    expect(withOverride.players[0].hype).toBe(1);
    expect(plain.players[0].hype).toBe(2);
    expect(stateHash(withOverride)).not.toBe(stateHash(plain));
  });
});
