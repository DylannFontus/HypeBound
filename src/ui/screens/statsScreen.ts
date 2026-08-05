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
 *
 * ## The screen called Statistics used to contain no chart
 *
 * No axis, no line, no time series, no distribution: six numbers, one HTML table
 * and three lists of 90px bars. The thing that looked most like a visualisation
 * was the worst of them — thirty 10×18px rectangles distinguished from one
 * another *by background colour alone*, which is not a style complaint but a
 * breach of the one accessibility rule the design system states as absolute. A
 * deuteranope read thirty identical grey blocks.
 *
 * Two drawings now carry the screen, both in `data/chart.ts`:
 *
 *  - the **trend** is a sparkline where a win stands above the baseline, a draw
 *    is a half bar on it and a loss hangs below, so the signal is a shape and
 *    the colour only agrees with it;
 *  - the **curve** is cumulative win rate over the series with a labelled grid
 *    and a confidence band that is wide at five matches and tight at a hundred —
 *    the "56% over nine is not 56% over three hundred" sentence, drawn.
 *
 * And the third: saturation is used as a focus tool rather than as confetti. The
 * By-faction panel put seven fully saturated hues in a 340px box, so nothing was
 * the hero accent; every bar now sits desaturated until its row is hovered.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { DeckRow, Row } from "../../game/stats/dashboard";
import { WIN_RATE_CAPTION, WIN_RATE_QUALIFIER, baseMode, buildDashboard, toCsv } from "../../game/stats/dashboard";
import { getProfile } from "../../save/profile";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { sparkline, winRateCurve, type TrendResult } from "./data/chart";
import { EMPTY } from "../format";
import { chip, count, countUp, disposeBag, enter, esc, icon, meter, quantify, rovingList } from "./data/kit";

export interface StatsCallbacks {
  onBack: () => void;
  onHistory: () => void;
  onDeckBuilder: () => void;
}

/**
 * Neither of these may ever print "NaN", and both could.
 *
 * The deck table showed `NaN` in its Confluences and Resonance columns for any
 * deck whose recorded matches carried no per-match detail: the dashboard divides
 * a total by a count, the count was zero, and `(0/0).toFixed(1)` is the string
 * "NaN" rendered in tabular figures in a shipped table. `undefined` on the patch
 * notes and `NaN` here are the same defect — §0's one-sentence test is answered
 * in under a second by either — so both are caught at the last possible moment,
 * where no upstream arithmetic can slip past. `EMPTY` is `format.ts`'s em-dash,
 * so a missing number looks the same everywhere in the game.
 */
const pct = (rate: number): string => (Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : EMPTY);
const round1 = (value: number): string =>
  Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1) : EMPTY;

