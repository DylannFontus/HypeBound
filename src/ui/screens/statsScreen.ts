/**
 * The statistics dashboard — `03-screens-and-navigation.md` §4.5.6.
 *
 * Everything here is computed from the local match history by
 * `game/stats/dashboard.ts`; this file only draws it. That split matters more
 * than usual for a screen like this, because the interesting decisions — draws
 * are neither a win nor a loss, averages count only the matches that carry
 * detail, thin rows are labelled rather than hidden — are decisions about
 * *arithmetic*, and arithmetic belongs somewhere a test can reach it.
 *
 * The one thing this file is opinionated about is that a percentage never
 * appears without the count behind it. "56%" over nine matches and "56%" over
 * three hundred are different claims, and a dashboard that prints them the same
 * way is a dashboard that talks people into rebuilding decks for no reason.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { DeckRow, Row } from "../../game/stats/dashboard";
import { baseMode, buildDashboard, toCsv } from "../../game/stats/dashboard";
import { getProfile } from "../../save/profile";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";

export interface StatsCallbacks {
  onBack: () => void;
  onHistory: () => void;
  onDeckBuilder: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
const round1 = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

export function createStatsScreen(content: ContentIndex, callbacks: StatsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen stats-screen";

  let mode = "all";

  const rateTable = (title: string, note: string, rows: Row[]): string => `
    <section class="panel panel-chrome stats-table">
      <div class="stats-table-head">
        <h3 class="profile-section-title">${esc(title)}</h3>
        <span class="muted">${esc(note)}</span>
      </div>
      ${
        rows.length === 0
          ? `<p class="muted">Nothing yet.</p>`
          : `<ul class="stats-rows">
               ${rows
                 .map(
                   (row) => `
                     <li class="stats-row ${row.thin ? "thin" : ""}">
                       <span class="stats-row-name">${esc(row.name)}</span>
                       <span class="stats-row-bar" style="--c:${esc(FACTION_COLOR[row.factionId as never] ?? "#b56cff")}">
                         <span style="width:${Math.round(row.winRate * 100)}%"></span>
                       </span>
                       <span class="stats-row-rate">${pct(row.winRate)}</span>
                       <span class="stats-row-count muted">${row.won}–${row.lost}${row.drawn > 0 ? `–${row.drawn}` : ""}</span>
                     </li>`
                 )
                 .join("")}
             </ul>`
      }
    </section>`;

  const deckTable = (rows: DeckRow[], detailed: number): string => `
    <section class="panel panel-chrome stats-table stats-decks">
      <div class="stats-table-head">
        <h3 class="profile-section-title">By deck</h3>
        <span class="muted">
          ${
            detailed === 0
              ? "Per-match detail starts being recorded from your next match."
              : `Averages over the ${detailed} match${detailed === 1 ? "" : "es"} that recorded detail.`
          }
        </span>
      </div>
      ${
        rows.length === 0
          ? `<p class="muted">Play a match and the deck you played it with appears here.</p>`
          : `<div class="stats-scroll">
              <table class="stats-deck-table">
                <thead>
                  <tr>
                    <th>Deck</th><th>Record</th><th>Win rate</th><th>Turns</th>
                    <th title="Highest Obsession reached, averaged">Peak Obsession</th>
                    <th title="Confluences activated per match">Confluences</th>
                    <th title="Perfect Resonances per match">Resonance</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (row) => `
                        <tr class="${row.thin ? "thin" : ""}">
                          <td>${esc(row.name)}</td>
                          <td class="muted">${row.won}–${row.lost}${row.drawn > 0 ? `–${row.drawn}` : ""}</td>
                          <td>${pct(row.winRate)}${row.thin ? ` <span class="muted">(${row.played})</span>` : ""}</td>
                          <td>${round1(row.averageTurns)}</td>
                          <td>${row.detailed > 0 ? round1(row.averagePeakObsession) : "<span class='muted'>—</span>"}</td>
                          <td>${row.detailed > 0 ? round1(row.confluencesPerMatch) : "<span class='muted'>—</span>"}</td>
                          <td>${row.detailed > 0 ? round1(row.resonancesPerMatch) : "<span class='muted'>—</span>"}</td>
                        </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
             </div>`
      }
    </section>`;

  const render = (): void => {
    const history = getProfile().history;
    const board = buildDashboard(content, history, { mode });
    const modes = [...new Set(history.map((entry) => baseMode(entry.mode)))].sort();

    const streak =
      board.currentStreak > 0
        ? `${board.currentStreak} win${board.currentStreak === 1 ? "" : "s"} in a row`
        : board.currentStreak < 0
          ? `${-board.currentStreak} loss${board.currentStreak === -1 ? "" : "es"} in a row`
          : "—";

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="stats-back">← Back</button>
        <h1 class="title">Statistics</h1>
      </header>

      <main class="stats-body">
        <section class="panel panel-chrome stats-summary">
          <dl class="stats-headline">
            <div><dt>Matches</dt><dd>${board.overall.played}</dd></div>
            <div><dt>Win rate</dt><dd>${pct(board.overall.winRate)}</dd></div>
            <div><dt>Record</dt><dd>${board.overall.won}–${board.overall.lost}${board.overall.drawn > 0 ? `–${board.overall.drawn}` : ""}</dd></div>
            <div><dt>Longest streak</dt><dd>${board.longestWinStreak}</dd></div>
            <div><dt>Right now</dt><dd>${esc(streak)}</dd></div>
            <div><dt>Average length</dt><dd>${round1(board.averageTurns)} turns</dd></div>
          </dl>
          <p class="muted stats-sample">
            Computed from the ${board.sample.matches} match${board.sample.matches === 1 ? "" : "es"} this device
            has on record${board.sample.detailed < board.sample.matches ? `, ${board.sample.detailed} of which recorded per-match detail` : ""}.
            Draws count as played and as neither won nor lost.
          </p>
          <div class="stats-trend" title="Your last ${board.trend.length} matches, oldest first">
            ${board.trend.map((result) => `<span class="stats-pip ${result}"></span>`).join("")}
            ${board.trend.length === 0 ? `<span class="muted">No matches yet.</span>` : ""}
          </div>
        </section>

        <nav class="mastery-tabs stats-filters">
          <button class="btn mastery-tab ${mode === "all" ? "active" : ""}" data-mode="all">All modes</button>
          ${modes
            .map(
              (id) =>
                `<button class="btn mastery-tab ${mode === id ? "active" : ""}" data-mode="${esc(id)}">
                   ${esc(board.byMode.find((row) => row.id === id)?.name ?? id)}
                 </button>`
            )
            .join("")}
        </nav>

        ${deckTable(board.byDeck, board.sample.detailed)}
        <div class="stats-columns">
          ${rateTable("By faction", "The faction you played", board.byFaction)}
          ${rateTable("By Current", "Your leader's primary Current", board.byCurrent)}
          ${rateTable("Against", "The faction you played into", board.byOpponentFaction)}
        </div>

        <div class="stats-actions">
          <button class="btn btn-ghost" id="stats-history">Match history →</button>
          <button class="btn btn-ghost" id="stats-decks">Deck builder →</button>
          <button class="btn btn-ghost" id="stats-export">Export CSV</button>
        </div>
      </main>`;

    root.querySelector("#stats-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#stats-history")?.addEventListener("click", () => callbacks.onHistory());
    root.querySelector("#stats-decks")?.addEventListener("click", () => callbacks.onDeckBuilder());
    root.querySelector("#stats-export")?.addEventListener("click", () => {
      /**
       * A Blob and an object URL rather than a `data:` URI: a long history is
       * comfortably past the URL length some browsers will accept, and the
       * failure mode of that is a download that silently truncates.
       */
      const blob = new Blob([toCsv(content, getProfile().history)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hypebound-matches.csv";
      link.click();
      URL.revokeObjectURL(url);
      audio.play("sfx.ui.confirm");
    });

    for (const button of root.querySelectorAll<HTMLElement>(".stats-filters .mastery-tab")) {
      button.addEventListener("click", () => {
        mode = button.dataset["mode"] ?? "all";
        audio.play("sfx.ui.hover");
        render();
      });
    }
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundStats?: unknown }).hypeboundStats = {
    board: (filterMode = mode) => buildDashboard(content, getProfile().history, { mode: filterMode }),
    csv: () => toCsv(content, getProfile().history),
    filter: (id: string) => {
      mode = id;
      render();
    },
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundStats?: unknown }).hypeboundStats;
    },
  };
}
