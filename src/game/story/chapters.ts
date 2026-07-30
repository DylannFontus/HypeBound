/**
 * Finds every chapter under `data/story/` and gets it ready to play.
 *
 * Dropping a `.story.txt` file into that folder is the entire act of adding a
 * chapter. Nothing registers it, nothing imports it, and no code changes — the
 * folder is the list, and the file name decides the order.
 *
 * **A broken chapter never breaks the game.** Card data is different: a typo
 * there is a rules error and the app refuses to boot with a report. A story
 * script is prose, it is edited by people who are not programmers, and a
 * half-finished chapter is a completely normal state for one to be in. So a
 * chapter that does not compile becomes a card on the story screen that says
 * what is wrong and on which line, and every other chapter still plays.
 */

import type { ContentIndex } from "../../engine/types";
import type { ScriptNode, StoryChapter, StoryProblem } from "./types";
import { parseChapterScript, slugify } from "./parse";
import { compileChapter } from "./compile";
import { storyRules } from "./rules";
import { storyWaveSets } from "./waves";

export interface BrokenChapter {
  file: string;
  /** the title if we got far enough to read one, else the file name */
  title: string;
  problems: StoryProblem[];
}

export interface StoryLibrary {
  chapters: StoryChapter[];
  broken: BrokenChapter[];
}

const sources = import.meta.glob("../../../data/story/*.story.txt", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

let cache: StoryLibrary | null = null;

export function getStory(content: ContentIndex): StoryLibrary {
  if (cache) return cache;
  cache = buildStory(content, sources);
  return cache;
}

/** Test hook: drop the memoised library so a fixture can be re-read. */
export function resetStory(): void {
  cache = null;
}

/** Exported for tests, which supply their own scripts instead of the folder. */
export function buildStory(content: ContentIndex, files: Record<string, string>): StoryLibrary {
  const rules = storyRules();
  const waveSets = storyWaveSets();
  const chapters: StoryChapter[] = [];
  const broken: BrokenChapter[] = [];

  // file name order, so a writer reorders the campaign by renaming files
  const paths = Object.keys(files).sort((a, b) => (fileName(a) < fileName(b) ? -1 : 1));

  /**
   * Parse everything first, then compile.
   *
   * The two passes exist for one reason: a chapter may read a flag another
   * chapter wrote — Chapter 1 deciding whether Vex Klipp turns up in Chapter 3
   * is canon (§3.12) — so "nothing ever remembers this" cannot be judged until
   * every script has been read. Without the first pass, the very feature the
   * design asks for would be reported as a typo.
   */
  const parsed = paths
    // a starting point to copy is not itself a chapter
    .filter((path) => !/^template/i.test(fileName(path)))
    .map((path) => {
      const file = fileName(path);
      const source = files[path]!;
      return { file, source, ...parseChapterScript(file, source) };
    });

  const everyFlag = new Set<string>();
  for (const entry of parsed) {
    for (const episode of entry.script?.episodes ?? []) collectFlags(episode.nodes, everyFlag);
  }

  for (const entry of parsed) {
    const { file, source, script, problems } = entry;
    if (!script) {
      broken.push({ file, title: file, problems: withSource(problems, source) });
      continue;
    }
    const compiled = compileChapter(script, content, rules, everyFlag, waveSets);
    const all = [...problems, ...compiled.problems];
    if (all.length > 0 || !compiled.chapter) {
      broken.push({ file, title: script.title || file, problems: withSource(all, source) });
      continue;
    }
    chapters.push(compiled.chapter);
  }

  /**
   * Two chapters sharing a title would share an id, and therefore share saved
   * progress — one would silently unlock the other. Ids come from the title
   * rather than the file name on purpose, so that renaming a file to reorder the
   * campaign does not wipe anyone's progress; this is that decision's bill.
   */
  const byId = new Map<string, StoryChapter>();
  for (const chapter of [...chapters]) {
    const clash = byId.get(chapter.id);
    if (clash) {
      const problem: StoryProblem = {
        file: chapter.file,
        line: 1,
        source: "",
        message: `Another chapter is already called "${clash.title}" (in ${clash.file}).`,
        hint: "Two chapters cannot share a title — the game would treat them as the same chapter. Rename one.",
      };
      broken.push({ file: chapter.file, title: chapter.title, problems: [problem] });
      chapters.splice(chapters.indexOf(chapter), 1);
      continue;
    }
    byId.set(chapter.id, chapter);
  }

  for (const chapter of chapters) {
    if (chapter.lockedUntil && !byId.has(chapter.lockedUntil)) {
      const suggestion = [...byId.values()].map((c) => c.title).find((t) => slugify(t) === chapter.lockedUntil);
      broken.push({
        file: chapter.file,
        title: chapter.title,
        problems: [
          {
            file: chapter.file,
            line: 1,
            source: "",
            message: `This chapter is locked until "${chapter.lockedUntil}", but there is no chapter with that title.`,
            hint:
              suggestion ??
              `The chapters that exist are: ${[...byId.values()].map((c) => `"${c.title}"`).join(", ")}.`,
          },
        ],
      });
    }
  }
  const brokenFiles = new Set(broken.map((entry) => entry.file));

  return { chapters: chapters.filter((chapter) => !brokenFiles.has(chapter.file)), broken };
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Every flag a script writes, at any depth. */
function collectFlags(nodes: readonly ScriptNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "remember") into.add(node.flag);
    else if (node.kind === "if") {
      collectFlags(node.then, into);
      collectFlags(node.otherwise, into);
    } else if (node.kind === "choice") for (const option of node.options) collectFlags(option.nodes, into);
    else if (node.kind === "battle") collectFlags(node.onLose, into);
  }
}

/**
 * Quote the offending line in every complaint that does not already carry one.
 *
 * The parser quotes the line it was looking at; the compiler works from the tree
 * and only knows a line number. Filling it in here means a report always shows
 * the text as well as the number — which is the difference between "line 6" and
 * "line 6, the one that says PLAYS: Cyra Swype".
 */
function withSource(problems: readonly StoryProblem[], source: string): StoryProblem[] {
  const lines = source.split(/\r?\n/);
  return problems.map((problem) =>
    problem.source ? problem : { ...problem, source: (lines[problem.line - 1] ?? "").trim() }
  );
}

/** Human-readable report for one broken chapter — the same text everywhere. */
export function formatProblems(problems: readonly StoryProblem[]): string {
  return problems
    .map((problem) => {
      const lines = [`${problem.file}, line ${problem.line}`];
      if (problem.source) lines.push(`    ${problem.source}`);
      lines.push(`  ${problem.message}`);
      if (problem.hint) lines.push(`  → ${problem.hint}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
