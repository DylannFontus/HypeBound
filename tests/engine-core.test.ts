import { describe, expect, it } from "vitest";
import { getContent, selectableLeaders } from "../src/engine/content";
import { autoBuildDeck, validateDeck, legalCardPool, legalCurrentsFor } from "../src/engine/deck";
import { createMatch, redact, boardOf } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { enumerateLegalIntents } from "../src/engine/intents";
import { replay, startRecord, recordIntent, stateHash } from "../src/engine/replay";
import { nextInt, seedRng } from "../src/engine/rng";
import type { MatchConfig, MatchState, PlayerIntent } from "../src/engine/types";

const content = getContent();

function testConfig(seed = 12345): MatchConfig {
  return {
    seed,
    decks: [autoBuildDeck(content, "idols-lumi-starcall", "P1"), autoBuildDeck(content, "idols-dj-kilowatt", "P2")],
    firstSeat: 0,
  };
}

/** Play a full match with pseudo-random legal intents; returns the record. */
function playRandomMatch(seed: number, maxIntents = 600) {
  const config = testConfig(seed);
  let state = createMatch(config, content);
  const record = startRecord(state);
  const rng = seedRng(seed ^ 0x5f3759df);

  const submit = (intent: PlayerIntent): void => {
    recordIntent(record, intent);
    state = applyIntent(state, content, intent).state;
  };

  submit({ type: "mulligan", seat: 0, replaceInstanceIds: [] });
  submit({ type: "mulligan", seat: 1, replaceInstanceIds: [] });

  let count = 0;
  while (state.winner === null && count < maxIntents) {
    const seat = state.activeSeat;
    const legal = enumerateLegalIntents(state, content, seat);
    if (legal.length === 0) break;
    // bias away from endTurn so turns actually do something
    const nonEnd = legal.filter((i) => i.type !== "endTurn");
    const pool = nonEnd.length > 0 && nextInt(rng, 100) < 78 ? nonEnd : legal;
    const intent = pool[nextInt(rng, pool.length)]!;
    submit(intent);
    count++;
  }
  return { state, record, intents: count };
}

/**
 * Leaders whose legal card pool is too small to build a deck from at all.
 *
 * Empty, and asserted to stay that way. It was five: every faction ships one
 * dual-Current leader and one **pure** leader whose payoff is Perfect Resonance
 * (`factions/03-viral-influencers.md` §8.1 "Follower Flood, pure Gale" and its
 * four siblings), and five of those single Currents did not hold thirty cards'
 * worth of legal cards. Sterling Bright's entire pool was nine, eighteen with
 * copies, so no human could complete a deck for him either.
 *
 * The list is kept rather than deleted because it is the shape that makes the
 * check honest in both directions: a leader that regresses fails by appearing,
 * and nobody can quietly excuse one by adding a name without the second test
 * agreeing that the pool really is too small.
 */
const POOL_TOO_SMALL_TO_BUILD: string[] = [];

