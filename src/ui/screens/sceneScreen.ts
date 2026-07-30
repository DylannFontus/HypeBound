/**
 * Plays an episode: portraits, dialogue, choices, and the handoff to a battle.
 *
 * There is no character art in the project and there may never be, so a portrait
 * is drawn from the character's own name — a stable colour, their initials, and
 * a name plate. Which is to say the game runs at full quality with zero art
 * present, and a writer inventing a character in a line of dialogue gets a
 * portrait for them immediately, without asking anyone for anything.
 *
 * Everything here is presentation. The runner decides what happens next; this
 * decides what it looks like while it does.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { StoryBattle, StoryChapter, StoryEpisode } from "../../game/story/types";
import { StoryRunner } from "../../game/story/run";
import { storyMatchSetup, STORY_ASSIST_HEALTH } from "../../game/story/battle";
import { waveSchedule } from "../../game/story/waves";
import {
  campaignFlags,
  chapterProgress,
  markEpisodeCleared,
  saveChapterProgress,
  setPendingBattle,
  storyLosses,
} from "../../save/storySave";
import { getSettings } from "../../save/settings";
import { audio } from "../../audio/audio";

export interface SceneCallbacks {
  /** leave the episode without finishing it */
  onExit: () => void;
  /** the episode ran to the end */
  onFinished: () => void;
  /** hand off to the battle screen; the runner's position is already saved */
  onBattle: (battle: StoryBattle, assist: boolean) => void;
}

export interface SceneOptions {
  content: ContentIndex;
  chapter: StoryChapter;
  episode: StoryEpisode;
  /** resume position, for coming back from a battle */
  startAt?: number;
  /** the flags to resume with; omitted, the chapter's saved flags are used */
  flags?: Record<string, string | number | boolean>;
  /** how the last battle went, when resuming from one */
  resumeWith?: "won" | "lost";
  callbacks: SceneCallbacks;
}

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

