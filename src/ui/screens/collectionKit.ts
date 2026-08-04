/**
 * The furniture the four collection screens share, and the reason it is one
 * file rather than four copies.
 *
 * Collection, deck builder, deck slots and the character gallery are the same
 * job seen from four angles: a lot of cards, arranged, filtered, and inspected.
 * They kept solving it separately — four scroll regions with four different
 * edge treatments, four ways of saying "nothing here", four spellings of a
 * Current, and in two of them a Unicode glyph standing in for an icon. The AAA
 * bar's §7 asks for one grid, one stroke weight, one radius vocabulary; the
 * cheapest way to hold that across four files is for the four files to import
 * the same primitives.
 *
 * ## Why the CSS is in here
 *
 * `theme/screens.css` belongs to another module and is being edited by other
 * builders in parallel; the foundation contract is explicit that no module
 * edits another module's files. So the styling these four screens need that the
 * foundation does not already provide is injected once, from here, scoped to
 * the four root classes below, and written against the foundation's own tokens
 * — `--r-tile`, `--light-sweep`, `--dur-ui`, the material knobs — rather than
 * against literals. Nothing here invents a bevel; every surface is a foundation
 * material with a role applied.
 *
 * ## What is deliberately not here
 *
 * Card art. `portraitCanvas` crops the artist's PNG when one exists and calls
 * the renderer's own placeholder when it does not. It never draws a substitute
 * portrait of its own.
 */

import type { CardDef, CurrentId, Rarity } from "../../engine/types";
import { CURRENT_PALETTE, RARITY_STYLE, hexToRgba } from "../cardRenderer/palette";
import { drawPlaceholderArt } from "../cardRenderer/placeholderArt";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { parseCardText } from "../cardRenderer/renderCard";
import { icon, type IconId } from "../art/uiIcons";
import { DUR, EASE, cssEase, motionEnabled } from "../motion";

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/** Card text and lore are author-written, so nothing reaches innerHTML unescaped. */
export const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch
  );

/**
 * The card's own mini-markup, rendered rather than printed.
 *
 * `**Rushwind:** summon a 1/2 **Anon**` is drawn by the canvas renderer with
 * real bold; every panel that printed the same string through `esc` alone
 * printed the asterisks instead, so the two halves of the card detail disagreed
 * about the same sentence six inches apart. `parseCardText` is the renderer's
 * own parser, which is the only way to guarantee they cannot disagree again.
 */
export const richText = (text: string): string =>
  parseCardText(text)
    .map((part) =>
      part.bold ? `<strong>${esc(part.text)}</strong>`
      : part.italic ? `<em>${esc(part.text)}</em>`
      : esc(part.text)
    )
    .join("");

// ---------------------------------------------------------------------------
// Current and rarity, never signalled by colour alone
// ---------------------------------------------------------------------------

/**
 * A distinct glyph per Current, from module C's grid.
 *
 * The deck list used to print `label.charAt(0)`, which gives **P** for both
 * Pulse and Prism — two Currents distinguishable by hue and by nothing else,
 * which is the one case §6 bans outright. A shape plus a two-letter code means
 * a player with no colour vision at all can still read the list.
 */
export const CURRENT_SIGIL: Record<CurrentId, IconId> = {
  cinder: "flame",
  tide: "kw-flow",
  root: "kw-grow",
  gale: "kw-rushwind",
  pulse: "kw-viral",
  halo: "sun",
  veil: "moon",
  prism: "kw-refract",
};

/** PU and PR rather than P and P. */
export const currentCode = (id: CurrentId): string =>
  (CURRENT_PALETTE[id]?.label ?? id).slice(0, 2).toUpperCase();

/**
 * Three silhouettes for four tiers, plus the colour and the word.
 *
 * A single ◆ tinted four ways is a colour-only signal. A dot, a diamond, a
 * four-point spark and a star are four outlines that survive a greyscale print.
 */
export const RARITY_MARK: Record<Rarity, IconId> = {
  common: "dot",
  rare: "diamond",
  epic: "sparkle",
  legendary: "star-filled",
};

/** `<span>` with the Current sigil and its two-letter code, tinted and titled. */
export function currentTag(id: CurrentId): string {
  const palette = CURRENT_PALETTE[id];
  return (
    `<span class="hb-current" style="--cur:${palette.key}" title="${esc(palette.label)}" ` +
    `aria-label="${esc(palette.label)}">${icon(CURRENT_SIGIL[id], { size: 13 })}` +
    `<span class="hb-current-code num">${currentCode(id)}</span></span>`
  );
}

/** `<span>` with the rarity silhouette, tinted and titled. */
export function rarityTag(rarity: Rarity): string {
  const style = RARITY_STYLE[rarity];
  const label = style.label.charAt(0) + style.label.slice(1).toLowerCase();
  return (
    `<span class="hb-rarity hb-rarity-${rarity}" style="--rar:${style.color}" title="${esc(label)}" ` +
    `aria-label="${esc(label)}">${icon(RARITY_MARK[rarity], { size: 13 })}</span>`
  );
}

// ---------------------------------------------------------------------------
// the designed empty state
// ---------------------------------------------------------------------------

export interface EmptyStateSpec {
  glyph: IconId;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}

/**
 * §5: "Empty states are designed too."
 *
 * Filtering the collection to nothing used to produce a blank 1300×800
 * rectangle with the word "0" eight hundred pixels away in the header. This is
 * the foundation's `.empty` material with a sigil, a headline, one line naming
 * what is in the way, and the button that clears it.
 */
export function emptyState(spec: EmptyStateSpec): HTMLElement {
  const host = document.createElement("div");
  host.className = "empty mat-panel hb-empty";
  host.setAttribute("role", "status");
  host.innerHTML =
    `${icon(spec.glyph)}<h3 class="t-heading">${esc(spec.title)}</h3>` +
    `<p class="t-body">${esc(spec.body)}</p>`;
  if (spec.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mat-hero act r-chip";
    button.textContent = spec.action.label;
    button.addEventListener("click", spec.action.onClick);
    host.appendChild(button);
  }
  return host;
}

// ---------------------------------------------------------------------------
// lazy canvases
// ---------------------------------------------------------------------------

/**
 * Draw a tile's canvas only once it is near the viewport.
 *
 * The collection holds 245 cards. Building all 245 canvases at mount cost 1.48s
 * to the first visible tile and left a quarter of a gigabyte of bitmap in the
 * compositor, which is what made a single keystroke in the search box cost
 * 206ms of paint: every filter change re-laid a grid of 245 live canvases. Only
 * about twenty-one are ever on screen.
 *
 * So a cell reserves its space with an aspect ratio and asks for its bitmap
 * when it comes within a screen and a half of the fold. The canvas is kept once
 * drawn — scrolling back up must never re-rasterise — and it fades in over one
 * micro beat so nothing pops (§7).
 *
 * Returns a disposer; screens call it from `dispose`.
 */
