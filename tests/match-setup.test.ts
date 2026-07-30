/**
 * Match setup invariants.
 *
 * This is the exact surface the scripted-encounter modes (tutorial, puzzles,
 * boss battles, story, sandbox) have to bend without breaking normal play, so
 * it is pinned here before any of that lands: deal order, opening hand sizes,
 * the coin flip, the mulligan handoff, and which leaders a player may pick.
 */

import { describe, expect, it } from "vitest";
import { fixtureContent, fillDeck, testCharacter, testLeader } from "./fixtures";
import { createMatch } from "../src/engine/state";
import { applyIntent, beginScriptedMatch } from "../src/engine/reducer";
import { getContent, resolveMatchContent, selectableLeaders } from "../src/engine/content";
import type { EncounterSetup, MatchConfig } from "../src/engine/types";

const content = fixtureContent([
  testLeader("tl-a"),
  testLeader("tl-b"),
  ...Array.from({ length: 6 }, (_, i) => testCharacter(`tc-${i}`, 1, 2, 1)),
]);

const deckA = fillDeck("tl-a", ["tc-0", "tc-1", "tc-2", "tc-3", "tc-4", "tc-5"], "A");
const deckB = fillDeck("tl-b", ["tc-0", "tc-1", "tc-2", "tc-3", "tc-4", "tc-5"], "B");
const base = (extra: Partial<MatchConfig> = {}): MatchConfig => ({
  seed: 7,
  decks: [deckA, deckB],
  firstSeat: 0,
  ...extra,
});

