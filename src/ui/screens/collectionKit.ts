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
import { createStyleElement } from "../styleSheet";

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
 * Draw a tile's canvas only once it is near the viewport, one card per frame,
 * nearest the eye first.
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
 * ## The three things the first version got wrong
 *
 * A CPU profile of `#lobby → #collection` at 1280×720 attributed **1,361ms to
 * `fillRect` and 301ms to `drawImage`** in a 3.4-second window, in one unbroken
 * band from t=800ms to the end of the capture. The constructor was 3ms of it.
 * A card is not five milliseconds, as the note this replaces assumed; it is
 * about **45**, and every assumption downstream of the smaller number was wrong.
 *
 * 1. **A budget of 40ms is a budget of one-and-a-bit cards, and the "bit" is the
 *    whole problem.** A `while` loop that checks the clock *before* each card
 *    starts a 45ms card at t=39 and hands the compositor a 90ms frame. Now a
 *    drain paints exactly one card unless that card came in genuinely cheap,
 *    and the pacing rests a frame afterwards, so the worst gap is one card
 *    rather than two plus the layout behind them.
 *
 * 2. **FIFO paints the cards the player scrolled *past*.** Measured after a
 *    scrollbar jump: 7 of 28 visible tiles drawn at +300ms, **zero of 22** at
 *    +1000ms, and the full row only at +4000ms — because the queue was still
 *    working through everything the grid had flown over on the way down. The
 *    queue is now ordered by distance from the middle of the scroller whenever
 *    the scroller has moved, so a jump repaints what is under the eye first and
 *    the fly-past is paid for later or not at all.
 *
 * 3. **Overscan competed with the fold.** A row of lead is worth having when
 *    the page is idle and is worth nothing while the player is still waiting to
 *    see the screen at all. So the drain runs in two gears: everything within a
 *    margin of the viewport at the fast pace, everything beyond it at a quarter
 *    of that, which keeps the lead without spending the frame rate on it.
 *
 * Returns a disposer; screens call it from `dispose`.
 */