export function lazyPaint(root: HTMLElement, margin = "500px 0px"): {
  watch: (cell: HTMLElement, paint: () => void) => void;
  release: (cell: HTMLElement) => void;
  hold: (ms: number) => void;
  stop: () => void;
} {
  const jobs = new WeakMap<Element, () => void>();
  const queue: Element[] = [];
  let draining = 0;
  let heldUntil = 0;

  /*
   * The queue, and why painting on the intersection callback is not enough.
   *
   * Filtering 245 cards down to 56 brings 56 previously-unpainted tiles up into
   * the viewport at once, and a card canvas costs about five milliseconds — so
   * the frame that reveals them cost a measured 324ms of paint. Lazy loading had
   * only moved the stall, not removed it.
   *
   * So intersecting *enqueues*, and the queue drains on the frame clock with a
   * budget. Eight milliseconds is half a 60fps frame: enough to place two or
   * three cards a frame, little enough that the grid keeps scrolling and the
   * search box keeps taking keys while it happens. The tiles hold their slot in
   * the meantime and fade in as they land, which is the wave §3a asks for rather
   * than the stall it replaced.
   */
  const BUDGET_MS = 8;
  /*
   * The first pass is different in kind, and 26ms was the wrong number for it.
   *
   * A card costs about 34ms to rasterise the first few times — the renderer's
   * gradients, its grain and its type all warm up on the first call — so a 26ms
   * budget bought exactly one card per animation frame and no more, and the
   * browser then spent the rest of the frame laying out and compositing the
   * grid it had just changed. Measured on a 1600×900 collection: 2,721ms to fill
   * the twenty-one tiles above the fold, of which only 1,175ms was drawing.
   *
   * Forty milliseconds is deliberately over one frame — enough for a second card
   * whenever the first came in under the wire. Nothing on this screen is
   * interactive until its cards exist, the queue is held while the filter is
   * moving, and after the first pass the budget drops back to half a frame, so
   * the only thing this lengthens is a window in which the player is waiting
   * anyway.
   */
  const FIRST_BUDGET_MS = 40;
  let firstPass = true;

  const drain = (): void => {
    draining = 0;
    const started = performance.now();
    /*
     * Nothing is painted while the filter is still moving.
     *
     * A card that scrolls into view during the third character of a six-letter
     * query is on screen for eighty milliseconds and then gone, and the first
     * paint of a card with real art has to decode its PNG on the main thread —
     * which is where the 100ms-plus tasks in the measurement were coming from.
     * Holding the queue for a beat after each filter change means those cards
     * are never painted at all, and the ones the player actually stops on are
     * painted immediately afterwards.
     */
    if (started < heldUntil) {
      schedule();
      return;
    }
    const budget = firstPass ? FIRST_BUDGET_MS : BUDGET_MS;
    while (queue.length > 0 && performance.now() - started < budget) {
      const target = queue.shift();
      if (!target) break;
      const job = jobs.get(target);
      if (!job) continue;
      jobs.delete(target);
      job();
    }
    if (queue.length > 0) schedule();
    else firstPass = false;
  };

  const schedule = (): void => {
    if (draining || typeof requestAnimationFrame !== "function") return;
    draining = requestAnimationFrame(drain);
  };

  /* No IntersectionObserver means a test environment or a very old engine; the
     honest fallback is to paint immediately rather than to show nothing. */
  const supported = typeof IntersectionObserver === "function";
  const observer = supported
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!jobs.has(entry.target)) continue;
            observer?.unobserve(entry.target);
            queue.push(entry.target);
          }
          if (queue.length > 0) schedule();
        },
        { root, rootMargin: margin }
      )
    : null;

  return {
    watch(cell, paint) {
      if (!observer) {
        paint();
        return;
      }
      jobs.set(cell, paint);
      observer.observe(cell);
    },
    release(cell) {
      jobs.delete(cell);
      observer?.unobserve(cell);
    },
    hold(ms) {
      heldUntil = performance.now() + ms;
      if (queue.length > 0) schedule();
    },
    stop() {
      observer?.disconnect();
      queue.length = 0;
      if (draining && typeof cancelAnimationFrame === "function") cancelAnimationFrame(draining);
      draining = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// portraits
// ---------------------------------------------------------------------------

/**
 * A character's face, cropped out of the card art.
 *
 * The gallery was a contacts list: a coloured capital letter in a near-black
 * rectangle, 1px border, no depth — an admin-dashboard pattern standing in for
 * a cast browser. Every character in the game already has a painting or a
 * placeholder, and the top of a card's art window is a portrait crop by
 * construction, so the gallery can have real faces for the cost of one
 * `drawImage`.
 *
 * When the artist's PNG has not arrived, this calls the renderer's *own*
 * placeholder rather than inventing a substitute — the art gap is a schedule,
 * not a defect, and nothing here may fabricate a portrait.
 */
export function portraitCanvas(card: CardDef, width: number, height: number): HTMLCanvasElement {
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const paint = (): boolean => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const art = getCardArt(card);
    const havePainting = Boolean(art && art.naturalWidth > 0);
    if (art && havePainting) {
      /*
       * Cover-fit biased to the top third. A card painting is composed for a
       * portrait window with the face high in the frame; centring the crop
       * reliably cuts the head off, which is the one thing a cast browser must
       * not do.
       */
      const scale = Math.max(width / art.naturalWidth, height / art.naturalHeight);
      const w = art.naturalWidth * scale;
      const h = art.naturalHeight * scale;
      ctx.drawImage(art, (width - w) / 2, (height - h) * 0.18, w, h);
    } else {
      drawPlaceholderArt(ctx, { x: 0, y: 0, w: width, h: height }, card.current, card.name);
    }

    // the scrim the name sits on — §4 never puts text straight onto imagery
    const scrim = ctx.createLinearGradient(0, height * 0.42, 0, height);
    scrim.addColorStop(0, "rgba(6,3,14,0)");
    scrim.addColorStop(0.62, "rgba(6,3,14,0.62)");
    scrim.addColorStop(1, "rgba(6,3,14,0.94)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, height * 0.42, width, height * 0.58);

    // the 315° key, so a portrait tile is lit like every other surface
    const key = ctx.createLinearGradient(0, 0, width, height);
    key.addColorStop(0, "rgba(255,255,255,0.11)");
    key.addColorStop(0.35, "rgba(255,255,255,0)");
    key.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, width, height);

    return havePainting;
  };

  /**
   * Art arrives after the first paint, and the tile has to notice.
   *
   * `getCardArt` starts a background load and returns null the first time it is
   * asked about a card, so a screen that draws once on mount draws the
   * placeholder for every painted card in the game and then keeps it — which is
   * the worst of both worlds, since it makes finished art look missing. One
   * listener per tile, removed the moment the real painting lands.
   */
  if (!paint()) {
    const off = onArtLoaded((cardId) => {
      if (cardId !== card.id) return;
      if (paint()) off();
    });
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// drag
// ---------------------------------------------------------------------------

export interface DragSpec {
  /** Built on the first move past the threshold; positioned by this helper. */
  ghost: () => HTMLElement;
  /** Candidate drop zones, resolved once when the drag actually starts. */
  zones: () => HTMLElement[];
  /** Fired on release over a zone. `null` means released outside every zone. */
  onDrop: (zone: HTMLElement | null) => void;
  /** Optional live feedback as the pointer crosses a zone boundary. */
  onOver?: (zone: HTMLElement | null) => void;
}

/** Under this the gesture is a click, not a drag, so click-to-add still works. */
const DRAG_THRESHOLD = 7;

/**
 * Pointer-driven drag, with no HTML5 drag-and-drop and no dependency.
 *
 * `dragstart` gives a browser-drawn ghost that cannot be styled, fires on touch
 * inconsistently, and cannot be cancelled cleanly — none of which suits a card
 * that has to tilt, cast and spring back. This is the small amount of pointer
 * bookkeeping that buys all three, and it deliberately leaves the element's own
 * `click` alone below the threshold: drag is an *addition* to click-to-add, never
 * a replacement, because a drag-only affordance is unreachable from a keyboard.
 */
export function draggable(handle: HTMLElement, spec: DragSpec): () => void {
  let ghost: HTMLElement | null = null;
  let zones: HTMLElement[] = [];
  let over: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let live = false;
  let pointer = -1;

  const zoneAt = (x: number, y: number): HTMLElement | null => {
    for (const zone of zones) {
      const box = zone.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return zone;
    }
    return null;
  };

  const place = (x: number, y: number): void => {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(-7deg) scale(0.92)`;
  };

  const finish = (drop: HTMLElement | null): void => {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    for (const zone of zones) zone.classList.remove("hb-drop-over", "hb-drop-live");
    handle.classList.remove("hb-dragging");
    document.body.classList.remove("hb-drag-active");
    over = null;
    live = false;
    pointer = -1;
    spec.onOver?.(null);
    spec.onDrop(drop);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    if (!live) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
      live = true;
      zones = spec.zones();
      ghost = spec.ghost();
      ghost.className = `hb-drag-ghost ${ghost.className}`.trim();
      document.body.appendChild(ghost);
      handle.classList.add("hb-dragging");
      document.body.classList.add("hb-drag-active");
      for (const zone of zones) zone.classList.add("hb-drop-live");
    }
    place(event.clientX, event.clientY);
    const next = zoneAt(event.clientX, event.clientY);
    if (next !== over) {
      over?.classList.remove("hb-drop-over");
      next?.classList.add("hb-drop-over");
      over = next;
      spec.onOver?.(next);
    }
  };

  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    if (!live) {
      pointer = -1;
      return; // it was a click; the element's own handler deals with it
    }
    // a release outside every zone springs back rather than vanishing
    finish(zoneAt(event.clientX, event.clientY));
  };

  const onCancel = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    if (live) finish(null);
    pointer = -1;
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || pointer !== -1) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  handle.addEventListener("pointerdown", onDown);
  return () => {
    handle.removeEventListener("pointerdown", onDown);
    onCancel();
  };
}

/** A copy of a canvas's pixels, since `cloneNode` on a canvas copies nothing. */
export function canvasGhost(source: HTMLCanvasElement, width: number): HTMLElement {
  const ratio = source.height / Math.max(1, source.width);
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const copy = document.createElement("canvas");
  copy.width = Math.round(width * dpr);
  copy.height = Math.round(width * ratio * dpr);
  copy.style.width = `${width}px`;
  copy.style.height = `${width * ratio}px`;
  copy.getContext("2d")?.drawImage(source, 0, 0, copy.width, copy.height);
  return copy;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * Coalesce a burst of calls into one, on a timer.
 *
 * The collection search fires `input` per keystroke and a fast typist produces
 * eight in the time one filter pass takes. Debouncing is not a substitute for
 * making the pass cheap — it is what stops the cheap pass from happening eight
 * times for one word.
 */
export function debounce<A extends unknown[]>(ms: number, fn: (...args: A) => void): (...args: A) => void {
  let handle = 0;
  return (...args: A) => {
    window.clearTimeout(handle);
    handle = window.setTimeout(() => fn(...args), ms);
  };
}

/**
 * Light the end fades only when there is something past the edge.
 *
 * A permanent gradient at the bottom of a list that has already ended is a
 * smudge; the fade has to mean "there is more", which means it has to go out
 * when there is not. Passive listener, two custom properties, no layout read
 * beyond the three numbers the scroller already has.
 */
export function bindScrollFades(wrap: HTMLElement, scroller: HTMLElement): () => void {
  const sync = (): void => {
    const top = scroller.scrollTop;
    const room = scroller.scrollHeight - scroller.clientHeight;
    wrap.style.setProperty("--fade-top", top > 6 ? "1" : "0");
    wrap.style.setProperty("--fade-bottom", room - top > 6 ? "1" : "0");
  };
  /*
   * One read per frame at most.
   *
   * The grid grows every time a card canvas lands in it, so the ResizeObserver
   * fires once per painted tile — thirty-five times during a mount, each of them
   * reading three layout properties in the middle of the paint loop. Profiled at
   * 37ms of the navigation into the collection, which is a whole dropped frame
   * spent deciding whether to show a gradient. Coalescing to the frame clock
   * makes it one read.
   */
  let queued = 0;
  const later = (): void => {
    if (queued || typeof requestAnimationFrame !== "function") return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      sync();
    });
  };
  scroller.addEventListener("scroll", sync, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
  observer?.observe(scroller);
  sync();
  return () => {
    scroller.removeEventListener("scroll", sync);
    observer?.disconnect();
    if (queued && typeof cancelAnimationFrame === "function") cancelAnimationFrame(queued);
  };
}

/**
 * How wide to draw a card, asked of the hole it is going into.
 *
 * `renderCardToCanvas(card, 168)` rasterises at 168 CSS pixels *and writes that
 * number into the element's inline style*, so the bitmap is 168px wide whatever
 * the grid thinks. Measured at 844×390 — a resolution the bar names as a hard
 * floor — the shelf track is 93px and every tile was drawing a 168px card: rows
 * overlapped themselves two cards deep and the right-hand column ran off the
 * screen. At 1280×720 the same constant is too *small*, leaving 15px of dead
 * track beside every tile.
 *
 * So the tile is measured first. It is only meaningful once layout has happened,
 * which is exactly when the lazy painter runs, so the number is always real by
 * the time it is wanted; the fallback is the old constant, for the frame where
 * it is not.
 */
export function tileWidth(cell: HTMLElement, fallback: number): number {
  const measured = Math.round(cell.clientWidth);
  return measured > 24 ? measured : fallback;
}

/**
 * Re-rasterise a grid of cards when the column width really moves.
 *
 * A CSS-scaled bitmap survives a resize — it just softens — so this deliberately
 * does nothing about a two-pixel drag. It fires when a track crosses a fifth of
 * its own width, which in practice means a breakpoint or a maximise, and it is
 * debounced past the end of the drag so a slow resize costs one re-render rather
 * than sixty.
 */
export function retileOnResize(
  grid: HTMLElement,
  sampleWidth: () => number,
  reset: () => void,
  threshold = 0.2
): () => void {
  if (typeof ResizeObserver !== "function") return () => {};
  let known = 0;
  const check = debounce(260, () => {
    const now = sampleWidth();
    if (now <= 24) return;
    if (known === 0) {
      known = now;
      return;
    }
    if (Math.abs(now - known) / known < threshold) return;
    known = now;
    reset();
  });
  const observer = new ResizeObserver(() => check());
  observer.observe(grid);
  return () => observer.disconnect();
}

/** Grow a row in, from nothing, on the arrive curve. A no-op under reduced motion. */
export function enterRow(node: HTMLElement, index = 0): void {
  if (!motionEnabled()) return;
  node.style.setProperty("--enter-delay", `${Math.min(220, index * 34)}ms`);
  node.classList.add("hb-row-in");
  window.setTimeout(() => node.classList.remove("hb-row-in"), DUR.ui + 320);
}

// ---------------------------------------------------------------------------
// the stylesheet
// ---------------------------------------------------------------------------

const STYLE_ID = "hb-collection-kit";

/**
 * Inject the four screens' shared styling, once.
 *
 * Scoped to `.col-v2`, `.db-v2`, `.ds-v2` and `.gal-v2`, which the four screens
 * add to their own roots. That scoping is what lets this coexist with
 * `theme/screens.css` while it is being edited by somebody else: every rule here
 * carries one more class than the rule it supersedes, so the cascade resolves by
 * specificity rather than by source order, and nothing here can reach a screen
 * that has not opted in.
 */
export function installKitStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = KIT_CSS;
  document.head.appendChild(style);
}

const KIT_CSS = String.raw`
/* =======================================================================
   SHARED
   ======================================================================= */

.col-v2, .db-v2, .ds-v2, .gal-v2 {
  --shelf-lit: rgb(255 255 255 / 0.075);
  --shelf-lip: rgb(0 0 0 / 0.5);
  --rail-w: 268px;
}

/* A scroll region that ends in air rather than at a guillotine (§7). The fade
   is an overlay on the wrapper, not a mask on the scroller: a mask promotes a
   245-canvas grid to its own composited layer and costs more than the edge it
   buys. */
.hb-scrollwrap { position: relative; min-height: 0; display: flex; flex-direction: column; }
.hb-scrollwrap > .hb-scroll { flex: 1 1 auto; }
.hb-scrollwrap::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 44px;
  pointer-events: none;
  z-index: 3;
  background: linear-gradient(to bottom, rgb(6 3 14 / 0), rgb(6 3 14 / 0.86));
  opacity: var(--fade-bottom, 1);
  transition: opacity var(--dur-ui) var(--ease-arrive);
}
.hb-scrollwrap.hb-fade-top::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 26px;
  pointer-events: none;
  z-index: 3;
  background: linear-gradient(to top, rgb(6 3 14 / 0), rgb(6 3 14 / 0.8));
  opacity: var(--fade-top, 0);
  transition: opacity var(--dur-ui) var(--ease-arrive);
}

/* The scrollbar is furniture, not OS chrome: narrower than the global default,
   inset from the panel edge, and lit from 315° like everything else. */
.hb-scroll { overflow-y: auto; overflow-x: hidden; min-height: 0; scroll-behavior: smooth; }
.hb-scroll::-webkit-scrollbar { width: 8px; }
.hb-scroll::-webkit-scrollbar-track { background: rgb(0 0 0 / 0.34); border-radius: var(--r-chip); margin: 6px 0; }
.hb-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(var(--light-sweep), rgb(163 145 226 / 0.92), rgb(88 78 132 / 0.92));
  border: 1px solid transparent;
  background-clip: padding-box;
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.3), inset 0 -1px 0 rgb(0 0 0 / 0.4);
}
.hb-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(var(--light-sweep), #cbb8ff, rgb(120 104 178 / 0.95)); background-clip: padding-box; }
:root[data-reduced-motion="true"] .hb-scroll { scroll-behavior: auto; }

/* Current and rarity marks (§6: never colour alone) */
.hb-current {
  display: inline-flex; align-items: center; gap: 3px;
  color: var(--cur);
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.6));
}
.hb-current-code { font-size: 0.66rem; letter-spacing: 0.06em; font-weight: 700; }
.hb-rarity { display: inline-flex; color: var(--rar); filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.6)); }

