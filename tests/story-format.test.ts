/**
 * The story script format.
 *
 * Two things are being tested and only one of them is "does it parse".
 *
 * The other is the error messages, and they are tested as carefully as the
 * happy path, because the whole point of this format is that somebody who has
 * never opened the project can fix their own mistakes. An error that does not
 * name the line, or that explains the problem in terms of the parser rather than
 * the script, is a bug in the feature.
 */

import { describe, expect, it } from "vitest";
import { parseChapterScript } from "../src/game/story/parse";
import { compileChapter } from "../src/game/story/compile";
import { storyRules } from "../src/game/story/rules";
import {
  StoryRunner,
  chapterComplete,
  episodeUnlocked,
  flagHolds,
  nextEpisode,
  requiredEpisodes,
} from "../src/game/story/run";
import { storyMatchSetup } from "../src/game/story/battle";
import { storyWaveSets } from "../src/game/story/waves";
import { getContent, resolveMatchContent } from "../src/engine/content";
import type { StoryChapter } from "../src/game/story/types";

const content = getContent();
const rules = storyRules();
// the real libraries, so a fixture chapter is compiled exactly as a shipped one is
const waveSets = storyWaveSets();

/** Parse a script, expecting it to be clean, and return the chapter. */
function build(source: string): StoryChapter {
  const { script, problems } = parseChapterScript("test.story.txt", source);
  expect(problems.map((p) => `line ${p.line}: ${p.message}`)).toEqual([]);
  const compiled = compileChapter(script!, content, rules, new Set(), waveSets);
  expect(compiled.problems.map((p) => `line ${p.line}: ${p.message}`)).toEqual([]);
  return compiled.chapter!;
}

/** Every complaint a script produces, parse and compile together. */
function complaints(source: string): { line: number; message: string; hint?: string }[] {
  const { script, problems } = parseChapterScript("test.story.txt", source);
  const compiled = script ? compileChapter(script, content, rules, new Set(), waveSets).problems : [];
  return [...problems, ...compiled].map(({ line, message, hint }) => ({ line, message, ...(hint ? { hint } : {}) }));
}

const HEADER = "TITLE: Test Chapter\n\n=== EPISODE: One\n";

describe("the shape of a script", () => {
  it("reads a chapter with nothing in it but dialogue", () => {
    const chapter = build(`${HEADER}Lumi Starcall: Hello.\nRin Halfstep: Hi.\n`);
    expect(chapter.title).toBe("Test Chapter");
    expect(chapter.episodes).toHaveLength(1);
    expect(chapter.episodes[0]!.steps).toEqual([
      { s: "line", speaker: "Lumi Starcall", mood: null, text: "Hello." },
      { s: "line", speaker: "Rin Halfstep", mood: null, text: "Hi." },
      { s: "end" },
    ]);
  });

  it("ignores blank lines, notes and decorative dividers", () => {
    const chapter = build(`${HEADER}
# a note to myself, which nobody ever sees

Lumi Starcall: Hello.

-------------------

Rin Halfstep: Hi.
`);
    expect(chapter.episodes[0]!.steps.filter((step) => step.s === "line")).toHaveLength(2);
  });

  it("takes a mood in brackets after the name", () => {
    const chapter = build(`${HEADER}Lumi Starcall (strained): Again.\n`);
    expect(chapter.episodes[0]!.steps[0]).toEqual({
      s: "line",
      speaker: "Lumi Starcall",
      mood: "strained",
      text: "Again.",
    });
  });

  it("keeps a colon inside what somebody says", () => {
    const chapter = build(`${HEADER}PPX-9: TRACK NINE: ENCORE.\n`);
    expect(chapter.episodes[0]!.steps[0]).toMatchObject({ speaker: "PPX-9", text: "TRACK NINE: ENCORE." });
  });

  it("gives every episode its own id, even when two share a title", () => {
    const chapter = build("TITLE: T\n\n=== EPISODE: Same\nA: x\n\n=== EPISODE: Same\nB: y\n");
    expect(chapter.episodes.map((episode) => episode.id)).toEqual(["same", "same-2"]);
  });
});

