/**
 * Turns a parsed chapter script into something the game can run.
 *
 * Two jobs, and both of them exist to protect the writer.
 *
 * **Resolving names.** A script says `PLAYS: Cyra Swipe` or `PLAYS: Neon Idols`,
 * never `viral-leader-cyra-swipe`. Everything a writer types is matched against
 * display names first and ids second, and a name that matches nothing is
 * reported with the closest name that would have worked. A writer should never
 * have to open `data/cards/` to find out what to type.
 *
 * **Flattening.** Each episode becomes a numbered list of steps with jumps, so
 * the runner's entire position is one integer. That is what makes handing off to
 * the battle screen and coming back cheap: there is no tree to walk back into,
 * no stack to serialise, and no way for a resume to land somewhere that a tree
 * walk would have reached differently.
 */

import type { AiDifficulty, ContentIndex, FactionId, LeaderCardDef, Seat } from "../../engine/types";
import type {
  ChapterScript,
  ScriptBattle,
  ScriptNode,
  StoryBattle,
  StoryChapter,
  StoryEpisode,
  StoryProblem,
  StoryRule,
  StoryStep,
  StoryWaveSet,
} from "./types";
import { closestMatch, normalize, slugify } from "./parse";
import { resolveWaveSet } from "./waves";
import { selectableLeaders } from "../../engine/content";
import { BOSSES } from "../weeklyBoss";

const DIFFICULTIES: AiDifficulty[] = ["beginner", "casual", "intermediate", "advanced", "expert", "boss"];

/** Words a writer is likely to reach for, mapped to the profile that fits. */
const DIFFICULTY_ALIASES: Record<string, AiDifficulty> = {
  easy: "beginner",
  simple: "beginner",
  normal: "casual",
  medium: "intermediate",
  hard: "advanced",
  "very hard": "expert",
  nightmare: "expert",
  brutal: "expert",
  impossible: "boss",
};

export interface CompileResult {
  chapter: StoryChapter | null;
  problems: StoryProblem[];
}