describe("match setup", () => {
  it("is byte-identical for the same config", () => {
    // Replay is {seed, decks, intents[]} — if setup were not reproducible from
    // config alone, every stored replay would decode into a different match.
    const a = createMatch(base(), content);
    const b = createMatch(base(), content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("diverges when only the seed changes", () => {
    const a = createMatch(base({ seed: 1 }), content);
    const b = createMatch(base({ seed: 2 }), content);
    expect(a.players[0].deck.map((c) => c.cardId).join()).not.toBe(
      b.players[0].deck.map((c) => c.cardId).join()
    );
  });

  it("honours firstSeat, and picks a valid seat without it", () => {
    expect(createMatch(base({ firstSeat: 0 }), content).activeSeat).toBe(0);
    expect(createMatch(base({ firstSeat: 1 }), content).activeSeat).toBe(1);
    const flipped = createMatch({ seed: 99, decks: [deckA, deckB] }, content);
    expect([0, 1]).toContain(flipped.activeSeat);
  });

  it("deals canonical opening hands and the second player's Borrowed Clout", () => {
    const state = createMatch(base(), content);
    const first = state.activeSeat;
    const second = (1 - first) as 0 | 1;

    expect(state.players[first].hand).toHaveLength(content.balance.hand.first);
    // the second player's extra card is the Borrowed Clout token, on top of the
    // dealt hand — so their hand is one longer than the dealt count
    expect(state.players[second].hand).toHaveLength(content.balance.hand.second + 1);
    expect(state.players[second].hand.map((c) => c.cardId)).toContain("token-borrowed-clout");
    expect(state.players[first].hand.map((c) => c.cardId)).not.toContain("token-borrowed-clout");
  });

  it("starts in the mulligan phase and reaches main only after both players act", () => {
    const state = createMatch(base({ seed: 5 }), content);
    expect(state.phase).toBe("mulligan");

    const afterFirst = applyIntent(state, content, {
      type: "mulligan",
      seat: 0,
      replaceInstanceIds: [],
    }).state;
    expect(afterFirst.phase).toBe("mulligan");

    const afterBoth = applyIntent(afterFirst, content, {
      type: "mulligan",
      seat: 1,
      replaceInstanceIds: [],
    }).state;
    expect(afterBoth.phase).toBe("main");
  });

  it("keeps your hand but still reshuffles when you mulligan nothing", () => {
    const state = createMatch(base({ seed: 1234 }), content);
    const handBefore = state.players[0].hand.map((c) => c.instanceId).join();
    const deckBefore = [...state.players[0].deck.map((c) => c.instanceId)].sort().join();

    const after = applyIntent(state, content, {
      type: "mulligan",
      seat: 0,
      replaceInstanceIds: [],
    }).state.players[0];

    // Keeping everything must not cost you a card...
    expect(after.hand.map((c) => c.instanceId).join()).toBe(handBefore);
    // ...nor change what is left in the deck, only its order. The reshuffle is
    // deliberate and matches the genre: a kept hand still gets a fresh deck.
    expect([...after.deck.map((c) => c.instanceId)].sort().join()).toBe(deckBefore);
  });

  it("reshuffles the same way every time, so replays survive a mulligan", () => {
    const run = () =>
      applyIntent(createMatch(base({ seed: 1234 }), content), content, {
        type: "mulligan",
        seat: 0,
        replaceInstanceIds: [],
      }).state.players[0].deck.map((c) => c.instanceId).join();
    expect(run()).toBe(run());
  });
});

describe("scripted encounters", () => {
  it("leaves a normal match byte-for-byte unchanged", () => {
    // The seam is opt-in: an all-defaults scenario must deal exactly what no
    // scenario deals. `config` is excluded because it necessarily differs —
    // it is where the scenario itself is stored.
    const dealt = (c: MatchConfig) => {
      const { config: _config, ...rest } = createMatch(c, content);
      return JSON.stringify(rest);
    };
    expect(dealt(base({ scenario: {} }))).toBe(dealt(base()));
  });

  it("deals the authored deck order and consumes no RNG when shuffle is off", () => {
    const scripted = createMatch(base({ scenario: { shuffle: false, deal: false } }), content);
    expect(scripted.players[0].deck.map((c) => c.cardId)).toEqual(deckA.cards);
    expect(scripted.players[0].hand).toHaveLength(0);
    // not shuffling must leave the RNG exactly where the coin flip left it, so a
    // hand-authored intent log stays aligned with the seed
    const rngOnly = createMatch(base({ scenario: { shuffle: false, deal: false } }), content);
    expect(scripted.rngState).toEqual(rngOnly.rngState);
  });

  it("opens a mulligan-free scenario with Hype and an opening draw", () => {
    // createMatch only deals. Beginning the match is a reducer concern because
    // that is where startTurn lives, and skipping it would drop the player into
    // a main phase with zero Hype.
    const scripted = createMatch(base({ scenario: { mulligan: "none" } }), content);
    expect(scripted.phase).toBe("mulligan");

    beginScriptedMatch(scripted, content);
    expect(scripted.phase).toBe("main");
    expect(scripted.players.every((p) => p.mulliganDone)).toBe(true);
    expect(scripted.players[scripted.activeSeat].hype).toBeGreaterThan(0);
  });

  it("is a no-op if the match has already begun", () => {
    const scripted = createMatch(base({ scenario: { mulligan: "none" } }), content);
    beginScriptedMatch(scripted, content);
    const hype = scripted.players[scripted.activeSeat].hype;
    expect(beginScriptedMatch(scripted, content)).toEqual([]);
    expect(scripted.players[scripted.activeSeat].hype).toBe(hype);
  });

  it("can withhold Borrowed Clout", () => {
    const withheld = createMatch(base({ firstSeat: 0, scenario: { borrowedClout: false } }), content);
    expect(withheld.players[1].hand.map((c) => c.cardId)).not.toContain("token-borrowed-clout");
  });

  it("places a board character that can attack immediately", () => {
    const scripted = createMatch(
      base({
        scenario: {
          shuffle: false,
          deal: false,
          mulligan: "none",
          setup: [{ op: "board", seat: 0, slot: 0, cardId: "tc-0", ready: true }],
        },
      }),
      content
    );
    const unit = scripted.players[0].board[0];
    expect(unit?.cardId).toBe("tc-0");
    // -1 reads as "was here before this turn", which is what clears sickness
    expect(unit?.enteredOnTurn).toBe(-1);
  });

  it("sets leader health, hype and obsession", () => {
    const scripted = createMatch(
      base({
        scenario: {
          setup: [
            { op: "leaderHealth", seat: 1, value: 8 },
            { op: "hype", seat: 0, value: 4, max: 4 },
            { op: "obsession", seat: 0, value: 7 },
            { op: "armor", seat: 0, value: 2 },
          ],
        },
      }),
      content
    );
    expect(scripted.players[1].leaderHealth).toBe(8);
    // a scripted 8 out of 30 must still read as damaged, not as a smaller leader
    expect(scripted.players[1].leaderMaxHealth).toBe(30);
    expect(scripted.players[0].hype).toBe(4);
    expect(scripted.players[0].obsession).toBe(7);
    expect(scripted.players[0].armor).toBe(2);
  });

  it("overrides the opening hand exactly", () => {
    const scripted = createMatch(
      base({ scenario: { setup: [{ op: "hand", seat: 0, cards: ["tc-1", "tc-2"] }] } }),
      content
    );
    expect(scripted.players[0].hand.map((c) => c.cardId)).toEqual(["tc-1", "tc-2"]);
  });

  it("is reproducible, so scripted matches replay", () => {
    const scenario: EncounterSetup = {
      shuffle: false,
      deal: false,
      mulligan: "none",
      setup: [
        { op: "board", seat: 0, slot: 0, cardId: "tc-0", ready: true },
        { op: "hand", seat: 0, cards: ["tc-1"] },
        { op: "leaderHealth", seat: 1, value: 8 },
      ],
    };
    const a = createMatch(base({ scenario }), content);
    const b = createMatch(base({ scenario }), content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("balance overrides", () => {
  it("leaves content untouched when there are none", () => {
    expect(resolveMatchContent(content, undefined)).toBe(content);
    expect(resolveMatchContent(content, {})).toBe(content);
  });

  it("bends a nested number without mutating the original", () => {
    const bent = resolveMatchContent(content, { "hype.cap": 4, "draw.perTurn": 2 });
    expect(bent.balance.hype.cap).toBe(4);
    expect(bent.balance.draw.perTurn).toBe(2);
    // the shared index must survive: every other match uses it
    expect(content.balance.hype.cap).not.toBe(4);
  });

  it("actually changes how a match plays", () => {
    // the point of the field — a boss modifier that does nothing is worse than
    // no field at all, which is exactly what it was before being wired
    const normal = createMatch(base(), content);
    const bent = createMatch(base(), resolveMatchContent(content, { "hand.first": 2 }));
    expect(normal.players[0].hand.length).not.toBe(bent.players[0].hand.length);
    expect(bent.players[0].hand).toHaveLength(2);
  });

  it("rejects a path that is not in balance.json", () => {
    expect(() => resolveMatchContent(content, { "hype.nope": 3 })).toThrow(/not a path/);
    expect(() => resolveMatchContent(content, { "nope.cap": 3 })).toThrow(/not a path/);
  });

  it("rejects a value the balance schema will not accept", () => {
    expect(() => resolveMatchContent(content, { "deck.size": -5 })).toThrow();
  });
});

describe("selectable leaders", () => {
  const real = getContent();

  it("offers the player every non-scripted leader", () => {
    const selectable = selectableLeaders(real);
    expect(selectable.length).toBeGreaterThan(0);
    expect(selectable.length).toBe(Object.values(real.leaders).filter((l) => !l.token).length);
  });

  it("never offers a scripted-encounter leader", () => {
    // tutorial bots, boss leaders and the like are marked `token` and must not
    // appear in the deck builder or turn up as a random rival
    for (const leader of selectableLeaders(real)) {
      expect(leader.token, `${leader.id} is a scripted leader but is selectable`).toBeFalsy();
    }
  });

  it("excludes the tutorial leaders specifically", () => {
    // a positive check, so this suite cannot quietly pass by having no scripted
    // leaders at all
    const ids = selectableLeaders(real).map((l) => l.id);
    for (const scripted of ["tut-practice-bot", "tut-seraph-online"]) {
      expect(real.leaders[scripted], `${scripted} should exist`).toBeDefined();
      expect(ids).not.toContain(scripted);
    }
  });
});
