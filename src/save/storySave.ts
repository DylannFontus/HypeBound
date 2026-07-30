/**
 * Story progress: which episodes are cleared, what the chapter remembers about
 * the player's decisions, and the one battle currently being handed off.
 *
 * The handoff is the only subtle part. A story battle leaves the dialogue screen
 * entirely and comes back with a result, so the position in the episode has to
 * survive a screen change and a page reload. It is one integer, because episodes
 * are compiled flat — see `game/story/compile.ts`.
 *
 * Flags are written the moment a choice resolves rather than at the end of the
 * scene: a crash cannot un-decide something the player decided.
 */

import { createStore } from "./storage";

export type FlagValue = string | number | boolean;

export interface ChapterProgress {
  /** what this chapter remembers; keys are the writer's own flag names */
  flags: Record<string, FlagValue>;
  /** episode ids, in the order they were finished */
  cleared: string[];
  /** losses per battle, which is what offers Story Assist */
  losses: Record<string, number>;
  /**
   * The GLIMMR artifact this save came away with.
   *
   * Written by whichever episode last showed a `POST:`, which is the epilogue —
   * so replaying a chapter down the other branch replaces it, on purpose. The
   * Archive is meant to hold the ten fragments *this* player was left with, not
   * every fragment the files contain.
   */
  fragment?: string;
}

export interface PendingBattle {
  chapterId: string;
  episodeId: string;
  /** the step the battle sits on, so a win resumes after it and a loss branches */
  pc: number;
  flags: Record<string, FlagValue>;
  assist: boolean;
}

export interface StoryProgress {
  chapters: Record<string, ChapterProgress>;
  pending: PendingBattle | null;
}

export const storyStore = createStore<StoryProgress>({
  key: "story",
  version: 1,
  defaults: () => ({ chapters: {}, pending: null }),
});

const blank = (): ChapterProgress => ({ flags: {}, cleared: [], losses: {} });

export function chapterProgress(chapterId: string): ChapterProgress {
  return storyStore.get().chapters[chapterId] ?? blank();
}

export function saveChapterProgress(chapterId: string, progress: ChapterProgress): void {
  storyStore.update((draft) => {
    draft.chapters[chapterId] = progress;
  });
}

export function markEpisodeCleared(
  chapterId: string,
  episodeId: string,
  flags: Record<string, FlagValue>,
  /** the last GLIMMR artifact this playthrough was shown, if the episode had one */
  fragment?: string | null
): void {
  const progress = chapterProgress(chapterId);
  const cleared = progress.cleared.includes(episodeId) ? progress.cleared : [...progress.cleared, episodeId];
  saveChapterProgress(chapterId, { ...progress, cleared, flags, ...(fragment ? { fragment } : {}) });
}

export function recordStoryLoss(chapterId: string, battleKey: string): number {
  const progress = chapterProgress(chapterId);
  const losses = (progress.losses[battleKey] ?? 0) + 1;
  saveChapterProgress(chapterId, { ...progress, losses: { ...progress.losses, [battleKey]: losses } });
  return losses;
}

export const storyLosses = (chapterId: string, battleKey: string): number =>
  chapterProgress(chapterId).losses[battleKey] ?? 0;

/**
 * Everything the whole campaign remembers, from every chapter.
 *
 * Chapters keep their own flags — that is what makes "start this chapter over"
 * a clean delete — but they can *read* each other's, so a decision in Chapter 1
 * can change two lines in Chapter 3 (design canon §3.12). A writer needs no new
 * syntax for it: they write `IF you invited vex:` in whichever chapter, and the
 * flag is found wherever it was set.
 *
 * The reading chapter's own flags are layered on top by the caller, so a chapter
 * that writes a name shadows any other chapter using the same one rather than
 * being silently overwritten by it.
 */
export function campaignFlags(exceptChapterId?: string): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  for (const [chapterId, progress] of Object.entries(storyStore.get().chapters)) {
    if (chapterId === exceptChapterId) continue;
    Object.assign(out, progress.flags);
  }
  return out;
}

export const pendingBattle = (): PendingBattle | null => storyStore.get().pending;

export function setPendingBattle(pending: PendingBattle | null): void {
  storyStore.update((draft) => {
    draft.pending = pending;
  });
  // the battle screen navigates immediately after this, and a debounced write
  // that has not landed yet would resume the wrong place after a reload
  storyStore.flush();
}

/**
 * Wipe one chapter back to never-played.
 *
 * Offered on the chapter screen because decisions are permanent per save (design
 * canon: no branch-inventory farming), so "see the other branch" has to mean
 * playing the chapter again from the start.
 */
export function resetChapter(chapterId: string): void {
  storyStore.update((draft) => {
    delete draft.chapters[chapterId];
    if (draft.pending?.chapterId === chapterId) draft.pending = null;
  });
}
