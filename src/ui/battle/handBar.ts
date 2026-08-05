/**
 * The player's hand, rendered as a DOM strip beneath the board.
 *
 * Keeping the hand out of the 3D scene solves three problems at once: with a
 * steep top-down camera anything near the viewer compresses into the bottom
 * edge of the frustum, cards drawn in-scene inevitably overlap the play area,
 * and perspective makes their text harder to read. As DOM it sits in its own
 * reserved strip below the board, renders at whatever size we choose, and stays
 * pixel-crisp.
 *
 * Dragging starts here and finishes on the board: the bar tracks the pointer
 * and hands the coordinates to BattleView, which owns all the rules decisions.
 */

import type { CardDef, ContentIndex, MatchState, PlayerView } from "../../engine/types";
import { checkPlayable } from "../../engine/intents";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { renderCardBackToCanvas } from "../cardRenderer/renderCardBack";
import { CARD_H, CARD_W } from "../cardRenderer/palette";
import { HOLD_MS, HOLD_TOLERANCE_PX } from "./gestures";
import { cardBackStyleFor } from "./cardMesh";
import { motionEnabled, stagger } from "../motion";

/**
 * The player's own back, as a data URI, built once **per back**.
 *
 * Every card dealt into the hand turns over from its back, so every card needs
 * one — and rendering a second 260px canvas per card would put the cost of the
 * flip inside the frame the cascade is trying to keep smooth. It is the same
 * picture on all of them (the back is a property of the account, not of the
 * card), the drawing is `cardRenderer`'s so it is the same object the 3D board
 * flips over, and a `background-image` costs the compositor nothing after the
 * first decode.
 *
 * ## The cache is keyed now, and it was not
 *
 * `backImageUrl` was a module-level `string | null` filled on first use and
 * never looked at again. A module lives as long as the tab, and the deck's card
 * back is chosen per deck — so the *second* match of a session showed the first
 * match's back on every card in hand, for the whole match, while the 3D board
 * beside it (which caches by `colour:emblem`, see `getCardBackTexture`) showed
 * the right one. Two objects that are meant to be the same object flipped over,
 * disagreeing. Keying by the style costs one string compare per deal and makes
 * the two caches behave the same way.
 */
const backImages = new Map<string, string>();
function cardBackImage(): string {
  const style = cardBackStyleFor(0) ?? { color: "#b56cff", emblem: "diamond" as const };
  const key = `${style.color}:${style.emblem}`;
  const cached = backImages.get(key);
  if (cached !== undefined) return cached;
  let url = "";
  try {
    url = renderCardBackToCanvas(style, 0.62).toDataURL();
  } catch {
    url = "";
  }
  backImages.set(key, url);
  return url;
}

export interface HandBarCallbacks {
  /** pointer moved while dragging a card; return true if it is over a drop zone */
  onDragMove: (instanceId: string, clientX: number, clientY: number) => void;
  /**
   * Pointer released; the view decides whether to play or cancel.
   *
   * `ghost` is the drag element itself, detached from the bar's bookkeeping but
   * still in the document. Whoever takes it owns removing it. This is what makes
   * a card play continuous: the object under the cursor at release is the object
   * that flies to the slot, rather than being destroyed at pointerup and a
   * different one being created a second later somewhere else — which is §3a's
   * "that object must not blink out of existence and reappear somewhere else",
   * applied to the most repeated action in the game.
   */
  onDragEnd: (instanceId: string, clientX: number, clientY: number, ghost: HTMLElement | null) => void;
  onDragStart: (instanceId: string) => void;
  /** right-click: show the card's details until dismissed */
  onInspect: (card: CardDef) => void;
  /** press-and-hold: show the card enlarged until the returned closer is called */
  onPeek: (card: CardDef) => () => void;
}

interface HandEntry {
  instanceId: string;
  cardId: string;
  element: HTMLElement;
  playable: boolean;
}

export class HandBar {
  readonly root: HTMLElement;
  private entries: HandEntry[] = [];
  private view: PlayerView | null = null;
  private proxy: (() => MatchState) | null = null;
  private dragging: {
    instanceId: string;
    ghost: HTMLElement;
    pointerId: number;
    /** Does this card take a place in the row? Only those shrink — see below. */
    needsSlot: boolean;
    /** The canvas inside the ghost, whose `scale` is the carried card's size. */
    face: HTMLElement | null;
  } | null = null;

