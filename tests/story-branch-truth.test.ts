/**
 * The one class of defect the rest of the suite provably cannot see.
 *
 * `story-scripts` proves every branch **reaches an ending**, and walks all of
 * them to do it. Nothing checks whether a line *outside* a branch is **true** on
 * every branch — and that is a real failure mode with a real record. Writing
 * Chapters 9 and 10 produced four of them in one afternoon:
 *
 *   - a pile-on arriving "on the fork", in a line that plays whether or not
 *     anybody forked
 *   - a boss recommending a four-minute video that only exists if the player
 *     bought out a contract two chapters earlier
 *   - an archive's nightly entry implying a post that only one path made
 *   - "It doesn't know it's over", on the path where it is not over
 *
 * A test cannot read for meaning, so it reads for **vocabulary**: a phrase whose
 * first appearance in the chapter is inside a branch, used again later by a line
 * that always plays. That is not proof of a defect — the last of the four above
 * is invisible to it, because the leak there is semantic and shares no words —
 * but it is exactly the shape of the other three, and it costs nothing to run.
 *
 * Findings are checked against an explicit allowlist rather than merely printed.
 * A warning nobody reads is not a test; and the allowlist is where a deliberate
 * echo gets written down with its reason, which is the useful artifact.
 */

import { describe, expect, it } from "vitest";
import { parseChapterScript } from "../src/game/story/parse";
import type { ScriptNode } from "../src/game/story/types";

