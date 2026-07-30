/**
 * Puzzle solutions, P7 onward — same contract as `puzzles.test.ts`.
 *
 * Every puzzle asserts BOTH directions: the intended line wins, and the
 * plausible wrong line does not. A puzzle with two solutions is not a puzzle,
 * and a puzzle whose lethal no longer adds up after a balance change is worse
 * than no puzzle at all — which is why these re-simulate rather than trust the
 * arithmetic that was true when they were written.
 */

import { describe, expect, it } from "vitest";
import {
  attackLeader,
  attackUnit,
  boardOf,
  confluence,
  content,
  endTurn,
  enemyHealth,
  fixation,
  myHealth,
  openPuzzle,
  passToTheEnemy,
  playCard,
  tryWalk,
  unitAt,
  walk,
} from "./puzzleKit";
import { applyIntent } from "../src/engine/reducer";
import { previewAttack } from "../src/engine/combat";

describe("P7 — Louder Each Time (Combo / Repost)", () => {
  const JOKE = "meme-same-joke-but-louder";
  const WALL = "cosplay-foam-knight";
  const OTHER = "demon-popup-impling";
  const MINE = "viral-drama-channel";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p7-louder-each-time");
    expect(state.players[0].hype).toBe(6);
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).health, "two copies at 2 damage each would not be enough").toBe(4);
    expect(unitAt(state, 1, WALL).keywords).toContain("spotlight");
  });

  it("is solved by putting both copies on the bodyguard", () => {
    /**
     * Repost adds 1 for each copy already played this turn, so two copies on one
     * target deal 2 then 3 — five against a four-health wall. Split them and each
     * is a bare 2, which kills nothing.
     */
    const solved = walk(openPuzzle("p7-louder-each-time"), [
      playCard(JOKE, { at: [{ seat: 1, cardId: WALL }] }),
      playCard(JOKE, { at: [{ seat: 1, cardId: WALL }] }),
      attackLeader(MINE),
    ]);
    expect(boardOf(solved, 1).some((c) => c.cardId === WALL), "the wall should be gone").toBe(false);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if the copies are split across two targets", () => {
    const wrong = tryWalk(openPuzzle("p7-louder-each-time"), [
      playCard(JOKE, { at: [{ seat: 1, cardId: WALL }] }),
      playCard(JOKE, { at: [{ seat: 1, cardId: OTHER }] }),
      attackLeader(MINE),
    ]);
    // the wall survives on 2, and Spotlight means the leader cannot be reached
    expect(unitAt(wrong.state, 1, WALL).health).toBe(2);
    expect(wrong.stoppedAt, "attacking the leader past a Spotlight wall must be refused").not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(3);
  });
});

describe("P8 — Rush Hour (Combo / Rushwind)", () => {
  const POSTER = "meme-first-poster";
  const BOMB = "viral-ratio-bomb";
  const WALL = "corp-unpaid-intern";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p8-rush-hour");
    expect(state.players[0].hype, "exactly enough for both cards").toBe(3);
    expect(enemyHealth(state)).toBe(2);
    expect(unitAt(state, 1, WALL).health).toBe(3);
  });

  it("is solved by playing the Raid body first", () => {
    /**
     * Rushwind only pays out when the card is not the first of the turn, so the
     * poster does double duty: it is the enabler that turns Ratio Bomb's 2 into
     * a 3 — exactly the wall's health — and, having Raid, it is also the body
     * that swings once the wall is gone.
     */
    const solved = walk(openPuzzle("p8-rush-hour"), [
      playCard(POSTER),
      playCard(BOMB, { at: [{ seat: 1, cardId: WALL }] }),
      attackLeader(POSTER),
    ]);
    expect(boardOf(solved, 1)).toHaveLength(0);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if the Bomb goes first — 2 damage leaves the wall standing", () => {
    let state = walk(openPuzzle("p8-rush-hour"), [playCard(BOMB, { at: [{ seat: 1, cardId: WALL }] })]);
    expect(unitAt(state, 1, WALL).health, "no Rushwind bonus").toBe(1);

    // the poster now has to finish the wall itself, so nothing reaches the face
    state = walk(state, [playCard(POSTER), attackUnit(POSTER, WALL)]);
    expect(boardOf(state, 1)).toHaveLength(0);
    expect(enemyHealth(state), "the leader was never touched").toBe(2);
    expect(state.winner).toBeNull();
  });
});

