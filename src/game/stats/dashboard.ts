/**
 * The statistics dashboard — `03-screens-and-navigation.md` §4.5.6.
 *
 * *"Aggregated performance for self-improvement, computed from local match
 * summaries."* Pure: a list of history entries and the content index in, tables
 * out. No storage, no clock, no DOM.
 *
 * ## What it will and will not say
 *
 * Three rules, all of them about a dashboard's particular way of lying.
 *
 * **It reports its own sample size, always.** A win rate over four matches is
 * noise wearing a percentage sign, and the difference between "you win 25% with
 * Gothic Royalty" and "you have played Gothic Royalty four times" is the
 * difference between a useful screen and one that makes people rebuild decks for
 * no reason. Every row carries `played`, and rows below `MIN_SAMPLE` are marked
 * `thin` so the screen can grey them rather than dropping them — a row that
 * vanishes below a threshold is worse, because then the table silently disagrees
 * with the total.
 *
 * **It never averages over matches it cannot see.** The per-match detail
 * (`summary`) is absent on anything recorded before it shipped, so the averages
 * count only the entries that carry it and say how many that was. Dividing by
 * the full match count would quietly halve every average on an older account.
 *
 * **Draws are neither.** A draw is played, not won and not lost, so the win rate
 * is wins over *decided* matches. Counting a draw as half a loss is a choice
 * nobody asked for, and counting it as a loss makes the mirror match look worse
 * than it is.
 */

import type { ContentIndex, CurrentId, FactionId } from "../../engine/types";
import type { MatchHistoryEntry } from "../../save/profile";

/** Below this many matches, a row is labelled rather than believed. */
export const MIN_SAMPLE = 5;

/** How many matches the trend sparkline shows (§4.5.6 asks for 30). */
export const TREND_LENGTH = 30;

export interface Tally {
  played: number;
  won: number;
  lost: number;
  drawn: number;
  /** wins over *decided* matches, 0..1; 0 when nothing has been decided */
  winRate: number;
  /** true when there are too few matches for the rate to mean anything */
  thin: boolean;
}

export interface Row extends Tally {
  id: string;
  name: string;
  /** the faction colour key, for the bar; empty when the row is not a faction */
  factionId: string;
}

export interface DeckRow extends Row {
  averageTurns: number;
  averagePeakObsession: number;
  confluencesPerMatch: number;
  resonancesPerMatch: number;
  cardsPerMatch: number;
  /** how many of this row's matches carried per-match detail */
  detailed: number;
}

export interface Dashboard {
  overall: Tally;
  /** the longest run of wins anywhere in the history, newest-first order aside */
  longestWinStreak: number;
  /** the streak running right now, negative for a losing one */
  currentStreak: number;
  byFaction: Row[];
  byCurrent: Row[];
  byDeck: DeckRow[];
  byMode: Row[];
  byOpponentFaction: Row[];
  /** oldest to newest, so the sparkline reads left to right like a timeline */
  trend: ("win" | "loss" | "draw")[];
  /** total matches on record, and how many of them carry per-match detail */
  sample: { matches: number; detailed: number };
  averageTurns: number;
}

const emptyTally = (): Tally => ({ played: 0, won: 0, lost: 0, drawn: 0, winRate: 0, thin: true });

const finish = (tally: Tally): Tally => {
  const decided = tally.won + tally.lost;
  tally.winRate = decided > 0 ? tally.won / decided : 0;
  tally.thin = tally.played < MIN_SAMPLE;
  return tally;
};

const credit = (tally: Tally, result: MatchHistoryEntry["result"]): void => {
  tally.played += 1;
  if (result === "win") tally.won += 1;
  else if (result === "loss") tally.lost += 1;
  else tally.drawn += 1;
};

/** The base mode, so `ai-casual` and `ai-expert` are one row rather than six. */
export const baseMode = (mode: string): string => mode.split("-")[0] ?? mode;