export function compileChapter(
  script: ChapterScript,
  content: ContentIndex,
  rules: readonly StoryRule[],
  /**
   * Flags written by OTHER chapters. A chapter may read them — a decision in
   * Chapter 1 changing two lines in Chapter 3 is canon (§3.12) — so they count
   * as written for the "nothing ever remembers this" check. Empty when a chapter
   * is compiled on its own, which is what tests do.
   */
  knownFlags: ReadonlySet<string> = new Set(),
  /**
   * The wave library, passed in for the same reason `rules` is: this file
   * resolves names against whatever it is handed, so a test can hand it a
   * fixture. Defaulting to none means a chapter that names a wave set in a test
   * that did not supply one is told the set does not exist, rather than
   * compiling into a battle with no waves in it.
   */
  waveSets: readonly StoryWaveSet[] = []
): CompileResult {
  const problems: StoryProblem[] = [];
  const complain = (line: number, message: string, hint?: string): void => {
    problems.push({ file: script.file, line, source: "", message, ...(hint ? { hint } : {}) });
  };

  // -- lookup tables --------------------------------------------------------

  const playable = selectableLeaders(content);
  /**
   * Names, with the playable leader winning any tie.
   *
   * "DJ Last Call" is both an Afterparty Crew leader and a Weekly Boss, and a
   * writer typing that name means the person far more often than the boss. The
   * boss is still reachable by its card id, which is what the doc says to use.
   */
  const leaderByName = new Map<string, LeaderCardDef>();
  for (const leader of [...Object.values(content.leaders)].sort((a, b) => Number(a.token ?? false) - Number(b.token ?? false))) {
    const full = normalize(leader.name);
    if (!leaderByName.has(full)) leaderByName.set(full, leader);
    // "Prisma, the Final Encore" is also findable as "Prisma"
    const short = normalize(leader.name.split(/[,—–]/)[0] ?? "");
    if (short && !leaderByName.has(short)) leaderByName.set(short, leader);
  }
  const factionByName = new Map<string, FactionId>();
  for (const faction of Object.values(content.factions)) {
    factionByName.set(normalize(faction.name), faction.id);
    factionByName.set(normalize(faction.id), faction.id);
  }
  const bossDeckSource = new Map(BOSSES.map((boss) => [boss.leaderCardId, boss.deckLeaderCardId]));
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const ruleByName = new Map(rules.map((rule) => [normalize(rule.name), rule]));
  const waveSetById = new Map(waveSets.map((set) => [set.id, set]));
  const waveSetByName = new Map(waveSets.map((set) => [normalize(set.name), set]));

  const everyName = [
    ...playable.map((leader) => leader.name),
    ...Object.values(content.factions).map((faction) => faction.name),
  ];

  // -- chapter faction ------------------------------------------------------

  let faction: FactionId | null = null;
  if (script.faction) {
    faction = factionByName.get(normalize(script.faction)) ?? null;
    if (!faction) {
      const suggestion = closestMatch(script.faction, Object.values(content.factions).map((f) => f.name));
      complain(
        script.lines.faction,
        `There is no faction called "${script.faction}".`,
        suggestion
          ? `Did you mean "${suggestion}"?`
          : `The factions are: ${Object.values(content.factions).map((f) => f.name).join(", ")}.`
      );
    }
  }

  // -- flags: nothing may be read that is never written ---------------------

  const written = new Set<string>();
  const walkForFlags = (nodes: ScriptNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "remember") written.add(node.flag);
      else if (node.kind === "if") {
        walkForFlags(node.then);
        walkForFlags(node.otherwise);
      } else if (node.kind === "choice") for (const option of node.options) walkForFlags(option.nodes);
      else if (node.kind === "battle") walkForFlags(node.onLose);
    }
  };
  for (const episode of script.episodes) walkForFlags(episode.nodes);

  /** Anything this chapter writes, plus anything another chapter wrote. */
  const readable = new Set([...written, ...knownFlags]);

  const checkFlagReads = (nodes: ScriptNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "if") {
        if (!readable.has(node.test.flag)) {
          const suggestion = closestMatch(node.test.flag, [...readable]);
          complain(
            node.line,
            `Nothing in the story ever remembers "${node.test.flag}", so this is never true.`,
            suggestion
              ? `Did you mean "${suggestion}"?`
              : 'A flag only exists once some line writes it, like "REMEMBER: ' + node.test.flag + '".'
          );
        }
        checkFlagReads(node.then);
        checkFlagReads(node.otherwise);
      } else if (node.kind === "choice") for (const option of node.options) checkFlagReads(option.nodes);
      else if (node.kind === "battle") checkFlagReads(node.onLose);
    }
  };
  for (const episode of script.episodes) checkFlagReads(episode.nodes);

  /**
   * A side cut's unlock is a flag read like any other, and gets the same
   * treatment — including the "did you mean" — because a typo here fails
   * silently in the worst possible way: the episode simply never appears, and
   * nothing on screen says why.
   */
  for (const episode of script.episodes) {
    const unlock = episode.sideCut;
    if (unlock && !readable.has(unlock.test.flag)) {
      const suggestion = closestMatch(unlock.test.flag, [...readable]);
      complain(
        unlock.line,
        `Nothing in the story ever remembers "${unlock.test.flag}", so this side cut could never open.`,
        suggestion
          ? `Did you mean "${suggestion}"?`
          : "A side cut opens on something a decision wrote down. Add the matching " +
            `"REMEMBER: ${unlock.test.flag}" to the option that should unlock it.`
      );
    }
  }

  // -- battles --------------------------------------------------------------

  /** A leader, from a leader name, a leader id, or a faction name. */
  const resolveLeader = (typed: string, line: number, what: string): LeaderCardDef | null => {
    const key = normalize(typed);
    const byId = content.leaders[typed.trim()];
    if (byId) return byId;
    const byName = leaderByName.get(key);
    if (byName) return byName;

    const factionId = factionByName.get(key);
    if (factionId) {
      const first = playable.find((leader) => leader.faction === factionId);
      if (first) return first;
      complain(line, `Nobody from ${typed} can be fought — that faction has no playable leader.`);
      return null;
    }

    const suggestion = closestMatch(typed, everyName);
    complain(
      line,
      `${what} "${typed}", but there is no character or faction with that name.`,
      suggestion
        ? `Did you mean "${suggestion}"?`
        : "You can name a character (like \"Lumi Starcall\") or a whole faction (like \"Neon Idols\")."
    );
    return null;
  };

  /**
   * Everything about a battle is checked even after something in it has already
   * failed, and only then is it rejected. Stopping at the first problem would
   * mean a battle with a misspelt opponent AND a misspelt rule takes two runs to
   * fix, and the second complaint would arrive as a surprise after the first was
   * dealt with.
   */
  const compileBattle = (raw: ScriptBattle): StoryBattle | null => {
    let usable = true;

    // "BATTLE: Prisma, the Final Encore" on its own is enough — the opponent's
    // name is a perfectly good answer to "who are they playing as?"
    const playsTyped = raw.plays ?? raw.opponentName;
    const opponent = resolveLeader(
      playsTyped,
      raw.lines.plays ?? raw.line,
      raw.plays ? "This battle says they play as" : "This battle is against"
    );
    if (!opponent) usable = false;

    /**
     * Boss leaders have no card pool of their own — their cards are somebody
     * else's. Rather than making the writer know that, the deck source is
     * derived: a playable leader brings their own deck, and anyone else borrows
     * from the boss table, or failing that from their faction.
     */
    let deckSource = opponent?.id ?? "";
    if (raw.theirCards) {
      const source = resolveLeader(raw.theirCards, raw.lines.theirCards ?? raw.line, "This battle says their cards come from");
      if (!source) usable = false;
      else if (!playable.some((leader) => leader.id === source.id)) {
        complain(
          raw.lines.theirCards ?? raw.line,
          `${source.name} has no cards of their own to lend.`,
          'Name a playable leader or a faction, like "THEIR CARDS: Neon Idols".'
        );
        usable = false;
      } else {
        deckSource = source.id;
      }
    } else if (opponent && !playable.some((leader) => leader.id === opponent.id)) {
      const borrowed = bossDeckSource.get(opponent.id) ?? playable.find((l) => l.faction === opponent.faction)?.id;
      if (!borrowed) {
        complain(
          raw.line,
          `${opponent.name} has no deck of their own to bring.`,
          `Add a line saying whose cards they use, like "THEIR CARDS: Neon Idols".`
        );
        usable = false;
      } else {
        deckSource = borrowed;
      }
    }

    let yourDeck: StoryBattle["yourDeck"] = { kind: "own" };
    if (raw.youPlay) {
      const typed = normalize(raw.youPlay);
      const meansYours =
        typed === "your own" ||
        typed === "your own deck" ||
        typed === "yours" ||
        typed === "mine" ||
        typed === "my deck" ||
        typed === "the player's deck" ||
        typed === "player";
      if (!meansYours) {
        const loaner = resolveLeader(raw.youPlay, raw.lines.youPlay ?? raw.line, "This battle says you play as");
        if (!loaner) usable = false;
        else if (!playable.some((leader) => leader.id === loaner.id)) {
          complain(
            raw.lines.youPlay ?? raw.line,
            `${loaner.name} cannot be handed to the player — they are not a playable leader.`,
            'Name a playable leader, or write "YOU PLAY: your own deck".'
          );
          usable = false;
        } else {
          yourDeck = { kind: "fixed", leaderCardId: loaner.id, name: loaner.name };
        }
      }
    }

    let difficulty: AiDifficulty = "casual";
    if (raw.difficulty) {
      const typed = normalize(raw.difficulty);
      const resolved = DIFFICULTIES.includes(typed as AiDifficulty)
        ? (typed as AiDifficulty)
        : DIFFICULTY_ALIASES[typed];
      if (!resolved) {
        const suggestion = closestMatch(typed, [...DIFFICULTIES, ...Object.keys(DIFFICULTY_ALIASES)]);
        complain(
          raw.lines.difficulty ?? raw.line,
          `"${raw.difficulty}" is not a difficulty.`,
          suggestion ? `Did you mean "${suggestion}"?` : `The difficulties are: ${DIFFICULTIES.join(", ")}.`
        );
      } else {
        difficulty = resolved;
      }
    }

    const resolvedRules: StoryRule[] = [];
    for (const named of raw.rules) {
      const key = normalize(named.name);
      const rule = ruleById.get(key.replace(/\s+/g, "-")) ?? ruleByName.get(key) ?? ruleById.get(named.name.trim());
      if (!rule) {
        const suggestion = closestMatch(named.name, rules.map((r) => r.name));
        complain(
          named.line,
          `There is no battle rule called "${named.name}".`,
          suggestion
            ? `Did you mean "${suggestion}"?`
            : `The rules you can use are: ${rules.map((r) => r.name).join(", ")}.`
        );
        continue;
      }
      if (resolvedRules.some((existing) => existing.id === rule.id)) {
        complain(named.line, `This battle already uses the rule "${rule.name}".`, "Delete the second one.");
        continue;
      }
      resolvedRules.push(rule);
    }

    /**
     * Waves.
     *
     * Resolved here rather than at battle time so the writer hears about a
     * misspelled card on the line they typed it near, at the same moment as
     * every other complaint about the chapter. A wave that resolves to nothing
     * arrives one body short with nothing on screen to say why, which is exactly
     * the class of mistake this format exists to refuse.
     */
    let resolvedWaves: StoryWaveSet | null = null;
    if (raw.waves) {
      const key = normalize(raw.waves.name);
      const set =
        waveSetById.get(key.replace(/\s+/g, "-")) ?? waveSetByName.get(key) ?? waveSetById.get(raw.waves.name.trim());
      if (!set) {
        const suggestion = closestMatch(raw.waves.name, waveSets.map((s) => s.name));
        complain(
          raw.waves.line,
          `There is no wave set called "${raw.waves.name}".`,
          suggestion
            ? `Did you mean "${suggestion}"?`
            : waveSets.length > 0
              ? `The wave sets you can use are: ${waveSets.map((s) => s.name).join(", ")}.`
              : "See the wave list in HOW-TO-WRITE-A-CHAPTER.md."
        );
        usable = false;
      } else {
        const seat: Seat = set.side === "you" ? 0 : 1;
        for (const problem of resolveWaveSet(content, set, seat).problems) {
          complain(raw.waves.line, `The wave set "${set.name}" is broken: ${problem}`, "Fix data/story/waves.json.");
          usable = false;
        }
        resolvedWaves = set;
      }
    }

    /**
     * A rule is attached by patching a leader CARD, so a battle where both seats
     * lead the same card cannot have a one-sided rule: the patch would land on
     * both. It is a narrow case — a mirror match with a rule — but it would show
     * up as the player mysteriously suffering the opponent's handicap, so refuse
     * it here where the cause is still visible.
     */
    const yourLeaderId = yourDeck.kind === "fixed" ? yourDeck.leaderCardId : null;
    if (opponent && yourLeaderId === opponent.id && resolvedRules.length > 0) {
      complain(
        raw.line,
        `Both sides play ${opponent.name}, so a battle rule would apply to both of them.`,
        "Give one side a different leader, or drop the RULE lines."
      );
      usable = false;
    }

    if (!usable || !opponent) return null;

    return {
      opponentName: raw.opponentName,
      opponentLeaderCardId: opponent.id,
      opponentDeckLeaderCardId: deckSource,
      yourDeck,
      difficulty,
      yourHealth: raw.yourHealth,
      theirHealth: raw.theirHealth,
      yourArmor: raw.yourArmor,
      theirArmor: raw.theirArmor,
      goesFirst: raw.goesFirst,
      rules: resolvedRules,
      waves: resolvedWaves,
    };
  };

  // -- flattening -----------------------------------------------------------

  const episodes: StoryEpisode[] = [];
  const usedEpisodeIds = new Set<string>();

  for (const [index, episode] of script.episodes.entries()) {
    const steps: StoryStep[] = [];
    let battles = 0;

    let id = slugify(episode.title);
    if (usedEpisodeIds.has(id)) id = `${id}-${index + 1}`;
    usedEpisodeIds.add(id);

    const emit = (nodes: ScriptNode[]): void => {
      for (const node of nodes) {
        switch (node.kind) {
          case "line":
            steps.push({ s: "line", speaker: node.speaker, mood: node.mood, text: node.text });
            break;
          case "narration":
            steps.push({ s: "narration", text: node.text });
            break;
          case "post":
            steps.push({ s: "post", text: node.text });
            break;
          case "remember":
            steps.push({ s: "remember", flag: node.flag, mode: node.mode, value: node.value });
            break;
          case "if": {
            const branch = steps.length;
            steps.push({ s: "jump", to: 0 }); // placeholder, patched below
            emit(node.then);
            if (node.otherwise.length > 0) {
              const skip = steps.length;
              steps.push({ s: "jump", to: 0 });
              steps[branch] = { s: "jumpIfNot", test: node.test, to: steps.length };
              emit(node.otherwise);
              steps[skip] = { s: "jump", to: steps.length };
            } else {
              steps[branch] = { s: "jumpIfNot", test: node.test, to: steps.length };
            }
            break;
          }
          case "choice": {
            const at = steps.length;
            steps.push({ s: "jump", to: 0 }); // placeholder
            const targets: number[] = [];
            const exits: number[] = [];
            for (const option of node.options) {
              targets.push(steps.length);
              emit(option.nodes);
              exits.push(steps.length);
              steps.push({ s: "jump", to: 0 });
            }
            const after = steps.length;
            for (const exit of exits) steps[exit] = { s: "jump", to: after };
            steps[at] = {
              s: "choice",
              prompt: node.prompt,
              options: node.options.map((option, n) => ({ label: option.label, to: targets[n]! })),
            };
            break;
          }
          case "battle": {
            const battle = compileBattle(node.battle);
            if (!battle) break;
            const at = steps.length;
            battles += 1;
            const key = `${script.id}:${id}:${battles}`;
            if (node.onLose.length === 0) {
              // no lines to play on a loss: straight back to the brief
              steps.push({ s: "battle", battle, loseTo: at, key });
              break;
            }
            steps.push({ s: "battle", battle, loseTo: 0, key }); // patched below
            const skip = steps.length;
            steps.push({ s: "jump", to: 0 });
            const lose = steps.length;
            emit(node.onLose);
            steps.push({ s: "jump", to: at }); // and try again
            steps[skip] = { s: "jump", to: steps.length };
            steps[at] = { s: "battle", battle, loseTo: lose, key };
            break;
          }
        }
      }
    };

    emit(episode.nodes);
    steps.push({ s: "end" });

    /**
     * Only when the writer really did leave it empty. An episode whose only
     * content failed to compile is already being complained about on the line
     * that caused it, and "this episode is empty" on top of that sends them
     * looking at the heading for a mistake that is four lines below it.
     */
    if (episode.nodes.length === 0) {
      complain(episode.line, `Episode "${episode.title}" is empty, so there is nothing to play.`);
    }

    episodes.push({
      id,
      title: episode.title,
      steps,
      battles,
      ...(episode.sideCut ? { optional: { test: episode.sideCut.test, label: episode.sideCut.raw } } : {}),
    });
  }

  const chapter: StoryChapter = {
    id: script.id,
    file: script.file,
    title: script.title,
    faction,
    about: script.about,
    lockedUntil: script.lockedUntil ? slugify(script.lockedUntil) : null,
    episodes,
    flags: [...written].sort(),
  };

  return { chapter: problems.length ? null : chapter, problems };
}