/*
 * The shared empty plate.
 *
 * The sigil is deliberately enormous and nearly invisible — a watermark behind
 * the words rather than a 24px icon above them. An empty result is a moment the
 * player did not ask for, and the difference between a shrug and a designed
 * state is whether anything on it was drawn at a size somebody chose.
 */
.hb-empty {
  position: relative;
  overflow: hidden;
  margin: auto;
  max-width: 460px;
  padding: var(--sp-6) var(--sp-5);
}
.hb-empty > .hb-icon {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 232px; height: 232px;
  color: var(--accent);
  opacity: 0.085;
  pointer-events: none;
}
.hb-empty > .t-heading { font-family: var(--font-display); font-size: var(--fs-xl); }
.hb-empty > .t-heading, .hb-empty > .t-body, .hb-empty > .act { position: relative; }

/* the drag ghost, and the world reacting to it */
.hb-drag-ghost {
  position: fixed;
  left: 0; top: 0;
  z-index: 200;
  pointer-events: none;
  will-change: transform;
  filter: drop-shadow(0 26px 34px rgb(0 0 0 / 0.72)) drop-shadow(0 3px 4px rgb(0 0 0 / 0.5));
  animation: hb-ghost-lift 150ms var(--ease-overshoot) both;
}
@keyframes hb-ghost-lift { from { opacity: 0.2; } }
body.hb-drag-active { cursor: grabbing; }
body.hb-drag-active * { cursor: grabbing !important; }
.hb-dragging { opacity: 0.34; filter: saturate(0.4); }
.hb-drop-live {
  box-shadow: inset 0 0 0 1px rgb(181 108 255 / 0.28);
  transition: box-shadow var(--dur-micro) var(--ease-arrive);
}
.hb-drop-over {
  box-shadow:
    inset 0 0 0 2px var(--accent),
    inset 0 0 26px rgb(181 108 255 / 0.3),
    0 0 22px rgb(181 108 255 / 0.24);
}

/* one row entrance, shared by the deck list and the slot rack */
.hb-row-in { animation: hb-row-in var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) backwards; }
@keyframes hb-row-in {
  from { opacity: 0; transform: translateX(-10px) scaleY(0.7); }
}
:root[data-reduced-motion="true"] .hb-row-in { animation-duration: 80ms; animation-name: hb-row-fade; }
@keyframes hb-row-fade { from { opacity: 0; } }

/* =======================================================================
   COLLECTION
   ======================================================================= */

.col-v2 .collection-body {
  grid-template-columns: var(--rail-w) minmax(0, 1fr);
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}

.col-v2 .col-summary {
  display: inline-flex; align-items: baseline; gap: 5px;
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.col-v2 .col-summary .hb-icon { width: 14px; height: 14px; align-self: center; color: var(--accent-bright); }
.col-v2 .col-summary .num { color: var(--text); font-weight: 600; }
.col-v2 .col-summary-sep { color: var(--text-faint); }
.col-v2 .card-grid > .hb-empty { margin: 9vh auto; }

/* ---- the filter rail ------------------------------------------------- */

.col-v2 .filter-rail {
  padding: 0;
  gap: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.col-v2 .filter-rail-head {
  display: flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4) var(--sp-3);
  border-bottom: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.05);
}
.col-v2 .filter-rail-head .hb-icon { width: 15px; height: 15px; color: var(--text-dim); }
.col-v2 .filter-rail-head .t-label { flex: 1 1 auto; }
.col-v2 .filter-active-count {
  min-width: 22px; text-align: center;
  padding: 1px 7px; font-size: 0.68rem;
}
.col-v2 .filter-active-count[hidden] { display: none; }

.col-v2 .filter-rail-scroll { padding: var(--sp-3) var(--sp-3) var(--sp-4); display: flex; flex-direction: column; gap: 2px; }

.col-v2 .filter-group { gap: 0; border-radius: var(--r-tile); }
.col-v2 .filter-group + .filter-group { margin-top: 2px; }
.col-v2 .filter-head {
  display: flex; align-items: center; gap: var(--sp-2);
  width: 100%;
  padding: 7px var(--sp-2);
  border: 0; background: none;
  color: var(--text-dim);
  cursor: pointer;
  border-radius: var(--r-field);
  --r-self: var(--r-field);
}
.col-v2 .filter-head:hover { color: var(--text); background: rgb(255 255 255 / 0.045); }
.col-v2 .filter-head .eyebrow { flex: 1 1 auto; text-align: left; margin: 0; }
.col-v2 .filter-head .hb-icon { width: 13px; height: 13px; transition: transform var(--dur-micro) var(--ease-arrive); }
.col-v2 .filter-group.is-shut .filter-head .hb-icon { transform: rotate(-90deg); }
.col-v2 .filter-group.is-shut .filter-chips { display: none; }
.col-v2 .filter-head .filter-group-count {
  font-size: 0.66rem; padding: 0 6px; line-height: 1.5;
  color: var(--accent-bright);
}
.col-v2 .filter-head .filter-group-count[hidden] { display: none; }

.col-v2 .filter-chips { gap: 5px; padding: 3px var(--sp-2) var(--sp-3); }

/* rest is recessed, active is raised out of the rail — §5's states as
   material changes rather than as a background swap */
.col-v2 .filter-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  border: 0;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  color: var(--text-dim);
  background: linear-gradient(var(--light-sweep), rgb(2 1 6 / 0.55), rgb(26 18 48 / 0.42));
  box-shadow: inset 1px 1px 2px rgb(0 0 0 / 0.6), inset -1px -1px 0 rgb(255 255 255 / 0.05);
}
.col-v2 .filter-chip .hb-icon { width: 12px; height: 12px; color: var(--chip-color, currentColor); }
.col-v2 .filter-chip .chip-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--chip-color, var(--accent)) 92%, white), var(--chip-color, var(--accent)));
  box-shadow: 0 0 5px color-mix(in srgb, var(--chip-color, var(--accent)) 60%, transparent), inset 0 -1px 1px rgb(0 0 0 / 0.5);
}
@media (hover: hover) {
  .col-v2 .filter-chip:hover:not(.active) {
    color: var(--text);
    background: linear-gradient(var(--light-sweep), rgb(56 42 92 / 0.7), rgb(30 21 56 / 0.6));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), 0 2px 4px rgb(0 0 0 / 0.45);
    transform: translateY(-1px);
  }
}
.col-v2 .filter-chip.active {
  color: #fff;
  background:
    linear-gradient(var(--light-sweep),
      color-mix(in srgb, var(--chip-color, var(--accent)) 46%, transparent),
      color-mix(in srgb, var(--chip-color, var(--accent)) 20%, transparent)),
    linear-gradient(var(--light-sweep), rgb(60 46 100 / 0.9), rgb(26 18 48 / 0.9));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.22),
    inset 0 -1px 0 rgb(0 0 0 / 0.55),
    0 2px 4px rgb(0 0 0 / 0.5),
    0 0 12px color-mix(in srgb, var(--chip-color, var(--accent)) 26%, transparent);
  transform: translateY(-1px);
}
.col-v2 .filter-chip.active::after {
  content: "";
  width: 4px; height: 4px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 4px currentColor;
}
/* cost chips are numbers, so they are a gem row rather than a word row */
.col-v2 .filter-chips.is-cost { gap: 4px; }
.col-v2 .filter-chips.is-cost .filter-chip {
  width: 30px; height: 30px; padding: 0;
  justify-content: center;
  border-radius: var(--r-field);
  --r-self: var(--r-field);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 0.78rem;
}

.col-v2 .filter-rail-foot {
  display: flex; gap: var(--sp-2); align-items: center;
  padding: var(--sp-3);
  border-top: 1px solid rgb(0 0 0 / 0.55);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
  background: linear-gradient(var(--light-sweep), rgb(30 21 56 / 0.5), rgb(12 7 26 / 0.6));
}
.col-v2 .filter-rail-foot .btn { flex: 1 1 auto; min-height: 36px; font-size: var(--fs-sm); }

/* ---- the toolbar ------------------------------------------------------ */

.col-v2 .collection-toolbar { gap: var(--sp-3); align-items: stretch; }

