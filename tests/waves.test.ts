/**
 * Multi-wave encounters — reinforcements that arrive during a match.
 *
 * The whole feature is a promise about *timing*, so almost every test here is
 * about when a wave does and does not land. The two that are not are the two
 * things a wave must never quietly become: a card being played (it is dealt, so
 * nothing in it fires an on-play effect or counts toward the turn), and a board
 * the author did not write (a wave with nowhere to stand reports what it lost).
 *
 * Fixture cards throughout, so this suite says what the engine does rather than
 * what this month's card pool happens to look like.
 */

import { describe, expect, it } from "vitest";
import { fillDeck, fixtureContent, harness, placeCharacter, testCharacter, testLeader } from "./fixtures";
import type { CardDef, EncounterWave, MatchConfig, PlayerIntent } from "../src/engine/types";
import { boardOf } from "../src/engine/state";
import { canAttack } from "../src/engine/combat";
import { parseEncounter, EncounterError } from "../src/engine/encounters";
import { replay, stateHash } from "../src/engine/replay";

const CARDS: CardDef[] = [
  testLeader("lead-a"),
  testLeader("lead-b"),
  testCharacter("filler", 1, 1, 1),
  testCharacter("grunt", 1, 2, 2),
  testCharacter("second", 1, 3, 3),
  testCharacter("third", 1, 4, 4),
  /** A body that would announce itself loudly if a wave ever *played* it. */
  testCharacter("noisy", 1, 1, 1, {
    text: "On play: count that this was played.",
    effects: [{ trigger: "onPlay", text: "on play", ops: [{ op: "addCounter", key: "played", amount: 1 }] }],
  }),
];

const content = fixtureContent(CARDS);
const decks: [ReturnType<typeof fillDeck>, ReturnType<typeof fillDeck>] = [
  fillDeck("lead-a", ["filler"]),
  fillDeck("lead-b", ["filler"]),
];

const wave = (over: Partial<EncounterWave> = {}): EncounterWave => ({
  label: "reinforcements",
  seat: 1,
  onBoardClear: true,
  characters: [{ cardId: "grunt" }],
  ...over,
});

/** Seat 0 moves first, so `endTurn()` once hands the turn to the wave's seat. */
const setup = (waves: EncounterWave[]) =>
  harness({ content, decks, firstSeat: 0, scenario: { waves } });

const arrivals = (events: ReturnType<ReturnType<typeof setup>["endTurn"]>) =>
  events.filter((e): e is Extract<typeof e, { e: "waveArrived" }> => e.e === "waveArrived");

