/**
 * Puzzle solutions, P32 onward — same contract as the earlier batches.
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

describe("P32 — Bodyguard Detail (Survival / Equipment)", () => {
  const BYLAWS = "meme-laminated-bylaws";
  const FRAGILE = "token-backup-idol";
  const TANK = "demon-doomscroll-fiend";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p32-bodyguard-detail");
    expect(myHealth(state)).toBe(3);
    expect(boardOf(state, 1).reduce((sum, c) => sum + c.attack, 0)).toBe(8);
    for (const unit of boardOf(state, 0)) {
      expect(unit.keywords, "nothing has Spotlight to start with").not.toContain("spotlight");
    }
  });

  it("is survived by pinning it on the body that can take two hits", () => {
    const state = walk(openPuzzle("p32-bodyguard-detail"), [playCard(BYLAWS, { at: [{ seat: 0, cardId: TANK }] })]);
    expect(unitAt(state, 0, TANK).keywords, "the equipment grants it").toContain("spotlight");

    const after = passToTheEnemy(state, "p32-bodyguard-detail");
    expect(myHealth(after), "both swings went into the wall").toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies if it goes on the fragile one — it falls to the first swing", () => {
    const state = walk(openPuzzle("p32-bodyguard-detail"), [playCard(BYLAWS, { at: [{ seat: 0, cardId: FRAGILE }] })]);
    const after = passToTheEnemy(state, "p32-bodyguard-detail");
    expect(after.winner).toBe(1);
  });

  it("dies with nothing wearing it", () => {
    expect(passToTheEnemy(openPuzzle("p32-bodyguard-detail"), "p32-bodyguard-detail").winner).toBe(1);
  });
});

describe("P33 — Eclipse (Currents / auras off)", () => {
  const HALO = "idols-light-stick-wave";
  const VEIL = "demon-sign-here";
  const IDOL = "token-backup-idol";

  it("deals a board whose numbers are inflated by an aura", () => {
    const state = openPuzzle("p33-eclipse");
    expect(myHealth(state)).toBe(7);
    // the tokens print as 1/1; the Centre Position is what makes them hit for 2
    expect(unitAt(state, 1, IDOL).attack, "printed attack, before the aura").toBe(1);
  });

  it("is survived by switching the aura off", () => {
    let state = walk(openPuzzle("p33-eclipse"), [playCard(VEIL), playCard(HALO)]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["halo", "veil"]));

    state = walk(state, [confluence("eclipse")]);
    const after = passToTheEnemy(state, "p33-eclipse");
    expect(myHealth(after), "two points of aura never happened").toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies with the aura still running", () => {
    expect(passToTheEnemy(openPuzzle("p33-eclipse"), "p33-eclipse").winner).toBe(1);
  });
});

describe("P34 — Chain Reaction (Combo / Chain)", () => {
  const INFLUENCE = "after-bad-influence";
  const GREMLIN = "after-karaoke-gremlin";
  const MINE = "meme-ironic-poster";
  const WALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p34-chain");
    expect(enemyHealth(state)).toBe(2);
    expect(unitAt(state, 1, WALL).health).toBe(2);
    expect(unitAt(state, 0, MINE).attack, "exactly the wall's health, and exactly the leader's").toBe(2);
    for (const unit of boardOf(state, 0)) {
      expect(unit.keywords, "no Afterparty friend yet").not.toContain("afterparty");
    }
  });

  it("is solved by landing the Afterparty friend first", () => {
    let state = walk(openPuzzle("p34-chain"), [playCard(GREMLIN), playCard(INFLUENCE)]);
    expect(boardOf(state, 1), "Chain fired and cleared the bodyguard").toHaveLength(0);

    state = walk(state, [attackLeader(MINE)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("does nothing if Bad Influence lands on an empty Afterparty board", () => {
    const state = walk(openPuzzle("p34-chain"), [playCard(INFLUENCE)]);
    expect(unitAt(state, 1, WALL).health, "Chain never triggered").toBe(2);
    const wrong = tryWalk(state, [attackLeader(MINE)]);
    expect(wrong.stoppedAt, "the bodyguard is still up").not.toBeNull();
  });

  it("cannot just trade the attacker into the wall", () => {
    const state = walk(openPuzzle("p34-chain"), [attackUnit(MINE, WALL)]);
    expect(boardOf(state, 1)).toHaveLength(0);
    expect(enemyHealth(state), "the attack was spent on the bodyguard").toBe(2);
  });
});

describe("P35 — Slow Burn (Currents / Scorched timing)", () => {
  const HOT = "viral-hot-take";
  const MINE = "viral-drama-channel";
  const WALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p35-slow-burn");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).health).toBe(2);
    expect(unitAt(state, 0, MINE).attack).toBe(3);
  });

  it("is solved by letting the fire clear the way", () => {
    /**
     * Hot Take deals 1 and Scorches. The burn resolves at the end of the turn of
     * whoever is carrying it — so it is THEIR end of turn that finishes the
     * bodyguard, and your attacker never has to be spent on it.
     */
    let state = walk(openPuzzle("p35-slow-burn"), [playCard(HOT, { at: [{ seat: 1, cardId: WALL }] })]);
    expect(unitAt(state, 1, WALL).health).toBe(1);
    expect(unitAt(state, 1, WALL).statuses.map((s) => s.id)).toContain("scorched");

    state = walk(state, [endTurn, endTurn]);
    expect(boardOf(state, 1), "the burn finished it on their turn").toHaveLength(0);

    state = walk(state, [attackLeader(MINE)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("costs the attacker health if you clear the wall by swinging", () => {
    // the burn does the same job for free, which is the whole point
    const state = walk(openPuzzle("p35-slow-burn"), [attackUnit(MINE, WALL)]);
    expect(boardOf(state, 1)).toHaveLength(0);
    expect(unitAt(state, 0, MINE).health, "took the counter-attack").toBeLessThan(2);
  });
});

describe("P36 — No Substitute (Survival / Spotlight)", () => {
  const BODIES = "idols-synchronized-debut";
  const WALL = "corp-lobby-greeter";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p36-backup-dancers");
    expect(myHealth(state)).toBe(3);
    expect(state.players[0].hype, "one card or the other").toBe(3);
    expect(boardOf(state, 1)[0]!.attack).toBe(4);
  });

  it("is survived by the one body that has to be attacked", () => {
    const state = walk(openPuzzle("p36-backup-dancers"), [playCard(WALL)]);
    expect(unitAt(state, 0, WALL).keywords).toContain("spotlight");
    const after = passToTheEnemy(state, "p36-backup-dancers");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies behind two bodies that nothing is obliged to attack", () => {
    const state = walk(openPuzzle("p36-backup-dancers"), [playCard(BODIES)]);
    expect(boardOf(state, 0), "two of them, and neither blocks anything").toHaveLength(2);
    for (const unit of boardOf(state, 0)) expect(unit.keywords).not.toContain("spotlight");
    expect(passToTheEnemy(state, "p36-backup-dancers").winner).toBe(1);
  });
});
