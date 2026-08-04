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
import { CARD_H, CARD_W } from "../cardRenderer/palette";
import { HOLD_MS, HOLD_TOLERANCE_PX } from "./gestures";

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
  private dragging: { instanceId: string; ghost: HTMLElement; pointerId: number } | null = null;

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
    for (const entry of [...this.entries]) {
      if (!seen.has(entry.instanceId)) {
        entry.element.classList.add("leaving");
        const node = entry.element;
        window.setTimeout(() => node.remove(), 220);
        this.entries = this.entries.filter((e) => e !== entry);
      }
    }

    // add new cards
    for (const instance of hand) {
      if (this.entries.some((e) => e.instanceId === instance.instanceId)) continue;
      const card = this.content.cards[instance.cardId];
      if (!card) continue;
      const element = this.createCardElement(card, instance.instanceId);
      this.entries.push({ instanceId: instance.instanceId, cardId: instance.cardId, element, playable: false });
      this.root.appendChild(element);
    }

    // keep DOM order matching hand order
    this.entries.sort(
      (a, b) =>
        hand.findIndex((c) => c.instanceId === a.instanceId) - hand.findIndex((c) => c.instanceId === b.instanceId)
    );
    for (const entry of this.entries) this.root.appendChild(entry.element);

    this.refreshPlayability();
    this.applyKeyboardFocus();
    this.layout();
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

    // renderCardToCanvas sets an inline width/height for standalone use; the
    // hand sizes its cards from the bar height in CSS, and inline styles would
    // win over the stylesheet, so clear them.
    const canvas = renderCardToCanvas(card, 260);
    canvas.style.width = "";
    canvas.style.height = "";
    element.appendChild(canvas);

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

  /** Fan the cards, overlapping them when the hand is large. */
  private layout(): void {
    const count = this.entries.length;
    if (count === 0) return;

    const available = this.root.clientWidth || window.innerWidth;
    const cardWidth = this.entries[0]?.element.offsetWidth || 210;

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
     */
    const arc = fanned ? 22 : 0;

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
    const ghost = document.createElement("div");
    ghost.className = "hand-drag-ghost";
    if (card) {
      const ghostCanvas = renderCardToCanvas(card, 200);
      ghostCanvas.style.width = "";
      ghostCanvas.style.height = "";
      ghost.appendChild(ghostCanvas);
    }
    document.body.appendChild(ghost);

    element.classList.add("dragging");
    this.dragging = { instanceId, ghost, pointerId: event.pointerId };
    this.moveGhost(event.clientX, event.clientY);

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

  private moveGhost(x: number, y: number): void {
    if (!this.dragging) return;
    this.dragging.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
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
    const ghost = this.dragging?.ghost;
    if (!ghost) return;
    ghost.classList.toggle("drop-valid", state === "valid");
    ghost.classList.toggle("drop-blocked", state === "blocked");
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