describe("wave arrival", () => {
  it("lands at the start of its seat's turn once that board is empty", () => {
    const h = setup([wave()]);
    h.begin();
    expect(boardOf(h.state, 1)).toHaveLength(0);

    const events = h.endTurn();
    const landed = arrivals(events);

    expect(landed).toHaveLength(1);
    expect(landed[0]!.index).toBe(1);
    expect(landed[0]!.total).toBe(1);
    expect(landed[0]!.label).toBe("reinforcements");
    expect(landed[0]!.seat).toBe(1);
    expect(boardOf(h.state, 1).map((c) => c.cardId)).toEqual(["grunt"]);
    expect(h.state.wavesLanded).toBe(1);
  });

  it("waits while that side still has somebody standing", () => {
    const h = setup([wave()]);
    h.begin();
    placeCharacter(h.state, content, 1, "filler");

    expect(arrivals(h.endTurn())).toHaveLength(0);
    expect(h.state.wavesLanded).toBe(0);
    // …and arrives on the next turn on which the board really is empty
    h.state.players[1].board[0] = null;
    h.endTurn();
    expect(arrivals(h.endTurn())).toHaveLength(1);
  });

  it("lands on schedule whatever the board looks like, when given a turn", () => {
    const h = setup([wave({ onBoardClear: false, onTurn: 2 })]);
    h.begin();
    placeCharacter(h.state, content, 1, "filler");

    // their first turn: scheduled for their second, so nothing yet
    expect(arrivals(h.endTurn())).toHaveLength(0);
    h.endTurn(); // back to seat 0
    // their second turn, board still occupied
    const landed = arrivals(h.endTurn());
    expect(landed).toHaveLength(1);
    expect(boardOf(h.state, 1).map((c) => c.cardId).sort()).toEqual(["filler", "grunt"]);
  });

  it("never lands on the other seat's turn", () => {
    const h = setup([wave({ seat: 1, onBoardClear: false, onTurn: 1 })]);
    h.begin();
    // seat 0 is active from the deal and their turn 1 already started; walking a
    // full round proves the wave ignored seat 0's turn and took seat 1's
    expect(h.state.wavesLanded).toBe(0);
    expect(arrivals(h.endTurn())[0]?.seat).toBe(1);
  });

  /**
   * Three waves, all cued from their first turn onwards. Written this way on
   * purpose: every cue is satisfied at once, so the only thing keeping them
   * apart is the rule that a wave is a queue and not a condition.
   */
  it("lands strictly in order, at most one per turn", () => {
    const h = setup([
      wave({ label: "one", onBoardClear: false, onTurn: 1, characters: [{ cardId: "grunt" }] }),
      wave({ label: "two", onBoardClear: false, onTurn: 1, characters: [{ cardId: "second" }] }),
      wave({ label: "three", onBoardClear: false, onTurn: 1, characters: [{ cardId: "third" }] }),
    ]);
    h.begin();

    const labels: string[] = [];
    for (let i = 0; i < 6 && h.state.wavesLanded < 3; i++) {
      const landed = arrivals(h.endTurn());
      /**
       * Asserted per turn rather than over the whole run, because the flattened
       * list is identical whether the waves arrived one at a time or all three
       * at once — a version of this test that only compared the totals passed
       * against a reducer deliberately broken to land every due wave together.
       */
      expect(landed.length, `${landed.length} waves landed in one turn`).toBeLessThanOrEqual(1);
      for (const event of landed) labels.push(`${event.label}:${event.index}/${event.total}`);
    }

    expect(labels).toEqual(["one:1/3", "two:2/3", "three:3/3"]);
    expect(boardOf(h.state, 1).map((c) => c.cardId).sort()).toEqual(["grunt", "second", "third"]);
  });

  it("stops once the last wave has landed", () => {
    const h = setup([wave({ onBoardClear: false, onTurn: 1 })]);
    h.begin();
    h.endTurn();
    expect(h.state.wavesLanded).toBe(1);

    for (let i = 0; i < 4; i++) expect(arrivals(h.endTurn())).toHaveLength(0);
    expect(h.state.wavesLanded).toBe(1);
    expect(boardOf(h.state, 1)).toHaveLength(1);
  });

  it("leaves a match with no waves completely alone", () => {
    const h = harness({ content, decks, firstSeat: 0 });
    h.begin();
    for (let i = 0; i < 4; i++) expect(arrivals(h.endTurn())).toHaveLength(0);
    expect(h.state.wavesLanded).toBe(0);
  });
});

describe("what a wave is made of", () => {
  it("arrives unable to attack, and says otherwise only when told to", () => {
    const h = setup([
      wave({
        onBoardClear: false,
        onTurn: 1,
        characters: [{ cardId: "grunt" }, { cardId: "second", ready: true }],
      }),
    ]);
    h.begin();
    h.endTurn();

    const board = boardOf(h.state, 1);
    const sick = board.find((c) => c.cardId === "grunt")!;
    const eager = board.find((c) => c.cardId === "second")!;
    expect(canAttack(h.state, content, sick)).toBe(false);
    expect(canAttack(h.state, content, eager)).toBe(true);
  });

  /**
   * The load-bearing distinction. A wave is DEALT: if it ever became "the
   * opponent plays three cards for free" then Rushwind, Afterparty, the
   * cards-played counters and every on-play effect in the game would all fire
   * off the encounter's furniture.
   */
  it("is dealt, not played — no on-play effect, no card counted", () => {
    const h = setup([wave({ onBoardClear: false, onTurn: 1, characters: [{ cardId: "noisy" }] })]);
    h.begin();
    h.endTurn();

    expect(boardOf(h.state, 1).map((c) => c.cardId)).toEqual(["noisy"]);
    expect(h.state.players[1].counters["played"]).toBeUndefined();
    expect(h.state.players[1].cardsPlayedThisTurn).toBe(0);
    expect(h.state.players[1].hype).toBe(h.state.players[1].hypeMax);
  });

  it("honours authored stats, including a body that arrives already damaged", () => {
    const h = setup([
      wave({
        onBoardClear: false,
        onTurn: 1,
        characters: [{ cardId: "grunt", attack: 7, health: 1, maxHealth: 9 }],
      }),
    ]);
    h.begin();
    h.endTurn();

    const dealt = boardOf(h.state, 1)[0]!;
    expect([dealt.attack, dealt.health, dealt.maxHealth]).toEqual([7, 1, 9]);
    // the printed card is still what it was — only this instance is bent
    expect([dealt.baseAttack, dealt.baseHealth]).toEqual([2, 2]);
  });

  it("counts what it could not fit rather than trimming quietly", () => {
    const h = setup([
      wave({
        onBoardClear: false,
        onTurn: 1,
        characters: [{ cardId: "grunt" }, { cardId: "second" }, { cardId: "third" }],
      }),
    ]);
    h.begin();
    // fill every slot but one
    const slots = content.balance.board.characterSlots;
    for (let slot = 0; slot < slots - 1; slot++) placeCharacter(h.state, content, 1, "filler", slot);

    const landed = arrivals(h.endTurn())[0]!;
    expect(landed.instances).toHaveLength(1);
    expect(landed.dropped).toBe(2);
    expect(boardOf(h.state, 1)).toHaveLength(slots);
  });
});

