/**
 * Leaderboards — `03-screens-and-navigation.md` §4.5.7.
 *
 * The design marks this screen **ONLINE** and is unusually specific about what
 * the offline build should do: *"requires the server (no fake ladder is ever
 * rendered offline — explainer panel only)"*. That editorial decision is right
 * and it stays: there is no placeholder table, no greyed-out sample ranking, no
 * invented names, because a mock ladder is a lie that people screenshot.
 *
 * ## What was wrong was the execution, not the decision
 *
 * Two paragraphs of grey prose in two identical rounded rectangles occupying the
 * top 55% of the frame, and the remaining 45% empty. §5 asks an empty state to
 * be *designed* — "a moment to be charming, not a blank grid" — and this was the
 * blank grid. Gwent offline still shows your rank medal, your MMR and the ladder
 * art behind a "server unavailable" plate; MTGA renders your tier badge and pips
 * entirely locally. A rank crest is the most-screenshotted object in a
 * competitive card game and this build did not have one.
 *
 * So it has one now, and it is honest:
 *
 * **The crest shows local standing, computed from this device's own history.**
 * Not a ladder position — there is nobody to be above — but placement progress,
 * which is a real number the client owns: how many matches you have played of
 * the ten a placement would need. Unplaced draws the empty socket rather than a
 * gem, which is the truthful state and also the one that makes the filled
 * version mean something.
 *
 * **The ladder behind it is a silhouette.** Carved empty rows receding into the
 * dark, painted by the same generator as the event key art, with no name and no
 * number on any of them. It composes the frame and it claims nothing.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { getProfile } from "../../save/profile";
import { WIN_RATE_QUALIFIER, winRate } from "../../game/stats/dashboard";
import { audio } from "../../audio/audio";
import { artAttr, count, countUp, enter, icon, meter, quantify, rankMark } from "./data/kit";

export interface LeaderboardsCallbacks {
  onBack: () => void;
  onStats: () => void;
}

/** What a placement would need, if there were a ladder to be placed on. */
const PLACEMENT_MATCHES = 10;