/** A stable hue per character, so the same name is always the same colour. */
function hueOf(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function initialsOf(name: string): string {
  const words = name.split(/[\s\-_]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function createSceneScreen(options: SceneOptions): Screen {
  const { content, chapter, episode, callbacks } = options;
  const progress = chapterProgress(chapter.id);
  /**
   * What the rest of the campaign remembers sits *underneath* this chapter's own
   * flags, so a decision in Chapter 1 can change two lines in Chapter 3 (§3.12)
   * while a chapter that writes the same name still wins for itself.
   */
  const runner = new StoryRunner(
    chapter,
    episode,
    { ...campaignFlags(chapter.id), ...(options.flags ?? progress.flags) },
    options.startAt ?? 0
  );

  if (options.resumeWith === "won") runner.won();
  else if (options.resumeWith === "lost") runner.lost();

  const root = document.createElement("div");
  root.className = "screen scene-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header scene-header">
      <button class="btn btn-ghost" id="scene-exit">← Leave</button>
      <h1 class="title">${escape(episode.title)}</h1>
      <div class="scene-header-right">
        <button class="btn btn-ghost btn-icon" id="scene-log" title="Dialogue log" aria-label="Dialogue log">☰</button>
      </div>
    </header>

    <div class="scene-stage" id="scene-stage">
      <div class="scene-cast" id="scene-cast"></div>
      <div class="scene-box" id="scene-box">
        <div class="scene-speaker" id="scene-speaker"></div>
        <p class="scene-text" id="scene-text"></p>
        <div class="scene-advance muted" id="scene-advance">click, or press Space</div>
      </div>
      <div class="scene-choices" id="scene-choices" hidden></div>
    </div>

    <div class="scene-overlay" id="scene-brief" hidden></div>
    <div class="scene-overlay" id="scene-log-panel" hidden></div>`;

  const castHost = root.querySelector<HTMLElement>("#scene-cast")!;
  const box = root.querySelector<HTMLElement>("#scene-box")!;
  const speakerEl = root.querySelector<HTMLElement>("#scene-speaker")!;
  const textEl = root.querySelector<HTMLElement>("#scene-text")!;
  const advanceHint = root.querySelector<HTMLElement>("#scene-advance")!;
  const choicesEl = root.querySelector<HTMLElement>("#scene-choices")!;
  const briefEl = root.querySelector<HTMLElement>("#scene-brief")!;
  const logEl = root.querySelector<HTMLElement>("#scene-log-panel")!;
  const stage = root.querySelector<HTMLElement>("#scene-stage")!;

  /** name -> the plate showing them, in the order they first spoke */
  const cast = new Map<string, HTMLElement>();
  let typing: ReturnType<typeof setInterval> | null = null;
  let fullText = "";
  let disposed = false;

  const stopTyping = (): void => {
    if (typing !== null) {
      clearInterval(typing);
      typing = null;
    }
  };

  /** Everyone who has spoken stays on stage; the one talking is lit. */
  const showSpeaker = (name: string | null): void => {
    if (name && !cast.has(name)) {
      const plate = document.createElement("div");
      plate.className = "scene-portrait";
      plate.style.setProperty("--portrait-hue", String(hueOf(name)));
      plate.innerHTML = `
        <div class="scene-portrait-art">${escape(initialsOf(name))}</div>
        <div class="scene-portrait-name">${escape(name)}</div>`;
      cast.set(name, plate);
      // three is the most a stage can hold and stay readable
      if (cast.size > 3) {
        const [oldest] = cast.keys();
        cast.get(oldest!)?.remove();
        cast.delete(oldest!);
      }
      castHost.appendChild(plate);
    }
    for (const [who, plate] of cast) plate.classList.toggle("speaking", who === name);
  };

  const typeOut = (text: string): void => {
    stopTyping();
    fullText = text;
    const speed = getSettings().reducedMotion ? 0 : 45; // characters per second
    if (speed === 0) {
      textEl.textContent = text;
      return;
    }
    textEl.textContent = "";
    let shown = 0;
    typing = setInterval(() => {
      shown += 2;
      textEl.textContent = text.slice(0, shown);
      if (shown >= text.length) stopTyping();
    }, 2000 / speed);
  };

  const render = (): void => {
    if (disposed) return;
    const moment = runner.moment();
    choicesEl.hidden = true;
    choicesEl.innerHTML = "";
    box.hidden = false;
    box.classList.remove("scene-box-narration", "scene-box-post", "scene-box-prompt");

    switch (moment.kind) {
      case "line":
        showSpeaker(moment.speaker);
        speakerEl.innerHTML = `${escape(moment.speaker)}${
          moment.mood ? ` <span class="scene-mood muted">(${escape(moment.mood)})</span>` : ""
        }`;
        speakerEl.hidden = false;
        typeOut(moment.text);
        advanceHint.hidden = false;
        break;

      case "narration":
        showSpeaker(null);
        speakerEl.hidden = true;
        box.classList.add("scene-box-narration");
        typeOut(moment.text);
        advanceHint.hidden = false;
        break;

      case "post":
        showSpeaker(null);
        speakerEl.hidden = false;
        speakerEl.innerHTML = `<span class="scene-post-tag">post</span>`;
        box.classList.add("scene-box-post");
        typeOut(moment.text);
        advanceHint.hidden = false;
        break;

      case "choice": {
        stopTyping();
        speakerEl.hidden = true;
        textEl.textContent = moment.prompt;
        advanceHint.hidden = true;
        // the box holds a steady height for dialogue so the text does not jump
        // between lines; a prompt shares the screen with the options, so here it
        // shrinks to what it is actually holding
        box.classList.add("scene-box-prompt");
        choicesEl.hidden = false;
        for (const [index, label] of moment.options.entries()) {
          const button = document.createElement("button");
          button.className = "btn scene-choice";
          button.type = "button";
          button.innerHTML = `<span class="scene-choice-index">${index + 1}</span><span>${escape(label)}</span>`;
          button.setAttribute("aria-label", `Option ${index + 1} of ${moment.options.length}: ${label}`);
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            audio.play("sfx.ui.click");
            runner.choose(index);
            // a decision is written the moment it is made: a crash cannot
            // un-decide something the player decided
            persistFlags();
            render();
          });
          choicesEl.appendChild(button);
        }
        break;
      }

      case "battle":
        stopTyping();
        showBrief(moment.battle, moment.key);
        break;

      case "end":
        stopTyping();
        finish();
        break;
    }
  };

  const persistFlags = (): void => {
    const current = chapterProgress(chapter.id);
    saveChapterProgress(chapter.id, { ...current, flags: { ...current.flags, ...runner.flags } });
  };

  const finish = (): void => {
    markEpisodeCleared(
      chapter.id,
      episode.id,
      { ...chapterProgress(chapter.id).flags, ...runner.flags },
      runner.lastPost
    );
    callbacks.onFinished();
  };

  const step = (): void => {
    const moment = runner.moment();
    if (moment.kind === "choice" || moment.kind === "battle" || moment.kind === "end") return;
    // first press finishes the line, second moves on — the standard contract
    if (typing !== null) {
      stopTyping();
      textEl.textContent = fullText;
      return;
    }
    runner.advance();
    render();
  };

  // ---- the pre-battle brief ------------------------------------------------

  /**
   * Nothing about a battle is a surprise. The brief names the opponent, says
   * where the player's cards are coming from, and prints every special rule in
   * full before a single card is dealt — surprise is a readability failure, not
   * a difficulty setting.
   */
  const showBrief = (battle: StoryBattle, key: string): void => {
    const setup = storyMatchSetup(content, battle);
    const losses = storyLosses(chapter.id, key);
    const assistOffered = losses > 0;

    briefEl.hidden = false;
    briefEl.innerHTML = `
      <div class="panel panel-chrome scene-brief">
        <div class="eyebrow">Battle</div>
        <h2 class="title">${escape(battle.opponentName)}</h2>
        <div class="scene-brief-grid">
          <div><span class="muted">Your deck</span><strong>${escape(setup.deckSource)}</strong></div>
          <div><span class="muted">Difficulty</span><strong>${escape(battle.difficulty)}</strong></div>
          ${battle.theirHealth !== null ? `<div><span class="muted">Their health</span><strong>${battle.theirHealth}</strong></div>` : ""}
          ${battle.goesFirst ? `<div><span class="muted">First turn</span><strong>${battle.goesFirst === "you" ? "you" : "them"}</strong></div>` : ""}
        </div>
        ${
          battle.rules.length > 0
            ? `<div class="scene-brief-rules">${battle.rules
                .map(
                  (rule) =>
                    `<div class="scene-rule"><div class="scene-rule-name">${escape(rule.name)}</div>` +
                    `<div class="muted">${escape(rule.text)}</div>` +
                    `<div class="scene-rule-side">${rule.side === "you" ? "affects you" : "affects them"}</div></div>`
                )
                .join("")}</div>`
            : ""
        }
        ${
          /**
           * The wave schedule, printed in full.
           *
           * A wave encounter is only different from an opponent who keeps drawing
           * if the player can count it down, so the brief lists every wave, what
           * is in it and what brings it — the same promise the rules block makes.
           */
          battle.waves
            ? `<div class="scene-brief-rules"><div class="scene-rule">
                 <div class="scene-rule-name">${escape(battle.waves.name)}</div>
                 <div class="muted">${escape(battle.waves.text)}</div>
                 <ul class="scene-waves">${waveSchedule(battle.waves)
                   .map((line) => `<li>${escape(line)}</li>`)
                   .join("")}</ul>
                 <div class="scene-rule-side">${battle.waves.side === "you" ? "lands on your board" : "lands on their board"}</div>
               </div></div>`
            : ""
        }
        ${
          battle.rules.length === 0 && !battle.waves
            ? `<p class="muted">No special rules — the standard game.</p>`
            : ""
        }
        ${
          assistOffered
            ? `<label class="scene-assist"><input type="checkbox" id="scene-assist-toggle" />
                 <span>Story Assist — start with ${STORY_ASSIST_HEALTH} extra health. Rewards are unchanged.</span></label>`
            : ""
        }
        <div class="scene-brief-actions">
          <button class="btn btn-ghost" id="scene-brief-leave">Not now</button>
          <button class="btn btn-primary" id="scene-brief-start">${losses > 0 ? "Try again" : "Begin"}</button>
        </div>
      </div>`;

    briefEl.querySelector("#scene-brief-leave")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      persistFlags();
      callbacks.onExit();
    });
    briefEl.querySelector("#scene-brief-start")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      const assist = briefEl.querySelector<HTMLInputElement>("#scene-assist-toggle")?.checked ?? false;
      persistFlags();
      setPendingBattle({
        chapterId: chapter.id,
        episodeId: episode.id,
        pc: runner.position,
        flags: { ...runner.flags },
        assist,
      });
      callbacks.onBattle(battle, assist);
    });
  };

  // ---- dialogue log --------------------------------------------------------

  const toggleLog = (): void => {
    if (!logEl.hidden) {
      logEl.hidden = true;
      return;
    }
    logEl.hidden = false;
    logEl.innerHTML = `
      <div class="panel panel-chrome scene-log">
        <div class="eyebrow">Dialogue log</div>
        <div class="scene-log-lines scroll">${
          runner.log.length === 0
            ? `<p class="muted">Nothing yet.</p>`
            : runner.log
                .map(
                  (entry) =>
                    `<p class="scene-log-line">${
                      entry.speaker ? `<strong>${escape(entry.speaker)}</strong> ` : ""
                    }${escape(entry.text)}</p>`
                )
                .join("")
        }</div>
        <button class="btn btn-ghost" id="scene-log-close">Close</button>
      </div>`;
    logEl.querySelector("#scene-log-close")?.addEventListener("click", () => {
      logEl.hidden = true;
    });
  };

  // ---- input ---------------------------------------------------------------

  stage.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".scene-choice")) return;
    step();
  });

  const onKey = (event: KeyboardEvent): void => {
    if (!briefEl.hidden || !logEl.hidden) return;
    const moment = runner.moment();
    if (moment.kind === "choice") {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < moment.options.length) {
        event.preventDefault();
        choicesEl.querySelectorAll<HTMLButtonElement>(".scene-choice")[index]?.click();
      }
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      step();
    }
  };
  window.addEventListener("keydown", onKey);

  root.querySelector("#scene-exit")?.addEventListener("click", () => {
    persistFlags();
    callbacks.onExit();
  });
  root.querySelector("#scene-log")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLog();
  });

  render();

  /**
   * Debug handle, the same shape the Doomscroll uses.
   *
   * The browser verification walks whole chapters through this. It plays one
   * battle for real — opened from the brief, dealt, and returned through the
   * battle screen's own exit route — and settles the rest, because playing six
   * matches to the end would take longer than the game does and would still only
   * ever exercise one path through the choices.
   */
  (window as unknown as { hypeboundStory?: unknown }).hypeboundStory = {
    moment: () => runner.moment(),
    flags: () => ({ ...runner.flags }),
    position: () => runner.position,
    log: () => runner.log,
    /** Automation only: settle the battle the episode is standing on. */
    settleBattle: (won: boolean) => {
      if (runner.moment().kind !== "battle") return;
      briefEl.hidden = true;
      if (won) runner.won();
      else runner.lost();
      persistFlags();
      render();
    },
  };

  return {
    root,
    dispose: () => {
      disposed = true;
      stopTyping();
      window.removeEventListener("keydown", onKey);
      delete (window as unknown as { hypeboundStory?: unknown }).hypeboundStory;
    },
  };
}