describe("P9 — Mutually Assured (Currents / Halo↔Veil)", () => {
  const VEIL = "demon-glitch-familiar";
  const GALE = "meme-first-poster";
  const WALL = "corp-lobby-greeter";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p9-mutually-assured");
    expect(enemyHealth(state)).toBe(2);
    const wall = unitAt(state, 1, WALL);
    expect(wall.health).toBe(3);
    expect(wall.current, "Halo — and Veil is the one Current that beats it").toBe("halo");
    expect(unitAt(state, 0, VEIL).attack).toBe(2);
    expect(unitAt(state, 0, GALE).attack).toBe(2);
  });

  it("is solved by sending the Veil character into the Halo wall", () => {
    /**
     * Both of your characters hit for 2, and the wall has 3 health — so raw
     * attack is not the question. Veil beats Halo, which turns that 2 into a 3
     * and is the only way the wall falls this turn.
     */
    const solved = walk(openPuzzle("p9-mutually-assured"), [
      attackUnit(VEIL, WALL),
      attackLeader(GALE),
    ]);
    expect(boardOf(solved, 1)).toHaveLength(0);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if the Gale character goes in — Gale has no answer to Halo", () => {
    let state = walk(openPuzzle("p9-mutually-assured"), [attackUnit(GALE, WALL)]);
    expect(unitAt(state, 1, WALL).health, "a bare 2 against 3").toBe(1);

    // the Veil character now has to clear the wall, and nothing is left to swing
    state = walk(state, [attackUnit(VEIL, WALL)]);
    expect(enemyHealth(state)).toBe(2);
    expect(state.winner).toBeNull();
  });

  it("cuts both ways — the wall's counter-attack gets the bonus back", () => {
    // Halo beats Veil too, so the trade costs you the character that made it
    const after = walk(openPuzzle("p9-mutually-assured"), [attackUnit(VEIL, WALL)]);
    expect(boardOf(after, 0).some((c) => c.cardId === VEIL), "1 attack + 1 Halo bonus is exactly its 2 health").toBe(false);
  });
});

describe("P10 — Blank Stare (Survival / Cancel)", () => {
  const CANCEL = "algo-shadowban-notice";
  const BIG = "cosplay-token-hall-champion";
  const SMALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p10-blank-stare");
    expect(myHealth(state)).toBe(4);
    expect(state.players[0].hype).toBe(3);
    expect(unitAt(state, 1, BIG).attack + unitAt(state, 1, SMALL).attack, "more than you can take").toBe(5);
  });

  it("is survived by blanking the big one", () => {
    const state = walk(openPuzzle("p10-blank-stare"), [playCard(CANCEL, { at: [{ seat: 1, cardId: BIG }] })]);
    const after = passToTheEnemy(state, "p10-blank-stare");
    expect(myHealth(after), "only the 1-attack body could swing").toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies if the small one is blanked instead", () => {
    const state = walk(openPuzzle("p10-blank-stare"), [playCard(CANCEL, { at: [{ seat: 1, cardId: SMALL }] })]);
    const after = passToTheEnemy(state, "p10-blank-stare");
    expect(myHealth(after)).toBeLessThanOrEqual(0);
    expect(after.winner).toBe(1);
  });

  it("dies if nothing is blanked at all", () => {
    const after = passToTheEnemy(openPuzzle("p10-blank-stare"), "p10-blank-stare");
    expect(after.winner).toBe(1);
  });

  it("leaves the blanked character unable to attack", () => {
    const state = walk(openPuzzle("p10-blank-stare"), [playCard(CANCEL, { at: [{ seat: 1, cardId: BIG }] })]);
    const blanked = unitAt(state, 1, BIG);
    expect(blanked.statuses.map((s) => s.id)).toContain("cancelled");
    expect(() =>
      applyIntent(state, content, {
        type: "attack",
        seat: 1,
        attackerInstanceId: blanked.instanceId,
        target: { kind: "leader", seat: 0 },
      })
    ).toThrow();
  });
});

