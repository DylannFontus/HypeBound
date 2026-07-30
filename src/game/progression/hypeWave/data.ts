/**
 * `data/hype-wave.json`, parsed and validated once.
 *
 * Same contract as every other data gateway: the file is the source of truth, it
 * is checked on load, and a malformed entry is a load error rather than a season
 * that silently pays nothing.
 */

import { z } from "zod";
import raw from "../../../../data/hype-wave.json";

/**
 * What a pass tier pays.
 *
 * `glimmer` appears here and nowhere else in the game yet: it is the premium
 * currency (`08-progression.md` §1), and the pass is currently the only thing
 * that produces any. There is no purchase path, because this build takes no
 * payments — which makes the Backstage Pass something you earn your way into
 * over about two and a half seasons, exactly as §10.2's "a Backstage Pass
 * roughly every other season without spending" describes.
 *
 * `ref` carries the same meaning it carries on a Mastery or achievement reward:
 * the id of a cosmetic something can actually display, with `{season}` standing
 * for the season the tier belongs to. Its presence is what separates a reward
 * that can be paid from one that is still a promise.
 */
const rewardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clout"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("fragments"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("glimmer"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("pack") }).strict(),
  z
    .object({
      kind: z.literal("pick"),
      rarity: z.enum(["common", "rare", "epic", "legendary"]),
      choices: z.number().int().min(2),
      copies: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("cosmetic"), name: z.string().min(1), ref: z.string().min(1).optional() }).strict(),
]);

export type PassReward = z.infer<typeof rewardSchema>;

const seasonSchema = z
  .object({
    id: z.string().min(1),
    number: z.number().int().positive(),
    name: z.string().min(1),
    /** ISO 8601, so a season's dates are readable in the file itself */
    startAt: z.string().datetime(),
    weeks: z.number().int().positive(),
  })
  .strict();

export type SeasonDef = z.infer<typeof seasonSchema>;

const fileSchema = z.object({
  tiers: z.number().int().min(2),
  xpPerTier: z.number().int().positive(),
  encoreClout: z.number().int().positive(),
  backstagePrice: z.number().int().positive(),
  tierSkipPrice: z.number().int().positive(),
  rebound: z.object({ tiersPerWeek: z.number().int().positive(), bonus: z.number().positive() }).strict(),
  archiveRate: z.number().positive().max(1),
  welcomeBack: z
    .object({
      afterDays: z.number().int().positive(),
      clout: z.number().int().positive(),
      reboundWeeks: z.number().int().positive(),
    })
    .strict(),
  freeFiller: rewardSchema,
  backstageFiller: rewardSchema,
  seasons: z.array(seasonSchema).min(1),
  free: z.record(z.string(), z.array(rewardSchema)),
  backstage: z.record(z.string(), z.array(rewardSchema)),
});

export type HypeWaveFile = z.infer<typeof fileSchema>;

export class HypeWaveDataError extends Error {}

let cache: HypeWaveFile | null = null;

/** Strip `_note` keys at any level — they are comments, not data. */
function stripNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, entry]) => [key, stripNotes(entry)])
    );
  }
  return value;
}

export function hypeWaveData(): HypeWaveFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new HypeWaveDataError(
      "data/hype-wave.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = parsed.data;
  return cache;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetHypeWaveData(): void {
  cache = null;
}
