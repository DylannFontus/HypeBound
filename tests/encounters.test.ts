/**
 * Encounter data is content, so it gets the same treatment card data does:
 * every shipped file must parse, cross-check against real cards, and actually
 * deal the board its script assumes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { getEncounters, conditionMet, intentAllowed, parseEncounter, EncounterError } from "../src/engine/encounters";
import { createMatch, redact } from "../src/engine/state";
import {
  CLAIM_LEDGER_LIMIT,
  TUTORIAL_COMPLETE_KEY,
  claimOnce,
  getProfile,
  grantAllTutorialRewards,
  grantTutorialCompletion,
  grantTutorialReward,
  profileStore,
  tutorialComplete,
} from "../src/save/profile";
import { tutorialConfig } from "../src/game/progression/data";
import { cosmeticById } from "../src/game/cosmetics";
import { beginScriptedMatch } from "../src/engine/reducer";
import type { MatchConfig } from "../src/engine/types";

const content = getContent();
const cardIds = new Set(Object.keys(content.cards));
const encounters = getEncounters(cardIds);

describe("encounter data", () => {
  it("parses every shipped encounter", () => {
    expect(Object.keys(encounters).length).toBeGreaterThan(0);
    expect(encounters["tutorial"]).toBeDefined();
  });

  it("references only real cards", () => {
    for (const encounter of Object.values(encounters)) {
      for (const deck of Object.values(encounter.decks)) {
        expect(cardIds.has(deck.leaderCardId)).toBe(true);
        for (const cardId of deck.cards) expect(cardIds.has(cardId)).toBe(true);
      }
    }
  });

  it("gives every stage a reachable finish", () => {
    for (const encounter of Object.values(encounters)) {
      for (const stage of encounter.stages) {
        expect(stage.beats.length > 0 || stage.objective).toBeTruthy();
        // a gated beat with an empty allow-list must be dialogue-only, or the
        // player is locked out with no way to satisfy it
        for (const beat of stage.beats) {
          if (beat.allow?.length === 0) {
            expect(beat.until.when, `${stage.id}/${beat.id} allows nothing`).toBe("acknowledged");
          }
        }
      }
    }
  });

  it("rejects a scenario whose authored deck order the mulligan would reshuffle", () => {
    expect(() =>
      parseEncounter(
        {
          id: "bad",
          kind: "tutorial",
          decks: { d: { name: "d", leaderCardId: "tut-practice-bot", cards: ["meme-first-poster"] } },
          stages: [
            {
              id: "s",
              title: "s",
              teaches: "s",
              decks: ["d", "d"],
              seed: 1,
              opponent: { kind: "idle" },
              scenario: { shuffle: false },
              beats: [{ id: "b", until: { when: "acknowledged" } }],
            },
          ],
        },
        cardIds
      )
    ).toThrow(EncounterError);
  });

  it("rejects a stage naming a deck that does not exist", () => {
    expect(() =>
      parseEncounter(
        {
          id: "bad2",
          kind: "tutorial",
          decks: { d: { name: "d", leaderCardId: "tut-practice-bot", cards: ["meme-first-poster"] } },
          stages: [
            {
              id: "s",
              title: "s",
              teaches: "s",
              decks: ["d", "nope"],
              seed: 1,
              opponent: { kind: "idle" },
              beats: [{ id: "b", until: { when: "acknowledged" } }],
            },
          ],
        },
        cardIds
      )
    ).toThrow(/unknown deck nope/);
  });
});

describe("tutorial stage 1 deals what its script assumes", () => {
  const encounter = encounters["tutorial"]!;
  const stage = encounter.stages[0]!;
  const config: MatchConfig = {
    seed: stage.seed,
    decks: [encounter.decks[stage.decks[0]]!, encounter.decks[stage.decks[1]]!],
    ...(stage.firstSeat !== undefined ? { firstSeat: stage.firstSeat } : {}),
    ...(stage.scenario ? { scenario: stage.scenario } : {}),
  };

  it("deals the scripted hand and no Borrowed Clout", () => {
    const state = createMatch(config, content);
    expect(state.activeSeat).toBe(0);
    expect(state.players[0].hand.map((c) => c.cardId)).toEqual(["meme-first-poster"]);
    expect(state.players[1].hand.map((c) => c.cardId)).not.toContain("token-borrowed-clout");
  });

  it("opens into the main phase with Hype to spend", () => {
    // createMatch only deals; beginning the match is what grants Hype and the
    // opening draw, so a stage that skips the mulligan still has to be opened
    const state = createMatch(config, content);
    expect(state.phase).toBe("mulligan");

    beginScriptedMatch(state, content);
    expect(state.phase).toBe("main");
    // the whole point of stage 1 is spending Hype; starting on zero would make
    // its very first instruction impossible
    expect(state.players[0].hype).toBeGreaterThan(0);
  });

  it("queues the follow-up draws in the authored order", () => {
    const state = createMatch(config, content);
    expect(state.players[0].deck.map((c) => c.cardId)).toEqual([
      "algo-queue-jumper",
      "goth-crypt-usher",
      "viral-drama-channel",
    ]);
  });

  it("is not satisfied at the start and is satisfied with three characters", () => {
    const state = createMatch(config, content);
    const view = redact(state, 0);
    expect(conditionMet(stage.objective!, view, false)).toBe(false);

    const built = createMatch(
      {
        ...config,
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
    expect(conditionMet(stage.objective!, redact(built, 0), false)).toBe(true);
  });
});

describe("gate hardening", () => {
  const beat = [{ intent: "playCard" as const }];

  it("never gates concede — it is the only way out of a lesson", () => {
    // a beat that permits only playing a card must still let the player leave
    expect(intentAllowed({ type: "concede", seat: 0 }, beat)).toBe(false);
    // ...which is why StageRunner.gateFor short-circuits it before asking here
  });

  it("honours a cardId restriction instead of permitting every card", () => {
    const only = [{ intent: "playCard" as const, cardId: "meme-first-poster" }];
    const play = (instanceId: string) => ({ type: "playCard" as const, seat: 0 as const, instanceId, targets: [] });
    const lookup = (id: string) => (id === "c1" ? "meme-first-poster" : "algo-queue-jumper");

    expect(intentAllowed(play("c1"), only, lookup)).toBe(true);
    expect(intentAllowed(play("c2"), only, lookup)).toBe(false);
  });

  it("refuses a named card when it cannot resolve the id, rather than allowing anything", () => {
    // failing open would silently bypass a puzzle's intended solution
    const only = [{ intent: "playCard" as const, cardId: "meme-first-poster" }];
    expect(
      intentAllowed({ type: "playCard", seat: 0, instanceId: "c1", targets: [] }, only)
    ).toBe(false);
  });

  it("rejects a stage whose authored Hype the scripted opening would discard", () => {
    expect(() =>
      parseEncounter(
        {
          id: "bad3",
          kind: "puzzle",
          decks: { d: { name: "d", leaderCardId: "tut-practice-bot", cards: ["meme-first-poster"] } },
          stages: [
            {
              id: "s",
              title: "s",
              teaches: "s",
              decks: ["d", "d"],
              seed: 1,
              opponent: { kind: "idle" },
              scenario: { mulligan: "none", setup: [{ op: "hype", seat: 0, value: 8 }] },
              beats: [{ id: "b", until: { when: "acknowledged" } }],
            },
          ],
        },
        cardIds
      )
    ).toThrow(/hype/);
  });
});

describe("tutorial rewards", () => {
  const stageIds = encounters["tutorial"]!.stages.map((s) => s.id);

  beforeEach(() => {
    profileStore.update((draft) => {
      draft.tutorialStagesRewarded = [];
      draft.clout = 0;
      // the completion package is keyed into the claim ledger and pays Drops and
      // cosmetics, so those have to reset too or the first test to finish the
      // tutorial silently disables the rest
      draft.claimedRewards = [];
      draft.pendingDrops = 0;
      draft.cosmetics.owned = [];
    });
  });

  it("pays a stage once", () => {
    expect(grantTutorialReward(stageIds[0]!, 100)).toEqual({ clout: 100 });
    expect(getProfile().clout).toBe(100);
  });

  it("never pays the same stage twice, however often it is replayed", () => {
    // stages are replayable by design, so an unguarded grant would make the
    // tutorial the best Clout farm in the game
    grantTutorialReward(stageIds[0]!, 100);
    for (let i = 0; i < 5; i++) {
      expect(grantTutorialReward(stageIds[0]!, 100)).toBeNull();
    }
    expect(getProfile().clout).toBe(100);
  });

  it("reports completion only once every stage has paid", () => {
    expect(tutorialComplete(stageIds)).toBe(false);
    for (const id of stageIds.slice(0, -1)) grantTutorialReward(id, 100);
    expect(tutorialComplete(stageIds)).toBe(false);
    grantTutorialReward(stageIds[stageIds.length - 1]!, 100);
    expect(tutorialComplete(stageIds)).toBe(true);
  });

  it("pays a skipper exactly what playing through pays", () => {
    // binding economy rule: skipping the tutorial is never punished
    const skipped = grantAllTutorialRewards(stageIds, 100, content);
    expect(skipped).toBe(stageIds.length * 100);
    expect(tutorialComplete(stageIds)).toBe(true);
    // and a skipper who then plays a stage anyway is not paid again
    expect(grantTutorialReward(stageIds[0]!, 100)).toBeNull();
    // the completion package too, or "never punished" would pay six sevenths
    expect(getProfile().pendingDrops).toBe(tutorialConfig().completion.drops);
  });

  /**
   * §2.3's completion package: card packs, the "Day One" card back and the
   * title **Fresh Poster**.
   *
   * It used to be a paragraph in `profile.ts` explaining why none of it could
   * be paid — there were no screens for a pack, a card back or a title. All
   * three exist now, so the reason expired and the reward did not.
   */
  it("pays §2.3's completion package once the last stage is done", () => {
    const config = tutorialConfig();
    expect(grantTutorialCompletion(content, stageIds), "paid before the tutorial was finished").toBeNull();

    for (const id of stageIds) grantTutorialReward(id, config.cloutPerStage);
    const paid = grantTutorialCompletion(content, stageIds);
    expect(paid).not.toBeNull();
    expect(paid!.drops).toBe(config.completion.drops);
    expect(paid!.cosmetics).toEqual(config.completion.cosmetics);
    expect(getProfile().pendingDrops).toBe(config.completion.drops);
    for (const id of config.completion.cosmetics) {
      expect(getProfile().cosmetics.owned, id).toContain(id);
      expect(cosmeticById(content, id), `${id} resolves to nothing`).not.toBeNull();
    }
  });

  it("never pays the completion package twice, even after the claim ledger trims", () => {
    for (const id of stageIds) grantTutorialReward(id, 100);
    expect(grantTutorialCompletion(content, stageIds)).not.toBeNull();
    expect(grantTutorialCompletion(content, stageIds)).toBeNull();

    /**
     * The trap the Grand Tour's reward fell into: the claim ledger trims at 400
     * entries, so a key that is not marked permanent ages off the front and the
     * reward becomes claimable again.
     */
    for (let i = 0; i < CLAIM_LEDGER_LIMIT + 50; i++) claimOnce(`filler:${i}`, 1);
    expect(getProfile().claimedRewards).toContain(TUTORIAL_COMPLETE_KEY);
    expect(grantTutorialCompletion(content, stageIds)).toBeNull();
  });
});

describe("beat gating", () => {
  it("permits everything when a beat sets no allow-list", () => {
    expect(intentAllowed({ type: "endTurn", seat: 0 }, undefined)).toBe(true);
  });

  it("permits nothing when the allow-list is empty", () => {
    expect(intentAllowed({ type: "endTurn", seat: 0 }, [])).toBe(false);
  });

  it("gates by intent type", () => {
    const onlyPlay = [{ intent: "playCard" as const }];
    expect(intentAllowed({ type: "endTurn", seat: 0 }, onlyPlay)).toBe(false);
    expect(
      intentAllowed({ type: "playCard", seat: 0, instanceId: "c1", targets: [] }, onlyPlay)
    ).toBe(true);
  });

  it("gates an attack by what is being attacked", () => {
    const onlyLeader = [{ intent: "attack" as const, target: "leader" as const }];
    expect(
      intentAllowed(
        { type: "attack", seat: 0, attackerInstanceId: "u1", target: { kind: "leader", seat: 1 } },
        onlyLeader
      )
    ).toBe(true);
    expect(
      intentAllowed(
        { type: "attack", seat: 0, attackerInstanceId: "u1", target: { kind: "character", instanceId: "u2" } },
        onlyLeader
      )
    ).toBe(false);
  });
});
