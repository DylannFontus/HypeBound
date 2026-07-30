/**
 * The wave library — `data/story/waves.json`.
 *
 * Same split as `rules.ts`, for the same reason: a story writer types
 * `WAVES: the support queue` and gets both the mechanics and the sentence the
 * player reads on the brief, while the wave itself is authored once by somebody
 * who knows what a fair board looks like.
 *
 * The one difference is what the file is made of. A rule is a program, so
 * `rules.json` speaks in card ids and effect ops. A wave is a cast list, so this
 * file speaks in card NAMES and is checked against the real content index — the
 * same discipline the chapter format itself uses, and the reason a typo here is
 * reported as "there is no card called X, did you mean Y" rather than arriving
 * as one body fewer than the author counted on.
 */

import { z } from "zod";
import type { ContentIndex, EncounterWave, Seat, WaveCharacter } from "../../engine/types";
import type { StoryWaveSet } from "./types";
import { closestMatch, normalize } from "./parse";
import library from "../../../data/story/waves.json";

/**
 * Drop `_`-prefixed keys at every depth — JSON has no comments and this file is
 * meant to be edited by hand. Same helper as `rules.ts`, kept separate rather
 * than shared because importing one library from the other would make a broken
 * rule file break waves too, and each should fail on its own terms.
 */
function stripNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("_")) continue;
      out[key] = stripNotes(child);
    }
    return out;
  }
  return value;
}

const characterSchema = z.union([
  z.string().min(1),
  z
    .object({
      card: z.string().min(1),
      attack: z.number().int().min(0).optional(),
      health: z.number().int().min(1).optional(),
      maxHealth: z.number().int().min(1).optional(),
      ready: z.boolean().optional(),
    })
    .strict(),
]);

const waveSchema = z
  .object({
    label: z.string().min(1),
    onBoardClear: z.boolean().optional(),
    onTurn: z.number().int().positive().optional(),
    characters: z.array(characterSchema).min(1),
  })
  .strict()
  .refine((wave) => wave.onBoardClear === true || wave.onTurn !== undefined, {
    // a wave with no cue never arrives, and does it silently: the battle simply
    // plays as though the wave had not been written
    message: 'needs a cue — set "onBoardClear": true, "onTurn": <n>, or both',
  });

const setSchema = z
  .object({
    name: z.string().min(1),
    text: z.string().min(1),
    side: z.enum(["you", "opponent"]),
    waves: z.array(waveSchema).min(1),
  })
  .strict();

const librarySchema = z.record(z.string(), setSchema);

export class StoryWaveError extends Error {}

let cache: StoryWaveSet[] | null = null;

/** Every wave set, in file order — which is the order the writer's menu prints. */
export function storyWaveSets(): StoryWaveSet[] {
  if (cache) return cache;
  const raw = stripNotes(library) as Record<string, unknown>;
  const parsed = librarySchema.safeParse(raw);
  if (!parsed.success) {
    throw new StoryWaveError(
      "data/story/waves.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = Object.entries(parsed.data).map(([id, set]) => ({ id, ...set }) as StoryWaveSet);
  return cache;
}

/** Test hook: re-read the library after a fixture replaced it. */
export function resetStoryWaves(): void {
  cache = null;
}

/**
 * Resolve a set's card names against real content, into the shape the engine takes.
 *
 * Complaints are collected rather than thrown one at a time, because a set with
 * two misspelled cards should take one run to fix, not two — the same rule the
 * chapter compiler follows.
 */
export function resolveWaveSet(
  content: ContentIndex,
  set: StoryWaveSet,
  seat: Seat
): { waves: EncounterWave[]; problems: string[] } {
  const byName = new Map<string, string>();
  for (const card of Object.values(content.cards)) {
    if (card.type !== "character") continue;
    const key = normalize(card.name);
    // first id wins, so a set naming a card three cards share resolves stably;
    // an author who needs a specific one of them writes the id instead
    if (!byName.has(key)) byName.set(key, card.id);
    byName.set(normalize(card.id), card.id);
  }
  const characterNames = Object.values(content.cards)
    .filter((card) => card.type === "character")
    .map((card) => card.name);

  const slots = content.balance.board.characterSlots;
  const problems: string[] = [];
  const waves: EncounterWave[] = [];

  for (const [index, wave] of set.waves.entries()) {
    const where = `${set.id}, wave ${index + 1} ("${wave.label}")`;
    /**
     * A wave larger than the board cannot all arrive, so part of it is dropped
     * at runtime. That is announced rather than hidden, but it is still a board
     * the author did not design, so it is refused here instead.
     */
    if (wave.characters.length > slots) {
      problems.push(`${where}: ${wave.characters.length} characters, but the board only holds ${slots}.`);
    }

    const characters: WaveCharacter[] = [];
    for (const entry of wave.characters) {
      const spec = typeof entry === "string" ? { card: entry } : entry;
      const cardId = byName.get(normalize(spec.card));
      if (!cardId) {
        const suggestion = closestMatch(spec.card, characterNames);
        problems.push(
          `${where}: there is no character card called "${spec.card}".` +
            (suggestion ? ` Did you mean "${suggestion}"?` : "")
        );
        continue;
      }
      characters.push({
        cardId,
        ...(spec.attack !== undefined ? { attack: spec.attack } : {}),
        ...(spec.health !== undefined ? { health: spec.health } : {}),
        ...(spec.maxHealth !== undefined ? { maxHealth: spec.maxHealth } : {}),
        ...(spec.ready !== undefined ? { ready: spec.ready } : {}),
      });
    }

    waves.push({
      label: wave.label,
      seat,
      ...(wave.onBoardClear !== undefined ? { onBoardClear: wave.onBoardClear } : {}),
      ...(wave.onTurn !== undefined ? { onTurn: wave.onTurn } : {}),
      characters,
    });
  }

  return { waves, problems };
}

/**
 * One line per wave for the pre-battle brief.
 *
 * The player is told what is coming and roughly when, because the whole reason a
 * wave encounter is different from an opponent who keeps drawing is that you can
 * count it down. A surprise that arrives three times is just a surprise.
 */
export function waveSchedule(set: StoryWaveSet): string[] {
  return set.waves.map((wave, index) => {
    const cues: string[] = [];
    if (wave.onBoardClear) cues.push("when their board is empty");
    if (wave.onTurn !== undefined) cues.push(`on their turn ${wave.onTurn}`);
    const bodies = wave.characters.length === 1 ? "1 character" : `${wave.characters.length} characters`;
    return `${index + 1}. ${wave.label} — ${bodies}, ${cues.join(", or ")}`;
  });
}
