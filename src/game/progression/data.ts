/**
 * `data/progression.json`, parsed and cross-checked.
 *
 * Same shape of contract as the story rule library and the Doomscroll data: the
 * file is the source of truth, it is validated on load, and a list that names a
 * card which no longer exists is a load error rather than a deck that quietly
 * arrives four cards short.
 */

import { z } from "zod";
import type { ContentIndex, FactionId } from "../../engine/types";
import type { StarterDeck } from "./starterDecks";
import { checkStarterDeck } from "./starterDecks";
import raw from "../../../data/progression.json";

const starterSchema = z
  .object({
    leaderCardId: z.string().min(1),
    name: z.string().min(1),
    cards: z.array(z.string().min(1)),
  })
  .strict();

/**
 * A mastery reward.
 *
 * Five kinds are granted for real; `cosmetic` is the honest placeholder for the
 * card backs, portraits, emotes, frames, titles and Premium variants that the
 * design's reward tables are full of and the game has no system for. They are
 * carried in the data rather than deleted so a track can show a player what is
 * coming, and `mastery.ts` refuses to grant them — see `DEFERRED_COSMETICS`.
 */
const rewardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clout"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("fragments"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("pack") }).strict(),
  z
    .object({
      kind: z.literal("pick"),
      rarity: z.enum(["common", "rare", "epic", "legendary"]),
      choices: z.number().int().min(2),
      copies: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("lore"), page: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("cosmetic"),
      cosmetic: z.string().min(1),
      name: z.string().min(1),
      /**
       * The cosmetic id this rank actually grants, with `{id}` standing for the
       * track's own entity — the faction, the leader or the character.
       *
       * Its presence is what separates a cosmetic that can be *paid* from one
       * that is still deferred, and the reward tables are shared across all ten
       * factions and twenty leaders, so a literal id could not work: rank 5 has
       * to grant the Neon Idols card back on the Neon Idols track and the Gothic
       * Royalty one on theirs.
       */
      ref: z.string().min(1).optional(),
    })
    .strict(),
]);

export type MasteryReward = z.infer<typeof rewardSchema>;

const bandSchema = z
  .object({ throughRank: z.number().int().positive(), xpPerRank: z.number().int().positive() })
  .strict();

const trackSchema = z.object({
  ranks: z.number().int().min(2),
  curve: z.array(bandSchema).min(1),
  rewards: z.record(z.string(), z.array(rewardSchema)),
});

const affinitySchema = z.object({
  perMatchCap: z.number().int().positive(),
  ap: z
    .object({
      play: z.number().int().nonnegative(),
      support: z.number().int().nonnegative(),
      parasocial: z.number().int().nonnegative(),
      win: z.number().int().nonnegative(),
    })
    .strict(),
  tiers: z
    .array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          ap: z.number().int().positive(),
          rewards: z.array(rewardSchema),
        })
        .strict()
    )
    .min(1),
});

/**
 * §11's Stream Check-In steps.
 *
 * `cosmetic` carries no ref: which card back a step pays depends on the calendar
 * month, not on the step, so it is resolved at claim time from the cosmetics
 * rotation. That is the one reward in this codebase whose id is a function of
 * *when* it is claimed rather than of what claimed it.
 */
const checkInStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clout"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("fragments"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("glimmer"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("rerollTokens"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("pack") }).strict(),
  z.object({ kind: z.literal("cosmetic"), name: z.string().min(1) }).strict(),
]);

export type CheckInStep = z.infer<typeof checkInStepSchema>;

const checkInSchema = z.object({ steps: z.array(checkInStepSchema).min(1) });

export type CheckInConfig = z.infer<typeof checkInSchema>;

const xpSchema = z.object({
  matchComplete: z.number().int().nonnegative(),
  matchWin: z.number().int().nonnegative(),
});

/**
 * 09 §2.3's tutorial rewards.
 *
 * The per-stage Clout was a literal in `main.ts`; the completion package was a
 * paragraph in a comment explaining why it could not be paid. Both of its
 * blockers are gone — Merch Drops ship, and the cosmetics layer resolves a card
 * back and a title — so the package is data now and gets granted.
 */