export function lazyPaint(root: HTMLElement, margin = "500px 0px"): {
  watch: (cell: HTMLElement, paint: () => void) => void;
  release: (cell: HTMLElement) => void;
  hold: (ms: number) => void;
  lead: (px: number, releaseMs?: number) => void;
  stop: () => void;
} {
  interface Job {
    /** The cell. */
    el: Element;
    /** Its top edge in the scroller's own content coordinates. */
    top: number;
    /** Its height, so "which is nearest" compares centres rather than edges. */
    height: number;
  }

  const jobs = new WeakMap<Element, () => void>();
  let queue: Job[] = [];
  let draining = 0;
  let heldUntil = 0;
  /** Set by any scroll, and by every arrival: the order on file may be stale. */
  let unsorted = true;
  /**
   * Where the fold is, remembered rather than asked.
   *
   * A drain runs immediately after inserting a card canvas, so the layout is
   * dirty and **every** geometry read in it is a full re-layout of an
   * eight-thousand-pixel grid. The first version of this ordering read two rects
   * per drain and sixty on a re-sort, and the profile caught it exactly:
   * `getBoundingClientRect` went from nothing to **228ms** of a 3.4-second
   * navigation, and the frame gaps it was supposed to shrink got longer. So the
   * scroller's own numbers are cached and refreshed only where reading them is
   * free — inside the intersection callback and in the passive scroll handler,
   * both of which run on a layout the browser has already computed.
   */
  let viewTop = 0;
  let viewHeight = 0;

  /**
   * How much of a frame one drain may spend *starting* work.
   *
   * Six milliseconds is under a third of a 60fps frame, and because it is
   * checked before each card rather than after, it means "one card, and a
   * second one only if the first was almost free" — which is what happens for a
   * tile the renderer's own cache can answer.
   */
  const BUDGET_MS = 6;
  /**
   * Past this, the drain gives the page a frame off before the next card.
   *
   * A card at 45ms and no rest is 22fps for as long as the queue lasts, which
   * is what the measurement found: 138 frames in 3,000ms on a settled
   * collection, 27 of them over 33ms. One rest frame per card halves the
   * throughput and doubles the frame rate, and the throughput is the axis that
   * does not matter — a tile that arrives 300ms later is a tile that arrives
   * while the player is still reading the row above it, and the sleeve it
   * arrives into is drawn rather than blank.
   */
  const REST_ABOVE_MS = 12;
  /**
   * Rest frames after a card that ran long, near the fold and far from it.
   *
   * Two rather than one, and the arithmetic is the argument. A card is about
   * 43ms on this machine — profiled, 855ms of `fillRect` for the twenty tiles a
   * filter brings into view — so one rest frame is a 43/16 duty cycle and the
   * page runs at about twelve frames a second for as long as the queue lasts.
   * Two rest frames is 43/32, which measures in the thirties, and the price is
   * that a screenful fills in about a second and a half instead of a second.
   * The sleeve is drawn, so that second is a rack filling rather than a hole.
   */
  const NEAR_REST = 2;
  const FAR_REST = 4;

  const clock = (): number => (typeof performance === "object" ? performance.now() : Date.now());

  /** Read the fold from a layout somebody else already paid for. */
  const readView = (): void => {
    viewTop = root.scrollTop;
    viewHeight = root.clientHeight;
  };

  /** Put the nearest tile at the front. Arithmetic only — no layout is read. */
  const sortByProximity = (): void => {
    unsorted = false;
    if (queue.length < 2) return;
    const middle = viewTop + viewHeight / 2;
    queue.sort(
      (a, b) => Math.abs(a.top + a.height / 2 - middle) - Math.abs(b.top + b.height / 2 - middle)
    );
  };

  /**
   * How many queued tiles are actually on screen right now.
   *
   * Arithmetic on numbers that were read from a settled layout, so it is free —
   * and it is the number that should set the pace. A trickle of one tile coming
   * over the fold is worth resting for; twenty holes under the player's eyes
   * after a filter or a wheel scroll are not. The rest is therefore spent where
   * nobody is waiting and skipped where somebody is.
   *
   * ## The obvious improvement here was tried and is wrong
   *
   * The reasoning was clean: entering the deck builder with the lead cap already
   * in place paints exactly the twenty-one cards of the fold, so the backlog is
   * urgent for the whole arrival and the drain never rests once — and a 25ms card
   * on a 13.3ms grid delivers about one frame per card. Granting one rest frame
   * per card should therefore have roughly doubled the frame rate for 280ms of
   * extra fill into sleeves that are already drawn.
   *
   * It does the opposite. A/B'd with `_w9heavy.mjs`, two rounds alternating, each
   * walk carrying `#missions` as an untouched control so the two machine loads
   * could be divided out — the warm `lobby → deckbuilder`, as a fraction of the
   * control's frame rate:
   *
   *     urgent skips the rest    0.69   0.73
   *     urgent rests one frame   0.49   0.37
   *
   * The rest frames do not go to the page; they go to whatever else is queued on
   * it — the cell fill, the cascade, the atmosphere — and the fold ends up
   * interleaved with all of it instead of getting out of the way. Left as it was,
   * with the measurement written down so the next person does not spend an
   * afternoon rediscovering it.
   */
  const visibleBacklog = (): number => {
    let count = 0;
    const bottom = viewTop + viewHeight;
    for (const job of queue) {
      if (job.top + job.height > viewTop && job.top < bottom) count += 1;
      if (count > URGENT) break;
    }
    return count;
  };
  /** Above this many holes on screen, the fill stops waiting for a far-rest. */
  const URGENT = 3;

  /**
   * How far past the fold the drain will actually paint, and why it is separate
   * from the observer's own margin.
   *
   * The two numbers answer different questions. `margin` is "how early may a tile
   * join the queue", and it wants to be generous, because a tile that is queued
   * costs nothing and a wheel scroll that outruns the queue lands on empty
   * sleeves. `lead` is "how far past the fold may the drain *spend a frame*", and
   * during a navigation it wants to be mean.
   *
   * The measurement that separated them: traced with `_w9trace.mjs`, entering the
   * deck builder is **1,759ms of script in a three-second window** and essentially
   * all of it is `renderCardToCanvas`. At 1600×900 the pool shows about twenty
   * cards and a 600px lead queues about forty; at roughly 25ms a card that is
   * ~500ms of work for tiles nobody has scrolled to yet, paid inside the
   * navigation. Frames delivered track idle time almost exactly on this machine —
   * 23 frames in 1,600ms against ~400ms of idle, on a 13.3ms grid — so half a
   * second of avoidable work is half the frame rate.
   *
   * Nothing is thrown away: a job outside the lead stays at the head of the queue
   * and is painted the moment the cap is lifted.
   *
   * ## And the cap is lifted by the player, not by a clock
   *
   * The first version released it when the shell's cover came down, which moved
   * the work by about two hundred milliseconds and reduced it by nothing —
   * measured, the deck builder went from 14.4fps to 13.8 and the collection from
   * 28.1 to 23.1, because the same forty rasterisations still landed inside the
   * same window, just later in it. A frame rate that improves because work slid
   * past the edge of the sample is the twelfth instrument lie, not a fix.
   *
   * The lead exists for one thing: a wheel scroll that outruns the queue. So a
   * scroll is what releases it — the listener below already runs on every one —
   * and the timer is the backstop for a player who arrives, reads the fold and
   * never scrolls at all. Until one of those happens the queue is still full and
   * the tiles are still ordered; the drain simply spends its frames on the rows
   * somebody is looking at.
   */
  let leadPx = Number.POSITIVE_INFINITY;
  let leadTimer = 0;
  const withinLead = (job: Job): boolean => {
    if (leadPx === Number.POSITIVE_INFINITY) return true;
    return job.top + job.height > viewTop - leadPx && job.top < viewTop + viewHeight + leadPx;
  };
  const releaseLead = (): void => {
    if (leadPx === Number.POSITIVE_INFINITY) return;
    leadPx = Number.POSITIVE_INFINITY;
    window.clearTimeout(leadTimer);
    leadTimer = 0;
    if (queue.length > 0) schedule(1);
  };

  const drain = (): void => {
    draining = 0;
    const started = clock();
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
      schedule(1);
      return;
    }
    if (unsorted) sortByProximity();
    const backlog = visibleBacklog();

    let painted = 0;
    while (queue.length > 0 && clock() - started < BUDGET_MS) {
      const next = queue[0];
      if (!next) break;
      /* The queue is ordered by distance from the middle of the fold, so if the
         head is out of reach every tile behind it is too. */
      if (!withinLead(next)) break;
      queue.shift();
      const job = jobs.get(next.el);
      if (!job) continue;
      jobs.delete(next.el);
      job();
      painted += 1;
    }
    if (queue.length === 0) return;
    /* Nothing was in reach: the cap is on, or the player has scrolled away from
       everything queued. Come back at the far pace rather than every frame. */
    if (painted === 0) {
      schedule(FAR_REST);
      return;
    }
    const spent = clock() - started;
    if (spent <= REST_ABOVE_MS || backlog > URGENT) schedule(1);
    else schedule(backlog > 0 ? NEAR_REST : FAR_REST);
  };

  /** Chain `frames` animation frames before the next drain. */
  const schedule = (frames: number): void => {
    if (draining || typeof requestAnimationFrame !== "function") return;
    let left = Math.max(1, frames);
    const step = (): void => {
      left -= 1;
      if (left > 0) {
        draining = requestAnimationFrame(step);
        return;
      }
      drain();
    };
    draining = requestAnimationFrame(step);
  };

  /*
   * A scroll invalidates the order and nothing else.
   *
   * Passive, no layout read, no work: it only says that the next drain has to
   * decide again which tile is nearest. That one bit is the whole of the fix
   * for the scrollbar jump, where the queue held a hundred tiles the player had
   * flown past and the twenty-two under the cursor were behind all of them.
   */
  const onScroll = (): void => {
    // a scroll event fires against a settled layout, so this costs nothing
    readView();
    unsorted = true;
    // and a scroll is the player asking for the lead the entrance withheld
    releaseLead();
  };
  root.addEventListener("scroll", onScroll, { passive: true });

  /* No IntersectionObserver means a test environment or a very old engine; the
     honest fallback is to paint immediately rather than to show nothing. */
  const supported = typeof IntersectionObserver === "function";
  const observer = supported
    ? new IntersectionObserver(
        (entries) => {
          /*
           * The observer hands over the geometry it has already computed, and
           * that is the only reason this ordering is affordable. `entry
           * .boundingClientRect` costs nothing here; the same rectangle asked
           * for a millisecond later, from inside a drain, is a re-layout.
           */
          const origin = root.getBoundingClientRect().top;
          readView();
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (!jobs.has(entry.target)) continue;
            observer?.unobserve(entry.target);
            const box = entry.boundingClientRect;
            queue.push({ el: entry.target, top: box.top - origin + viewTop, height: box.height });
            unsorted = true;
          }
          if (queue.length > 0) schedule(1);
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
      const at = queue.findIndex((job) => job.el === cell);
      if (at >= 0) queue.splice(at, 1);
    },
    hold(ms) {
      heldUntil = clock() + ms;
      if (queue.length > 0) schedule(1);
    },
    lead(px, releaseMs) {
      leadPx = px;
      window.clearTimeout(leadTimer);
      leadTimer =
        releaseMs === undefined || px === Number.POSITIVE_INFINITY
          ? 0
          : window.setTimeout(releaseLead, releaseMs);
      if (queue.length > 0) schedule(1);
    },
    stop() {
      observer?.disconnect();
      root.removeEventListener("scroll", onScroll);
      window.clearTimeout(leadTimer);
      leadTimer = 0;
      queue = [];
      if (draining && typeof cancelAnimationFrame === "function") cancelAnimationFrame(draining);
      draining = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// arriving behind the shell's cover
// ---------------------------------------------------------------------------

export interface RevealHold {
  /** Called with a duration whenever the painter should stay asleep for longer. */
  hold: (ms: number) => void;
  /** Called once, on the first frame with no cover, before the hold is released. */
  onReveal?: () => void;
  /** Called when the hold is finally over, to widen the lead again. */
  onSettled?: () => void;
}

/**
 * Keep a screen's lazy painter asleep for exactly as long as the shell's cover
 * is up, and not one card longer.
 *
 * ## Why this is one function and used to be three
 *
 * All three heavy screens need the same thing and each had invented its own
 * answer. The Collection ran a bespoke rAF loop watching `.nav-curtain`. The
 * gallery used a `MutationObserver` and a 2,060ms ceiling. The **deck builder
 * used a fixed `DUR.ui + 160`** — a guess about how long the shell would take —
 * and the two numbers are coupled in the worst possible direction: measured with
 * `_w9heavy.mjs`, the deck builder's cover comes down at 454–480ms and its
 * painter woke at 420, so the last thing that happened before the reveal was a
 * card rasterisation, and the shell parts its veil on two consecutive frames
 * under 34ms. A guess cannot win a race against an event it is guessing about.
 *
 * The event is observable, so it is observed: `.nav-curtain` is in the document
 * while the cover is up and gone when it is not. If a build never draws one, the
 * caller's own fixed hold is still the ceiling and this degrades to nothing.
 *
 * The four clear frames afterwards cover the reveal's own 210ms of panel travel,
 * so the first card does not land on top of the curtain opening.
 *
 * Returns a canceller; screens call it from `dispose`.
 */
export function holdWhileVeiled(spec: RevealHold): () => void {
  if (typeof requestAnimationFrame !== "function" || typeof document === "undefined") {
    spec.onReveal?.();
    spec.onSettled?.();
    return () => {};
  }
  const clock = (): number => (typeof performance === "object" ? performance.now() : Date.now());
  const deadline = clock() + 2600;
  let clear = 0;
  let wasVeiled = false;
  let handle = 0;
  let stopped = false;

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    spec.onSettled?.();
  };

  const tick = (): void => {
    if (stopped) return;
    if (clock() > deadline) {
      finish();
      return;
    }
    if (document.querySelector(".nav-curtain") !== null) {
      wasVeiled = true;
      spec.hold(220);
      clear = 0;
      handle = requestAnimationFrame(tick);
      return;
    }
    clear += 1;
    if (clear === 1 && wasVeiled) spec.onReveal?.();
    if (clear >= 4) {
      finish();
      return;
    }
    spec.hold(150);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (handle && typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    handle = 0;
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
export interface PortraitSpec {
  /** Where the crop sits horizontally, 0–1. 0.5 centres; a banner biases right. */
  focusX?: number;
  /**
   * Where the crop sits vertically, 0–1, default 0.18.
   *
   * A card painting puts the face high in a portrait window, so a tile that
   * centres its crop takes the head off. 0.18 is right for a 3:4 tile; a wide
   * banner that is going to be cropped a second time by `object-fit` wants
   * nearly zero, or the two crops compound and the forehead goes.
   */
  focusY?: number;
  /** Draw the bottom scrim the name sits on. Off when CSS is drawing its own. */
  scrim?: boolean;
  /** Called after every paint with whether the artist's PNG was the source. */
  onArt?: (painted: boolean) => void;
}

export function portraitCanvas(
  card: CardDef,
  width: number,
  height: number,
  spec: PortraitSpec = {}
): HTMLCanvasElement {
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const focusX = spec.focusX ?? 0.5;
  const focusY = spec.focusY ?? 0.18;

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
      ctx.drawImage(art, (width - w) * focusX, (height - h) * focusY, w, h);
    } else {
      /**
       * The placeholder is drawn, then pulled back into the paintings' range.
       *
       * §10 forbids downweighting it — 176 cards wear it and it is a long-lived
       * state that must read as deliberate. But §6 says saturation is a
       * resource, and measured against the real portraits it was spending all
       * of it: the renderer's procedural fields are an even mid-value at full
       * chroma across the whole tile, while a painting is dark with a few lit
       * passages. In a grid of ninety, the unpainted tiles were the loudest
       * thing on the screen and the finished art receded behind them, which is
       * precisely backwards.
       *
       * So it keeps its full construction and loses a third of its chroma and a
       * fifth of its value — enough that the eye lands on the paintings first,
       * not so much that the tile reads as broken. The `art pending` mark that
       * goes with it is the caller's, in real type on the tile.
       */
      const draft = document.createElement("canvas");
      draft.width = canvas.width;
      draft.height = canvas.height;
      const dctx = draft.getContext("2d");
      if (dctx) {
        dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawPlaceholderArt(dctx, { x: 0, y: 0, w: width, h: height }, card.current, card.name);
        ctx.save();
        ctx.filter = "saturate(0.62) brightness(0.8) contrast(1.04)";
        ctx.drawImage(draft, 0, 0, width, height);
        ctx.restore();
      } else {
        drawPlaceholderArt(ctx, { x: 0, y: 0, w: width, h: height }, card.current, card.name);
      }
      // a vignette, so an even field acquires the value structure a painting has
      const corner = ctx.createRadialGradient(
        width * 0.42,
        height * 0.34,
        Math.min(width, height) * 0.16,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.78
      );
      corner.addColorStop(0, "rgba(0,0,0,0)");
      corner.addColorStop(1, "rgba(3,1,8,0.5)");
      ctx.fillStyle = corner;
      ctx.fillRect(0, 0, width, height);
    }

    // the scrim the name sits on — §4 never puts text straight onto imagery
    if (spec.scrim !== false) {
      const scrim = ctx.createLinearGradient(0, height * 0.42, 0, height);
      scrim.addColorStop(0, "rgba(6,3,14,0)");
      scrim.addColorStop(0.62, "rgba(6,3,14,0.62)");
      scrim.addColorStop(1, "rgba(6,3,14,0.94)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, height * 0.42, width, height * 0.58);
    }

    // the 315° key, so a portrait tile is lit like every other surface
    const key = ctx.createLinearGradient(0, 0, width, height);
    key.addColorStop(0, "rgba(255,255,255,0.11)");
    key.addColorStop(0.35, "rgba(255,255,255,0)");
    key.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, width, height);

    spec.onArt?.(havePainting);
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
  /**
   * False when the gesture is understood and will still be refused — a 30/30
   * deck, a third copy of a two-max common.
   *
   * Without it, "you cannot do this" was drawn as *nothing at all*: no zone lit,
   * no colour on the ghost, and a card that simply went home when you let go of
   * it. §5 asks for every state to be designed and refusal is a state; a drag
   * that gives no answer is indistinguishable from a drag the game did not
   * notice.
   */
  allowed?: () => boolean;
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
  let allowed = true;

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
    for (const zone of zones) {
      zone.classList.remove("hb-drop-over", "hb-drop-live", "hb-drop-deny", "hb-drop-deny-over");
    }
    handle.classList.remove("hb-dragging");
    document.body.classList.remove("hb-drag-active");
    over = null;
    live = false;
    pointer = -1;
    allowed = true;
    spec.onOver?.(null);
    spec.onDrop(drop);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    if (!live) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
      live = true;
      zones = spec.zones();
      allowed = spec.allowed ? spec.allowed() : true;
      ghost = spec.ghost();
      ghost.className = `hb-drag-ghost${allowed ? "" : " is-refused"} ${ghost.className}`.trim();
      document.body.appendChild(ghost);
      handle.classList.add("hb-dragging");
      document.body.classList.add("hb-drag-active");
      for (const zone of zones) zone.classList.add(allowed ? "hb-drop-live" : "hb-drop-deny");
    }
    place(event.clientX, event.clientY);
    const next = zoneAt(event.clientX, event.clientY);
    if (next !== over) {
      over?.classList.remove("hb-drop-over", "hb-drop-deny-over");
      next?.classList.add(allowed ? "hb-drop-over" : "hb-drop-deny-over");
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
  /**
   * The last pair written, so a fade that has not changed writes nothing.
   *
   * This is the whole of the fix and it is not a micro-optimisation. Setting a
   * custom property on the wrapper invalidates style for its subtree, so the
   * *next* frame's `scrollHeight` read has to recompute the layout of an
   * eight-thousand-pixel grid before it can answer — a read/write ping-pong in
   * which the write is almost always redundant, because the answer to "is there
   * more below" changes twice in the life of a screen. Profiled on the
   * navigation into the collection at 1280×720, `sync` alone was **99ms** of the
   * window in which the shell is waiting for two calm frames to part its veil.
   */
  let wroteTop = "";
  let wroteBottom = "";
  const sync = (): void => {
    const top = scroller.scrollTop;
    const room = scroller.scrollHeight - scroller.clientHeight;
    const wantTop = top > 6 ? "1" : "0";
    const wantBottom = room - top > 6 ? "1" : "0";
    if (wantTop !== wroteTop) {
      wroteTop = wantTop;
      wrap.style.setProperty("--fade-top", wantTop);
    }
    if (wantBottom !== wroteBottom) {
      wroteBottom = wantBottom;
      wrap.style.setProperty("--fade-bottom", wantBottom);
    }
  };
  /*
   * One read per frame at most, on the axis the player is moving.
   */
  let queued = 0;
  const later = (): void => {
    if (queued || typeof requestAnimationFrame !== "function") return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      sync();
    });
  };
  /*
   * The scroll handler goes through the frame gate; the resize handler goes
   * through a timer.
   *
   * They are asking the same question for opposite reasons. A scroll changes the
   * answer *now* and the player is looking at the edge it changes. A resize
   * fires because the grid grew by one card canvas, thirty-five times during a
   * mount, in the middle of the only window on this navigation where a dropped
   * frame is expensive — and an end fade that catches up 180ms after the last
   * tile lands is a fade nobody can see arriving.
   */
  scroller.addEventListener("scroll", later, { passive: true });
  let resizeTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(later, 180);
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  observer?.observe(scroller);
  sync();
  return () => {
    scroller.removeEventListener("scroll", later);
    observer?.disconnect();
    window.clearTimeout(resizeTimer);
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
  const style = createStyleElement(document);
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
  /* The rack's row height, tied to the window rather than to a constant: three
     rows plus the rail have to clear the body at both 900 and 720, and a fixed
     208px clears one of them. */
  --slot-h: clamp(128px, 22vh, 208px);
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
.hb-current-code { font-size: var(--fs-micro); letter-spacing: 0.06em; font-weight: 700; }
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
/*
 * Refusal, drawn.
 *
 * The ghost loses its colour and gains a hard rim, the target says no in the
 * same language it says yes, and the cursor changes — three cues, not one, so
 * the answer does not depend on the player noticing a hue. §6's rule about
 * never signalling by colour alone applies to a drag as much as to a chip.
 */
.hb-drag-ghost.is-refused {
  filter: grayscale(0.75) brightness(0.62) drop-shadow(0 20px 26px rgb(0 0 0 / 0.7));
  outline: 2px solid var(--danger);
  outline-offset: 2px;
  border-radius: 10px;
}
body.hb-drag-active:has(.hb-drag-ghost.is-refused) * { cursor: not-allowed !important; }
.hb-drop-deny {
  box-shadow: inset 0 0 0 1px rgb(255 90 120 / 0.22);
  transition: box-shadow var(--dur-micro) var(--ease-arrive);
}
.hb-drop-deny-over {
  box-shadow:
    inset 0 0 0 2px var(--danger),
    inset 0 0 26px rgb(255 90 120 / 0.16);
}

/* one row entrance, shared by the deck list and the slot rack */
.hb-row-in { animation: hb-row-in var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) backwards; }
@keyframes hb-row-in {
  from { opacity: 0; transform: translateX(-10px) scaleY(0.7); }
}
:root[data-reduced-motion="true"] .hb-row-in { animation-duration: 80ms; animation-name: hb-row-fade; }
@keyframes hb-row-fade { from { opacity: 0; } }

/*
 * And one row exit, which the same list did not have.
 *
 * A row whose last copy was removed used to be deleted by a sweep from the end
 * of the list, so the rows below it jumped up on the frame the click landed and
 * nothing said which card had gone. It folds now: the row loses its colour and
 * its height over one UI beat, and the rows under it close the gap as it goes,
 * which is the same beat and the same curve as the insert it mirrors.
 *
 * The height *is* a layout animation and it is deliberate. §3a bans animating a
 * paint or layout property "on many elements at once"; this is one row, inside a
 * 'contain: layout' scroll region, and there is no other way to make the list
 * close behind it.
 */
.hb-row-out {
  overflow: hidden;
  pointer-events: none;
  transform-origin: top center;
  animation: hb-row-out var(--dur-ui) var(--ease-leave) both;
}
@keyframes hb-row-out {
  0%   { opacity: 1; transform: scaleY(1) translateX(0); max-height: 60px; }
  50%  { opacity: 0; transform: scaleY(0.6) translateX(-14px); max-height: 60px; }
  100% { opacity: 0; transform: scaleY(0.6) translateX(-14px); max-height: 0; padding-top: 0; padding-bottom: 0; margin-top: 0; margin-bottom: 0; }
}
:root[data-reduced-motion="true"] .hb-row-out { animation-duration: 90ms; }

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
/* The scroll region takes the room, whether or not it has anything in it. It
   was sized to its content, which is invisible while there are eight thousand
   pixels of cards in it and obvious the moment there are none: the empty plate
   collapsed the grid to its own height and then sat at the top of a screen it
   was supposed to be in the middle of. */
.col-v2 .collection-main > .hb-scrollwrap { flex: 1 1 auto; }
/* Centred in the room it is standing in, not pinned near the top of it. With
   every shelf hidden the grid has one child, so switching it to a centring flex
   box for that one case cannot disturb the shelf layout. */
.col-v2 .card-grid:has(> .hb-empty) { display: flex; align-items: center; justify-content: center; }
.col-v2 .card-grid > .hb-empty { margin: 0 auto; }

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
  padding: 1px 7px; font-size: var(--fs-micro);
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
  font-size: var(--fs-micro); padding: 0 6px; line-height: 1.5;
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

/* the disclosure only exists where the rail does not fit beside the grid */
.col-v2 .filter-disclose { display: none; }
.col-v2 .filter-scrim { display: none; }

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
.col-v2 .col-shelf-count { font-size: var(--fs-micro); color: var(--text-faint); }

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
  position: relative;
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
    linear-gradient(
      var(--light-sweep),
      color-mix(in srgb, var(--tile-key, #6a5bb0) 22%, rgb(10 6 22 / 0.86)),
      rgb(3 2 8 / 0.62)
    );
  box-shadow:
    inset 1px 1.4px 4px rgb(0 0 0 / 0.62),
    inset -1px -1px 0 rgb(255 255 255 / 0.05),
    inset 0 0 0 1px color-mix(in srgb, var(--tile-key, #6a5bb0) 16%, transparent);
}
/*
 * The sleeve carries the two facts the bitmap would have carried.
 *
 * Measured after a wheel scroll: 4 of 25 visible tiles painted at +200ms, 15 at
 * +600ms. For that half-second the grid was twenty-one identical holes, and the
 * information a player scanning a collection actually wants from a tile at a
 * glance — what it costs, and which Current it belongs to — is a number and a
 * hue, neither of which needs a canvas. So the sleeve wears the card's Current
 * in its fill and its Hype in the same blue gem the shelf header and the deck
 * row already use. A tile is never a blank rectangle, not even for one frame,
 * and the wave of real cards landing over the top of it reads as the rack being
 * filled rather than as the screen failing to draw.
 */
.col-v2 .card-cell .card-slot::after {
  content: attr(data-cost);
  position: absolute;
  top: 7%; left: 7%;
  display: grid; place-items: center;
  width: 24%; aspect-ratio: 1;
  border-radius: 50%;
  font-size: var(--fs-micro);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.62);
  background: linear-gradient(var(--light-sweep), rgb(127 212 255 / 0.34), rgb(43 111 214 / 0.3) 60%, rgb(22 51 109 / 0.34));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.2), inset 0 -1px 2px rgb(0 0 0 / 0.4);
}
@media (max-width: 900px), (max-height: 480px) {
  .col-v2 .card-cell .card-slot::after { font-size: var(--fs-micro); }
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

/*
 * Where a filtered-out card goes.
 *
 * A layer pinned over the scroller, clipped to it, taking no clicks and holding
 * nothing for longer than one micro beat. The tiles inside it are the real
 * tiles, re-parented at the box they were last measured in, so nothing is
 * cloned and no canvas is drawn twice.
 */
.col-v2 .col-leave-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 2;
}
.col-v2 .card-cell.is-leaving {
  animation: col-tile-out var(--dur-micro) var(--ease-leave) both;
  pointer-events: none;
}
@keyframes col-tile-out {
  to { opacity: 0; transform: scale(0.9) translateY(6px); filter: brightness(0.7); }
}
:root[data-reduced-motion="true"] .col-v2 .card-cell.is-leaving { animation-duration: 70ms; }

.col-v2 .card-count {
  bottom: 1px; right: 3px;
  font-size: var(--fs-micro);
  padding: 1px 8px;
  transition: color var(--dur-micro) var(--ease-arrive);
}
/* a full set is the resting state: present, legible, and not competing */
.col-v2 .card-count.is-max { color: var(--text-faint); background: none; box-shadow: none; padding: 1px 4px; }
.col-v2 .card-cell:hover .card-count.is-max { color: var(--text-dim); }
/* a part-set is the one you would do something about */
.col-v2 .card-count.is-partial { color: var(--accent-gold, #ffcf6a); }

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
/*
 * "Maximum copies" is a *finished* state, not a dimmed hero.
 *
 * The shared button dims a disabled primary and leaves the fill alone, so the
 * one button in this domain that spends currency sat there as a full-chroma
 * magenta lozenge with grey text on it — measured well under the 4.5:1 the
 * accessibility floor requires, and reading as the screen's call to action
 * while refusing to be pressed. A4 is explicit that a disabled state changes
 * fill *and* border *and* icon. So it becomes what it is: a filled socket,
 * recessed, with the tick and the label at full contrast on a dark ground.
 */
.col-v2 .cd-actions .btn-primary:disabled {
  opacity: 1;
  color: var(--text-dim);
  background: linear-gradient(var(--light-sweep), rgb(6 3 14 / 0.86) 0%, rgb(30 21 56 / 0.62) 100%);
  box-shadow:
    inset 1.6px 2px 5px rgb(0 0 0 / 0.72),
    inset 0 0 0 1px rgb(0 0 0 / 0.5),
    inset -1px -1px 0 rgb(255 255 255 / 0.06);
  text-shadow: none;
}
.col-v2 .cd-actions .btn-primary:disabled .hb-icon { color: var(--success, #6ee7a8); opacity: 0.85; }
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
/*
 * Under the breakpoint the rail becomes a sheet over the grid.
 *
 * It used to be display:none. Measured at 844×390: fifty-four filter chips in
 * the document, none of them visible, no disclosure control, and the only
 * filter-related button on the screen was "Clear filters" — so the answer to
 * "narrow 245 cards on a phone in landscape" was the search box and nothing
 * else. §9 makes landscape a hard constraint that overrides aesthetics.
 *
 * The sheet is the same element with the same chips, translated off-canvas and
 * slid back on the arrive curve. Visibility is what takes it out of the tab
 * order while it is off-screen, delayed by the length of the slide so the exit
 * is still drawn; a transform alone would leave fifty-four reachable buttons
 * sitting three hundred pixels to the left of the window.
 */
@media (max-width: 900px) {
  .col-v2 .collection-body { grid-template-columns: minmax(0, 1fr); position: relative; }
  .col-v2 .filter-disclose {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
    min-height: 44px;
  }
  .col-v2 .filter-disclose .filter-active-count { padding: 1px 7px; font-size: var(--fs-micro); }
  .col-v2 .filter-rail {
    display: grid;
    position: absolute;
    top: 0; bottom: 0; left: 0;
    z-index: 30;
    width: min(300px, 84vw);
    visibility: hidden;
    transform: translateX(-104%);
    transition: transform var(--dur-ui) var(--ease-arrive), visibility 0s linear var(--dur-ui);
    box-shadow: 22px 0 46px rgb(0 0 0 / 0.6), 0 18px 40px rgb(0 0 0 / 0.55);
  }
  .col-v2.rail-open .filter-rail {
    visibility: visible;
    transform: none;
    transition-delay: 0s, 0s;
  }
  .col-v2 .filter-scrim {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgb(3 2 8 / 0.58);
    backdrop-filter: blur(3px);
    animation: col-scrim-in var(--dur-ui) var(--ease-arrive) both;
  }
  .col-v2 .filter-scrim[hidden] { display: none; }
  @keyframes col-scrim-in { from { opacity: 0; } }
  .col-v2 .col-shelf-grid { grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: var(--sp-3) var(--sp-2); padding: var(--sp-3) var(--sp-2); }
  .col-v2 .cd-stage { max-height: 96vh; }
  .col-v2 .cd-panel { padding: var(--sp-3); }
}
:root[data-reduced-motion="true"] .col-v2 .filter-rail { transition-duration: 90ms; }
/* A phone in landscape has 390px of height and about 150 of it is chrome, so a
   168px tile leaves one and a half rows. Everything shrinks: the tile, the
   shelf header, the toolbar, and the gap between them. */
@media (max-height: 480px) {
  .col-v2 .collection-body { padding: var(--sp-2) var(--sp-3) var(--sp-2); gap: var(--sp-2); }
  .col-v2 .collection-main { gap: var(--sp-2); }
  .col-v2 .col-shelf-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: var(--sp-3) 7px; padding: 10px 8px 8px; }
  .col-v2 .col-shelf { margin-bottom: var(--sp-3); }
  .col-v2 .col-shelf-head { padding: 3px 8px; }
  .col-v2 .col-shelf-gem { width: 19px; height: 19px; font-size: var(--fs-micro); }
  .col-v2 .card-cell { padding-bottom: 15px; }
  .col-v2 .card-count { font-size: var(--fs-micro); padding: 0 6px; }
  /* --touch-min is base.css's 44px floor written as a value: 0 on a mouse,
     44px on a finger. These two are *housings* — one holds an input, the other
     holds the ownership tabs — and an element-selector floor cannot reach a
     housing, so a 36px field on a phone would have a 44px control hanging out
     of the bottom of it. */
  .col-v2 .search-field, .col-v2 .ownership-tabs { height: max(36px, var(--touch-min)); }
  .col-v2 .filter-disclose { min-height: 36px; padding: 0 10px; font-size: 0.72rem; }
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
  /*
   * The column is stated, and it has to be.
   *
   * An implicit grid column is auto-sized, resolving to the larger of the
   * available space and the row's min-content — so at --ui-scale 1.4 the header
   * row's "30/30 · Average cost 2.6 · six type pills" was wider than the panel
   * and every row in the panel grew with it, pushing the deck list's copy counts
   * and the Clear button off the right of a 1280px window. Measured: 16px of
   * overflow on .builder-side-head and everything below it. A minmax track
   * with a zero floor lets the row be smaller than its contents, which is what
   * makes the ellipsis and the wrapping below actually reachable.
   */
  grid-template-columns: minmax(0, 1fr);
  padding: 0;
  overflow-x: hidden;
  /*
   * auto on the block axis, as the last resort behind the pinned footer.
   *
   * The three-row grid keeps the footer off the bottom for as long as there is
   * a middle row left to give up. Once the header and the footer *together*
   * exceed the panel there is nothing left to take, and the footer is pushed
   * out of a box that clips. At 667x375 with 1.6x type the action row wraps to
   * two lines, head plus foot come to 182px inside a 172px panel, and three
   * pixels of the 44px "Auto-Complete" button sat outside it - rendered, and
   * impossible to press. verify:mobile reported all four buttons in the row.
   *
   * hidden on the inline axis is kept deliberately: the minmax column above
   * exists so that over-wide content ellipsises instead of scrolling sideways,
   * and this must not undo it.
   *
   * No backticks in this comment, and none anywhere in this stylesheet: the
   * whole sheet is a template literal, so one would end the string.
   */
  overflow-y: auto;
  overscroll-behavior: contain;
  gap: 0;
}
.db-v2 .builder-side-head {
  padding: var(--sp-3) var(--sp-4) var(--sp-3);
  border-bottom: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.05);
  display: flex; flex-direction: column; gap: var(--sp-2);
}
/*
 * The list ends in air, and no row ever rests half under the footer.
 *
 * Measured at 3x, "Light Stick Wave" was sliced through its own cap height by a
 * hard one-pixel rule running the full width of the panel, which is §7's
 * "dividers that fade at the ends" failing twice over — the divider did not
 * fade, and the content butting into it did not either. The scroll padding is
 * the half of it nobody sees: a row scrolled to by the keyboard, or by
 * 'scrollIntoView' after an add, used to come to rest exactly on the boundary.
 */
.db-v2 .builder-side-scroll {
  padding: var(--sp-3) var(--sp-3) var(--sp-5) var(--sp-4);
  display: flex; flex-direction: column; gap: var(--sp-3);
  scroll-padding-block-end: 34px;
}
.db-v2 #db-side-wrap::after { height: 56px; }
.db-v2 .builder-side-foot {
  position: relative;
  padding: var(--sp-3) var(--sp-4);
  border-top: 0;
  background: linear-gradient(var(--light-sweep), rgb(34 24 62 / 0.72), rgb(13 8 28 / 0.82));
  display: flex; flex-direction: column; gap: var(--sp-2);
}
/* the hairline the foundation already draws: a dark line over a lit one, both
   fading across the outer 15% at each end so the rule never butts into the
   panel wall */
.db-v2 .builder-side-foot::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 2px;
  pointer-events: none;
  background-image:
    linear-gradient(90deg, transparent, var(--hairline-dark) 15%, var(--hairline-dark) 85%, transparent),
    linear-gradient(90deg, transparent, var(--hairline-lit) 15%, var(--hairline-lit) 85%, transparent);
  background-repeat: no-repeat;
  background-size: 100% 1px, 100% 1px;
  background-position: 0 0, 0 100%;
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

/* wraps rather than overflows once the text scale is turned up */
.db-v2 .deck-stats { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; min-width: 0; }
.db-v2 .deck-count { flex: 0 0 auto; white-space: nowrap; line-height: 1; }
.db-v2 .deck-count-value { font-size: var(--fs-2xl); }
.db-v2 .deck-meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.db-v2 .deck-meta .muted b { color: var(--text); }
.db-v2 .deck-types { display: flex; flex-wrap: wrap; gap: 4px; }
.db-v2 .type-pill {
  display: inline-flex; align-items: baseline; gap: 5px;
  padding: 2px 8px;
  font-size: var(--fs-micro);
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
/* Nothing in the chart moves on a layout property any more: the fills scale
   from their own bottom edge, the labels and the target lids translate, and the
   whole thing is one composited pass. §3a's non-negotiables are explicit that a
   layout animation is not an option even when containment makes it cheap. */
.db-v2 .curve-bars { position: relative; display: flex; align-items: flex-end; gap: 4px; height: 100%; contain: layout style; }
.db-v2 .curve-bar { flex: 1 1 0; position: relative; height: 100%; display: flex; align-items: flex-end; }
.db-v2 .curve-fill {
  width: 100%;
  height: 100%;
  border-radius: 3px 3px 0 0;
  transform: scaleY(0);
  transform-origin: bottom center;
  background: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--accent-bright) 88%, white), var(--accent) 55%, var(--accent-hot));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35), 0 -1px 6px rgb(181 108 255 / 0.3);
  transition: transform var(--dur-ui) var(--ease-overshoot) var(--bar-delay, 0ms);
  min-height: 0;
}
/* An empty bucket keeps a two-pixel rail. Without it the axis appeared to start
   at 1 — the zero column was nothing at all, and its "0" label floated twenty
   pixels above the "0" axis tick with a gap between two identical characters. */
.db-v2 .curve-bar.is-empty .curve-fill {
  background: rgb(255 255 255 / 0.1);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12);
  border-radius: 2px;
}
.db-v2 .curve-bar.is-thin .curve-fill { background: linear-gradient(var(--light-sweep), #ffd27a, #f0a63c 55%, #c96b18); }
/*
 * The target, drawn per bucket as a dashed lid stepping over each column.
 *
 * It was one flat rule at the mean of the target curve, under a caption reading
 * "Thinnest at 3 Hype — 2 short of the target curve". A flat line cannot be
 * short at 3 and right at 2, so the chart and its own caption disagreed about
 * what was being compared. Eight lids at eight targets make the shape visible,
 * and the column that is under its own lid is the one the sentence names.
 */
.db-v2 .curve-step {
  position: absolute;
  left: -1px; right: -1px; bottom: 0;
  height: 0;
  border-top: 1.5px dashed rgb(255 255 255 / 0.34);
  pointer-events: none;
  transition: transform var(--dur-ui) var(--ease-arrive) var(--bar-delay, 0ms);
}
.db-v2 .curve-bar.is-short .curve-step { border-top-color: rgb(255 210 122 / 0.7); }
.db-v2 .curve-step[hidden] { display: none; }
.db-v2 .curve-count {
  position: absolute;
  left: 50%;
  /* top:auto is load-bearing. The shared stylesheet pins this element to
     top:-2px, and an absolutely positioned box with both top and bottom set
     stretches between them — which drew the count's dark plate as a 60px black
     column down the middle of every bar. */
  top: auto;
  bottom: 0;
  transform: translate(-50%, 0);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  padding: 0 3px;
  border-radius: 3px;
  background: rgb(6 3 14 / 0.72);
  transition: transform var(--dur-ui) var(--ease-overshoot) var(--bar-delay, 0ms);
}
.db-v2 .curve-count[hidden] { display: none; }
.db-v2 .curve-axis { display: flex; gap: 4px; }
.db-v2 .curve-axis span { flex: 1 1 0; text-align: center; font-size: var(--fs-micro); color: var(--text-faint); font-variant-numeric: tabular-nums; }
.db-v2 .curve-note { font-size: 0.7rem; margin: 0; }

/* ---- the deck list ----------------------------------------------------- */

.db-v2 .deck-list-block { display: flex; flex-direction: column; gap: 4px; }
.db-v2 .deck-list-head { display: flex; align-items: baseline; gap: var(--sp-2); flex-wrap: wrap; min-width: 0; }
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
  font-size: var(--fs-micro);
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
.db-v2 .deck-row-name { font-size: 0.8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-v2 .deck-row-count { font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--text-dim); min-width: 20px; text-align: right; }
.db-v2 .deck-row.is-max .deck-row-count { color: var(--accent-gold); }
.db-v2 .deck-legend { display: flex; flex-wrap: wrap; gap: var(--sp-2); font-size: var(--fs-micro); color: var(--text-faint); padding: 5px 4px 0; }
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
/* The action row counts its own columns.
   A 1fr track has an auto floor, so it can never be narrower than the
   longest word in it — which at --ui-scale 1.4 pushed "Clear" past the right
   edge of a 1280px window with the grid still insisting it was four columns
   wide. Sizing by a rem floor means the row drops to two columns when the type
   grows instead of overflowing at four. */
.db-v2 .builder-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: 6px; }
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

/*
 * At 1280x720 the deck list was a four-row peephole again.
 *
 * The pinned footer fixed the unreachable Save button, but it fixed it by
 * taking 150px off the middle row, and the header's six type pills wrapped to
 * three lines in a 320px column: measured, the list — the object the player
 * came here to edit — got 175px of a 610px panel. Nothing here is removed;
 * every part is drawn tighter. The five actions go on two rows instead of
 * three, the pills go on one line instead of three, and the list gains about a
 * hundred pixels, which is three more rows of deck.
 */
@media (max-height: 800px) {
  .db-v2 .curve-frame { height: 58px; }
  .db-v2 .builder-side-head { padding: var(--sp-2) var(--sp-3); }
  .db-v2 .deck-types { gap: 3px; }
  .db-v2 .type-pill { padding: 1px 6px; font-size: var(--fs-micro); gap: 4px; }
  .db-v2 .type-pill b { font-size: 0.7rem; }
  .db-v2 .deck-count-value { font-size: var(--fs-xl); }
  .db-v2 .builder-side-foot { padding: var(--sp-2) var(--sp-3); gap: 5px; }
  .db-v2 .builder-actions { grid-template-columns: repeat(auto-fit, minmax(5.2rem, 1fr)); gap: 5px; }
  .db-v2 .builder-actions .btn { min-height: 32px; font-size: var(--fs-micro); padding: 0 8px; }
  .db-v2 .builder-actions .btn:first-child { min-height: 38px; font-size: var(--fs-sm); }
  .db-v2 .builder-actions .btn { white-space: nowrap; }
  .db-v2 .builder-actions .btn-note { display: none; }
  .db-v2 .builder-side-scroll { padding: var(--sp-2) var(--sp-2) var(--sp-3) var(--sp-3); gap: var(--sp-2); }
  .db-v2 .curve-note { font-size: var(--fs-micro); }
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
  /* Same housing rule as the collection's toolbar; see --touch-min. */
  .db-v2 .leader-select, .db-v2 .search-field { height: max(36px, var(--touch-min)); min-height: max(36px, var(--touch-min)); }
  .db-v2 .curve-frame { height: 46px; }
  .db-v2 .deck-count-value { font-size: var(--fs-lg); }
  .db-v2 .deck-types { display: none; }
  .db-v2 .builder-side-head { padding: 6px var(--sp-3); }
  .db-v2 .builder-side-foot { padding: 6px var(--sp-3); }
  .db-v2 .builder-actions { grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .db-v2 .builder-actions .btn { min-height: 30px; font-size: var(--fs-micro); padding: 0 6px; }
  .db-v2 .deck-validation { font-size: var(--fs-micro); }
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
/* Five columns, not four, and pinned at five rather than auto-filled.
   The active deck takes two columns by two rows, so a five-wide rack of three
   rows is exactly fifteen cells for one hero and eleven sockets — no ragged
   tail at any deck count, and no scroll. At four columns the same twelve slots
   are four rows and the last one is below the fold at 1280x720, which means a
   rack that cannot tell you your own capacity without being scrolled. */
.ds-v2 .deck-slots-body {
  max-width: 1520px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(246px, 1fr));
  gap: var(--sp-3);
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

/*
 * A saved deck is a painted spine, and the paint is the whole tile.
 *
 * The rack of twelve fixed the empty room, and then made a new version of the
 * same mistake: twelve boxes of equal weight, eleven of them empty, so squinting
 * at the screen — §6's own test — resolved into one grey mass with no subject.
 * A deck you own is the only thing on this screen worth looking at, so it gets
 * the art, at the size of the tile, with the copy on a scrim over the dark side
 * of it. The sockets did not change; they simply stopped being the loudest
 * thing on the shelf.
 *
 * The isolation is load-bearing: the art sits at z-index -1 so it paints over
 * the panel material and under the copy, and without a stacking context of its
 * own it would go behind the rack's plane instead.
 */
.ds-v2 .deck-slot {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-3);
  min-height: var(--slot-h);
  border-radius: var(--r-panel);
  --r-self: var(--r-panel);
  animation: hb-row-in var(--dur-ui) var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}
/*
 * The active deck is the hero, and it takes a quarter of the rack.
 *
 * Two columns by two rows is not an arbitrary size: a five-wide rack of three
 * rows is fifteen cells, the hero takes four of them and the other eleven slots
 * take one each, so the shelf is exactly full at every deck count from one to
 * twelve and never has a ragged tail. It is also the only tile on the screen
 * that reads from across the room, which is the point — this is the deck the
 * game will actually deal you.
 */
.ds-v2 .deck-slot.is-active {
  grid-column: span 2;
  grid-row: span 2;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.14),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent),
    inset 0 -1px 0 rgb(0 0 0 / 0.63),
    0 14px 28px rgb(0 0 0 / 0.5),
    0 0 24px rgb(181 108 255 / 0.22);
}
.ds-v2 .deck-slot-cover {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  border-radius: inherit;
}
.ds-v2 .deck-slot-cover canvas {
  display: block;
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: 66% 4%;
  animation: hb-tile-lit 260ms var(--ease-arrive) both;
}
/* Three scrims. The vertical one carries the copy — §4 never puts text straight
   onto imagery — the horizontal ramp keeps a small tile legible when the text
   fills most of it, and the 315° pass puts the same key light on the banner that
   every other surface in the game carries. */
