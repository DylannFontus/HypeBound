/**
 * Card lore — the Story tab in the gallery's card detail.
 *
 * `data/cards/lore.txt` is written by hand and is meant to be edited by
 * somebody who has never opened this project, so the format follows the same
 * rules the story scripts do: plain text, nothing to close or escape, comments
 * with `#`, and no way to break the game. A card with no block gets a
 * placeholder; a block naming an id that does not exist is dropped and reported
 * by the test rather than thrown at a player.
 *
 * The quote falls back to the card's printed `flavor`, which already exists for
 * every card — so the file only has to carry the prose somebody actually wants
 * to write, and an untouched file still shows something worth reading.
 *
 * The format itself lives in `loreFormat.ts`, because the mastery tracks unlock
 * lore too and one parser is one set of rules to learn.
 */

import type { CardDef } from "../engine/types";
import { parseLore, writtenBody, type LoreEntry } from "./loreFormat";
import source from "../../data/cards/lore.txt?raw";

export interface CardLore {
  /** heading above the prose; the card's name unless `TITLE:` overrides it */
  title: string;
  /** paragraphs, already split — empty when nobody has written any yet */
  body: string[];
  /** the italic line at the bottom, or null when the card has no flavour either */
  quote: string | null;
  /** false when this is the stand-in rather than something somebody wrote */
  written: boolean;
}

const PLACEHOLDER = "No lore written for this card yet.";

/** Parsed once; the file is a build-time import, so it cannot change under us. */
let entries: Map<string, LoreEntry> | null = null;

function all(): Map<string, LoreEntry> {
  if (!entries) entries = parseLore(source);
  return entries;
}

/** Every id the lore file mentions, for the test that checks they are real. */
export function loreIds(): string[] {
  return [...all().keys()];
}

export function loreFor(card: CardDef): CardLore {
  const entry = all().get(card.id);
  const body = writtenBody(entry);
  return {
    title: entry?.title ?? card.name,
    body: body.length > 0 ? body : [PLACEHOLDER],
    quote: entry?.quote ?? card.flavor ?? null,
    written: body.length > 0,
  };
}