const MODE_NAME: Record<string, string> = {
  ai: "Practice",
  tour: "Grand Tour",
  boss: "Weekly Boss",
  doomscroll: "The Doomscroll",
  story: "Story",
  tutorial: "Tutorial",
  puzzle: "Puzzle Rush",
  gauntlet: "The Gauntlet",
};

/**
 * Which matches a dashboard is built from.
 *
 * `mode` is the base mode or "all"; `factionId` narrows to one faction's
 * matches. Both are what §4.5.6's filter header offers, and both are applied
 * here rather than on the screen so that every number on it — including the
 * totals and the streaks — is filtered consistently.
 */
export interface DashboardFilter {
  mode?: string;
  factionId?: string;
}

export function buildDashboard(
  content: ContentIndex,
  history: readonly MatchHistoryEntry[],
  filter: DashboardFilter = {}
): Dashboard {
  const factionOf = (leaderCardId: string): string => content.leaders[leaderCardId]?.faction ?? "";
  const factionName = (factionId: string): string =>
    content.factions[factionId as FactionId]?.name ?? factionId;
  const currentOf = (leaderCardId: string): CurrentId | null =>
    content.leaders[leaderCardId]?.primaryCurrent ?? null;

  const matches = history.filter((entry) => {
    if (filter.mode && filter.mode !== "all" && baseMode(entry.mode) !== filter.mode) return false;
    if (filter.factionId && factionOf(entry.leaderCardId) !== filter.factionId) return false;
    return true;
  });

  const overall = emptyTally();
  const byFaction = new Map<string, Row>();
  const byCurrent = new Map<string, Row>();
  const byMode = new Map<string, Row>();
  const byOpponent = new Map<string, Row>();
  const byDeck = new Map<string, DeckRow>();

  const rowFor = (map: Map<string, Row>, id: string, name: string, factionId: string): Row => {
    let row = map.get(id);
    if (!row) {
      row = { ...emptyTally(), id, name, factionId };
      map.set(id, row);
    }
    return row;
  };

  let turns = 0;
  let detailed = 0;

  for (const entry of matches) {
    credit(overall, entry.result);
    turns += entry.turns;

    const factionId = factionOf(entry.leaderCardId);
    if (factionId) {
      credit(rowFor(byFaction, factionId, factionName(factionId), factionId), entry.result);
    }
    const current = currentOf(entry.leaderCardId);
    if (current) {
      credit(rowFor(byCurrent, current, content.currents[current]?.name ?? current, factionId), entry.result);
    }
    const mode = baseMode(entry.mode);
    credit(rowFor(byMode, mode, MODE_NAME[mode] ?? mode, ""), entry.result);

    const opponentFaction = factionOf(entry.opponentLeaderCardId);
    if (opponentFaction) {
      credit(
        rowFor(byOpponent, opponentFaction, factionName(opponentFaction), opponentFaction),
        entry.result
      );
    }

    /**
     * Decks are keyed by name, because a deck has no id that survives being
     * edited — `saveDeck` replaces the list in place. Renaming a deck therefore
     * starts a new row, which is the honest reading: a deck you renamed while
     * rebuilding it is not the deck whose record you were looking at.
     */
    let deck = byDeck.get(entry.deckName);
    if (!deck) {
      deck = {
        ...emptyTally(),
        id: entry.deckName,
        name: entry.deckName,
        factionId,
        averageTurns: 0,
        averagePeakObsession: 0,
        confluencesPerMatch: 0,
        resonancesPerMatch: 0,
        cardsPerMatch: 0,
        detailed: 0,
      };
      byDeck.set(entry.deckName, deck);
    }
    credit(deck, entry.result);
    deck.averageTurns += entry.turns;

    if (entry.summary) {
      detailed += 1;
      deck.detailed += 1;
      deck.averagePeakObsession += entry.summary.peakObsession;
      deck.confluencesPerMatch += entry.summary.confluencesActivated;
      deck.resonancesPerMatch += entry.summary.perfectResonances;
      deck.cardsPerMatch += entry.summary.cardsPlayed;
    }
  }

  for (const map of [byFaction, byCurrent, byMode, byOpponent]) for (const row of map.values()) finish(row);
  for (const deck of byDeck.values()) {
    finish(deck);
    deck.averageTurns = deck.played > 0 ? deck.averageTurns / deck.played : 0;
    /**
     * Averaged over the matches that *carry* detail, not over every match.
     * Dividing by `played` would silently halve every average on an account
     * whose older matches predate the summary field.
     */
    const n = deck.detailed || 1;
    deck.averagePeakObsession /= n;
    deck.confluencesPerMatch /= n;
    deck.resonancesPerMatch /= n;
    deck.cardsPerMatch /= n;
  }
  finish(overall);

  // history is newest-first; streaks and the trend both read oldest-first
  const chronological = [...matches].reverse();
  let longest = 0;
  let run = 0;
  for (const entry of chronological) {
    if (entry.result === "win") {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  /** The streak in progress: positive for wins, negative for losses, 0 after a draw. */
  let currentStreak = 0;
  for (const entry of matches) {
    if (currentStreak === 0) {
      if (entry.result === "win") currentStreak = 1;
      else if (entry.result === "loss") currentStreak = -1;
      else break;
    } else if (currentStreak > 0 && entry.result === "win") currentStreak += 1;
    else if (currentStreak < 0 && entry.result === "loss") currentStreak -= 1;
    else break;
  }

  const byRate = (a: Row, b: Row): number => b.played - a.played || b.winRate - a.winRate;

  return {
    overall,
    longestWinStreak: longest,
    currentStreak,
    byFaction: [...byFaction.values()].sort(byRate),
    byCurrent: [...byCurrent.values()].sort(byRate),
    byDeck: [...byDeck.values()].sort(byRate),
    byMode: [...byMode.values()].sort(byRate),
    byOpponentFaction: [...byOpponent.values()].sort(byRate),
    trend: chronological.slice(-TREND_LENGTH).map((entry) => entry.result),
    sample: { matches: matches.length, detailed },
    averageTurns: matches.length > 0 ? turns / matches.length : 0,
  };
}

/**
 * The dashboard as a CSV, one row per match (§4.5.6 asks for an export).
 *
 * Per **match**, not per aggregate, on purpose: an export exists so somebody can
 * ask a question this screen does not answer, and a table of the answers it does
 * give would be the one thing that cannot do that.
 */
export function toCsv(content: ContentIndex, history: readonly MatchHistoryEntry[]): string {
  const columns = [
    "playedAt",
    "mode",
    "result",
    "turns",
    "deck",
    "leader",
    "faction",
    "opponentLeader",
    "opponentFaction",
    "cardsPlayed",
    "charactersDefeated",
    "damageToEnemyLeader",
    "confluencesActivated",
    "perfectResonances",
    "peakObsession",
  ];
  // quote everything that could contain a comma; a deck named "Burn, Baby" is a
  // deck a player is entitled to name
  const cell = (value: string | number): string =>
    typeof value === "number" ? String(value) : `"${value.replace(/"/g, '""')}"`;

  const lines = [columns.join(",")];
  for (const entry of history) {
    const leader = content.leaders[entry.leaderCardId];
    const opponent = content.leaders[entry.opponentLeaderCardId];
    const summary = entry.summary;
    lines.push(
      [
        cell(new Date(entry.playedAt).toISOString()),
        cell(entry.mode),
        cell(entry.result),
        cell(entry.turns),
        cell(entry.deckName),
        cell(leader?.name ?? entry.leaderCardId),
        cell(leader?.faction ?? ""),
        cell(opponent?.name ?? entry.opponentLeaderCardId),
        cell(opponent?.faction ?? ""),
        cell(summary?.cardsPlayed ?? ""),
        cell(summary?.charactersDefeated ?? ""),
        cell(summary?.damageToEnemyLeader ?? ""),
        cell(summary?.confluencesActivated ?? ""),
        cell(summary?.perfectResonances ?? ""),
        cell(summary?.peakObsession ?? ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}