.ds-v2 .deck-slot-cover::after {
  content: "";
  position: absolute; inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to top, rgb(3 1 8 / 0.95) 0%, rgb(3 1 8 / 0.88) 26%, rgb(3 1 8 / 0.42) 54%, rgb(3 1 8 / 0.06) 82%),
    linear-gradient(to right, rgb(6 3 14 / 0.78) 0%, rgb(6 3 14 / 0.44) 42%, rgb(6 3 14 / 0.08) 84%),
    linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.09), transparent 38%, rgb(0 0 0 / 0.3));
}
/* the hero is tall enough that the copy only needs the bottom third, so the
   painting keeps the rest of itself */
.ds-v2 .deck-slot.is-active .deck-slot-cover::after {
  background:
    linear-gradient(to top, rgb(3 1 8 / 0.95) 0%, rgb(3 1 8 / 0.9) 30%, rgb(3 1 8 / 0.3) 56%, transparent 78%),
    linear-gradient(to right, rgb(6 3 14 / 0.5) 0%, rgb(6 3 14 / 0.12) 44%, transparent 76%),
    linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.1), transparent 40%, rgb(0 0 0 / 0.28));
}
/*
 * The hero breathes (§3a: "the screen is alive at rest").
 *
 * A twenty-eight second drift of about two per cent, on transform only, on one
 * element — the cheapest possible way for a screen whose subject is a still
 * painting to stop being a still painting. Reduced motion stops it; the token
 * below turns the whole decorative layer off in one place.
 */
