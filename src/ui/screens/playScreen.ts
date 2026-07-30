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
}

const MODES: ModeCard[] = [
  { id: "ai", name: "Practice vs AI", blurb: "Six difficulty tiers, offline, no timer pressure.", status: "available", icon: "◈" },
  { id: "tutorial", name: "Interactive Tutorial", blurb: "Learn Hype, combat, Currents and Confluences.", status: "available", icon: "◐" },
  { id: "tour", name: "The Grand Tour", blurb: "Win with a faction's loaner deck and keep it.", status: "available", icon: "✦" },
  { id: "casual", name: "Casual Match", blurb: "Unranked matches against other players.", status: "online", icon: "◇" },
  { id: "ranked", name: "Ranked Ladder", blurb: "Seasonal divisions, placements and rewards.", status: "online", icon: "★" },
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
    </div>`;

  const grid = root.querySelector("#mode-grid");
  const difficultyPanel = root.querySelector<HTMLElement>("#difficulty-panel");
  const difficultyList = root.querySelector("#difficulty-list");

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
              ? "Needs server"
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
  root.querySelector("#play-back")?.addEventListener("click", () => callbacks.onBack());

  void profile;
  return { root };
}
