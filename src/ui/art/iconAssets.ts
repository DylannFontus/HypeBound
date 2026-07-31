/**
 * Where the icons live, and how the ones in HTML get used.
 *
 * Paths come from `data/asset-manifest.json`, the same file
 * `scripts/verify-art.mjs` reads. One list, so a file the verifier calls
 * undeclared is a file this module would never have asked for either.
 *
 * ## Two different jobs, two different mechanisms
 *
 * **Icons drawn on the card canvas** — Currents, faction crests, Confluences —
 * are fetched with `getAsset` by the renderer and drawn if present. That is a
 * per-draw decision and it belongs where the drawing happens.
 *
 * **Icons that appear in HTML** — the four currencies and the interface set —
 * are different. They are built into `innerHTML` strings on a dozen screens, so
 * there is no single place to make the decision and no re-render to trigger
 * when a file finishes loading. So this module probes them once at boot and,
 * for each one that arrives, sets a custom property and a class on the root
 * element. CSS does the rest, and the markup does not change at all.
 *
 * The glyph stays in the markup as the text of the span (`◈`, `✦`, `✧`, `◊`).
 * When an image is available the rule sets `color: transparent`, so the glyph
 * keeps holding its space and the picture sits on top. When it is not, the
 * glyph is simply what you see — which is exactly the game as it shipped.
 *
 * ## The URL comes from the browser, not from a string
 *
 * `vite.config.ts` sets `base: "./"`, so everything is served relative and this
 * game can live under a path (`/HypeBound/` on GitHub Pages) as easily as at a
 * root. A `url()` written into the stylesheet would resolve against the
 * stylesheet's own location and break under that base. Reading `image.src`
 * after the load gives the absolute URL the browser actually resolved, which is
 * correct in both cases and needs no configuration to agree with.
 */

import manifest from "../../../data/asset-manifest.json";
import { getAsset, onAssetLoaded, preloadAssets } from "./assetLoader";

const ICONS = manifest.icons as { dir: string; groups: Record<string, string[]> };
const BOARDS = manifest.boards as { dir: string; assets: string[] };
const BRAND = manifest.brand as { dir: string; assets: { id: string }[] };

export type IconGroup = keyof typeof ICONS.groups & string;

/** `assets/icons/currency/clout` — no extension; the loader adds it. */
export function iconPath(group: string, id: string): string {
  return `${ICONS.dir}/${group}/${id}`;
}

export function iconIds(group: string): readonly string[] {
  return ICONS.groups[group] ?? [];
}

/**
 * `assets/boards/neon-idols`.
 *
 * WebP first — see `assetLoader`. The 4K PNG master works if it is the only
 * thing there, and is silently superseded the moment a WebP appears beside it.
 */
export const BOARD_EXTENSIONS = ["webp", "png"] as const;

export function boardPath(id: string): string {
  return `${BOARDS.dir}/${id}`;
}

export function boardIds(): readonly string[] {
  return BOARDS.assets;
}

export function brandPath(id: string): string {
  return `${BRAND.dir}/${id}`;
}

/**
 * The groups whose icons live in HTML rather than on a canvas.
 *
 * Deliberately not every group. Probing all 40 at boot would start 40 requests
 * for pictures most screens never show; these two are the ones the lobby puts
 * on screen immediately.
 */
const HTML_ICON_GROUPS = ["currency", "ui"] as const;

/** `has-icon-currency-clout` — the class CSS keys off. */
export const iconClass = (group: string, id: string): string => `has-icon-${group}-${id}`;
/** `--icon-currency-clout` — the property holding the resolved url. */
export const iconVar = (group: string, id: string): string => `--icon-${group}-${id}`;

let installed = false;

/**
 * Probe the HTML icons and expose the ones that exist to CSS.
 *
 * Safe to call before any of the files exist: every one that fails to load
 * simply never gets its class, and the glyph in the markup stays visible. Safe
 * to call once only — a second call would re-probe images the loader has
 * already cached, which is harmless but pointless.
 *
 * Nothing here blocks. Icons appear when they appear; the lobby does not wait.
 */
export function installIconStyles(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const apply = (group: string, id: string): void => {
    const image = getAsset(iconPath(group, id));
    if (!image) return;
    document.documentElement.style.setProperty(iconVar(group, id), `url("${image.src}")`);
    document.documentElement.classList.add(iconClass(group, id));
  };

  // Anything already cached, plus anything that arrives later.
  const off = onAssetLoaded((base) => {
    for (const group of HTML_ICON_GROUPS) {
      for (const id of iconIds(group)) {
        if (base === iconPath(group, id)) apply(group, id);
      }
    }
  });
  void off; // kept for the lifetime of the page, deliberately

  for (const group of HTML_ICON_GROUPS) {
    for (const id of iconIds(group)) apply(group, id);
  }

  /**
   * Warm the icons the card renderer draws.
   *
   * Currents and crests are painted onto every card canvas, so if they arrive
   * *after* a card is drawn each of those canvases needs repainting. Loading
   * the nineteen of them at boot means that almost never happens — by the time
   * any screen renders a card they are decoded and in the cache. The renderer
   * still has a one-shot repaint for the first boot, where the race is real.
   */
  preloadAssets(iconIds("current").map((id) => iconPath("current", id)));
  preloadAssets(iconIds("crest").map((id) => iconPath("crest", id)));
  /**
   * Confluences too, for a sharper reason than the other two.
   *
   * A Confluence emblem is drawn the moment one becomes available, and that is
   * a rare, loud moment in a match. Without warming them the first appearance
   * renders the fallback initials and swaps to the emblem on the next sync —
   * so the one time the player is most likely to look at it is the one time it
   * would be wrong.
   */
  preloadAssets(iconIds("confluence").map((id) => iconPath("confluence", id)));

  /**
   * The wordmark, by the same mechanism.
   *
   * It is the one brand asset that appears inside a screen rather than in the
   * browser chrome, and the lobby header is a two-item row — so the element
   * that holds it is `display: none` until this class says otherwise. That way
   * a missing wordmark is not an empty gap in the middle of the header, it is
   * nothing at all.
   */
  const applyWordmark = (): void => {
    const image = getAsset(brandPath("hb-wordmark"));
    if (!image) return;
    document.documentElement.style.setProperty("--brand-wordmark", `url("${image.src}")`);
    document.documentElement.classList.add("has-brand-wordmark");
  };
  onAssetLoaded((base) => {
    if (base === brandPath("hb-wordmark")) applyWordmark();
  });
  applyWordmark();
}

/** Test seam. */
export function resetIconStyles(): void {
  installed = false;
}