describe("choices", () => {
  const SCRIPT = `${HEADER}Lumi Starcall: Well?

CHOICE: What do you say?
  * Something kind.
      REMEMBER: tone is warm
      Lumi Starcall: Stay.
  * Something else.
      REMEMBER: tone is guarded
      Lumi Starcall: Go.

Rin Halfstep: Okay.
`;

  it("plays only the picked option, then rejoins", () => {
    const chapter = build(SCRIPT);
    const episode = chapter.episodes[0]!;

    const warm = new StoryRunner(chapter, episode);
    warm.advance(); // "Well?"
    expect(warm.moment()).toMatchObject({ kind: "choice", prompt: "What do you say?" });
    warm.choose(0);
    expect(warm.moment()).toMatchObject({ text: "Stay." });
    expect(warm.flags["tone"]).toBe("warm");
    warm.advance();
    expect(warm.moment()).toMatchObject({ text: "Okay." });

    const guarded = new StoryRunner(chapter, episode);
    guarded.advance();
    guarded.choose(1);
    expect(guarded.moment()).toMatchObject({ text: "Go." });
    expect(guarded.flags["tone"]).toBe("guarded");
    guarded.advance();
    expect(guarded.moment()).toMatchObject({ text: "Okay." });
  });

  it("names the line that was meant to be under an option but was not indented", () => {
    const found = complaints(`${HEADER}CHOICE: What do you say?
  * Something kind.
  Lumi Starcall: Stay.
  * Something else.
      Lumi Starcall: Go.
`);
    expect(found).toEqual([
      expect.objectContaining({
        line: 6,
        message: "This line is inside the choice but not under any option.",
      }),
    ]);
  });

  it("refuses a choice whose options all do nothing", () => {
    const found = complaints(`${HEADER}CHOICE: Pick one.
  * A
  * B
`);
    expect(found[0]!.message).toContain("plays out identically whichever the player picks");
  });

  it("refuses a choice with one option", () => {
    expect(complaints(`${HEADER}CHOICE: Pick one.\n  * Only this.\n      A: x\n`)[0]!.message).toContain(
      "nothing to choose"
    );
  });

  it("refuses a choice with no options", () => {
    expect(complaints(`${HEADER}CHOICE: Pick one.\nA: x\n`)[0]!.message).toContain("no options");
  });

  it("tells an option that escaped its choice where it belongs", () => {
    expect(complaints(`${HEADER}A: x\n* An option with no choice above it\n`)[0]!.hint).toContain("CHOICE:");
  });
});

