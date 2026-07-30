/**
 * The manifest in `src/engine/dataFiles.ts` must be a faithful mirror of the
 * data directories it replaced.
 *
 * `import.meta.glob` had exactly one virtue: it could not go out of date. Trading
 * it for a written list buys portability — the server compiles the engine
 * verbatim under wrangler, which has no globs — and the bill comes due the first
 * time somebody adds `data/cards/new-faction.json` and forgets the manifest.
 *
 * That failure is silent in the worst way. A missing card file is not a crash;
 * it is a game where a faction quietly does not exist, decks auto-build from a
 * smaller pool, and — because card order decides `collectibleCards()` — the same
 * seed deals a different match on the two builds. So this file re-derives from
 * disk everything the manifest asserts, and compares.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getContent } from "../src/engine/content";
import { getEncounters } from "../src/engine/encounters";
import { CARD_FILES, ENCOUNTER_FILES, type DataFile } from "../src/engine/dataFiles";

/** Manifest paths are relative to `src/engine/`; resolve them the same way the compiler does. */
const fromEngine = (relative: string): string =>
  fileURLToPath(new URL(`../src/engine/${relative}`, import.meta.url));

const dirOnDisk = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));

const jsonNames = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

interface Corpus {
  label: string;
  dir: string;
  files: readonly DataFile[];
  /** Lower bound on the directory listing, so an unreadable dir cannot pass as an empty one. */
  atLeast: number;
}

const CORPORA: Corpus[] = [
  { label: "cards", dir: "data/cards", files: CARD_FILES, atLeast: 10 },
  { label: "encounters", dir: "data/encounters", files: ENCOUNTER_FILES, atLeast: 2 },
];

describe.each(CORPORA)("$label: the manifest matches the directory", ({ label, dir, files, atLeast }) => {
  const onDisk = jsonNames(dirOnDisk(dir));

  it("read a directory that actually has files in it", () => {
    // Without this, a mistyped `dir` makes every comparison below compare
    // nothing to nothing and pass. The manifest is the thing under test; the
    // directory listing is the evidence, and evidence has to exist.
    expect(onDisk.length, `${dir} listed no .json files, so nothing below was compared`).toBeGreaterThanOrEqual(
      atLeast
    );
  });

  it("lists every file in the directory, and no file that is not there", () => {
    expect(files.map((f) => basename(f.path)).sort()).toEqual(onDisk);
  });

  it("does not sweep in the non-JSON files sitting next to them", () => {
    // `data/cards/lore.txt` is a real file in a real cards directory. The glob
    // said `*.json`; a hand-written list has no such filter, so the exclusion is
    // now a claim rather than a mechanism.
    const nonJson = readdirSync(dirOnDisk(dir)).filter((name) => !name.endsWith(".json"));
    for (const name of nonJson) {
      expect(files.some((f) => basename(f.path) === name), `${name} is not JSON and must not be loaded`).toBe(false);
    }
  });

  it("pairs every path with the file that path names", () => {
    /**
     * The set check above passes just as happily for
     * `{ path: ".../neutral.json", data: tokens }` — every name present, every
     * name real, two entries swapped. Card *order* comes from the path strings
     * and card *content* comes from the imports, so a mislabelled pair reorders
     * two factions on one build and not the other. Compare the payloads.
     */
    for (const file of files) {
      const actual = JSON.parse(readFileSync(fromEngine(file.path), "utf8")) as unknown;
      expect(file.data, `${file.path} is labelled with another file's contents`).toEqual(actual);
    }
  });

  it("has no duplicate entries", () => {
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size, `${label} lists the same path twice`).toBe(paths.length);
  });
});

describe("card order survived the move off import.meta.glob", () => {
  it("builds cards in the exact order sorting the directory would have produced", () => {
    /**
     * This is the assertion the refactor rests on, and it deliberately does not
     * consult the manifest: it reads the directory, sorts it the way the glob's
     * consumer sorted its keys, and flattens the ids. `content.cards` is built
     * by inserting in that order, `collectibleCards()` reads
     * `Object.values(...)` in insertion order, and `autoBuildDeck` reads that —
     * so this equality is the difference between two builds dealing the same
     * match from the same seed and dealing different ones.
     */
    const dir = dirOnDisk("data/cards");
    const expected = jsonNames(dir)
      .map((name) => JSON.parse(readFileSync(`${dir}/${name}`, "utf8")) as { id: string }[])
      .flat()
      .map((card) => card.id);

    expect(expected.length, "no card ids were read off disk").toBeGreaterThan(100);
    expect(Object.keys(getContent().cards)).toEqual(expected);
  });
});

describe("the data still loads", () => {
  it("builds a content index and parses every encounter", () => {
    const content = getContent();
    expect(Object.keys(content.cards).length).toBeGreaterThan(100);
    expect(Object.keys(content.leaders).length).toBeGreaterThan(0);

    const encounters = getEncounters(new Set(Object.keys(content.cards)));
    expect(Object.keys(encounters).length).toBeGreaterThan(0);
  });
});