export function createLeaderboardsScreen(_content: ContentIndex, callbacks: LeaderboardsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen leaderboards-screen";

  const profile = getProfile();
  const played = profile.stats.matchesPlayed;
  const toPlace = Math.max(0, PLACEMENT_MATCHES - played);
  const placed = toPlace === 0;
  const wins = profile.stats.wins;
  /* One definition, imported — see the note on `winRate` in `dashboard.ts`. */
  const decided = wins + profile.stats.losses;
  const rate = Math.round(winRate({ won: wins, lost: profile.stats.losses }) * 100);

  /**
   * Two different meters, because "placed" and "unplaced" are two questions.
   *
   * Before placement the bar is the placement itself — ten rungs, one per match,
   * which is a real countdown. After it, that bar is permanently at 100% with ten
   * tick marks showing through the fill, and a fully saturated full-width rail is
   * both meaningless and the most saturated object on the screen, which §6 spends
   * a paragraph forbidding. So once placed it becomes progress toward the next
   * local tier: partial, moving, and about something the player can still change.
   */
  const TIERS = 5;
  const WINS_PER_TIER = 5;
  const tier = placed ? Math.min(TIERS, 1 + Math.floor(wins / WINS_PER_TIER)) : 0;
  const winsIntoTier = wins % WINS_PER_TIER;
  const topTier = tier >= TIERS;

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="leaderboards-back">${icon("arrow-left", 16)} Back</button>
      <h1 class="title">Leaderboards</h1>
    </header>

    <main class="leaderboards-body data-body">
      <section class="mat-panel lb-standing">
        <div class="lb-standing-art" aria-hidden="true" ${artAttr("ladder", [1200, 400, "#b56cff"])}></div>
        <div class="lb-standing-inner">
          <div class="lb-crest">
            ${rankMark({ tier, tiers: 20 }, 132, placed ? `<span class="d-rank-value">${count(tier)}</span>` : "")}
            <span class="t-label">${placed ? `Local tier ${count(tier)} of ${count(TIERS)}` : "Unplaced"}</span>
          </div>

          <div class="lb-standing-text">
            <p class="t-label lb-eyebrow">Season server offline</p>
            <h2 class="t-display">${placed ? "Placed, locally" : "Not placed yet"}</h2>
            <p class="t-body">
              ${
                placed
                  ? `This device has your record and can rank you against yourself. It cannot rank you against
                     anybody else until the season server exists, and it will not pretend to.`
                  : `A placement takes ${quantify(PLACEMENT_MATCHES, "match", "matches")}. You have
                     ${quantify(played, "match", "matches")} on record, so there
                     ${toPlace === 1 ? "is one to go" : `are ${count(toPlace)} to go`}.`
              }
            </p>
            ${meter({
              value: placed
                ? topTier
                  ? 1
                  : winsIntoTier / WINS_PER_TIER
                : Math.min(1, played / PLACEMENT_MATCHES),
              steps: placed ? WINS_PER_TIER : PLACEMENT_MATCHES,
              animate: true,
              className: "lb-meter",
            })}
            <p class="t-label lb-meter-note">
              ${
                placed
                  ? topTier
                    ? `Top local tier reached · ${quantify(wins, "win")} on record`
                    : `${quantify(WINS_PER_TIER - winsIntoTier, "win")} to local tier ${count(tier + 1)}`
                  : `${quantify(toPlace, "match", "matches")} to a placement`
              }
            </p>
            <dl class="d-stats lb-stats">
              <div class="d-stat"><dt>Matches</dt><dd class="num" data-count="${played}" data-digits="4">0</dd></div>
              <div class="d-stat"><dt>Wins</dt><dd class="num" data-count="${wins}" data-digits="4">0</dd></div>
              <div class="d-stat"><dt>Win rate <span class="d-stat-qual">${WIN_RATE_QUALIFIER}</span></dt><dd class="num">${rate}%<span class="d-stat-of">${count(
                decided
              )} decided</span></dd></div>
            </dl>
            <div class="lb-actions">
              <button type="button" class="mat-hero act r-chip" id="leaderboards-stats">
                ${icon("log", 16)} Your own statistics
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="mat-panel leaderboards-explainer d-enter">
        <h2 class="t-heading">Not yet — and not faked either</h2>
        <p class="t-body">
          Leaderboards need the server, and this build does not have one. Rather than show
          you a sample ladder with invented names on it, there is nothing here.
        </p>
        <p class="t-body">
          When it arrives it will carry the ranked ladder (top 200, with your own position
          pinned), Fan Club standings and event boards, filtered by region, season and
          faction — and a season archive, so a climb you made is still readable after the
          season that contained it has ended.
        </p>
        <p class="t-body">
          Boards will be cleaned retroactively. A rank that came from something other than
          playing does not get to stay on a page with your name under it.
        </p>
      </section>

      <section class="mat-panel leaderboards-note d-enter">
        <h3 class="t-heading">What does work offline</h3>
        <ul class="lb-works">
          ${[
            ["log", "The statistics dashboard"],
            ["mode-replays", "Match history, with full replays"],
            ["mastery", "Faction and Leader Mastery"],
            ["kw-parasocial", "The Bias Board"],
            ["achievement", "Achievements"],
          ]
            .map(
              ([id, label]) =>
                `<li class="mat-chip lb-work d-enter">${icon(id as never, 15)}<span>${label}</span></li>`
            )
            .join("")}
        </ul>
        <p class="t-body">
          Everything that measures you against yourself. None of it needed a server, which is
          why it shipped first.
        </p>
      </section>
    </main>`;

  root.querySelector("#leaderboards-back")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onBack();
  });
  root.querySelector("#leaderboards-stats")?.addEventListener("click", () => callbacks.onStats());

  enter(root);
  countUp(root);

  return { root };
}
