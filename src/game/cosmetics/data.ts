/**
 * `data/cosmetics.json`, parsed and validated once.
 *
 * Same contract as the other data gateways: the file is the source of truth, it
 * is checked on load, and a malformed entry is a load error rather than a card
 * back that quietly renders blank.
 */

import { z } from "zod";
import raw from "../../../data/cosmetics.json";

/**
 * The shapes the card-back and frame renderers know how to draw.
 *
 * A closed union rather than a free string, because the failure mode of a typo
 * is a cosmetic that resolves, validates, is granted, is equipped — and draws
 * nothing. That is the inert-reward bug with extra steps.
 */
export const EMBLEMS = [
  "starburst",
  "rose",
  "spiral",
  "grid",
  "sigil",
  "visor",
  "glass",
  "leaf",
  "eye",
  "stamp",
  // not a faction's — the achievement awards, and the seasonal passes
  "laurel",
  "trophy",
  "hoard",
  "signal",
  "mask",
  // the Gauntlet's — a draft bracket narrowing to one
  "bracket",
  // the tutorial's — a first upload going out over the horizon
  "sunrise",
] as const;
export type EmblemId = (typeof EMBLEMS)[number];

const emoteSetSchema = z
  .object({ first: z.string().min(1), set: z.array(z.string().min(1)).min(1) })
  .strict();

/**
 * A cosmetic belonging to no faction, leader or character — an achievement's.
 *
 * Everything else in this file is derived from an entity that supplies its own
 * colour and emblem. These have nobody to inherit from, so they carry their own,
 * and they carry the slot they belong in: without `kind`, `frame:award:stormfront`
 * would resolve to a title and be worn in the frame slot, drawing nothing.
 */
const awardSchema = z
  .object({
    /**
     * `cardBack` joined the list for the Gauntlet.
     *
     * Every other card back in this game inherits its colour and emblem from
     * something — a faction, a season, a banner, a check-in month. The Gauntlet
     * is a mode, and a mode has no crest to borrow, so its back carries its own
     * exactly as the achievement frames do.
     */
    kind: z.enum(["title", "frame", "badge", "cardBack"]),
    name: z.string().min(1),
    source: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    emblem: z.enum(EMBLEMS).optional(),
  })
  .strict();

export type AwardCosmetic = z.infer<typeof awardSchema>;

/**
 * A Hype Wave season's cosmetics (08 §10).
 *
 * A colour, an emblem, a title and three phrases. Everything visual is derived
 * from those, including the card-back tints — which are the same emblem in a
 * different colour, and which is exactly what §10.3 means by listing "card-back
 * tints" among the Backstage track's minor cosmetics.
 *
 * `tints[0]` is the base card back, so a season always has at least one.
 */
const seasonCosmeticsSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    emblem: z.enum(EMBLEMS),
    tints: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1),
    emote: emoteSetSchema,
  })
  .strict();

export type SeasonCosmetics = z.infer<typeof seasonCosmeticsSchema>;

/**
 * A Headliner Banner's themed card back (07 §4.1).
 *
 * It reuses a faction emblem on purpose: a banner *is* a faction's showcase, and
 * a back that shared its colour but not its mark would read as belonging to
 * nobody. The colour is the banner's own, so two banners for the same faction
 * are still distinguishable.
 */
const bannerCosmeticSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    emblem: z.enum(EMBLEMS),
  })
  .strict();

/** A month's check-in card back (08 §11 step 10). */
const checkInCosmeticSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    emblem: z.enum(EMBLEMS),
  })
  .strict();

export type CheckInCosmetic = z.infer<typeof checkInCosmeticSchema>;

const fileSchema = z.object({
  titles: z.record(z.string(), z.string().min(1)),
  emblems: z.record(z.string(), z.enum(EMBLEMS)),
  awards: z.record(z.string(), awardSchema),
  seasons: z.record(z.string(), seasonCosmeticsSchema),
  banners: z.record(z.string(), bannerCosmeticSchema),
  checkIn: z.object({ rotation: z.array(checkInCosmeticSchema).min(1) }).strict(),
  emotes: z.object({
    faction: z.record(z.string(), emoteSetSchema),
    leader: z.record(z.string(), z.string().min(1)),
  }),
});

export type CosmeticsFile = z.infer<typeof fileSchema>;

export class CosmeticsDataError extends Error {}

let cache: CosmeticsFile | null = null;

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

export function cosmeticsData(): CosmeticsFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new CosmeticsDataError(
      "data/cosmetics.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = parsed.data;
  return cache;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetCosmeticsData(): void {
  cache = null;
}
