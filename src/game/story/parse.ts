/**
 * Reads a `.story.txt` chapter script.
 *
 * The format exists because the format everything else in this project uses —
 * strict JSON with ids, schemas and cross-references — is a bad place to write
 * dialogue. A missing comma should not be able to break the game, and nobody
 * should have to know what a `cardId` is to write a scene. So a chapter is a
 * plain text file that reads like a script, and this file is the whole cost of
 * that decision.
 *
 * Two rules shape everything below:
 *
 * 1. **Never fail on punctuation.** There is nothing to balance, nothing to
 *    escape and nothing to quote. Blank lines are free, `#` starts a note to
 *    self, and the only structural thing is indentation — which is required in
 *    exactly three places and forgiving about how much you use.
 *
 * 2. **Every complaint names the line and says what to do.** A parser that says
 *    `unexpected token at 42:17` is useless to the person this format is for.
 *    Every problem carries the line, the text of the line, a sentence of plain
 *    English, and a hint — and where a name was misspelled, the closest name
 *    that would have worked.
 *
 * Parsing NEVER throws. It returns everything it found wrong, so one report can
 * list ten mistakes instead of making the writer fix them one run at a time.
 */

import type {
  ChapterScript,
  FlagTest,
  ScriptBattle,
  ScriptEpisode,
  ScriptNode,
  ScriptOption,
  StoryProblem,
} from "./types";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that mean something to the parser, so they cannot be character names. */
const HEADER_KEYS = ["TITLE", "FACTION", "ABOUT", "LOCKED UNTIL"] as const;
const BODY_KEYS = ["NARRATION", "POST", "REMEMBER", "CHOICE", "BATTLE"] as const;
const BATTLE_KEYS = [
  "PLAYS",
  "THEIR CARDS",
  "YOU PLAY",
  "DIFFICULTY",
  "YOUR HEALTH",
  "THEIR HEALTH",
  "YOUR ARMOR",
  "THEIR ARMOR",
  "GOES FIRST",
  "RULE",
  "WAVES",
  "IF YOU LOSE",
] as const;

/** Only legal directly under a `=== SIDE CUT:` heading. */
const SIDE_CUT_KEY = "UNLOCKED BY";

const RESERVED = new Set<string>([
  ...HEADER_KEYS,
  ...BODY_KEYS,
  ...BATTLE_KEYS,
  "OTHERWISE",
  "EPISODE",
  "SIDE CUT",
  SIDE_CUT_KEY,
]);

/** Every keyword, for "did you mean" when one is misspelled. */
const ALL_KEYWORDS = [...RESERVED];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Edit distance, capped — only used to suggest a correction. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 6) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[n]!;
}

/**
 * The closest of `options` to `word`, if one is close enough to be worth
 * suggesting. Deliberately strict: a wrong suggestion sends someone down a
 * blind alley, which is worse than no suggestion at all.
 */
export function closestMatch(word: string, options: readonly string[]): string | null {
  const needle = word.trim().toLowerCase();
  if (!needle) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const option of options) {
    const score = editDistance(needle, option.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  if (best === null) return null;
  const limit = Math.max(2, Math.floor(needle.length / 3));
  return bestScore <= limit ? best : null;
}

/** Lower-case, single-spaced. Flag names and rule names compare this way. */
export const normalize = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

/** A stable id from a human title: "Encore, Please" -> "encore-please". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "chapter"
  );
}

// ---------------------------------------------------------------------------
// Lines -> tokens
// ---------------------------------------------------------------------------

interface Tok {
  line: number;
  indent: number;
  raw: string;
  /** `KEY` for a `KEY: value` statement, upper-cased and single-spaced */
  key: string | null;
  /** everything after the first colon, trimmed */
  rest: string;
  /** the text before the colon exactly as typed — a speaker name, usually */
  head: string;
  kind: "statement" | "option" | "episode" | "condition" | "otherwise" | "dialogue" | "bare";
}

/** A tab counts as four columns, which is what every editor shows. */
function indentOf(raw: string): number {
  let indent = 0;
  for (const ch of raw) {
    if (ch === " ") indent += 1;
    else if (ch === "\t") indent += 4;
    else break;
  }
  return indent;
}

