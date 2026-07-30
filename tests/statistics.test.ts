/**
 * The statistics dashboard's arithmetic — `03-screens-and-navigation.md` §4.5.6.
 *
 * A dashboard lies in a particular way: it prints a number that is technically
 * correct and rhetorically false. "You win 25% with Gothic Royalty" over four
 * matches is noise wearing a percentage sign, and an average taken over the
 * matches that happen to carry detail, divided by the matches that exist, is
 * half the number it claims to be. Those are the two failures these tests exist
 * for; the third is draws, which are neither a win nor a loss and which any
 * naive `wins / played` quietly turns into losses.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { MatchConfig, MatchRecord, MatchState, PlayerIntent, Seat } from "../src/engine/types";
import { getContent } from "../src/engine/content";
import { autoBuildDeck } from "../src/engine/deck";
import { createMatch } from "../src/engine/state";
import { applyIntent } from "../src/engine/reducer";
import { chooseIntent } from "../src/ai/ai";
import { getAiProfile } from "../src/ai/profiles";
import { matchStats } from "../src/game/missions/stats";
import { baseMode, buildDashboard, MIN_SAMPLE, toCsv, TREND_LENGTH } from "../src/game/stats/dashboard";
import { getProfile, profileStore, recordMatch, type MatchHistoryEntry } from "../src/save/profile";

const content = getContent();
const LEADER = "idols-lumi-starcall";
const GOTH = "goth-leader-alaric-thornheart";

let counter = 0;
const entry = (over: Partial<MatchHistoryEntry> = {}): MatchHistoryEntry => ({
  id: `m${counter++}`,
  playedAt: 1_700_000_000_000 + counter * 60_000,
  deckName: "Test Deck",
  leaderCardId: LEADER,
  opponentLeaderCardId: GOTH,
  result: "win",
  turns: 10,
  mode: "ai-casual",
  ...over,
});

/** Newest-first, which is the order the profile actually stores. */
const historyOf = (...results: MatchHistoryEntry["result"][]): MatchHistoryEntry[] =>
  results.map((result) => entry({ result })).reverse();

// ---------------------------------------------------------------------------

describe("win rate", () => {
  it("counts a draw as played and as neither won nor lost", () => {
    const board = buildDashboard(content, historyOf("win", "loss", "draw"));
    expect(board.overall.played).toBe(3);
    expect(board.overall.won).toBe(1);
    expect(board.overall.lost).toBe(1);
    expect(board.overall.drawn).toBe(1);
    // 1 of 2 *decided* matches, not 1 of 3
    expect(board.overall.winRate).toBeCloseTo(0.5);
  });

  it("is zero rather than NaN when nothing has been decided", () => {
    const board = buildDashboard(content, historyOf("draw", "draw"));
    expect(board.overall.winRate).toBe(0);
    expect(Number.isNaN(board.overall.winRate)).toBe(false);
  });

  it("is zero rather than NaN with no matches at all", () => {
    const board = buildDashboard(content, []);
    expect(board.overall.winRate).toBe(0);
    expect(board.averageTurns).toBe(0);
    expect(board.trend).toEqual([]);
  });
});

describe("sample size", () => {
  it("marks a row thin below the threshold and not above it", () => {
    const thin = buildDashboard(content, historyOf(...Array<"win">(MIN_SAMPLE - 1).fill("win")));
    expect(thin.byFaction[0]!.thin).toBe(true);
    const solid = buildDashboard(content, historyOf(...Array<"win">(MIN_SAMPLE).fill("win")));
    expect(solid.byFaction[0]!.thin).toBe(false);
  });

  it("keeps thin rows in the table rather than dropping them", () => {
    /**
     * A row that vanishes below a threshold is worse than a row that is
     * labelled: the table then silently disagrees with the total above it.
     */
    const board = buildDashboard(content, [entry({ result: "win" })]);
    expect(board.byFaction).toHaveLength(1);
    expect(board.byFaction[0]!.played).toBe(1);
    expect(board.overall.played).toBe(1);
  });

  it("reports how many matches carried per-match detail", () => {
    const board = buildDashboard(content, [
      entry({ summary: { cardsPlayed: 8, charactersDefeated: 2, damageToEnemyLeader: 12, confluencesActivated: 1, perfectResonances: 0, peakObsession: 6 } }),
      entry(),
      entry(),
    ]);
    expect(board.sample).toEqual({ matches: 3, detailed: 1 });
  });
});

