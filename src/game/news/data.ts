/**
 * `data/news.json` and `data/patch-notes.json`, parsed and validated once.
 *
 * Same contract as every other data gateway: the file is the source of truth, it
 * is checked on load, and a malformed entry is a load error rather than an
 * article that silently renders as a blank page.
 */

import { z } from "zod";
import rawNews from "../../../data/news.json";
import rawPatchNotes from "../../../data/patch-notes.json";

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/**
 * Where an article can send you.
 *
 * A closed list rather than a free string, because "the article links to the
 * banner page" is only true if something turns that into a route — and the one
 * failure this file can produce that nobody would notice is a link that goes
 * nowhere.
 */
export const NEWS_ROUTES = [
  "collection",
  "banner",
  "pass",
  "missions",
  "shop",
  "doomscroll",
  "story",
  "gallery",
  "achievements",
  "inbox",
  "patchnotes",
] as const;

export type NewsRoute = (typeof NEWS_ROUTES)[number];

const categorySchema = z
  .object({ id: z.string().min(1), name: z.string().min(1), blurb: z.string().min(1) })
  .strict();

export type NewsCategory = z.infer<typeof categorySchema>;

/**
 * What an article is *about*, when it is about one dated thing.
 *
 * Bound by id rather than by "whatever is running now", so `{subject.ends}` in a
 * season-one article means season one forever. An article that silently
 * re-pointed at the next season would be the worst kind of wrong: still
 * grammatical, still plausible, and about something else.
 */
const subjectSchema = z
  .object({ kind: z.enum(["season", "banner"]), id: z.string().min(1) })
  .strict();

export type NewsSubject = z.infer<typeof subjectSchema>;

const articleSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    title: z.string().min(1),
    /** ISO 8601, so a publication date is readable in the file itself */
    publishedAt: z.string().datetime(),
    subject: subjectSchema.optional(),
    summary: z.string().min(1),
    body: z.array(z.string().min(1)).min(1),
    link: z.object({ screen: z.enum(NEWS_ROUTES), label: z.string().min(1) }).strict().optional(),
  })
  .strict();

export type NewsArticleDef = z.infer<typeof articleSchema>;

const newsFileSchema = z.object({
  categories: z.array(categorySchema).min(1),
  articles: z.array(articleSchema).min(1),
});

export type NewsFile = z.infer<typeof newsFileSchema>;

// ---------------------------------------------------------------------------
// Patch notes
// ---------------------------------------------------------------------------

/**
 * The fields a card change can name.
 *
 * Only the **before** is stored. The after is read off the shipped card, or off
 * the next release that touched the same card — so a note and the card it
 * describes cannot disagree, because there is only one copy of the new value.
 */
const cardBeforeSchema = z
  .object({
    cost: z.number().int().nonnegative().optional(),
    attack: z.number().int().nonnegative().optional(),
    health: z.number().int().positive().optional(),
    text: z.string().min(1).optional(),
    keywords: z.array(z.string().min(1)).optional(),
    rarity: z.enum(["common", "rare", "epic", "legendary"]).optional(),
  })
  .strict();

export type CardBefore = z.infer<typeof cardBeforeSchema>;

const cardChangeSchema = z
  .object({
    cardId: z.string().min(1),
    /** one line saying why, in the player's language rather than the designer's */
    note: z.string().min(1).optional(),
    before: cardBeforeSchema,
  })
  .strict();

export type CardChangeDef = z.infer<typeof cardChangeSchema>;

const releaseSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be a semver string like 1.2.3"),
    releasedAt: z.string().datetime(),
    headline: z.string().min(1),
    summary: z.string().min(1),
    /**
     * The economy this release shipped with. Deliberately the whole block rather
     * than "the bits that changed": a diff needs both sides, and the side nobody
     * remembers to write down is the one that was already there.
     */
    economy: z.record(z.string(), z.unknown()),
    cards: z.array(cardChangeSchema),
    rules: z.array(z.string().min(1)),
    systems: z.array(z.string().min(1)),
    fixes: z.array(z.string().min(1)),
  })
  .strict();

export type ReleaseDef = z.infer<typeof releaseSchema>;

const patchNotesFileSchema = z.object({ releases: z.array(releaseSchema).min(1) });

export type PatchNotesFile = z.infer<typeof patchNotesFileSchema>;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export class NewsDataError extends Error {}

let newsCache: NewsFile | null = null;
let patchCache: PatchNotesFile | null = null;

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

function parse<T>(schema: z.ZodType<T>, raw: unknown, file: string): T {
  const parsed = schema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new NewsDataError(
      `${file} is invalid:\n` +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  return parsed.data;
}

export function newsData(): NewsFile {
  newsCache ??= parse(newsFileSchema, rawNews, "data/news.json");
  return newsCache;
}

export function patchNotesData(): PatchNotesFile {
  patchCache ??= parse(patchNotesFileSchema, rawPatchNotes, "data/patch-notes.json");
  return patchCache;
}

/** Test hook: re-read the files after a fixture replaced them. */
export function resetNewsData(): void {
  newsCache = null;
  patchCache = null;
}
