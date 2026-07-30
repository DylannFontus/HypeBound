/**
 * Balance harness — the project's first actual balance data.
 *
 * Opt-in, because it plays hundreds of matches: `npm run balance`. It is a
 * measuring instrument first and a regression guard second, so the assertions
 * are deliberately wide — they fire on egregious imbalance, not on the ordinary
 * spread you would expect from twenty leaders and a naive deck builder.
 *
 * Read the caveats before trusting a number:
 *
 * - Both sides use `autoBuildDeck`, which fills a curve and builds no synergy.
 *   A leader whose faction rewards combos is systematically undersold here.
 * - Both sides use the same AI, so this measures decks and leaders, not skill.
 * - One match per ordered pair is a small sample. Raise it with BALANCE_ROUNDS.
 *
 * What it IS good for: spotting a leader that wins 80% of its games, confirming
 * the first-seat advantage is not enormous, and checking how often a trigger
 * actually fires across a whole population of matches. That last one is why this
 * exists at all — Afterparty and start-of-turn effects were resolving twice per
 * round until recently, and nothing in the suite would have noticed.
 */

import { describe, expect, it } from "vitest";
import { getContent, selectableLeaders } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { starterDecks } from "../src/game/progression/data";
import { loanerDeckFor, tourOpponentDeck } from "../src/game/progression/grandTour";
import type { AiDifficulty, DeckList, EngineEvent, MatchState, Seat } from "../src/engine/types";

// the project has no @types/node and does not need it for one env read
declare const process: { env: Record<string, string | undefined> };

const ENABLED = process.env["BALANCE"] === "1";
const ROUNDS = Number(process.env["BALANCE_ROUNDS"] ?? "1");
const DIFFICULTY = (process.env["BALANCE_AI"] ?? "casual") as AiDifficulty;
const ONLY = process.env["BALANCE_ONLY"] ?? "all";
const wants = (part: string): boolean => ENABLED && (ONLY === "all" || ONLY === part);

const content = getContent();
const leaders = selectableLeaders(content).sort((a, b) => (a.id < b.id ? -1 : 1));

interface MatchResult {
  winner: Seat | "draw" | null;
  turns: number;
  illegal: number;
  /** how many times each trigger id fired, across the whole match */
  triggers: Record<string, number>;
}

type BuildMode = "synergy" | "curve";

/**
 * `modes` omitted means "however the game builds decks today".
 *
 * The round robin must never pin a build mode: its whole job is to report on
 * what ships, and a harness measuring a non-default builder would produce a
 * table describing a game nobody plays. Only the mirror comparison names modes,
 * because comparing them is the entire point of it.
 */
function playMatch(
  seed: number,
  leaderA: string,
  leaderB: string,
  modes?: [BuildMode, BuildMode]
): MatchResult {
  const build = (id: string, name: string, index: 0 | 1) =>
    modes ? autoBuildDeck(content, id, name, modes[index]) : autoBuildDeck(content, id, name);
  return playDecks(seed, build(leaderA, "A", 0), build(leaderB, "B", 1));
}

/** The same match, given the two decks outright rather than two leader ids. */
function playDecks(seed: number, deckA: DeckList, deckB: DeckList): MatchResult {
  let state: MatchState = createMatch({ seed, decks: [deckA, deckB], firstSeat: 0 }, content);
  const profiles = [getAiProfile(DIFFICULTY), getAiProfile(DIFFICULTY)];
  const triggers: Record<string, number> = {};
  let illegal = 0;
  let intents = 0;

  const count = (events: EngineEvent[]): void => {
    for (const event of events) {
      if (event.e === "triggerQueued") triggers[event.trigger] = (triggers[event.trigger] ?? 0) + 1;
    }
  };

  while (state.phase === "mulligan") {
    const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    const result = applyIntent(state, content, decision.intent);
    state = result.state;
    count(result.events);
  }

  while (state.winner === null && intents < 700) {
    const seat = state.activeSeat;
    const decision = chooseIntent(state, content, seat, profiles[seat]!);
    if (!decision) break;
    try {
      const result = applyIntent(state, content, decision.intent);
      state = result.state;
      count(result.events);
    } catch {
      illegal += 1;
      state = applyIntent(state, content, { type: "endTurn", seat }).state;
    }
    intents += 1;
  }

  return { winner: state.winner, turns: state.turn, illegal, triggers };
}

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);