describe("remembering and reacting", () => {
  it("remembers a value, a count and a plain fact", () => {
    const chapter = build(`${HEADER}REMEMBER: tone is warm
REMEMBER: rin trust + 2
REMEMBER: she stayed
IF tone is warm:
  A: one
IF rin trust is at least 2:
  A: two
IF she stayed:
  A: three
`);
    const runner = new StoryRunner(chapter, chapter.episodes[0]!);
    const seen: string[] = [];
    while (!runner.finished) {
      const moment = runner.moment();
      if (moment.kind === "line") seen.push(moment.text);
      runner.advance();
    }
    expect(seen).toEqual(["one", "two", "three"]);
    expect(runner.flags).toEqual({ tone: "warm", "rin trust": 2, "she stayed": true });
  });

  it("runs OTHERWISE when the IF does not hold", () => {
    const chapter = build(`${HEADER}REMEMBER: tone is guarded
IF tone is warm:
  A: warm
OTHERWISE:
  A: not warm
A: after
`);
    const runner = new StoryRunner(chapter, chapter.episodes[0]!);
    const seen: string[] = [];
    while (!runner.finished) {
      const moment = runner.moment();
      if (moment.kind === "line") seen.push(moment.text);
      runner.advance();
    }
    expect(seen).toEqual(["not warm", "after"]);
  });

  /**
   * A decision in one chapter changing lines in another is canon (§3.12), and it
   * needs no new syntax: a flag is a flag wherever it was written. The compiler
   * has to be told what the rest of the campaign writes, or the feature the
   * design asks for gets reported as a typo.
   */
  it("lets a chapter read a flag another chapter wrote", () => {
    const source = `${HEADER}IF you invited vex:\n  A: he turned up\n`;
    const { script } = parseChapterScript("ch3.story.txt", source);

    const alone = compileChapter(script!, content, rules);
    expect(alone.problems[0]!.message).toContain('ever remembers "you invited vex"');

    const withChapterOne = compileChapter(script!, content, rules, new Set(["you invited vex"]));
    expect(withChapterOne.problems).toEqual([]);
  });

  it("still catches a typo against every chapter's flags, not just its own", () => {
    const { script } = parseChapterScript("ch3.story.txt", `${HEADER}IF you invited vexx:\n  A: x\n`);
    const compiled = compileChapter(script!, content, rules, new Set(["you invited vex"]));
    expect(compiled.problems[0]!.hint).toBe('Did you mean "you invited vex"?');
  });

  it("catches a flag that is checked but never remembered", () => {
    const found = complaints(`${HEADER}REMEMBER: tone is warm\nIF toen is warm:\n  A: x\n`);
    expect(found[0]!.message).toContain('ever remembers "toen"');
    expect(found[0]!.hint).toContain('Did you mean "tone"?');
  });

  it("treats flag names as the words they are, spacing and case included", () => {
    const chapter = build(`${HEADER}REMEMBER:   Rin   Trust  + 1\nIF rin trust is at least 1:\n  A: x\n`);
    expect(chapter.flags).toEqual(["rin trust"]);
  });

  it("counts an unset counter as zero rather than failing", () => {
    expect(flagHolds({ test: "atLeast", flag: "nope", value: 1 }, {})).toBe(false);
    expect(flagHolds({ test: "atLeast", flag: "nope", value: 0 }, {})).toBe(true);
  });

  /**
   * "Remember that it did not happen" is a natural thing to write, and it stores
   * the word "false". Read as an ordinary truthy string it would run the branch
   * it was meant to exclude, so both sides of a choice would play the same
   * lines — silently, and only in the branch nobody read back.
   */
  it("treats a remembered no as a no, not as a set flag", () => {
    for (const word of ["false", "no", "none", "never", "off", "FALSE", " No "]) {
      expect(flagHolds({ test: "isSet", flag: "it" }, { it: word }), word).toBe(false);
      expect(flagHolds({ test: "isNotSet", flag: "it" }, { it: word }), word).toBe(true);
    }
    expect(flagHolds({ test: "isSet", flag: "it" }, { it: "warm" })).toBe(true);
  });

  it("runs the other side of an IF when a choice remembered a no", () => {
    const chapter = build(`${HEADER}CHOICE: Pick.
  * Yes.
      REMEMBER: they agreed
  * No.
      REMEMBER: they agreed is false

IF they agreed:
  A: agreed
OTHERWISE:
  A: refused
`);
    const runner = new StoryRunner(chapter, chapter.episodes[0]!);
    runner.choose(1);
    expect(runner.moment()).toMatchObject({ text: "refused" });
  });
});