describe("waves survive re-simulation", () => {
  /**
   * Waves live in `MatchConfig` for exactly this reason. A replay rebuilds the
   * match from its config and replays the intent list, so reinforcements stored
   * anywhere else would simply not arrive the second time — and every intent
   * after the first missing wave would decode into a different game.
   */
  it("replays to an identical state", () => {
    const config: MatchConfig = {
      seed: 99,
      decks,
      firstSeat: 0,
      scenario: {
        waves: [
          { label: "one", seat: 1, onTurn: 1, characters: [{ cardId: "grunt" }] },
          { label: "two", seat: 1, onTurn: 3, characters: [{ cardId: "second" }] },
        ],
      },
    };
    const h = harness({ content, decks, firstSeat: 0, seed: 99, scenario: config.scenario });
    h.begin();

    const intents: PlayerIntent[] = [
      { type: "mulligan", seat: 0, replaceInstanceIds: [] },
      { type: "mulligan", seat: 1, replaceInstanceIds: [] },
    ];
    for (let i = 0; i < 6; i++) {
      const intent: PlayerIntent = { type: "endTurn", seat: h.state.activeSeat };
      intents.push(intent);
      h.play(intent);
    }

    expect(h.state.wavesLanded).toBe(2);
    const again = replay({ schemaVersion: 1, config, intents }, content);
    expect(again.errors).toEqual([]);
    expect(again.state.wavesLanded).toBe(2);
    expect(stateHash(again.state)).toBe(stateHash(h.state));
  });
});

describe("wave data is refused before it ships", () => {
  const stage = (waves: unknown[]): unknown => ({
    id: "e",
    kind: "story",
    decks: { d: { name: "d", leaderCardId: "lead-a", cards: [] } },
    stages: [
      {
        id: "s",
        title: "s",
        teaches: "s",
        decks: ["d", "d"],
        seed: 1,
        opponent: { kind: "idle" },
        beats: [],
        objective: { when: "matchEnded" },
        scenario: { waves },
      },
    ],
  });
  const ids = new Set(["lead-a", "grunt"]);

  /**
   * The one mistake this shape invites. A wave with no cue is not a runtime
   * error and not a crash: the encounter simply plays as though it had never
   * been written, which is the hardest kind of bug to notice.
   */
  it("refuses a wave that would never arrive", () => {
    expect(() =>
      parseEncounter(stage([{ label: "nobody comes", seat: 1, characters: [{ cardId: "grunt" }] }]), ids)
    ).toThrow(EncounterError);
  });

  it("refuses a wave with nobody in it", () => {
    expect(() => parseEncounter(stage([{ label: "empty", seat: 1, onTurn: 1, characters: [] }]), ids)).toThrow(
      EncounterError
    );
  });

  it("names the unknown card rather than arriving one body short", () => {
    let message = "";
    try {
      parseEncounter(stage([{ label: "one", seat: 1, onTurn: 1, characters: [{ cardId: "grnut" }] }]), ids);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("grnut");
    expect(message).toContain("wave 1");
  });

  it("accepts a wave that is written correctly", () => {
    expect(() =>
      parseEncounter(stage([{ label: "one", seat: 1, onTurn: 1, characters: [{ cardId: "grunt" }] }]), ids)
    ).not.toThrow();
  });
});
