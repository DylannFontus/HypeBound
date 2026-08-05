/**
 * Main lobby — the hub, and the first thing anybody ever sees.
 *
 * Three things about this screen were broken rather than merely plain, and the
 * shape of the file is mostly a record of fixing them.
 *
 * **It did not fit.** At 1280×720 — the stated minimum — the nav grid ran to a
 * scrollHeight of 822 inside a `clientHeight` of 720 with `overflow: hidden` on
 * both the screen and the body, so 102px was clipped with no way to reach it.
 * The Inbox button, badged with eight unread, sat entirely below the fold, and
 * the footer's dev-build string was painted straight through the Achievements
 * and Events tiles. The nav is now a 3×3 rather than a 2-column column of five
 * rows, every vertical dimension is clamped against `vh`, and the footer is
 * gone — a note about where the art directory lives is not product chrome.
 *
 * **On a phone in landscape it deleted itself.** The right rail was
 * `display: none` below 1100px, so the record, the dailies and the news were
 * removed rather than reflowed, and seven of the nine destinations were under a
 * hard clip. Deleting a feature is not a responsive strategy: the rail is now a
 * badged drawer that the header can open at any width, and the nav becomes a
 * snap-scrolling rail rather than a grid that runs off the bottom.
 *
 * **Everything was made of one material.** The identity chip, both currencies,
 * the deck widget, all nine destinations and all three rail panels were the same
 * translucent purple wash with a 1px lilac hairline — thirty objects, one
 * recipe, no light source, so nothing on screen had a rank. Every surface here
 * now names one of `foundation.css`'s four materials, and the chips, tiles and
 * panels sit at three visibly different heights under one 315° key light.
 *
 * The leader is drawn as a *portrait* rather than as a shrunken trading card.
 * `renderCardToCanvas(leader, 300)` used to put a 300px card — cost pip, type
 * line, rules text at roughly 8px, a health pip that means nothing in a menu —
 * where a hero belongs. What is here instead is art only, at a 3:4 crop, in a
 * lit frame, with its cast shadow decoupled from its float so the portrait
 * breathes without dragging its own shadow around with it.
 *
 * That painter used to live in this file, and living here is what let the
 * starter picker keep the defect for another three rounds while the lobby was
 * clean. It is `src/ui/art/leaderPortrait.ts` now, and the starter screen, the
 * sign-in stage and the queue's plinth all call the same function.
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
import { CURRENT_PALETTE, FACTION_COLOR } from "../cardRenderer/palette";
import { paintLeaderPortrait } from "../art/leaderPortrait";
import { icon, type IconId } from "../art/uiIcons";
import { count, num } from "../format";
import { motionEnabled, stagger, tickerTo } from "../motion";
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

/**
 * The nine destinations, as data.
 *
 * A list rather than nine hand-written buttons because every one of them now
 * carries five things — an icon, a watermark of the same icon, an accent, a
 * badge slot and a one-line description — and nine copies of that markup is
 * nine chances for one tile to drift away from its neighbours. The accent is
 * the only thing that differs between them, which is the point: rank is carried
 * by the material and the position, and colour is carried by exactly one hue
 * per destination so a player learns the shape of the grid rather than reading
 * it every time.
 */
interface Destination {
  id: string;
  label: string;
  hint: string;
  mark: IconId;
  accent: string;
}