describe("P11 — Shield Wall (Survival / Shielded)", () => {
  const SHIELD = "cosplay-sacred-adhesive";
  const WALL = "corp-unpaid-intern";
  const DECOY = "token-backup-idol";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p11-shield-wall");
    expect(myHealth(state)).toBe(3);
    expect(boardOf(state, 1)).toHaveLength(2);
    expect(unitAt(state, 0, WALL).keywords).toContain("spotlight");
  });

  it("is survived by shielding the character they are forced to hit", () => {
    /**
     * Shielded negates one instance of damage, and Spotlight decides which
     * instance that is. On the wall it eats the first four-attack swing outright
     * and the wall is still standing to soak the second.
     */
    const state = walk(openPuzzle("p11-shield-wall"), [playCard(SHIELD, { at: [{ seat: 0, cardId: WALL }] })]);
    const after = passToTheEnemy(state, "p11-shield-wall");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies if the shield goes on the character nothing is allowed to attack", () => {
    const state = walk(openPuzzle("p11-shield-wall"), [playCard(SHIELD, { at: [{ seat: 0, cardId: DECOY }] })]);
    const after = passToTheEnemy(state, "p11-shield-wall");
    expect(myHealth(after)).toBeLessThanOrEqual(0);
    expect(after.winner).toBe(1);
  });

  it("dies with no shield at all", () => {
    expect(passToTheEnemy(openPuzzle("p11-shield-wall"), "p11-shield-wall").winner).toBe(1);
  });
});

describe("P12 — Second Wind (Lethal / Fixation)", () => {
  const MINE = "demon-popup-impling";
  const WALL = "goth-crypt-usher";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p12-second-wind");
    expect(state.players[0].obsession, "exactly one Redline").toBe(3);
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).keywords).toContain("spotlight");
  });

  it("is solved by clearing the bodyguard and swinging again", () => {
    const solved = walk(openPuzzle("p12-second-wind"), [
      attackUnit(MINE, WALL),
      fixation("fixation", { seat: 0, cardId: MINE }),
      attackLeader(MINE),
    ]);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("falls short without the second swing", () => {
    const wrong = tryWalk(openPuzzle("p12-second-wind"), [attackUnit(MINE, WALL), attackLeader(MINE)]);
    expect(wrong.stoppedAt, "a character that already swung cannot swing again").not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(3);
  });

  it("wastes the Fixation if it is spent before the bodyguard falls", () => {
    // Redline refreshes an attack that has not been used, so it buys nothing —
    // and it costs 2 of your own health on the way past
    const wrong = tryWalk(openPuzzle("p12-second-wind"), [
      fixation("fixation", { seat: 0, cardId: MINE }),
      attackUnit(MINE, WALL),
      attackLeader(MINE),
    ]);
    expect(wrong.stoppedAt).not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(3);
  });
});

