/**
 * Mode select. Modes that need a server are listed honestly as "coming online"
 * rather than stubbed with fake UI (architecture contract §7).
 *
 * ## Why this is three tiers rather than one grid
 *
 * It used to be fourteen identical cards in an `auto-fill` grid with
 * `align-content: start`: same size, same material, same 52px purple icon
 * plate, and twelve of them carrying the identical green word READY — a status
 * that conveys nothing because it is never absent. At 1600×900 the grid stopped
 * after three and a half rows and left a 340px band of dead black across the
 * bottom, and the wider the display the more of it there was. Hearthstone's
 * Play screen is two enormous illustrated plates; Arena's format select is
 * full-bleed key art with the featured event at twice the size of the rest;
 * Gwent's is a vertical stack of painted banners. None of the three present
 * their modes as a table, because a table says every row is equally likely to
 * be the one you want, and that is not true here.
 *
 * So the fourteen are ranked. One hero — whichever of Casual and Practice is
 * actually live in this build — then four that most people play next, then the
 * long tail as a compact list. READY is gone entirely: a mode you can press
 * needs no label saying so, and dropping it leaves the only coloured status
 * text on the screen attached to the things that genuinely have something to
 * say ("Coming online", "Resume — 4–1", "1 of 10 unlocked").
 */

