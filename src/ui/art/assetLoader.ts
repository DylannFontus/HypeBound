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
 *
 * ## The default is WebP-first too, and it used to be PNG-only
 *
 * Boards passed `BOARD_EXTENSIONS` explicitly and got the light file; the icons
 * and the brand marks took the default and got the master. Forty 512x512 icons
 * at 224 KB each and a 2048x2048 monogram is 9.7 MB of PNG for pictures that
 * are 2.4 MB as WebP — and the monogram in particular is fetched during the
 * opening sting, which is the least forgiving moment in the whole game to be
 * downloading a megabyte.
 *
 * That was not a decision anyone made. It was a default nobody revisited when
 * `BOARD_EXTENSIONS` was introduced, which is why the constant reads as the
 * exception rather than as the rule it always should have been. Both are the
 * same list now; `BOARD_EXTENSIONS` survives as documentation at its call sites
 * of *why* a board is allowed to be a master.
 *
 * `scripts/encode-assets.mjs` emits the WebP at build time and `vite.config.ts`
 * leaves the master out of `dist`. In dev the master is still there and still
 * served, so a caller that asks for something the encoder does not cover falls
 * through to it exactly as before.
 */

type AssetState = "loading" | "loaded" | "missing";

/**
 * What every caller gets unless it says otherwise: the light encode, then the
 * master it was made from. `jpg` is not here — nothing in the declared asset
 * set is a JPEG, and a third extension is a third failed request for every
 * asset that genuinely has no file.
 */
const DEFAULT_EXTENSIONS = ["webp", "png"] as const;

const images = new Map<string, HTMLImageElement>();
const states = new Map<string, AssetState>();
const listeners = new Set<(base: string) => void>();

/**
 * Callers of `awaitAsset` waiting on a base path, settled on **either**
 * outcome.
 *
 * The first version only notified on success and gave `awaitAsset` a two-second
 * backstop for the rest. That is wrong in the common case rather than the rare
 * one: a board whose faction has no art yet fails both extensions in about a
 * millisecond and then made the caller wait the full two seconds to be told so.
 * The board arrived two and a half seconds into the match, which looked like a
 * slow network and was actually a timer.
 */
const waiters = new Map<string, Array<(image: HTMLImageElement | null) => void>>();

function settle(base: string, image: HTMLImageElement | null): void {
  const pending = waiters.get(base);
  if (!pending) return;
  waiters.delete(base);
  for (const resolve of pending) resolve(image);
}

/** Notified whenever an asset finishes loading, with the base path that arrived. */
export function onAssetLoaded(listener: (base: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A caller naming extensions is expressing a **preference, not a restriction**.
 *
 * This matters because of one call site in a file this change does not own:
 * `cardRenderer/icons.ts` asks `scaledAsset(path, size)` for the Currents,
 * crests and Confluence emblems it paints onto every card, and `scaledAsset`'s
 * own default is `["png"]`. In `dist` the icon PNGs no longer exist — the WebP
 * carries the same picture at a fifth of the weight — so a PNG-only request
 * would find nothing, mark the base permanently `"missing"`, and every later
 * ask through the correct list would be answered from that cached verdict
 * without ever issuing a request. The emblem would fall back to its procedural
 * drawing on every card, on the deployed build only, with no error anywhere.
 *
 * Today `installIconStyles()` warms all three of those groups at boot, so the
 * base is already `"loaded"` before the renderer asks and the narrow list is
 * never reached. That is an ordering, not a guarantee, and the failure it is
 * holding back is silent. Widening here costs one extra failed request for an
 * asset that genuinely has no file, and nothing at all for one that does.
 */
function widen(extensions: readonly string[]): readonly string[] {
  const seen = new Set(extensions);
  return [...extensions, ...DEFAULT_EXTENSIONS.filter((ext) => !seen.has(ext))];
}

function tryLoad(base: string, requested: readonly string[], index = 0): void {
  const extensions = index === 0 ? widen(requested) : requested;
  if (index >= extensions.length) {
    states.set(base, "missing");
    settle(base, null);
    return;
  }
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    images.set(base, image);
    states.set(base, "loaded");
    settle(base, image);
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
export function getAsset(base: string, extensions: readonly string[] = DEFAULT_EXTENSIONS): HTMLImageElement | null {
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
export function preloadAssets(bases: readonly string[], extensions: readonly string[] = DEFAULT_EXTENSIONS): void {
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
export function awaitAsset(base: string, extensions: readonly string[] = DEFAULT_EXTENSIONS): Promise<HTMLImageElement | null> {
  const immediate = getAsset(base, extensions);
  if (immediate) return Promise.resolve(immediate);
  if (states.get(base) === "missing") return Promise.resolve(null);

  /**
   * No timeout. `tryLoad` settles on success *and* on running out of
   * extensions, so both outcomes arrive as fast as the browser can report them
   * and there is no arbitrary duration to be wrong about. `getAsset` above has
   * already started the load, so registering here cannot miss it — this all
   * runs on one thread and the callbacks are asynchronous.
   */
  return new Promise((resolve) => {
    const pending = waiters.get(base) ?? [];
    pending.push(resolve);
    waiters.set(base, pending);
  });
}

/** Test seam: forget everything, so a fixture starts from nothing. */
export function resetAssetCache(): void {
  images.clear();
  states.clear();
  for (const [base] of waiters) settle(base, null);
}