describe("P13 — Sanctuary (Currents / Confluence)", () => {
  const PACKET = "corp-onboarding-packet";
  const CHANT = "idols-fan-chant";
  const WALL = "corp-unpaid-intern";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p13-sanctuary");
    expect(state.players[0].hype, "one Hype, two cards").toBe(1);
    const wall = unitAt(state, 0, WALL);
    expect(wall.health).toBe(1);
    expect(wall.statuses.map((s) => s.id)).toContain("scorched");
  });

  it("is solved by playing the card that pays for itself first", () => {
    /**
     * Onboarding Packet costs 1 and gives 1 back, so it is free in Hype and yet
     * still a Root card played this turn — which is the half of Sanctuary that
     * one Hype could not otherwise buy.
     */
    let state = walk(openPuzzle("p13-sanctuary"), [playCard(PACKET)]);
    expect(state.players[0].hype, "spent one, got one back").toBe(1);

    state = walk(state, [playCard(CHANT, { at: [{ seat: 0, cardId: WALL }] })]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["root", "halo"]));

    state = walk(state, [confluence("sanctuary", { at: { seat: 0, cardId: WALL } })]);
    const wall = unitAt(state, 0, WALL);
    expect(wall.statuses.map((s) => s.id), "Sanctuary scrubs the burn off").not.toContain("scorched");
    expect(wall.statuses.map((s) => s.id)).toContain("shielded");

    const after = passToTheEnemy(state, "p13-sanctuary");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("cannot afford the second card if the free one goes last", () => {
    const wrong = tryWalk(openPuzzle("p13-sanctuary"), [
      playCard(CHANT, { at: [{ seat: 0, cardId: WALL }] }),
      playCard(PACKET),
    ]);
    expect(wrong.stoppedAt, "no Hype left for the Root card").not.toBeNull();
    expect(wrong.state.players[0].currentsPlayedThisTurn).not.toContain("root");
  });

  it("burns to death with no Confluence", () => {
    const after = passToTheEnemy(openPuzzle("p13-sanctuary"), "p13-sanctuary");
    expect(after.winner).toBe(1);
  });
});

describe("P14 — Starflare (Currents / Confluence vs Shielded)", () => {
  const CINDER = "viral-hype-intern";
  const PULSE = "algo-preroll-runner";
  const MINE = "viral-drama-channel";
  const WALL = "cosplay-foam-knight";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p14-starflare");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).statuses.map((s) => s.id)).toContain("shielded");
  });

  it("is solved by lighting Starflare, which ignores the shield", () => {
    let state = walk(openPuzzle("p14-starflare"), [playCard(CINDER), playCard(PULSE)]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["cinder", "pulse"]));

    state = walk(state, [confluence("starflare", { at: { seat: 1, cardId: WALL } })]);
    expect(boardOf(state, 1), "4 damage through a Shielded 2/4").toHaveLength(0);

    state = walk(state, [attackLeader(MINE)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("is stopped cold by the shield if you just attack the wall", () => {
    const state = walk(openPuzzle("p14-starflare"), [attackUnit(MINE, WALL)]);
    const wall = unitAt(state, 1, WALL);
    expect(wall.health, "Shielded negated the whole swing").toBe(4);
    expect(wall.statuses.map((s) => s.id), "and the shield is spent").not.toContain("shielded");
    expect(enemyHealth(state)).toBe(3);
  });
});

describe("P15 — Cold Water (Currents / Pulse beats Tide)", () => {
  const PULSE = "idols-voltage-idol";
  const CINDER = "demon-popup-impling";
  const WALL = "cosplay-foam-knight";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p15-cold-water");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 0, PULSE).attack).toBe(3);
    expect(unitAt(state, 0, CINDER).attack, "the same attack, so the Current is the whole question").toBe(3);
    expect(unitAt(state, 1, WALL).health).toBe(4);
    expect(unitAt(state, 1, WALL).current).toBe("tide");
  });

  it("is solved by sending the Pulse character into the Tide wall", () => {
    const solved = walk(openPuzzle("p15-cold-water"), [attackUnit(PULSE, WALL), attackLeader(CINDER)]);
    expect(boardOf(solved, 1)).toHaveLength(0);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails if the Cinder character goes in — three against four", () => {
    let state = walk(openPuzzle("p15-cold-water"), [attackUnit(CINDER, WALL)]);
    expect(unitAt(state, 1, WALL).health).toBe(1);
    state = walk(state, [attackUnit(PULSE, WALL)]);
    expect(enemyHealth(state), "nothing was left to swing at the leader").toBe(3);
    expect(state.winner).toBeNull();
  });
});