const sources = import.meta.glob("../data/story/*.story.txt", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * Phrases that legitimately appear both inside a branch and outside one.
 *
 * Add to this only with a reason. "It looked fine" is not one — the whole value
 * of the list is that every entry says why a leak is not a leak.
 */
const ALLOWED: { chapter: string; phrase: string; why: string }[] = [
  {
    chapter: "Encore, Please",
    phrase: "fourteen months i",
    why: "Fourteen months is the chapter's own founding fact — how long the unit has been one person. It happens to be said first inside an option, but it is true on every path and stated unconditionally in the opening narration too.",
  },
  {
    chapter: "Ratio",
    phrase: "two hundred thousand",
    why: "Cyra is describing the arc any format takes, not the one Blayze built. The number matching the branch is a coincidence a player on the other path cannot notice.",
  },
  {
    chapter: "Render Unto",
    phrase: "be somebody else",
    why: "Two different senses — 'be somebody else entirely with my name on the door' and 'go and be somebody else's four in the morning'. Shared words, no shared referent.",
  },
  {
    chapter: "Best in Show",
    phrase: "a shoulder strut",
    why: "The strut is on the costume on every path. The judge writing about it does not depend on the photo-line scene that also mentions it.",
  },
  {
    chapter: "Best in Show",
    phrase: "that came apart",
    why: "Sunny's wing comes apart on Friday in Episode 2, unconditionally. Nadia's shoulder coming apart on the same Friday is a deliberate rhyme, and the closing POST is about the wing.",
  },
  { chapter: "Best in Show", phrase: "came apart on", why: "Same line as above." },
  { chapter: "Best in Show", phrase: "apart on friday", why: "Same line as above." },
  {
    chapter: "Log Off",
    phrase: "glad on sunday",
    why: "The narration states the Order's claim in its own words rather than quoting the loss line, so it reads whole on a win.",
  },
  {
    chapter: "Log Off",
    phrase: "four thousand one",
    why: "The side cut has Ivo recite the inbox totals from memory before Episode 5 shows him reading them. Episode 5's line states all three numbers in full and depends on nothing.",
  },
  { chapter: "Log Off", phrase: "thousand one hundred", why: "Same line as above." },
  { chapter: "Log Off", phrase: "three thousand nine", why: "Same line as above." },
  { chapter: "Log Off", phrase: "and twenty nine", why: "Same line as above." },
  {
    chapter: "The Update",
    phrase: "impact by band",
    why: "Deliberate and ambiguous: on the roll-back path the unsigned line in 11.5.0 is Sella's phrase propagating, and on the other path it is somebody else arriving at the same sentence. Both readings work, which is the point of leaving it unsigned.",
  },
  {
    chapter: "Repost",
    phrase: "the chair moves",
    why: "The Chairperson's catchphrase. It first appears in a loss block only because that is the first battle; it is his register in every scene.",
  },
  { chapter: "Repost", phrase: "chair moves that", why: "Same catchphrase." },
];

const STOPWORDS = new Set(
  ("a an and are as at be been but by for from had has have he her him his i if in is it its me my no not of on " +
    "one or our out she so that the their them then there they this to too up us was we were what when which who " +
    "will with would you your do does did done get got go going just like now only over said say says see still " +
    "than that's them very back down into about after again all am any because been before being both can could " +
    "even ever every first here how know last let made make many more most much never new next nobody nothing " +
    "off once other own same some something take tell than these thing things think those three through time two " +
    "under until want way well went where while why yes yet").split(/\s+/)
);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Distinctive 3-grams: at least two words that carry meaning. */
function phrases(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = words(text);
  for (let i = 0; i + 2 < tokens.length; i++) {
    const gram = tokens.slice(i, i + 3);
    const meaty = gram.filter((word) => !STOPWORDS.has(word) && word.length >= 4);
    if (meaty.length >= 2) out.add(gram.join(" "));
  }
  return out;
}

/**
 * What a node says, without who says it.
 *
 * Speaker names are deliberately excluded. Including them turns every recurring
 * character into a phrase introduced by whichever branch happened to speak first,
 * which buries the real findings under one row per line of dialogue.
 */
function textOf(node: ScriptNode): string {
  switch (node.kind) {
    case "line":
      return node.text;
    case "narration":
    case "post":
      return node.text;
    case "choice":
      return node.prompt;
    case "battle":
      return node.battle.opponentName;
    default:
      return "";
  }
}

interface Span {
  text: string;
  /** file order, so "first appearance" means something */
  line: number;
  conditional: boolean;
}

/** Flatten a chapter into spans, remembering which ones sit inside a branch. */
function spansOf(nodes: readonly ScriptNode[], inBranch = false): Span[] {
  const out: Span[] = [];
  for (const node of nodes) {
    out.push({ text: textOf(node), line: node.line, conditional: inBranch });
    if (node.kind === "if") {
      out.push(...spansOf(node.then, true));
      out.push(...spansOf(node.otherwise, true));
    } else if (node.kind === "choice") {
      for (const option of node.options) {
        out.push({ text: option.label, line: option.line, conditional: true });
        out.push(...spansOf(option.nodes, true));
      }
    } else if (node.kind === "battle") {
      // a loss block only plays if you lose, which is a branch like any other
      out.push(...spansOf(node.onLose, true));
    }
  }
  return out;
}

interface Leak {
  chapter: string;
  line: number;
  phrase: string;
  introducedAt: number;
}

function leaksIn(file: string, source: string): Leak[] {
  const { script } = parseChapterScript(file, source);
  if (!script) return [];

  /**
   * A side cut is conditional all the way down. Its lines carry no `IF`, but the
   * episode containing them only plays for a player who took one option at one
   * decision — so everything in it is branch-owned, and anything it introduces
   * must not be leaned on by a line that always plays.
   */
  const spans = script.episodes
    .flatMap((episode) => spansOf(episode.nodes, episode.sideCut !== null))
    .sort((a, b) => a.line - b.line);

  /**
   * Where each phrase turns up, split by whether the line always plays.
   *
   * A phrase used in two or more unconditional places is the chapter's shared
   * vocabulary — its own recurring number, its own running joke — and a branch
   * echoing it proves nothing. The signal is a phrase that exists in exactly ONE
   * line that always plays, and otherwise only inside branches: that is a line
   * borrowing something it did not establish.
   */
  const seen = new Map<string, { unconditional: Span[]; conditional: Span[] }>();
  for (const span of spans) {
    for (const phrase of phrases(span.text)) {
      const entry = seen.get(phrase) ?? { unconditional: [], conditional: [] };
      (span.conditional ? entry.conditional : entry.unconditional).push(span);
      seen.set(phrase, entry);
    }
  }

  const leaks: Leak[] = [];
  for (const [phrase, entry] of seen) {
    if (entry.unconditional.length !== 1) continue;
    const earlier = entry.conditional.filter((span) => span.line < entry.unconditional[0]!.line);
    if (earlier.length === 0) continue;
    leaks.push({
      chapter: script.title,
      line: entry.unconditional[0]!.line,
      phrase,
      introducedAt: Math.min(...earlier.map((span) => span.line)),
    });
  }
  return leaks.sort((a, b) => a.line - b.line);
}

describe("lines that always play", () => {
  it("never lean on something only one branch established", () => {
    const found: Leak[] = [];
    for (const [path, source] of Object.entries(sources)) {
      const file = path.split("/").pop()!;
      found.push(...leaksIn(file, source));
    }

    const unexplained = found.filter(
      (leak) => !ALLOWED.some((entry) => entry.chapter === leak.chapter && entry.phrase === leak.phrase)
    );

    const report = unexplained
      .map(
        (leak) =>
          `  ${leak.chapter} line ${leak.line}: "${leak.phrase}" — only ever set up on a branch, at line ${leak.introducedAt}`
      )
      .join("\n");

    expect(
      unexplained,
      unexplained.length === 0
        ? ""
        : `\n${unexplained.length} line(s) that always play depend on something only one branch says:\n${report}\n\n` +
          "Either make the later line true on every path, move it inside the matching IF, or add it to ALLOWED with a reason.\n"
    ).toEqual([]);
  });
});
