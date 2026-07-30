/**
 * Does the AI peek at your hand?
 *
 * `README.md` describes `src/ai/` as *"AI opponents (6 difficulty tiers), sees
 * only redacted state"*. That is a claim about fairness, and nothing in the code
 * enforces it: `chooseIntent(state, content, seat, profile)` is handed the whole
 * `MatchState`, opponent hand and deck order included. It happens to be true
 * today because of how the evaluator was written, which is a different thing
 * from being true by construction.
 *
 * It matters more now than it did. The AI is about to run **server-side**, as
 * §9.3's honest "Play the AI instead" offer when a queue cannot find a human. An
 * AI that reads your hand is cheating whether or not the process running it is
 * entitled to the data, and this game ships a screen at `#fairness` that says
 * otherwise.
 *
 * ## Why this is a Proxy test and not a scramble test
 *
 * The obvious test — swap the opponent's hidden cards for decoys and assert the
 * AI decides the same thing — gives false positives. The AI *simulates* with
 * `applyIntent` (`src/ai/ai.ts:82`), so any card whose effect legitimately
 * touches a hidden zone (a discard, a reveal, a steal) would change the
 * simulated outcome. That divergence is correct: the engine is the authority and
 * is entitled to know.
 *
 * The claim worth defending is narrower and exact: **the evaluation heuristics
 * read only fields that a `RedactedOpponent` carries.** So this records every
 * property actually read off the opponent's `PlayerState` during scoring and
 * checks it against that type's field list.
 */

import { describe, expect, it } from "vitest";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { enumerateLegalIntents } from "../src/engine/intents";
import { nextInt, seedRng } from "../src/engine/rng";
import { evaluate } from "../src/ai/evaluator";
import type { MatchState, RedactedOpponent, Seat } from "../src/engine/types";

const content = getContent();

/**
 * Exactly the fields `RedactedOpponent` publishes — the opponent information a
 * networked client, and therefore a fair AI, is allowed to have.
 *
 * Written out rather than derived, because deriving it from the type at runtime
 * is not possible and deriving it from an instance would silently shrink if the
 * type ever lost a field.
 */
const REDACTED_OPPONENT_FIELDS: ReadonlySet<keyof RedactedOpponent | string> = new Set([
  "seat",
  "leaderCardId",
  "leaderCurrent",
  "leaderHealth",
  "leaderMaxHealth",
  "armor",
  "hype",
  "hypeMax",
  "obsession",
  "handCount",
  "deckCount",
  "discard",
  "board",
  "banishedCount",
  "location",
  "reactionCount",
  "activeEvent",
  "resonanceProgress",
  "pureCurrent",
  "counters",
]);

/**
 * `hand` and `deck` are the two array fields whose *identities* are private but
 * whose *lengths* are not — `RedactedOpponent` publishes them as `handCount`
 * and `deckCount`. Reading `.length` off them is fair; reading an element is
 * not, and the Proxy below tells those apart.
 */
const COUNT_ONLY_FIELDS = new Set(["hand", "deck", "reactions", "banished"]);

interface AccessLog {
  fields: Set<string>;
  /** reads that went past a count into actual card identities */
  violations: string[];
}

/**
 * Wrap the opponent's `PlayerState` so every property read is recorded.
 *
 * For the three count-only zones the proxy hands back an array proxy too, so
 * `them.hand.length` is recorded as a fair count read while `them.hand[0]` is
 * recorded as a violation. Without that distinction the test would either fail
 * on the legitimate card-advantage heuristic or pass on a real peek.
 */
function watchOpponent(state: MatchState, foe: Seat): { state: MatchState; log: AccessLog } {
  const log: AccessLog = { fields: new Set(), violations: [] };
  const real = state.players[foe];

  const watched = new Proxy(real, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      log.fields.add(key);

      const value = Reflect.get(target, prop, receiver);
      if (COUNT_ONLY_FIELDS.has(key) && Array.isArray(value)) {
        return new Proxy(value, {
          get(arr, arrProp) {
            const arrKey = String(arrProp);
            // length is the count, and the count is public
            if (arrKey === "length" || typeof arrProp === "symbol") {
              return Reflect.get(arr, arrProp);
            }
            // an index, or any method that could reach the contents
            if (arrKey !== "constructor") log.violations.push(`${key}.${arrKey}`);
            return Reflect.get(arr, arrProp);
          },
        });
      }
      return value;
    },
  });

  const players: MatchState["players"] =
    foe === 0 ? [watched, state.players[1]] : [state.players[0], watched];

  return { state: { ...state, players }, log };
}

