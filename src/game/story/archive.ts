/**
 * The Archive: the ten GLIMMR fragments, and what having all ten unlocks.
 *
 * The design (§3.12, §2.2) gives every chapter epilogue an artifact recovered
 * from GLIMMR and unlocks the lore entry *The First Signal, Annotated* at ten.
 * It is explicit that this is **lore and cosmetics only** — it never gates or
 * accelerates the Doomscroll Act 4 unlock, which stays on the in-run Signal
 * Fragment rule. Nothing in this file returns anything a match can read.
 *
 * A fragment is whatever `POST:` the player's own playthrough ended on, saved at
 * the moment the last episode was cleared. Four chapters put their artifact
 * inside a branch, so which one a save holds is a fact about that save. The file
 * is only consulted as a fallback, for chapters cleared before fragments were
 * recorded — the entry is still theirs, it is just the file's own last word
 * rather than the one they happened to see.
 */

import type { StoryChapter } from "./types";
import { chapterProgress } from "../../save/storySave";
import { chapterComplete } from "./run";
import annotated from "../../../data/story/archive.md?raw";

export interface ArchiveFragment {
  chapterId: string;
  chapterTitle: string;
  /** null until the chapter is finished — the list shows the gap on purpose */
  text: string | null;
}

/** The chapter's own last `POST:`, used when a save has no recorded fragment. */
function lastPostInFile(chapter: StoryChapter): string | null {
  for (let index = chapter.episodes.length - 1; index >= 0; index--) {
    const steps = chapter.episodes[index]!.steps;
    for (let pc = steps.length - 1; pc >= 0; pc--) {
      const step = steps[pc]!;
      if (step.s === "post") return step.text;
    }
  }
  return null;
}

export function chaptersCleared(chapters: readonly StoryChapter[]): number {
  return chapters.filter((chapter) => chapterComplete(chapter, chapterProgress(chapter.id).cleared)).length;
}

/** One row per chapter, in campaign order, with the gaps left visible. */
export function archiveFragments(chapters: readonly StoryChapter[]): ArchiveFragment[] {
  return chapters.map((chapter) => {
    const progress = chapterProgress(chapter.id);
    const done = chapterComplete(chapter, progress.cleared);
    return {
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      text: done ? (progress.fragment ?? lastPostInFile(chapter)) : null,
    };
  });
}

/**
 * The capstone needs every chapter, so it needs there to *be* every chapter —
 * a campaign shipping five would otherwise unlock it at five, which would read
 * as a bug to the only people able to notice.
 */
export const REQUIRED_CHAPTERS = 10;

export function firstSignalUnlocked(chapters: readonly StoryChapter[]): boolean {
  return chapters.length >= REQUIRED_CHAPTERS && chaptersCleared(chapters) >= REQUIRED_CHAPTERS;
}

/** *The First Signal, Annotated*, as markdown. */
export const FIRST_SIGNAL_ANNOTATED: string = annotated;
