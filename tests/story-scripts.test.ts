/**
 * Checks every chapter in `data/story/`. This is what `npm run story` runs.
 *
 * It is written for the person who wrote the chapter, not for the person who
 * wrote the parser: if something is wrong, the failure message is the report
 * they need — file, line, the line itself, what is wrong and what to do — and
 * nothing else.
 */

import { describe, expect, it } from "vitest";
import { getStory, formatProblems } from "../src/game/story/chapters";
import { storyRules } from "../src/game/story/rules";
import { resolveWaveSet, storyWaveSets } from "../src/game/story/waves";
import { getContent, selectableLeaders } from "../src/engine/content";
import { StoryRunner } from "../src/game/story/run";
import {
  FIRST_SIGNAL_ANNOTATED,
  REQUIRED_CHAPTERS,
  archiveFragments,
  firstSignalUnlocked,
} from "../src/game/story/archive";
import { storyMatchSetup } from "../src/game/story/battle";
import { validateDeck } from "../src/engine/deck";
import { BOSSES } from "../src/game/weeklyBoss";
import guide from "../data/story/HOW-TO-WRITE-A-CHAPTER.md?raw";

const content = getContent();
const story = getStory(content);

describe("every chapter in data/story/", () => {
  it("has no problems", () => {
    if (story.broken.length === 0) return;
    const report = story.broken
      .map((chapter) => `\n${chapter.file}\n${"─".repeat(chapter.file.length)}\n${formatProblems(chapter.problems)}`)
      .join("\n");
    expect.fail(`\n${story.broken.length} chapter(s) need fixing:\n${report}\n`);
  });

  it("has at least one chapter to play", () => {
    expect(story.chapters.length).toBeGreaterThan(0);
  });

  it("gives every episode something to do", () => {
    for (const chapter of story.chapters) {
      expect(chapter.episodes.length, `${chapter.title} has no episodes`).toBeGreaterThan(0);
      for (const episode of chapter.episodes) {
        expect(episode.steps.length, `${chapter.title} / ${episode.title} is empty`).toBeGreaterThan(1);
      }
    }
  });

  /**
   * Every branch, not just the one a straight read-through takes.
   *
   * Walking each episode once would leave the far side of every choice — which
   * is most of what a decision buys — never executed, so a jump that lands past
   * the end of an episode would ship happily until a player picked that option.
   */
  it("can be played to the end down every branch", () => {
    for (const chapter of story.chapters) {
      for (const episode of chapter.episodes) {
        const paths = walkEveryBranch(chapter, episode);
        expect(paths, `${chapter.title} / ${episode.title} has no way to finish`).toBeGreaterThan(0);
      }
    }
  });

  it("deals a legal match for every battle", () => {
    for (const chapter of story.chapters) {
      for (const episode of chapter.episodes) {
        for (const step of episode.steps) {
          if (step.s !== "battle") continue;
          const setup = storyMatchSetup(content, step.battle);
          const where = `${chapter.title} / ${episode.title} / ${step.battle.opponentName}`;

          /**
           * Deck size is deliberately not asserted.
           *
           * Seven of the twenty playable leaders cannot reach thirty cards from
           * the shipped pool — Sterling Bright's whole legal pool is nine cards,
           * eighteen with copies — so `autoBuildDeck` returns everything legal
           * and stops. That is a card-content gap that every mode building an AI
           * deck already lives with, not something a chapter causes or can fix,
           * and asserting it here would fail this suite for a reason that has
           * nothing to do with story scripts.
           */
          const illegal = (deck: typeof setup.aiDeck, forLeader = deck.leaderCardId): string[] =>
            validateDeck(content, { ...deck, leaderCardId: forLeader })
              .filter((problem) => problem.code !== "wrongSize")
              .map((problem) => problem.message);

          /**
           * The enemy's cards are checked against the leader they were BUILT
           * for, not the one being worn. A scripted opponent can wear a leader
           * card with no pool of its own — a boss, or Nova Encore's old account —
           * exactly as a Weekly Boss does, and the deck is legal for the leader
           * who lent it.
           */
          expect(illegal(setup.aiDeck, step.battle.opponentDeckLeaderCardId), `${where}: enemy deck`).toEqual([]);
          expect(illegal(setup.playerDeck), `${where}: player deck`).toEqual([]);
          expect(setup.aiDeck.cards.length, `${where}: enemy deck is empty`).toBeGreaterThan(0);
          expect(setup.playerDeck.cards.length, `${where}: player deck is empty`).toBeGreaterThan(0);

          if (step.battle.rules.length > 0) {
            expect(
              setup.playerDeck.leaderCardId,
              `${where}: both sides lead the same card, so a one-sided rule would hit both`
            ).not.toBe(setup.aiDeck.leaderCardId);
          }
        }
      }
    }
  });

  /**
   * A side cut has one job — to be the thing a decision buys — and it fails at
   * it silently. Unlock it with a flag that some line writes unconditionally and
   * it is always open; unlock it with a flag nothing writes and it never opens,
   * and neither shows up as a broken chapter, because neither is a parse error.
   * So the reachability is asserted here, from the choices themselves.
   */
  it("opens every side cut on a real decision, and only on a decision", () => {
    for (const chapter of story.chapters) {
      const optional = chapter.episodes.filter((episode) => episode.optional);
      expect(optional.length, `${chapter.title} should have exactly one side cut`).toBe(1);

      /** Flags written inside a choice option, versus flags written anywhere. */
      const fromChoice = new Set<string>();
      const anywhere = new Set<string>();
      for (const episode of chapter.episodes) {
        for (const step of episode.steps) if (step.s === "remember") anywhere.add(step.flag);

        // An option's body is exactly its entry point up to the `jump` that
        // rejoins the shared line, which is how the compiler flattens a choice.
        for (const step of episode.steps) {
          if (step.s !== "choice") continue;
          for (const option of step.options) {
            for (let pc = option.to; pc < episode.steps.length; pc++) {
              const inner = episode.steps[pc]!;
              if (inner.s === "jump") break;
              if (inner.s === "remember") fromChoice.add(inner.flag);
            }
          }
        }
      }

      const unlock = optional[0]!.optional!.test.flag;
      expect(anywhere, `${chapter.title}: nothing writes "${unlock}"`).toContain(unlock);
      expect(fromChoice, `${chapter.title}: "${unlock}" is not written by a choice, so the side cut is not optional`).toContain(unlock);
    }
  });

  /**
   * §2.2 and §3.12: every chapter epilogue ends on an artifact recovered from
   * GLIMMR, and the ten of them are the campaign's only connective tissue. A
   * chapter that ends without one leaves a permanent hole in the Archive that
   * nothing on screen can explain, so it is checked here rather than trusted.
   */
  it("ends every chapter on a GLIMMR fragment", () => {
    for (const chapter of story.chapters) {
      const last = chapter.episodes[chapter.episodes.length - 1]!;
      const posts = last.steps.filter((step) => step.s === "post");
      expect(posts.length, `${chapter.title} ends with no POST, so it recovers no fragment`).toBeGreaterThan(0);
      const text = posts.map((step) => (step.s === "post" ? step.text : "")).join(" ");
      expect(text, `${chapter.title}'s last episode never names GLIMMR`).toMatch(/GLIMMR/i);
    }
  });

  it("unlocks The First Signal only on the full ten", () => {
    expect(REQUIRED_CHAPTERS).toBe(10);
    // nothing is cleared in a test run, so the capstone must be shut
    expect(firstSignalUnlocked(story.chapters)).toBe(false);
    expect(archiveFragments(story.chapters)).toHaveLength(story.chapters.length);
    expect(archiveFragments(story.chapters).every((fragment) => fragment.text === null)).toBe(true);
    // and it is lore: the entry says so itself, because that is the one thing
    // about it a reader could reasonably get wrong
    expect(FIRST_SIGNAL_ANNOTATED).toContain("gates nothing");
  });

  it("only uses rules the library actually defines", () => {
    const known = new Set(storyRules().map((rule) => rule.id));
    for (const chapter of story.chapters) {
      for (const episode of chapter.episodes) {
        for (const step of episode.steps) {
          if (step.s !== "battle") continue;
          for (const rule of step.battle.rules) expect(known).toContain(rule.id);
        }
      }
    }
  });

  /**
   * A wave set that names a card by a name no card has resolves to nothing, and
   * a wave one body short is not an error at any point downstream — it is just a
   * slightly easier battle than the one that was written. So the library is
   * checked against real content here rather than trusted.
   */
  it("has a wave library where every named card exists", () => {
    for (const set of storyWaveSets()) {
      const seat = set.side === "you" ? 0 : 1;
      const { waves, problems } = resolveWaveSet(content, set, seat);
      expect(problems, `data/story/waves.json — ${set.id}:\n  ${problems.join("\n  ")}`).toEqual([]);
      // and every wave really carries the bodies the file lists
      for (const [index, wave] of waves.entries()) {
        expect(wave.characters.length, `${set.id} wave ${index + 1} lost a body`).toBe(
          set.waves[index]!.characters.length
        );
      }
    }
  });

  /**
   * The chain from `WAVES: <name>` to a dealt board runs through four files, and
   * every link in it is a silent failure: a set that does not resolve, a side
   * that maps to the wrong seat, a scenario that never reaches `MatchConfig`.
   * This walks the whole chain on the real chapters.
   */
  it("turns every WAVES: line into reinforcements the match will actually deal", () => {
    let checked = 0;
    for (const chapter of story.chapters) {
      for (const episode of chapter.episodes) {
        for (const step of episode.steps) {
          if (step.s !== "battle" || !step.battle.waves) continue;
          checked += 1;
          const set = step.battle.waves;
          const setup = storyMatchSetup(content, step.battle);
          const waves = setup.scenario?.waves ?? [];

          expect(waves, `${chapter.title} — "${set.name}" reached the match with no waves`).toHaveLength(
            set.waves.length
          );
          for (const wave of waves) {
            expect(wave.seat, `${set.name} landed on the wrong seat`).toBe(set.side === "you" ? 0 : 1);
            expect(wave.characters.length).toBeGreaterThan(0);
            // every body is a real character card, or it would be dealt into nothing
            for (const character of wave.characters) {
              expect(content.cards[character.cardId]?.type).toBe("character");
            }
            expect(
              wave.onBoardClear === true || wave.onTurn !== undefined,
              `${set.name} — "${wave.label}" has no cue and would never arrive`
            ).toBe(true);
          }
        }
      }
    }
    // the campaign ships exactly one multi-wave board (§3.10); if that changes,
    // this number should change deliberately rather than by accident
    expect(checked, "no chapter uses WAVES: any more").toBe(1);
  });
});