import type { AiDifficulty, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { AI_DIFFICULTY_BLURB, AI_DIFFICULTY_LABEL, AI_DIFFICULTY_ORDER } from "../../ai/profiles";
import { activeDeck, getProfile, tourView } from "../../save/profile";
import { onlineAvailable } from "../../config";
import { tourProgress } from "../../game/progression/grandTour";
import { audio } from "../../audio/audio";
import { BOSS_TIERS, bossForWeek, clearKey } from "../../game/weeklyBoss";
import { hasClaimed } from "../../save/profile";
import { activeRun } from "../../save/doomscrollSave";
import { activeGauntlet } from "../../save/gauntletSave";
import { icon, modeIcon, type IconId } from "../art/uiIcons";
import { paintLeaderPortrait, paintVenue } from "../art/leaderPortrait";
import { stagger } from "../motion";

export interface PlayCallbacks {
  onStartAiMatch: (difficulty: AiDifficulty) => void;
  onStartTutorial: () => void;
  onStartPuzzles: () => void;
  onOpenReplays: () => void;
  onOpenLab: () => void;
  onStartDoomscroll: () => void;
  onStartGauntlet: () => void;
  onStartRemix: () => void;
  onStartCustom: () => void;
  onStartStory: () => void;
  onStartBoss: (tier: string) => void;
  onStartTour: () => void;
  onBack: () => void;
  onDeckBuilder: () => void;
  /**
   * Casual is the one online mode with a service behind it. The screen does not
   * decide whether that service exists — `onlineAvailable()` does — so the tile
   * falls back to its explainer when it does not.
   */
  onStartCasual: () => void;
}

interface ModeCard {
  id: string;
  name: string;
  blurb: string;
  status: "available" | "online" | "planned";
  /**
   * Where the mode sits in the ranking, and the reason the field exists at all.
   *
   * `hero` is a claim rather than a preference: exactly one mode may hold it,
   * and which one depends on whether this build has a server. Everything else
   * is either a `feature` (the four that get a real tile) or `tail` (a row in
   * the list). Ranking as data rather than as markup order means the hero can
   * be promoted at runtime without a second definition of what a hero looks
   * like.
   */
  tier: "feature" | "tail";
  /** One hue per mode, used on the icon and its watermark and nowhere else. */
  accent: string;
  /**
   * Required for `status: "online"`, and the reason this field exists.
   *
   * `../../docs/design/03-screens-and-navigation.md` §"Presentation rule for
   * online features" asks for three things — "greyed entry + 'Coming online'
   * tag + a one-paragraph honest explainer of the designed feature" — and then
   * names the anti-pattern: "Never: fake queues, placeholder friends,
   * empty-but-live-looking ladders, or **disabled buttons that pretend to be
   * temporarily broken**".
   *
   * Two of the three were missing. Casual and Ranked were bare `disabled`
   * buttons reading "Needs server", which is exactly the last item on that
   * list: it reads as *this is broken right now*, when the truth is that the
   * feature is designed, partly built, and honestly not finished.
   */
  explainer?: string[];
}

const MODES: ModeCard[] = [
  { id: "ai", name: "Practice vs AI", blurb: "Six difficulty tiers, offline, no timer pressure.", status: "available", tier: "feature", accent: "#b56cff" },
  { id: "tutorial", name: "Interactive Tutorial", blurb: "Learn Hype, combat, Currents and Confluences.", status: "available", tier: "feature", accent: "#52c8ff" },
  { id: "tour", name: "The Grand Tour", blurb: "Win with a faction's loaner deck and keep it.", status: "available", tier: "feature", accent: "#ffd166" },
  {
    id: "casual",
    name: "Casual Match",
    blurb: "Unranked matches against other players.",
    status: "online",
    tier: "feature",
    accent: "#ff5fa2",
    explainer: [
      "Casual pairs you with another player for an unranked match: no divisions, no placements, nothing to lose. It widens who it will consider the longer you wait, and after four minutes it offers you a match against the AI instead — an offer, not a swap, and never a bot pretending to be a person.",
      "The match server that runs it is written and tested, but this build has no server configured, so there is nothing to connect to. Rather than show you a queue that spins for ever, this tile says so.",
    ],
  },
  {
    id: "ranked",
    name: "Ranked Ladder",
    blurb: "Seasonal divisions, placements and rewards.",
    status: "online",
    tier: "tail",
    accent: "#ffb43d",
    explainer: [
      "Ranked is a seasonal ladder: ten placement matches to find your division, then climb, with rewards at each tier and a soft reset between seasons.",
      "It needs everything Casual needs plus a rating that survives between matches, which means accounts and a results pipeline. Neither exists yet. Practice vs AI, the Gauntlet and the Doomscroll all measure you against something real in the meantime.",
    ],
  },
  {
    id: "draft",
    name: "The Gauntlet",
    blurb: "Draft a deck pick by pick, then ride it to 12 wins or 3 losses.",
    status: "available",
    tier: "feature",
    accent: "#5fe0a8",
  },
  {
    id: "remix",
    name: "Remix Queue",
    blurb: "This Week's Meta: one global rule, both players, rotating weekly.",
    status: "available",
    tier: "tail",
    accent: "#7fd6ff",
  },
  {
    id: "custom",
    name: "Custom Lobby",
    blurb: "Set the rules yourself. Two players, one device, or against the AI.",
    status: "available",
    tier: "tail",
    accent: "#a49cc2",
  },
  { id: "roguelike", name: "The Doomscroll", blurb: "Branching run: temporary deck, artifacts, health that carries.", status: "available", tier: "feature", accent: "#ff7a5f" },
  { id: "story", name: "Story Chapters", blurb: "Leader campaigns with dialogue and choices.", status: "available", tier: "tail", accent: "#c77dff" },
  { id: "puzzle", name: "Puzzle Battles", blurb: "Find the exact lethal line.", status: "available", tier: "tail", accent: "#8fd6a0" },
  { id: "replays", name: "Replay Theater", blurb: "Watch your recent matches back, step by step.", status: "available", tier: "tail", accent: "#9fb4ff" },
  { id: "lab", name: "The Lab", blurb: "Build any board, play both sides, undo anything.", status: "available", tier: "tail", accent: "#35d0d8" },
  { id: "boss", name: "Weekly Boss", blurb: "One boss a week, three difficulties, one rule twist.", status: "available", tier: "tail", accent: "#ff5f7a" },
];

/** The drawing for a mode, with the fallback stated rather than left to chance. */
function markFor(id: string): IconId {
  return modeIcon(id) ?? "play";
}


export function createPlayScreen(content: ContentIndex, callbacks: PlayCallbacks): Screen {
  const deck = activeDeck();
  const profile = getProfile();

  const root = document.createElement("div");
  root.className = "screen play-screen";
  /*
   * No `.ambient-bg`. That element paints an opaque wash at `z-index: -1` in
   * front of `atmosphere.ts`'s persistent world, which is why this screen had
   * one depth plane and why the room lighting the shell sets for the `play`
   * route never reached a pixel.
   */
  root.innerHTML = `
    <header class="sub-header play-header">
      <button class="btn btn-ghost play-back" id="play-back">
        ${icon("arrow-left")}<span>Lobby</span>
      </button>
      <h1 class="title">Choose a Mode</h1>
      <div class="sub-header-meta play-deck">
        ${
          deck
            ? `${icon("deck")}<span class="t-label">Playing</span><span class="play-deck-name">${deck.name}</span>`
            : `${icon("warning")}<span class="t-label">No deck selected</span>`
        }
      </div>
    </header>

    <main class="play-body">
      <section class="mode-hero-slot" id="mode-hero"></section>
      <section class="mode-features" id="mode-features"></section>
      <section class="mode-tail" id="mode-tail">
        <div class="t-label mode-tail-head">Everything else</div>
        <div class="mode-tail-list" id="mode-tail-list"></div>
      </section>
    </main>

    <div class="difficulty-backdrop" id="boss-panel" hidden>
      <div class="difficulty-panel panel panel-chrome">
        <div class="eyebrow">This week's boss</div>
        <h2 class="title" id="boss-name"></h2>
        <p class="muted" id="boss-twist"></p>
        <div class="difficulty-list" id="boss-tiers"></div>
        <button class="btn btn-ghost" id="boss-cancel">Cancel</button>
      </div>
    </div>

    <div class="difficulty-backdrop" id="difficulty-panel" hidden>
      <div class="difficulty-panel panel panel-chrome">
        <div class="eyebrow">Practice vs AI</div>
        <h2 class="title">Pick an opponent</h2>
        <div class="difficulty-list" id="difficulty-list"></div>
        <button class="btn btn-ghost" id="difficulty-cancel">Cancel</button>
      </div>
    </div>

    <div class="difficulty-backdrop" id="online-panel" hidden>
      <div class="difficulty-panel panel panel-chrome">
        <div class="eyebrow">Coming online</div>
        <h2 class="title" id="online-name"></h2>
        <div id="online-body"></div>
        <button class="btn btn-ghost" id="online-cancel">Close</button>
      </div>
    </div>`;

  const heroSlot = root.querySelector("#mode-hero");
  const featureSlot = root.querySelector("#mode-features");
  const tailSlot = root.querySelector("#mode-tail-list");
  const difficultyPanel = root.querySelector<HTMLElement>("#difficulty-panel");
  const difficultyList = root.querySelector("#difficulty-list");

  // ---- the "coming online" explainer --------------------------------------
  const onlinePanel = root.querySelector<HTMLElement>("#online-panel");
  const onlineName = root.querySelector("#online-name");
  const onlineBody = root.querySelector("#online-body");

  const showOnline = (mode: ModeCard): void => {
    if (!onlinePanel || !onlineName || !onlineBody) return;
    onlineName.textContent = mode.name;
    // textContent per paragraph, not innerHTML: this copy is authored above and
    // is not user input, but a screen that only ever sets text cannot become
    // the one that renders someone's deck name as markup later.
    onlineBody.replaceChildren(
      ...(mode.explainer ?? []).map((paragraph) => {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = paragraph;
        return p;
      })
    );
    onlinePanel.removeAttribute("hidden");
    root.querySelector<HTMLButtonElement>("#online-cancel")?.focus();
  };

  /**
   * Read once. Whether the online modes are reachable is a build-time fact, and
   * asking per tile would invite two tiles disagreeing.
   */
  const onlineReady = onlineAvailable();

  const runInProgress = activeRun();
  const gauntletInProgress = activeGauntlet();
  const tour = tourProgress(content, tourView());

  /**
   * The status line, and the twelve places it is now silent.
   *
   * READY was printed on every playable mode, which made it the most repeated
   * word on the screen and the least informative — a label that is never absent
   * carries no signal, and twelve identical green accents is the exact opposite
   * of §6's "one hero accent per screen". An empty string here means "you can
   * press this", which is what a live tile already says by being lit.
   */
  const statusOf = (mode: ModeCard): string => {
    if (mode.id === "roguelike" && runInProgress) return `Resume — act ${runInProgress.actIndex + 1}`;
    if (mode.id === "draft" && gauntletInProgress) {
      return gauntletInProgress.phase === "draft"
        ? `Resume — pick ${gauntletInProgress.deck.length + 1}`
        : `Resume — ${gauntletInProgress.wins}–${gauntletInProgress.losses}`;
    }
    // the tour is the one mode whose whole point is a count, so it says it
    if (mode.id === "tour") return tour.rewardReady ? "Reward waiting" : `${tour.unlocked} of ${tour.total} unlocked`;
    if (mode.status === "available") return "";
    if (mode.status === "online") {
      // The exact words the design and both tech documents use. "Needs server"
      // was this screen's own invention and read like a fault report rather
      // than a roadmap.
      return mode.id === "casual" && onlineReady ? "" : "Coming online";
    }
    return "In development";
  };

  /**
   * Exactly one hero, chosen by what this build can actually do.
   *
   * Casual takes it when there is a server to reach, because a match against
   * another person is what the screen is for. With no server it would be a hero
   * tile that opens an apology, so Practice takes it instead — the largest thing
   * on the screen is always something you can press.
   */
  const heroId = onlineReady ? "casual" : "ai";

  /**
   * Exactly four features, whoever the hero turned out to be.
   *
   * Six modes are *declared* as feature-worthy and one of them is always
   * promoted, which would leave five for a 2×2 — and a fifth tile in a grid
   * built for four is how the Doomscroll ended up hanging off the bottom of the
   * viewport. The overflow goes to the tail rather than the grid growing,
   * because the point of the tier is that it is short.
   */
  const featureIds = new Set(
    MODES.filter((mode) => mode.tier === "feature" && mode.id !== heroId)
      .slice(0, 4)
      .map((mode) => mode.id)
  );

  const rankOf = (mode: ModeCard): "hero" | "feature" | "tail" =>
    mode.id === heroId ? "hero" : featureIds.has(mode.id) ? "feature" : "tail";

  /**
   * The picture on the hero tile, in order of what is true.
   *
   * The leader of the deck you would actually take into that match is the most
   * specific thing this screen knows, so it wins. With no deck — a brand-new
   * account arriving here before it has built one — the venue is the next most
   * specific: the room is still the room. Both are existing assets;
   * `paintVenue` falls through to `boards/default` and then to an empty canvas,
   * so a missing file is a plain plate rather than a broken one.
   */
  const heroLeader = deck ? content.leaders[deck.leaderCardId] : undefined;
  const heroArt = (): HTMLCanvasElement =>
    heroLeader
      ? paintLeaderPortrait(heroLeader, {
          width: 560,
          aspect: 1.5,
          bias: 0.06,
          scrim: 0.34,
          fadeLeft: 0.46,
          className: "mode-art-canvas",
        })
      : paintVenue("default", {
          width: 560,
          aspect: 1.5,
          dim: 0.3,
          scrim: 0.4,
          fadeLeft: 0.46,
          className: "mode-art-canvas",
        });

  const buildCard = (mode: ModeCard, rank: "hero" | "feature" | "tail"): HTMLButtonElement => {
    const card = document.createElement("button");
    card.className = `mode-card mode-${rank} mode-${mode.status} ${rank === "tail" ? "mat-chip" : "mat-panel"} act`;
    if (mode.status === "online" && !(mode.id === "casual" && onlineReady)) card.classList.add("mode-locked");
    card.type = "button";
    card.style.setProperty("--tile-accent", mode.accent);
    const status = statusOf(mode);
    const mark = markFor(mode.id);

    if (rank === "tail") {
      card.innerHTML = `
        <span class="mode-mark">${icon(mark)}</span>
        <span class="mode-body">
          <span class="mode-name">${mode.name}</span>
          <span class="mode-blurb">${mode.blurb}</span>
        </span>
        ${status ? `<span class="mode-status">${status}</span>` : ""}
        <span class="mode-go">${icon("chevron-right")}</span>`;
      return card;
    }

    /**
     * The hero carries a painting; the four features carry the watermark.
     *
     * The hero used to carry the watermark too, and at hero scale that is a
     * 24px-grid mark drawn at roughly seventeen times its optical size: two
     * circles of different diameters, two disconnected shoulder arcs and one
     * detached crescent hanging in space, with 380px of flat purple above it and
     * 250px below. An icon authored at 1.75px stroke on a 24px grid does not
     * become an illustration by being scaled — the joins that read as joins at
     * 24px read as gaps at 400. The audit asked for "a hero tile with a bleeding
     * art crop" and this is one: the leader you are about to play, or the room
     * you are about to play in, cropped to the tile and faded out across the left
     * where the type stands. No new painting was required for it; both assets
     * were already in `public/assets`.
     */
    if (rank === "hero") {
      card.innerHTML = `
        <span class="mode-wash" aria-hidden="true"></span>
        <span class="mode-art" aria-hidden="true"></span>
        <span class="mode-plate">${icon(mark, { optical: "hero" })}</span>
        <span class="mode-body">
          <span class="mode-name">${mode.name}</span>
          <span class="mode-blurb">${mode.blurb}</span>
        </span>
        ${status ? `<span class="mode-status">${status}</span>` : ""}
        <span class="mode-cta t-label">${icon("play")} Start</span>`;
      const art = card.querySelector(".mode-art");
      if (art) art.appendChild(heroArt());
      return card;
    }

    card.innerHTML = `
      <span class="mode-wash" aria-hidden="true"></span>
      ${icon(mark, { class: "mode-watermark", optical: "display" })}
      <span class="mode-plate">${icon(mark, { optical: "hero" })}</span>
      <span class="mode-body">
        <span class="mode-name">${mode.name}</span>
        <span class="mode-blurb">${mode.blurb}</span>
      </span>
      ${status ? `<span class="mode-status">${status}</span>` : ""}`;
    return card;
  };

  for (const mode of MODES) {
    const rank = rankOf(mode);
    const card = buildCard(mode, rank);

    if (mode.status === "available" && mode.id === "ai") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        if (!deck) {
          callbacks.onDeckBuilder();
          return;
        }
        difficultyPanel?.removeAttribute("hidden");
      });
    } else if (mode.status === "available" && mode.id === "boss") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        if (!deck) {
          callbacks.onDeckBuilder();
          return;
        }
        bossPanel?.removeAttribute("hidden");
      });
    } else if (mode.status === "available" && mode.id === "custom") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartCustom();
      });
    } else if (mode.status === "available" && mode.id === "remix") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartRemix();
      });
    } else if (mode.status === "available" && mode.id === "roguelike") {
      // the run brings its own deck, so there is no constructed deck to check
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartDoomscroll();
      });
    } else if (mode.status === "available" && mode.id === "draft") {
      // the run drafts its own deck from the whole card pool, so there is no
      // constructed deck to check and no collection to be short of
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartGauntlet();
      });
    } else if (mode.status === "available" && mode.id === "story") {
      // a chapter says for itself whether it lends the player a deck, so there
      // is no constructed deck to check on the way in
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartStory();
      });
    } else if (mode.status === "available" && mode.id === "lab") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onOpenLab();
      });
    } else if (mode.status === "available" && mode.id === "replays") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onOpenReplays();
      });
    } else if (mode.status === "available" && mode.id === "puzzle") {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartPuzzles();
      });
    } else if (mode.status === "available" && mode.id === "tour") {
      // the tour lends every deck it plays, so it needs no constructed deck
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartTour();
      });
    } else if (mode.status === "available" && mode.id === "tutorial") {
      // the tutorial brings its own decks, so it needs no deck check
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onStartTutorial();
      });
    } else if (mode.id === "casual" && onlineReady) {
      /**
       * Live, because the server it needs is deployed and answering. The tile
       * keeps its explainer for the build where that is not true: architecture
       * contract §7 forbids an online entry that cannot work, and blanking
       * `serverUrl` in `config.ts` is what turns this back into one.
       */
      card.classList.remove("mode-locked");
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        if (!deck) {
          callbacks.onDeckBuilder();
          return;
        }
        callbacks.onStartCasual();
      });
    } else if (mode.status === "online" && mode.explainer) {
      /**
       * Greyed, but not disabled.
       *
       * A `disabled` button cannot be focused, cannot be reached by keyboard,
       * and announces nothing to a screen reader beyond its own unavailability
       * — so the explainer the design asks for would be unreachable by exactly
       * the players most likely to need it. It stays a real button, styled as
       * unavailable, and says what it will be when you press it.
       */
      card.classList.add("mode-locked");
      card.setAttribute("aria-haspopup", "dialog");
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        showOnline(mode);
      });
    } else {
      card.disabled = true;
    }
    const slot = rank === "hero" ? heroSlot : rank === "feature" ? featureSlot : tailSlot;
    slot?.appendChild(card);
  }

  /**
   * Two cascades rather than one.
   *
   * The hero and the four features are the reading order the eye takes first,
   * so they land inside 300ms; the tail is a list and gets a tighter step so
   * eight rows do not turn into a queue. `transitions.css` already staggers the
   * three sections themselves — this is what happens inside them.
   */
  stagger([...root.querySelectorAll(".mode-hero, .mode-feature")], { step: 55, from: 90 });
  stagger(root.querySelectorAll(".mode-tail-list .mode-card"), { step: 28, from: 210 });

  for (const card of root.querySelectorAll(".mode-card")) {
    card.addEventListener("pointerenter", () => audio.play("sfx.ui.hover"));
  }

  for (const difficulty of AI_DIFFICULTY_ORDER) {
    const button = document.createElement("button");
    button.className = "btn difficulty-option";
    button.innerHTML = `
      <span class="difficulty-name">${AI_DIFFICULTY_LABEL[difficulty as AiDifficulty]}</span>
      <span class="difficulty-blurb muted">${AI_DIFFICULTY_BLURB[difficulty as AiDifficulty]}</span>`;
    button.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onStartAiMatch(difficulty as AiDifficulty);
    });
    difficultyList?.appendChild(button);
  }

  // ---- weekly boss --------------------------------------------------------
  const boss = bossForWeek(Date.now());
  const bossPanel = root.querySelector<HTMLElement>("#boss-panel");
  const bossName = root.querySelector("#boss-name");
  const bossTwist = root.querySelector("#boss-twist");
  if (bossName) bossName.textContent = boss.name;
  if (bossTwist) bossTwist.textContent = `${boss.twistName} — ${boss.twistText}`;

  const bossTiers = root.querySelector("#boss-tiers");
  for (const tier of BOSS_TIERS) {
    const cleared = hasClaimed(clearKey(boss, tier, Date.now()));
    const button = document.createElement("button");
    button.className = "btn difficulty-option";
    button.innerHTML = `
      <span class="difficulty-name">${tier.label}${cleared ? " ✓" : ""}</span>
      <span class="difficulty-blurb muted">${tier.blurb} · ${
        cleared ? "already cleared this week" : `${tier.clout} Clout first clear`
      }</span>`;
    button.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onStartBoss(tier.id);
    });
    bossTiers?.appendChild(button);
  }
  root.querySelector("#boss-cancel")?.addEventListener("click", () => bossPanel?.setAttribute("hidden", ""));
  bossPanel?.addEventListener("click", (event) => {
    if (event.target === bossPanel) bossPanel.setAttribute("hidden", "");
  });

  const closeDifficulty = (): void => difficultyPanel?.setAttribute("hidden", "");
  root.querySelector("#difficulty-cancel")?.addEventListener("click", closeDifficulty);
  // clicking the scrim (but not the panel) dismisses, as modals should
  difficultyPanel?.addEventListener("click", (event) => {
    if (event.target === difficultyPanel) closeDifficulty();
  });
  const closeOnline = (): void => onlinePanel?.setAttribute("hidden", "");
  root.querySelector("#online-cancel")?.addEventListener("click", closeOnline);
  onlinePanel?.addEventListener("click", (event) => {
    if (event.target === onlinePanel) closeOnline();
  });

  root.querySelector("#play-back")?.addEventListener("click", () => callbacks.onBack());

  void profile;
  return { root };
}