/** Drive a match to a mid-game position with real boards and full hands. */
function midGame(seed: number, steps: number): MatchState {
  let state = createMatch(
    {
      seed,
      decks: [autoBuildDeck(content, "idols-lumi-starcall", "P1"), autoBuildDeck(content, "goth-leader-morvina-vane", "P2")],
      firstSeat: 0,
    },
    content
  );
  state = applyIntent(state, content, { type: "mulligan", seat: 0, replaceInstanceIds: [] }).state;
  state = applyIntent(state, content, { type: "mulligan", seat: 1, replaceInstanceIds: [] }).state;

  const rng = seedRng(seed ^ 0x1234567);
  for (let i = 0; i < steps && state.winner === null; i++) {
    const legal = enumerateLegalIntents(state, content, state.activeSeat);
    if (legal.length === 0) break;
    const doing = legal.filter((intent) => intent.type !== "endTurn");
    const pool = doing.length > 0 && nextInt(rng, 100) < 80 ? doing : legal;
    state = applyIntent(state, content, pool[nextInt(rng, pool.length)]!).state;
  }
  return state;
}

describe("the AI scores positions from public information only", () => {
  it("reads no field of the opponent that a redacted view would not carry", () => {
    const offenders = new Map<string, number>();
    let evaluations = 0;

    for (const seed of [11, 222, 3333, 44444]) {
      for (const steps of [0, 6, 20, 45]) {
        const base = midGame(seed, steps);
        if (base.winner !== null) continue;

        for (const seat of [0, 1] as Seat[]) {
          const foe: Seat = seat === 0 ? 1 : 0;
          const { state, log } = watchOpponent(base, foe);
          evaluate(state, content, seat);
          evaluations += 1;

          for (const field of log.fields) {
            if (!REDACTED_OPPONENT_FIELDS.has(field) && !COUNT_ONLY_FIELDS.has(field)) {
              offenders.set(field, (offenders.get(field) ?? 0) + 1);
            }
          }
          for (const violation of log.violations) {
            offenders.set(violation, (offenders.get(violation) ?? 0) + 1);
          }
        }
      }
    }

    // proves the loop ran, so an empty offender list means something
    expect(evaluations, "no position was ever evaluated").toBeGreaterThan(10);
    expect(
      [...offenders.keys()].sort(),
      "the AI read opponent state a fair client could not see"
    ).toEqual([]);
  });

  it("does read the public things, so the check above is not passing on silence", () => {
    /**
     * The companion assertion. A Proxy that recorded nothing would satisfy the
     * test above perfectly, and so would an evaluator that had stopped looking
     * at the opponent at all.
     */
    const base = midGame(777, 20);
    const { state, log } = watchOpponent(base, 1);
    evaluate(state, content, 0);

    expect(log.fields.size, "the evaluator read nothing about the opponent").toBeGreaterThan(2);
    expect(log.fields.has("leaderHealth")).toBe(true);
  });

  it("counts cards in hand without looking at them", () => {
    /**
     * The specific heuristic that makes this subtle:
     * `score += (me.hand.length - them.hand.length) * weights.cardAdvantage`.
     *
     * Card advantage is a fair thing to weigh — `RedactedOpponent.handCount`
     * exists precisely so both players can. Reading the same array's *contents*
     * would not be, and the two look almost identical in the source.
     */
    const base = midGame(999, 25);
    const { state, log } = watchOpponent(base, 1);
    evaluate(state, content, 0);

    expect(log.fields.has("hand"), "the card-advantage heuristic did not run").toBe(true);
    expect(log.violations, "the evaluator indexed into the opponent's hand").toEqual([]);
  });
});
