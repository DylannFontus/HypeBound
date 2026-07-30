/**
 * Query functions must not change the match.
 *
 * The engine splits cleanly in two: `applyIntent` is the single mutation path,
 * and everything the UI calls to decide what to grey out — `checkPlayable`,
 * `attackableBy`, `legalAttackTargets`, `legalChooseTargets`,
 * `legalFixationTargets`, `legalEquipTargets`, `canUseFixation`,
 * `canActivateLocation`, `availableConfluences`, `predict` — is supposed to be
 * a pure question. Nothing enforced that, and one of them was not pure.
 *
 * ## The bug this was written for
 *
 * `resolveTargets`' `select: "random"` branch calls
 * `pickMany(ctx.state.rngState, …)`, and `nextU32` writes the RNG's four words
 * back **in place** (`src/engine/rng.ts:43-46`). `legalChooseTargets` handed it
 * the live `MatchState`, so asking "what could this ability target?" advanced
 * the authoritative RNG.
 *
 * `MatchState.rngState` is what `replay()` reproduces a match from. A UI hover
 * would therefore desync a replay from the match that recorded it — while that
 * match was still being played, with nothing on screen to suggest why.
 *
 * The same reached `auraModifiersFor` by a longer road: a *conditional* aura
 * evaluates a condition, `evalCondition` can count a `TargetSpec`, and
 * `totalAttack` → `attackableBy` → the battle screen's `refresh()` calls it
 * constantly.
 *
 * It was latent, not live: every shipped leader ability and confluence target
 * is `select: "choose"`, and `cardTargetSpecs` admits nothing else. That is one
 * line of card data away from being live, which is why this file asserts the
 * property rather than the current data.
 *
 * ## Why it hashes instead of checking the RNG
 *
 * Checking `rngState` would only catch the bug already found. `stateHash()`
 * covers the RNG *and* every board, hand, resource and counter, so a query that
 * starts mutating something else fails here too.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { stateHash } from "../src/engine/replay";
import {
  attackableBy,
  canActivateLocation,
  canUseFixation,
  checkPlayable,
  enumerateLegalIntents,
  legalEquipTargets,
  legalFixationTargets,
} from "../src/engine/intents";
import { legalAttackTargets } from "../src/engine/combat";
import { legalChooseTargets } from "../src/engine/effects";
import { availableConfluences } from "../src/engine/currents";
import { nextInt, seedRng } from "../src/engine/rng";
import type { MatchState, Seat, TargetSpec } from "../src/engine/types";

const content = getContent();

function midGame(seed: number, steps: number): MatchState {
  let state = createMatch(
    {
      seed,
      decks: [
        autoBuildDeck(content, "idols-lumi-starcall", "P1"),
        autoBuildDeck(content, "goth-leader-morvina-vane", "P2"),
      ],
      firstSeat: 0,
    },
    content
  );
  state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
  state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;

  const rng = seedRng(seed ^ 0x2468ace);
  for (let i = 0; i < steps && state.winner === null; i++) {
    const legal = enumerateLegalIntents(state, content, state.activeSeat);
    if (legal.length === 0) break;
    const doing = legal.filter((intent) => intent.type !== "endTurn");
    const pool = doing.length > 0 && nextInt(rng, 100) < 80 ? doing : legal;
    state = applyIntent(state, content, pool[nextInt(rng, pool.length)]!).state;
  }
  return state;
}

describe("no query changes the match", () => {
  it("leaves the state hash untouched across every legality helper", () => {
    let asked = 0;

    for (const seed of [5, 55, 555, 5555]) {
      for (const steps of [0, 8, 25, 50]) {
        const state = midGame(seed, steps);
        if (state.winner !== null) continue;
        const before = stateHash(state);

        for (const seat of [0, 1] as Seat[]) {
          for (const card of state.players[seat].hand) {
            checkPlayable(state, content, seat, card.instanceId);
            asked += 1;
          }
          attackableBy(state, content, seat);
          legalAttackTargets(state, seat);
          legalEquipTargets(state, seat);
          legalFixationTargets(state, content, seat, "fixation");
          legalFixationTargets(state, content, seat, "ultimate");
          canUseFixation(state, content, seat, "fixation");
          canUseFixation(state, content, seat, "ultimate");
          canActivateLocation(state, content, seat);
          availableConfluences(state, content, seat);
          enumerateLegalIntents(state, content, seat);
          asked += 10;
        }

        expect(stateHash(state), `seed ${seed}, ${steps} steps: a query changed the match`).toBe(before);
      }
    }

    expect(asked, "no query was ever made").toBeGreaterThan(100);
  });

  /**
   * The specific regression, forced rather than waited for.
   *
   * No shipped card produces a `select: "random"` target spec through a query
   * path, so nothing in the suite above exercises the branch that was broken.
   * Handing the spec in directly is what makes this a test of the fix instead of
   * a test of the current card data.
   */
  it("does not roll the dice when asked what a random effect could hit", () => {
    const state = midGame(31415, 30);
    const randomSpec: TargetSpec = { select: "random", side: "any", zone: "board", count: 1 };

    const before = stateHash(state);
    const rngBefore = [...state.rngState];

    for (let i = 0; i < 25; i++) legalChooseTargets(state, content, 0, randomSpec);

    expect([...state.rngState], "legalChooseTargets advanced the match RNG").toEqual(rngBefore);
    expect(stateHash(state)).toBe(before);
  });

  it("returns the same answer every time, since it is a question", () => {
    /**
     * The user-visible half of the same property. A query that advanced the RNG
     * would answer differently on each call, so a target list could change under
     * the player between the UI computing it and the player clicking it.
     */
    const state = midGame(27182, 30);
    const randomSpec: TargetSpec = { select: "random", side: "any", zone: "board", count: 1 };

    const first = JSON.stringify(legalChooseTargets(state, content, 0, randomSpec));
    for (let i = 0; i < 10; i++) {
      expect(JSON.stringify(legalChooseTargets(state, content, 0, randomSpec))).toBe(first);
    }
  });

  it("still lets a resolving effect roll — the fix must not freeze the RNG", () => {
    /**
     * The other side of the guard. Making queries pure would be worthless if it
     * also stopped `applyIntent` advancing the RNG, and that failure would look
     * like a much subtler bug: a deterministic-but-wrong game.
     */
    /**
     * A mulligan that actually replaces something, because ordinary play may
     * legitimately never roll: draws come off a deck shuffled once at creation,
     * so a match with no random effects can run start to finish without touching
     * the RNG. Shuffling cards back in is the reliable roll.
     *
     * The first version of this test looped `applyIntent` without reassigning
     * `state`, so it applied the same intent to the same position sixty times
     * and concluded the RNG was frozen. It was measuring nothing.
     */
    const fresh = createMatch(
      {
        seed: 16180,
        decks: [
          autoBuildDeck(content, "idols-lumi-starcall", "P1"),
          autoBuildDeck(content, "goth-leader-morvina-vane", "P2"),
        ],
        firstSeat: 0,
      },
      content
    );
    const before = [...fresh.rngState];
    const toss = fresh.players[0].hand.slice(0, 2).map((card) => card.instanceId);
    expect(toss.length, "no opening hand to mulligan").toBe(2);

    const after = applyIntent(fresh, content, {
      type: "mulligan",
      seat: 0,
      replaceInstanceIds: toss,
    }).state;

    expect(
      [...after.rngState],
      "a shuffle no longer advances the RNG — the query fix has frozen the real one"
    ).not.toEqual(before);
  });
});