.col-v2 .search-field {
  position: relative;
  flex: 1 1 300px;
  display: flex; align-items: center;
  height: 44px;
  padding: 0 var(--sp-3) 0 40px;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  background: linear-gradient(var(--light-sweep), rgb(2 1 6 / 0.72) 0%, rgb(22 15 42 / 0.5) 100%);
  box-shadow:
    inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62),
    inset -1px -1px 0 rgb(255 255 255 / 0.07),
    0 1px 0 rgb(255 255 255 / 0.04);
}
.col-v2 .search-field:focus-within {
  box-shadow:
    inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent),
    0 0 16px rgb(181 108 255 / 0.22);
}
.col-v2 .search-field > .hb-icon {
  position: absolute; left: 14px;
  width: 17px; height: 17px;
  color: var(--text-faint);
  pointer-events: none;
}
.col-v2 .search-input {
  flex: 1 1 auto;
  min-height: 0; height: 100%;
  padding: 0;
  border: 0; background: none; box-shadow: none;
  border-radius: 0;
}
.col-v2 .search-input::-webkit-search-cancel-button { display: none; }
/*
 * The ring goes round the field, not round the box inside it.
 *
 * The focus ring inherits its host's radius, and the host here was the bare
 * input element — a 10px-cornered rectangle drawn inside a 44px pill, starting
 * 40px to the right of the magnifier that belongs to it and running straight
 * over the result count on its other side. What the player is focusing is the
 * search control, so the control is what lights up: same outline, same halo,
 * same bloom, at the pill's own radius.
 */
:root:root[data-keyboard-nav="true"] .col-v2 .search-input:focus-visible,
:root:root[data-keyboard-nav="true"] .db-v2 .search-input:focus-visible {
  outline: none;
  box-shadow: none;
}
:root:root[data-keyboard-nav="true"] .col-v2 .search-field:focus-within,
:root:root[data-keyboard-nav="true"] .db-v2 .search-field:focus-within {
  border-radius: var(--r-chip);
  outline: var(--focus-width) solid var(--focus-ink);
  outline-offset: var(--focus-gap);
  box-shadow:
    inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62),
    0 0 0 var(--focus-gap) var(--focus-halo),
    0 0 12px var(--focus-bloom);
}
.col-v2 .search-clear {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  --r-self: 50%;
  background: rgb(255 255 255 / 0.07);
  color: var(--text-dim);
  cursor: pointer;
}
.col-v2 .search-clear:hover { background: rgb(255 255 255 / 0.16); color: var(--text); }
.col-v2 .search-clear[hidden] { display: none; }
.col-v2 .search-count {
  font-size: 0.7rem;
  color: var(--text-faint);
  padding-right: var(--sp-2);
  white-space: nowrap;
}

/* the segmented control: a recessed track with the active pill raised out of it */
.col-v2 .ownership-tabs {
  height: 44px;
  padding: 4px;
  gap: 2px;
  border-radius: var(--r-chip);
  background: linear-gradient(var(--light-sweep), rgb(2 1 6 / 0.72), rgb(22 15 42 / 0.5));
  box-shadow: inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62), inset -1px -1px 0 rgb(255 255 255 / 0.06);
}
.col-v2 .ownership-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 15px;
  border: 0;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  background: none;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: color var(--dur-micro) var(--ease-arrive), transform var(--dur-micro) var(--ease-overshoot);
}
.col-v2 .ownership-tab .hb-icon { width: 14px; height: 14px; }
.col-v2 .ownership-tab:hover:not(.active) { color: var(--text); }
.col-v2 .ownership-tab.active {
  color: #fff;
  background: linear-gradient(var(--light-sweep), var(--accent-bright) 0%, var(--accent) 52%, var(--accent-hot) 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.34),
    inset 0 -1px 0 rgb(0 0 0 / 0.26),
    0 3px 8px rgb(0 0 0 / 0.5),
    0 1px 2px rgb(0 0 0 / 0.6);
}

/* ---- the grid, as shelves rather than a contact sheet ------------------ */

.col-v2 .card-grid {
  display: block;
  padding: 0 var(--sp-3) 0 0;
  overscroll-behavior: contain;
}
/* Layout containment per shelf. Hiding 153 tiles when a search narrows used to
   re-lay the whole 8,000px grid in one task; containment stops each shelf's
   reflow at its own box, so the cost is the shelf that changed rather than the
   collection.
   content-visibility:auto was tried here as well and is deliberately not
   used: it removes skipped tiles from the box tree, which takes them out of the
   accessibility and hit-test trees too, and a grid whose cards cannot be found
   by a keyboard or a test harness is not a grid. */
.col-v2 .col-shelf { margin-bottom: var(--sp-4); }
.col-v2 .col-shelf[hidden] { display: none; }
.col-v2 .col-shelf-grid { contain: layout style; }

.col-v2 .col-shelf-head {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: 6px;
  border-radius: var(--r-field);
  background: linear-gradient(var(--light-sweep), rgb(30 20 56 / 0.97), rgb(11 6 24 / 0.97));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.09),
    inset 0 -1px 0 rgb(0 0 0 / 0.6),
    0 6px 14px rgb(0 0 0 / 0.5);
  backdrop-filter: blur(6px);
}
.col-v2 .col-shelf-gem {
  display: grid; place-items: center;
  width: 25px; height: 25px;
  border-radius: 50%;
  font-size: 0.8rem; font-weight: 700;
  color: #fff;
  background: linear-gradient(var(--light-sweep), #7fd4ff, #2b6fd6 60%, #16336d);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -2px 3px rgb(0 0 0 / 0.4), 0 2px 5px rgb(0 0 0 / 0.55);
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.6);
}
.col-v2 .col-shelf-title { font-size: 0.7rem; }
.col-v2 .col-shelf-rule {
  flex: 1 1 auto; height: 2px;
  background-image:
    linear-gradient(90deg, var(--hairline-dark), transparent 88%),
    linear-gradient(90deg, var(--hairline-lit), transparent 88%);
  background-repeat: no-repeat;
  background-size: 100% 1px, 100% 1px;
  background-position: 0 0, 0 100%;
}
.col-v2 .col-shelf-count { font-size: 0.68rem; color: var(--text-faint); }

/* the plane the cards stand on: lit at the top-left, dark under the row */
/* The plane the cards stand on. It carries the four things §1 asks of any
   surface: a gradient along the 315 degree light vector, a lit top rim and a
   dark lower lip, module B's grain, and a deepening shadow at the base so a row
   of cards reads as standing on a shelf rather than as floating in a list. */
.col-v2 .col-shelf-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--sp-4) var(--sp-3);
  align-content: start;
  padding: var(--sp-4) var(--sp-3) var(--sp-3);
  border-radius: var(--r-panel);
  background:
    var(--tex-grain-mid, none),
    linear-gradient(var(--light-sweep), rgb(66 48 112 / 0.46) 0%, rgb(20 13 40 / 0.5) 46%, rgb(4 2 10 / 0.66) 100%);
  background-size: var(--tex-grain-mid-size, auto), auto;
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.09),
    inset 0 -1px 0 rgb(0 0 0 / 0.65),
    inset 0 -40px 46px -40px rgb(0 0 0 / 0.95),
    0 10px 24px rgb(0 0 0 / 0.35);
}
/* the shelf's front lip: a thin lit band along the bottom edge, which is what
   turns a tinted rectangle into a ledge */
.col-v2 .col-shelf-grid::after {
  content: "";
  position: absolute;
  left: 10%; right: 10%; bottom: 0;
  height: 2px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.12), transparent);
}

/* The entrance is opt-in per tile. The shared stylesheet gives every card cell
   the keyframe unconditionally, which on a 245-tile grid is 245 concurrent CSS
   animations on mount — measured at a 506ms long task for a wave whose last two
   hundred elements were eight screens below the fold. */
.col-v2 .card-cell {
  padding-bottom: 20px;
  border-radius: var(--r-tile);
  --r-self: var(--r-tile);
  animation: none;
}
.col-v2 .card-cell.is-entering {
  animation: card-tile-in 320ms var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}
:root[data-reduced-motion="true"] .col-v2 .card-cell.is-entering {
  animation-duration: 90ms;
  animation-name: card-tile-fade;
}
/* the space a tile occupies before its bitmap exists, so lazy painting never
   reflows the grid */
/*
 * The empty sleeve, and why it is drawn rather than left blank.
 *
 * A card takes about 35ms to rasterise and only the ones near the fold are ever
 * drawn, so for the first couple of seconds of a visit the grid is mostly holes.
 * Left as a two-stop wash they read as breakage — twenty-one rectangles with a
 * count badge under each and nothing in them. Drawn as a recessed sleeve with a
 * hatched back and a lit rim, the same two seconds read as a binder page whose
 * cards are still being slid in, which is what is actually happening. A4 asks
 * for a skeleton rather than a spinner; this is the skeleton, and it is made of
 * the same material as everything else on the shelf.
 */
.col-v2 .card-cell .card-slot,
.db-v2 .pool-cell .card-slot {
  display: block;
  width: 100%;
  aspect-ratio: 512 / 680;
  border-radius: 10px;
  background:
    repeating-linear-gradient(
      var(--light-sweep),
      rgb(255 255 255 / 0.028) 0 2px,
      rgb(255 255 255 / 0) 2px 9px
    ),
    linear-gradient(var(--light-sweep), rgb(10 6 22 / 0.72), rgb(3 2 8 / 0.5));
  box-shadow:
    inset 1px 1.4px 4px rgb(0 0 0 / 0.62),
    inset -1px -1px 0 rgb(255 255 255 / 0.05);
}
/*
 * And no shimmer on it, deliberately.
 *
 * A skeleton usually sweeps, and a sweep here would be a paint property animated
 * across up to two hundred and forty-five elements at once — the exact thing
 * that halved the lobby's frame rate when a sheen was run across twenty-one
 * plates. The motion in this state is the cards themselves landing, one after
 * another, which is real progress rather than a decoration standing in for it.
 */
/*
 * The bitmap obeys the track, not the other way round.
 *
 * The renderer writes an inline style.width in the pixels it was asked for, and
 * nothing overrode it — so on a phone in landscape, where the shelf track is
 * 93px, every tile drew a 168px card and the row overlapped itself two cards
 * deep. The width the renderer is now asked for is the tile's measured one; this
 * is the belt to that pair of braces, holding between a resize and the
 * re-render it triggers.
 */
.col-v2 .card-cell canvas {
  display: block;
  width: 100%;
  height: auto;
  animation: hb-tile-lit 200ms var(--ease-arrive) both;
}
@keyframes hb-tile-lit { from { opacity: 0; } }
/* the contact shadow that makes a card sit on the shelf rather than float */
.col-v2 .card-cell::before {
  content: "";
  position: absolute;
  left: 8%; right: 8%; bottom: 15px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgb(0 0 0 / 0.62), transparent 72%);
  z-index: -1;
  transition: transform var(--dur-micro) var(--ease-arrive), opacity var(--dur-micro) var(--ease-arrive);
}
.col-v2 .card-cell:hover {
  transform: translateY(-10px) scale(1.045);
  filter: drop-shadow(0 18px 26px rgb(0 0 0 / 0.66)) drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
}
.col-v2 .card-cell:hover::before { transform: translateY(9px) scaleX(0.86); opacity: 0.75; }
/*
 * The neighbours give way, which is the secondary motion 3 asks for.
 *
 * A card lifting on its own is an element with a hover state; a card lifting
 * while the two beside it lean out of its way and dim is a physical object in a
 * rack. Two elements move, both on transform and filter, so the cost is two
 * composited layers for the length of one hover — nothing like animating a
 * paint property across the row. :has is how the left-hand neighbour is
 * reached; where it is unsupported the tile simply does not lean, which is the
 * old behaviour rather than a broken one.
 */
