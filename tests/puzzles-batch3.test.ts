/**
 * Puzzle solutions, P27 onward — same contract as the earlier batches.
 *
 * The intended line wins; the plausible wrong line does not.
 */

import { describe, expect, it } from "vitest";
import {
  attackLeader,
  attackUnit,
  boardOf,
  content,
  endTurn,
  enemyHealth,
  fixation,
  openPuzzle,
  playCard,
  tryWalk,
  unitAt,
  walk,
} from "./puzzleKit";
import { previewAttack } from "../src/engine/combat";

describe("P27 — Double Duty (Lethal / two Spotlight walls)", () => {
  const CLIP = "neutral-clip-it";
  const BIG = "viral-drama-channel";
  const SMALL = "meme-first-poster";
  const WALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p27-double-duty");
    expect(boardOf(state, 1), "two bodyguards").toHaveLength(2);
    expect(enemyHealth(state)).toBe(3);
  });

  it("is solved by spending the spell on one wall and the small body on the other", () => {
    const solved = walk(openPuzzle("p27-double-duty"), [
      playCard(CLIP, { at: [{ seat: 1, cardId: WALL }] }),
      attackUnit(SMALL, WALL),
      attackLeader(BIG),
    ]);
    expect(boardOf(solved, 1)).toHaveLength(0);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if both characters are spent on the walls", () => {
    const wrong = tryWalk(openPuzzle("p27-double-duty"), [
      attackUnit(BIG, WALL),
      attackUnit(SMALL, WALL),
      attackLeader(BIG),
    ]);
    expect(wrong.stoppedAt, "nothing is left that can still swing").not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(3);
  });
});

describe("P28 — Nobody's Friend (Currents / Prism)", () => {
  const PULSE = "idols-voltage-idol";
  const PRISM = "cosplay-token-hall-champion";
  const WALL = "meme-token-gremlin-soggy";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p28-prism-neutral");
    expect(unitAt(state, 1, WALL).current).toBe("prism");
    expect(unitAt(state, 1, WALL).health, "no Current bonus is going to help").toBe(4);
    expect(unitAt(state, 0, PULSE).attack).toBe(3);
    expect(unitAt(state, 0, PRISM).attack).toBe(4);
  });

  it("gives no elemental bonus in either direction", () => {
    const state = openPuzzle("p28-prism-neutral");
    const wall = unitAt(state, 1, WALL);
    for (const attacker of [PULSE, PRISM]) {
      expect(
        previewAttack(state, content, unitAt(state, 0, attacker), { kind: "character", instanceId: wall.instanceId })
          .elementalBonus,
        `${attacker} should get nothing against Prism`
      ).toBe(false);
    }
  });

  it("is solved with raw damage, not the Current", () => {
    const solved = walk(openPuzzle("p28-prism-neutral"), [attackUnit(PRISM, WALL), attackLeader(PULSE)]);
    expect(boardOf(solved, 1)).toHaveLength(0);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if the Pulse character goes in expecting a bonus", () => {
    let state = walk(openPuzzle("p28-prism-neutral"), [attackUnit(PULSE, WALL)]);
    expect(unitAt(state, 1, WALL).health, "a bare 3 against 4").toBe(1);
    state = walk(state, [attackUnit(PRISM, WALL)]);
    expect(enemyHealth(state)).toBe(3);
    expect(state.winner).toBeNull();
  });
});

describe("P29 — Full Fixation (Lethal / Obsession)", () => {
  const IDOL = "token-backup-idol";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p29-full-fixation");
    expect(state.players[0].obsession).toBe(10);
    expect(enemyHealth(state)).toBe(7);
    expect(boardOf(state, 0).reduce((sum, c) => sum + c.attack, 0), "two attack, seven health").toBe(2);
  });

  it("is solved by using both, which only ten Obsession allows", () => {
    /**
     * At the maximum, the Ultimate costs no Obsession at all and resets you to
     * five — which still pays for the Fixation. Anything under ten and the two
     * together cost more than you have.
     */
    let state = walk(openPuzzle("p29-full-fixation"), [fixation("ultimate")]);
    expect(state.players[0].obsession, "Full Fixation reset, not a 7-point spend").toBe(5);

    state = walk(state, [
      fixation("fixation", { seat: 0, cardId: IDOL }),
      attackLeader(IDOL, 0),
      attackLeader(IDOL, 1),
    ]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("falls short on the Ultimate alone", () => {
    const state = walk(openPuzzle("p29-full-fixation"), [
      fixation("ultimate"),
      attackLeader(IDOL, 0),
      attackLeader(IDOL, 1),
    ]);
    expect(enemyHealth(state), "3 + 3 against 7").toBe(1);
    expect(state.winner).toBeNull();
  });
});

describe("P30 — Cheap Imitation (Combo / Viral)", () => {
  const STAN = "idols-stan-account";
  const FRENZY = "viral-follower-frenzy";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p30-cheap-imitation");
    expect(state.players[0].hype).toBe(4);
    expect(enemyHealth(state)).toBe(3);
  });

  it("is solved by cashing the free copy before the finisher", () => {
    let state = walk(openPuzzle("p30-cheap-imitation"), [playCard(STAN)]);
    expect(state.players[0].hand.some((c) => c.cardId === STAN), "Viral put a copy in hand").toBe(true);
    expect(state.players[0].hype).toBe(3);

    state = walk(state, [playCard(STAN)]);
    expect(state.players[0].hype, "the copy cost nothing").toBe(3);

    state = walk(state, [playCard(FRENZY)]);
    expect(state.players[0].hype, "Trending took two off a five-cost").toBe(0);
    const followers = boardOf(state, 0).filter((c) => c.cardId === "token-follower");
    expect(followers).toHaveLength(3);
    for (const follower of followers) expect(follower.keywords, "Rushwind gave them Raid").toContain("raid");

    for (let nth = 0; nth < 3; nth++) state = walk(state, [attackLeader("token-follower", nth)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("cannot afford the finisher on one card played", () => {
    const state = walk(openPuzzle("p30-cheap-imitation"), [playCard(STAN)]);
    const wrong = tryWalk(state, [playCard(FRENZY)]);
    expect(wrong.stoppedAt, "5 minus 1 is still more than 3 Hype").not.toBeNull();
  });
});

describe("P31 — Last Call (Lethal / delayed damage)", () => {
  const SONG = "after-one-more-song";
  const HOT = "viral-hot-take";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p31-last-call");
    expect(state.players[0].hype, "one card only").toBe(1);
    expect(enemyHealth(state)).toBe(2);
    expect(boardOf(state, 0), "nothing to attack with").toHaveLength(0);
  });

  it("is solved by the card that pays out next turn", () => {
    let state = walk(openPuzzle("p31-last-call"), [playCard(SONG)]);
    expect(enemyHealth(state), "nothing has happened yet").toBe(2);

    // pass to the idle opponent and back; Last Call resolves on your turn start
    state = walk(state, [endTurn, endTurn]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("gets nowhere on the card that deals damage now", () => {
    let state = walk(openPuzzle("p31-last-call"), [playCard(HOT, { at: [{ seat: 1, cardId: "goth-crypt-usher" }] })]);
    state = walk(state, [endTurn, endTurn]);
    expect(enemyHealth(state), "the leader was never the target").toBe(2);
    expect(state.winner).toBeNull();
  });
});