describe("battles", () => {
  it("resolves people and factions by the names a writer would type", () => {
    const chapter = build(`${HEADER}BATTLE: Vex Klipp
  PLAYS: Cyra Swipe
  YOU PLAY: Lumi Starcall
  DIFFICULTY: beginner
  THEIR HEALTH: 22
  RULE: clip farm
`);
    const step = chapter.episodes[0]!.steps[0]!;
    expect(step.s).toBe("battle");
    if (step.s !== "battle") return;
    expect(step.battle).toMatchObject({
      opponentName: "Vex Klipp",
      opponentLeaderCardId: "viral-leader-cyra-swipe",
      opponentDeckLeaderCardId: "viral-leader-cyra-swipe",
      yourDeck: { kind: "fixed", leaderCardId: "idols-lumi-starcall" },
      difficulty: "beginner",
      theirHealth: 22,
    });
    expect(step.battle.rules.map((rule) => rule.id)).toEqual(["clip-farm"]);
  });

  it("lends a boss somebody else's cards without being asked", () => {
    const chapter = build(`${HEADER}BATTLE: Prisma, the Final Encore\n  DIFFICULTY: boss\n`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(step.battle.opponentLeaderCardId).toBe("boss-prisma-final-encore");
    expect(step.battle.opponentDeckLeaderCardId).toBe("idols-lumi-starcall");
  });

  it("accepts a faction where a person would do", () => {
    const chapter = build(`${HEADER}BATTLE: A rehearsal partner\n  PLAYS: Neon Idols\n`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(content.leaders[step.battle.opponentLeaderCardId]!.faction).toBe("neon-idols");
  });

  it("suggests the closest name when one is misspelled", () => {
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swype\n`);
    expect(found[0]!.hint).toBe('Did you mean "Cyra Swipe"?');
  });

  it("points at the line the mistake is actually on, not the BATTLE line", () => {
    // line 3 is the episode heading, 4 is BATTLE, 5 is PLAYS, 6 is DIFFICULTY
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swype\n  DIFFICULTY: spicy\n`);
    expect(found.map((problem) => problem.line)).toEqual([5, 6]);
  });

  it("suggests the closest rule when one is misspelled", () => {
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n  RULE: clipfarm\n`);
    expect(found[0]!.hint).toBe('Did you mean "Clip Farm"?');
  });

  it("suggests the closest wave set when one is misspelled", () => {
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n  WAVES: the support cue\n`);
    expect(found[0]!.message).toContain("There is no wave set called");
    expect(found[0]!.hint).toBe('Did you mean "The Support Queue"?');
    // the WAVES line itself (4 is BATTLE, 5 is PLAYS), not the head of the block
    expect(found[0]!.line).toBe(6);
  });

  it("refuses a WAVES line that names nothing", () => {
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n  WAVES:\n`);
    expect(found[0]!.message).toContain("doesn't name a wave set");
  });

  /**
   * The whole chain, on a fixture: a name in a script becomes reinforcements in
   * a `MatchConfig`, on the seat the library said, carrying the cards it named.
   * Every link between those two is a silent failure if it breaks.
   */
  it("turns a wave set into reinforcements the match will deal", () => {
    const chapter = build(`${HEADER}BATTLE: X
  PLAYS: Skree Nine-Tabs
  YOU PLAY: Don Sortino
  WAVES: the support queue
`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(step.battle.waves?.name).toBe("The Support Queue");

    const waves = storyMatchSetup(content, step.battle).scenario?.waves ?? [];
    expect(waves).toHaveLength(step.battle.waves!.waves.length);
    // "opponent" is seat 1, and every body is a real character rather than a
    // name that quietly resolved to nothing
    for (const wave of waves) {
      expect(wave.seat).toBe(1);
      for (const character of wave.characters) {
        expect(content.cards[character.cardId]?.type).toBe("character");
      }
    }
  });

  it("lists the difficulties when the one given is not a difficulty", () => {
    const found = complaints(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n  DIFFICULTY: spicy\n`);
    expect(found[0]!.message).toContain("not a difficulty");
  });

  it("takes starting Armor for either side", () => {
    const chapter = build(`${HEADER}BATTLE: X
  PLAYS: Cyra Swipe
  YOUR ARMOR: 10
  THEIR ARMOR: 10
`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(step.battle).toMatchObject({ yourArmor: 10, theirArmor: 10 });
  });

  it("charges what a re-pricing rule says, on the leader the player is actually holding", () => {
    // The failure this guards against is a rule that only *looks* applied: the
    // Obsession track is drawn from balance.json but the price charged comes off
    // the leader card, so bending the balance path would move the marker without
    // moving the cost. Following it all the way to the resolved leader is the
    // only assertion that can tell the two apart.
    const chapter = build(`${HEADER}BATTLE: X
  PLAYS: Prioress Juniper Vale
  YOU PLAY: Coach Rhett Halloran
  RULE: signal dead zone
`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");

    const setup = storyMatchSetup(content, step.battle);
    const resolved = resolveMatchContent(content, setup.balanceOverrides, setup.cardOverrides);
    const before = content.leaders[setup.playerDeck.leaderCardId]!.fixation.obsessionCost;
    expect(resolved.leaders[setup.playerDeck.leaderCardId]!.fixation.obsessionCost).toBe(before + 2);
    // and it reaches one seat: the Order is not the one who lost reception
    const theirs = setup.aiDeck.leaderCardId;
    expect(resolved.leaders[theirs]!.fixation.obsessionCost).toBe(content.leaders[theirs]!.fixation.obsessionCost);
  });

  it("refuses an Armor value that is not a usable amount", () => {
    const found = complaints(`${HEADER}BATTLE: X
  PLAYS: Cyra Swipe
  YOUR ARMOR: loads
`);
    expect(found[0]!.message).toContain("not an amount of Armor");
  });

  it("understands the everyday words for a difficulty", () => {
    const chapter = build(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n  DIFFICULTY: hard\n`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(step.battle.difficulty).toBe("advanced");
  });

  it("says who has no cards of their own, and what to add", () => {
    const found = complaints(`${HEADER}BATTLE: Nova\n  PLAYS: Seraph Online\n`);
    expect(found[0]!.message).toContain("no deck of their own");
    expect(found[0]!.hint).toContain("THEIR CARDS:");
  });

  it("takes THEIR CARDS for someone who has none", () => {
    const chapter = build(`${HEADER}BATTLE: Nova\n  PLAYS: Seraph Online\n  THEIR CARDS: Neon Idols\n`);
    const step = chapter.episodes[0]!.steps[0]!;
    if (step.s !== "battle") throw new Error("expected a battle");
    expect(step.battle.opponentLeaderCardId).toBe("tut-seraph-online");
    expect(step.battle.opponentDeckLeaderCardId).toBe("idols-lumi-starcall");
  });

  it("plays the loss lines and then offers the battle again", () => {
    const chapter = build(`${HEADER}BATTLE: X
  PLAYS: Cyra Swipe
  IF YOU LOSE:
    Lumi Starcall: Again.

Lumi Starcall: We won.
`);
    const runner = new StoryRunner(chapter, chapter.episodes[0]!);
    expect(runner.moment().kind).toBe("battle");

    runner.lost();
    expect(runner.moment()).toMatchObject({ text: "Again." });
    runner.advance();
    expect(runner.moment().kind, "back to the same battle").toBe("battle");

    runner.won();
    expect(runner.moment()).toMatchObject({ text: "We won." });
  });

  it("goes straight back to the battle when there are no loss lines", () => {
    const chapter = build(`${HEADER}BATTLE: X\n  PLAYS: Cyra Swipe\n\nA: won\n`);
    const runner = new StoryRunner(chapter, chapter.episodes[0]!);
    runner.lost();
    expect(runner.moment().kind).toBe("battle");
    runner.won();
    expect(runner.moment()).toMatchObject({ text: "won" });
  });

  it("refuses a battle property that is written outside a battle", () => {
    const found = complaints(`${HEADER}A: x\nDIFFICULTY: hard\n`);
    expect(found[0]!.message).toContain("only means something inside a battle");
  });
});

describe("side cuts", () => {
  const SCRIPT = `TITLE: Test Chapter

=== EPISODE: One
CHOICE: Well?
  * Stay.
      REMEMBER: she stayed
  * Go.
      REMEMBER: she went

=== SIDE CUT: The Long Walk
UNLOCKED BY: she stayed

NARRATION: Forty minutes of pavement.

=== EPISODE: Two
NARRATION: Later.
`;

  it("reads an optional episode and what opens it", () => {
    const chapter = build(SCRIPT);
    expect(chapter.episodes.map((episode) => episode.title)).toEqual(["One", "The Long Walk", "Two"]);
    expect(chapter.episodes[1]!.optional).toEqual({ test: { test: "isSet", flag: "she stayed" }, label: "she stayed" });
    expect(chapter.episodes[0]!.optional).toBeUndefined();
  });

  it("keeps the unlock in the writer's own words, because the player is shown it", () => {
    const chapter = build(
      SCRIPT.replace("REMEMBER: she stayed", "REMEMBER: Rin Trust + 2").replace(
        "UNLOCKED BY: she stayed",
        "UNLOCKED BY: Rin Trust is at least 2"
      )
    );
    expect(chapter.episodes[1]!.optional).toEqual({
      test: { test: "atLeast", flag: "rin trust", value: 2 },
      // capitals and spacing exactly as typed: this string is printed to the player
      label: "Rin Trust is at least 2",
    });
  });

  it("leaves it out of the chapter's own count, in both directions", () => {
    const chapter = build(SCRIPT);
    expect(requiredEpisodes(chapter).map((episode) => episode.title)).toEqual(["One", "Two"]);
    // finishing the two ordinary episodes finishes the chapter
    expect(chapterComplete(chapter, ["one", "two"])).toBe(true);
    // and it is never what the player is told to do next
    expect(nextEpisode(chapter, ["one"])?.title).toBe("Two");
  });

  it("opens only once the decision has been taken", () => {
    const chapter = build(SCRIPT);
    const sideCut = chapter.episodes[1]!;
    expect(episodeUnlocked(sideCut, {})).toBe(false);
    expect(episodeUnlocked(sideCut, { "she went": true })).toBe(false);
    expect(episodeUnlocked(sideCut, { "she stayed": true })).toBe(true);
    // an ordinary episode is always open
    expect(episodeUnlocked(chapter.episodes[0]!, {})).toBe(true);
  });

  it("refuses a side cut that nothing could ever open", () => {
    const found = complaints(`TITLE: T\n\n=== SIDE CUT: The Long Walk\nNARRATION: Hello.\n`);
    expect(found[0]!.message).toContain("does not say what unlocks it");
    expect(found[0]!.hint).toContain("UNLOCKED BY");
  });

  it("suggests the closest memory when the unlock is misspelled", () => {
    const found = complaints(SCRIPT.replace("UNLOCKED BY: she stayed", "UNLOCKED BY: she stayd"));
    expect(found[0]!.message).toContain("could never open");
    expect(found[0]!.hint).toBe('Did you mean "she stayed"?');
  });

  it("says what to do when UNLOCKED BY is put on an ordinary episode", () => {
    const found = complaints(`TITLE: T\n\n=== EPISODE: One\nUNLOCKED BY: she stayed\nNARRATION: Hello.\n`);
    expect(found[0]!.message).toContain('only means something directly under a "=== SIDE CUT:" line');
    expect(found[0]!.hint).toContain("=== SIDE CUT: One");
  });

  it("points at the unlock line, not the heading, when the unlock is the mistake", () => {
    // 1 TITLE, 2 blank, 3 heading, 4 UNLOCKED BY
    const found = complaints(`TITLE: T\n\n=== SIDE CUT: X\nUNLOCKED BY: nobody remembers this\nNARRATION: Hi.\n`);
    expect(found[0]!.line).toBe(4);
  });
});

describe("the complaints a beginner is most likely to see", () => {
  it("says where dialogue has to live", () => {
    const found = complaints("TITLE: T\nLumi Starcall: Too early.\n\n=== EPISODE: One\nA: x\n");
    expect(found[0]!.line).toBe(2);
    expect(found[0]!.hint).toContain("=== EPISODE:");
  });

  it("asks for a title", () => {
    expect(complaints("=== EPISODE: One\nA: x\n")[0]!.message).toBe("This chapter has no title.");
  });

  it("asks for at least one episode", () => {
    expect(complaints("TITLE: T\n")[0]!.message).toContain("no episodes");
  });

  it("cannot tell narration from a speaker, and says so", () => {
    const found = complaints(`${HEADER}The room is empty and nobody has said anything for a while: it shows.\n`);
    expect(found[0]!.hint).toContain("NARRATION:");
  });

  it("points at a line with no colon at all", () => {
    const found = complaints(`${HEADER}Lumi Starcall says hello\n`);
    expect(found[0]!.message).toContain("can't tell what this line is meant to do");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const found = complaints(`${HEADER}BATTLE: X
  PLAYS: Nobody At All
  DIFFICULTY: spicy

IF never remembered:
  A: x
`);
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it("still checks the rest of the file after a bad line inside an option", () => {
    const found = complaints(`${HEADER}CHOICE: Pick.
  * A
      This is not a speaker and it is not narration, it just rambles on: see?
      Lumi Starcall: still mine
  * B
      Lumi Starcall: also fine

BATTLE: X
  PLAYS: Nobody At All
`);
    expect(found).toHaveLength(2);
    expect(found[1]!.message).toContain("Nobody At All");
  });
});
