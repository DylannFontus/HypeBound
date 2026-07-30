/**
 * Loading the hand-made assets that are not card art.
 *
 * The logo, the icons and the board backdrops. Same shape as `artLoader.ts` and
 * for the same reason: **nothing here may block anything**. A load is started
 * the first time something asks, the caller gets `null` until it finishes, and
 * a listener fires so whatever cached a drawing can throw it away and draw
 * again. A missing file is a permanent, silent `null`, which every caller is
 * required to have an answer for — the procedural icon, or the flat backdrop
 * the game has always used.
 *
 * Kept separate from `artLoader.ts` rather than generalising it. Card art is
 * keyed by card id and has a verifier, a coverage report and 296 files behind
 * it; folding a second concept into that module would mean the next change to
 * either has to think about both. They share a shape, not a job.
 *
 * ## Extensions are tried in order, and the order is the point
 *
 * Board backdrops are authored as 4K PNG masters and shipped as WebP, because a
 * 4K PNG is 8–15 MB and the WebP is under a megabyte for the same picture
 * behind fog. Asking for WebP first means dropping the master in the folder
 * works, and dropping the WebP next to it silently upgrades to the small one.
 */

type AssetState = "loading" | "loaded" | "missing";

const images = new Map<string, HTMLImageElement>();
const states = new Map<string, AssetState>();
const listeners = new Set<(base: string) => void>();

/** Notified whenever an asset finishes loading, with the base path that arrived. */
export function onAssetLoaded(listener: (base: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tryLoad(base: string, extensions: readonly string[], index = 0): void {
  if (index >= extensions.length) {
    states.set(base, "missing");
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    images.set(base, image);
    states.set(base, "loaded");
    for (const listener of listeners) listener(base);
  };
  image.onerror = () => tryLoad(base, extensions, index + 1);
  image.src = `${base}.${extensions[index]}`;
}

/**
 * The loaded image for an asset, or null.
 *
 * Null means "not yet" or "never", and callers must not distinguish: both mean
 * *draw the fallback*. A caller that treated null as an error would turn a
 * half-finished art pass into a broken screen.
 */
export function getAsset(base: string, extensions: readonly string[] = ["png"]): HTMLImageElement | null {
  if (typeof Image === "undefined") return null; // node, and the test environment
  const state = states.get(base);
  if (state === undefined) {
    states.set(base, "loading");
    tryLoad(base, extensions);
    return null;
  }
  return state === "loaded" ? (images.get(base) ?? null) : null;
}

/** Start loading without wanting the result yet. */
export function preloadAssets(bases: readonly string[], extensions: readonly string[] = ["png"]): void {
  for (const base of bases) getAsset(base, extensions);
}

/** Has this asset arrived? Distinct from `getAsset` returning null while loading. */
export function assetLoaded(base: string): boolean {
  return states.get(base) === "loaded";
}

/**
 * Resolve once, whether it arrives or not.
 *
 * For the callers that genuinely need to wait — the board backdrop, which would
 * otherwise pop in a second into the match. Resolves `null` for a missing file
 * rather than rejecting, because "there is no backdrop for this faction" is an
 * ordinary state and not an error to handle.
 */
export function awaitAsset(base: string, extensions: readonly string[] = ["png"]): Promise<HTMLImageElement | null> {
  const immediate = getAsset(base, extensions);
  if (immediate) return Promise.resolve(immediate);
  if (states.get(base) === "missing") return Promise.resolve(null);

  return new Promise((resolve) => {
    const off = onAssetLoaded((arrived) => {
      if (arrived !== base) return;
      off();
      resolve(images.get(base) ?? null);
    });
    /**
     * A file that will never arrive fires no event, so the wait has to end by
     * itself. Two seconds is well past a local read and a cached fetch, and the
     * cost of being wrong is only that the backdrop fades in late rather than
     * being there at the start.
     */
    setTimeout(() => {
      off();
      resolve(images.get(base) ?? null);
    }, 2000);
  });
}

/** Test seam: forget everything, so a fixture starts from nothing. */
export function resetAssetCache(): void {
  images.clear();
  states.clear();
}