describe("deck construction", () => {
  it("auto-builds a legal 30-card deck", () => {
    const deck = autoBuildDeck(content, "idols-lumi-starcall");
    expect(deck.cards).toHaveLength(30);
    expect(validateDeck(content, deck)).toEqual([]);
  });

  /**
   * Every leader, not one.
   *
   * The test above has passed since the engine shipped while eight of the twenty
   * playable leaders could not be built for — it asks `idols-lumi-starcall`, one
   * of the healthy ones, and never asks about the other nineteen. Three of those
   * eight were a builder bug (Prism cards were dropped even for a leader whose
   * own Current is Prism, so Cosplay Champions were built from twelve of their
   * eighteen cards); the rest are the pool gap named above.
   */
  it("auto-builds a legal 30-card deck for every playable leader", () => {
    for (const leader of selectableLeaders(content)) {
      if (POOL_TOO_SMALL_TO_BUILD.includes(leader.id)) continue;
      const deck = autoBuildDeck(content, leader.id);
      expect(deck.cards, `${leader.id} built ${deck.cards.length} cards`).toHaveLength(30);
      expect(validateDeck(content, deck).map((p) => p.message), leader.id).toEqual([]);
    }
  });

  it("names exactly the leaders whose pool is too small to fill a deck", () => {
    const balance = content.balance.deck;
    const unbuildable = selectableLeaders(content)
      .filter((leader) => {
        // the most copies the whole legal pool could ever contribute
        const capacity = legalCardPool(content, leader)
          .filter((card) => card.current !== "prism" || legalCurrentsFor(leader).includes("prism"))
          .reduce((n, card) => n + (card.rarity === "legendary" ? balance.maxCopiesLegendary : balance.maxCopies), 0);
        return capacity < balance.size;
      })
      .map((leader) => leader.id)
      .sort();

    expect(unbuildable).toEqual([...POOL_TOO_SMALL_TO_BUILD].sort());
  });

  it("builds a Prism-native leader from its Prism cards, not around them", () => {
    // Cosplay Champions print 11 Tide and 7 Prism; without the Prism half there
    // are not enough cards in the faction to reach thirty
    const deck = autoBuildDeck(content, "cosplay-vera-foamhammer");
    expect(deck.cards).toHaveLength(30);
    expect(validateDeck(content, deck)).toEqual([]);
    const prism = deck.cards.filter((id) => content.cards[id]?.current === "prism");
    expect(prism.length, "a Prism leader's own Current is not a splash").toBeGreaterThan(balanceSplashLimit());
  });

  it("still limits Prism to a splash for a leader it is not native to", () => {
    for (const leaderId of ["idols-lumi-starcall", "goth-leader-morvina-vane", "after-leader-dj-last-call"]) {
      const deck = autoBuildDeck(content, leaderId);
      const prism = deck.cards.filter((id) => content.cards[id]?.current === "prism");
      expect(prism.length, `${leaderId} splashed ${prism.length} Prism`).toBeLessThanOrEqual(balanceSplashLimit());
    }
  });

  const balanceSplashLimit = (): number => content.balance.deck.prismSplashLimit;

  it("rejects an oversized copy count", () => {
    const deck = autoBuildDeck(content, "idols-lumi-starcall");
    deck.cards = new Array(30).fill("idols-fan-chant");
    const problems = validateDeck(content, deck);
    expect(problems.some((p) => p.code === "tooManyCopies")).toBe(true);
  });

  it("rejects cards from another faction", () => {
    const deck = autoBuildDeck(content, "idols-lumi-starcall");
    deck.cards[0] = "neutral-lurker"; // neutral Veil card: legal faction, illegal Current
    const problems = validateDeck(content, deck);
    expect(problems.some((p) => p.code === "illegalCurrent")).toBe(true);
  });
});

describe("match setup", () => {
  it("deals canonical opening hands and the second-player compensation", () => {
    const state = createMatch(testConfig(), content);
    expect(state.phase).toBe("mulligan");
    expect(state.players[0].hand).toHaveLength(content.balance.hand.first);
    // second player gets their larger hand plus Borrowed Clout
    expect(state.players[1].hand).toHaveLength(content.balance.hand.second + 1);
    expect(state.players[1].hand.some((c) => c.cardId === "token-borrowed-clout")).toBe(true);
    expect(state.players[0].leaderHealth).toBe(30);
    expect(state.players[0].board).toHaveLength(content.balance.board.characterSlots);
  });

  it("starts the first turn once both players mulligan", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    expect(state.phase).toBe("mulligan");
    const result = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] });
    state = result.state;
    expect(state.phase).toBe("main");
    expect(state.players[0].hypeMax).toBe(1);
    expect(state.players[0].hype).toBe(1);
    // the first player drew for turn
    expect(state.players[0].hand.length).toBe(content.balance.hand.first + 1);
    expect(result.events.some((e) => e.e === "matchStarted")).toBe(true);
    expect(result.events.some((e) => e.e === "turnStarted")).toBe(true);
  });

  it("does not redraw a mulliganed card into the same hand", () => {
    let state = createMatch(testConfig(777), content);
    const swapped = state.players[0].hand.map((c) => c.instanceId);
    const before = state.players[0].hand.map((c) => c.instanceId);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: swapped }).state;
    const after = state.players[0].hand.map((c) => c.instanceId);
    expect(after).toHaveLength(before.length);
    for (const id of after) expect(before).not.toContain(id);
  });
});

