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
 * The drawing stays in the box holding the space. When an image is available
 * the rule sets `color: transparent` — every symbol in `uiIcons.ts` is
 * `fill="none" stroke="currentColor"` — so the geometry, the accessible name
 * and the `--ui-scale` sizing are all still the drawing's and the picture sits
 * on top. When there is no picture, the drawing is simply what you see, which
 * is exactly the game as it shipped.
 *
 * ## What this module got wrong for a month, written down so it cannot recur
 *
 * The mechanism above was built when every icon in the game was a Unicode glyph
 * (`◈`, `✦`, `✧`, `◊`) and it keyed off the classes those glyphs carried —
 * `.currency-icon.clout`, `.ui-icon-mastery`. The visual overhaul replaced the
 * glyphs with drawings and took the classes with them, and **nothing failed**.
 * `has-icon-currency-clout` still went onto `<html>`, `--icon-currency-clout`
 * still held a valid url, and the selector that used them matched no element on
 * any screen. Twelve of the owner's paintings were downloaded at boot on every
 * session and drawn nowhere. `verify:art` reported "all 12 present interface
 * icon(s) are in use" the whole time, because it checked the class and not the
 * pixel.
 *
 * Two things stop that happening again. The hook is now `hb-mark-<id>`, put on
 * every icon by `uiIcons.ts::icon()` itself, so there is no second list to keep
 * in sync — an icon carries its own name wherever the markup goes. And
 * `verify:art` §5 loads the real routes in a real browser, taps `drawImage`,
 * `texImage2D`/`texSubImage2D` and every computed `background-image`, and fails
 * on a declared group that reaches no pixel anywhere. It validates itself first
 * against a control: the same route with every asset request aborted must
 * report nothing.
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

const ICONS = manifest.icons as {
  dir: string;
  groups: Record<string, string[]>;
  minPx: Record<string, number>;
  minPxById: Record<string, number>;
};
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
 * The smallest box, in CSS pixels, at which this group's paintings are still
 * themselves. **The whole painted-versus-drawn decision is this number.**
 *
 * Every icon in the game exists twice — as one of the owner's 512x512
 * paintings and as a drawing on the 24-unit grid — and until now there was no
 * rule about which one a given call site got. Whichever had been wired most
 * recently won, which is how twelve paintings ended up with no consumer at all
 * and eight more ended up being resampled into seven pixels on a card.
 *
 * The rule is one sentence: **the painting is used at or above `minPx`, and the
 * drawing below it.** The numbers are in `data/asset-manifest.json` beside the
 * ids they govern, so the renderer, the stylesheet and `verify:art` read the
 * same list and cannot drift.
 *
 * A group number is only as good as its weakest member, so three icons carry
 * their own: the mastery laurel, the halo ellipse and the prism are fine
 * linework in a low-contrast tone and need 32 where their groups need 18 and
 * 24. Rounding a whole group up to its worst member would withdraw eleven
 * legible paintings to protect three, which is the wrong trade in the one
 * direction that matters — these are the owner's, and the default is to show
 * them.
 *
 * Falls back to 0 — "always painted" — for a group with no number, because a
 * missing number must not silently withdraw an asset the owner made. A missing
 * number is `verify:art`'s problem, and it fails on one.
 */