.col-v2 .card-cell:hover + .card-cell,
.col-v2 .card-cell:has(+ .card-cell:hover) {
  filter: brightness(0.84) saturate(0.9);
}
.col-v2 .card-cell:hover + .card-cell { transform: translateX(5px); }
.col-v2 .card-cell:has(+ .card-cell:hover) { transform: translateX(-5px); }
:root[data-reduced-motion="true"] .col-v2 .card-cell:hover + .card-cell,
:root[data-reduced-motion="true"] .col-v2 .card-cell:has(+ .card-cell:hover) { transform: none; }
.col-v2 .card-cell.unowned canvas { opacity: 0.72; filter: saturate(0.26) brightness(0.7) contrast(0.96); }

.col-v2 .card-count {
  bottom: 1px; right: 3px;
  font-size: 0.66rem;
  padding: 1px 8px;
}

/* ---- the detail overlay ----------------------------------------------- */

/* §2: the grid behind must survive as a receded plane rather than be
   annihilated. Blur and desaturate push it back; an opaque scrim deletes it. */
.col-v2 .card-detail-overlay {
  background:
    radial-gradient(120% 90% at 50% 36%, rgb(38 52 96 / 0.34), transparent 70%),
    rgb(3 2 8 / 0.5);
  backdrop-filter: blur(15px) saturate(0.7) brightness(0.92);
}
.col-v2 .cd-stage { width: min(1240px, 95vw); gap: var(--sp-3); }
.col-v2 .cd-head { align-items: center; gap: var(--sp-3); }
.col-v2 .cd-position {
  margin-left: var(--sp-3);
  font-size: 0.7rem;
  padding: 3px 10px;
}
.col-v2 .cd-close {
  border: 0;
  --r-self: 50%;
  background: linear-gradient(var(--light-sweep), rgb(60 46 100 / 0.9), rgb(24 16 46 / 0.92));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14), inset 0 -1px 0 rgb(0 0 0 / 0.5), 0 3px 8px rgb(0 0 0 / 0.5);
}
.col-v2 .cd-close:hover { transform: translateY(-1px) scale(1.04); background: linear-gradient(var(--light-sweep), rgb(84 62 138 / 0.95), rgb(34 22 62 / 0.95)); }

/* a real surface under the arrows: recessed track, raised chevron (§5) */
.col-v2 .cd-arrow {
  width: 46px; height: 46px;
  opacity: 1;
  --r-self: 50%;
  color: var(--text);
  background: linear-gradient(var(--light-sweep), rgb(52 39 88 / 0.86), rgb(18 11 36 / 0.9));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.14),
    inset 0 -1px 0 rgb(0 0 0 / 0.55),
    0 4px 12px rgb(0 0 0 / 0.55);
  transition: transform var(--dur-micro) var(--ease-overshoot), box-shadow var(--dur-micro) var(--ease-arrive), opacity var(--dur-micro);
}
.col-v2 .cd-arrow .hb-icon { width: 20px; height: 20px; }
.col-v2 .cd-arrow:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.26), 0 6px 16px rgb(0 0 0 / 0.6), 0 0 18px var(--detail-glow, rgb(120 160 255 / 0.4));
}
.col-v2 .cd-arrow-prev:hover:not(:disabled) { transform: translateY(-50%) translateX(-5px); }
.col-v2 .cd-arrow-next:hover:not(:disabled) { transform: translateY(-50%) translateX(5px); }
.col-v2 .cd-arrow:disabled { opacity: 0.24; box-shadow: inset 1px 1px 3px rgb(0 0 0 / 0.6); color: var(--text-faint); }

/* the panel is a plate, not a paragraph floating on a scrim (§1, §4) */
.col-v2 .cd-panel {
  padding: var(--sp-4) var(--sp-4) var(--sp-3);
  border-radius: var(--r-panel);
  --r-self: var(--r-panel);
  background:
    var(--tex-grain-mid, none),
    linear-gradient(var(--light-sweep), rgb(50 37 85 / 0.95) 0%, rgb(20 13 37 / 0.96) 100%);
  background-size: var(--tex-grain-mid-size, auto), auto;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.075),
    inset 0 -1px 0 rgb(0 0 0 / 0.63),
    0 20px 34px rgb(0 0 0 / 0.5),
    0 2px 3px rgb(0 0 0 / 0.6);
  max-height: 82vh;
}
.col-v2 .cd-tabs { gap: var(--sp-4); border-bottom-color: rgb(0 0 0 / 0.5); box-shadow: 0 1px 0 rgb(255 255 255 / 0.05); }
.col-v2 .cd-tab { font-size: var(--fs-md); }
.col-v2 .cd-tab-body { padding-right: var(--sp-2); }
.col-v2 .cd-effect strong { color: var(--accent-bright); }
.col-v2 .cd-effect em { color: var(--text-dim); }
.col-v2 .cd-keywords li strong { color: var(--detail-key); }
/* Four buttons of four different widths wrapped to a ragged one-and-a-bit
   rows. A 2x2 grid is the same four controls on a grid somebody chose. */
.col-v2 .cd-actions {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-top: auto;
  padding-top: var(--sp-3);
  border-top: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
}
.col-v2 .cd-actions .btn { min-height: 38px; }
/* the tab body ends in air above the divider rather than being guillotined
   through the middle of a keyword reminder (§7) */
.col-v2 .cd-actions::before {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 100%;
  height: 34px;
  pointer-events: none;
  background: linear-gradient(to bottom, rgb(23 15 41 / 0), rgb(23 15 41 / 0.94));
}
.col-v2 .cd-decks { display: flex; flex-wrap: wrap; gap: 6px; margin: var(--sp-2) 0 var(--sp-3); }
.col-v2 .cd-deck-chip { font-size: 0.7rem; padding: 3px 10px; }

/* ---- responsive -------------------------------------------------------- */

@media (max-width: 1150px) {
  .col-v2 { --rail-w: 220px; }
}
@media (max-width: 900px) {
  .col-v2 .collection-body { grid-template-columns: minmax(0, 1fr); }
  .col-v2 .filter-rail { display: none; }
  .col-v2 .col-shelf-grid { grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: var(--sp-3) var(--sp-2); padding: var(--sp-3) var(--sp-2); }
  .col-v2 .cd-stage { max-height: 96vh; }
  .col-v2 .cd-panel { padding: var(--sp-3); }
}
/* A phone in landscape has 390px of height and about 150 of it is chrome, so a
   168px tile leaves one and a half rows. Everything shrinks: the tile, the
   shelf header, the toolbar, and the gap between them. */
@media (max-height: 480px) {
  .col-v2 .collection-body { padding: var(--sp-2) var(--sp-3) var(--sp-2); gap: var(--sp-2); }
  .col-v2 .collection-main { gap: var(--sp-2); }
  .col-v2 .col-shelf-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: var(--sp-3) 7px; padding: 10px 8px 8px; }
  .col-v2 .col-shelf { margin-bottom: var(--sp-3); }
  .col-v2 .col-shelf-head { padding: 3px 8px; }
  .col-v2 .col-shelf-gem { width: 19px; height: 19px; font-size: 0.66rem; }
  .col-v2 .card-cell { padding-bottom: 15px; }
  .col-v2 .card-count { font-size: 0.58rem; padding: 0 6px; }
  .col-v2 .search-field, .col-v2 .ownership-tabs { height: 36px; }
  .col-v2 .ownership-tab { padding: 0 10px; font-size: 0.72rem; }
  .col-v2 .cd-stage { gap: var(--sp-2); }
}
/*
 * The card is sized in script now, so the stylesheet's height cap has to go.
 *
 * A max-height on an element whose width is written inline does not scale it,
 * it squashes it — which is how a 3:4 card came to be drawn at 1.9:1 on a phone
 * in landscape. The width the renderer is given already accounts for the room.
 */
.col-v2 .cd-tilt canvas { max-height: none; }
/*
 * And on a short screen the inspector goes back to two columns.
 *
 * Stacking is right when the window is narrow; at 844x390 it is not narrow, it
 * is short, and stacking put the card on top of a panel that then had eighty
 * pixels for its tabs, its body and its four buttons. Side by side, both halves
 * get the full height.
 */
@media (max-height: 480px) and (min-width: 700px) {
  .col-v2 .cd-stage { width: min(1240px, 97vw); max-height: 97vh; gap: 4px; }
  .col-v2 .cd-body { grid-template-columns: minmax(0, 0.85fr) minmax(300px, 1.15fr); gap: var(--sp-3); overflow: hidden; }
  .col-v2 .cd-art { padding: 0 var(--sp-4); }
  .col-v2 .cd-panel { max-height: none; padding: var(--sp-2) var(--sp-3); }
  .col-v2 .cd-name { font-size: var(--fs-lg); }
  .col-v2 .cd-actions { padding-top: var(--sp-2); }
  .col-v2 .cd-actions .btn { min-height: 30px; font-size: 0.7rem; }
}

/* =======================================================================
   DECK BUILDER
   ======================================================================= */

/* The three-row side panel. Header and footer size to content; only the middle
   scrolls. Before this the whole column was one flex box, and at 1280x720 the
   Save Deck row was laid out at y=720 in a 720px window — measured, unreachable,
   with no scrollbar. A pinned footer cannot be squeezed off the bottom. */
.db-v2 .builder-side {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 0;
  overflow: hidden;
  gap: 0;
}
.db-v2 .builder-side-head {
  padding: var(--sp-3) var(--sp-4) var(--sp-3);
  border-bottom: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.05);
  display: flex; flex-direction: column; gap: var(--sp-2);
}
.db-v2 .builder-side-scroll { padding: var(--sp-3) var(--sp-3) var(--sp-5) var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-3); }
.db-v2 .builder-side-foot {
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid rgb(0 0 0 / 0.55);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06);
  background: linear-gradient(var(--light-sweep), rgb(34 24 62 / 0.72), rgb(13 8 28 / 0.82));
  display: flex; flex-direction: column; gap: var(--sp-2);
}

.db-v2 .builder-body { padding: var(--sp-3) var(--sp-4) var(--sp-4); }
.db-v2 .builder-pool { gap: var(--sp-3); }
.db-v2 .builder-pool-head { gap: var(--sp-3); align-items: stretch; }
.db-v2 .leader-select { min-height: 44px; border-radius: var(--r-chip); --r-self: var(--r-chip); }

/* the pool search wears the same recessed field the collection does */
.db-v2 .search-field {
  position: relative;
  flex: 1 1 260px;
  display: flex; align-items: center;
  height: 44px;
  padding: 0 var(--sp-3) 0 40px;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  background: linear-gradient(var(--light-sweep), rgb(2 1 6 / 0.72) 0%, rgb(22 15 42 / 0.5) 100%);
  box-shadow: inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62), inset -1px -1px 0 rgb(255 255 255 / 0.07);
}
.db-v2 .search-field:focus-within {
  box-shadow: inset 1.2px 1.6px 4px rgb(0 0 0 / 0.62), inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent), 0 0 16px rgb(181 108 255 / 0.22);
}
.db-v2 .search-field > .hb-icon { position: absolute; left: 14px; width: 17px; height: 17px; color: var(--text-faint); pointer-events: none; }
.db-v2 .search-input { flex: 1 1 auto; min-height: 0; height: 100%; padding: 0; border: 0; background: none; box-shadow: none; border-radius: 0; }
.db-v2 .search-input:focus { box-shadow: none; border: 0; outline: none; }
.db-v2 .search-count { font-size: 0.7rem; color: var(--text-faint); white-space: nowrap; padding-right: var(--sp-2); }