@keyframes ds-cover-drift {
  0%   { transform: scale(1.06) translate3d(0, 0, 0); }
  50%  { transform: scale(1.1) translate3d(-1.1%, -0.9%, 0); }
  100% { transform: scale(1.06) translate3d(0, 0, 0); }
}
.ds-v2 .deck-slot.is-active .deck-slot-cover canvas {
  animation: hb-tile-lit 260ms var(--ease-arrive) both, ds-cover-drift 28s ease-in-out 260ms infinite;
  will-change: transform;
}
:root[data-reduced-motion="true"] .ds-v2 .deck-slot.is-active .deck-slot-cover canvas,
:root[data-reduced-motion="true"] .ds-v2 .deck-slot-cover canvas { animation: none; }
.ds-v2 .deck-slot-index {
  position: absolute;
  top: 10px; left: 12px;
  font-size: var(--fs-micro);
  letter-spacing: 0.13em;
  text-transform: uppercase;
  padding: 1px 7px;
  color: var(--text-dim);
  background: rgb(4 2 10 / 0.62);
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
}
.ds-v2 .deck-slot-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 30ch; }
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
.ds-v2 .deck-slot-badge { font-size: var(--fs-micro); padding: 1px 8px; letter-spacing: 0.06em; text-transform: uppercase; }
.ds-v2 .deck-slot-badge.is-active-badge { color: #fff; background: linear-gradient(var(--light-sweep), var(--accent-bright), var(--accent-hot)); }
.ds-v2 .deck-slot-badge.is-valid-badge { color: #8ff0be; }
.ds-v2 .deck-slot-badge.is-invalid-badge { color: #ffb0b8; }
.ds-v2 .deck-slot-meta .muted { font-size: 0.72rem; line-height: 1.4; }
.ds-v2 .deck-slot-bar { display: flex; height: 5px; border-radius: var(--r-chip); overflow: hidden; box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.6); margin-top: 3px; }
.ds-v2 .deck-slot-bar i { display: block; height: 100%; }
.ds-v2 .deck-slot-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; }
.ds-v2 .deck-slot-actions .btn { min-height: 32px; font-size: 0.74rem; padding: 0 var(--sp-3); }
/* the name gets the display face at feature size now that it is on paint rather
   than in a 190px box beside a thumbnail */
.ds-v2 .deck-slot.is-active .deck-slot-name { font-size: var(--fs-lg); }

/* the unused slots: recessed sockets with an engraved number, so the rack is
   always full and the player can see their capacity */
.ds-v2 .deck-socket {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 7px;
  min-height: var(--slot-h);
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
.ds-v2 .deck-socket-label { font-size: var(--fs-micro); letter-spacing: 0.09em; text-transform: uppercase; }
@media (hover: hover) {
  .ds-v2 .deck-socket:hover:not(:disabled) { color: var(--text); box-shadow: inset 2px 2.6px 8px rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(181 108 255 / 0.3); }
  .ds-v2 .deck-socket:hover:not(:disabled) .deck-socket-plus { transform: translateY(-2px) scale(1.07); color: #fff; }
}
.ds-v2 .deck-slots-full { grid-column: 1 / -1; }

/*
 * The floor under the rack.
 *
 * Everything above this line was a rack with nothing under it: measured at
 * 1600x900, a hundred and forty pixels of featureless near-black below the last
 * row with the atmosphere showing straight through. The rail across the top of
 * the rack has had a partner all along and it was never drawn — a lit front
 * edge and a footer with the three things a deck manager knows and had nowhere
 * to say: the size of the library these decks are cut from, how the active one
 * is doing, and the way in for a deck somebody sent you.
 */
.ds-v2 .deck-rack-foot {
  grid-column: 1 / -1;
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-3) var(--sp-4);
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-field);
  background: linear-gradient(var(--light-sweep), rgb(34 24 62 / 0.62), rgb(10 6 22 / 0.72));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.075),
    inset 0 -1px 0 rgb(0 0 0 / 0.6),
    0 10px 26px rgb(0 0 0 / 0.42);
}
/* the shelf's front edge: a lit lip and the contact shadow the row above casts
   onto it, which is what turns a tinted band into a surface the sockets stand
   on rather than a second panel floating beside them */