describe("hype progression", () => {
  it("grows max Hype by one per own turn and refills each turn", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;

    for (let expected = 1; expected <= 5; expected++) {
      expect(state.players[0].hypeMax).toBe(expected);
      state = applyIntent(state, content, { type: "endTurn", seat: 0 }).state;
      expect(state.activeSeat).toBe(1);
      expect(state.players[1].hypeMax).toBe(expected);
      state = applyIntent(state, content, { type: "endTurn", seat: 1 }).state;
      expect(state.activeSeat).toBe(0);
    }
  });

  it("caps max Hype at the balance cap", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;
    for (let i = 0; i < 30; i++) {
      state = applyIntent(state, content, { type: "endTurn", seat: state.activeSeat }).state;
      if (state.winner !== null) break;
    }
    expect(state.players[0].hypeMax).toBeLessThanOrEqual(content.balance.hype.cap);
    expect(state.players[1].hypeMax).toBeLessThanOrEqual(content.balance.hype.cap);
  });
});

describe("full match simulation", () => {
  it("plays random legal matches to completion without illegal states", () => {
    for (const seed of [1, 2, 3, 7, 11, 42, 99, 2024]) {
      const { state, intents } = playRandomMatch(seed);
      expect(intents, `seed ${seed} made no progress`).toBeGreaterThan(5);

      // invariants that must hold at every point in every match
      for (const player of state.players) {
        expect(player.hand.length).toBeLessThanOrEqual(content.balance.hand.limit);
        expect(player.board.length).toBe(content.balance.board.characterSlots);
        expect(player.obsession).toBeGreaterThanOrEqual(0);
        expect(player.obsession).toBeLessThanOrEqual(content.balance.obsession.max);
        expect(player.hype).toBeGreaterThanOrEqual(0);
        expect(player.reactions.length).toBeLessThanOrEqual(content.balance.board.maxSetReactions);
        for (const character of player.board) {
          if (!character) continue;
          expect(character.health, "defeated characters must be removed").toBeGreaterThan(0);
        }
      }
    }
  });

  it("reaches a winner in most random matches", () => {
    let finished = 0;
    for (const seed of [5, 15, 25, 35, 45, 55]) {
      const { state } = playRandomMatch(seed, 900);
      if (state.winner !== null) finished++;
    }
    expect(finished, "random play should usually end a match").toBeGreaterThanOrEqual(4);
  });
});

describe("determinism and replay", () => {
  it("reproduces an identical state from the same seed and intents", () => {
    const { state, record } = playRandomMatch(31337);
    const replayed = replay(record, content);
    expect(replayed.errors).toEqual([]);
    expect(stateHash(replayed.state)).toBe(stateHash(state));
  });

  it("produces different matches from different seeds", () => {
    const a = playRandomMatch(1000);
    const b = playRandomMatch(2000);
    expect(stateHash(a.state)).not.toBe(stateHash(b.state));
  });

  it("never mutates the state passed to applyIntent", () => {
    let state: MatchState = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;
    const before = stateHash(state);
    applyIntent(state, content, { type: "endTurn", seat: 0 });
    expect(stateHash(state)).toBe(before);
  });
});

describe("redaction", () => {
  it("hides the opponent's hand and face-down reactions", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;

    const view = redact(state, 0);
    expect(view.you.hand.length).toBeGreaterThan(0);
    expect(view.opponent).not.toHaveProperty("hand");
    expect(view.opponent.handCount).toBe(state.players[1].hand.length);
    expect(view.opponent.reactionCount).toBe(state.players[1].reactions.length);
    expect(view.opponent.discard).toBe(state.players[1].discard); // discard is public
  });
});

describe("victory", () => {
  it("ends the match when a leader reaches zero health", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;
    state.players[1].leaderHealth = 1;

    // force a lethal board state, then swing
    const summoned = boardOf(state, 0);
    void summoned;
    state.players[1].leaderHealth = 0;
    const result = applyIntent(state, content, { type: "endTurn", seat: 0 });
    expect(result.state.winner).toBe(0);
    expect(result.state.phase).toBe("ended");
    expect(result.events.some((e) => e.e === "matchEnded")).toBe(true);
  });

  it("awards the win to the opponent on concede", () => {
    let state = createMatch(testConfig(), content);
    state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
    state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;
    const result = applyIntent(state, content, { type: "concede", seat: 0 });
    expect(result.state.winner).toBe(1);
  });
});
