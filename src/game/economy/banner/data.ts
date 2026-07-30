/**
 * `data/banners.json`, parsed and validated once.
 *
 * A banner authors only what it **features**. Its pool is the whole collectible
 * set, derived from the content index — because `07-economy-and-monetization.md`
 * §3.2 is explicit that a banner never gates: *"every card that appears on a
 * banner simultaneously enters the general Drop pool and the crafting catalog on
 * its release day. Banners concentrate odds and add pity/targeting; they never
 * gate."* Listing a pool here would be listing the entire card set, and every
 * card added afterwards would silently miss it.
 */

import { z } from "zod";
import raw from "../../../../data/banners.json";

const runSchema = z
  .object({ startAt: z.string().datetime(), weeks: z.number().int().positive() })
  .strict();

export type BannerRun = z.infer<typeof runSchema>;

const bannerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    blurb: z.string().min(1),
    factionId: z.string().min(1),
    featuredLegendary: z.string().min(1),
    featuredEpics: z.array(z.string().min(1)).length(2),
    spotlightedRares: z.array(z.string().min(1)).length(4),
    /**
     * Every run window, including the reruns, from the start.
     *
     * §4 requires a *published* rerun calendar and at least two reruns within
     * twelve months of debut. A rerun you can read the date of is the difference
     * between a schedule and a rumour, so the dates are data rather than a
     * promise made in prose.
     */
    runs: z.array(runSchema).min(1),
  })
  .strict();

export type BannerDef = z.infer<typeof bannerSchema>;

const fileSchema = z.object({ banners: z.array(bannerSchema).min(1) });

export type BannersFile = z.infer<typeof fileSchema>;

export class BannerDataError extends Error {}

let cache: BannersFile | null = null;

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

export function bannerData(): BannersFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new BannerDataError(
      "data/banners.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = parsed.data;
  return cache;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetBannerData(): void {
  cache = null;
}
