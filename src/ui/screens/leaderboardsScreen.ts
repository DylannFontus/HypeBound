/**
 * Leaderboards — `03-screens-and-navigation.md` §4.5.7.
 *
 * The design marks this screen **ONLINE** and is unusually specific about what
 * the offline build should do: *"requires the server (no fake ladder is ever
 * rendered offline — explainer panel only)"*. So that is the whole screen. There
 * is no placeholder table, no greyed-out sample ranking, and no "coming soon"
 * over a mock — because a mock ladder is a lie that people screenshot.
 *
 * It exists at all rather than being a dead link because §4.5.4 lists it among
 * the profile's exits, and a button that goes nowhere teaches players not to
 * trust buttons. This one goes somewhere and tells the truth when it gets there.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { audio } from "../../audio/audio";

export interface LeaderboardsCallbacks {
  onBack: () => void;
  onStats: () => void;
}

export function createLeaderboardsScreen(_content: ContentIndex, callbacks: LeaderboardsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen leaderboards-screen";

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="leaderboards-back">← Back</button>
      <h1 class="title">Leaderboards</h1>
    </header>

    <main class="leaderboards-body">
      <section class="panel panel-chrome leaderboards-explainer">
        <h2 class="profile-section-title">Not yet — and not faked either</h2>
        <p>
          Leaderboards need the server, and this build does not have one. Rather than show
          you a sample ladder with invented names on it, there is nothing here.
        </p>
        <p class="muted">
          When it arrives it will carry the ranked ladder (top 200, with your own position
          pinned), Fan Club standings and event boards, filtered by region, season and
          faction — and a season archive, so a climb you made is still readable after the
          season that contained it has ended.
        </p>
        <p class="muted">
          Boards will be cleaned retroactively. A rank that came from something other than
          playing does not get to stay on a page with your name under it.
        </p>
        <div class="stats-actions">
          <button class="btn btn-ghost" id="leaderboards-stats">Your own statistics →</button>
        </div>
      </section>

      <section class="panel panel-chrome leaderboards-note">
        <h3 class="profile-section-title">What does work offline</h3>
        <p class="muted">
          Everything that measures you against yourself: the statistics dashboard, match
          history with full replays, Faction and Leader Mastery, the Bias Board and
          achievements. None of those needed a server, which is why they shipped first.
        </p>
      </section>
    </main>`;

  root.querySelector("#leaderboards-back")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onBack();
  });
  root.querySelector("#leaderboards-stats")?.addEventListener("click", () => callbacks.onStats());

  return { root };
}