function tokenize(source: string): Tok[] {
  const toks: Tok[] = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // a note to self; `#` only counts at the start of a line so "#1 fan" is safe
    if (trimmed.startsWith("#")) continue;

    const line = index + 1;
    const indent = indentOf(raw);

    /**
     * A Side Cut is tokenised as an episode on purpose. It *is* an episode
     * boundary — everything that walks the file looking for the next one keeps
     * working untouched, and the only code that has to know the difference is
     * the one loop that reads the heading's key.
     */
    const episode = /^=+\s*(EPISODE|SIDE\s+CUT)\s*:?\s*(.*)$/i.exec(trimmed);
    if (episode) {
      const key = /side/i.test(episode[1]!) ? "SIDE CUT" : "EPISODE";
      toks.push({ line, indent, raw, key, rest: episode[2]!.trim(), head: "", kind: "episode" });
      continue;
    }
    // a divider of bare "=" or "-" characters is decoration; ignore it
    if (/^[=\-–—_*]{3,}$/.test(trimmed)) continue;

    const option = /^[*•]\s*(.*)$/.exec(trimmed);
    if (option) {
      toks.push({ line, indent, raw, key: null, rest: option[1]!.trim(), head: "", kind: "option" });
      continue;
    }

    if (/^OTHERWISE\s*:?\s*$/i.test(trimmed)) {
      toks.push({ line, indent, raw, key: "OTHERWISE", rest: "", head: "", kind: "otherwise" });
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      toks.push({ line, indent, raw, key: null, rest: trimmed, head: trimmed, kind: "bare" });
      continue;
    }

    const head = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    const upper = head.toUpperCase().replace(/\s+/g, " ");

    if (RESERVED.has(upper)) {
      toks.push({ line, indent, raw, key: upper, rest, head, kind: "statement" });
      continue;
    }
    if (/^IF\b/i.test(head)) {
      toks.push({ line, indent, raw, key: "IF", rest: head.replace(/^IF\s+/i, ""), head, kind: "condition" });
      continue;
    }
    toks.push({ line, indent, raw, key: null, rest, head, kind: "dialogue" });
  }

  return toks;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParseResult {
  script: ChapterScript | null;
  problems: StoryProblem[];
}