.db-v2 .deck-stats { display: flex; align-items: center; gap: var(--sp-3); }
.db-v2 .deck-count { flex: 0 0 auto; white-space: nowrap; line-height: 1; }
.db-v2 .deck-count-value { font-size: var(--fs-2xl); }
.db-v2 .deck-meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.db-v2 .deck-meta .muted b { color: var(--text); }
.db-v2 .deck-types { display: flex; flex-wrap: wrap; gap: 4px; }
.db-v2 .type-pill {
  display: inline-flex; align-items: baseline; gap: 5px;
  padding: 2px 8px;
  font-size: 0.63rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.db-v2 .type-pill b { color: var(--text); font-size: 0.75rem; font-weight: 700; }

/* ---- the hype curve, as a chart rather than five bars ----------------- */

.db-v2 .deck-curve { display: flex; flex-direction: column; gap: 5px; }
.db-v2 .curve-frame {
  position: relative;
  height: 76px;
  padding: 14px var(--sp-2) 0;
  border-radius: var(--r-field);
  background: linear-gradient(var(--light-sweep), rgb(2 1 6 / 0.6), rgb(24 16 44 / 0.42));
  box-shadow: inset 1.2px 1.6px 4px rgb(0 0 0 / 0.55), inset -1px -1px 0 rgb(255 255 255 / 0.055);
}
/* three gridlines, fading at both ends so they do not butt into the frame */
.db-v2 .curve-frame::before {
  content: "";
  position: absolute;
  inset: 14px var(--sp-2) 0;
  pointer-events: none;
  background-image:
    linear-gradient(90deg, transparent, rgb(255 255 255 / 0.07) 12%, rgb(255 255 255 / 0.07) 88%, transparent),
    linear-gradient(90deg, transparent, rgb(255 255 255 / 0.07) 12%, rgb(255 255 255 / 0.07) 88%, transparent),
    linear-gradient(90deg, transparent, rgb(255 255 255 / 0.07) 12%, rgb(255 255 255 / 0.07) 88%, transparent),
    linear-gradient(90deg, transparent, rgb(255 255 255 / 0.18) 6%, rgb(255 255 255 / 0.18) 94%, transparent);
  background-repeat: no-repeat;
  background-size: 100% 1px, 100% 1px, 100% 1px, 100% 1px;
  background-position: 0 25%, 0 50%, 0 75%, 0 100%;
}
/* The bars grow on height and the labels ride up on bottom, which are layout
   properties — so the invalidation is fenced inside the chart. Seventeen small
   boxes re-laying their own 200x60 box on a click is nothing; the same
   seventeen re-laying the side panel behind them would not be. */
.db-v2 .curve-bars { position: relative; display: flex; align-items: flex-end; gap: 4px; height: 100%; contain: layout style; }
.db-v2 .curve-bar { flex: 1 1 0; position: relative; height: 100%; display: flex; align-items: flex-end; }
.db-v2 .curve-fill {
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--accent-bright) 88%, white), var(--accent) 55%, var(--accent-hot));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35), 0 -1px 6px rgb(181 108 255 / 0.3);
  transition: height var(--dur-ui) var(--ease-overshoot) var(--bar-delay, 0ms);
  min-height: 0;
}
.db-v2 .curve-bar.is-empty .curve-fill { background: rgb(255 255 255 / 0.08); box-shadow: none; }
.db-v2 .curve-bar.is-thin .curve-fill { background: linear-gradient(var(--light-sweep), #ffd27a, #f0a63c 55%, #c96b18); }
/* the target curve, as a ghost outline over the bars — the caption already
   claimed it existed */
.db-v2 .curve-target {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  border-top: 1.5px dashed rgb(255 255 255 / 0.42);
  pointer-events: none;
  transition: height var(--dur-ui) var(--ease-arrive);
}
.db-v2 .curve-count {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  /* top:auto is load-bearing. The shared stylesheet pins this element to
     top:-2px, and an absolutely positioned box with both top and bottom set
     stretches between them — which drew the count's dark plate as a 60px black
     column down the middle of every bar. */
  top: auto;
  bottom: calc(var(--fill-h, 0%) + 2px);
  font-size: 0.64rem;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  padding: 0 3px;
  border-radius: 3px;
  background: rgb(6 3 14 / 0.72);
  transition: bottom var(--dur-ui) var(--ease-overshoot) var(--bar-delay, 0ms);
}
.db-v2 .curve-bar.is-zero .curve-count { color: var(--text-faint); }
.db-v2 .curve-axis { display: flex; gap: 4px; }
.db-v2 .curve-axis span { flex: 1 1 0; text-align: center; font-size: 0.62rem; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.db-v2 .curve-note { font-size: 0.7rem; margin: 0; }

/* ---- the deck list ----------------------------------------------------- */

.db-v2 .deck-list-block { display: flex; flex-direction: column; gap: 4px; }
.db-v2 .deck-list-head { display: flex; align-items: baseline; gap: var(--sp-2); }
.db-v2 .deck-list-head .eyebrow { flex: 1 1 auto; margin: 0; }
.db-v2 .deck-list-rows { display: flex; flex-direction: column; gap: 2px; }
.db-v2 .deck-list { padding: 0; overflow: visible; display: block; }

.db-v2 .deck-bucket-head {
  position: sticky;
  top: -1px;
  z-index: 2;
  display: flex; align-items: center; gap: 7px;
  padding: 3px 8px;
  margin: 5px 0 3px;
  border-radius: 5px;
  font-size: 0.62rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: linear-gradient(var(--light-sweep), rgb(30 20 56 / 0.97), rgb(13 8 28 / 0.97));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 3px 8px rgb(0 0 0 / 0.45);
}
.db-v2 .deck-bucket-head b { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.db-v2 .deck-bucket-rule {
  flex: 1 1 auto; height: 1px;
  background: linear-gradient(90deg, rgb(255 255 255 / 0.12), transparent);
}

.db-v2 .deck-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 8px 4px 5px;
  border: 0;
  border-radius: var(--r-field);
  --r-self: var(--r-field);
  text-align: left;
  cursor: pointer;
  color: var(--text);
  background: linear-gradient(var(--light-sweep), rgb(48 36 82 / 0.55), rgb(18 12 36 / 0.6));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.055),
    inset 0 -1px 0 rgb(0 0 0 / 0.5),
    inset 3px 0 0 -1px var(--row-color, var(--accent)),
    0 1px 2px rgb(0 0 0 / 0.4);
  transition: transform var(--dur-micro) var(--ease-overshoot), box-shadow var(--dur-micro) var(--ease-arrive), background var(--dur-micro);
}
@media (hover: hover) {
  .db-v2 .deck-row:hover {
    transform: translateX(3px);
    background: linear-gradient(var(--light-sweep), rgb(66 48 112 / 0.7), rgb(26 17 50 / 0.72));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.12),
      inset 3px 0 0 -1px var(--row-color, var(--accent)),
      0 3px 8px rgb(0 0 0 / 0.5),
      0 0 14px color-mix(in srgb, var(--row-color, var(--accent)) 26%, transparent);
  }
  .db-v2 .deck-row:hover .deck-row-count { color: var(--danger); }
}
.db-v2 .deck-row-cost {
  display: grid; place-items: center;
  width: 21px; height: 21px;
  border-radius: 50%;
  font-size: 0.7rem; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: linear-gradient(var(--light-sweep), #7fd4ff, #2b6fd6 62%, #16336d);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -2px 3px rgb(0 0 0 / 0.4), 0 1px 3px rgb(0 0 0 / 0.55);
  text-shadow: 0 1px 1px rgb(0 0 0 / 0.6);
}
.db-v2 .deck-row-name { font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-v2 .deck-row-count { font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--text-dim); min-width: 20px; text-align: right; }
.db-v2 .deck-row.is-max .deck-row-count { color: var(--accent-gold); }
.db-v2 .deck-legend { display: flex; flex-wrap: wrap; gap: var(--sp-2); font-size: 0.62rem; color: var(--text-faint); padding: 5px 4px 0; }
.db-v2 .deck-legend > span { display: inline-flex; align-items: center; gap: 3px; }

/* the row that just changed lights for one UI beat, so an add is visible in the
   list as well as in the counter */
.db-v2 .deck-row.is-touched { animation: hb-row-touched 520ms var(--ease-arrive); }
@keyframes hb-row-touched {
  0% { box-shadow: inset 0 0 0 1px var(--row-color), 0 0 22px color-mix(in srgb, var(--row-color) 70%, transparent); }
  100% { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.055), inset 3px 0 0 -1px var(--row-color); }
}
:root[data-reduced-motion="true"] .db-v2 .deck-row.is-touched { animation: none; }

.db-v2 .hb-ghost-row {
  border-radius: var(--r-field);
  padding: 6px 10px;
  background: linear-gradient(var(--light-sweep), rgb(72 54 122 / 0.96), rgb(26 17 50 / 0.96));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.16), 0 14px 24px rgb(0 0 0 / 0.6);
}

/* ---- the pool ---------------------------------------------------------- */

/*
 * The pool stands on the same lit plane the collection's shelves do.
 *
 * Without it the legal cards float on the atmosphere with nothing between them
 * and the backdrop — three depth planes where 2 asks for four — and the two
 * screens a player moves between constantly disagree about what a rack of cards
 * looks like. Same gradient along the 315 degree key, same grain, same lit top
 * rim and dark lower lip; it is one surface here rather than one per cost,
 * because the pool is not bucketed.
 */
.db-v2 .pool-grid {
  padding: var(--sp-3) var(--sp-3) var(--sp-6);
  border-radius: var(--r-panel);
  background:
    var(--tex-grain-mid, none),
    linear-gradient(var(--light-sweep), rgb(66 48 112 / 0.4) 0%, rgb(20 13 40 / 0.46) 46%, rgb(4 2 10 / 0.6) 100%);
  background-size: var(--tex-grain-mid-size, auto), auto;
  background-attachment: local, local;
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.085),
    inset 0 -1px 0 rgb(0 0 0 / 0.6),
    0 10px 24px rgb(0 0 0 / 0.32);
}
.db-v2 .pool-cell {
  border-radius: var(--r-tile);
  --r-self: var(--r-tile);
  position: relative;
  padding-bottom: 4px;
  animation: card-tile-in 300ms var(--ease-arrive) both;
}
.db-v2 .pool-cell::before {
  content: "";
  position: absolute;
  left: 8%; right: 8%; bottom: 2px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgb(0 0 0 / 0.6), transparent 72%);
  z-index: -1;
  transition: transform var(--dur-micro) var(--ease-arrive);
}
.db-v2 .pool-cell:hover { transform: translateY(-7px) scale(1.04); filter: drop-shadow(0 14px 22px rgb(0 0 0 / 0.6)); }
.db-v2 .pool-cell:hover::before { transform: translateY(7px) scaleX(0.86); }
.db-v2 .pool-cell.unowned canvas { opacity: 0.66; filter: saturate(0.22) brightness(0.66); }
.db-v2 .pool-cell.at-limit canvas { filter: saturate(0.55) brightness(0.78); }
.db-v2 .pool-badge {
  bottom: 8px;
  border: 0;
  padding: 2px 10px;
  background: linear-gradient(var(--light-sweep), rgb(46 34 80 / 0.95), rgb(12 7 26 / 0.96));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.13), inset 0 -1px 0 rgb(0 0 0 / 0.55), 0 2px 5px rgb(0 0 0 / 0.55);
}
.db-v2 .pool-cell.at-limit .pool-badge { color: var(--accent-gold); }
.db-v2 .pool-cell.unowned .pool-badge { color: var(--danger); }
.db-v2 .pool-cell canvas { display: block; width: 100%; height: auto; animation: hb-tile-lit 200ms var(--ease-arrive) both; }
.db-v2 .pool-cell[hidden] { display: none; }
.db-v2 .pool-build-around {
  display: grid; place-items: center;
  width: 24px; height: 24px;
  --r-self: 50%;
}
.db-v2 .pool-build-around .hb-icon { width: 14px; height: 14px; }

