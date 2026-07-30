/**
 * Plays one episode.
 *
 * The runner holds a position (`pc`) and a bag of flags, and answers one
 * question: what should the screen be showing right now? Everything that is not
 * shown — remembering a flag, taking a branch, jumping past an option's lines —
 * happens between two answers, in `settle()`.
 *
 * It owns no DOM and no rules. Handing a battle back with `won()` / `lost()` is
 * the only thing it needs the outside world for.
 */

import type { StoryBattle, StoryChapter, StoryEpisode, FlagTest } from "./types";
import type { FlagValue } from "../../save/storySave";

export type StoryMoment =
  | { kind: "line"; speaker: string; mood: string | null; text: string }
  | { kind: "narration"; text: string }
  | { kind: "post"; text: string }
  | { kind: "choice"; prompt: string; options: string[] }
  | { kind: "battle"; battle: StoryBattle; key: string }
  | { kind: "end" };

/**
 * Is a remembered value "no"?
 *
 * The strings matter as much as the booleans. `REMEMBER: manners held is false`
 * is a completely natural thing for a writer to type, and it stores the *word*
 * "false" — which any ordinary truthiness check reads as a set flag, so
 * `IF manners held:` would run the branch that was meant to be excluded and both
 * sides of a choice would play the same lines. It was written that way in the
 * second chapter drafted against this format, which is evidence enough that it
 * is the natural phrasing rather than a mistake.
 */
const MEANS_NO = new Set(["false", "no", "none", "never", "off"]);

const isFalsy = (value: FlagValue | undefined): boolean =>
  value === undefined ||
  value === false ||
  value === 0 ||
  value === "" ||
  (typeof value === "string" && MEANS_NO.has(value.trim().toLowerCase()));

export function flagHolds(test: FlagTest, flags: Readonly<Record<string, FlagValue>>): boolean {
  const value = flags[test.flag];
  switch (test.test) {
    case "isSet":
      return !isFalsy(value);
    case "isNotSet":
      return isFalsy(value);
    case "equals":
      return value !== undefined && String(value).toLowerCase() === test.value;
    case "notEquals":
      return value === undefined || String(value).toLowerCase() !== test.value;
    case "atLeast":
      return Number(value ?? 0) >= test.value;
  }
}

export class StoryRunner {
  private pc = 0;
  private flagState: Record<string, FlagValue>;
  /** every line shown so far, for the dialogue log */
  readonly log: { speaker: string | null; text: string }[] = [];

  constructor(
    readonly chapter: StoryChapter,
    readonly episode: StoryEpisode,
    flags: Readonly<Record<string, FlagValue>> = {},
    startAt = 0
  ) {
    this.flagState = { ...flags };
    this.pc = startAt;
    this.settle();
  }

  get flags(): Readonly<Record<string, FlagValue>> {
    return this.flagState;
  }

  /** Where we are, so a battle handoff can come back to exactly this step. */
  get position(): number {
    return this.pc;
  }

  get finished(): boolean {
    return this.moment().kind === "end";
  }

  /** What the screen should be showing. */
  moment(): StoryMoment {
    const step = this.episode.steps[this.pc];
    if (!step) return { kind: "end" };
    switch (step.s) {
      case "line":
        return { kind: "line", speaker: step.speaker, mood: step.mood, text: step.text };
      case "narration":
        return { kind: "narration", text: step.text };
      case "post":
        return { kind: "post", text: step.text };
      case "choice":
        return { kind: "choice", prompt: step.prompt, options: step.options.map((option) => option.label) };
      case "battle":
        return { kind: "battle", battle: step.battle, key: step.key };
      default:
        return { kind: "end" };
    }
  }

  /**
   * The last `POST:` this playthrough actually showed.
   *
   * Every chapter's epilogue ends on an artifact recovered from GLIMMR, and in
   * four chapters that artifact sits inside a branch — so which one the player
   * got is a fact about their save, not about the file, and the only place that
   * knows it is the runner that walked the branch.
   */
  get lastPost(): string | null {
    return this.lastPostText;
  }
  private lastPostText: string | null = null;

