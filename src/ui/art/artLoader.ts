/**
 * Card art loading.
 *
 * The owner drops images at public/assets/art/<card-id>.png (or .jpg/.webp).
 * Until one exists the renderer falls back to procedural placeholder art, so
 * the game is fully playable and good-looking with zero art assets present.
 *
 * Loading is fire-and-forget: the first render uses the placeholder, and when
 * the real image arrives the card's cached textures are invalidated so it
 * re-renders with the art. Nothing blocks on the network.
 */

import type { CardDef } from "../../engine/types";

const EXTENSIONS = ["png", "webp", "jpg"];
const ART_BASE = "assets/art";

type ArtState = "missing" | "loading" | "loaded";

const images = new Map<string, HTMLImageElement>();
const states = new Map<string, ArtState>();
const listeners = new Set<(cardId: string) => void>();

/** Notified whenever a card's art finishes loading. */
export function onArtLoaded(listener: (cardId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function artKey(card: CardDef): string {
  return card.art ?? card.id;
}

function tryLoad(key: string, cardId: string, extensionIndex = 0): void {
  if (extensionIndex >= EXTENSIONS.length) {
    states.set(key, "missing");
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    images.set(key, image);
    states.set(key, "loaded");
    for (const listener of listeners) listener(cardId);
  };
  image.onerror = () => tryLoad(key, cardId, extensionIndex + 1);
  image.src = `${ART_BASE}/${key}.${EXTENSIONS[extensionIndex]}`;
}

/**
 * The loaded art for a card, or null when none exists yet.
 * Kicks off a background load the first time a card is asked about.
 */
export function getCardArt(card: CardDef): HTMLImageElement | null {
  if (typeof Image === "undefined") return null; // node/test environment
  const key = artKey(card);
  const state = states.get(key);

  if (state === undefined) {
    states.set(key, "loading");
    tryLoad(key, card.id);
    return null;
  }
  return state === "loaded" ? images.get(key) ?? null : null;
}

/** Warm the cache for a set of cards (called when entering a screen). */
export function preloadArt(cards: CardDef[]): void {
  for (const card of cards) getCardArt(card);
}

/** How many of the given cards currently have real art — shown in the art tools. */
export function artCoverage(cards: CardDef[]): { loaded: number; total: number } {
  let loaded = 0;
  for (const card of cards) {
    if (states.get(artKey(card)) === "loaded") loaded++;
  }
  return { loaded, total: cards.length };
}