/* the deck panel lights up while a card is over it */
.db-v2 .builder-side.hb-drop-live { box-shadow: inset 0 0 0 1px rgb(181 108 255 / 0.3); }
.db-v2 .builder-side.hb-drop-over {
  box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 40px rgb(181 108 255 / 0.18), 0 0 26px rgb(181 108 255 / 0.24);
}
.db-v2 .pool-grid.hb-drop-over { box-shadow: inset 0 0 0 2px var(--danger), inset 0 0 40px rgb(255 90 120 / 0.14); border-radius: var(--r-panel); }

/* ---- validation and actions ------------------------------------------- */

.db-v2 .validation-ok, .db-v2 .validation-problem {
  display: flex; align-items: center; gap: 7px;
  font-size: 0.76rem;
}
.db-v2 .validation-ok .hb-icon { width: 15px; height: 15px; color: var(--success, #6ee7a8); }
.db-v2 .validation-problem .hb-icon { width: 15px; height: 15px; color: var(--danger); }
.db-v2 .builder-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.db-v2 .builder-actions .btn { min-height: 38px; font-size: var(--fs-sm); }
.db-v2 .builder-actions .btn:first-child { grid-column: 1 / -1; }

.db-v2 .current-donut {
  position: relative;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 4px 12px rgb(0 0 0 / 0.5);
}
.db-v2 .current-donut::after {
  content: "";
  position: absolute; inset: 0;
  border-radius: 50%;
  background: linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.22), transparent 46%, rgb(0 0 0 / 0.34));
  pointer-events: none;
}

@media (max-height: 800px) {
  .db-v2 .curve-frame { height: 58px; }
  .db-v2 .builder-side-head { padding-top: var(--sp-2); padding-bottom: var(--sp-2); }
}
@media (max-width: 1150px) and (min-width: 1001px) {
  .db-v2 .builder-body { grid-template-columns: minmax(0, 1fr) 320px; }
}
/* Under 1000px the panel goes under the pool rather than beside it. Stated here
   because the rule above would otherwise win on specificity at every width. */
@media (max-width: 1000px) {
  .db-v2 .builder-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .db-v2 .builder-side { max-height: 48vh; }
}
@media (max-height: 480px) and (max-width: 1000px) {
  /* One row of pool and a short panel. Both numbers are floors, not guesses:
     118px is a 96px card plus its badge, and 176px is the deck counter, the
     validation line and the action grid — the parts that must never be off
     screen, since Save Deck being unreachable at the minimum resolution is the
     defect this whole layout was rebuilt around. */
  .db-v2 .builder-body { grid-template-rows: minmax(112px, 1fr) auto; }
  .db-v2 .builder-side { max-height: 196px; }
  /* The curve is analysis; the list is the thing being edited. On a phone in
     landscape there is room for one of them and it is not the chart. */
  .db-v2 .deck-curve { display: none; }
}
/* A shorter title bar buys the two densest screens about thirty pixels, which
   at 390px of height is a whole row of cards. */
@media (max-height: 480px) {
  .db-v2 .sub-header, .col-v2 .sub-header { padding: 6px var(--sp-4); }
  .db-v2 .sub-header .btn, .col-v2 .sub-header .btn { min-height: 34px; }
  .db-v2 .deck-name-input { min-height: 34px; font-size: var(--fs-md); }
  .db-v2 .sub-header .title, .col-v2 .sub-header .title { font-size: var(--fs-lg); }
}
@media (max-height: 480px) {
  .db-v2 .builder-body { padding: var(--sp-2) var(--sp-3) var(--sp-2); }
  .db-v2 .pool-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--sp-2); }
  .db-v2 .builder-pool-head { gap: var(--sp-2); }
  .db-v2 .leader-select, .db-v2 .search-field { height: 36px; min-height: 36px; }
  .db-v2 .curve-frame { height: 46px; }
  .db-v2 .deck-count-value { font-size: var(--fs-lg); }
  .db-v2 .deck-types { display: none; }
  .db-v2 .builder-side-head { padding: 6px var(--sp-3); }
  .db-v2 .builder-side-foot { padding: 6px var(--sp-3); }
  .db-v2 .builder-actions { grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .db-v2 .builder-actions .btn { min-height: 30px; font-size: 0.68rem; padding: 0 6px; }
  .db-v2 .deck-validation { font-size: 0.68rem; }
}
/*
 * A phone in landscape is wide and short, so the two things go side by side.
 *
 * Stacking them was right for a narrow window and wrong for this one: measured
 * at 844x390, the pool got 90px — the top third of one row of cards — and the
 * deck list got twenty-five, which is less than one row and reads as a bug. The
 * height is the scarce axis here, not the width, so the panel takes a column
 * instead of a band and both objects get the whole 330px the body has.
 */
@media (max-height: 480px) and (min-width: 700px) and (max-width: 1000px) {
  .db-v2 .builder-body {
    grid-template-columns: minmax(0, 1fr) 296px;
    grid-template-rows: minmax(0, 1fr);
    gap: var(--sp-2);
  }
  .db-v2 .builder-side { max-height: none; }
  .db-v2 .builder-actions { grid-template-columns: repeat(2, 1fr); }
  .db-v2 .pool-grid { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); }
  /* the leader and the search share one line: wrapping them costs 40px, which
     at 390px of height is most of a row of cards */
  .db-v2 .builder-pool-head { flex-wrap: nowrap; }
  .db-v2 .builder-pool-head .leader-select { flex: 0 1 190px; min-width: 0; }
  .db-v2 .search-field { flex: 1 1 100px; }
}

/* =======================================================================
   DECK SLOTS — a rack of twelve, not one card in an empty room
   ======================================================================= */

/*
 * The rack stands on a surface, and the surface reaches the bottom of the frame.
 *
 * With twelve sockets on a 900px screen there is still a hand's width of nothing
 * under the last row, and nothing was exactly what it was: the atmosphere, with
 * the rack floating on it. Giving the body the same lit plane the collection's
 * shelves and the builder's pool stand on does three things at once — it fills
 * the frame, it puts a midground between the rack and the backdrop (§2), and it
 * makes the third of the four screens in this domain agree with the other two
 * about what a surface is. Only the top corners are rounded, because the plane
 * runs off the bottom of the screen rather than ending in mid-air.
 */
.ds-v2 .deck-slots-body {
  max-width: 1460px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: var(--sp-4);
  align-content: start;
  padding: var(--sp-4) var(--sp-5) var(--sp-6);
  border-radius: var(--r-panel) var(--r-panel) 0 0;
  background:
    var(--tex-grain-mid, none),
    linear-gradient(var(--light-sweep), rgb(60 44 104 / 0.34) 0%, rgb(18 12 36 / 0.4) 44%, rgb(4 2 10 / 0.55) 100%);
  background-size: var(--tex-grain-mid-size, auto), auto;
  background-attachment: local, local;
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.075),
    0 -10px 26px rgb(0 0 0 / 0.3);
}
.ds-v2 .deck-rack-rail {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-field);
  background: linear-gradient(var(--light-sweep), rgb(34 24 62 / 0.6), rgb(12 7 26 / 0.66));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 -1px 0 rgb(0 0 0 / 0.55), 0 6px 16px rgb(0 0 0 / 0.4);
}
.ds-v2 .deck-rack-rail .hb-icon { width: 16px; height: 16px; color: var(--text-dim); }
.ds-v2 .deck-rack-rule { flex: 1 1 auto; height: 2px;
  background-image:
    linear-gradient(90deg, transparent, var(--hairline-dark) 8%, var(--hairline-dark) 92%, transparent),
    linear-gradient(90deg, transparent, var(--hairline-lit) 8%, var(--hairline-lit) 92%, transparent);
  background-repeat: no-repeat; background-size: 100% 1px, 100% 1px; background-position: 0 0, 0 100%;
}

.ds-v2 .deck-slot {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--sp-2) var(--sp-3);
  padding: var(--sp-3);
  min-height: 190px;
  border-radius: var(--r-panel);
  --r-self: var(--r-panel);
  animation: hb-row-in var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}
