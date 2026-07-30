/**
 * The stage runner drives a lesson: it advances beats, refuses what the beat
 * does not permit, and finishes when the objective holds. All of that is
 * testable without a browser, which is the point of keeping it out of the view.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { getEncounters } from "../src/engine/encounters";
import { createMatch, redact } from "../src/engine/state";
import { applyIntent, beginScriptedMatch } from "../src/engine/reducer";
import { StageRunner } from "../src/game/stageRunner";
import type { HudWidgetId } from "../src/engine/encounters";
import type { MatchConfig, MatchState, PlayerIntent } from "../src/engine/types";

const content = getContent();
const encounters = getEncounters(new Set(Object.keys(content.cards)));
const stage = encounters["tutorial"]!.stages[0]!;

function harness() {
  const spoken: string[] = [];
  const refusals: string[] = [];
  let revealed = new Set<HudWidgetId>();
  let completed = false;

  const runner = new StageRunner(stage, {
    say: async (line) => {
      spoken.push(line.text);
    },
    clearCoach: () => undefined,
    reveal: (widgets) => {
      revealed = new Set(widgets);
    },
    refused: (reason) => {
      refusals.push(reason);
    },
    complete: () => {
      completed = true;
    },
  });

  const config: MatchConfig = {
    seed: stage.seed,
    decks: [encounters["tutorial"]!.decks[stage.decks[0]]!, encounters["tutorial"]!.decks[stage.decks[1]]!],
    ...(stage.firstSeat !== undefined ? { firstSeat: stage.firstSeat } : {}),
    ...(stage.scenario ? { scenario: stage.scenario } : {}),
  };

  let state: MatchState = createMatch(config, content);
  beginScriptedMatch(state, content); // grants the first turn's Hype and draw
  const sync = () => runner.sync(redact(state, 0));
  const apply = (intent: PlayerIntent) => {
    state = applyIntent(state, content, intent).state;
  };

  return {
    runner,
    spoken,
    refusals,
    get revealed() {
      return revealed;
    },
    get completed() {
      return completed;
    },
    get state() {
      return state;
    },
    sync,
    apply,
  };
}

describe("stage runner", () => {
  it("opens on the first action beat, having spoken the intro", async () => {
    const h = harness();
    await h.sync();
    // the welcome beat is satisfied by being read, so the runner should already
    // be waiting on the first thing the player has to actually do
    expect(h.runner.beat?.id).toBe("play-first-poster");
    expect(h.spoken[0]).toContain("Hype");
    expect(h.revealed.has("hype")).toBe(true);
    expect(h.revealed.has("endTurn")).toBe(true);
  });

  it("refuses an intent the current beat does not permit", async () => {
    const h = harness();
    await h.sync();
    const gate = h.runner.gateFor();

    const refusal = gate({ type: "endTurn", seat: 0 });
    expect(refusal).toBeTruthy();
    expect(refusal).toContain("First Poster");
    expect(h.refusals).toHaveLength(1);
  });

  it("permits the intent the beat is asking for", async () => {
    const h = harness();
    await h.sync();
    const card = h.state.players[0].hand[0]!;
    expect(
      h.runner.gateFor()({ type: "playCard", seat: 0, instanceId: card.instanceId, targets: [] })
    ).toBeNull();
  });

  it("advances once the beat's condition is met", async () => {
    const h = harness();
    await h.sync();
    const card = h.state.players[0].hand[0]!;
    h.apply({ type: "playCard", seat: 0, instanceId: card.instanceId, targets: [], slot: 0 });
    await h.sync();

    expect(h.state.players[0].board.filter(Boolean)).toHaveLength(1);
    expect(h.runner.beat?.id).toBe("end-turn-1");
    // and the gate moves with it: playing is done, ending the turn is now the ask
    expect(h.runner.gateFor()({ type: "endTurn", seat: 0 })).toBeNull();
  });

  it("does not finish while the objective is unmet", async () => {
    const h = harness();
    await h.sync();
    expect(h.completed).toBe(false);
    expect(h.runner.isFinished).toBe(false);
  });

  it("will not skip the turn lessons just because the board is already full", async () => {
    // A stage teaches a sequence, not just an end state. Handing the player
    // three characters on turn one must NOT fast-forward past "end your turn":
    // the stage would complete without ever teaching the thing it exists for.
    const built = createMatch(
      {
        seed: stage.seed,
        decks: [encounters["tutorial"]!.decks[stage.decks[0]]!, encounters["tutorial"]!.decks[stage.decks[1]]!],
        firstSeat: 0,
        scenario: {
          ...stage.scenario,
          setup: [
            ...(stage.scenario?.setup ?? []),
            { op: "board", seat: 0, slot: 0, cardId: "meme-first-poster" },
            { op: "board", seat: 0, slot: 1, cardId: "algo-queue-jumper" },
            { op: "board", seat: 0, slot: 2, cardId: "goth-crypt-usher" },
          ],
        },
      },
      content
    );
    beginScriptedMatch(built, content);

    let completed = false;
    const runner = new StageRunner(stage, {
      say: async () => undefined,
      clearCoach: () => undefined,
      reveal: () => undefined,
      refused: () => undefined,
      complete: () => {
        completed = true;
      },
    });

    for (let i = 0; i < 10 && !completed; i++) await runner.sync(redact(built, 0));

    // it should be parked on the first turn-based beat, still teaching
    expect(completed).toBe(false);
    expect(runner.beat?.id).toBe("end-turn-1");
  });

  it("reveals each beat's widgets cumulatively", async () => {
    const h = harness();
    await h.sync();
    const afterFirst = new Set(h.revealed);
    const card = h.state.players[0].hand[0]!;
    h.apply({ type: "playCard", seat: 0, instanceId: card.instanceId, targets: [], slot: 0 });
    await h.sync();
    // nothing already revealed may disappear as the lesson moves on
    for (const widget of afterFirst) expect(h.revealed.has(widget)).toBe(true);
  });
});
