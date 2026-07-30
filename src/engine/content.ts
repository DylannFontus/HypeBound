/**
 * Loads and validates every data/*.json file into a ContentIndex.
 *
 * Card files under data/cards/ are auto-discovered with import.meta.glob, so
 * adding a new faction file requires no code change. The loader is injectable
 * (buildContent) so tests can construct fixture content without touching disk.
 */

import type {
  BalanceConfig,
  CardDef,
  CardPatch,
  ConfluenceDef,
  ConfluenceId,
  ContentIndex,
  CurrentDef,
  CurrentId,
  FactionDef,
  FactionId,
  KeywordDef,
  KeywordId,
  LeaderCardDef,
  StatusDef,
  StatusId,
} from "./types";
import {
  crossValidate,
  zBalanceConfig,
  zCardArray,
  zCardDef,
  zConfluenceDef,
  zCurrentDef,
  zFactionDef,
  zKeywordDef,
  zStatusDef,
} from "./validation";

import currentsRaw from "../../data/currents.json";
import factionsRaw from "../../data/factions.json";
import confluencesRaw from "../../data/confluences.json";
import statusesRaw from "../../data/statuses.json";
import keywordsRaw from "../../data/keywords.json";
import balanceRaw from "../../data/balance.json";

export class ContentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Content validation failed:\n  - ${problems.join("\n  - ")}`);
    this.name = "ContentError";
  }
}

/** All card files under data/cards/, keyed by module path. */
function loadCardModules(): Record<string, unknown> {
  // eager glob: bundled by Vite, also works under Vitest's Vite pipeline
  return import.meta.glob("../../data/cards/*.json", { eager: true, import: "default" });
}

function parseRecord<T>(
  raw: unknown,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: (string | number)[]; message: string }[] } } },
  label: string,
  problems: string[]
): Record<string, T> {
  const out: Record<string, T> = {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error?.issues ?? []) {
        problems.push(`${label}.${key}: ${issue.path.join(".")} ${issue.message}`);
      }
      continue;
    }
    out[key] = result.data as T;
  }
  return out;
}

export interface BuildContentInput {
  cardArrays: CardDef[][];
  currents: unknown;
  factions: unknown;
  confluences: unknown;
  statuses: unknown;
  keywords: unknown;
  balance: unknown;
}

/** Validate raw data into a ContentIndex. Throws ContentError on any problem. */
export function buildContent(input: BuildContentInput): ContentIndex {
  const problems: string[] = [];

  const currents = parseRecord<CurrentDef>(input.currents, zCurrentDef, "currents", problems) as Record<CurrentId, CurrentDef>;
  const factions = parseRecord<FactionDef>(input.factions, zFactionDef, "factions", problems) as Record<FactionId, FactionDef>;
  const confluences = parseRecord<ConfluenceDef>(input.confluences, zConfluenceDef, "confluences", problems) as Record<ConfluenceId, ConfluenceDef>;
  const statuses = parseRecord<StatusDef>(input.statuses, zStatusDef, "statuses", problems) as Record<StatusId, StatusDef>;
  const keywords = parseRecord<KeywordDef>(input.keywords, zKeywordDef, "keywords", problems) as Record<KeywordId, KeywordDef>;

  const balanceResult = zBalanceConfig.safeParse(input.balance);
  if (!balanceResult.success) {
    for (const issue of balanceResult.error.issues) problems.push(`balance: ${issue.path.join(".")} ${issue.message}`);
  }
  const balance = (balanceResult.success ? balanceResult.data : {}) as BalanceConfig;

  const cards: Record<string, CardDef> = {};
  const leaders: Record<string, LeaderCardDef> = {};
  for (const arr of input.cardArrays) {
    const result = zCardArray.safeParse(arr);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const index = issue.path[0];
        const card = typeof index === "number" ? (arr[index] as CardDef | undefined) : undefined;
        problems.push(`card ${card?.id ?? `#${String(index)}`}: ${issue.path.slice(1).join(".")} ${issue.message}`);
      }
      continue;
    }
    for (const card of result.data as CardDef[]) {
      if (cards[card.id]) problems.push(`duplicate card id: ${card.id}`);
      cards[card.id] = card;
      if (card.type === "leader") leaders[card.id] = card as LeaderCardDef;
    }
  }

  const content: ContentIndex = { cards, leaders, currents, factions, confluences, statuses, keywords, balance };

  if (problems.length === 0) problems.push(...crossValidate(content));
  if (problems.length > 0) throw new ContentError(problems);
  return content;
}

let cached: ContentIndex | null = null;

/** The live game content, loaded from data/ and validated once. */
export function getContent(): ContentIndex {
  if (cached) return cached;
  const modules = loadCardModules();
  const cardArrays = Object.entries(modules)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // stable order => deterministic ids
    .map(([, value]) => value as CardDef[]);
  cached = buildContent({
    cardArrays,
    currents: currentsRaw,
    factions: factionsRaw,
    confluences: confluencesRaw,
    statuses: statusesRaw,
    keywords: keywordsRaw,
    balance: balanceRaw,
  });
  return cached;
}

/** Test hook: replace the cached content (pass null to reload from disk). */
export function setContent(content: ContentIndex | null): void {
  cached = content;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getCard(content: ContentIndex, cardId: string): CardDef {
  const card = content.cards[cardId];
  if (!card) throw new Error(`Unknown card id: ${cardId}`);
  return card;
}

export function getLeader(content: ContentIndex, cardId: string): LeaderCardDef {
  const leader = content.leaders[cardId];
  if (!leader) throw new Error(`Unknown leader card id: ${cardId}`);
  return leader;
}

/**
 * Apply a match's `balanceOverrides` to a content index.
 *
 * Boss fights and weekly modifiers bend the numbers — a shorter hand limit, a
 * higher Hype cap, cheaper Fixations — and the field for it has existed in
 * `MatchConfig` since the beginning while being read nowhere, so every override
 * silently did nothing.
 *
 * Keys are dotted paths into BalanceConfig ("hype.cap", "draw.perTurn"). The
 * result is re-validated, so a typo'd path or an out-of-range value fails loudly
 * at match start instead of producing a subtly wrong game. Returns the original
 * index untouched when there are no overrides, so normal play allocates nothing.
 *
 * Note this is NOT how a boss gets extra health: leader health comes from the
 * leader card, so that is a `leaderHealth` setup op on the scenario.
 */
export function resolveMatchContent(
  content: ContentIndex,
  overrides?: Record<string, number>,
  cardOverrides?: Record<string, CardPatch>,
  cardVariants?: Record<string, string>
): ContentIndex {
  // variants first: a patch aimed at one has to find a card to patch
  const withVariants = applyCardVariants(content, cardVariants);
  const withCards = applyCardOverrides(withVariants, cardOverrides);
  return applyBalanceOverrides(withCards, overrides);
}

/**
 * Clone cards under new ids, so one copy of a card can differ from another.
 *
 * Deliberately does nothing but clone and re-label. Everything that makes a
 * variant *different* — the stat change, the clamping, the refusal of a patch
 * that cannot apply, the re-validation — is left to `applyCardOverrides`, which
 * already does all of it correctly. Two ways to bend a card would eventually
 * disagree about what "cost −1 on a 0-cost card" means.
 */
function applyCardVariants(content: ContentIndex, variants?: Record<string, string>): ContentIndex {
  if (!variants || Object.keys(variants).length === 0) return content;

  const cards = { ...content.cards };
  const problems: string[] = [];

  for (const [variantId, baseId] of Object.entries(variants)) {
    const base = content.cards[baseId];
    if (!base) {
      problems.push(`cardVariants: unknown base card "${baseId}"`);
      continue;
    }
    if (content.cards[variantId]) {
      problems.push(`cardVariants: "${variantId}" is already a real card, so cloning onto it would shadow it`);
      continue;
    }
    if (base.variantOf) {
      // a variant of a variant would make the chain's meaning depend on the
      // order the record happened to be iterated in
      problems.push(`cardVariants: "${baseId}" is itself a variant`);
      continue;
    }
    if (base.type === "leader") {
      // nothing needs one, and a leader variant would have to be threaded
      // through the leaders index, selection and rendering to mean anything
      problems.push(`cardVariants: "${baseId}" is a leader; leader variants are not supported`);
      continue;
    }
    cards[variantId] = { ...structuredClone(base), id: variantId, variantOf: baseId };
  }

  if (problems.length > 0) throw new ContentError(problems);
  return { ...content, cards };
}

function applyBalanceOverrides(content: ContentIndex, overrides?: Record<string, number>): ContentIndex {
  if (!overrides || Object.keys(overrides).length === 0) return content;

  const balance = structuredClone(content.balance) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split(".");
    let node = balance;
    for (const key of keys.slice(0, -1)) {
      const next = node[key];
      if (typeof next !== "object" || next === null) {
        throw new ContentError([`balanceOverrides: "${path}" is not a path into balance.json`]);
      }
      node = next as Record<string, unknown>;
    }
    const leaf = keys[keys.length - 1]!;
    if (!(leaf in node)) {
      throw new ContentError([`balanceOverrides: "${path}" is not a path into balance.json`]);
    }
    node[leaf] = value;
  }

  const parsed = zBalanceConfig.safeParse(balance);
  if (!parsed.success) {
    throw new ContentError(parsed.error.issues.map((i) => `balanceOverrides: ${i.path.join(".")} ${i.message}`));
  }
  return { ...content, balance: parsed.data as BalanceConfig };
}

/**
 * Apply per-card patches to a content index.
 *
 * Only the patched cards are cloned — the rest of the index is shared, so a
 * match with one bent leader does not copy 237 card definitions.
 *
 * The result is re-validated against the card schema. That matters more here
 * than for balance overrides: a patch is written by a run, a boss or an artifact
 * rather than by a human editing a file, so "cost −1 on a 0-cost card" and
 * "health −3 on a 2-health character" are things that will genuinely happen.
 * Clamping handles the ordinary cases (the design says "cost −1, minimum 0")
 * and validation catches whatever clamping did not anticipate, loudly, at match
 * start rather than as a subtly wrong game.
 */
function applyCardOverrides(content: ContentIndex, patches?: Record<string, CardPatch>): ContentIndex {
  if (!patches || Object.keys(patches).length === 0) return content;

  const cards = { ...content.cards };
  const leaders = { ...content.leaders };
  const problems: string[] = [];

  for (const [cardId, patch] of Object.entries(patches)) {
    const base = content.cards[cardId];
    if (!base) {
      problems.push(`cardOverrides: unknown card "${cardId}"`);
      continue;
    }
    const card: CardDef = structuredClone(base);

    if (patch.cost !== undefined) card.cost = clamp(card.cost + patch.cost, 0, 12);

    // A stat patch aimed at a card with no such stat is refused rather than
    // dropped: "+1/+1 on an Action" is a mistake in whatever produced the patch,
    // and silently ignoring it is how an upgrade ships doing nothing.
    if (patch.attack !== undefined) {
      if (card.type !== "character") {
        problems.push(`cardOverrides: "${cardId}" is a ${card.type} and has no attack`);
        continue;
      }
      card.attack = Math.max(0, card.attack + patch.attack);
    }
    if (patch.health !== undefined) {
      if (card.type !== "character" && card.type !== "leader") {
        problems.push(`cardOverrides: "${cardId}" is a ${card.type} and has no health`);
        continue;
      }
      card.health = Math.max(1, card.health + patch.health);
    }
    if (patch.keywords?.length) {
      card.keywords = [...new Set([...card.keywords, ...patch.keywords])];
    }
    if (patch.textSuffix) {
      card.text = card.text ? `${card.text} ${patch.textSuffix}` : patch.textSuffix;
    }

    if (card.type === "leader") {
      const leader = card as unknown as LeaderCardDef;
      if (patch.passive?.length) leader.passive = [...leader.passive, ...structuredClone(patch.passive)];
      if (patch.fixationCost !== undefined) {
        leader.fixation = { ...leader.fixation, obsessionCost: Math.max(0, leader.fixation.obsessionCost + patch.fixationCost) };
      }
      if (patch.ultimateCost !== undefined) {
        leader.ultimate = { ...leader.ultimate, obsessionCost: Math.max(0, leader.ultimate.obsessionCost + patch.ultimateCost) };
      }
    } else if (patch.passive || patch.fixationCost !== undefined || patch.ultimateCost !== undefined) {
      problems.push(`cardOverrides: "${cardId}" is not a leader, so passive/fixationCost/ultimateCost do not apply`);
      continue;
    }

    const parsed = zCardDef.safeParse(card);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`cardOverrides: patched "${cardId}" is invalid — ${issue.path.join(".")} ${issue.message}`);
      }
      continue;
    }
    const patched = parsed.data as CardDef;
    cards[cardId] = patched;
    if (patched.type === "leader") leaders[cardId] = patched as LeaderCardDef;
  }

  if (problems.length > 0) throw new ContentError(problems);
  return { ...content, cards, leaders };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Combine several patches aimed at the same card into one.
 *
 * Deltas add, lists concatenate. This is only sound because CardPatch numbers
 * are deltas rather than replacements: with absolute values, "cost 2" and
 * "cost 1" would have no correct combination and the answer would depend on
 * which artifact the player happened to pick up first.
 */
export function mergeCardPatches(patches: readonly CardPatch[]): CardPatch {
  const out: CardPatch = {};
  const add = (key: "cost" | "attack" | "health" | "fixationCost" | "ultimateCost", value?: number): void => {
    if (value === undefined) return;
    out[key] = (out[key] ?? 0) + value;
  };
  for (const patch of patches) {
    add("cost", patch.cost);
    add("attack", patch.attack);
    add("health", patch.health);
    add("fixationCost", patch.fixationCost);
    add("ultimateCost", patch.ultimateCost);
    if (patch.keywords?.length) out.keywords = [...(out.keywords ?? []), ...patch.keywords];
    if (patch.passive?.length) out.passive = [...(out.passive ?? []), ...patch.passive];
    if (patch.textSuffix) out.textSuffix = out.textSuffix ? `${out.textSuffix} ${patch.textSuffix}` : patch.textSuffix;
  }
  return out;
}

/** Cards legal to include in decks (excludes tokens, leaders and variants). */
export function collectibleCards(content: ContentIndex): CardDef[] {
  return Object.values(content.cards).filter((c) => !c.token && c.type !== "leader" && !c.variantOf);
}

/**
 * Leaders a player may actually choose.
 *
 * `content.leaders` is the full index and includes scripted-encounter leaders —
 * the tutorial's opponent bot and its teaching leader, boss leaders, and so on.
 * Those are marked `token: true`, the same flag that keeps summon-only cards out
 * of the collection, and must never appear in the deck builder's leader picker
 * or be drawn as a random AI opponent.
 */
export function selectableLeaders(content: ContentIndex): LeaderCardDef[] {
  return Object.values(content.leaders).filter((leader) => !leader.token);
}