/* the active deck wears its faction as a lit edge, not as a 1px border */
.ds-v2 .deck-slot.is-active {
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.14),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent),
    inset 0 -1px 0 rgb(0 0 0 / 0.63),
    0 14px 28px rgb(0 0 0 / 0.5),
    0 0 24px rgb(181 108 255 / 0.22);
}
.ds-v2 .deck-slot-cover {
  grid-row: 1 / 3;
  position: relative;
  border-radius: var(--r-tile);
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), inset 0 -1px 0 rgb(0 0 0 / 0.6), 0 4px 10px rgb(0 0 0 / 0.5);
}
.ds-v2 .deck-slot-cover canvas { display: block; width: 100%; height: 100%; }
.ds-v2 .deck-slot-cover::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.1), transparent 42%, rgb(0 0 0 / 0.2));
  pointer-events: none;
}
.ds-v2 .deck-slot-index {
  position: absolute;
  top: 5px; left: 6px;
  z-index: 2;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  padding: 1px 6px;
  color: var(--text-dim);
  background: rgb(4 2 10 / 0.7);
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
}
.ds-v2 .deck-slot-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; align-self: start; }
.ds-v2 .deck-slot-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ds-v2 .deck-slot-name {
  font-family: var(--font-display);
  font-size: var(--fs-md);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ds-v2 .deck-slot-split { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ds-v2 .deck-slot-badge { font-size: 0.62rem; padding: 1px 8px; letter-spacing: 0.06em; text-transform: uppercase; }
.ds-v2 .deck-slot-badge.is-active-badge { color: #fff; background: linear-gradient(var(--light-sweep), var(--accent-bright), var(--accent-hot)); }
.ds-v2 .deck-slot-badge.is-valid-badge { color: #8ff0be; }
.ds-v2 .deck-slot-badge.is-invalid-badge { color: #ffb0b8; }
.ds-v2 .deck-slot-meta .muted { font-size: 0.72rem; line-height: 1.4; }
.ds-v2 .deck-slot-bar { display: flex; height: 5px; border-radius: var(--r-chip); overflow: hidden; box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.6); margin-top: 3px; }
.ds-v2 .deck-slot-bar i { display: block; height: 100%; }
.ds-v2 .deck-slot-actions { grid-column: 2; display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; }
.ds-v2 .deck-slot-actions .btn { min-height: 32px; font-size: 0.74rem; padding: 0 var(--sp-3); }

/* the unused slots: recessed sockets with an engraved number, so the rack is
   always full and the player can see their capacity */
.ds-v2 .deck-socket {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 7px;
  min-height: 190px;
  border: 0;
  border-radius: var(--r-panel);
  --r-self: var(--r-panel);
  cursor: pointer;
  color: var(--text-faint);
  background:
    radial-gradient(120% 90% at 22% 12%, rgb(78 60 128 / 0.16), transparent 62%),
    linear-gradient(var(--light-sweep), rgb(1 0 4 / 0.86) 0%, rgb(30 21 56 / 0.5) 100%);
  box-shadow:
    inset 3px 4px 12px rgb(0 0 0 / 0.85),
    inset 0 0 0 1px rgb(0 0 0 / 0.6),
    inset -1.5px -1.5px 0 rgb(255 255 255 / 0.075);
  animation: hb-row-in var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) backwards;
  transition: color var(--dur-micro) var(--ease-arrive), box-shadow var(--dur-micro) var(--ease-arrive);
}
/* the socket's own rebate — a second, tighter well inside the first, which is
   what stops a large recess reading as a flat dark rectangle */
.ds-v2 .deck-socket::after {
  content: "";
  position: absolute;
  inset: 12px;
  border-radius: var(--r-tile);
  pointer-events: none;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.045), inset 0 -1px 0 rgb(0 0 0 / 0.55);
  background: linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.012), transparent 55%);
}
.ds-v2 .deck-socket:disabled { cursor: default; }
.ds-v2 .deck-socket.is-live {
  color: var(--text-dim);
  background:
    radial-gradient(120% 90% at 22% 12%, rgb(120 84 200 / 0.2), transparent 62%),
    linear-gradient(var(--light-sweep), rgb(6 3 14 / 0.82) 0%, rgb(40 27 74 / 0.55) 100%);
}
.ds-v2 .deck-socket-number {
  font-family: var(--font-display);
  font-size: 2.4rem;
  line-height: 1;
  color: rgb(255 255 255 / 0.07);
  text-shadow: 0 1px 0 rgb(255 255 255 / 0.06);
}
.ds-v2 .deck-socket.is-live .deck-socket-number { position: absolute; top: 10px; right: 14px; font-size: 1.5rem; }
.ds-v2 .deck-socket-plus {
  display: grid; place-items: center;
  width: 38px; height: 38px;
  border-radius: 50%;
  color: var(--text-dim);
  background: linear-gradient(var(--light-sweep), rgb(62 46 104 / 0.9), rgb(24 16 46 / 0.92));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.16), inset 0 -1px 0 rgb(0 0 0 / 0.5), 0 3px 8px rgb(0 0 0 / 0.5);
  transition: transform var(--dur-micro) var(--ease-overshoot);
}
.ds-v2 .deck-socket-plus .hb-icon { width: 18px; height: 18px; }
.ds-v2 .deck-socket-label { font-size: 0.66rem; letter-spacing: 0.09em; text-transform: uppercase; }
@media (hover: hover) {
  .ds-v2 .deck-socket:hover:not(:disabled) { color: var(--text); box-shadow: inset 2px 2.6px 8px rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(181 108 255 / 0.3); }
  .ds-v2 .deck-socket:hover:not(:disabled) .deck-socket-plus { transform: translateY(-2px) scale(1.07); color: #fff; }
}
.ds-v2 .deck-slots-full { grid-column: 1 / -1; }

@media (max-width: 900px) {
  .ds-v2 .deck-slots-body { grid-template-columns: minmax(0, 1fr); padding: var(--sp-3); }
  .ds-v2 .deck-slot { grid-template-columns: 96px minmax(0, 1fr); }
}

/* =======================================================================
   GALLERY — faces, on a fixed aspect, on one baseline
   ======================================================================= */

.gal-v2 .gallery-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5) 0;
  max-width: 1520px;
  /* the body was itself a scroller with overflow-y:auto; nesting a second one
     inside it gave the page two scrollbars and neither of them the fade */
  overflow: hidden;
}
.gal-v2 .gallery-filters { flex: 0 0 auto; }
.gal-v2 .gallery-filters .btn { gap: 7px; }
.gal-v2 .gallery-filters .hb-icon { width: 14px; height: 14px; color: var(--text-dim); }
/* the faction crest as a lit gem, so the eleven tabs are eleven things */
.gal-v2 .gal-tab-dot {
  width: 9px; height: 9px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--c) 70%, white), var(--c) 62%, color-mix(in srgb, var(--c) 45%, black));
  box-shadow: 0 0 6px color-mix(in srgb, var(--c) 60%, transparent), inset 0 -1px 0 rgb(0 0 0 / 0.45);
}
.gal-v2 .gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--sp-3);
  align-content: start;
  padding: 2px var(--sp-3) var(--sp-6) 0;
  list-style: none;
  margin: 0;
}
/* the aspect ratio lives on the grid cell, not on the button. On the button it
   is circular — a stretched grid item takes the row height and the row height
   takes the item's — and every tile collapsed to 42px. */
.gal-v2 .gallery-cell { aspect-ratio: 3 / 4; min-width: 0; }
.gal-v2 .gallery-tile {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  overflow: hidden;
  cursor: pointer;
  border-radius: var(--r-tile);
  --r-self: var(--r-tile);
  background: linear-gradient(var(--light-sweep), rgb(46 34 80 / 0.6), rgb(12 7 26 / 0.7));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.09),
    inset 0 -1px 0 rgb(0 0 0 / 0.6),
    0 6px 14px rgb(0 0 0 / 0.45),
    0 1px 2px rgb(0 0 0 / 0.6);
  transition: transform var(--dur-micro) var(--ease-overshoot), box-shadow var(--dur-micro) var(--ease-arrive), filter var(--dur-micro);
  animation: card-tile-in 320ms var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}
.gal-v2 .gallery-tile canvas { display: block; width: 100%; height: 100%; object-fit: cover; animation: hb-tile-lit 200ms var(--ease-arrive) both; }
.gal-v2 .gallery-tile-slot {
  width: 100%; height: 100%;
  background: linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.04), rgb(0 0 0 / 0.24));
}
.gal-v2 .gallery-tile-body {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 1px;
  padding: var(--sp-3) var(--sp-3) var(--sp-2);
  text-align: left;
  pointer-events: none;
}
.gal-v2 .gallery-tile-name {
  font-family: var(--font-display);
  font-size: 0.84rem;
  line-height: 1.15;
  color: #fff;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.9);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gal-v2 .gallery-tile-role {
  font-size: 0.6rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--c, var(--text-dim));
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.9);
}
/* the faction stripe runs along the bottom edge as a gradient rather than as a
   hard 3px border on the left */
.gal-v2 .gallery-tile::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--c), color-mix(in srgb, var(--c) 12%, transparent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--c) 55%, transparent);
}
.gal-v2 .gallery-tile-crest {
  position: absolute;
  top: 7px; right: 7px;
  display: grid; place-items: center;
  width: 22px; height: 22px;
  border-radius: 50%;
  color: var(--c);
  background: rgb(4 2 10 / 0.62);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12), 0 1px 3px rgb(0 0 0 / 0.6);
}
.gal-v2 .gallery-tile-crest .hb-icon { width: 13px; height: 13px; }
@media (hover: hover) {
  .gal-v2 .gallery-tile:hover {
    transform: translateY(-5px) scale(1.03);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.18),
      0 16px 28px rgb(0 0 0 / 0.6),
      0 0 22px color-mix(in srgb, var(--c) 34%, transparent);
    z-index: 2;
  }
}
/* unseen is a change of material, never opacity alone */
.gal-v2 .gallery-tile.unseen canvas { filter: saturate(0.08) brightness(0.5) contrast(1.05); }
.gal-v2 .gallery-tile.unseen .gallery-tile-name { color: var(--text-dim); }
.gal-v2 .gallery-tile.unseen .gallery-tile-crest { color: var(--text-faint); }
.gal-v2 .gallery-tile-locked {
  position: absolute;
  top: 7px; left: 7px;
  display: grid; place-items: center;
  width: 22px; height: 22px;
  border-radius: 50%;
  color: var(--text-faint);
  background: rgb(4 2 10 / 0.72);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
}
.gal-v2 .gallery-tile-locked .hb-icon { width: 12px; height: 12px; }
.gal-v2 .gallery-note { flex: 0 0 auto; padding: 0 0 var(--sp-3); font-size: 0.74rem; }

.gal-v2 .gallery-page { min-height: 0; }
.gal-v2 .gallery-portrait canvas { border-radius: var(--r-tile); }

@media (max-width: 900px) {
  .gal-v2 .gallery-body { padding: var(--sp-2) var(--sp-3) 0; }
  .gal-v2 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: var(--sp-2); }
}
@media (max-height: 480px) {
  .gal-v2 .gallery-body { gap: var(--sp-2); padding-top: var(--sp-2); }
  .gal-v2 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 7px; }
  .gal-v2 .gallery-filters .btn { min-height: 28px; font-size: 0.68rem; padding: 0 9px; }
  /*
   * Eleven faction pills wrapped to two rows and took a hundred pixels of a
   * three-hundred-and-ninety pixel screen — a third of the cast browser spent
   * on the control for narrowing it. One row that scrolls sideways gives that
   * back, and the row still ends in air rather than at a cut.
   */
  .gal-v2 .gallery-filters {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    padding-bottom: 2px;
    mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 22px), transparent);
  }
  .gal-v2 .gallery-filters::-webkit-scrollbar { height: 0; }
  .gal-v2 .gallery-filters .btn { flex: 0 0 auto; }
  .gal-v2 .gallery-tile-name { font-size: 0.7rem; }
  .gal-v2 .gallery-tile-role { font-size: 0.54rem; }
  .gal-v2 .gallery-tile-body { padding: var(--sp-2) 8px 6px; }
}
@media (max-height: 480px) {
  .ds-v2 .deck-slots-body { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--sp-3); padding: var(--sp-2) var(--sp-3) var(--sp-4); }
  .ds-v2 .deck-slot, .ds-v2 .deck-socket { min-height: 138px; }
  .ds-v2 .deck-slot { grid-template-columns: 80px minmax(0, 1fr); }
  .ds-v2 .deck-slot-cover canvas { height: 100%; object-fit: cover; }
  /*
   * At 138px the meta column has room for the name, the badges and the leader
   * line, and it had five things in it: the Current bar, the Confluence verdict
   * and the match record ran past the bottom of their own row and printed
   * underneath the Edit and Delete buttons. Measured at 844x390 — "Edit" was
   * drawn straight through "30/30 cards". The two lines that go are the two the
   * deck builder shows in full anyway.
   */
  .ds-v2 .deck-slot { overflow: hidden; }
  /* align-self:start is what let it spill: it sizes the column to its content
     and ignores the row it was given, so the row height stopped meaning
     anything */
  .ds-v2 .deck-slot-meta { align-self: stretch; min-height: 0; overflow: hidden; }
  .ds-v2 .deck-slot-split, .ds-v2 .deck-slot-record, .ds-v2 .deck-slot-bar { display: none; }
  .ds-v2 .deck-slot-actions { flex-wrap: nowrap; }
  .ds-v2 .deck-slot-actions .btn { min-height: 28px; font-size: 0.68rem; padding: 0 8px; }
}
`;

/** Exported so a screen can time its own exit against the shared curve. */
export const KIT_EASE = { arrive: cssEase(EASE.arrive), leave: cssEase(EASE.leave) };
export { DUR as KIT_DUR, hexToRgba };
