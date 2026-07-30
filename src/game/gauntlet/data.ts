/**
 * `data/gauntlet.json`, parsed and validated once.
 *
 * Same contract as every other data gateway: the file is the source of truth, it
 * is checked on load, and a malformed row is a load error rather than a draft
 * that silently offers two cards or a run that pays nothing.
 */

import { z } from "zod";
import raw from "../../../data/gauntlet.json";

/** Every data block may carry prose; it documents the numbers next to them. */
const note = z.array(z.string()).optional();

const RARITIES = ["common", "rare", "epic", "legendary"] as const;

/**
 * A rarity row. Every rarity is required — including the zeroes.
 *
 * `.partial()` would let a row omit `common` and mean the same thing, and then
 * a row that omitted it *by accident* would still parse. A distribution that is
 * missing an outcome and a distribution that assigns it zero look identical
 * afterward and are very different mistakes, so the file states all four.
 */
const raritySchema = z
  .object({
    common: z.number().min(0).max(1),
    rare: z.number().min(0).max(1),
    epic: z.number().min(0).max(1),
    legendary: z.number().min(0).max(1),
  })
  .strict();

export type RarityWeights = z.infer<typeof raritySchema>;

const draftSchema = z
  .object({
    _note: note,
    leaderChoices: z.number().int().min(2),
    picks: z.number().int().min(1),
    offerSize: z.number().int().min(2),
    spotlightPicks: z.array(z.number().int().min(1)),
    rarity: z.object({ spotlight: raritySchema, standard: raritySchema }).strict(),
    curveAssist: z.number().min(0),
    redrafts: z.number().int().min(0),
  })
  .strict();

const rewardRowSchema = z
  .object({
    wins: z.number().int().min(0),
    clout: z.number().int().min(0),
    packs: z.number().int().min(0),
    signal: z.number().int().min(0),
    tickets: z.number().int().min(0),
    cardBackProgress: z.number().int().min(1).optional(),
    cosmetics: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type RewardRow = z.infer<typeof rewardRowSchema>;

const difficultySchema = z.enum(["beginner", "casual", "intermediate", "advanced", "expert", "boss"]);

const gauntletSchema = z
  .object({
    _readme: note,
    draft: draftSchema,
    run: z.object({ _note: note, winsToRetire: z.number().int().min(1), lossesToRetire: z.number().int().min(1) }).strict(),
    entry: z.object({ _note: note, clout: z.number().int().min(0), ticket: z.number().int().min(0) }).strict(),
    rewards: z.object({ _note: note, rows: z.array(rewardRowSchema).min(1) }).strict(),
    practice: z
      .object({
        _note: note,
        scale: z.number().min(0).max(1),
        packs: z.boolean(),
        tickets: z.boolean(),
        difficultyByWins: z
          .array(z.object({ minWins: z.number().int().min(0), difficulty: difficultySchema }).strict())
          .min(1),
      })
      .strict(),
    cardBack: z
      .object({ _note: note, cosmeticId: z.string().min(1), progressRequired: z.number().int().min(1) })
      .strict(),
  })
  .strict();

export type GauntletData = z.infer<typeof gauntletSchema>;

let cache: GauntletData | null = null;

export function gauntletData(): GauntletData {
  if (!cache) cache = gauntletSchema.parse(raw);
  return cache;
}

/** Test seam: drop the parsed copy so a fixture can be re-read. */
export const resetGauntletData = (): void => {
  cache = null;
};

export const RARITY_ORDER: readonly (typeof RARITIES)[number][] = RARITIES;
export type DraftRarity = (typeof RARITIES)[number];