describe("P16 — Weather Front (Survival / Weakened)", () => {
  const WEAKEN = "grass-weather-front";
  const HEAL = "corp-approved-messaging";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p16-weather-front");
    expect(myHealth(state)).toBe(4);
    expect(state.players[0].hype, "exactly one of the two cards").toBe(4);
    const incoming = boardOf(state, 1).reduce((sum, c) => sum + c.attack, 0);
    expect(incoming, "more than your health").toBe(6);
  });

  it("is survived by taking their attack away", () => {
    /**
     * Weakened 2 turns 3+3 into 1+1. Healing 2 turns 4 health into 6 against 6
     * damage — which is exactly lethal, and exactly the trap.
     */
    const state = walk(openPuzzle("p16-weather-front"), [playCard(WEAKEN)]);
    const after = passToTheEnemy(state, "p16-weather-front");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies if you patch the wound instead", () => {
    const state = walk(openPuzzle("p16-weather-front"), [playCard(HEAL, { at: [{ seat: 0, cardId: "token-backup-idol" }] })]);
    const after = passToTheEnemy(state, "p16-weather-front");
    expect(after.winner).toBe(1);
  });

  it("cannot afford both", () => {
    const state = walk(openPuzzle("p16-weather-front"), [playCard(WEAKEN)]);
    expect(state.players[0].hype).toBe(0);
  });
});

describe("P17 — Sandstorm (Currents / the right two Currents)", () => {
  const ROOT = "grass-trail-journal";
  const GALE = "meme-bump-the-thread";
  const PULSE = "neutral-clip-it";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p17-sandstorm");
    expect(myHealth(state)).toBe(5);
    expect(state.players[0].hype).toBe(3);
    expect(boardOf(state, 1).reduce((sum, c) => sum + c.attack, 0)).toBe(6);
  });

  it("is survived by playing Root and Gale, then Sandstorm", () => {
    let state = walk(openPuzzle("p17-sandstorm"), [playCard(ROOT), playCard(GALE)]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["root", "gale"]));

    state = walk(state, [confluence("sandstorm")]);
    for (const unit of boardOf(state, 1)) {
      expect(unit.statuses.map((s) => s.id), `${unit.cardId} should be Weakened`).toContain("weakened");
    }

    const after = passToTheEnemy(state, "p17-sandstorm");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies on the wrong pair — Gale and Pulse light Tempest, which changes nothing here", () => {
    /**
     * The trap is not "forgetting the Confluence" — it is getting one. Tempest
     * deals 1 to up to 3 enemies, and every body on that board has more than 1
     * health, so it removes no attack at all.
     */
    let state = walk(openPuzzle("p17-sandstorm"), [playCard(PULSE, { at: [{ seat: 1, cardId: "algo-rerun-anchor" }] }), playCard(GALE)]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["pulse", "gale"]));

    state = walk(state, [confluence("tempest", { choice: 0 })]);
    const after = passToTheEnemy(state, "p17-sandstorm");
    expect(after.winner).toBe(1);
  });

  it("dies with no Confluence at all", () => {
    expect(passToTheEnemy(openPuzzle("p17-sandstorm"), "p17-sandstorm").winner).toBe(1);
  });
});

describe("P18 — Obsessed (Survival / Obsession)", () => {
  const WALL = "corp-lobby-greeter";
  const TEMPTATION = "viral-hype-intern";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p18-obsessed");
    expect(myHealth(state)).toBe(3);
    expect(state.players[0].obsession, "one short of the danger zone").toBe(7);
    expect(boardOf(state, 1).reduce((sum, c) => sum + c.attack, 0)).toBe(2);
  });

  it("is survived by putting up a wall and staying under eight", () => {
    const state = walk(openPuzzle("p18-obsessed"), [playCard(WALL)]);
    expect(state.players[0].obsession).toBe(7);
    const after = passToTheEnemy(state, "p18-obsessed");
    expect(myHealth(after)).toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies to the card that looks free — Obsessed turns 2 damage into 4", () => {
    const state = walk(openPuzzle("p18-obsessed"), [playCard(TEMPTATION)]);
    expect(state.players[0].obsession, "over the threshold").toBe(8);
    const after = passToTheEnemy(state, "p18-obsessed");
    expect(after.winner).toBe(1);
  });
});

