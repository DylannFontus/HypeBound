import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent, deriveAiRng } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import type { AiDifficulty, MatchConfig, MatchState, Seat } from "../src/engine/types";

const content = getContent();

function config(seed: number): MatchConfig {
  return {
    seed,
    decks: [autoBuildDeck(content, "idols-lumi-starcall", "A"), autoBuildDeck(content, "idols-dj-kilowatt", "B")],
    firstSeat: 0,
  };
}

/** Run an AI-vs-AI match. Returns the winner and how many intents it took. */
function simulate(
  seed: number,
  difficultyA: AiDifficulty,
  difficultyB: AiDifficulty,
  maxIntents = 700
): { winner: Seat | "draw" | null; intents: number; illegal: number } {
  let state: MatchState = createMatch(config(seed), content);
  const profiles = [getAiProfile(difficultyA), getAiProfile(difficultyB)];
  let intents = 0;
  let illegal = 0;

  while (state.phase === "mulligan") {
    const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    state = applyIntent(state, content, decision.intent).state;
  }

  while (state.winner === null && intents < maxIntents) {
    const seat = state.activeSeat;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    try {
      state = applyIntent(state, content, decision.intent).state;
    } catch {
      illegal++;
      // fall back to ending the turn so the sim can continue
      state = applyIntent(state, content, { type: "endTurn", seat }).state;
    }
    intents++;
  }

  return { winner: state.winner, intents, illegal };
}

/**
 * Every test here plays whole matches, so they are all seconds rather than
 * milliseconds and none of them fits the default 5s budget with any margin.
 *
 * That was a latent flake rather than a theoretical one: "never submits an
 * illegal intent" runs in ~3.5s on its own and **timed out in the full suite**
 * the first time another test file was added, because vitest runs files in
 * parallel and the wall clock is shared. The simulations are deterministic — a
 * failure here is always a real one — so the budget is set by how long the work
 * takes under load, not by how long it takes alone.
 */
const SIM_TIMEOUT = { timeout: 60_000 };

describe("AI opponents", () => {
  it("never submits an illegal intent", SIM_TIMEOUT, () => {
    for (const seed of [1, 9, 77, 404]) {
      const result = simulate(seed, "intermediate", "advanced");
      expect(result.illegal, `seed ${seed}`).toBe(0);
    }
  });

  it("finishes matches at every difficulty", SIM_TIMEOUT, () => {
    const difficulties: AiDifficulty[] = ["beginner", "casual", "intermediate", "advanced", "expert"];
    for (const difficulty of difficulties) {
      const result = simulate(2468, difficulty, difficulty);
      expect(result.intents, `${difficulty} made no progress`).toBeGreaterThan(10);
      expect(result.illegal).toBe(0);
    }
  });

  it("is deterministic for a given seed", SIM_TIMEOUT, () => {
    const a = simulate(31415, "advanced", "advanced");
    const b = simulate(31415, "advanced", "advanced");
    expect(a.winner).toBe(b.winner);
    expect(a.intents).toBe(b.intents);
  });

  // expert searches 3 plies, so a batch of full matches needs real time
  it("gives stronger difficulties a winning edge over beginners", { timeout: 180_000 }, () => {
    // alternating seats so first-player advantage cancels out
    let expertWins = 0;
    let decided = 0;
    for (let i = 0; i < 24; i++) {
      const expertSeat: Seat = i % 2 === 0 ? 0 : 1;
      const result =
        expertSeat === 0 ? simulate(5000 + i, "expert", "beginner") : simulate(5000 + i, "beginner", "expert");
      if (result.winner === null || result.winner === "draw") continue;
      decided++;
      if (result.winner === expertSeat) expertWins++;
    }
    expect(decided, "matches should reach a result").toBeGreaterThan(20);
    const winRate = expertWins / decided;
    expect(winRate, `expert win rate was ${(winRate * 100).toFixed(0)}%`).toBeGreaterThan(0.6);
  });

  it("mulligans away cards it cannot cast early", () => {
    const state = createMatch(config(888), content);
    const decision = chooseIntent(state, content, 0, getAiProfile("expert"));
    expect(decision?.intent.type).toBe("mulligan");
    if (decision?.intent.type === "mulligan") {
      const replaced = decision.intent.replaceInstanceIds;
      for (const id of replaced) {
        const instance = state.players[0].hand.find((c) => c.instanceId === id);
        const card = instance ? content.cards[instance.cardId] : undefined;
        expect(card?.cost, "expert should only throw back expensive cards").toBeGreaterThan(4);
      }
    }
  });
});

/**
 * The AI must be a pure function of match state.
 *
 * It used to carry a mutable RNG stream outside MatchState, which made its
 * choice depend on every decision made earlier in the process rather than on
 * the match. Replays still verified — AI moves are recorded as intents and
 * re-applied — but re-simulating a prefix and asking again produced a DIFFERENT
 * move, which is exactly what a tutorial rewind or The Lab's undo does. These
 * tests pin the property that fix exists for; without them the surviving
 * "deterministic for a given seed" test is nearly impossible to fail.
 */
describe("AI determinism", () => {
  const profile = getAiProfile("intermediate");

  it("returns the same intent for the same state, asked twice", () => {
    const state = createMatch(config(4242), content);
    const a = chooseIntent(state, content, 0, profile);
    const b = chooseIntent(state, content, 0, profile);
    expect(JSON.stringify(a?.intent)).toBe(JSON.stringify(b?.intent));
  });

  it("replies identically to a prefix replayed from scratch — the rewind property", () => {
    const start = createMatch(config(90210), content);

    // play a prefix, recording exactly what was applied
    let live: MatchState = start;
    const prefix = [];
    for (let i = 0; i < 12 && live.winner === null; i++) {
      const seat = live.phase === "mulligan" ? ((live.players[0].mulliganDone ? 1 : 0) as Seat) : live.activeSeat;
      const decision = chooseIntent(live, content, seat, profile);
      if (!decision) break;
      prefix.push(decision.intent);
      live = applyIntent(live, content, decision.intent).state;
    }
    const liveNext = chooseIntent(live, content, live.activeSeat, profile);

    // rebuild the same position from config + the intent log, as a rewind does
    let rebuilt: MatchState = createMatch(config(90210), content);
    for (const intent of prefix) rebuilt = applyIntent(rebuilt, content, intent).state;
    const rebuiltNext = chooseIntent(rebuilt, content, rebuilt.activeSeat, profile);

    expect(rebuilt.intentCount).toBe(live.intentCount);
    expect(JSON.stringify(rebuiltNext?.intent)).toBe(JSON.stringify(liveNext?.intent));
  });

  it("does not roll the same numbers for consecutive decisions", () => {
    // decisions within one turn must not be correlated, or the AI's noise stops
    // being noise; intentCount is what separates them
    const state = createMatch(config(555), content);
    const later = applyIntent(state, content, chooseIntent(state, content, 0, profile)!.intent).state;
    expect(later.intentCount).toBeGreaterThan(state.intentCount);
    expect(deriveAiRng(state, 0, profile)).not.toEqual(deriveAiRng(later, 0, profile));
  });

  it("gives two seats different rolls at the same position", () => {
    // a mirror mulligan asks both seats at the same intentCount
    const state = createMatch(config(777), content);
    expect(deriveAiRng(state, 0, profile)).not.toEqual(deriveAiRng(state, 1, profile));
  });
});
