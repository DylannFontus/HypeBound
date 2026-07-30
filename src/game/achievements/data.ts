/**
 * `data/achievements.json`, parsed and validated once.
 *
 * Same contract as every other data gateway here: the file is the source of
 * truth, it is checked on load, and a malformed entry is a load error rather
 * than an achievement that quietly never completes.
 *
 * The interesting validation is not in this schema — a well-formed requirement
 * can still name a statistic that does not exist, or a cosmetic nothing can
 * display. That is `checkAchievementsData`, which needs the content index and so
 * cannot live here.
 */

import { z } from "zod";
import raw from "../../../data/achievements.json";

/**
 * What an achievement may ask about, and nothing else.
 *
 * - `total` sums a per-match statistic over every match ever played.
 * - `best` takes the largest single-match value ever recorded.
 * - `distinct` counts different values seen — factions won with, Confluences
 *   fired, modes played. A count would not do for those: nine activations of
 *   the same Confluence is not *Weather Machine*.
 * - `account` reads a fact about the account rather than about matches.
 *
 * The `stat` and `of` fields are plain strings here and checked against the real
 * vocabularies in `checkAchievementsData`, because the vocabularies are derived
 * from `MatchStats` and a zod enum would be a second copy of them to drift.
 */
const requirementSchema = z.discriminatedUnion("need", [
  z.object({ need: z.literal("total"), stat: z.string().min(1), target: z.number().int().positive() }).strict(),
  z.object({ need: z.literal("best"), stat: z.string().min(1), target: z.number().int().positive() }).strict(),
  z.object({ need: z.literal("distinct"), of: z.string().min(1), target: z.number().int().positive() }).strict(),
  z.object({ need: z.literal("account"), of: z.string().min(1), target: z.number().int().positive() }).strict(),
]);

export type AchievementRequirement = z.infer<typeof requirementSchema>;

/**
 * What an achievement pays.
 *
 * The same three-way split Mastery uses, minus the card rewards: §9 is explicit
 * that achievement rewards are Clout, Fragments and cosmetics, so an achievement
 * can never be a route to a card somebody else has to open packs for.
 *
 * `ref` carries the same meaning it carries on a mastery reward — the id of a
 * cosmetic something can actually display. Its presence is what separates a
 * reward that can be paid from one that is still a promise, and it is the same
 * fact the granting code acts on, so the two cannot disagree.
 */
const rewardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clout"), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("fragments"), amount: z.number().int().positive() }).strict(),
  z
    .object({ kind: z.literal("cosmetic"), name: z.string().min(1), ref: z.string().min(1).optional() })
    .strict(),
]);

export type AchievementReward = z.infer<typeof rewardSchema>;

const achievementSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    /** the sentence the player reads, checked against the requirement in tests */
    text: z.string().min(1),
    points: z.number().int().positive(),
    /** Hidden-category entries show this instead of their text until unlocked */
    hint: z.string().min(1).optional(),
    requirement: requirementSchema,
    rewards: z.array(rewardSchema),
  })
  .strict();

export type AchievementDef = z.infer<typeof achievementSchema>;

const categorySchema = z
  .object({ id: z.string().min(1), name: z.string().min(1), blurb: z.string().min(1) })
  .strict();

export type AchievementCategory = z.infer<typeof categorySchema>;

const milestoneSchema = z
  .object({ points: z.number().int().positive(), name: z.string().min(1), reward: rewardSchema })
  .strict();

export type PointMilestone = z.infer<typeof milestoneSchema>;

const fileSchema = z.object({
  categories: z.array(categorySchema).min(1),
  milestones: z.array(milestoneSchema),
  achievements: z.array(achievementSchema).min(1),
});

export type AchievementsFile = z.infer<typeof fileSchema>;

export class AchievementsDataError extends Error {}

let cache: AchievementsFile | null = null;

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

export function achievementsData(): AchievementsFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new AchievementsDataError(
      "data/achievements.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = parsed.data;
  return cache;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetAchievementsData(): void {
  cache = null;
}