.ds-v2 .deck-rack-foot::before {
  content: "";
  position: absolute;
  left: 4%; right: 4%; top: calc(var(--sp-3) * -1);
  height: var(--sp-3);
  pointer-events: none;
  background: linear-gradient(to bottom, rgb(0 0 0 / 0.5), rgb(0 0 0 / 0));
}
.ds-v2 .deck-rack-foot::after {
  content: "";
  position: absolute;
  left: 6%; right: 6%; top: 0;
  height: 2px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.16), transparent);
}
.ds-v2 .deck-rack-fact { display: inline-flex; align-items: baseline; gap: 7px; min-width: 0; }
.ds-v2 .deck-rack-fact .hb-icon { width: 15px; height: 15px; align-self: center; color: var(--text-dim); }
.ds-v2 .deck-rack-fact .t-label { color: var(--text-faint); }
.ds-v2 .deck-rack-fact b { color: var(--text); font-weight: 600; }
.ds-v2 .deck-rack-foot-sep {
  width: 1px; height: 18px;
  background: linear-gradient(to bottom, transparent, rgb(255 255 255 / 0.14), transparent);
}
.ds-v2 .deck-rack-import { margin-left: auto; min-height: 36px; font-size: var(--fs-sm); }
/* a deck code that cannot be read says so, in the same language the drag
   refusal does — a shape and a colour, not a colour */
