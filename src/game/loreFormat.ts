/**
 * The plain-text lore format, shared by the card gallery and the mastery tracks.
 *
 * One format, one parser, two files. `data/cards/lore.txt` carries the Story tab
 * in the card gallery; `data/mastery-lore.txt` carries the pages Faction Mastery,
 * Leader Mastery and the Bias Board unlock. They are separate files because they
 * are separate writing jobs with separate ids, but a second parser would be a
 * second set of rules to learn and a second thing to get subtly wrong.
 *
 * The rules, which are the ones the story scripts follow too:
 *
 *   - a block starts with `===` and an id, and runs to the next one
 *   - `TITLE:` on the first line overrides the heading
 *   - a line that is nothing but a "quoted sentence" becomes the pull quote
 *   - blank lines make paragraph breaks
 *   - `#` at the start of a line is a note and never appears in the game
 *
 * Nothing here can throw. A missing block, an empty block or a block naming an id
 * that does not exist are all handled by the caller — badly-formed lore shows a
 * placeholder or is reported by a test, and never reaches a player as an error.
 */

export interface LoreEntry {
  /** heading override, or null to let the caller supply one */
  title: string | null;
  /** paragraphs, already joined and split */
  body: string[];
  /** the italic line at the bottom, or null */
  quote: string | null;
}

/** Text a writer leaves behind for a block they have not filled in yet. */
export const UNWRITTEN_MARKERS: readonly string[] = ["Not written yet.", "No lore written for this card yet."];

export function parseLore(text: string): Map<string, LoreEntry> {
  const out = new Map<string, LoreEntry>();
  let id: string | null = null;
  let title: string | null = null;
  let quote: string | null = null;
  let paragraphs: string[] = [];
  let current: string[] = [];

  const flushParagraph = (): void => {
    if (current.length > 0) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  };

  const flushBlock = (): void => {
    flushParagraph();
    if (id) out.set(id, { title, body: paragraphs, quote });
    id = null;
    title = null;
    quote = null;
    paragraphs = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // `#` only counts at the start of a line, so "#1 fan" is safe inside prose
    if (line.startsWith("#")) continue;

    const header = /^=+\s*(.+?)\s*$/.exec(line);
    if (header) {
      flushBlock();
      id = header[1]!.trim();
      continue;
    }
    if (!id) continue;

    if (!line) {
      flushParagraph();
      continue;
    }

    const titled = /^TITLE\s*:\s*(.*)$/i.exec(line);
    if (titled && paragraphs.length === 0 && current.length === 0) {
      title = titled[1]!.trim() || null;
      continue;
    }

    // a line that is nothing but a quoted sentence is the pull quote
    const quoted = /^["“](.+)["”]$/.exec(line);
    if (quoted) {
      quote = quoted[1]!.trim();
      continue;
    }

    current.push(line);
  }
  flushBlock();
  return out;
}

/** The prose of an entry, with a writer's placeholder treated as nothing. */
export function writtenBody(entry: LoreEntry | undefined): string[] {
  return (entry?.body ?? []).filter((line) => line && !UNWRITTEN_MARKERS.includes(line));
}