export function parseChapterScript(file: string, source: string): ParseResult {
  const toks = tokenize(source);
  const problems: StoryProblem[] = [];
  let i = 0;

  const complain = (tok: Tok | null, message: string, hint?: string): void => {
    problems.push({
      file,
      line: tok?.line ?? 1,
      source: tok?.raw.trim() ?? "",
      message,
      ...(hint ? { hint } : {}),
    });
  };

  // -- header ---------------------------------------------------------------

  let title = "";
  let faction: string | null = null;
  let about = "";
  let lockedUntil: string | null = null;
  const lines = { title: 1, faction: 1, lockedUntil: 1 };

  while (i < toks.length && toks[i]!.kind !== "episode") {
    const tok = toks[i]!;
    i++;
    switch (tok.key) {
      case "TITLE":
        if (title) complain(tok, `This chapter already has a title ("${title}").`, "Delete one of the two TITLE lines.");
        title = tok.rest;
        lines.title = tok.line;
        break;
      case "FACTION":
        faction = tok.rest;
        lines.faction = tok.line;
        break;
      case "ABOUT":
        about = about ? `${about} ${tok.rest}` : tok.rest;
        break;
      case "LOCKED UNTIL":
        lockedUntil = tok.rest;
        lines.lockedUntil = tok.line;
        break;
      default: {
        const suggestion = tok.head ? closestMatch(tok.head, HEADER_KEYS) : null;
        complain(
          tok,
          "This line is above the first episode, and only the chapter's own details can go there.",
          suggestion
            ? `Did you mean "${suggestion}:"?`
            : "Everything a character says or does has to be inside an episode. Add a line like " +
              '"=== EPISODE: The Name Of This Part" above it.'
        );
      }
    }
  }

  if (!title) {
    complain(toks[0] ?? null, "This chapter has no title.", 'Add a line at the very top: "TITLE: The Name Of Your Chapter".');
  }

  // -- episodes -------------------------------------------------------------

  const episodes: ScriptEpisode[] = [];

  while (i < toks.length) {
    const header = toks[i]!;
    const isSideCut = header.key === "SIDE CUT";
    i++;
    if (!header.rest) {
      complain(
        header,
        isSideCut ? "This side cut has no name." : "This episode has no name.",
        isSideCut
          ? 'Write it as "=== SIDE CUT: The Long Walk".'
          : 'Write it as "=== EPISODE: Soundcheck for Nobody".'
      );
    }

    /**
     * `UNLOCKED BY:` binds to the heading above it, so it is read here rather
     * than in `parseNodes` — anywhere else in the file it is a mistake, and
     * gets told so by name below.
     */
    let sideCut: ScriptEpisode["sideCut"] = null;
    if (isSideCut) {
      const next = toks[i];
      if (next?.key === SIDE_CUT_KEY) {
        const test = parseTest(next, next.rest);
        i++;
        if (test) sideCut = { test, raw: next.rest.replace(/:$/, "").trim(), line: next.line };
      } else {
        complain(
          header,
          "This side cut does not say what unlocks it, so it could never be played.",
          'Put a line straight underneath it saying which decision opens it — for example "UNLOCKED BY: she stayed".'
        );
      }
    }

    const nodes: ScriptNode[] = [];
    while (i < toks.length && toks[i]!.kind !== "episode") {
      const stray = toks[i]!;
      if (stray.key === SIDE_CUT_KEY) {
        complain(
          stray,
          '"UNLOCKED BY:" only means something directly under a "=== SIDE CUT:" line.',
          isSideCut
            ? "This side cut already has one. A side cut opens on a single decision."
            : 'To make this part optional, change its heading to "=== SIDE CUT: ' +
              `${header.rest || "The Name Of It"}" and put this line straight underneath.`
        );
        i++;
        continue;
      }
      const before = i;
      nodes.push(...parseNodes(-1));
      if (i === before) {
        // parseNodes refused the token; say why, then step over it so one
        // mistake cannot stop the rest of the file being checked
        strayToken(toks[i]!);
        i++;
      }
    }
    episodes.push({
      title: header.rest || `${isSideCut ? "Side Cut" : "Episode"} ${episodes.length + 1}`,
      nodes,
      line: header.line,
      sideCut,
    });
  }

  if (episodes.length === 0) {
    complain(
      toks[toks.length - 1] ?? null,
      "This chapter has no episodes, so there is nothing to play.",
      'Add a line like "=== EPISODE: The First Night" and write the scene under it.'
    );
  }

  const script: ChapterScript = {
    id: slugify(title || file.replace(/\.story\.txt$/i, "")),
    file,
    title,
    faction,
    about,
    lockedUntil,
    episodes,
    lines,
  };

  // The script is returned even when there are problems — the compiler adds its
  // own, and one report listing everything beats ten runs finding one each.
  return { script, problems };

  // -- node parsing ---------------------------------------------------------

  /** Everything indented deeper than `parentIndent`, until the block ends. */
  function parseNodes(parentIndent: number): ScriptNode[] {
    const out: ScriptNode[] = [];
    while (i < toks.length) {
      const tok = toks[i]!;
      if (tok.kind === "episode") break;
      if (tok.indent <= parentIndent) break;
      // an option belongs to a CHOICE; whoever called us decides what to do
      if (tok.kind === "option") break;
      if (tok.kind === "otherwise") break;
      if (tok.key !== null && (BATTLE_KEYS as readonly string[]).includes(tok.key)) break;

      const before = i;
      const node = parseNode(tok);
      if (node) {
        out.push(node);
        continue;
      }
      /**
       * A line we understood the shape of but had to reject — a nameless
       * speaker, an empty REMEMBER — has already been consumed and reported.
       * Carry on with the block rather than ending it, or one bad line inside a
       * choice option would spill every line after it into the wrong place and
       * bury the real complaint under invented ones.
       */
      if (i > before) continue;
      break;
    }
    return out;
  }

  function parseNode(tok: Tok): ScriptNode | null {
    switch (tok.kind) {
      case "statement":
        switch (tok.key) {
          case "NARRATION":
            i++;
            return { kind: "narration", text: tok.rest, line: tok.line };
          case "POST":
            i++;
            return { kind: "post", text: tok.rest, line: tok.line };
          case "REMEMBER":
            i++;
            return parseRemember(tok);
          case "CHOICE":
            return parseChoice(tok);
          case "BATTLE":
            return parseBattle(tok);
          default:
            return null;
        }
      case "condition":
        return parseIf(tok);
      case "dialogue":
        i++;
        return parseDialogue(tok);
      default:
        return null;
    }
  }

  function strayToken(tok: Tok): void {
    if (tok.kind === "option") {
      complain(
        tok,
        "This is a choice option, but there is no CHOICE above it for it to belong to.",
        'Put a line like "CHOICE: What do you say?" above the options.'
      );
      return;
    }
    if (tok.kind === "otherwise") {
      complain(tok, "OTHERWISE has no IF above it.", 'OTHERWISE only follows an "IF ...:" block, at the same indentation.');
      return;
    }
    if (tok.key !== null && (BATTLE_KEYS as readonly string[]).includes(tok.key)) {
      complain(
        tok,
        `"${tok.key}:" only means something inside a battle.`,
        'Put a "BATTLE: Their Name" line above it, at less indentation.'
      );
      return;
    }
    if (tok.key !== null && (HEADER_KEYS as readonly string[]).includes(tok.key)) {
      complain(tok, `"${tok.key}:" belongs at the top of the file, above the first episode.`);
      return;
    }
    if (tok.kind === "bare") {
      const suggestion = closestMatch(tok.rest.split(/\s+/)[0] ?? "", ALL_KEYWORDS);
      complain(
        tok,
        "I can't tell what this line is meant to do.",
        suggestion
          ? `Did you mean "${suggestion}:"? Every line needs a colon — "NAME: what they say", or "NARRATION: what the reader sees".`
          : 'Every line needs a colon: "NAME: what they say", or "NARRATION: what the reader sees".'
      );
      return;
    }
    complain(tok, "I can't tell what this line is meant to do.");
  }

  function parseDialogue(tok: Tok): ScriptNode | null {
    let speaker = tok.head;
    let mood: string | null = null;

    const withMood = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(speaker);
    if (withMood) {
      speaker = withMood[1]!.trim();
      mood = withMood[2]!.trim() || null;
    }

    /**
     * Is this a character speaking, or narration that happens to contain a
     * colon? Guessing wrong is cheap in one direction and expensive in the
     * other: a sentence silently becoming a character named "The sign reads"
     * looks like a bug in the game, so anything sentence-shaped is refused and
     * the writer is told the two ways to write what they meant.
     */
    const looksLikeSentence = /[.!?]/.test(speaker) || speaker.split(/\s+/).length > 6 || speaker.length > 48;
    if (!speaker || looksLikeSentence) {
      complain(
        tok,
        "I can't tell whether this is a character speaking or narration.",
        'For a character, write "LUMI STARCALL: what she says". For narration, start the line with "NARRATION:".'
      );
      return null;
    }
    if (!tok.rest) {
      complain(tok, `${speaker} is named here but does not say anything.`, "Write what they say after the colon.");
      return null;
    }
    return { kind: "line", speaker, mood, text: tok.rest, line: tok.line };
  }

  function parseRemember(tok: Tok): ScriptNode | null {
    const body = tok.rest;
    if (!body) {
      complain(tok, "REMEMBER doesn't say what to remember.", 'Try "REMEMBER: she stayed", or "REMEMBER: tone is warm".');
      return null;
    }

    const counter = /^(.+?)\s*\+\s*(\d+)$/.exec(body);
    if (counter) {
      return { kind: "remember", flag: normalize(counter[1]!), mode: "add", value: Number(counter[2]), line: tok.line };
    }
    const assignment = /^(.+?)\s*(?:=|\bis\b)\s*(.+)$/i.exec(body);
    if (assignment) {
      return {
        kind: "remember",
        flag: normalize(assignment[1]!),
        mode: "set",
        value: normalize(assignment[2]!),
        line: tok.line,
      };
    }
    return { kind: "remember", flag: normalize(body), mode: "set", value: true, line: tok.line };
  }

  function parseTest(tok: Tok, body: string): FlagTest | null {
    const text = body.replace(/:$/, "").trim();
    if (!text) {
      complain(tok, "This IF doesn't say what to check.", 'Try "IF tone is warm:", or "IF she stayed:".');
      return null;
    }

    const atLeast = /^(.+?)\s+is\s+at\s+least\s+(-?\d+)$/i.exec(text);
    if (atLeast) return { test: "atLeast", flag: normalize(atLeast[1]!), value: Number(atLeast[2]) };

    const isNot = /^(.+?)\s+is\s+not\s+(.+)$/i.exec(text);
    if (isNot) return { test: "notEquals", flag: normalize(isNot[1]!), value: normalize(isNot[2]!) };

    const equals = /^(.+?)\s*(?:=|\bis\b)\s*(.+)$/i.exec(text);
    if (equals) return { test: "equals", flag: normalize(equals[1]!), value: normalize(equals[2]!) };

    const negated = /^not\s+(.+)$/i.exec(text);
    if (negated) return { test: "isNotSet", flag: normalize(negated[1]!) };

    return { test: "isSet", flag: normalize(text) };
  }

  function parseIf(tok: Tok): ScriptNode | null {
    const test = parseTest(tok, tok.rest);
    i++;
    if (!test) {
      parseNodes(tok.indent); // consume the block so it is not reported twice
      return null;
    }

    const then = parseNodes(tok.indent);
    if (then.length === 0) {
      complain(
        tok,
        "This IF has nothing under it, so it never does anything.",
        "Indent the lines that should only play when it is true — two spaces is plenty."
      );
    }

    let otherwise: ScriptNode[] = [];
    if (i < toks.length && toks[i]!.kind === "otherwise" && toks[i]!.indent <= tok.indent) {
      const elseTok = toks[i]!;
      i++;
      otherwise = parseNodes(elseTok.indent);
      if (otherwise.length === 0) {
        complain(elseTok, "This OTHERWISE has nothing under it.", "Indent the lines that should play when the IF above is not true.");
      }
    }

    return { kind: "if", test, then, otherwise, line: tok.line };
  }

  function parseChoice(tok: Tok): ScriptNode | null {
    const prompt = tok.rest;
    i++;
    if (!prompt) {
      complain(tok, "This choice has no question.", 'Write it as "CHOICE: What do you say to that?".');
    }

    const options: ScriptOption[] = [];
    let optionIndent = tok.indent;
    let danglingReported = false;

    while (i < toks.length) {
      const next = toks[i]!;
      if (next.kind === "episode" || next.indent < tok.indent) break;

      if (next.kind === "option") {
        optionIndent = next.indent;
        i++;
        if (!next.rest) {
          complain(next, "This option has no text, so the player would see an empty button.", "Write what the player picks after the *.");
        }
        options.push({ label: next.rest, nodes: parseNodes(next.indent), line: next.line });
        continue;
      }

      /**
       * A line at the options' own indentation, which is the mistake this format
       * is most likely to invite: it was meant to belong to the option above and
       * would otherwise play whichever option was picked.
       *
       * Reported once and then given to the option above — which is where the
       * writer meant it — so one missing indent produces one complaint instead of
       * a cascade about missing options and choices that do nothing.
       */
      const previous = options[options.length - 1];
      if (!previous || optionIndent <= tok.indent || next.indent < optionIndent) break;

      if (!danglingReported) {
        danglingReported = true;
        complain(
          next,
          "This line is inside the choice but not under any option.",
          `Indent it further than the "*" to make it part of "${previous.label}", ` +
            "or move it out to the same indentation as CHOICE: to play it whichever option is picked."
        );
      }
      previous.nodes.push(...parseNodes(optionIndent - 1));
    }

    if (options.length === 0) {
      complain(
        tok,
        "This choice has no options.",
        'Put the options underneath it, each starting with a star: "* Say nothing."'
      );
      return null;
    }
    if (options.length === 1) {
      complain(
        tok,
        "This choice has only one option, so the player has nothing to choose.",
        "Add another option, or delete the CHOICE and keep the lines."
      );
    }

    if (options.every((option) => option.nodes.length === 0)) {
      complain(
        tok,
        "None of this choice's options do anything, so the story plays out identically whichever the player picks.",
        "Indent the lines that belong to an option underneath it, or add a REMEMBER: line so a later scene can react."
      );
    }

    return { kind: "choice", prompt, options, line: tok.line };
  }

  function parseBattle(tok: Tok): ScriptNode | null {
    const battle: ScriptBattle = {
      opponentName: tok.rest,
      plays: null,
      theirCards: null,
      youPlay: null,
      difficulty: null,
      yourHealth: null,
      theirHealth: null,
      yourArmor: null,
      theirArmor: null,
      goesFirst: null,
      rules: [],
      waves: null,
      line: tok.line,
      lines: {},
    };
    i++;

    if (!battle.opponentName) {
      complain(tok, "This battle doesn't say who the player is fighting.", 'Write it as "BATTLE: Vex Klipp".');
    }

    let onLose: ScriptNode[] = [];
    const seen = new Set<string>();

    while (i < toks.length) {
      const prop = toks[i]!;
      if (prop.kind === "episode") break;
      if (prop.key === null || !(BATTLE_KEYS as readonly string[]).includes(prop.key)) break;
      if (prop.indent < tok.indent) break;

      if (prop.key !== "RULE" && seen.has(prop.key)) {
        complain(prop, `This battle sets "${prop.key}:" twice.`, "Delete one of them — the game would only use the last.");
      }
      seen.add(prop.key);
      i++;

      switch (prop.key) {
        case "PLAYS":
          battle.plays = prop.rest;
          battle.lines.plays = prop.line;
          break;
        case "THEIR CARDS":
          battle.theirCards = prop.rest;
          battle.lines.theirCards = prop.line;
          break;
        case "YOU PLAY":
          battle.youPlay = prop.rest;
          battle.lines.youPlay = prop.line;
          break;
        case "DIFFICULTY":
          battle.difficulty = prop.rest;
          battle.lines.difficulty = prop.line;
          break;
        case "YOUR HEALTH":
        case "THEIR HEALTH": {
          const value = Number(prop.rest);
          if (!Number.isInteger(value) || value < 1 || value > 200) {
            complain(prop, `"${prop.rest}" is not a health total I can use.`, "Use a whole number between 1 and 200.");
            break;
          }
          if (prop.key === "YOUR HEALTH") battle.yourHealth = value;
          else battle.theirHealth = value;
          break;
        }
        case "YOUR ARMOR":
        case "THEIR ARMOR": {
          const value = Number(prop.rest);
          if (!Number.isInteger(value) || value < 0 || value > 100) {
            complain(prop, `"${prop.rest}" is not an amount of Armor I can use.`, "Use a whole number between 0 and 100.");
            break;
          }
          if (prop.key === "YOUR ARMOR") battle.yourArmor = value;
          else battle.theirArmor = value;
          break;
        }
        case "GOES FIRST": {
          const who = normalize(prop.rest);
          if (who === "you" || who === "player" || who === "me") battle.goesFirst = "you";
          else if (who === "them" || who === "they" || who === "opponent" || who === "enemy") battle.goesFirst = "them";
          else complain(prop, `"${prop.rest}" is not someone who can go first.`, 'Write "GOES FIRST: you" or "GOES FIRST: them".');
          break;
        }
        case "RULE":
          if (!prop.rest) complain(prop, "RULE doesn't name a rule.", "See the rule list in HOW-TO-WRITE-A-CHAPTER.md.");
          else battle.rules.push({ name: prop.rest, line: prop.line });
          break;
        case "WAVES":
          if (!prop.rest) complain(prop, "WAVES doesn't name a wave set.", "See the wave list in HOW-TO-WRITE-A-CHAPTER.md.");
          else battle.waves = { name: prop.rest, line: prop.line };
          break;
        case "IF YOU LOSE":
          onLose = parseNodes(prop.indent);
          if (onLose.length === 0) {
            complain(prop, "IF YOU LOSE has nothing under it.", "Indent the lines that should play after a loss, before the retry.");
          }
          break;
      }
    }

    return { kind: "battle", battle, onLose, line: tok.line };
  }
}