.ds-v2 .deck-rack-foot.is-refused {
  box-shadow: inset 0 0 0 1.5px var(--danger), 0 0 22px rgb(255 90 120 / 0.22);
  animation: ds-refuse 380ms var(--ease-arrive);
}
@keyframes ds-refuse {
  0%, 100% { transform: translateX(0); }
  22% { transform: translateX(-5px); }
  62% { transform: translateX(4px); }
}
:root[data-reduced-motion="true"] .ds-v2 .deck-rack-foot.is-refused { animation: none; }

/* the recess deepens and the numeral quietens with distance from the live
   socket, so eleven empty slots read as a sequence rather than a wall */
.ds-v2 .deck-socket {
  box-shadow:
    inset 3px 4px calc(10px + 8px * var(--depth, 0)) rgb(0 0 0 / calc(0.7 + 0.22 * var(--depth, 0))),
    inset 0 0 0 1px rgb(0 0 0 / 0.6),
    inset -1.5px -1.5px 0 rgb(255 255 255 / calc(0.085 - 0.045 * var(--depth, 0)));
}
.ds-v2 .deck-socket .deck-socket-number { color: rgb(255 255 255 / calc(0.1 - 0.055 * var(--depth, 0))); }
.ds-v2 .deck-socket .deck-socket-label { opacity: calc(1 - 0.45 * var(--depth, 0)); }