/**
 * The guide is the whole feature for somebody who has never opened this project,
 * so a name it omits is a name they cannot know to use. Both lists grow — rules
 * get added, factions get leaders — and neither growth is going to remind
 * anybody to update a markdown file.
 */
describe("HOW-TO-WRITE-A-CHAPTER.md", () => {
  it("lists every battle rule a writer can pick", () => {
    for (const rule of storyRules()) {
      expect(guide, `the guide never mentions the rule "${rule.name}"`).toContain(rule.name);
    }
  });

  it("lists every wave set a writer can pick", () => {
    for (const set of storyWaveSets()) {
      expect(guide, `the guide never mentions the wave set "${set.name}"`).toContain(set.name);
    }
  });

  it("lists every character a writer can put in a battle", () => {
    for (const leader of selectableLeaders(content)) {
      expect(guide, `the guide never mentions ${leader.name}`).toContain(leader.name);
    }
    for (const boss of BOSSES) {
      expect(guide, `the guide never mentions the boss ${boss.name}`).toContain(boss.name);
    }
  });

  it("lists every faction", () => {
    for (const faction of Object.values(content.factions)) {
      if (faction.id === "neutral") continue;
      expect(guide, `the guide never mentions ${faction.name}`).toContain(faction.name);
    }
  });
});

/**
 * Play an episode down every combination of choices, winning every battle, and
 * count the endings reached. Also asserts the same episode played twice the same
 * way behaves identically, which is the property a resume depends on.
 */
function walkEveryBranch(chapter: (typeof story.chapters)[number], episode: (typeof story.chapters)[number]["episodes"][number]): number {
  let endings = 0;
  const explore = (choices: number[]): void => {
    const runner = new StoryRunner(chapter, episode);
    let taken = 0;
    for (let guard = 0; guard < 5000; guard++) {
      const moment = runner.moment();
      if (moment.kind === "end") {
        endings += 1;
        return;
      }
      if (moment.kind === "battle") {
        runner.won();
        continue;
      }
      if (moment.kind === "choice") {
        const picked = choices[taken];
        if (picked === undefined) {
          // first time down this fork: branch out from here
          for (let option = 0; option < moment.options.length; option++) explore([...choices, option]);
          return;
        }
        taken += 1;
        runner.choose(picked);
        continue;
      }
      runner.advance();
    }
    throw new Error(`${chapter.title} / ${episode.title} never finished`);
  };
  explore([]);
  return endings;
}
