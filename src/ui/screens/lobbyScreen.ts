/**
 * Main lobby — the hub.
 *
 * Layout follows the product requirement: the selected leader dominates the
 * stage, Play/Collection/Deck Builder are always in the same place and never
 * covered, and promotional material sits in a bounded rail rather than over
 * the navigation.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import {
  achievementsUnclaimed,
  activeDeck,
  eventViews,
  settleDailyBonus,
  settleEvents,
  hypeWaveUnclaimed,
  syncHypeWave,
  getProfile,
  headlineArticle,
  masteryUnclaimed,
  syncMissions,
  unreadMail,
  xpForLevel,
} from "../../save/profile";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE, FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";

export interface LobbyCallbacks {
  onPlay: () => void;
  onCollection: () => void;
  onDeckBuilder: () => void;
  onShop: () => void;
  onMissions: () => void;
  onMastery: () => void;
  onAchievements: () => void;
  onPass: () => void;
  onInbox: () => void;
  onEvents: () => void;
  onNews: (articleId?: string) => void;
  onSettings: () => void;
  onProfile: () => void;
}

export function createLobbyScreen(content: ContentIndex, callbacks: LobbyCallbacks): Screen {
  const profile = getProfile();
  const deck = activeDeck();
  const leader = deck ? content.leaders[deck.leaderCardId] : null;
  const faction = leader ? content.factions[leader.faction] : null;
  const palette = leader ? CURRENT_PALETTE[leader.current] : CURRENT_PALETTE.prism;

  const root = document.createElement("div");
  root.className = "screen lobby-screen";
  root.style.setProperty("--lobby-accent", palette.key);
  root.style.setProperty("--lobby-faction", FACTION_COLOR[leader?.faction ?? "neutral"] ?? "#8f8aa8");

  /**
   * How many missions are sitting finished and unclaimed.
   *
   * Shown as a badge because the alternative — the player discovering it by
   * opening the screen — makes a reward that is already earned feel like a thing
   * you have to remember to collect.
   */
  const missions = syncMissions(content);
  const claimableCount = missions.filter((view) => view.progress.complete).length;
  /** The same badge, for mastery ranks that are earned and unclaimed. */
  const masteryCount = masteryUnclaimed(content);
  const achievementCount = achievementsUnclaimed(content);
  // syncing here is what makes the Welcome Back package (§10.5.4) post to the
  // inbox on the first screen somebody sees rather than only if they open the pass
  syncHypeWave();
  const passCount = hypeWaveUnclaimed();
  /**
   * Events, settled before they are counted.
   *
   * `settleEvents` pays out any run that ended while the game was closed, so the
   * lobby cannot show a badge for currency that is already Clout — and 07's
   * "auto-converts" happens on the first screen somebody sees, exactly as the
   * Hype Wave sync above it does.
   */
  settleEvents();
  /**
   * And any Merch Drops owed for dailies already completed — 09 §11's pack per
   * seven, paid cumulatively.
   *
   * Back-filling matters: an account that finished dailies before the pack
   * shipped is owed them, and counting only from today would quietly keep what
   * it had already earned.
   */
  settleDailyBonus(content);
  const eventCount = eventViews().reduce(
    (sum, view) => sum + view.missions.filter((mission) => mission.claimable).length,
    0
  );
  const mailCount = unreadMail(content);
  const headline = headlineArticle(content);

  const xpNeeded = xpForLevel(profile.accountLevel);
  const xpRatio = Math.min(1, profile.accountXp / xpNeeded);
  const winRate =
    profile.stats.matchesPlayed > 0
      ? Math.round((profile.stats.wins / profile.stats.matchesPlayed) * 100)
      : 0;

  root.innerHTML = `
    <div class="ambient-bg lobby-bg"></div>
    <div class="lobby-glow"></div>

    <header class="lobby-top">
      <button class="lobby-identity" id="lobby-profile">
        <div class="lobby-avatar" style="--c:${palette.key}">${profile.displayName.charAt(0).toUpperCase()}</div>
        <div class="lobby-identity-text">
          <div class="lobby-name">${profile.displayName}</div>
          <div class="lobby-level">
            <span>Lv ${profile.accountLevel}</span>
            <span class="lobby-xp"><span class="lobby-xp-fill" style="width:${xpRatio * 100}%"></span></span>
          </div>
        </div>
      </button>

      <div class="lobby-wordmark" role="img" aria-label="HYPEBOUND"></div>

      <div class="lobby-currencies">
        <div class="currency" title="Clout — earned by playing">
          <span class="currency-icon clout">◈</span><span class="currency-value">${profile.clout.toLocaleString()}</span>
        </div>
        <div class="currency" title="Shards — craft any card">
          <span class="currency-icon shards">✦</span><span class="currency-value">${profile.shards.toLocaleString()}</span>
        </div>
        <button class="btn btn-ghost btn-icon" id="lobby-settings" aria-label="Settings">⚙</button>
      </div>
    </header>

    <main class="lobby-body">
      <section class="lobby-stage">
        <div class="lobby-leader-art" id="lobby-leader-art"></div>
        <div class="lobby-leader-info">
          <div class="eyebrow" style="color:${palette.key}">${faction?.name ?? "No deck selected"}</div>
          <h1 class="lobby-leader-name">${leader?.name ?? "Choose a Leader"}</h1>
          <div class="lobby-leader-title">${leader?.title ?? ""}</div>
          <div class="lobby-current-badge">
            <span class="lobby-current-dot" style="--c:${palette.key}"></span>
            ${palette.label}${leader?.secondaryCurrent ? ` · ${CURRENT_PALETTE[leader.secondaryCurrent].label}` : ""}
          </div>
        </div>
      </section>

      <section class="lobby-actions">
        <button class="btn btn-primary btn-play" id="lobby-play">
          <span>Play</span>
        </button>

        <button class="lobby-deck-widget" id="lobby-deck">
          <div class="eyebrow">Active Deck</div>
          <div class="lobby-deck-name">${deck?.name ?? "No deck"}</div>
          <div class="lobby-deck-meta muted">${deck ? `${deck.cards.length} cards` : "Build one to start"}</div>
        </button>

        <div class="lobby-nav">
          <button class="btn lobby-nav-btn" id="lobby-collection">
            <span class="lobby-nav-icon">▦</span><span>Collection</span>
          </button>
          <button class="btn lobby-nav-btn" id="lobby-builder">
            <span class="lobby-nav-icon">✎</span><span>Deck Builder</span>
          </button>
          <button class="btn lobby-nav-btn" id="lobby-shop">
            <span class="lobby-nav-icon">◈</span><span>Merch Drops</span>
          </button>
          <button class="btn lobby-nav-btn" id="lobby-missions">
            <span class="lobby-nav-icon">☑</span><span>Missions</span>
            ${claimableCount > 0 ? `<span class="lobby-nav-badge">${claimableCount}</span>` : ""}
          </button>
          <button class="btn lobby-nav-btn" id="lobby-mastery">
            <span class="lobby-nav-icon">★</span><span>Mastery</span>
            ${masteryCount > 0 ? `<span class="lobby-nav-badge">${masteryCount}</span>` : ""}
          </button>
          <button class="btn lobby-nav-btn" id="lobby-pass">
            <span class="lobby-nav-icon">〜</span><span>Hype Wave</span>
            ${passCount > 0 ? `<span class="lobby-nav-badge">${passCount}</span>` : ""}
          </button>
          <button class="btn lobby-nav-btn" id="lobby-achievements">
            <span class="lobby-nav-icon">🏆</span><span>Achievements</span>
            ${achievementCount > 0 ? `<span class="lobby-nav-badge">${achievementCount}</span>` : ""}
          </button>
          <button class="btn lobby-nav-btn" id="lobby-events">
            <span class="lobby-nav-icon">✦</span><span>Events</span>
            ${eventCount > 0 ? `<span class="lobby-nav-badge">${eventCount}</span>` : ""}
          </button>
          <button class="btn lobby-nav-btn" id="lobby-inbox">
            <span class="lobby-nav-icon">✉</span><span>Inbox</span>
            ${mailCount > 0 ? `<span class="lobby-nav-badge">${mailCount}</span>` : ""}
          </button>
        </div>
      </section>

      <aside class="lobby-rail">
        <div class="panel lobby-card">
          <div class="eyebrow">Your Record</div>
          <div class="lobby-record">
            <div class="record-stat"><span class="record-value">${profile.stats.wins}</span><span class="record-label">Wins</span></div>
            <div class="record-stat"><span class="record-value">${profile.stats.losses}</span><span class="record-label">Losses</span></div>
            <div class="record-stat"><span class="record-value">${winRate}%</span><span class="record-label">Win rate</span></div>
          </div>
        </div>

        <div class="panel lobby-card">
          <div class="eyebrow">Daily Missions</div>
          <ul class="mission-list">
            ${
              /**
               * The missions this account is actually holding.
               *
               * This panel used to be three hard-coded rows — "Win with 2
               * different Currents 0/2" every time, for everybody, forever. It
               * had the shape of progress and none of the substance, which is
               * worse than an empty panel: a player who did win with two
               * Currents would have watched it stay at 0 and concluded the
               * missions were broken.
               */
              missions
                .filter((view) => view.active.cadence === "daily")
                .map((view) => {
                  const done = view.progress.parts.reduce((sum, part) => sum + Math.min(part.have, part.need), 0);
                  const need = view.progress.parts.reduce((sum, part) => sum + part.need, 0);
                  return `<li class="mission ${view.progress.complete ? "complete" : ""}">
                            <span class="mission-text">${view.def.name}</span>
                            <span class="mission-progress">${view.progress.complete ? "Ready" : `${done}/${need}`}</span>
                          </li>`;
                })
                .join("") || `<li class="mission"><span class="mission-text muted">No dailies held right now.</span></li>`
            }
          </ul>
        </div>

        ${
          /**
           * §4.2.1's news carousel card, reduced to the one article that matters:
           * the newest.
           *
           * This panel used to be a fixed paragraph about the Eight Currents —
           * true, but "What's New" implies it changes, and it never did. It reads
           * the feed now, and clicking it opens that article.
           */
          headline
            ? `<button class="panel lobby-card lobby-news ${headline.read ? "" : "unread"}" id="lobby-news">
                 <div class="eyebrow">What's New${headline.read ? "" : ` · <span class="lobby-news-new">new</span>`}</div>
                 <div class="lobby-news-title">${headline.article.title}</div>
                 <p class="muted">${headline.article.summary}</p>
               </button>`
            : ""
        }
      </aside>
    </main>

    <footer class="lobby-footer">
      <span class="faint">HYPEBOUND · offline build · your art and music drop into <code>public/assets/</code></span>
    </footer>`;

  // leader portrait, rendered from the card renderer so it matches everywhere
  const artHost = root.querySelector("#lobby-leader-art");
  if (artHost && leader) {
    artHost.appendChild(renderCardToCanvas(leader, 300));
  }

  const bind = (id: string, handler: () => void): void => {
    root.querySelector(`#${id}`)?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      handler();
    });
  };

  bind("lobby-play", callbacks.onPlay);
  bind("lobby-collection", callbacks.onCollection);
  bind("lobby-builder", callbacks.onDeckBuilder);
  bind("lobby-shop", callbacks.onShop);
  bind("lobby-missions", callbacks.onMissions);
  bind("lobby-mastery", callbacks.onMastery);
  bind("lobby-achievements", callbacks.onAchievements);
  bind("lobby-events", callbacks.onEvents);
  bind("lobby-inbox", callbacks.onInbox);
  if (headline) bind("lobby-news", () => callbacks.onNews(headline.article.def.id));
  bind("lobby-pass", callbacks.onPass);
  bind("lobby-deck", callbacks.onDeckBuilder);
  bind("lobby-settings", callbacks.onSettings);
  bind("lobby-profile", callbacks.onProfile);

  audio.playMusic("music.menu");

  return { root };
}
