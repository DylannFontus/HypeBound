/**
 * The story hub: the list of chapters, and one chapter's episodes.
 *
 * The screen's least obvious job is the important one. A chapter that does not
 * compile is shown here, in place, as a card carrying its own error report —
 * file, line, the line itself, what is wrong and what to do. That is the whole
 * feedback loop for somebody who has never opened this project: write, save,
 * look, fix. Nothing else in the game is affected by a broken script.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { StoryChapter } from "../../game/story/types";
import { getStory, formatProblems } from "../../game/story/chapters";
import { chapterComplete, chapterUnlocked, episodeUnlocked, nextEpisode, requiredEpisodes } from "../../game/story/run";
import {
  FIRST_SIGNAL_ANNOTATED,
  REQUIRED_CHAPTERS,
  archiveFragments,
  firstSignalUnlocked,
} from "../../game/story/archive";
import { chapterProgress, resetChapter, storyStore } from "../../save/storySave";
import { audio } from "../../audio/audio";

export interface StoryCallbacks {
  onBack: () => void;
  onPlayEpisode: (chapterId: string, episodeId: string) => void;
}

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

export function createStoryScreen(
  content: ContentIndex,
  chapterId: string | null,
  callbacks: StoryCallbacks
): Screen {
  const story = getStory(content);
  const cleared = new Set(
    story.chapters.filter((chapter) => chapterComplete(chapter, chapterProgress(chapter.id).cleared)).map((c) => c.id)
  );
  const chapter = chapterId ? story.chapters.find((entry) => entry.id === chapterId) : null;

  const root = document.createElement("div");
  root.className = "screen story-screen";

  if (chapter) renderChapter(root, content, chapter, callbacks);
  else renderList(root, content, story, cleared, callbacks);

  return { root };
}

// ---------------------------------------------------------------------------
// Chapter list
// ---------------------------------------------------------------------------

function renderList(
  root: HTMLElement,
  content: ContentIndex,
  story: ReturnType<typeof getStory>,
  cleared: ReadonlySet<string>,
  callbacks: StoryCallbacks
): void {
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="story-back">← Modes</button>
      <h1 class="title">Story Chapters</h1>
      <div class="sub-header-meta muted">${story.chapters.length} chapter${story.chapters.length === 1 ? "" : "s"}</div>
    </header>
    <div class="story-list scroll" id="story-list"></div>`;

  const list = root.querySelector("#story-list");
  root.querySelector("#story-back")?.addEventListener("click", () => callbacks.onBack());

  for (const chapter of story.chapters) {
    const progress = chapterProgress(chapter.id);
    const unlocked = chapterUnlocked(chapter, cleared);
    const done = chapterComplete(chapter, progress.cleared);
    const colour = chapter.faction ? `var(--faction-${chapter.faction})` : "var(--accent)";
    const lockedBy = story.chapters.find((entry) => entry.id === chapter.lockedUntil)?.title ?? chapter.lockedUntil;

    const card = document.createElement("button");
    card.className = `story-card${unlocked ? "" : " story-locked"}`;
    card.type = "button";
    card.disabled = !unlocked;
    card.style.setProperty("--chapter-colour", colour);
    card.innerHTML = `
      <div class="story-card-bar"></div>
      <div class="story-card-body">
        <div class="eyebrow">${chapter.faction ? escape(content.factions[chapter.faction]?.name ?? "") : "Story"}</div>
        <div class="story-card-title">${escape(chapter.title)}</div>
        <p class="muted story-card-about">${escape(chapter.about)}</p>
      </div>
      <div class="story-card-meta">
        <div class="story-progress">${
          requiredEpisodes(chapter).filter((episode) => progress.cleared.includes(episode.id)).length
        } / ${requiredEpisodes(chapter).length}</div>
        <div class="mode-status">${
          !unlocked ? `Locked — finish “${escape(lockedBy ?? "")}”` : done ? "Complete" : progress.cleared.length ? "Continue" : "Start"
        }</div>
      </div>`;
    if (unlocked) {
      card.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        window.location.hash = `#story?ch=${encodeURIComponent(chapter.id)}`;
      });
    }
    list?.appendChild(card);
  }

  for (const bad of story.broken) {
    const card = document.createElement("div");
    card.className = "story-card story-broken";
    card.innerHTML = `
      <div class="story-card-bar"></div>
      <div class="story-card-body">
        <div class="eyebrow">This chapter needs fixing</div>
        <div class="story-card-title">${escape(bad.title)}</div>
        <pre class="story-problems scroll">${escape(formatProblems(bad.problems))}</pre>
        <p class="muted story-card-about">Fix the file and save — this page reloads on its own. Every other chapter still plays.</p>
      </div>`;
    list?.appendChild(card);
  }

  if (story.chapters.length === 0 && story.broken.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted story-empty";
    empty.textContent =
      "There are no chapters yet. Copy data/story/TEMPLATE.story.txt, write one, and it appears here.";
    list?.appendChild(empty);
  }

  if (story.chapters.length > 0) renderArchive(list, story.chapters);
}

/**
 * The Archive: ten fragments of a picture of a platform that stopped, told by
 * ten people who did not.
 *
 * The gaps are drawn rather than hidden. A list of ten slots with four filled is
 * the whole idea — the campaign's connective tissue is that these ten uploads
 * exist and were made by people who never met, and you cannot feel that from
 * four rows and no sense of what is missing.
 */