  /** Move past the line currently being shown. */
  advance(): void {
    const moment = this.moment();
    if (moment.kind === "line") this.log.push({ speaker: moment.speaker, text: moment.text });
    else if (moment.kind === "narration" || moment.kind === "post") this.log.push({ speaker: null, text: moment.text });
    if (moment.kind === "post") this.lastPostText = moment.text;
    if (moment.kind === "choice" || moment.kind === "battle" || moment.kind === "end") return;
    this.pc += 1;
    this.settle();
  }

  choose(index: number): void {
    const step = this.episode.steps[this.pc];
    if (!step || step.s !== "choice") return;
    const option = step.options[index];
    if (!option) return;
    this.log.push({ speaker: null, text: `▸ ${option.label}` });
    this.pc = option.to;
    this.settle();
  }

  won(): void {
    const step = this.episode.steps[this.pc];
    if (!step || step.s !== "battle") return;
    this.pc += 1;
    this.settle();
  }

  lost(): void {
    const step = this.episode.steps[this.pc];
    if (!step || step.s !== "battle") return;
    this.pc = step.loseTo;
    this.settle();
  }

  /**
   * Run everything invisible until the next thing worth showing.
   *
   * The guard is a real safeguard, not defensive noise: `IF` blocks and choices
   * compile to jumps, and while the compiler cannot currently emit a cycle,
   * a story that hung with a blank screen would be an awful way to find out it
   * one day could.
   */
  private settle(): void {
    for (let guard = 0; guard < 10_000; guard++) {
      const step = this.episode.steps[this.pc];
      if (!step) return;
      switch (step.s) {
        case "remember": {
          if (step.mode === "add") {
            const current = Number(this.flagState[step.flag] ?? 0);
            this.flagState[step.flag] = current + Number(step.value);
          } else {
            this.flagState[step.flag] = step.value === true ? true : (step.value as FlagValue);
          }
          this.pc += 1;
          break;
        }
        case "jump":
          this.pc = step.to;
          break;
        case "jumpIfNot":
          this.pc = flagHolds(step.test, this.flagState) ? this.pc + 1 : step.to;
          break;
        default:
          return;
      }
    }
    throw new Error(`Story "${this.chapter.title}" got stuck in a loop in episode "${this.episode.title}".`);
  }
}

/**
 * The episodes that make up the chapter proper.
 *
 * A Side Cut is deliberately not one of them. It is extra, it is taken on
 * purpose, and every count the player is shown — progress, "next", complete —
 * is about the chapter they were promised rather than the chapter plus whatever
 * their Episode 3 decision happened to open.
 */
export function requiredEpisodes(chapter: StoryChapter): StoryEpisode[] {
  return chapter.episodes.filter((episode) => !episode.optional);
}

/** Has this side cut's decision been taken? Always true for ordinary episodes. */
export function episodeUnlocked(episode: StoryEpisode, flags: Readonly<Record<string, FlagValue>>): boolean {
  return !episode.optional || flagHolds(episode.optional.test, flags);
}

/** Which episode the player should be offered next, or null when all are done. */
export function nextEpisode(chapter: StoryChapter, cleared: readonly string[]): StoryEpisode | null {
  return requiredEpisodes(chapter).find((episode) => !cleared.includes(episode.id)) ?? null;
}

/** Is this chapter available yet? */
export function chapterUnlocked(chapter: StoryChapter, clearedChapters: ReadonlySet<string>): boolean {
  return !chapter.lockedUntil || clearedChapters.has(chapter.lockedUntil);
}

/** A chapter is complete when every one of its required episodes is. */
export function chapterComplete(chapter: StoryChapter, cleared: readonly string[]): boolean {
  const required = requiredEpisodes(chapter);
  return required.length > 0 && required.every((episode) => cleared.includes(episode.id));
}