describe("per-deck averages", () => {
  const detailed = (peak: number): MatchHistoryEntry =>
    entry({
      summary: {
        cardsPlayed: 10,
        charactersDefeated: 3,
        damageToEnemyLeader: 15,
        confluencesActivated: 2,
        perfectResonances: 1,
        peakObsession: peak,
      },
    });

  it("averages over the matches that carry detail, not over every match", () => {
    /**
     * The bug this exists for: two detailed matches averaging 6 Obsession, plus
     * two older ones with no summary, must still read 6 — not 3.
     */
    const board = buildDashboard(content, [detailed(4), detailed(8), entry(), entry()]);
    const deck = board.byDeck[0]!;
    expect(deck.played).toBe(4);
    expect(deck.detailed).toBe(2);
    expect(deck.averagePeakObsession).toBe(6);
    expect(deck.confluencesPerMatch).toBe(2);
  });

  it("averages turns over every match, because every match has them", () => {
    const board = buildDashboard(content, [entry({ turns: 8 }), entry({ turns: 12 })]);
    expect(board.byDeck[0]!.averageTurns).toBe(10);
  });

  it("does not divide by zero when no match carried detail", () => {
    const board = buildDashboard(content, [entry(), entry()]);
    const deck = board.byDeck[0]!;
    expect(deck.detailed).toBe(0);
    expect(deck.averagePeakObsession).toBe(0);
    expect(Number.isFinite(deck.averagePeakObsession)).toBe(true);
  });

  it("keeps two decks apart", () => {
    const board = buildDashboard(content, [
      entry({ deckName: "Burn", result: "win" }),
      entry({ deckName: "Burn", result: "win" }),
      entry({ deckName: "Control", result: "loss" }),
    ]);
    expect(board.byDeck.map((row) => row.name).sort()).toEqual(["Burn", "Control"]);
    expect(board.byDeck.find((row) => row.name === "Burn")!.winRate).toBe(1);
    expect(board.byDeck.find((row) => row.name === "Control")!.winRate).toBe(0);
  });
});

describe("streaks", () => {
  it("finds the longest run of wins anywhere in the history", () => {
    // newest first: L W W W L W  → the run of three
    const board = buildDashboard(content, historyOf("win", "loss", "win", "win", "win", "loss"));
    expect(board.longestWinStreak).toBe(3);
  });

  it("reads the current streak from the newest end", () => {
    const board = buildDashboard(content, historyOf("loss", "win", "win"));
    expect(board.currentStreak).toBe(2);
  });

  it("reports a losing streak as a negative number", () => {
    const board = buildDashboard(content, historyOf("win", "loss", "loss"));
    expect(board.currentStreak).toBe(-2);
  });

  it("treats a draw as ending the streak", () => {
    const board = buildDashboard(content, historyOf("win", "win", "draw"));
    expect(board.currentStreak).toBe(0);
  });
});

describe("grouping and filters", () => {
  it("folds difficulty tiers into one mode row", () => {
    const board = buildDashboard(content, [entry({ mode: "ai-casual" }), entry({ mode: "ai-expert" })]);
    expect(board.byMode).toHaveLength(1);
    expect(board.byMode[0]!.played).toBe(2);
    expect(baseMode("doomscroll-elite")).toBe("doomscroll");
  });

  it("separates the faction you played from the one you played into", () => {
    const board = buildDashboard(content, [entry()]);
    expect(board.byFaction[0]!.id).toBe(content.leaders[LEADER]!.faction);
    expect(board.byOpponentFaction[0]!.id).toBe(content.leaders[GOTH]!.faction);
    expect(board.byFaction[0]!.id).not.toBe(board.byOpponentFaction[0]!.id);
  });

  it("filters the totals as well as the tables", () => {
    /**
     * The reason filtering lives in the module rather than the screen: a header
     * that kept saying "40 matches" while the table under it showed six would
     * be two different answers to the same question.
     */
    const history = [entry({ mode: "boss-heroic", result: "loss" }), entry({ mode: "ai-casual", result: "win" })];
    const board = buildDashboard(content, history, { mode: "ai" });
    expect(board.overall.played).toBe(1);
    expect(board.overall.won).toBe(1);
    expect(board.sample.matches).toBe(1);
    expect(board.byMode).toHaveLength(1);
  });

  it("filters by faction too", () => {
    const board = buildDashboard(content, [entry(), entry({ leaderCardId: GOTH })], {
      factionId: content.leaders[GOTH]!.faction,
    });
    expect(board.overall.played).toBe(1);
  });
});

describe("the trend sparkline", () => {
  it("reads oldest to newest, like a timeline", () => {
    // historyOf reverses, so this is stored newest-first as loss, win
    const board = buildDashboard(content, historyOf("win", "loss"));
    expect(board.trend).toEqual(["win", "loss"]);
  });

  it("shows at most the last thirty", () => {
    const board = buildDashboard(content, historyOf(...Array<"win">(50).fill("win")));
    expect(board.trend).toHaveLength(TREND_LENGTH);
  });
});