describe.skipIf(!ENABLED)("balance", () => {
  /**
   * Does building for synergy actually build a better deck?
   *
   * A win-rate table cannot answer this: a better builder can legitimately widen
   * the spread if some factions have stronger payoffs than others. The only
   * honest test is a mirror — same leader, same seed, one deck built each way,
   * playing both seats so the first-seat advantage cancels.
   */
  it.skipIf(!wants("mirror"))("settles synergy-vs-curve deck building with matches", { timeout: 30 * 60 * 1000 }, () => {
    let synergyWins = 0;
    let curveWins = 0;
    const perLeader: string[] = [];
    let seed = 500;

    for (const leader of leaders) {
      let mine = 0;
      let theirs = 0;
      for (let round = 0; round < ROUNDS; round++) {
        // synergy in seat 0, then in seat 1, so seat order cannot decide it
        const a = playMatch((seed += 7919), leader.id, leader.id, ["synergy", "curve"]);
        if (a.winner === 0) mine += 1;
        else if (a.winner === 1) theirs += 1;

        const b = playMatch((seed += 7919), leader.id, leader.id, ["curve", "synergy"]);
        if (b.winner === 1) mine += 1;
        else if (b.winner === 0) theirs += 1;
      }
      synergyWins += mine;
      curveWins += theirs;
      perLeader.push(`  ${String(mine).padStart(2)}–${String(theirs).padEnd(2)}  ${leader.name}`);
    }

    const total = synergyWins + curveWins;
    console.log(`\n=== SYNERGY vs CURVE — ${total} mirror matches, ${DIFFICULTY} AI`);
    console.log(`synergy ${synergyWins} (${pct(synergyWins, total)}) — curve ${curveWins} (${pct(curveWins, total)})`);
    console.log(perLeader.join("\n"));
    console.log("");

    // no assertion on which wins: this is the measurement that decides which
    // builder ships, and a test that demanded an answer would prejudge it
    expect(total).toBeGreaterThan(0);
  });

  /**
   * Is the Grand Tour actually winnable?
   *
   * §3.4 asks a new player to win one match with each faction's loaner deck, and
   * a stop they cannot pass is nine tenths of the game locked behind a grind. The
   * question is about *decks* rather than skill — both seats use the same AI — so
   * it belongs here and not in a browser walk, where measuring it means playing
   * real matches through a renderer at a minute apiece.
   *
   * Both seats are played, because a starter-deck match is short and the
   * first-seat advantage is proportionally large at that power level. The guard
   * is on the floor rather than the spread: a faction whose loaner never wins is
   * a stop nobody can pass, and that is a bug in the mode rather than a taste
   * question about balance.
   */
  it.skipIf(!wants("tour"))("measures whether a loaner deck can win its Grand Tour match", { timeout: 30 * 60 * 1000 }, () => {
    const rounds = Number(process.env["BALANCE_ROUNDS"] ?? "6");
    const rows: string[] = [];
    let loanerWins = 0;
    let decided = 0;
    let seed = 90210;

    for (const stop of starterDecks()) {
      const loaner = loanerDeckFor(content, stop.factionId);
      const rival = tourOpponentDeck(content, stop.factionId);
      if (!loaner || !rival) continue;

      let mine = 0;
      let played = 0;
      for (let round = 0; round < rounds; round++) {
        // loaner first, then loaner second, so seat order cannot decide it
        const a = playDecks((seed += 7919), loaner, rival);
        if (a.winner === 0) mine += 1;
        if (a.winner === 0 || a.winner === 1) played += 1;

        const b = playDecks((seed += 7919), rival, loaner);
        if (b.winner === 1) mine += 1;
        if (b.winner === 0 || b.winner === 1) played += 1;
      }
      loanerWins += mine;
      decided += played;
      rows.push(`  ${pct(mine, played).padStart(6)}  ${stop.factionId} vs ${rival.name} (${mine}/${played})`);
    }

    console.log(`\n=== GRAND TOUR — ${decided} loaner matches, ${DIFFICULTY} AI, ${rounds} round(s) per faction`);
    console.log(`the loaner deck won ${loanerWins} (${pct(loanerWins, decided)})`);
    console.log(rows.join("\n"));
    console.log("");

    expect(decided, "no tour match reached a result").toBeGreaterThan(0);
    // wide on purpose — this is a measurement, not a target. What it must catch
    // is a stop that is impossible or free, either of which breaks the mode.
    expect(loanerWins / decided, "loaner decks essentially cannot win their own tour match").toBeGreaterThan(0.2);
    expect(loanerWins / decided, "loaner matches are a formality").toBeLessThan(0.8);
  });

  it.skipIf(!wants("roundrobin"))("plays a full round robin and reports what it found", { timeout: 30 * 60 * 1000 }, () => {
      const wins = new Map<string, number>();
      const played = new Map<string, number>();
      const factionWins = new Map<string, number>();
      const factionPlayed = new Map<string, number>();
      const triggerTotals: Record<string, number> = {};
      const turnCounts: number[] = [];
      let firstSeatWins = 0;
      let decided = 0;
      let draws = 0;
      let stalled = 0;
      let illegal = 0;

      const bump = (map: Map<string, number>, key: string, by = 1): void => {
        map.set(key, (map.get(key) ?? 0) + by);
      };

      let seed = 1;
      for (const a of leaders) {
        for (const b of leaders) {
          if (a.id === b.id) continue;
          for (let round = 0; round < ROUNDS; round++) {
            const result = playMatch((seed += 7919), a.id, b.id);
            illegal += result.illegal;
            turnCounts.push(result.turns);
            bump(played, a.id);
            bump(played, b.id);
            bump(factionPlayed, a.faction);
            bump(factionPlayed, b.faction);
            for (const [trigger, n] of Object.entries(result.triggers)) {
              triggerTotals[trigger] = (triggerTotals[trigger] ?? 0) + n;
            }

            if (result.winner === null) stalled += 1;
            else if (result.winner === "draw") draws += 1;
            else {
              decided += 1;
              if (result.winner === 0) firstSeatWins += 1;
              const winner = result.winner === 0 ? a : b;
              bump(wins, winner.id);
              bump(factionWins, winner.faction);
            }
          }
        }
      }

      const matches = turnCounts.length;
      const avgTurns = turnCounts.reduce((s, t) => s + t, 0) / matches;
      const sortedTurns = [...turnCounts].sort((x, y) => x - y);
      const median = sortedTurns[Math.floor(sortedTurns.length / 2)]!;

      const rate = (id: string): number => (wins.get(id) ?? 0) / Math.max(1, played.get(id) ?? 0);
      const ranked = [...leaders].sort((x, y) => rate(y.id) - rate(x.id));

      console.log(`\n=== BALANCE REPORT — ${matches} matches, ${DIFFICULTY} AI, ${ROUNDS} round(s) per ordered pair`);
      console.log(`decided ${decided}, draws ${draws}, stalled ${stalled}, illegal intents ${illegal}`);
      console.log(`first seat won ${pct(firstSeatWins, decided)} of decided matches`);
      console.log(`match length: mean ${avgTurns.toFixed(1)} turns, median ${median}, range ${sortedTurns[0]}–${sortedTurns[sortedTurns.length - 1]}`);

      /**
       * The design writes the clock down, so measure against it.
       *
       * `docs/design/10-balance-assumptions.md`: "aggro must be able to kill by
       * turn 7; control must be able to stop it by turn 6", and a match ending
       * below turn 6 "breaches the five-minute floor". A mean sitting on the
       * aggro clock means the average deck is killing as fast as the fastest
       * intended one, which is a balance fact no win-rate table shows.
       */
      const AGGRO_FLOOR = 6;
      const belowFloor = turnCounts.filter((t) => t < AGGRO_FLOOR).length;
      console.log(
        `matches ending before turn ${AGGRO_FLOOR} (the design's floor): ${belowFloor} of ${matches} — ${pct(belowFloor, matches)}`
      );

      console.log(`\n-- by leader`);
      for (const leader of ranked) {
        console.log(
          `  ${pct(wins.get(leader.id) ?? 0, played.get(leader.id) ?? 0).padStart(6)}  ${leader.name} (${leader.faction})`
        );
      }

      console.log(`\n-- by faction`);
      const factions = [...factionPlayed.keys()].sort(
        (x, y) => (factionWins.get(y) ?? 0) / (factionPlayed.get(y) ?? 1) - (factionWins.get(x) ?? 0) / (factionPlayed.get(x) ?? 1)
      );
      for (const faction of factions) {
        console.log(`  ${pct(factionWins.get(faction) ?? 0, factionPlayed.get(faction) ?? 0).padStart(6)}  ${faction}`);
      }

      /**
       * Trigger census.
       *
       * The number to watch is Afterparty and startOfTurn per match. They used to
       * fire on both players' turns, which is a doubling no win-rate table would
       * have made obvious. A future change that re-breaks the scoping shows up
       * here as these figures roughly doubling.
       */
      console.log(`\n-- triggers fired per match`);
      for (const [trigger, total] of Object.entries(triggerTotals).sort((x, y) => y[1] - x[1])) {
        console.log(`  ${(total / matches).toFixed(2).padStart(7)}  ${trigger}`);
      }
      console.log("");

      // --- guards, deliberately wide ----------------------------------------
      expect(illegal, "the AI produced illegal intents").toBe(0);
      expect(stalled, "matches that never reached a result").toBe(0);
      expect(firstSeatWins / decided).toBeGreaterThan(0.35);
      expect(firstSeatWins / decided).toBeLessThan(0.65);
      expect(avgTurns).toBeGreaterThan(4);
      expect(avgTurns).toBeLessThan(40);
      // wide on purpose: this is currently ~10%, and it is a number to watch
      // rather than a line the game already sits comfortably behind
      expect(belowFloor / matches, "too many matches end before the design's turn-6 floor").toBeLessThan(0.4);

      for (const leader of leaders) {
        const share = rate(leader.id);
        expect(share, `${leader.name} wins ${pct(wins.get(leader.id) ?? 0, played.get(leader.id) ?? 0)}`).toBeLessThan(0.85);
        expect(share, `${leader.name} wins ${pct(wins.get(leader.id) ?? 0, played.get(leader.id) ?? 0)}`).toBeGreaterThan(0.15);
      }
  });
});