function renderArchive(list: Element | null, chapters: readonly StoryChapter[]): void {
  const fragments = archiveFragments(chapters);
  const found = fragments.filter((fragment) => fragment.text).length;
  const unlocked = firstSignalUnlocked(chapters);

  const panel = document.createElement("section");
  panel.className = "panel panel-tight story-archive";
  panel.innerHTML = `
    <div class="eyebrow">The Archive · GLIMMR</div>
    <h2 class="story-archive-title">${found} of ${fragments.length} fragments recovered</h2>
    <p class="muted story-archive-note">Every chapter ends on one file somebody uploaded before the platform went offline.</p>
    <ol class="story-archive-list">
      ${fragments
        .map(
          (fragment) => `
        <li class="${fragment.text ? "" : "story-archive-missing"}">
          <span class="story-archive-chapter">${escape(fragment.chapterTitle)}</span>
          <span class="story-archive-text">${
            fragment.text ? escape(fragment.text) : "Not recovered — finish the chapter."
          }</span>
        </li>`
        )
        .join("")}
    </ol>
    ${
      unlocked
        ? `<details class="story-archive-capstone" open>
             <summary>The First Signal, Annotated</summary>
             <pre class="story-archive-entry scroll">${escape(FIRST_SIGNAL_ANNOTATED)}</pre>
           </details>`
        : `<p class="muted story-archive-locked">All ${REQUIRED_CHAPTERS} fragments unlock one more entry.</p>`
    }`;
  list?.appendChild(panel);
}

// ---------------------------------------------------------------------------
// One chapter's episodes
// ---------------------------------------------------------------------------

function renderChapter(
  root: HTMLElement,
  content: ContentIndex,
  chapter: StoryChapter,
  callbacks: StoryCallbacks
): void {
  const draw = (): void => {
    const progress = chapterProgress(chapter.id);
    const next = nextEpisode(chapter, progress.cleared);
    const colour = chapter.faction ? `var(--faction-${chapter.faction})` : "var(--accent)";

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="sub-header">
        <button class="btn btn-ghost" id="story-back">← Chapters</button>
        <h1 class="title">${escape(chapter.title)}</h1>
        <div class="sub-header-meta muted">${
          requiredEpisodes(chapter).filter((episode) => progress.cleared.includes(episode.id)).length
        } of ${requiredEpisodes(chapter).length} played</div>
      </header>
      <div class="story-chapter scroll">
        <p class="story-chapter-about">${escape(chapter.about)}</p>
        <div class="episode-list" id="episode-list"></div>
        <div class="story-recap panel panel-tight" id="story-recap" hidden></div>
        <div class="story-chapter-actions">
          <button class="btn btn-ghost" id="story-reset">Start this chapter over</button>
        </div>
      </div>`;
    root.style.setProperty("--chapter-colour", colour);

    const list = root.querySelector("#episode-list");
    let number = 0;
    for (const episode of chapter.episodes) {
      const done = progress.cleared.includes(episode.id);
      /**
       * A side cut is offered the moment its decision has been taken, rather
       * than waiting its turn in the running order — it is a detour, and the
       * chapter proper never queues behind it.
       */
      const open = episodeUnlocked(episode, progress.flags);
      const isNext = next?.id === episode.id;
      const playable = done || (episode.optional ? open : isNext);
      if (!episode.optional) number++;

      const row = document.createElement("button");
      row.className = `episode-row${done ? " episode-done" : ""}${isNext ? " episode-next" : ""}${
        episode.optional ? " episode-side-cut" : ""
      }`;
      row.type = "button";
      row.disabled = !playable;
      row.innerHTML = `
        <div class="episode-number">${episode.optional ? "◇" : number}</div>
        <div class="episode-body">
          <div class="episode-title">${escape(episode.title)}</div>
          <div class="muted episode-meta">${
            episode.optional && !open
              ? `Side cut — opens if you ${escape(episode.optional.label)}`
              : [
                  episode.optional ? "Side cut — optional" : "",
                  episode.battles === 0 ? "Dialogue only" : `${episode.battles} battle${episode.battles === 1 ? "" : "s"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }</div>
        </div>
        <div class="mode-status">${
          done ? "Replay" : episode.optional ? (open ? "Play" : "Not this time") : isNext ? "Play" : "Locked"
        }</div>`;
      if (playable) {
        row.addEventListener("click", () => {
          audio.play("sfx.ui.click");
          callbacks.onPlayEpisode(chapter.id, episode.id);
        });
      }
      list?.appendChild(row);
    }

    /**
     * "Your version of this chapter" — every decision the save is holding,
     * printed in the writer's own words. Decisions are permanent per save, so
     * this is the only place they are visible after the scene that made them.
     */
    const recap = root.querySelector<HTMLElement>("#story-recap");
    const remembered = Object.entries(progress.flags);
    if (recap && remembered.length > 0) {
      recap.hidden = false;
      recap.innerHTML =
        `<div class="eyebrow">Your version of this chapter</div>` +
        remembered
          .map(([flag, value]) => {
            const shown = value === true ? "yes" : String(value);
            return `<div class="story-flag"><span>${escape(flag)}</span><span class="muted">${escape(shown)}</span></div>`;
          })
          .join("");
    }

    root.querySelector("#story-back")?.addEventListener("click", () => {
      window.location.hash = "#story";
    });
    root.querySelector("#story-reset")?.addEventListener("click", () => {
      const button = root.querySelector<HTMLButtonElement>("#story-reset");
      if (button?.dataset["armed"] !== "1") {
        // decisions are permanent per save, so this really does throw them away
        if (button) {
          button.dataset["armed"] = "1";
          button.textContent = "Really start over? Every decision is forgotten.";
          button.classList.add("btn-danger");
        }
        return;
      }
      audio.play("sfx.ui.click");
      resetChapter(chapter.id);
      draw();
    });
  };

  draw();
  void content;
  void storyStore;
}