export function createStatsScreen(content: ContentIndex, callbacks: StatsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen stats-screen";

  let mode = "all";
  const bag = disposeBag();

  /**
   * A rate table.
   *
   * The bar is a `.mat-well` groove with a `.well-fill` object in it rather than
   * a flat `background: var(--c)` ribbon on a flat track, and the whole list
   * desaturates so that only the row under the pointer is at full chroma —
   * §6's "saturation is a resource" applied to the one panel in the game that
   * was breaking it hardest.
   */
  const rateTable = (title: string, note: string, rows: Row[]): string => `
    <section class="panel panel-chrome stats-table">
      <div class="stats-table-head">
        <h3 class="t-heading">${esc(title)}</h3>
        <span class="t-body">${esc(note)}</span>
      </div>
      ${
        rows.length === 0
          ? `<div class="empty d-enter">
               ${icon("log", 34)}
               <h3 class="t-heading">No sample yet</h3>
               <p class="t-body">One match is enough to put the first row here.</p>
             </div>`
          : `<ul class="stats-rows">
               ${rows
                 .map(
                   (row) => `
                     <li class="stats-row d-enter ${row.thin ? "thin" : ""}"
                         style="--c:${esc(FACTION_COLOR[row.factionId as never] ?? "#b56cff")}">
                       <span class="stats-row-name">${esc(row.name)}</span>
                       ${meter({
                         value: row.winRate,
                         steps: 0,
                         colour: FACTION_COLOR[row.factionId as never] ?? "#b56cff",
                         animate: true,
                         className: "stats-row-bar",
                       })}
                       <span class="stats-row-rate num">${pct(row.winRate)}</span>
                       <span class="stats-row-count num">${row.won}–${row.lost}${
                         row.drawn > 0 ? `–${row.drawn}` : ""
                       }</span>
                     </li>`
                 )
                 .join("")}
             </ul>`
      }
    </section>`;

  const deckTable = (rows: DeckRow[], detailed: number): string => `
    <section class="panel panel-chrome stats-table stats-decks">
      <div class="stats-table-head">
        <h3 class="t-heading">By deck</h3>
        <span class="t-body">
          ${
            detailed === 0
              ? "Per-match detail starts being recorded from your next match."
              : `Averages over the ${quantify(detailed, "match", "matches")} that recorded detail.`
          }
        </span>
      </div>
      ${
        rows.length === 0
          ? `<div class="empty d-enter">
               ${icon("deck", 38)}
               <h3 class="t-heading">No deck has a record yet</h3>
               <p class="t-body">Play a match and the deck you played it with appears here, with its turns, Obsession peak and Confluence rate.</p>
               <button type="button" class="mat-hero act r-chip" id="stats-empty-decks">Open the deck builder</button>
             </div>`
          : `<div class="stats-scroll">
              <table class="stats-deck-table d-table">
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
                          <td class="stats-record">${row.won}–${row.lost}${row.drawn > 0 ? `–${row.drawn}` : ""}</td>
                          <td>${pct(row.winRate)}${row.thin ? ` <span class="stats-thin-note">(${row.played})</span>` : ""}</td>
                          <td>${round1(row.averageTurns)}</td>
                          <td>${row.detailed > 0 ? round1(row.averagePeakObsession) : '<span class="stats-none">—</span>'}</td>
                          <td>${row.detailed > 0 ? round1(row.confluencesPerMatch) : '<span class="stats-none">—</span>'}</td>
                          <td>${row.detailed > 0 ? round1(row.resonancesPerMatch) : '<span class="stats-none">—</span>'}</td>
                        </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
             </div>`
      }
    </section>`;

  const render = (): void => {
    bag.run();
    const history = getProfile().history;
    const board = buildDashboard(content, history, { mode });
    const modes = [...new Set(history.map((entry) => baseMode(entry.mode)))].sort();

    const streak =
      board.currentStreak > 0
        ? `${quantify(board.currentStreak, "win")} in a row`
        : board.currentStreak < 0
          ? `${quantify(-board.currentStreak, "loss", "losses")} in a row`
          : "—";

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="stats-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Statistics</h1>
      </header>

      <main class="stats-body data-body">
        <section class="panel panel-chrome stats-summary">
          <dl class="d-stats stats-headline">
            <div class="d-stat"><dt>Matches</dt><dd class="num" data-count="${board.overall.played}" data-digits="4">0</dd></div>
            <div class="d-stat"><dt>Win rate <span class="d-stat-qual">${WIN_RATE_QUALIFIER}</span></dt><dd class="num">${pct(
              board.overall.winRate
            )}<span class="d-stat-of">${count(board.overall.won + board.overall.lost)} decided</span></dd></div>
            <div class="d-stat"><dt>Record</dt><dd class="num">${board.overall.won}–${board.overall.lost}${
              board.overall.drawn > 0 ? `–${board.overall.drawn}` : ""
            }</dd></div>
            <div class="d-stat"><dt>Longest streak</dt><dd class="num" data-count="${board.longestWinStreak}" data-digits="3">0</dd></div>
            <div class="d-stat is-quiet"><dt>${icon("st-scorched", 13)} Right now</dt><dd>${esc(streak)}</dd></div>
            <div class="d-stat is-quiet"><dt>Average length</dt><dd>${round1(board.averageTurns)} turns</dd></div>
          </dl>

          <div class="stats-trend-block">
            ${
              board.trend.length === 0
                ? `<p class="t-body stats-trend-empty">
                     The form line fills in from your first match — a bar up for a win, level for a
                     draw, down for a loss.
                   </p>`
                : `<div class="stats-trend-head">
                     <span class="t-label">Last ${count(board.trend.length)} results</span>
                     <span class="stats-legend">
                       <span class="stats-key is-win">${icon("chevron-up", 12)} Win</span>
                       <span class="stats-key is-draw">${icon("minus", 12)} Draw</span>
                       <span class="stats-key is-loss">${icon("chevron-down", 12)} Loss</span>
                     </span>
                   </div>
                   <div class="stats-trend" id="stats-trend"
                        title="Your last ${board.trend.length} matches, oldest first"></div>`
            }
          </div>

          <p class="t-body stats-sample">
            Computed from the ${quantify(board.sample.matches, "match", "matches")} this device
            has on record${
              board.sample.detailed < board.sample.matches
                ? `, ${count(board.sample.detailed)} of which recorded per-match detail`
                : ""
            }. Draws count as played and as neither won nor lost.
          </p>
        </section>

        <section class="panel panel-chrome stats-curve-panel">
          <div class="stats-table-head">
            <h3 class="t-heading">Win rate over time</h3>
            <span class="t-body">Cumulative wins ${esc(
              WIN_RATE_CAPTION
            )}, oldest first. The two bands are how much a sample this size actually knows — the inner one is where the rate probably is, the outer one where it could be.</span>
          </div>
          <div class="stats-curve" id="stats-curve"></div>
          ${
            board.trend.length === 0
              ? `<div class="empty d-enter">
                   ${icon("mode-ranked", 38)}
                   <h3 class="t-heading">The curve starts at your first match</h3>
                   <p class="t-body">Every match this device plays is recorded locally and nothing here is ever sent anywhere.</p>
                 </div>`
              : ""
          }
        </section>

        <nav class="stats-filters d-chips" role="radiogroup" aria-label="Mode">
          ${chip({ label: "All modes", value: "all", active: mode === "all", key: "mode" })}
          ${modes
            .map((id) =>
              chip({
                label: board.byMode.find((row) => row.id === id)?.name ?? id,
                value: id,
                active: mode === id,
                key: "mode",
              })
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
          <button type="button" class="mat-panel act r-chip" id="stats-history">
            ${icon("mode-replays", 16)} Match history
          </button>
          <button type="button" class="mat-panel act r-chip" id="stats-decks">
            ${icon("deck-builder", 16)} Deck builder
          </button>
          <button type="button" class="mat-panel act r-chip" id="stats-export">
            ${icon("arrow-down", 16)} Export CSV
          </button>
        </div>
      </main>`;

    /**
     * Both charts are drawn after the markup lands and sized from the box they
     * were given, because a canvas laid out by CSS and drawn at a guessed width
     * is the classic way to ship a blurry chart.
     */
    const trendHost = root.querySelector<HTMLElement>("#stats-trend");
    if (trendHost && board.trend.length > 0) {
      const pane = sparkline(board.trend as readonly TrendResult[], {
        width: Math.max(240, trendHost.clientWidth || 640),
        height: 46,
      });
      if (pane) trendHost.appendChild(pane);
    }

    const curveHost = root.querySelector<HTMLElement>("#stats-curve");
    if (curveHost && board.trend.length > 0) {
      const pane = winRateCurve(board.trend as readonly TrendResult[], {
        width: Math.max(320, curveHost.clientWidth || 760),
        height: 200,
      });
      if (pane) curveHost.appendChild(pane);
    }

    root.querySelector("#stats-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#stats-history")?.addEventListener("click", () => callbacks.onHistory());
    root.querySelector("#stats-decks")?.addEventListener("click", () => callbacks.onDeckBuilder());
    root.querySelector("#stats-empty-decks")?.addEventListener("click", () => callbacks.onDeckBuilder());
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

    for (const button of root.querySelectorAll<HTMLElement>(".stats-filters .d-chip")) {
      button.addEventListener("click", () => {
        mode = button.dataset["mode"] ?? "all";
        audio.play("sfx.ui.hover");
        render();
      });
    }

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".stats-filters"), ".d-chip"));
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
      bag.run();
      delete (window as unknown as { hypeboundStats?: unknown }).hypeboundStats;
    },
  };
}