export function iconMinPx(group: string, id?: string): number {
  const override = id === undefined ? undefined : ICONS.minPxById?.[id];
  return override ?? ICONS.minPx?.[group] ?? 0;
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

  /**
   * Run the size gate whenever a screen arrives.
   *
   * Three triggers, all cheap, because missing one leaves a painted icon
   * showing the drawn glyph forever and the failure is invisible: the drawn
   * glyph is a perfectly good icon, which is exactly why nobody noticed the
   * last time this whole mechanism was silently doing nothing.
   *
   * `#app`'s **direct** children are the screens — `shell.ts` swaps them there
   * — so a `childList` observer with no subtree fires once per mount and never
   * during a match, where the board rewrites its own descendants every frame.
   * `hashchange` covers a route that reuses its root, and the immediate call
   * covers the first screen, which is already mounted by the time this runs.
   */
  const app = document.getElementById("app");
  if (app && typeof MutationObserver === "function") {
    new MutationObserver(() => refreshPaintedIcons()).observe(app, { childList: true });
  }
  window.addEventListener("hashchange", () => refreshPaintedIcons());
  /**
   * And whenever the interface changes size.
   *
   * The accessibility screen scales the whole game from `--ui-scale` on the
   * root, so a player moving from 100% to 160% takes every icon across its own
   * threshold — upward, which is harmless, and downward on the way back, which
   * is not: an icon that keeps a painting after shrinking is the exact state
   * this mechanism exists to prevent.
   *
   * **The guard is the load-bearing part.** `battleView.ts::publishPileOrigins`
   * writes four custom properties to this same element from inside the match,
   * so an observer that swept on every attribute change would run a
   * `querySelectorAll` and a pile of `getBoundingClientRect` calls on the
   * battle's own cadence — a forced layout per frame, bought to catch a setting
   * a player changes once. Comparing the inline value first costs a string read
   * from the CSSOM and no style recalculation at all, because
   * `element.style.getPropertyValue` reads the declaration rather than the
   * computed value.
   */
  if (typeof MutationObserver === "function") {
    let lastScale = document.documentElement.style.getPropertyValue("--ui-scale");
    new MutationObserver(() => {
      const now = document.documentElement.style.getPropertyValue("--ui-scale");
      if (now === lastScale) return;
      lastScale = now;
      refreshPaintedIcons();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  }
  /**
   * The asset listener doubles as the boot sweep.
   *
   * `installIconStyles` runs before the first screen is mounted, so the call
   * below finds nothing; the twelve icons then arrive over the following
   * second, each one asking for another pass, and by then the screen is there.
   * That is load-bearing rather than incidental — it is why a cold, direct
   * `#lobby` load shows the painted wallet with no navigation to trigger it.
   */
  onAssetLoaded(() => refreshPaintedIcons());
  refreshPaintedIcons();
}

// ---------------------------------------------------------------------------
// The size gate, for the icons that live in HTML
// ---------------------------------------------------------------------------

/** `hb-mark-clout` — the handle `uiIcons.ts::icon()` puts on every icon. */
const MARK_CLASS = (id: string): string => `hb-mark-${id}`;

/**
 * The opt-in the stylesheet waits for. Painting is **off** until measured.
 *
 * Positive rather than negative deliberately. A gate that starts open and
 * closes after a measurement shows the wrong artwork for a frame and, worse,
 * shows it forever on any screen the sweep fails to reach. A gate that starts
 * closed degrades to the drawn set, which is the state the game shipped in and
 * the one every screen is already designed around.
 */
const FIT_CLASS = "hb-mark-fits";

const PAINTED_SELECTOR = HTML_ICON_GROUPS.flatMap((group) =>
  iconIds(group).map((id) => `.${MARK_CLASS(id)}`)
).join(",");

/**
 * Which group an HTML icon id belongs to. Twelve entries; built once.
 */
const GROUP_OF_ID = new Map<string, string>(
  HTML_ICON_GROUPS.flatMap((group) => iconIds(group).map((id) => [id, group] as const))
);

let sweepQueued = false;

/**
 * Measure every painted HTML icon and let through the ones big enough.
 *
 * ## Why this cannot be a stylesheet rule
 *
 * The whole painted-versus-drawn rule is a number of CSS pixels, and CSS has no
 * way to ask an element how many pixels it ended up. Two proxies looked like
 * they would do and neither does. A numeric `size` option is absent from almost
 * every call site, because sizing an icon from its host's font size is the
 * *preferred* way and the one that honours `--ui-scale`. And the optical rung
 * is not a size at all: `lobbyScreen.ts` asks for `optical: "hero"` on a mark
 * the stylesheet then lays out at **19px**, because the rung is a stroke-weight
 * hint and nothing else. A rule scoped to `.hb-icon-hero` therefore fires on
 * the smallest icons on the front door. Measured, not assumed — that selector
 * was written, shipped to a screenshot, and the laurel was still a smudge.
 *
 * So the browser is asked, after layout, which is the only thing that knows.
 *
 * ## What it costs
 *
 * One `querySelectorAll` of twelve class selectors and one
 * `getBoundingClientRect` per painted icon, batched into a single frame, once
 * per screen mount. The busiest screen in the game holds about fifty of them.
 * There is deliberately **no** `MutationObserver` on a subtree: the battle
 * board mutates its DOM every frame, and an observer there would turn a
 * once-per-screen read into a once-per-frame forced layout — which is the exact
 * shape of the navigation stall this project spent a wave removing.
 */
function sweepPaintedIcons(): void {
  if (typeof document === "undefined" || !PAINTED_SELECTOR) return;
  for (const node of document.querySelectorAll(PAINTED_SELECTOR)) {
    const element = node as HTMLElement;
    const id = [...element.classList].find((name) => name.startsWith("hb-mark-"))?.slice("hb-mark-".length);
    if (!id) continue;
    const group = GROUP_OF_ID.get(id);
    if (!group) continue;
    const box = Math.max(element.getBoundingClientRect().width, element.getBoundingClientRect().height);
    element.classList.toggle(FIT_CLASS, box >= iconMinPx(group, id));
  }
}

/**
 * Ask for a sweep; at most one per frame.
 *
 * Module-private. It reads as something a screen ought to be able to call after
 * rebuilding its own markup — the collection re-filtering, a wallet counting up
 * — and no screen does, so exporting it would add a fortieth entry to
 * `tests/no-orphan-ui.test.ts`'s list of things built and never plugged in. The
 * three triggers below reach every case that exists today; the day one does
 * not, the export is one word away and will have a caller to justify it.
 */
function refreshPaintedIcons(): void {
  if (typeof requestAnimationFrame !== "function") {
    sweepPaintedIcons();
    return;
  }
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => {
    sweepQueued = false;
    sweepPaintedIcons();
  });
}

/** Test seam. */
export function resetIconStyles(): void {
  installed = false;
}
