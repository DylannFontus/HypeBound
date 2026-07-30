/**
 * Story chapters: the shapes a `.story.txt` script turns into.
 *
 * There are three of them and the order matters:
 *
 *   text  --parse-->  ChapterScript  --compile-->  StoryChapter
 *
 * `ChapterScript` is the writer's file as a tree: exactly what they typed, with
 * a line number on every node so any complaint can point at the line that caused
 * it. Nothing in it has been checked against the card data yet.
 *
 * `StoryChapter` is what the game runs: every deck, difficulty and battle rule
 * resolved to a real id, and each episode flattened into a numbered list of
 * steps. Flattening is what makes resume trivial — the runner's whole position
 * is one integer, so handing off to the battle screen and coming back needs no
 * reconstruction of where we were in a tree.
 *
 * Nothing here knows any game rules. A story hands the ordinary battle screen an
 * ordinary match; the only thing it can bend is a named rule from
 * `data/story/rules.json`, and those are plain `EffectDef`s validated by the
 * same schema as every card in the game.
 */

import type { AiDifficulty, EffectDef, FactionId } from "../../engine/types";

// ---------------------------------------------------------------------------
// What the writer typed
// ---------------------------------------------------------------------------

/** A complaint about a script, phrased for whoever wrote it. */
export interface StoryProblem {
  /** file name as the author knows it, e.g. "01-encore-please.story.txt" */
  file: string;
  /** 1-based, so it matches the editor's gutter */
  line: number;
  /** the offending line, verbatim, for the report */
  source: string;
  /** what is wrong, in a sentence, without jargon */
  message: string;
  /** what to do about it */
  hint?: string;
}

export class StoryError extends Error {
  constructor(readonly problems: StoryProblem[]) {
    super(problems.map((p) => `${p.file}:${p.line} ${p.message}`).join("\n"));
    this.name = "StoryError";
  }
}

export type FlagTest =
  | { test: "isSet"; flag: string }
  | { test: "isNotSet"; flag: string }
  | { test: "equals"; flag: string; value: string }
  | { test: "notEquals"; flag: string; value: string }
  | { test: "atLeast"; flag: string; value: number };

/** `REMEMBER: tone is warm` / `REMEMBER: rin trust + 1` / `REMEMBER: she stayed` */
export interface RememberNode {
  kind: "remember";
  flag: string;
  /** "set" writes the value; "add" adds to a counter that starts at 0 */
  mode: "set" | "add";
  value: string | number | true;
  line: number;
}

export interface ScriptBattle {
  /** what the pre-battle brief calls them */
  opponentName: string;
  /** as typed — a leader name, a leader id, or a faction name */
  plays: string | null;
  /** whose cards they bring, when the character they play as has no deck of their own */
  theirCards: string | null;
  /** as typed; null means "the deck the player actually owns" */
  youPlay: string | null;
  difficulty: string | null;
  yourHealth: number | null;
  theirHealth: number | null;
  yourArmor: number | null;
  theirArmor: number | null;
  goesFirst: "you" | "them" | null;
  /** rule names as typed, resolved against the rule library at compile time */
  rules: { name: string; line: number }[];
  /** a wave-set name as typed, resolved against the wave library at compile time */
  waves: { name: string; line: number } | null;
  /** the `BATTLE:` line itself */
  line: number;
  /**
   * The line each property was typed on.
   *
   * A complaint about a misspelt opponent has to point at the line with the
   * misspelling on it, not at the head of the block it happens to sit in — a
   * writer told "line 5" about a mistake on line 6 will read line 5 and find
   * nothing wrong with it.
   */
  lines: { plays?: number; theirCards?: number; youPlay?: number; difficulty?: number };
}

export type ScriptNode =
  | { kind: "line"; speaker: string; mood: string | null; text: string; line: number }
  | { kind: "narration"; text: string; line: number }
  | { kind: "post"; text: string; line: number }
  | RememberNode
  | { kind: "if"; test: FlagTest; then: ScriptNode[]; otherwise: ScriptNode[]; line: number }
  | { kind: "choice"; prompt: string; options: ScriptOption[]; line: number }
  | { kind: "battle"; battle: ScriptBattle; onLose: ScriptNode[]; line: number };

export interface ScriptOption {
  label: string;
  nodes: ScriptNode[];
  line: number;
}

export interface ScriptEpisode {
  title: string;
  nodes: ScriptNode[];
  line: number;
  /**
   * `=== SIDE CUT:` plus its `UNLOCKED BY:`, or null for an ordinary episode.
   *
   * `raw` is the writer's own words, kept verbatim because the episode list
   * prints them back to the player as the unlock condition — the design asks for
   * a Side Cut to be visible and greyed rather than hidden, and a locked door
   * with no sign on it is worse than no door.
   */
  sideCut: { test: FlagTest; raw: string; line: number } | null;
}

export interface ChapterScript {
  /** derived from the file name, so two chapters can share a title */
  id: string;
  file: string;
  title: string;
  /** as typed; resolved to a real faction at compile time */
  faction: string | null;
  about: string;
  /** as typed: the title of a chapter that must be finished first */
  lockedUntil: string | null;
  episodes: ScriptEpisode[];
  /** header line numbers, for pointing at the right line in a complaint */
  lines: { title: number; faction: number; lockedUntil: number };
}

// ---------------------------------------------------------------------------
// What the game runs
// ---------------------------------------------------------------------------