/* Five, exactly, wherever there is room for five. Auto-fill would give six at
   1280 and leave a three-cell hole in the last row; the rack's whole trick is
   that its arithmetic comes out even. */
@media (min-width: 1100px) {
  .ds-v2 .deck-slots-body { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  /* one column: there is no second column for the hero to span into */
  .ds-v2 .deck-slot.is-active { grid-column: auto; grid-row: auto; }
}
/* A phone in landscape has 390px of height, so the rack is short rows and a
   scroll rather than three tall ones, and the hero stops spanning two of them. */
@media (max-height: 480px) {
  .ds-v2 { --slot-h: 128px; }
  .ds-v2 .deck-slots-body { padding: var(--sp-2) var(--sp-3) var(--sp-4); gap: var(--sp-2); }
  .ds-v2 .deck-slot.is-active { grid-row: auto; }
  /* it is a one-cell tile again down here, so it wants the one-cell scrim: the
     name sits over the middle of the painting rather than under it */
  .ds-v2 .deck-slot.is-active .deck-slot-cover::after {
    background:
      linear-gradient(to top, rgb(3 1 8 / 0.95) 0%, rgb(3 1 8 / 0.88) 26%, rgb(3 1 8 / 0.42) 54%, rgb(3 1 8 / 0.06) 82%),
      linear-gradient(to right, rgb(6 3 14 / 0.8) 0%, rgb(6 3 14 / 0.5) 44%, rgb(6 3 14 / 0.1) 86%),
      linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.09), transparent 38%, rgb(0 0 0 / 0.3));
  }
  .ds-v2 .deck-socket-number { font-size: 1.9rem; }
  .ds-v2 .deck-slot-record { display: none; }
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
/*
 * The scroller has to *take* the room, or its end fade is 2,900 pixels down.
 *
 * '.hb-scrollwrap' draws the bottom ramp on its own ::after, which is right —
 * and here the wrapper had no 'flex' of its own inside a column flex body, so it
 * sized to its content, grew to the grid's full 2,902px, and was clipped by the
 * body's 'overflow: hidden'. The fade was drawn, correctly, two and a half
 * screens below the fold. Probed: '.gallery-grid' scrollHeight 2902 against
 * clientHeight 638, and the visible result was a razor cut through six
 * portraits. The collection's main column states this and the gallery never did.
 */