  constructor(
    container: HTMLElement,
    private readonly content: ContentIndex,
    private readonly callbacks: HandBarCallbacks
  ) {
    this.root = document.createElement("div");
    this.root.className = "hand-bar";
    container.appendChild(this.root);

    /**
     * The fan is recomputed when the strip changes size, and it was not.
     *
     * `layout()` runs on `sync()` and on an explicit `resize()` call, and
     * nothing was calling `resize()`. Measured by resizing a live board: at
     * 1280×720 the hand's centre stayed at x=788 against a viewport centre of
     * 640; at 2560×1440 it sat at 835 against 1280; and at 844×390 it spanned
     * x=360..1197 inside an 844px window, putting four of seven cards off the
     * right-hand edge. A fresh load at each size was always correct, which is
     * exactly the signature of a layout computed once — and phone rotation is
     * the supported case that only ever hits the resize path.
     *
     * The card widths are `vh`-derived, so the observer has to watch the strip
     * itself rather than the window: a viewport that changes height changes the
     * card size without changing the bar's width, and the pitch depends on both.
     */
    this.resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.layout()) : null;
    this.resizeObserver?.observe(this.root);
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("orientationchange", this.onWindowResize);
  }

  private readonly resizeObserver: ResizeObserver | null;

  /**
   * A `ResizeObserver` fires before the new `vh` has been applied to the card
   * canvases in some engines, so the window listener re-runs the layout on the
   * next frame with the settled sizes. Both are cheap: `layout()` writes inline
   * styles and reads one offset width.
   */
  private onWindowResize = (): void => {
    this.layout();
    requestAnimationFrame(() => this.layout());
  };

  /**
   * `stateProxy` is owned by BattleView; the bar borrows it for playability.
   *
   * Typed `MatchState` rather than the `never` it used to be — `never` let the
   * provider be passed without importing the type, at the cost of the compiler
   * having no opinion about it. This is the same seam as `matchState()` in the
   * battle screen: `checkPlayable` wants a state, a networked client will only
   * have a view, and closing that gap is phase 2 (§15).
   */
  setStateProvider(provider: () => MatchState): void {
    this.proxy = provider;
  }

  sync(view: PlayerView): void {
    this.view = view;
    const hand = view.you.hand;
    const seen = new Set(hand.map((c) => c.instanceId));

    // drop entries whose cards have left the hand
    const leaving: HTMLElement[] = [];
    for (const entry of [...this.entries]) {
      if (!seen.has(entry.instanceId)) {
        leaving.push(entry.element);
        this.entries = this.entries.filter((e) => e !== entry);
      }
    }
    /**
     * A card that leaves the hand goes *to* somewhere. `--exit-x/y` point at the
     * discard tray on the mat; the keyframe carries it there, shrinking and
     * turning face-down, instead of the old `translateY(-70px)` fade that sent
     * every discard vertically off the top of the screen towards nothing at all.
     *
     * Aimed before the class goes on, so the keyframe has its destination on the
     * frame it starts rather than one frame later.
     */
    this.aimAtPile(leaving, "discard", "--exit-x", "--exit-y");
    for (const node of leaving) {
      node.classList.add("leaving");
      window.setTimeout(() => node.remove(), 520);
    }

    // add new cards
    const arriving: HTMLElement[] = [];
    for (const instance of hand) {
      if (this.entries.some((e) => e.instanceId === instance.instanceId)) continue;
      const card = this.content.cards[instance.cardId];
      if (!card) continue;
      const element = this.createCardElement(card, instance.instanceId);
      this.entries.push({ instanceId: instance.instanceId, cardId: instance.cardId, element, playable: false });
      this.root.appendChild(element);
      arriving.push(element);
    }

    /**
     * The cascade, on **every** deal rather than only on the opening hand.
     *
     * `battleView.playCurtain()` staggered the mulligan's seven cards and
     * nothing staggered the ones drawn on turns two through twenty, so the most
     * repeated arrival in the game was the one with no timing on it. Measured
     * before: six `hand-card-in` events at an identical millisecond. The step is
     * shorter than the curtain's 45ms because a two-card draw wants to read as
     * one gesture, and `max` keeps a ten-card refill inside a set-piece.
     *
     * Written here and not in the view, so a card arriving from any cause — a
     * draw, a Reaction returning, a shuffled copy — gets the same treatment.
     */
    if (arriving.length > 0) {
      const opening = arriving.length === this.entries.length && arriving.length >= 4;
      stagger(
        arriving,
        opening ? { step: 45, from: 90, max: 420 } : { step: 38, from: 0, max: 320 }
      );
    }

    /**
     * Hand order is a property of `left` and `z-index`, and **never** of DOM order.
     *
     * This used to end with `for (const entry of this.entries)
     * this.root.appendChild(entry.element)` — a full re-insertion of every card
     * node on every single sync. Moving a node in the DOM removes and re-inserts
     * it, which resets its CSS animations, so every card in the hand replayed
     * `hand-card-in` whenever the rival drew, played or dealt damage. Measured
     * after one End Turn click: seven `animationstart` events at t+1196ms, seven
     * more at +1820, +1994 and +2568 — twenty-eight entrance animations in 1.4
     * seconds for cards that had not moved. The hand visibly un-fanned and
     * re-fanned four times per opponent turn, which is the single most-looked-at
     * object on the screen.
     *
     * Nothing needs the DOM order: `layout()` writes an absolute `left` and an
     * explicit `z-index` on every card, `debugCards()` reads `this.entries`, and
     * these divs are not focusable, so there is no tab order to preserve either.
     * Sorting `this.entries` is still required — that is what feeds the fan — but
     * it is now the only thing that happens.
     */
    this.entries.sort(
      (a, b) =>
        hand.findIndex((c) => c.instanceId === a.instanceId) - hand.findIndex((c) => c.instanceId === b.instanceId)
    );

    this.refreshPlayability();
    this.applyKeyboardFocus();
    this.layout();
    // The fan has been re-pitched; whichever card the pointer is still over has
    // new neighbours, and a card that left the hand may have left its shove on
    // one of them.
    this.spreadAround(this.entries.some((e) => e.instanceId === this.hovered) ? this.hovered : null);
  }

  /**
   * Mark the card the keyboard cursor is on.
   *
   * A class rather than DOM focus: these are `div`s inside a canvas-anchored
   * layer, and moving real focus into the hand would take it away from the
   * board's key handler on every arrow press.
   */
  setKeyboardFocus(instanceId: string | null): void {
    this.keyboardFocus = instanceId;
    this.applyKeyboardFocus();
  }

  private keyboardFocus: string | null = null;

  private applyKeyboardFocus(): void {
    for (const entry of this.entries) {
      entry.element.classList.toggle("kb-focus", entry.instanceId === this.keyboardFocus);
    }
  }

  private createCardElement(card: CardDef, instanceId: string): HTMLElement {
    const element = document.createElement("div");
    element.className = "hand-card";
    element.dataset["instanceId"] = instanceId;
    /**
     * The entrance is armed **once**, on the card that is genuinely new.
     *
     * `.hand-card` used to carry `animation: hand-card-in` unconditionally, so
     * anything that reset the element's animations — a DOM move, a class change
     * that changed which rule matched — replayed it. Gating on an attribute that
     * is set here and cleared the moment the animation finishes means a card
     * that has been in the hand for three turns has no entrance animation to
     * restart at all, which is a stronger guarantee than being careful about
     * when we touch it.
     */
    element.dataset["new"] = "";
    element.addEventListener(
      "animationend",
      (event) => {
        if ((event as AnimationEvent).animationName !== "hand-card-in") return;
        delete element.dataset["new"];
      },
      { capture: true }
    );

    /**
     * The card is a two-sided object now, so it has an axis to turn about.
     *
     * `.hand-card` keeps the fan (its `--tilt`/`--lift` transform) and the
     * entrance travel (the independent `translate`/`scale` properties, which
     * compose with `transform` rather than replacing it). The inner wrapper owns
     * the *turn*, because a `rotateY` on the same element as the fan rotation
     * would have to restate the fan in every keyframe and would fight the hover.
     *
     * Face and back are the same object drawn by `cardRenderer`, exactly as the
     * 3D board's flip is — the back was already authored beside the face for
     * that reason and this is the second consumer of it.
     */
    const flip = document.createElement("div");
    flip.className = "hand-card-flip";

    // renderCardToCanvas sets an inline width/height for standalone use; the
    // hand sizes its cards from the bar height in CSS, and inline styles would
    // win over the stylesheet, so clear them.
    const canvas = renderCardToCanvas(card, 260);
    canvas.style.width = "";
    canvas.style.height = "";
    flip.appendChild(canvas);

    const back = document.createElement("div");
    back.className = "hand-card-back";
    back.setAttribute("aria-hidden", "true");
    const backSrc = cardBackImage();
    if (backSrc) back.style.backgroundImage = `url("${backSrc}")`;
    flip.appendChild(back);

    element.appendChild(flip);

    element.addEventListener("pointerenter", () => this.spreadAround(instanceId));
    element.addEventListener("pointerleave", () => this.spreadAround(null));

    element.addEventListener("pointerdown", (event) => {
      if (event.button === 2) return;
      const entry = this.entries.find((e) => e.instanceId === instanceId);
      if (!entry?.playable) return;
      event.preventDefault();
      this.beginDrag(instanceId, element, event);
    });

    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.callbacks.onInspect(card);
    });

    return element;
  }

  private refreshPlayability(): void {
    const view = this.view;
    const proxy = this.proxy;
    if (!view || !proxy) return;
    const yourTurn = view.activeSeat === view.seat && view.phase === "main";

    for (const entry of this.entries) {
      const result = checkPlayable(proxy(), this.content, view.seat, entry.instanceId);
      entry.playable = result.ok;
      entry.element.classList.toggle("playable", result.ok);
      entry.element.classList.toggle("unplayable", !result.ok && yourTurn);
      const card = this.content.cards[entry.cardId];
      entry.element.title = card ? `${card.name} — ${card.text}` : "";
    }
  }

  // -------------------------------------------------------------------------
  // Where the piles are, and how a card gets to and from one
  // -------------------------------------------------------------------------

  /**
   * The deck and the discard, in viewport pixels, read off the document root.
   *
   * `BattleView` projects both piles every sync and writes them as custom
   * properties, because it is the only thing that owns a camera and this strip
   * is deliberately outside the 3D scene. Reading them back through
   * `getComputedStyle` costs one style resolution per layout — the same layout
   * that already reads `offsetWidth` — rather than one per card, and inherited
   * custom properties mean the bar does not have to know which element the view
   * chose to write on.
   *
   * `null` when the board has not projected yet (the very first sync, and every
   * unit test), which is what makes the plain fade below a real fallback rather
   * than a bug that only shows up without a GPU.
   */
  private pileOrigin(which: "deck" | "discard"): { x: number; y: number } | null {
    const style = getComputedStyle(this.root);
    const x = Number.parseFloat(style.getPropertyValue(`--pile-${which}-x`));
    const y = Number.parseFloat(style.getPropertyValue(`--pile-${which}-y`));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  /**
   * Point one card's travel at a pile, as a delta from where it will rest.
   *
   * A delta rather than an absolute position because the keyframe has to end on
   * the card's own fanned transform, and a card in the hand is placed by `left`
   * plus a rotation about its bottom edge — so "fly here from there" is only
   * expressible as an offset the animation unwinds to zero.
   */
  private aimAtPile(elements: HTMLElement[], which: "deck" | "discard", xVar: string, yVar: string): void {
    if (elements.length === 0) return;
    const pile = this.pileOrigin(which);
    if (!pile) {
      for (const element of elements) {
        element.style.removeProperty(xVar);
        element.style.removeProperty(yVar);
      }
      return;
    }
    /**
     * `offset*` and not `getBoundingClientRect()`, and the difference is the
     * whole measurement.
     *
     * A rect reports the box *after* transforms, and the card whose origin we
     * are computing is mid-entrance — at t=0 the keyframe has it at 38% scale
     * and off toward the deck, so a rect would hand back a box that is neither
     * where the card will rest nor the size it will be, and the flight would aim
     * from somewhere further away on every recomputation. `offsetLeft/Top` are
     * layout positions inside `.hand-bar`, which is exactly where a card lands.
     *
     * Every read happens before every write, because the writes are custom
     * properties and each one invalidates style — interleaved, seven cards would
     * be seven forced layouts of the strip.
     */
    const bar = this.root.getBoundingClientRect();
    const deltas: { element: HTMLElement; x: number; y: number }[] = [];
    for (const element of elements) {
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      if (w === 0 && h === 0) continue;
      deltas.push({
        element,
        x: Math.round(pile.x - (bar.left + element.offsetLeft + w / 2)),
        y: Math.round(pile.y - (bar.top + element.offsetTop + h / 2)),
      });
    }
    for (const delta of deltas) {
      delta.element.style.setProperty(xVar, `${delta.x}px`);
      delta.element.style.setProperty(yVar, `${delta.y}px`);
    }
  }

  /**
   * Push the cards either side of the read out of its way.
   *
   * §3a asks for neighbours that give way; measured before this, cards 2 and 4
   * of seven held `matrix(0.995671, ∓0.0929499, …)` while card 3 was hovered —
   * byte-identical to their resting transform. The hovered card simply grew over
   * the top of them, so a 1.3× lift read as occlusion rather than as depth.
   *
   * Driven from here rather than from a CSS sibling rule because **DOM order is
   * not visual order** in this bar: `layout()` places cards by `left` and
   * `z-index` and deliberately never re-appends them (see `sync`), so
   * `.hand-card:hover + .hand-card` would push whichever card happened to be
   * inserted next, which after two turns is any card at all.
   *
   * The magnitude follows the fan's own direction — left of the read goes left,
   * right goes right — and the second ring gets a third of it, which is what
   * turns a shove into a spread.
   */
  private hovered: string | null = null;

  private spreadAround(instanceId: string | null): void {
    this.hovered = instanceId;
    const centre = instanceId === null ? -1 : this.entries.findIndex((e) => e.instanceId === instanceId);
    for (const [index, entry] of this.entries.entries()) {
      const distance = centre < 0 ? 99 : index - centre;
      const magnitude = Math.abs(distance) === 1 ? 1 : Math.abs(distance) === 2 ? 0.34 : 0;
      if (magnitude === 0 || !motionEnabled()) {
        entry.element.style.removeProperty("--spread-x");
        entry.element.style.removeProperty("--spread-y");
        continue;
      }
      const direction = distance < 0 ? -1 : 1;
      entry.element.style.setProperty("--spread-x", `${Math.round(direction * 13 * magnitude)}px`);
      entry.element.style.setProperty("--spread-y", `${Math.round(5 * magnitude)}px`);
    }
  }

  /** Fan the cards, overlapping them when the hand is large. */
  private layout(): void {
    const count = this.entries.length;
    if (count === 0) return;

    const available = this.root.clientWidth || window.innerWidth;
    const cardWidth = this.entries[0]?.element.offsetWidth || 210;
    const cardHeight = this.entries[0]?.element.offsetHeight || 280;

    /**
     * The reference's hand spacing follows roughly `pitch = K / n`: a few cards
     * sit apart with a gap, and as the hand fills they slide into an overlap
     * rather than the hand growing wider. K is scaled to our card size.
     */
    const K = cardWidth * 7;
    const maxTotal = available - 60;
    const step = count > 1 ? Math.min(cardWidth + 16, K / count, maxTotal / (count - 1)) : 0;
    const totalWidth = step * (count - 1) + cardWidth;
    const startX = (available - totalWidth) / 2;

    /**
     * Small hands stay flat and upright; from four cards the fan snaps on.
     * The rotation is deliberately exaggerated well past what the positional
     * sag requires — measuring the reference showed roughly 3x, and that
     * overstatement is most of what makes a hand look expensive.
     */
    const fanned = count >= 4;
    const maxTilt = fanned ? 16 : 0;

    /**
     * The arc's lowest point is the bar's own baseline, not a card's worth
     * below it.
     *
     * `--lift` used to push the *outer* cards **down** by up to 22px on top of
     * the strip's deliberate 3% tuck. Measured with the bounding rects at both
     * required sizes: at 1280x720 the outer hand cards ended 27px past the
     * bottom of the viewport and at 844x390 all seven did, which puts the
     * attack and health gems — the numbers the hand exists to carry — off the
     * screen on exactly the cards a fan makes hardest to read. §9's "every
     * screen still has to work at 1280x720 and on a phone in landscape" is a
     * hard constraint, and a clipped stat row is the recon's second critical.
     *
     * The curve is identical; only its zero moves. The centre of the fan now
     * rises above the baseline and the ends sit on it, which is the same arc a
     * hand of cards held in one hand actually makes, and nothing crosses the
     * bottom edge at any count or any viewport.
     *
     * It is a fraction of the card rather than a fixed 22px, and that is a
     * phone fix rather than a taste one. Twenty-two pixels was tuned against a
     * 900px-tall window where the card is 157px tall, so the arc was 14% of it;
     * carried unchanged to 844×390 the same 22px is 22% of a 101px card, and
     * every pixel of the fan's rise is a pixel `scene.ts` has to reserve away
     * from the board — which at that size is the difference between a 47px card
     * token and a legible one. `FAN_ARC` there is the same 0.14 and the two must
     * move together.
     */
    const arc = fanned ? cardHeight * 0.14 : 0;

    /**
     * And the corner the rotation throws below the baseline.
     *
     * `transform-origin: 50% 100%` pivots each card about its own bottom centre,
     * so a card tilted by θ puts its lower outside corner `(w/2)·sin θ` below
     * where the untilted card ends. At 1280x720 that measured 13px, which with
     * the strip's 3% tuck put 17px of the outermost cards under the fold —
     * exactly the stat gems again, just from the other half of the fan. The bar
     * lifts by that amount rather than the tilt being reduced, because the
     * exaggerated tilt is most of what makes the hand look expensive and it is
     * cheaper to move the strip than to flatten the fan.
     */
    const drop = Math.sin((maxTilt * Math.PI) / 180) * (cardWidth / 2);
    this.root.style.setProperty("--fan-drop", `${Math.round(drop) + 2}px`);

    this.entries.forEach((entry, index) => {
      const t = count > 1 ? index / (count - 1) - 0.5 : 0;
      entry.element.style.left = `${startX + index * step}px`;
      entry.element.style.zIndex = String(10 + index);
      entry.element.style.setProperty("--tilt", `${t * 2 * maxTilt}deg`);
      entry.element.style.setProperty("--lift", `${-(1 - Math.abs(t) * 2) * arc}px`);
    });

    /**
     * ...and then point the ones still arriving back at the deck they came out
     * of, now that they know where they are going to land.
     *
     * It runs inside `layout()` rather than once at creation for two reasons:
     * the card has no rect until it has a `left`, and a resize mid-cascade would
     * otherwise leave a card flying to a slot that has moved. `data-new` is
     * cleared by `animationend`, so this touches at most the cards genuinely in
     * the air and is a no-op for a settled hand.
     */
    this.aimAtPile(
      this.entries.filter((e) => e.element.dataset["new"] !== undefined).map((e) => e.element),
      "deck",
      "--from-x",
      "--from-y"
    );
  }

  // -------------------------------------------------------------------------
  // Drag
  // -------------------------------------------------------------------------

  /** Screen positions and playability of every hand card, for automation. */
  debugCards(): { instanceId: string; cardId: string; type: string; ok: boolean; screen: { x: number; y: number } }[] {
    return this.entries.map((entry) => {
      const rect = entry.element.getBoundingClientRect();
      return {
        instanceId: entry.instanceId,
        cardId: entry.cardId,
        type: this.content.cards[entry.cardId]?.type ?? "?",
        ok: entry.playable,
        screen: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    });
  }

  private beginDrag(instanceId: string, element: HTMLElement, event: PointerEvent): void {
    const card = this.content.cards[this.cardIdOf(instanceId)];
    let face: HTMLElement | null = null;
    const ghost = document.createElement("div");
    ghost.className = "hand-drag-ghost";
    /**
     * The shadow is a sibling of the card rather than a `filter` on it, because
     * it has to *separate*. A drop-shadow filter is welded to the object: it
     * moves with the card and can only get softer, so lifting a card off the mat
     * looked exactly like sliding it along the mat. This one is its own
     * composited layer under the card, and `.lifted` grows and fades it in the
     * same beat the card scales up — which is the whole read of picking
     * something up.
     */
    const shadow = document.createElement("div");
    shadow.className = "hand-drag-shadow";
    shadow.setAttribute("aria-hidden", "true");
    ghost.appendChild(shadow);
    if (card) {
      /**
       * Rendered larger than the hover, not smaller than the rest.
       *
       * It was 200px against a resting card of 118×158 and a hovered one of
       * 154×205, so the *carried* state — the one the player is actively holding
       * — was the smallest of the three. Recon defect 19. The height is set in
       * CSS from `--hand-hover-scale` so the two can never drift again; this
       * number only has to be enough resolution for it.
       */
      const ghostCanvas = renderCardToCanvas(card, 320);
      ghostCanvas.style.width = "";
      ghostCanvas.style.height = "";
      ghost.appendChild(ghostCanvas);
      face = ghostCanvas;
    }
    document.body.appendChild(ghost);

    element.classList.add("dragging");
    // The card being carried is not in the fan any more, so nothing should be
    // getting out of its way down there.
    this.spreadAround(null);
    /**
     * Whether this card takes a place in the row, asked once at pickup.
     *
     * `checkPlayable` is not free and the answer cannot change mid-gesture — the
     * card in your hand does not become a spell halfway across the mat — so
     * asking it on every pointer move would be sixty rule evaluations a second
     * for a constant.
     */
    const proxy = this.proxy;
    const view = this.view;
    const needsSlot =
      proxy && view ? checkPlayable(proxy(), this.content, view.seat, instanceId).needsSlot === true : false;
    this.dragging = { instanceId, ghost, pointerId: event.pointerId, needsSlot, face };
    this.ghostSwing = 0;
    this.ghostAt = { x: event.clientX, y: event.clientY, t: performance.now() };
    this.moveGhost(event.clientX, event.clientY);
    // One frame later, so the transition has a `from` to run out of: the card
    // rises off the mat and its shadow drops away from it.
    requestAnimationFrame(() => ghost.classList.add("lifted"));

    this.callbacks.onDragStart(instanceId);

    /**
     * Press-and-hold blows the card up instead of playing it. A hold and the
     * start of a drag are indistinguishable at pointerdown, so we arm both: the
     * peek opens if the pointer has stayed put, and moving afterwards simply
     * dismisses it and carries on with the drag. Nothing about pausing before
     * you drag should cost you the play.
     */
    const originX = event.clientX;
    const originY = event.clientY;
    let closePeek: (() => void) | null = null;

    const detach = (): void => {
      window.clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const holdTimer = window.setTimeout(() => {
      if (!card) return;
      closePeek = this.callbacks.onPeek(card);
      // the drag ghost would otherwise sit on top of the enlarged card
      ghost.style.visibility = "hidden";
    }, HOLD_MS);

    const endPeek = (): void => {
      if (!closePeek) return;
      closePeek();
      closePeek = null;
      ghost.style.visibility = "";
    };

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) > HOLD_TOLERANCE_PX) {
        window.clearTimeout(holdTimer);
        endPeek();
      }
      this.moveGhost(moveEvent.clientX, moveEvent.clientY);
      this.callbacks.onDragMove(instanceId, moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== event.pointerId) return;
      detach();
      if (closePeek) {
        endPeek();
        this.endDrag();
        this.callbacks.onDragEnd(instanceId, -1, -1, null); // held still: a look, not a play
        return;
      }
      // Hand the ghost over BEFORE endDrag, which is what would have deleted it.
      const handed = this.detachGhost();
      this.endDrag();
      this.callbacks.onDragEnd(instanceId, upEvent.clientX, upEvent.clientY, handed);
    };

    const onCancel = (): void => {
      detach();
      endPeek();
      this.endDrag();
      this.callbacks.onDragEnd(instanceId, -1, -1, null); // off-screen = cancel
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  private cardIdOf(instanceId: string): string {
    return this.entries.find((e) => e.instanceId === instanceId)?.cardId ?? "";
  }

  /** Smoothed horizontal pointer speed, as a tilt in degrees. */
  private ghostSwing = 0;
  private ghostAt = { x: 0, y: 0, t: 0 };

  /**
   * Follow the pointer, and lag behind it.
   *
   * A card carried by a hand is not rigid: it trails the direction of travel and
   * settles back to vertical when the hand stops. The ghost used to be a pure
   * `translate`, which is the one thing that makes a dragged object read as a
   * cursor decoration rather than as a held card. The swing is low-passed at
   * 0.22 so a jittery mouse does not shake it, clamped to 15° so a fast flick
   * cannot spin it, and it decays to zero on its own because a stationary
   * pointer keeps feeding in a velocity of nought.
   */
  private moveGhost(x: number, y: number): void {
    if (!this.dragging) return;
    const now = performance.now();
    const dt = Math.max(8, now - this.ghostAt.t);
    if (motionEnabled()) {
      const speed = ((x - this.ghostAt.x) / dt) * 1000; // px per second
      const target = Math.max(-15, Math.min(15, speed * 0.014));
      this.ghostSwing += (target - this.ghostSwing) * 0.22;
    } else {
      this.ghostSwing = 0;
    }
    this.ghostAt = { x, y, t: now };
    this.dragging.ghost.style.transform =
      `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${this.ghostSwing.toFixed(2)}deg)`;
  }

  /**
   * Give up ownership of the drag ghost without removing it from the document.
   *
   * Returns null when the ghost is hidden behind a peek, because an element with
   * `visibility: hidden` has no meaningful rect to fly from.
   */
  private detachGhost(): HTMLElement | null {
    const drag = this.dragging;
    if (!drag || drag.ghost.style.visibility === "hidden") return null;
    const ghost = drag.ghost;
    /**
     * Let go of the swing before handing it over. The token that replaces this
     * element is placed axis-aligned at the ghost's centre, and a 12° tilt in
     * the outgoing half of a 90ms cross-fade is the one frame where the two are
     * visibly different objects.
     */
    ghost.style.transform = ghost.style.transform.replace(/\s*rotate\([^)]*\)/, "");
    this.dragging = { ...drag, ghost: document.createElement("div") };
    return ghost;
  }

  /** Abort any in-progress drag (Escape, right-click, or completion). */
  endDrag(): void {
    if (!this.dragging) return;
    this.dragging.ghost.remove();
    const entry = this.entries.find((e) => e.instanceId === this.dragging?.instanceId);
    entry?.element.classList.remove("dragging");
    this.dragging = null;
  }

  /**
   * Colour the ghost by whether the ground under it would take the card.
   *
   * The board says the same thing at the same time (see `setDropTarget`), and
   * saying it twice is the point: the pointer is looking at the ghost, not at
   * the floor forty pixels below it.
   */
  setDragValidity(state: "valid" | "blocked" | "neutral"): void {
    const drag = this.dragging;
    if (!drag) return;
    drag.ghost.classList.toggle("drop-valid", state === "valid");
    drag.ghost.classList.toggle("drop-blocked", state === "blocked");

    /**
     * Over a legal slot, the carried card comes down to the size of the thing it
     * is about to become — and that is what finally lets the board be seen.
     *
     * Filmed at 1600×900 with a CDP screencast (`_w6_dragfilm.mjs`), the arena
     * *did* answer a drag: the row cut a trough along its whole length, a pool
     * lit under the landing place and the socket was drawn in it. Two waves
     * still reported "nothing lights", and the frames say why. The ghost is
     * rendered at `--hand-card-height * --hand-hover-scale * 1.08` — measured,
     * 170×235 px — and the socket that marks the landing place is 3.48×4.14
     * world units, about 125×140 px on the same frame. The feedback was
     * *entirely underneath the card that caused it*: a 6× amplified difference
     * showed the trough either side and nothing in the middle, because there was
     * a card in the middle.
     *
     * The reference solves this by making the carried card *become* the minion
     * as it crosses onto the board — it shrinks to token size and the board
     * opens around it. Same idea here, done with the one property the ghost is
     * not already using: `transform` is the pointer follow plus the swing, sixty
     * times a second, so the size goes on `scale`, which the stylesheet already
     * animates on this element (`.hand-drag-ghost.lifted canvas`) and which the
     * compositor handles on its own.
     *
     * Only cards that take a place in the row. A spell answers with its targets
     * and an equipment with the character it goes on; shrinking either would be
     * the hand miming a landing that is not going to happen.
     *
     * It survives reduced motion, deliberately — an inline `scale` outranks the
     * `:root[data-reduced-motion]` rule that pins this element at 1, so the card
     * still gets out of the way, it just does it on the frame rather than over
     * 110ms. Uncovering the board's answer is the functional half of §3's rule;
     * the easing is the decorative half.
     */
    const shrink = state === "valid" && drag.needsSlot;
    if (drag.face) drag.face.style.scale = shrink ? "0.66" : "";
  }

  isDragging(): boolean {
    return this.dragging !== null;
  }

  draggingInstanceId(): string | null {
    return this.dragging?.instanceId ?? null;
  }

  /** Height of the bar in CSS pixels — the board reserves this space. */
  height(): number {
    return this.root.offsetHeight;
  }

  resize(): void {
    this.layout();
  }

  dispose(): void {
    this.endDrag();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("orientationchange", this.onWindowResize);
    this.root.remove();
  }
}

export { CARD_W, CARD_H };