const DESTINATIONS: readonly Destination[] = [
  { id: "lobby-collection", label: "Collection", hint: "Every card you own", mark: "collection", accent: "#b56cff" },
  { id: "lobby-builder", label: "Deck Builder", hint: "Build and tune", mark: "deck-builder", accent: "#52c8ff" },
  { id: "lobby-shop", label: "Merch Drops", hint: "Open your packs", mark: "merch-drop", accent: "#ffb43d" },
  { id: "lobby-missions", label: "Missions", hint: "Daily and weekly", mark: "missions", accent: "#5fe0a8" },
  { id: "lobby-mastery", label: "Mastery", hint: "Ranks per leader", mark: "mastery", accent: "#ff9f6c" },
  { id: "lobby-pass", label: "Hype Wave", hint: "This season's track", mark: "hype-wave", accent: "#ff5fa2" },
  { id: "lobby-achievements", label: "Achievements", hint: "Long-run goals", mark: "achievement", accent: "#ffd166" },
  { id: "lobby-events", label: "Events", hint: "Limited-time runs", mark: "events", accent: "#c77dff" },
  { id: "lobby-inbox", label: "Inbox", hint: "Gifts and notices", mark: "inbox", accent: "#7fd6ff" },
];

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

  const badges: Record<string, number> = {
    "lobby-missions": claimableCount,
    "lobby-mastery": masteryCount,
    "lobby-pass": passCount,
    "lobby-achievements": achievementCount,
    "lobby-events": eventCount,
    "lobby-inbox": mailCount,
  };
  /** Everything the rail is holding, so the drawer button can carry one number. */
  const railCount = claimableCount + eventCount + mailCount;

  const xpNeeded = xpForLevel(profile.accountLevel);
  const xpRatio = Math.min(1, profile.accountXp / xpNeeded);
  const winRate =
    profile.stats.matchesPlayed > 0
      ? Math.round((profile.stats.wins / profile.stats.matchesPlayed) * 100)
      : 0;

  const destinationMarkup = DESTINATIONS.map((destination) => {
    const badge = badges[destination.id] ?? 0;
    return `
      <button class="lobby-nav-btn mat-panel act" id="${destination.id}" type="button"
              style="--tile-accent:${destination.accent}">
        <span class="lobby-nav-wash" aria-hidden="true"></span>
        <span class="lobby-nav-mark">${icon(destination.mark, { optical: "hero" })}</span>
        <span class="lobby-nav-label">${destination.label}</span>
        <span class="lobby-nav-hint">${destination.hint}</span>
        ${
          badge > 0
            ? `<span class="lobby-nav-badge num" style="--digits:2" aria-label="${count(badge)} waiting">${count(badge)}</span>`
            : ""
        }
      </button>`;
  }).join("");

  root.innerHTML = `
    <div class="lobby-bg" aria-hidden="true"></div>

    <header class="lobby-top">
      <div class="lobby-top-plate" aria-hidden="true"></div>
      <button class="lobby-identity mat-chip act" id="lobby-profile" type="button">
        <span class="lobby-avatar" style="--c:${palette.key}">${profile.displayName.charAt(0).toUpperCase()}</span>
        <span class="lobby-identity-text">
          <span class="lobby-name">${profile.displayName}</span>
          <span class="lobby-level">
            <span class="t-label lobby-level-num">Lv <span class="num" style="--digits:2">${num(profile.accountLevel)}</span></span>
            <span class="lobby-xp mat-well" role="img"
                  aria-label="${num(profile.accountXp)} of ${num(xpNeeded)} XP to the next level">
              <span class="lobby-xp-fill well-fill" style="width:${(xpRatio * 100).toFixed(2)}%"></span>
            </span>
            <span class="lobby-xp-read num" style="--digits:11">${num(profile.accountXp)} / ${num(xpNeeded)}</span>
          </span>
        </span>
      </button>

      <div class="lobby-wordmark" role="img" aria-label="HYPEBOUND"></div>

      <div class="lobby-currencies">
        <div class="lobby-currency mat-chip" title="Clout — earned by playing">
          <span class="lobby-currency-mark clout">${icon("clout", { label: "Clout" })}</span>
          <span class="lobby-currency-value num" style="--digits:7" data-value="${profile.clout}">0</span>
        </div>
        <div class="lobby-currency mat-chip" title="Shards — craft any card">
          <span class="lobby-currency-mark shards">${icon("shards", { label: "Shards" })}</span>
          <span class="lobby-currency-value num" style="--digits:7" data-value="${profile.shards}">0</span>
        </div>
        <button class="lobby-rail-toggle mat-chip act" id="lobby-rail-toggle" type="button"
                aria-expanded="false" aria-controls="lobby-rail" aria-label="Your record, missions and news">
          ${icon("log")}
          ${railCount > 0 ? `<span class="lobby-nav-badge num" style="--digits:2">${count(railCount)}</span>` : ""}
        </button>
        <button class="lobby-cog mat-chip act" id="lobby-settings" type="button" aria-label="Settings">
          ${icon("settings")}
        </button>
      </div>
    </header>

    <main class="lobby-body">
      <section class="lobby-stage">
        ${
          /**
           * The empty state is a designed object, not a hole.
           *
           * A new account with no deck is a state a real player spends their
           * first few minutes in, and §5 says empty states are designed too. It
           * is a recess where the portrait will stand — the same silhouette, in
           * `.mat-well` rather than `.mat-panel`, so the shape of the page does
           * not change when a leader arrives.
           */
          leader
            ? `<div class="lobby-portrait mat-panel" id="lobby-leader-art">
                 <div class="lobby-portrait-frame"></div>
                 <div class="lobby-portrait-gloss" aria-hidden="true"></div>
               </div>
               <div class="lobby-portrait-cast" aria-hidden="true"></div>`
            : `<div class="lobby-portrait lobby-portrait-empty mat-well">
                 <span class="lobby-portrait-empty-mark">${icon("deck-builder", { optical: "hero" })}</span>
                 <span class="t-heading">No leader yet</span>
                 <span class="t-body">Build a deck and its Leader stands here.</span>
               </div>`
        }
        <div class="lobby-leader-info">
          <div class="t-label lobby-faction" style="color:${palette.key}">${faction?.name ?? "No deck selected"}</div>
          <h1 class="lobby-leader-name t-display">${leader?.name ?? "Choose a Leader"}</h1>
          <div class="lobby-leader-title">${leader?.title ?? ""}</div>
          <div class="lobby-current-badge mat-chip chip-static">
            <span class="lobby-current-dot" style="--c:${palette.key}"></span>
            <span class="t-label">${palette.label}${leader?.secondaryCurrent ? ` · ${CURRENT_PALETTE[leader.secondaryCurrent].label}` : ""}</span>
          </div>
        </div>
      </section>

      <section class="lobby-actions">
        <button class="lobby-play mat-hero act" id="lobby-play" type="button">
          <span class="lobby-play-mark">${icon("play", { optical: "hero" })}</span>
          <span class="lobby-play-word">Play</span>
        </button>

        <button class="lobby-deck-widget mat-panel act" id="lobby-deck" type="button">
          <span class="lobby-deck-mark">${icon("deck", { optical: "display" })}</span>
          <span class="lobby-deck-text">
            <span class="t-label">Active Deck</span>
            <span class="lobby-deck-name">${deck?.name ?? "No deck"}</span>
          </span>
          <span class="lobby-deck-meta">
            ${
              deck
                ? `<span class="num" style="--digits:2">${num(deck.cards.length)}</span><span class="t-label">cards</span>`
                : `<span class="t-label">Build one</span>`
            }
          </span>
        </button>

        <div class="lobby-nav" role="group" aria-label="Destinations">${destinationMarkup}</div>
      </section>

      <aside class="lobby-rail" id="lobby-rail" data-open="false">
        <div class="lobby-rail-head">
          <span class="t-label">Your night so far</span>
          <button class="lobby-rail-close act" id="lobby-rail-close" type="button" aria-label="Close">
            ${icon("close")}
          </button>
        </div>

        <div class="lobby-card mat-panel">
          <div class="t-label">Your Record</div>
          <div class="lobby-record">
            <div class="record-stat">
              <span class="record-figure"><span class="record-value num" style="--digits:4" data-value="${profile.stats.wins}">0</span></span>
              <span class="record-label t-label">Wins</span>
            </div>
            <div class="record-stat">
              <span class="record-figure"><span class="record-value num" style="--digits:4" data-value="${profile.stats.losses}">0</span></span>
              <span class="record-label t-label">Losses</span>
            </div>
            <div class="record-stat">
              <!--
                The reservation is on the *figure*, not on the number, and that
                is the whole difference between "100%" and "10⊘".

                The .num role's --digits reserves character cells inside the
                value and centres the ink, which is right for a bare figure and
                wrong the moment a unit is welded to its right edge: at three
                reserved cells the suffix's optical kern had a whole cell of
                slack to eat while the value read "0", and none at all while it
                read "100". Measured at 4x on the widest value the slot can hold,
                the per-cent sign overlapped the final zero's ink by 2.5px at
                100%, 3.4px at 140% and 3.9px at 160% — at every interface scale
                the game ships, including the default.

                So the number is sized by its own digits and the pair is centred
                inside a fixed box. The box never changes width, which is what
                the reservation was for; the ink recentres once per digit
                gained, which is what a counter does.
              -->
              <span class="record-figure record-figure-unit"><span class="record-value num" data-value="${winRate}">0</span><span class="record-suffix">%</span></span>
              <span class="record-label t-label">Win rate</span>
            </div>
          </div>
        </div>

        <div class="lobby-card mat-panel">
          <div class="t-label">Daily Missions</div>
          <ul class="lobby-mission-list">
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
                  const ratio = need > 0 ? Math.min(1, done / need) : 0;
                  return `<li class="lobby-mission ${view.progress.complete ? "is-complete" : ""}">
                            <span class="lobby-mission-row">
                              <span class="lobby-mission-name">${view.def.name}</span>
                              <span class="lobby-mission-count num" style="--digits:5">${
                                view.progress.complete ? "Ready" : `${num(done)}/${num(need)}`
                              }</span>
                            </span>
                            <span class="lobby-mission-track mat-well">
                              <span class="lobby-mission-fill well-fill" style="width:${(ratio * 100).toFixed(1)}%"></span>
                            </span>
                          </li>`;
                })
                .join("") ||
              `<li class="lobby-mission"><span class="lobby-mission-row"><span class="lobby-mission-name muted">No dailies held right now.</span></span></li>`
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
            ? `<button class="lobby-card lobby-news mat-panel act ${headline.read ? "" : "unread"}" id="lobby-news" type="button">
                 <div class="t-label">What's New${headline.read ? "" : ` · <span class="lobby-news-new">new</span>`}</div>
                 <div class="lobby-news-title">${headline.article.title}</div>
                 <p class="muted">${headline.article.summary}</p>
               </button>`
            : ""
        }
      </aside>
    </main>

    <div class="lobby-rail-scrim" id="lobby-rail-scrim" hidden></div>`;

  // ---- the leader portrait -------------------------------------------------
  const frame = root.querySelector(".lobby-portrait-frame");
  if (frame && leader) {
    frame.appendChild(paintLeaderPortrait(leader, { width: 456, className: "lobby-portrait-art" }));
  }

  // ---- counters ------------------------------------------------------------
  /**
   * Every number on this screen counts up rather than being printed.
   *
   * §3a asks for it by name, and the reason it matters here specifically is that
   * the lobby is the screen a player lands on after a match: the Clout they just
   * won should arrive as a number moving, not as a receipt already printed. The
   * markup ships `0` and the real value in `data-value`, so a reduced-motion
   * player still gets the truth on the first frame — `tickerTo` collapses to a
   * single assignment when the setting is on.
   */
  for (const element of root.querySelectorAll<HTMLElement>("[data-value]")) {
    // `tickerTo` owns the whole `textContent`, which is why every unit on this
    // screen — the `%` on the win rate, the word "cards" — is a sibling.
    tickerTo(element, Number(element.dataset["value"] ?? "0"), 900);
  }

  // ---- entrances -----------------------------------------------------------
  /**
   * The cascade, over and above the one `transitions.css` already runs.
   *
   * That rule staggers the first seven children of each structural container,
   * which covers the stage, the actions column and the rail as *blocks*. It
   * cannot reach the nine tiles inside the nav grid or the panels inside an
   * `<aside>`, and those are exactly the places where nine things arriving on
   * one frame reads as a page loading rather than an app booting.
   */
  /* Tightened so the last of the nine lands at 268ms rather than 330, for the
     reason written out at `playScreen.ts`'s call: a cascade that outlives the
     navigation leaves the arriving screen dark in the middle of it. */
  stagger(root.querySelectorAll(".lobby-nav-btn"), { step: 26, from: 60 });
  stagger(root.querySelectorAll(".lobby-rail > .lobby-card"), { step: 42, from: 120 });

  // ---- behaviour -----------------------------------------------------------
  const bind = (id: string, handler: () => void): void => {
    root.querySelector(`#${id}`)?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      handler();
    });
  };

  /**
   * The hover sound lands on the same frame as the light.
   *
   * `pointerenter` rather than `mouseover`, because the latter fires again for
   * every child element the pointer crosses and a tile with an icon, a label and
   * a hint would chirp three times on one hover.
   */
  for (const target of root.querySelectorAll(".lobby-nav-btn, .lobby-play, .lobby-deck-widget")) {
    target.addEventListener("pointerenter", () => audio.play("sfx.ui.hover"));
  }

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

  /**
   * The rail as a drawer, which is what replaces `display: none`.
   *
   * Below 1100px the rail is off-canvas rather than absent, and this button is
   * the way back to it — badged, so a player can see there is something in there
   * without opening it. Above 1100px the button is hidden by CSS and the rail is
   * simply a column; the attribute it toggles is inert there, which is what
   * keeps one piece of markup serving both.
   */
  const rail = root.querySelector<HTMLElement>("#lobby-rail");
  const railToggle = root.querySelector<HTMLElement>("#lobby-rail-toggle");
  const scrim = root.querySelector<HTMLElement>("#lobby-rail-scrim");
  const setRail = (open: boolean): void => {
    rail?.setAttribute("data-open", String(open));
    railToggle?.setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !open;
  };
  railToggle?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    setRail(rail?.getAttribute("data-open") !== "true");
  });
  root.querySelector("#lobby-rail-close")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    setRail(false);
  });
  scrim?.addEventListener("click", () => setRail(false));
  /**
   * Escape closes it from anywhere.
   *
   * On the screen root this only fired while focus happened to be inside the
   * lobby, which after opening a drawer with a pointer it is not — so the one
   * key everybody presses to dismiss an overlay did nothing. On `document`, with
   * the listener removed when the screen goes away.
   */
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (rail?.getAttribute("data-open") !== "true") return;
    setRail(false);
    railToggle?.focus();
  };
  document.addEventListener("keydown", onEscape);

  /**
   * The rail's own two ramps, lit only while there is something under them.
   *
   * As a column the rail is a scroller, and at 160% on a 720p window its three
   * panels do not fit: measured, the news summary lost 59px of its 156 to a
   * hard horizontal edge with no fade and nothing to say the sentence carried
   * on. The stylesheet draws the ramps as a mask whose stops collapse onto the
   * element's own edges at zero, so writing 0 here is not "a faint gradient" but
   * no gradient at all — which matters on the last panel, where a ramp still
   * burning says there is more to read when there is not.
   *
   * Custom properties rather than a class, for the reason the shell's own
   * cascade note gives: a class toggle on a screen subtree registered a
   * whole-subtree invalidation in Blink and cost this project 23–42ms per
   * navigation.
   */
  const railScroll = (): void => {
    if (!rail) return;
    const room = rail.scrollHeight - rail.clientHeight;
    rail.style.setProperty("--fade-top", rail.scrollTop > 2 ? "1" : "0");
    rail.style.setProperty("--fade-bottom", room - rail.scrollTop > 2 ? "1" : "0");
  };
  rail?.addEventListener("scroll", railScroll, { passive: true });
  /* An observer as well, because the first read happens on a detached tree and
     because the window and the interface scale are what decide whether this
     column overflows in the first place. */
  const railResize = typeof ResizeObserver === "undefined" || !rail ? null : new ResizeObserver(railScroll);
  if (rail) railResize?.observe(rail);
  railScroll();

  /**
   * The portrait breathes, and its shadow stays planted.
   *
   * The old float welded a `drop-shadow` to the card's own transform, so the
   * shadow rotated and rose with it — a light source bolted to the object it is
   * lighting. The cast is a separate element on the floor now; it only softens
   * and shrinks as the portrait lifts away from it, which is what a shadow does.
   * One custom property drives both, so they cannot drift out of phase.
   */
  if (motionEnabled()) root.querySelector(".lobby-stage")?.classList.add("is-breathing");

  audio.playMusic("music.menu");
  // The room tone under the theme. Independent of the music, so a screen
  // change that swaps the track does not restart the bed.
  audio.playAmbient("ambient.menu");

  return {
    root,
    dispose: () => {
      document.removeEventListener("keydown", onEscape);
      rail?.removeEventListener("scroll", railScroll);
      railResize?.disconnect();
    },
  };
}