describe("P19 — Bloom (Currents / Confluence)", () => {
  const TIDE = "algo-watch-later-clerk";
  const ROOT = "grass-phone-basket";
  const PULSE = "neutral-clip-it";
  const WALL = "cosplay-foam-knight";
  const BIG = "meme-chronic-poster";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p19-bloom");
    expect(myHealth(state), "one hit from over").toBe(1);
    expect(unitAt(state, 0, WALL).health).toBe(1);
    expect(unitAt(state, 0, WALL).maxHealth, "room for the mend to matter").toBe(4);
    expect(boardOf(state, 1), "one to kill the wall, one to walk past it").toHaveLength(2);
  });

  it("is survived by playing Tide and Root, then Blooming the wall", () => {
    let state = walk(openPuzzle("p19-bloom"), [
      playCard(TIDE),
      playCard(ROOT, { at: [{ seat: 1, cardId: BIG }] }),
    ]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["tide", "root"]));

    state = walk(state, [confluence("bloom", { at: { seat: 0, cardId: WALL } })]);
    expect(unitAt(state, 0, WALL).health, "mended back to full").toBe(4);

    const after = passToTheEnemy(state, "p19-bloom");
    expect(myHealth(after), "the wall outlasted the first swing").toBeGreaterThan(0);
    expect(after.winner).not.toBe(1);
  });

  it("dies on the Pulse card — it pairs with neither, and eats the whole budget", () => {
    const state = walk(openPuzzle("p19-bloom"), [playCard(PULSE, { at: [{ seat: 1, cardId: BIG }] })]);
    expect(state.players[0].hype, "nothing left for a second Current").toBe(0);
    expect(passToTheEnemy(state, "p19-bloom").winner).toBe(1);
  });

  it("dies with no Confluence at all", () => {
    expect(passToTheEnemy(openPuzzle("p19-bloom"), "p19-bloom").winner).toBe(1);
  });
});

