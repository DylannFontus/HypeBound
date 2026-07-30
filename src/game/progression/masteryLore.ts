/**
 * The lore the mastery tracks unlock.
 *
 * §4.2 hangs a faction lore page on ranks 1, 7, 13 and 19; §5.2 hangs a leader
 * chapter on levels 2, 4, 6 and 8; §6.2 gives a character a lore page at
 * **Noticed** and the hidden file — *what they actually think of you* — at
 * **Parasocial**. Those are the only mastery rewards this game can actually pay
 * today, which makes this module load-bearing rather than decorative: without it
 * Leader Mastery and the Bias Board would be tracks that grant nothing at all.
 *
 * `data/mastery-lore.txt` uses exactly the format `data/cards/lore.txt` uses, so
 * whoever writes one can write the other without learning anything new. Ids are
 * namespaced — `faction:`, `leader:`, `bias:` — because all three live in one
 * file, and a page number is part of the id so pages arrive in order.
 *
 * An unwritten page is not an error. It reads as "not written yet" on the track,
 * the same honest stand-in the card gallery shows, and `npm run lore` reports
 * both directions: a page nothing unlocks, and an id that names something which
 * does not exist.
 */

import type { ContentIndex } from "../../engine/types";
import { parseLore, writtenBody, type LoreEntry } from "../loreFormat";
import { selectableLeaders } from "../../engine/content";
import { affinityConfig, factionMasteryConfig, leaderMasteryConfig } from "./data";
import source from "../../../data/mastery-lore.txt?raw";

export type LoreKind = "faction" | "leader" | "bias";

export interface MasteryLore {
  title: string;
  body: string[];
  quote: string | null;
  /** false when this is the stand-in rather than something somebody wrote */
  written: boolean;
}

const PLACEHOLDER = "This page has not been written yet.";

let entries: Map<string, LoreEntry> | null = null;
const all = (): Map<string, LoreEntry> => (entries ??= parseLore(source));

/** The id a lore page is stored under. */
export const loreKey = (kind: LoreKind, id: string, page: number): string => `${kind}:${id}:${page}`;

/**
 * One lore page.
 *
 * `fallbackTitle` is what the heading reads when the block has no `TITLE:` — the
 * faction's or character's own name, supplied by the caller because this module
 * has no content index and does not want one.
 */
export function masteryLore(kind: LoreKind, id: string, page: number, fallbackTitle: string): MasteryLore {
  const entry = all().get(loreKey(kind, id, page));
  const body = writtenBody(entry);
  return {
    title: entry?.title ?? fallbackTitle,
    body: body.length > 0 ? body : [PLACEHOLDER],
    quote: entry?.quote ?? null,
    written: body.length > 0,
  };
}

/** Every id the file mentions, for the check below. */
export const masteryLoreIds = (): string[] => [...all().keys()];

/** Which pages a track actually unlocks, as `loreKey` strings. */
function expectedLoreKeys(content: ContentIndex): string[] {
  const keys: string[] = [];
  const pagesOf = (rewards: { kind: string; page?: number }[]): number[] =>
    rewards.flatMap((reward) => (reward.kind === "lore" && reward.page ? [reward.page] : []));

  const factionPages = Object.values(factionMasteryConfig().rewards).flatMap(pagesOf);
  for (const faction of Object.values(content.factions)) {
    if (faction.id === "neutral") continue;
    for (const page of factionPages) keys.push(loreKey("faction", faction.id, page));
  }

  const leaderPages = Object.values(leaderMasteryConfig().rewards).flatMap(pagesOf);
  for (const leader of selectableLeaders(content)) {
    for (const page of leaderPages) keys.push(loreKey("leader", leader.id, page));
  }

  /**
   * Bias pages are deliberately **not** expected for every character.
   *
   * There are hundreds of collectible characters and §6.2's tier-1 page is the
   * kind of thing you write for the ones people actually get attached to. So the
   * file is allowed to be sparse here, and the check below only insists that a
   * `bias:` block names a character that exists.
   */
  return keys;
}

/**
 * Everything wrong with the lore file, checked against real content.
 *
 * Two directions, as usual: a block naming something that does not exist, and a
 * page a track promises that nobody has written. The second is a warning rather
 * than a failure — prose arrives after the system that displays it — so it is
 * returned separately and the test asserts only the first.
 */
export function checkMasteryLore(content: ContentIndex): { unknown: string[]; unwritten: string[] } {
  const unknown: string[] = [];
  const leaderIds = new Set(selectableLeaders(content).map((leader) => leader.id));
  const tierPages = new Set(affinityConfig().tiers.flatMap((tier) => tier.rewards.flatMap((r) => (r.kind === "lore" ? [r.page] : []))));

  for (const key of masteryLoreIds()) {
    const [kind, id, rawPage] = key.split(":");
    const page = Number(rawPage);
    if (!kind || !id || !Number.isInteger(page) || page < 1) {
      unknown.push(`${key}: not a "kind:id:page" block`);
      continue;
    }
    if (kind === "faction") {
      if (!content.factions[id as keyof typeof content.factions] || id === "neutral") {
        unknown.push(`${key}: no such faction`);
      }
    } else if (kind === "leader") {
      if (!leaderIds.has(id)) unknown.push(`${key}: not a selectable leader`);
    } else if (kind === "bias") {
      const card = content.cards[id];
      if (!card) unknown.push(`${key}: no such card`);
      else if (card.type !== "character") unknown.push(`${key}: ${id} is a ${card.type}, not a character`);
      else if (!tierPages.has(page)) unknown.push(`${key}: no affinity tier unlocks page ${page}`);
    } else {
      unknown.push(`${key}: unknown kind "${kind}"`);
    }
  }

  const have = new Set(masteryLoreIds().filter((key) => writtenBody(all().get(key)).length > 0));
  const unwritten = expectedLoreKeys(content).filter((key) => !have.has(key));
  return { unknown, unwritten };
}