/**
 * A named battle rule from `data/story/rules.json`.
 *
 * The library exists so a writer can bend a battle without touching the effect
 * DSL: they type `RULE: clip farm` and get the mechanics plus the printed text,
 * both authored once by somebody who does know the DSL. `effects` is injected
 * into one seat's leader passive bundle — the identical mechanism behind boss
 * twists and Doomscroll artifacts, so a story rule is not a special case of
 * anything.
 */
export interface StoryRule {
  id: string;
  name: string;
  /** printed verbatim in the pre-battle brief — the player is never surprised */
  text: string;
  side: "you" | "opponent";
  effects: EffectDef[];
  /**
   * Change what that seat's leader abilities cost, as a delta on the printed
   * Obsession price.
   *
   * This is deliberately not a `balanceOverrides` entry. `balance.obsession`
   * holds the numbers the leader cards were *authored* against; at run time the
   * cost actually charged is the one printed on the leader card, so bending the
   * balance path would move the marker on the Obsession track without moving the
   * price — a rule that lies to the player. Patching the leader card is the only
   * way to make the two agree, and it has the further property of reaching one
   * seat rather than both.
   */
  fixationCost?: number;
  ultimateCost?: number;
  /**
   * Dotted paths into `balance.json`, for a rule that bends a number rather than
   * adding an ability. One rulebook is shared by both seats, so anything set
   * here is true for both of them — which is why the rule's `text` has to say so.
   */
  balanceOverrides?: Record<string, number>;
}

/**
 * A named sequence of boards from `data/story/waves.json`, picked with `WAVES:`.
 *
 * A rule bends how a battle is played; a wave set changes what is standing on
 * the table, on a schedule the player is shown before the first card is dealt.
 * Both are libraries for the same reason: the writer gets the mechanics and the
 * sentence the player reads, and never opens `data/cards/`.
 */
export interface StoryWaveSet {
  id: string;
  name: string;
  /** printed verbatim in the pre-battle brief, above the schedule */
  text: string;
  side: "you" | "opponent";
  waves: StoryWave[];
}

export interface StoryWave {
  /** what the player is told is arriving, e.g. "12:00 — band two" */
  label: string;
  /** arrives once that side has no characters left */
  onBoardClear?: boolean;
  /** …or on that side's nth turn. Both set means whichever comes first. */
  onTurn?: number;
  /** card NAMES, as printed — the library is a cast list, not a program */
  characters: (string | StoryWaveCharacter)[];
}

/** The long form, for the rare wave body that is not the printed card. */
export interface StoryWaveCharacter {
  card: string;
  attack?: number;
  health?: number;
  maxHealth?: number;
  ready?: boolean;
}

export interface StoryBattle {
  opponentName: string;
  /** the leader card the opponent fights as (may be a boss leader) */
  opponentLeaderCardId: string;
  /** the leader whose card pool builds their deck — differs for boss leaders */
  opponentDeckLeaderCardId: string;
  yourDeck: { kind: "own" } | { kind: "fixed"; leaderCardId: string; name: string };
  difficulty: AiDifficulty;
  yourHealth: number | null;
  theirHealth: number | null;
  /**
   * Starting Armor. Separate from health because it is: Armor absorbs damage
   * point-for-point and is not healed, so "both leaders begin with Armor 10"
   * (the design's diner rule) makes a long, low, survivable fight in a way that
   * simply raising health does not.
   */
  yourArmor: number | null;
  theirArmor: number | null;
  goesFirst: "you" | "them" | null;
  rules: StoryRule[];
  /**
   * Reinforcements that arrive during the battle, resolved from the wave library.
   *
   * Kept as the library set rather than as engine waves so the brief can print
   * the schedule the writer picked — the seat the waves land on is decided in
   * `battle.ts`, where the two decks are finally known.
   */
  waves: StoryWaveSet | null;
}

/**
 * One instruction of a compiled episode.
 *
 * Control flow is jumps into the same array, which is why the runner's position
 * is a single number: a story that is halfway through an episode, three levels
 * deep in a branch, waiting on a battle to come back, is still just `pc: 41`.
 */
export type StoryStep =
  | { s: "line"; speaker: string; mood: string | null; text: string }
  | { s: "narration"; text: string }
  | { s: "post"; text: string }
  | { s: "remember"; flag: string; mode: "set" | "add"; value: string | number | true }
  | { s: "jumpIfNot"; test: FlagTest; to: number }
  | { s: "jump"; to: number }
  | { s: "choice"; prompt: string; options: { label: string; to: number }[] }
  /** on a win the runner continues at pc+1; on a loss it jumps to `loseTo` */
  | { s: "battle"; battle: StoryBattle; loseTo: number; key: string }
  | { s: "end" };

export interface StoryEpisode {
  id: string;
  title: string;
  steps: StoryStep[];
  /** how many battles the episode contains — shown on the episode list */
  battles: number;
  /**
   * Set on a Side Cut: an optional episode that appears only once a decision has
   * unlocked it, and that never counts towards finishing the chapter.
   *
   * Optional is load-bearing in both directions. A player who unlocked it must
   * not be nagged to play it, and a player who took the other option at the
   * branch must still be able to reach 100% — which is why `chapterComplete`
   * ignores these and `nextEpisode` never proposes one.
   */
  optional?: { test: FlagTest; label: string };
}

export interface StoryChapter {
  id: string;
  file: string;
  title: string;
  faction: FactionId | null;
  about: string;
  /** chapter id that must be cleared first, already resolved */
  lockedUntil: string | null;
  episodes: StoryEpisode[];
  /** every flag the chapter writes, for the "your version of this chapter" recap */
  flags: string[];
}