describe("P20 — Full Hand (Economy / the hand limit)", () => {
  const DRAW = "demon-sign-here";
  const CHANT = "idols-fan-chant";
  const IDOL = "token-backup-idol";
  const FINISHER = "meme-first-poster";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p20-full-hand");
    // the turn already drew one card, which is what filled the hand
    expect(state.players[0].hand.length, "completely full").toBe(10);
    expect(state.players[0].deck.map((c) => c.cardId), "the finisher is second").toEqual([CHANT, FINISHER]);
    expect(enemyHealth(state)).toBe(3);
  });

  it("is solved by making room before drawing", () => {
    /**
     * The draw spell frees its own slot as it leaves your hand, so a one-card
     * draw would always fit. This one fetches two — the first fills the gap it
     * made and the second is burned unless a slot was cleared beforehand.
     */
    let state = walk(openPuzzle("p20-full-hand"), [playCard(CHANT, { at: [{ seat: 0, cardId: IDOL }] })]);
    expect(state.players[0].hand.length).toBe(9);

    state = walk(state, [playCard(DRAW)]);
    expect(state.players[0].hand.some((c) => c.cardId === FINISHER), "the draw landed").toBe(true);

    state = walk(state, [playCard(FINISHER), attackLeader(FINISHER), attackLeader(IDOL)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("burns the finisher if you draw into a full hand", () => {
    const state = walk(openPuzzle("p20-full-hand"), [playCard(DRAW)]);
    expect(state.players[0].hand.length).toBe(10);
    expect(state.players[0].hand.some((c) => c.cardId === FINISHER), "burned, not held").toBe(false);
    expect(state.players[0].discard.some((c) => c.cardId === FINISHER)).toBe(true);
  });
});

describe("P21 — Cold Start (Lethal / Raid)", () => {
  const BIG = "demon-popup-impling";
  const RAID = "meme-first-poster";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p21-cold-start");
    expect(enemyHealth(state)).toBe(2);
    expect(boardOf(state, 0), "nothing on the board to swing with").toHaveLength(0);
  });

  it("is solved by playing the one that can attack the turn it lands", () => {
    const solved = walk(openPuzzle("p21-cold-start"), [playCard(RAID), attackLeader(RAID)]);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("fails with the bigger body — three attack that cannot swing is zero", () => {
    const wrong = tryWalk(openPuzzle("p21-cold-start"), [playCard(BIG), attackLeader(BIG)]);
    expect(wrong.stoppedAt, "summoning sickness").not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(2);
  });
});

describe("P22 — Collab (Combo / Collab)", () => {
  const IMP = "demon-thermal-imp";
  const FAMILIAR = "demon-glitch-familiar";
  const MINE = "viral-drama-channel";
  const WALL = "cosplay-foam-knight";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p22-collab");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).health).toBe(4);
    expect(unitAt(state, 0, MINE).attack, "three against four").toBe(3);
  });

  it("is solved by landing the other Demon first", () => {
    /**
     * Collab checks the board when the card lands, so the Familiar has to be
     * standing before the Imp arrives. It brings a Glitchling with it, which is
     * the second Demon the Imp is looking for.
     */
    let state = walk(openPuzzle("p22-collab"), [playCard(FAMILIAR), playCard(IMP)]);
    expect(unitAt(state, 0, IMP).attack, "1 base, +1 from Collab").toBe(2);
  });

  it("gets no bonus if the Imp lands on an empty Demon board", () => {
    const state = walk(openPuzzle("p22-collab"), [playCard(IMP)]);
    expect(unitAt(state, 0, IMP).attack, "no other Demon was standing").toBe(1);
  });
});

describe("P23 — Storm Warning (Currents / Tempest's sweep)", () => {
  const GALE = "meme-bump-the-thread";
  const PULSE = "neutral-clip-it";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p23-tempest-sweep");
    expect(myHealth(state)).toBe(3);
    expect(boardOf(state, 1), "four bodies, four damage").toHaveLength(4);
  });

  it("is survived by sweeping the row", () => {
    let state = walk(openPuzzle("p23-tempest-sweep"), [
      playCard(GALE),
      playCard(PULSE, { at: [{ seat: 1, cardId: "token-follower" }] }),
    ]);
    // Tempest's sweep asks for up to three targets; the fourth is Clip It's job
    state = walk(state, [
      confluence("tempest", { choice: 0, ats: [0, 1, 2].map((nth) => ({ seat: 1 as const, cardId: "token-follower", nth })) }),
    ]);
    expect(boardOf(state, 1).length, "three swept, one clipped").toBe(0);

    const after = passToTheEnemy(state, "p23-tempest-sweep");
    expect(myHealth(after)).toBe(3);
    expect(after.winner).not.toBe(1);
  });

  it("dies to one clean kill — three bodies is still three damage", () => {
    const state = walk(openPuzzle("p23-tempest-sweep"), [
      playCard(PULSE, { at: [{ seat: 1, cardId: "token-follower" }] }),
    ]);
    expect(boardOf(state, 1)).toHaveLength(3);
    expect(passToTheEnemy(state, "p23-tempest-sweep").winner).toBe(1);
  });
});

