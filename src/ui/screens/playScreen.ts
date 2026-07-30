/**
 * Mode select. Modes that need a server are listed honestly as "coming online"
 * rather than stubbed with fake UI (architecture contract §7).
 */

import type { AiDifficulty, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { AI_DIFFICULTY_BLURB, AI_DIFFICULTY_LABEL, AI_DIFFICULTY_ORDER } from "../../ai/profiles";
import { activeDeck, getProfile, tourView } from "../../save/profile";
import { tourProgress } from "../../game/progression/grandTour";
import { audio } from "../../audio/audio";
import { BOSS_TIERS, bossForWeek, clearKey } from "../../game/weeklyBoss";
import { hasClaimed } from "../../save/profile";
import { activeRun } from "../../save/doomscrollSave";
import { activeGauntlet } from "../../save/gauntletSave";

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
}

interface ModeCard {
  id: string;
  name: string;
  blurb: string;
  status: "available" | "online" | "planned";
  icon: string;
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
  { id: "ai", name: "Practice vs AI", blurb: "Six difficulty tiers, offline, no timer pressure.", status: "available", icon: "◈" },
  { id: "tutorial", name: "Interactive Tutorial", blurb: "Learn Hype, combat, Currents and Confluences.", status: "available", icon: "◐" },
  { id: "tour", name: "The Grand Tour", blurb: "Win with a faction's loaner deck and keep it.", status: "available", icon: "✦" },
  {
    id: "casual",
    name: "Casual Match",
    blurb: "Unranked matches against other players.",
    status: "online",
    icon: "◇",
    explainer: [
      "Casual pairs you with another player for an unranked match: no divisions, no placements, nothing to lose. It widens who it will consider the longer you wait, and after four minutes it offers you a match against the AI instead — an offer, not a swap, and never a bot pretending to be a person.",
      "The match server that runs it is written and tested, but it is not deployed anywhere yet, so there is nothing to connect to. Rather than show you a queue that spins for ever, this tile says so.",
    ],
  },
  {
    id: "ranked",
    name: "Ranked Ladder",
    blurb: "Seasonal divisions, placements and rewards.",
    status: "online",
    icon: "★",
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
    icon: "▤",
  },
  {
    id: "remix",
    name: "Remix Queue",
    blurb: "This Week's Meta: one global rule, both players, rotating weekly.",
    status: "available",
    icon: "⟳",
  },
  {
    id: "custom",
    name: "Custom Lobby",
    blurb: "Set the rules yourself. Two players, one device, or against the AI.",
    status: "available",
    icon: "⚙",
  },
  { id: "roguelike", name: "The Doomscroll", blurb: "Branching run: temporary deck, artifacts, health that carries.", status: "available", icon: "⌖" },
  { id: "story", name: "Story Chapters", blurb: "Leader campaigns with dialogue and choices.", status: "available", icon: "❖" },
  { id: "puzzle", name: "Puzzle Battles", blurb: "Find the exact lethal line.", status: "available", icon: "⬡" },
  { id: "replays", name: "Replay Theater", blurb: "Watch your recent matches back, step by step.", status: "available", icon: "▷" },
  { id: "lab", name: "The Lab", blurb: "Build any board, play both sides, undo anything.", status: "available", icon: "⚗" },
  { id: "boss", name: "Weekly Boss", blurb: "One boss a week, three difficulties, one rule twist.", status: "available", icon: "☠" },
];

export function createPlayScreen(content: ContentIndex, callbacks: PlayCallbacks): Screen {
  const deck = activeDeck();
  const profile = getProfile();

  const root = document.createElement("div");
  root.className = "screen play-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="play-back">← Lobby</button>
      <h1 class="title">Choose a Mode</h1>
      <div class="sub-header-meta muted">${deck ? `Playing: ${deck.name}` : "No deck selected"}</div>
    </header>

    <div class="mode-grid scroll" id="mode-grid"></div>

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

  const grid = root.querySelector("#mode-grid");
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

  const runInProgress = activeRun();
  const gauntletInProgress = activeGauntlet();
  const tour = tourProgress(content, tourView());

  for (const mode of MODES) {
    const card = document.createElement("button");
    card.className = `mode-card mode-${mode.status}`;
    card.type = "button";
    const status =
      mode.id === "roguelike" && runInProgress
        ? `Resume — act ${runInProgress.actIndex + 1}`
        : mode.id === "draft" && gauntletInProgress
          ? gauntletInProgress.phase === "draft"
            ? `Resume — pick ${gauntletInProgress.deck.length + 1}`
            : `Resume — ${gauntletInProgress.wins}–${gauntletInProgress.losses}`
        : // the tour is the one mode whose whole point is a count, so it says it
          mode.id === "tour"
          ? tour.rewardReady
            ? "Reward waiting"
            : `${tour.unlocked} of ${tour.total} unlocked`
          : mode.status === "available"
            ? "Ready"
            : mode.status === "online"
              ? // The exact words the design and both tech documents use. "Needs
                // server" was this screen's own invention and read like a fault
                // report rather than a roadmap.
                "Coming online"
              : "In development";
    card.innerHTML = `
      <div class="mode-icon">${mode.icon}</div>
      <div class="mode-body">
        <div class="mode-name">${mode.name}</div>
        <div class="mode-blurb muted">${mode.blurb}</div>
      </div>
      <div class="mode-status">${status}</div>`;

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
    grid?.appendChild(card);
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
