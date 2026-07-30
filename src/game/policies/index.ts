/**
 * Privacy, legal and support — `03-screens-and-navigation.md` §4.6.4–§4.6.6.
 *
 * ## A document that has not been written says so
 *
 * §4.6.5 asks for Terms of Service and an EULA. Neither has been drafted, and
 * shipping placeholder legalese would be **worse than shipping nothing**: it
 * reads as binding and nobody wrote it. So a document carries a `status`, and a
 * `not-written` one renders as an explanation of what is missing.
 *
 * That is the leaderboards screen's rule — *no fake ladder* — applied to the one
 * category of text where a convincing fake could actually hurt somebody.
 *
 * ## Attributions are generated, not maintained
 *
 * §4.6.5 asks for open-source licences *"generated from the dependency
 * manifest"*, and `checkPoliciesData` enforces exactly that: every dependency in
 * `package.json` must be attributed and every attribution must name a real
 * dependency. Adding a package without crediting it fails `npm test`.
 */

import { z } from "zod";
import type { ContentIndex } from "../../engine/types";
import raw from "../../../data/policies.json";
import manifest from "../../../package.json";
import { DATA_VERSION } from "../news";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const categorySchema = z
  .object({
    name: z.string().min(1),
    collected: z.boolean(),
    detail: z.string().min(1),
    /** where it lives, when it is collected at all */
    where: z.string().min(1).optional(),
  })
  .strict();

const privacySchema = z
  .object({
    version: z.string().min(1),
    effectiveDate: z.string().datetime(),
    summary: z.array(z.string().min(1)).min(1),
    categories: z.array(categorySchema).min(1),
    children: z.array(z.string().min(1)).min(1),
    requests: z.array(z.string().min(1)).min(1),
  })
  .strict();

const documentSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["written", "not-written"]),
    version: z.string().min(1).optional(),
    effectiveDate: z.string().datetime().optional(),
    body: z.array(z.string().min(1)).optional(),
    /** required when the status is `not-written`: what is missing and why */
    note: z.string().min(1).optional(),
  })
  .strict();

const attributionSchema = z
  .object({ package: z.string().min(1), license: z.string().min(1), use: z.string().min(1) })
  .strict();

const faqSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    answer: z.array(z.string().min(1)).min(1),
  })
  .strict();

const fileSchema = z.object({
  privacy: privacySchema,
  legal: z.object({
    documents: z.array(documentSchema).min(1),
    attributions: z.array(attributionSchema).min(1),
  }),
  support: z.object({ faq: z.array(faqSchema).min(1) }),
});

export type PoliciesFile = z.infer<typeof fileSchema>;
export type PrivacyCategory = z.infer<typeof categorySchema>;
export type LegalDocument = z.infer<typeof documentSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
export type FaqEntry = z.infer<typeof faqSchema>;

export class PoliciesDataError extends Error {}

let cache: PoliciesFile | null = null;

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

export function policiesData(): PoliciesFile {
  if (cache) return cache;
  const parsed = fileSchema.safeParse(stripNotes(raw));
  if (!parsed.success) {
    throw new PoliciesDataError(
      "data/policies.json is invalid:\n" +
        parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n")
    );
  }
  cache = parsed.data;
  return cache;
}

