/**
 * Structural check for the two prose files — `data/cards/lore.txt` and
 * `data/mastery-lore.txt`.
 *
 * `npm run lore` already asserts that every block names a real entity. This
 * checks the thing that assertion cannot: **whether a block says anything.**
 *
 * That distinction is not academic. This project spent a session believing the
 * card flavour was complete because every card had a block — and 295 of the 296
 * blocks contained the string "Not written yet." Counting blocks is not counting
 * prose, and a checker that only counts blocks will agree with you.
 *
 * Run it with `node scripts/check-lore.mjs`. It reads two files and writes
 * nothing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS = path.join(ROOT, "data", "cards");

/** Every block in a lore file: id, body with comments stripped, line number. */
function parseBlocks(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;

  lines.forEach((line, index) => {
    const header = line.match(/^===[ \t]*(\S+)/);
    if (header) {
      if (current) blocks.push(current);
      current = { id: header[1], line: index + 1, body: [] };
      return;
    }
    if (!current) return;
    if (line.trim().startsWith("#")) return;
    current.body.push(line);
  });
  if (current) blocks.push(current);

  return blocks.map((block) => ({
    ...block,
    text: block.body.join("\n").trim(),
  }));
}

/** Every card id the game actually ships, and every selectable leader. */
function realIds() {
  const cards = new Map();
  for (const file of readdirSync(CARDS).filter((name) => name.endsWith(".json"))) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(CARDS, file), "utf8"));
    } catch {
      continue;
    }
    for (const card of Array.isArray(parsed) ? parsed : (parsed.cards ?? [])) {
      cards.set(card.id, card);
    }
  }
  return cards;
}

const problems = [];
const note = (message) => problems.push(message);

const cards = realIds();
console.log(`${cards.size} cards in data/cards/`);

// ---------------------------------------------------------------------------

for (const file of ["data/cards/lore.txt", "data/mastery-lore.txt"]) {
  const blocks = parseBlocks(path.join(ROOT, file));
  const seen = new Set();
  let placeholder = 0;
  let thin = 0;
  let motif = 0;

  for (const block of blocks) {
    const where = `${file}:${block.line} (${block.id})`;

    if (seen.has(block.id)) note(`${where}: duplicate id — the loader would have to choose`);
    seen.add(block.id);

    if (!block.text) {
      note(`${where}: empty block`);
      continue;
    }
    if (/not written yet/i.test(block.text)) {
      placeholder += 1;
      continue;
    }
    // a block short enough to be an accident rather than a choice
    if (block.text.replace(/\s+/g, " ").length < 60) {
      thin += 1;
      note(`${where}: only ${block.text.length} characters — placeholder by another name?`);
    }
    /**
     * Only the *distinctive* numbers count toward the tic.
     *
     * "four" is an ordinary English word and appears in prose that has never
     * heard of this motif; counting it made the figure meaningless. "eleven" and
     * "nineteen" are the ones a reader notices recurring, so they are the ones
     * worth measuring.
     */
    if (/\b(eleven|nineteen)\b/i.test(block.text)) motif += 1;

    /**
     * A wrapped pull quote is a silent formatting bug.
     *
     * The loader takes "a line on its own inside double quotes" as the italic
     * quote at the bottom of the panel. A quote wrapped across two lines matches
     * neither line, so it renders as an ordinary paragraph with stray quote
     * marks — visibly wrong, and invisible to any check that only counts blocks.
     *
     * Only the block's tail is examined. An earlier version scanned every line
     * and flagged prose that merely *opened* with a quoted phrase, which is
     * ordinary writing and not a pull quote at all.
     */
    const bodyLines = block.text.split("\n").filter((line) => line.trim() !== "");
    const last = bodyLines[bodyLines.length - 1]?.trim() ?? "";
    const penultimate = bodyLines[bodyLines.length - 2]?.trim() ?? "";
    if (last.endsWith('"') && !last.startsWith('"') && penultimate.startsWith('"')) {
      note(`${where}: the pull quote is wrapped across two lines — it will render as body text`);
    }
    if (last.startsWith('"') && !last.endsWith('"')) {
      note(`${where}: the last line opens a quote it never closes`);
    }
  }

  const written = blocks.length - placeholder;
  const motifShare = written > 0 ? Math.round((motif / written) * 100) : 0;
  console.log(
    `\n${file}\n  ${blocks.length} blocks · ${written} written · ${placeholder} placeholder · ${thin} thin` +
      `\n  distinctive motif (eleven/nineteen) in ${motif} of ${written} written blocks — ${motifShare}%`
  );

  /**
   * The motif is meant to be noticed on a second read. Past about half, it stops
   * being a signature and becomes a tic, which is worse than not having one.
   */
  if (written >= 20 && motifShare > 55) {
    note(`${file}: the eleven/nineteen motif appears in ${motifShare}% of written blocks — it has become a tic`);
  }

  // ids must name something real
  for (const block of blocks) {
    if (file.endsWith("mastery-lore.txt")) {
      const [kind, entity] = [block.id.split(":")[0], block.id.split(":")[1]];
      if (kind === "faction" || !entity) continue;
      if (!cards.has(entity)) note(`${file}:${block.line}: "${block.id}" names no card`);
    } else if (!cards.has(block.id)) {
      note(`${file}:${block.line}: "${block.id}" names no card`);
    }
  }

  // and every card should eventually have one
  if (file.endsWith("cards/lore.txt")) {
    const covered = new Set(blocks.map((block) => block.id));
    const missing = [...cards.values()].filter((card) => !card.token && !card.variantOf && !covered.has(card.id));
    if (missing.length > 0) note(`${file}: ${missing.length} card(s) have no block at all: ${missing.slice(0, 5).map((c) => c.id).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------

console.log("");
if (problems.length === 0) {
  console.log("PASS — no structural problems.\n");
} else {
  for (const problem of problems) console.log(`  ${problem}`);
  console.log(`\n${problems.length} PROBLEM(S)\n`);
}
process.exit(problems.length === 0 ? 0 : 1);
