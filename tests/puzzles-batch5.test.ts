/**
 * Puzzle solutions, P37–P40 — the last of the set.
 *
 * The intended line wins; the plausible wrong line does not.
 */

import { describe, expect, it } from "vitest";
import {
  attackLeader,
  attackUnit,
  boardOf,
  confluence,
  endTurn,
  enemyHealth,
  myHealth,
  openPuzzle,
  passToTheEnemy,
  playCard,
  tryWalk,
  unitAt,
  walk,
} from "./puzzleKit";

describe("P37 — Deep Breath (Economy / Burnout)", () => {
  const POSTER = "meme-first-poster";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p37-deep-breath");
    expect(myHealth(state), "one Burnout tick from over").toBe(1);
    expect(state.players[0].deck, "nothing left to draw").toHaveLength(0);
    expect(enemyHealth(state)).toBe(2);
  });

  it("is solved by taking the win that is already on the board", () => {
    const solved = walk(openPuzzle("p37-deep-breath"), [attackLeader(POSTER)]);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("loses to the card that draws — with an empty deck that is just more Burnout", () => {
    /**
     * Burnout escalates: the opening draw cost 1, the next costs 2. A draw spell
     * with nothing to draw is not card advantage, it is the second tick arriving
     * early — and it arrives before you ever get to use whatever it found.
     */
    const state = walk(openPuzzle("p37-deep-breath"), [playCard("meme-bump-the-thread")]);
    expect(myHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(1);
  });
});

describe("P38 — Thin Ice (Survival / Armor)", () => {
  const CANCEL = "algo-shadowban-notice";
  const BIG = "cosplay-token-hall-champion";
  const SMALL = "meme-ironic-poster";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p38-thin-ice");
    expect(myHealth(state)).toBe(1);
    expect(state.players[0].armor, "two Armor in front of one health").toBe(2);
    expect(unitAt(state, 1, BIG).attack).toBe(4);
    expect(unitAt(state, 1, SMALL).attack).toBe(2);
  });

  it("is survived by blanking the one Armor cannot absorb", () => {
    // 2 Armor eats a 2-attack swing whole; it only slows a 4 down
    const state = walk(openPuzzle("p38-thin-ice"), [playCard(CANCEL, { at: [{ seat: 1, cardId: BIG }] })]);
    const after = passToTheEnemy(state, "p38-thin-ice");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies if the small one is blanked instead", () => {
    const state = walk(openPuzzle("p38-thin-ice"), [playCard(CANCEL, { at: [{ seat: 1, cardId: SMALL }] })]);
    expect(passToTheEnemy(state, "p38-thin-ice").winner).toBe(1);
  });
});

describe("P39 — Closing Time (Lethal / Confluence as removal)", () => {
  const CINDER = "viral-hype-intern";
  const PULSE = "algo-preroll-runner";
  const MINE = "idols-voltage-idol";
  const WALL = "cosplay-foam-knight";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p39-closing-time");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 0, MINE).attack).toBe(3);
    expect(unitAt(state, 1, WALL).health).toBe(4);
  });

  it("is solved by letting Starflare clear the way", () => {
    let state = walk(openPuzzle("p39-closing-time"), [playCard(CINDER), playCard(PULSE)]);
    state = walk(state, [confluence("starflare", { at: { seat: 1, cardId: WALL } })]);
    expect(boardOf(state, 1)).toHaveLength(0);

    state = walk(state, [attackLeader(MINE)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("fails if the attacker clears the wall itself", () => {
    // Pulse beats Tide, so it does kill the bodyguard — and then there is
    // nothing left that can swing at the leader
    const state = walk(openPuzzle("p39-closing-time"), [attackUnit(MINE, WALL)]);
    expect(boardOf(state, 1)).toHaveLength(0);
    expect(enemyHealth(state)).toBe(3);
    expect(state.winner).toBeNull();
  });
});

describe("P40 — Last Word (Lethal / the whole set)", () => {
  const CINDER = "viral-hype-intern";
  const PULSE = "algo-preroll-runner";
  const RAID = "meme-first-poster";
  const WALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p40-last-word");
    expect(state.players[0].hype, "one Hype per card, and no spare").toBe(4);
    expect(enemyHealth(state)).toBe(4);
    expect(boardOf(state, 0)).toHaveLength(0);
    expect(unitAt(state, 1, WALL).keywords).toContain("spotlight");
  });

  it("is solved by spending all four in the one order that works", () => {
    /**
     * The two cheap bodies are not there to attack — they are a Cinder and a
     * Pulse, which is Starflare, which is the only removal in the puzzle. The
     * two Raid bodies are the only things that can swing the turn they land.
     */
    let state = walk(openPuzzle("p40-last-word"), [playCard(CINDER), playCard(PULSE)]);
    state = walk(state, [confluence("starflare", { at: { seat: 1, cardId: WALL } })]);
    expect(boardOf(state, 1), "the bodyguard is gone").toHaveLength(0);

    state = walk(state, [playCard(RAID), playCard(RAID)]);
    state = walk(state, [attackLeader(RAID, 0), attackLeader(RAID, 1)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("cannot reach the leader if the Hype goes on bodies alone", () => {
    let state = walk(openPuzzle("p40-last-word"), [playCard(RAID), playCard(RAID)]);
    const wrong = tryWalk(state, [attackLeader(RAID, 0)]);
    expect(wrong.stoppedAt, "Spotlight is still up and nothing removed it").not.toBeNull();

    // and the two Raid bodies cannot chew through the bodyguard and still win
    state = walk(state, [attackUnit(RAID, WALL, 0)]);
    expect(boardOf(state, 1)).toHaveLength(0);
    state = walk(state, [attackLeader(RAID, 0)]);
    expect(enemyHealth(state), "only one swing was left").toBe(2);
    expect(state.winner).toBeNull();
  });
});