/** Test hook: re-read the file after a fixture replaced it. */
export function resetPoliciesData(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** Every package this build depends on, from the manifest itself. */
export function manifestPackages(): string[] {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return Object.keys(deps).sort();
}

export interface AttributedPackage extends Attribution {
  /** the version range the manifest asks for */
  version: string;
  /** false when it is only used to build and test, never shipped to a player */
  runtime: boolean;
}

/** The attribution list, joined to the manifest so the versions are not retyped. */
export function attributions(): AttributedPackage[] {
  const runtime = new Set(Object.keys(manifest.dependencies ?? {}));
  const all: Record<string, string> = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return policiesData()
    .legal.attributions.map((entry) => ({
      ...entry,
      version: all[entry.package] ?? "—",
      runtime: runtime.has(entry.package),
    }))
    .sort((a, b) => Number(b.runtime) - Number(a.runtime) || (a.package < b.package ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * A stable fingerprint of the loaded card data.
 *
 * FNV-1a over the sorted card ids and their printed stats. The point is that two
 * players reporting the same bug can be shown to be running the same cards —
 * "it does not reproduce" is usually "we are not playing the same game".
 */
export function contentHash(content: ContentIndex): string {
  let hash = 0x811c9dc5;
  const eat = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const id of Object.keys(content.cards).sort()) {
    const card = content.cards[id]!;
    eat(`${id}|${card.cost}|${card.rarity}|${card.text}`);
  }
  eat(JSON.stringify(content.balance.economy));
  return hash.toString(16).padStart(8, "0");
}

export interface Diagnostics {
  dataVersion: string;
  contentHash: string;
  cards: number;
  /** the browser's own description of itself */
  agent: string;
  viewport: string;
  language: string;
  /** the seed of the most recent match, which usually replays the bug */
  lastMatchSeed: number | null;
  matchesPlayed: number;
  generatedAt: string;
}

/**
 * The bug-report attachment §4.6.6 asks for: *"version, device, validated-data
 * hash, last match seed; PII-free, shown to the player before sending"*.
 *
 * Nothing here identifies anybody: no display name, no collection, no save.
 * `agent` and `language` are what the browser tells every website it visits, and
 * they are included because "it only happens in Safari" is the single most
 * useful sentence in a bug report.
 */
export function buildDiagnostics(
  content: ContentIndex,
  facts: { lastMatchSeed: number | null; matchesPlayed: number },
  now = Date.now()
): Diagnostics {
  return {
    dataVersion: DATA_VERSION(),
    contentHash: contentHash(content),
    cards: Object.keys(content.cards).length,
    agent: typeof navigator === "undefined" ? "—" : navigator.userAgent,
    viewport: typeof window === "undefined" ? "—" : `${window.innerWidth}×${window.innerHeight}`,
    language: typeof navigator === "undefined" ? "—" : navigator.language,
    lastMatchSeed: facts.lastMatchSeed,
    matchesPlayed: facts.matchesPlayed,
    generatedAt: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Everything wrong with `data/policies.json`.
 *
 * The load-bearing one is the attribution join: §4.6.5 asks for a licence list
 * *"generated from the dependency manifest"*, and a list that is merely *checked
 * against* it is the same thing with a test attached — which is better, because
 * it fails loudly rather than silently regenerating.
 */
export function checkPoliciesData(): string[] {
  const problems: string[] = [];
  const data = policiesData();

  const packages = new Set(manifestPackages());
  const credited = new Set(data.legal.attributions.map((entry) => entry.package));
  for (const name of packages) {
    if (!credited.has(name)) problems.push(`${name} is a dependency and is not attributed`);
  }
  for (const name of credited) {
    if (!packages.has(name)) problems.push(`${name} is attributed and is not a dependency`);
  }
  for (const entry of data.legal.attributions) {
    if (!entry.license.trim()) problems.push(`${entry.package}: no licence named`);
    if (!entry.use.trim()) problems.push(`${entry.package}: no reason given for depending on it`);
  }

  const ids = new Set<string>();
  for (const document of data.legal.documents) {
    if (ids.has(document.id)) problems.push(`${document.id}: duplicate document`);
    ids.add(document.id);
    if (document.status === "written") {
      if (!document.body?.length) problems.push(`${document.id}: is marked written and has no text`);
      if (!document.version || !document.effectiveDate) problems.push(`${document.id}: is written and undated`);
    } else {
      if (!document.note?.trim()) problems.push(`${document.id}: is not written and does not say why`);
      if (document.body?.length) problems.push(`${document.id}: is marked not-written but carries text`);
    }
  }

  /**
   * A category that says nothing is collected must not also say where it is
   * kept. That combination is how a page ends up claiming both things at once.
   */
  for (const category of data.privacy.categories) {
    if (!category.collected && category.where) {
      problems.push(`${category.name}: says nothing is collected and also says where it is stored`);
    }
    if (category.collected && !category.where) {
      problems.push(`${category.name}: says something is collected and does not say where it lives`);
    }
  }
  if (!Number.isFinite(Date.parse(data.privacy.effectiveDate))) problems.push("privacy: unreadable effective date");

  const faqIds = new Set<string>();
  for (const entry of data.support.faq) {
    if (faqIds.has(entry.id)) problems.push(`${entry.id}: duplicate FAQ entry`);
    faqIds.add(entry.id);
    if (entry.answer.join(" ").length < 40) problems.push(`${entry.id}: the answer says almost nothing`);
  }

  return problems;
}