describe("P24 — Blackflame (Currents / the Confluence as removal)", () => {
  const CINDER = "viral-hype-intern";
  const VEIL = "demon-sign-here";
  const MINE = "viral-drama-channel";
  const WALL = "goth-crypt-usher";

  it("deals a hand with no damage in it", () => {
    const state = openPuzzle("p24-blackflame");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 1, WALL).health).toBe(2);
    expect(unitAt(state, 1, WALL).keywords).toContain("spotlight");
  });

  it("is solved by lighting Blackflame", () => {
    let state = walk(openPuzzle("p24-blackflame"), [playCard(CINDER), playCard(VEIL)]);
    expect(state.players[0].currentsPlayedThisTurn).toEqual(expect.arrayContaining(["cinder", "veil"]));

    state = walk(state, [confluence("blackflame", { at: { seat: 1, cardId: WALL } })]);
    expect(boardOf(state, 1)).toHaveLength(0);

    state = walk(state, [attackLeader(MINE)]);
    expect(enemyHealth(state)).toBeLessThanOrEqual(0);
    expect(state.winner).toBe(0);
  });

  it("cannot get past the bodyguard on one Current", () => {
    const wrong = tryWalk(openPuzzle("p24-blackflame"), [playCard(CINDER), attackLeader(MINE)]);
    expect(wrong.stoppedAt, "Spotlight refuses the swing").not.toBeNull();
    expect(enemyHealth(wrong.state)).toBe(3);
  });
});

describe("P25 — Inspired (Combo / Inspire)", () => {
  const CHANT = "idols-fan-chant";
  const DIVA = "idols-encore-diva";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p25-inspire");
    expect(enemyHealth(state)).toBe(6);
    expect(unitAt(state, 0, DIVA).attack).toBe(3);
    expect(unitAt(state, 0, DIVA).keywords).toContain("inspire");
  });

  it("is solved because the support triggers Inspire on top of the buff", () => {
    // +2 from the card, +1 more because Inspire fires on being supported
    const state = walk(openPuzzle("p25-inspire"), [playCard(CHANT, { at: [{ seat: 0, cardId: DIVA }] })]);
    expect(unitAt(state, 0, DIVA).attack).toBe(6);

    const solved = walk(state, [attackLeader(DIVA)]);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("falls three short if the buff is never played", () => {
    const state = walk(openPuzzle("p25-inspire"), [attackLeader(DIVA)]);
    expect(enemyHealth(state)).toBe(3);
    expect(state.winner).toBeNull();
  });
});

describe("P26 — Flow (Combo / Flow)", () => {
  const BOUNCE = "algo-re-upload";
  const ANCHOR = "algo-rerun-anchor";
  const IDOL = "token-backup-idol";

  it("deals the board the brief describes", () => {
    const state = openPuzzle("p26-flow");
    expect(enemyHealth(state)).toBe(3);
    expect(unitAt(state, 0, ANCHOR).attack).toBe(2);
    expect(unitAt(state, 0, ANCHOR).keywords).toContain("flow");
  });

  it("is solved by bouncing the OTHER character", () => {
    const state = walk(openPuzzle("p26-flow"), [playCard(BOUNCE, { at: [{ seat: 0, cardId: IDOL }] })]);
    expect(unitAt(state, 0, ANCHOR).attack, "Flow fired").toBe(3);

    const solved = walk(state, [attackLeader(ANCHOR)]);
    expect(enemyHealth(solved)).toBeLessThanOrEqual(0);
    expect(solved.winner).toBe(0);
  });

  it("throws the win away by bouncing the anchor itself", () => {
    const state = walk(openPuzzle("p26-flow"), [playCard(BOUNCE, { at: [{ seat: 0, cardId: ANCHOR }] })]);
    expect(boardOf(state, 0).some((c) => c.cardId === ANCHOR), "your only attacker is in your hand").toBe(false);
    expect(enemyHealth(state)).toBe(3);
  });

  it("falls one short with no bounce at all", () => {
    const state = walk(openPuzzle("p26-flow"), [attackLeader(ANCHOR)]);
    expect(enemyHealth(state)).toBe(1);
    expect(state.winner).toBeNull();
  });
});