const tutorialSchema = z
  .object({
    // only top-level `_`-prefixed keys are stripped, so a nested note is declared
    _note: z.array(z.string()).optional(),
    cloutPerStage: z.number().int().nonnegative(),
    completion: z
      .object({ drops: z.number().int().nonnegative(), cosmetics: z.array(z.string().min(1)) })
      .strict(),
  })
  .strict();

export type TutorialConfig = z.infer<typeof tutorialSchema>;

const fileSchema = z.object({
  starterDecks: z.record(z.string(), starterSchema),
  xp: xpSchema,
  checkIn: checkInSchema,
  tutorial: tutorialSchema,
  factionMastery: trackSchema,
  leaderMastery: trackSchema,
  affinity: affinitySchema,
});

export type TrackConfig = z.infer<typeof trackSchema>;
export type AffinityConfig = z.infer<typeof affinitySchema>;
export type XpConfig = z.infer<typeof xpSchema>;

export class ProgressionDataError extends Error {}

let cache: StarterDeck[] | null = null;
let parsedCache: z.infer<typeof fileSchema> | null = null;

/** The whole file, parsed once. Throws with every problem, not just the first. */
function parseFile(): z.infer<typeof fileSchema> {
  if (parsedCache) return parsedCache;
  const stripped = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_")));
  const parsed = fileSchema.safeParse(stripped);
  if (!parsed.success) {
    throw new ProgressionDataError(
      "data/progression.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  parsedCache = parsed.data;
  return parsedCache;
}

/** Every starter deck, in faction id order. */
export function starterDecks(): StarterDeck[] {
  if (cache) return cache;
  cache = Object.entries(parseFile().starterDecks)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([factionId, deck]) => ({ factionId: factionId as FactionId, ...deck }));
  return cache;
}

/** What one finished match pays, in XP. */
export const xpConfig = (): XpConfig => parseFile().xp;

/** §11's ten-step monthly track. */
export const checkInConfig = (): CheckInConfig => parseFile().checkIn;

/** 09 §2.3's tutorial rewards, per stage and on completion. */
export const tutorialConfig = (): TutorialConfig => parseFile().tutorial;

/** §4 Faction Mastery: 20 ranks, one track per faction. */
export const factionMasteryConfig = (): TrackConfig => parseFile().factionMastery;

/** §5 Leader Mastery: 10 levels, one track per selectable leader. */
export const leaderMasteryConfig = (): TrackConfig => parseFile().leaderMastery;

/** §6 the Bias Board: per-character Affinity. */
export const affinityConfig = (): AffinityConfig => parseFile().affinity;

/** The starter deck for a faction, or null if it has none. */
export function starterDeckFor(factionId: FactionId): StarterDeck | null {
  return starterDecks().find((deck) => deck.factionId === factionId) ?? null;
}

/**
 * Every problem with the frozen lists, checked against real content.
 *
 * Separate from parsing because it needs the content index: the schema can say a
 * list holds thirty strings, and only the card pool can say whether they are
 * thirty cards that a new player could legally play.
 */
export function checkStarterData(content: ContentIndex): string[] {
  const problems: string[] = [];
  const factions = Object.keys(content.factions).filter((id) => id !== "neutral");
  const present = new Set(starterDecks().map((deck) => deck.factionId));

  for (const factionId of factions) {
    if (!present.has(factionId as FactionId)) problems.push(`${factionId} has no starter deck`);
  }
  for (const deck of starterDecks()) {
    if (!content.factions[deck.factionId]) problems.push(`${deck.factionId} is not a faction`);
    if (!content.leaders[deck.leaderCardId]) problems.push(`${deck.factionId}: unknown leader ${deck.leaderCardId}`);
    for (const problem of checkStarterDeck(content, deck)) problems.push(`${deck.factionId}: ${problem}`);
  }
  return problems;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetProgressionData(): void {
  cache = null;
  parsedCache = null;
}