.gal-v2 .gallery-body > .hb-scrollwrap { flex: 1 1 auto; min-height: 0; }
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
  font-size: var(--fs-micro);
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
/*
 * "Art pending", named rather than implied.
 *
 * The renderer stamps its own watermark on a card above 300px of render width;
 * a 168px gallery tile is far under that, so this was the one surface in the
 * game where an unpainted character showed an abstract field with nothing
 * saying why. §10 asks for exactly this: the state is long-lived and heavily
 * seen, so it gets designed rather than hidden. Small, low-chroma, on the same
 * label type as everything else, and it sits opposite the crest so it never
 * collides with the name.
 */
.gal-v2 .gallery-tile-pending {
  position: absolute;
  top: 9px; left: 8px;
  padding: 1px 6px;
  font-size: var(--fs-micro);
  font-weight: 600;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.5);
  background: rgb(4 2 10 / 0.55);
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0;
  transition: opacity var(--dur-ui) var(--ease-arrive);
  pointer-events: none;
}
.gal-v2 .gallery-tile.no-art .gallery-tile-pending { opacity: 1; }
/* the not-yet-seen padlock lives in the same corner; the mark steps aside for it
   rather than stacking on top of it */
.gal-v2 .gallery-tile:has(.gallery-tile-locked) .gallery-tile-pending { left: 34px; }
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
/* §4: text over imagery gets a plate. "Showing 90 of 138" sat on raw void
   directly under a cut row of portraits, which is the one place on this screen
   where a line of copy has a painting immediately above it. */
.gal-v2 .gallery-note {
  flex: 0 0 auto;
  align-self: flex-start;
  margin: 0 0 var(--sp-3);
  padding: 5px var(--sp-3);
  font-size: 0.74rem;
  border-radius: var(--r-chip);
  background: linear-gradient(var(--light-sweep), rgb(38 27 70 / 0.62), rgb(12 7 26 / 0.7));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.07),
    inset 0 -1px 0 rgb(0 0 0 / 0.5),
    0 3px 10px rgb(0 0 0 / 0.4);
}

.gal-v2 .gallery-page { min-height: 0; }
.gal-v2 .gallery-portrait canvas { border-radius: var(--r-tile); }

@media (max-width: 900px) {
  .gal-v2 .gallery-body { padding: var(--sp-2) var(--sp-3) 0; }
  .gal-v2 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: var(--sp-2); }
}
@media (max-height: 480px) {
  .gal-v2 .gallery-body { gap: var(--sp-2); padding-top: var(--sp-2); }
  .gal-v2 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 7px; }
  .gal-v2 .gallery-filters .btn { min-height: 28px; font-size: var(--fs-micro); padding: 0 9px; }
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
  .gal-v2 .gallery-tile-role { font-size: var(--fs-micro); }
  .gal-v2 .gallery-tile-body { padding: var(--sp-2) 8px 6px; }
}
@media (max-height: 480px) {
  .ds-v2 .deck-slots-body { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--sp-3); padding: var(--sp-2) var(--sp-3) var(--sp-4); }
  /*
   * The copy plus one row of actions, stated as a sum rather than as 138.
   *
   * Two things were coming out of the same flat number. The action row is 28px
   * on a mouse and 44px under base.css's touch floor, so on a phone those
   * sixteen pixels came out of the copy: the name rose into the SLOT badge
   * pinned at the top-left and "DJ Kilowatt — 30/30 cards" was drawn behind the
   * Edit button. And the copy is rem, so at --ui-scale 1.4 it wanted sixteen
   * more pixels than 138 gave it and the meta column clipped its own last line.
   * Both terms are now written in the units they are actually made of: 2.7rem
   * of type, 70px of padding and gaps, and whichever action row applies.
   */
  .ds-v2 .deck-slot, .ds-v2 .deck-socket { min-height: calc(2.7rem + 70px + max(28px, var(--touch-min))); }
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
  .ds-v2 .deck-slot-actions .btn { min-height: 28px; font-size: var(--fs-micro); padding: 0 8px; }
}
`;

/** Exported so a screen can time its own exit against the shared curve. */
export const KIT_EASE = { arrive: cssEase(EASE.arrive), leave: cssEase(EASE.leave) };
export { DUR as KIT_DUR, hexToRgba };