describe("the CSV export", () => {
  it("writes one row per match, plus a header", () => {
    const csv = toCsv(content, [entry(), entry()]);
    expect(csv.split("\n")).toHaveLength(3);
  });

  it("quotes a deck name containing a comma", () => {
    const csv = toCsv(content, [entry({ deckName: "Burn, Baby" })]);
    expect(csv).toContain('"Burn, Baby"');
    // and the row still has the same number of fields as the header
    const [header, row] = csv.split("\n");
    const fields = row!.match(/("([^"]|"")*"|[^,]*)/g)!.filter((_, i) => i % 2 === 0);
    expect(fields.length).toBe(header!.split(",").length);
  });

  it("leaves detail columns empty rather than zero when a match has none", () => {
    /**
     * Zero would be a claim: "this match had no Confluences". Empty is the
     * truth: "this match did not record whether it had any".
     */
    const csv = toCsv(content, [entry()]);
    expect(csv.split("\n")[1]).toContain(',"","","","","",""');
  });
});

describe("what a real match writes into the history", () => {
  beforeEach(() => profileStore.reset());

  /** A full match, played by the engine's own AI. */
  const playRecord = (seed: number): MatchRecord => {
    const matchConfig: MatchConfig = {
      seed,
      decks: [autoBuildDeck(content, LEADER, "A"), autoBuildDeck(content, GOTH, "B")],
      firstSeat: 0,
    };
    let state: MatchState = createMatch(matchConfig, content);
    const intents: PlayerIntent[] = [];
    const profiles = [getAiProfile("casual"), getAiProfile("casual")];
    while (state.phase === "mulligan") {
      const seat: Seat = state.players[0].mulliganDone ? 1 : 0;
      const decision = chooseIntent(state, content, seat, profiles[seat]!);
      if (!decision) break;
      intents.push(decision.intent);
      state = applyIntent(state, content, decision.intent).state;
    }
    let guard = 0;
    while (state.winner === null && guard++ < 700) {
      const decision = chooseIntent(state, content, state.activeSeat, profiles[state.activeSeat]!);
      if (!decision) break;
      intents.push(decision.intent);
      try {
        state = applyIntent(state, content, decision.intent).state;
      } catch {
        break;
      }
    }
    return { config: matchConfig, intents, result: { winner: state.winner, turns: state.turn } } as MatchRecord;
  };

  const record = playRecord(4242);

  it("stamps a summary that agrees with the deriver", () => {
    const expected = matchStats(record, content, 0);
    recordMatch(record, expected.won ? "win" : "loss", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: GOTH,
      mode: "ai-casual",
      content,
    });
    const summary = getProfile().history[0]!.summary!;
    expect(summary.cardsPlayed).toBe(expected.cardsPlayed);
    expect(summary.peakObsession).toBe(expected.peakObsession);
    expect(summary.confluencesActivated).toBe(expected.confluencesActivated);
  });

  it("stamps nothing when the match could not be read", () => {
    // no content index means no replay, so there is no detail to honestly stamp
    recordMatch(record, "win", {
      deckName: "T",
      leaderCardId: LEADER,
      opponentLeaderCardId: GOTH,
      mode: "ai-casual",
    });
    expect(getProfile().history[0]!.summary).toBeUndefined();
  });

  it("never reports a peak Obsession above the cap the rules allow", () => {
    const stats = matchStats(record, content, 0);
    expect(stats.peakObsession).toBeLessThanOrEqual(content.balance.obsession.max);
    expect(stats.peakObsession).toBeGreaterThanOrEqual(0);
  });

  it("keeps the peak distinct from the total gained", () => {
    /**
     * Full Fixation resets Obsession to zero, so a match can gain far more than
     * it ever holds. A peak that merely echoed `obsessionGained` would be wrong
     * the moment anybody used a Fixation.
     */
    const stats = matchStats(record, content, 0);
    expect(stats.peakObsession).toBeLessThanOrEqual(stats.obsessionGained);
  });

  it("builds a dashboard out of what it recorded", () => {
    recordMatch(record, "win", {
      deckName: "Lumi",
      leaderCardId: LEADER,
      opponentLeaderCardId: GOTH,
      mode: "ai-casual",
      content,
    });
    const board = buildDashboard(content, getProfile().history);
    expect(board.overall.played).toBe(1);
    expect(board.sample.detailed).toBe(1);
    expect(board.byDeck[0]!.name).toBe("Lumi");
    expect(board.byFaction[0]!.name).toBe(content.factions[content.leaders[LEADER]!.faction]!.name);
  });
});
