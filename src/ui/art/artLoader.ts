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
 *
 * ## WebP is asked for first, and that is the whole fix for a 122 MB folder
 *
 * The masters are PNG and stay PNG: `public/assets/art/<id>.png` is 512x680,
 * hand-painted, and the source of truth. But a 512x680 PNG averages 423 KB and
 * the same picture as WebP averages 31 KB, so a build that shipped the masters
 * shipped 122 MB of card art and the deployed page looked, to the owner, as
 * though the art had never wired up at all. Every wiring check passed. The
 * pictures were simply arriving long after anyone was still looking.
 *
 * `scripts/encode-assets.mjs` produces the WebP at build time and `dist` gets
 * that instead of the master, so putting WebP ahead of PNG here is what makes
 * the light file the one requested. PNG stays in the list behind it and is not
 * a formality: it is what a freshly dropped painting resolves to in dev before
 * anything has encoded it, and it is what would keep the game working if the
 * encode step were ever removed.
 *
 * The order is the same in dev and in production **on purpose**. The obvious
 * shortcut — `import.meta.env.PROD ? webpFirst : pngFirst` — would mean
 * `verify:art`, which loads every card through a real browser against the dev
 * server precisely so it sees what is served, could never once look at the
 * format the player receives. This project's status document lists thirteen
 * instruments that returned a confident wrong answer; several were measuring a
 * build nobody ships. Instead the dev server encodes on demand
 * (`vite.config.ts::lightAssets`), so dev and production request the same file.
 */

import type { CardDef } from "../../engine/types";

const EXTENSIONS = ["webp", "png", "jpg"];
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
