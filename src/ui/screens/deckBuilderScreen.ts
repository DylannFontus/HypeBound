/**
 * Deck builder: leader selection, legal card pool, live validation, resource
 * curve, type distribution, auto-build, import/export codes and saved slots.
 *
 * ## The shape of the side panel is load-bearing
 *
 * It used to be one flex column: stats, curve, identity, list, validation,
 * assistance and the action row, all competing for the same height. At
 * 1280×720 — a resolution the bar names as a hard floor — the action row was
 * laid out at y=720 in a 720px window with nothing to scroll, so **Save Deck did
 * not exist at the minimum supported resolution**, and the deck list, the single
 * most important object on the screen, was a four-and-a-half-row peephole with
 * no thumb and no fade.
 *
 * So the column is three rows now: a header that sizes to its content, one
 * scroll region, and a pinned footer. A footer cannot be squeezed off the
 * bottom, and the list gets the room the panel has left rather than the room
 * everything above it did not want.
 *
 * ## Nothing is rebuilt that has not changed
 *
 * Adding a card used to set `poolHost.innerHTML = ""` and re-rasterise a
 * hundred-plus card canvases, then do the same to the list. Both are keyed by
 * card id now and reconciled in place, which is what makes the insert animation
 * and the count roll possible at all: you cannot animate a row that is destroyed
 * and recreated on every click.
 */

import type { CardDef, ContentIndex, DeckList, LeaderCardDef } from "../../engine/types";
import type { Screen } from "../shell";
import { TARGET_CURVE, legalCardPool, validateDeck } from "../../engine/deck";
import {
  autoCompleteDeck,
  buildAround,
  coverCard,
  coverOptions,
  currentSplit,
  deckNeeds,
  deckRecord,
  craftTargets,
  diffDecks,
  replacementsFor,
  suggestCards,
} from "../../game/decks";
import { selectableLeaders } from "../../engine/content";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE, RARITY_STYLE } from "../cardRenderer/palette";
import type { CurrentId } from "../../engine/types";
import { deleteDeck, getProfile, myCosmetics, saveDeck, setActiveDeck } from "../../save/profile";
import { cosmeticById } from "../../game/cosmetics";
import { drawEmblem } from "../cosmetics/emblem";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { DUR, motionEnabled } from "../motion";
import {
  bindScrollFades,
  canvasGhost,
  currentTag,
  draggable,
  enterRow,
  installKitStyles,
  lazyPaint,
  rarityTag,
  retileOnResize,
  tileWidth,
} from "./collectionKit";

/** 03 §4.3.2: "deck name (16 chars)". */
const NAME_LIMIT = 16;

/**
 * The plural of each card type, written out.
 *
 * `type.slice(0, 4)` produced "even 1", "acti 10", "equi 1", "loca 1" and
 * "reac 2" — a composition summary that has to be decoded, and one entry of
 * which reads as a statement about parity.
 */
const TYPE_PLURAL: Record<string, string> = {
  character: "Characters",
  action: "Actions",
  reaction: "Reactions",
  equipment: "Equipment",
  location: "Locations",
  transformation: "Transformations",
  event: "Events",
};

export interface DeckBuilderCallbacks {
  deckIndex?: number;
  onBack: () => void;
  /**
   * §4.3.2's *"Test vs AI"* — launch a practice match with the **draft**,
   * without saving it first. The draft is handed over rather than read back from
   * a slot, because the whole point is trying a list you have not committed to.
   */
  onTestDeck?: (deck: DeckList) => void;
}

/** Deck codes are base64 of a compact {l, c[]} payload — shareable as text. */
export function encodeDeck(deck: DeckList): string {
  const counts = new Map<string, number>();
  for (const id of deck.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  const payload = {
    n: deck.name,
    l: deck.leaderCardId,
    c: [...counts.entries()].map(([id, count]) => `${id}:${count}`),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export function decodeDeck(code: string, content: ContentIndex): DeckList | null {
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as {
      n?: string;
      l: string;
      c: string[];
    };
    if (!content.leaders[payload.l]) return null;
    const cards: string[] = [];
    for (const entry of payload.c) {
      const [id, countText] = entry.split(":");
      const count = Number(countText ?? 1);
      if (!id || !content.cards[id]) return null;
      for (let i = 0; i < count; i++) cards.push(id);
    }
    return { name: payload.n ?? "Imported Deck", leaderCardId: payload.l, cards };
  } catch {
    return null;
  }
}

export function createDeckBuilderScreen(content: ContentIndex, callbacks: DeckBuilderCallbacks): Screen {
  installKitStyles();

  const profile = getProfile();
  let deckIndex = callbacks.deckIndex ?? profile.activeDeckIndex;
  /**
   * A brand-new slot starts **empty**. It used to open on an `autoBuildDeck`
   * result, which builds from every printed card in the game — so a new
   * account's first visit presented thirty cards it did not own.
   */
  let deck: DeckList = structuredClone(
    profile.decks[deckIndex] ?? {
      name: "New Deck",
      leaderCardId: selectableLeaders(content)[0]?.id ?? "",
      cards: [],
    }
  );

  const root = document.createElement("div");
  root.className = "screen builder-screen db-v2";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="db-back">${icon("arrow-left")}<span>Decks</span></button>
      <input class="deck-name-input" id="db-name" aria-label="Deck name" maxlength="16" placeholder="Deck name" />
      <div class="row" id="db-header-actions"></div>
    </header>

    <div class="builder-body">
      <section class="builder-pool">
        <div class="builder-pool-head">
          <select class="leader-select" id="db-leader" aria-label="Leader"></select>
          <div class="search-field">
            ${icon("search", { size: 17 })}
            <input class="search-input" id="db-search" type="search" autocomplete="off"
                   placeholder="Search legal cards…" aria-label="Search cards" />
            <span class="search-count num" id="db-pool-count"></span>
          </div>
        </div>
        <div class="hb-scrollwrap" id="db-pool-wrap">
          <div class="pool-grid hb-scroll" id="db-pool"></div>
        </div>
      </section>

      <aside class="builder-side panel">
        <div class="builder-side-head">
          <div class="deck-stats" id="db-stats"></div>
        </div>
        <div class="hb-scrollwrap hb-fade-top" id="db-side-wrap">
          <div class="builder-side-scroll hb-scroll" id="db-side-scroll">
            <!--
              The curve is the first thing in the *scroll* region rather than a
              second pinned header. On a 900px window it is visible without
              scrolling, which is what it is for; on a 720px one the player can
              push it away and give the whole panel to the deck list, which is
              the object they came here to edit. A second fixed header would have
              taken that choice away at exactly the height where it matters.
            -->
            <div class="deck-curve" id="db-curve"></div>
            <div class="deck-list-block">
              <div class="deck-list-head">
                <span class="eyebrow">Deck list</span>
                <span class="muted num" id="db-list-count"></span>
              </div>
              <div class="deck-list" id="db-list"></div>
              <div class="deck-legend" id="db-legend"></div>
            </div>
            <div class="deck-identity" id="db-identity"></div>
            <div class="deck-assist" id="db-assist"></div>
          </div>
        </div>
        <div class="builder-side-foot">
          <div class="deck-validation" id="db-validation"></div>
          <div class="builder-actions" id="db-actions"></div>
        </div>
      </aside>
    </div>`;

  const nameInput = root.querySelector<HTMLInputElement>("#db-name");
  const leaderSelect = root.querySelector<HTMLSelectElement>("#db-leader");
  const poolHost = root.querySelector<HTMLElement>("#db-pool");
  const poolWrap = root.querySelector<HTMLElement>("#db-pool-wrap");
  const poolCount = root.querySelector<HTMLElement>("#db-pool-count");
  const listHost = root.querySelector<HTMLElement>("#db-list");
  const listCount = root.querySelector<HTMLElement>("#db-list-count");
  const legendHost = root.querySelector<HTMLElement>("#db-legend");
  const statsHost = root.querySelector<HTMLElement>("#db-stats");
  const curveHost = root.querySelector<HTMLElement>("#db-curve");
  const validationHost = root.querySelector<HTMLElement>("#db-validation");
  const identityHost = root.querySelector<HTMLElement>("#db-identity");
  const assistHost = root.querySelector<HTMLElement>("#db-assist");
  const actionsHost = root.querySelector<HTMLElement>("#db-actions");
  const headerActions = root.querySelector<HTMLElement>("#db-header-actions");
  const sideWrap = root.querySelector<HTMLElement>("#db-side-wrap");
  const sideScroll = root.querySelector<HTMLElement>("#db-side-scroll");
  const sidePanel = root.querySelector<HTMLElement>(".builder-side");

  const painter = lazyPaint(poolHost ?? root, "600px 0px");
  const unbindPoolFades = poolWrap && poolHost ? bindScrollFades(poolWrap, poolHost) : () => {};
  const unbindSideFades = sideWrap && sideScroll ? bindScrollFades(sideWrap, sideScroll) : () => {};

  let search = "";

  // ---- leader select -------------------------------------------------------
  for (const leader of selectableLeaders(content)) {
    const option = document.createElement("option");
    option.value = leader.id;
    option.textContent = `${leader.name} — ${content.factions[leader.faction]?.name ?? ""}`;
    leaderSelect?.appendChild(option);
  }
  if (leaderSelect) leaderSelect.value = deck.leaderCardId;

  leaderSelect?.addEventListener("change", () => {
    const newLeaderId = leaderSelect.value;
    deck.leaderCardId = newLeaderId;
    // drop cards the new leader cannot legally run
    const leader = content.leaders[newLeaderId];
    if (leader) {
      const legalIds = new Set(legalCardPool(content, leader).map((c) => c.id));
      deck.cards = deck.cards.filter((id) => legalIds.has(id));
    }
    resetPool();
    renderAll();
  });

  nameInput?.addEventListener("input", () => {
    /**
     * §4.3.2 caps a deck name at 16 characters. `maxlength` handles typing; this
     * handles a paste, and keeps the truncation in one place.
     */
    deck.name = nameInput.value.slice(0, NAME_LIMIT);
    if (nameInput.value !== deck.name) nameInput.value = deck.name;
    renderActions();
  });

  root.querySelector<HTMLInputElement>("#db-search")?.addEventListener("input", (event) => {
    search = (event.target as HTMLInputElement).value.trim().toLowerCase();
    painter.hold(200);
    renderPool();
  });

  // ---- deck operations -----------------------------------------------------

  function countOf(cardId: string): number {
    return deck.cards.filter((id) => id === cardId).length;
  }

  function maxCopies(card: CardDef): number {
    return card.rarity === "legendary"
      ? content.balance.deck.maxCopiesLegendary
      : content.balance.deck.maxCopies;
  }

  function canAdd(card: CardDef): boolean {
    if (deck.cards.length >= content.balance.deck.size) return false;
    if (countOf(card.id) >= maxCopies(card)) return false;
    return countOf(card.id) < (getProfile().collection[card.id] ?? 0);
  }

  function addCard(card: CardDef): void {
    if (!canAdd(card)) return;
    deck.cards.push(card.id);
    audio.play("sfx.ui.click");
    lastTouched = card.id;
    renderAll();
  }

  function removeCard(cardId: string): void {
    const index = deck.cards.lastIndexOf(cardId);
    if (index >= 0) {
      deck.cards.splice(index, 1);
      audio.play("sfx.ui.back");
      lastTouched = cardId;
      renderAll();
    }
  }

  /** The row that just changed, so it can flash rather than the list re-snapping. */
  let lastTouched: string | null = null;

  // ---- the pool ------------------------------------------------------------

  interface PoolCell {
    root: HTMLElement;
    slot: HTMLElement;
    badge: HTMLElement;
    canvas: HTMLCanvasElement | null;
    card: CardDef;
    attached: boolean;
    stopDrag: () => void;
  }
  const poolCells = new Map<string, PoolCell>();
  let poolOrder: CardDef[] = [];

  /**
   * A new leader is a new pool, so the old cells go.
   *
   * `release` matters as much as `remove`: a cell that is still queued for its
   * first paint would otherwise rasterise a card that is no longer legal, into
   * an element nothing is holding.
   */
  function resetPool(): void {
    for (const cell of poolCells.values()) {
      cell.stopDrag();
      painter.release(cell.root);
      cell.root.remove();
    }
    poolCells.clear();
    poolOrder = [];
  }

  /**
   * Draw the card at the width the pool grid actually handed the cell.
   *
   * The constant it replaces was 150, which at 844×390 — a resolution the bar
   * names as a floor — was drawn into a 96px track, so the pool overlapped
   * itself and ran off the right-hand edge.
   */
  function paintPool(entry: PoolCell): void {
    if (entry.canvas) return;
    // measured once: `clientWidth` inside the paint loop is a forced reflow of
    // the whole pool for every card, which costs more than it saves
    if (poolTrack === 0) poolTrack = tileWidth(entry.root, 150);
    const canvas = renderCardToCanvas(entry.card, poolTrack, {});
    entry.canvas = canvas;
    entry.slot.replaceWith(canvas);
  }
  let poolTrack = 0;

  function retilePool(): void {
    poolTrack = 0;
    for (const entry of poolCells.values()) {
      if (!entry.canvas) continue;
      entry.canvas.replaceWith(entry.slot);
      entry.canvas = null;
      painter.watch(entry.root, () => paintPool(entry));
    }
  }

  function buildPoolCell(card: CardDef): PoolCell {
    const cell = document.createElement("button");
    cell.className = "pool-cell";
    cell.type = "button";
    // the card id on the element, so a browser check can name what it clicked
    cell.dataset["card"] = card.id;

    const slot = document.createElement("div");
    slot.className = "card-slot";
    cell.appendChild(slot);

    const badge = document.createElement("div");
    badge.className = "pool-badge";
    cell.appendChild(badge);

    const entry: PoolCell = { root: cell, slot, badge, canvas: null, card, attached: false, stopDrag: () => {} };

    cell.addEventListener("click", () => addCard(card));

    painter.watch(cell, () => paintPool(entry));

    /**
     * §4.3.2's *"build around this card"*, on a card you own.
     *
     * A corner button rather than a modifier click: a shortcut nobody can see is
     * a feature nobody uses, and a modifier is unreachable on touch. Building
     * around a card you do not have would either seed an uncollected copy or
     * quietly leave it out, and both are worse than the control not being there.
     */
    if ((getProfile().collection[card.id] ?? 0) > 0) {
      const around = document.createElement("button");
      around.className = "pool-build-around";
      around.type = "button";
      around.dataset["around"] = card.id;
      around.innerHTML = icon("crosshair", { size: 14 });
      around.title = `Build a deck around ${card.name}`;
      around.setAttribute("aria-label", `Build a deck around ${card.name}`);
      around.addEventListener("click", (event) => {
        event.stopPropagation();
        const built = buildAround(content, card.id, getProfile().collection, "Around");
        if (!built) return;
        deck = built;
        if (leaderSelect) leaderSelect.value = deck.leaderCardId;
        audio.play("sfx.ui.click");
        resetPool();
        renderAll();
      });
      cell.appendChild(around);
    }

    /**
     * Drag from the pool into the deck panel.
     *
     * Click-to-add stays exactly as it was — it is the keyboard path and the
     * touch path — and this is the gesture a player who has used any other card
     * game will try first. The ghost is a real copy of the card's own pixels
     * rather than a rectangle, because the thing being dragged is the card.
     */
    entry.stopDrag = draggable(cell, {
      ghost: () => (entry.canvas ? canvasGhost(entry.canvas, 132) : document.createElement("div")),
      /**
       * The panel is a target even when the answer is no.
       *
       * It used to be offered only when the card could actually go in, so
       * dragging the thirty-first card of a thirty-card deck lit nothing, said
       * nothing, and dropped the card back where it came from — which reads as
       * a broken drag rather than a full deck. Now the zone is always there and
       * `allowed` decides what colour it is.
       */
      zones: () => (sidePanel ? [sidePanel] : []),
      allowed: () => canAdd(card),
      onDrop: (zone) => {
        if (zone && canAdd(card)) addCard(card);
        else audio.play("sfx.ui.back");
      },
    });

    return entry;
  }

  function renderPool(): void {
    if (!poolHost) return;
    const leader = content.leaders[deck.leaderCardId] as LeaderCardDef | undefined;
    if (!leader) return;

    if (poolOrder.length === 0) {
      poolOrder = legalCardPool(content, leader).sort(
        (a, b) => a.cost - b.cost || a.name.localeCompare(b.name)
      );
    }

    const profileNow = getProfile();
    let at = 0;
    let shown = 0;

    for (const card of poolOrder) {
      const visible =
        !search || `${card.name} ${card.text} ${card.tags.join(" ")}`.toLowerCase().includes(search);
      let cell = poolCells.get(card.id);
      if (!cell) {
        if (!visible) continue;
        cell = buildPoolCell(card);
        poolCells.set(card.id, cell);
      }

      if (!visible) {
        if (cell.attached) {
          cell.root.remove();
          cell.attached = false;
        }
        continue;
      }

      const owned = profileNow.collection[card.id] ?? 0;
      const cap = Math.min(maxCopies(card), owned);
      const inDeck = countOf(card.id);
      const atLimit = inDeck >= cap;
      cell.root.classList.toggle("unowned", owned <= 0);
      cell.root.classList.toggle("at-limit", atLimit);
      cell.root.setAttribute("aria-disabled", String(owned <= 0 || atLimit));
      const badge = owned <= 0 ? "Not owned" : `${inDeck}/${cap}`;
      if (cell.badge.textContent !== badge) cell.badge.textContent = badge;

      const here = poolHost.children[at];
      if (here !== cell.root) poolHost.insertBefore(cell.root, here ?? null);
      cell.attached = true;
      at += 1;
      shown += 1;
    }

    if (poolCount) poolCount.textContent = search ? `${shown} of ${poolOrder.length}` : "";
  }

  // ---- the deck list -------------------------------------------------------

  interface Row {
    root: HTMLElement;
    count: HTMLElement;
    stopDrag: () => void;
  }
  const rows = new Map<string, Row>();
  const bucketHeads = new Map<number, HTMLElement>();

  /** Rows and bucket headers mid-exit, with the timer that will remove them. */
  const leavingRows = new Map<HTMLElement, number>();

  function departRow(node: HTMLElement): void {
    if (!motionEnabled()) {
      node.remove();
      return;
    }
    node.classList.add("hb-row-out");
    leavingRows.set(
      node,
      window.setTimeout(() => {
        leavingRows.delete(node);
        node.classList.remove("hb-row-out");
        node.remove();
      }, DUR.ui + 40)
    );
  }

  /** Cancel an exit, whichever way it ended. */
  function landRow(node: HTMLElement): void {
    const timer = leavingRows.get(node);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    leavingRows.delete(node);
    node.classList.remove("hb-row-out");
  }

  function bucketHead(cost: number, total: number): HTMLElement {
    let head = bucketHeads.get(cost);
    if (!head) {
      head = document.createElement("div");
      head.className = "deck-bucket-head";
      bucketHeads.set(cost, head);
    }
    head.innerHTML =
      `<span>${cost === 7 ? "7+" : cost} Hype</span>` +
      `<span class="deck-bucket-rule" aria-hidden="true"></span>` +
      `<b>${total}</b>`;
    return head;
  }

  function buildRow(card: CardDef): Row {
    const entry = document.createElement("button");
    entry.className = "deck-row";
    entry.type = "button";
    entry.dataset["card"] = card.id;
    entry.style.setProperty("--row-color", CURRENT_PALETTE[card.current].key);
    entry.innerHTML =
      `<span class="deck-row-cost num">${card.cost}</span>` +
      `<span class="deck-row-name">${card.name}</span>` +
      currentTag(card.current) +
      rarityTag(card.rarity) +
      `<span class="deck-row-count num">×1</span>`;
    entry.title = `${card.name} — ${card.text}`;
    entry.setAttribute("aria-label", `Remove one ${card.name}`);
    entry.addEventListener("click", () => removeCard(card.id));

    /** Dragging a row out of the panel removes a copy — the reverse gesture. */
    const stopDrag = draggable(entry, {
      ghost: () => {
        const ghost = document.createElement("div");
        ghost.className = "deck-row hb-ghost-row";
        ghost.style.setProperty("--row-color", CURRENT_PALETTE[card.current].key);
        ghost.innerHTML = entry.innerHTML;
        ghost.style.width = `${entry.getBoundingClientRect().width}px`;
        return ghost;
      },
      zones: () => (poolHost ? [poolHost] : []),
      onDrop: (zone) => {
        if (zone) removeCard(card.id);
      },
    });

    return { root: entry, count: entry.querySelector<HTMLElement>(".deck-row-count")!, stopDrag };
  }

  function renderList(): void {
    if (!listHost) return;
    const counts = new Map<string, number>();
    for (const id of deck.cards) counts.set(id, (counts.get(id) ?? 0) + 1);

    const entries = [...counts.entries()]
      .map(([id, count]) => ({ card: content.cards[id], count }))
      .filter((row): row is { card: CardDef; count: number } => row.card !== undefined)
      .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name));

    /**
     * Cost-bucket headers, so a thirty-card list reads as a curve rather than as
     * a column. They are the same landmarks the collection shelves use, which is
     * the point: one vocabulary for "these cards cost this much".
     */
    const wanted: HTMLElement[] = [];
    let bucket = -1;
    for (const entry of entries) {
      const cost = Math.min(entry.card.cost, 7);
      if (cost !== bucket) {
        bucket = cost;
        const total = entries
          .filter((row) => Math.min(row.card.cost, 7) === cost)
          .reduce((sum, row) => sum + row.count, 0);
        wanted.push(bucketHead(cost, total));
      }
      let row = rows.get(entry.card.id);
      if (!row) {
        row = buildRow(entry.card);
        rows.set(entry.card.id, row);
      }
      const label = `×${entry.count}`;
      if (row.count.textContent !== label) row.count.textContent = label;
      row.root.classList.toggle("is-max", entry.count >= maxCopies(entry.card));
      wanted.push(row.root);
    }

    /**
     * A row that reaches zero leaves; it is not deleted out from under the
     * player.
     *
     * The list reconciles on the way in — an added card touches one row and
     * nothing else moves — and used to be swept on the way out by
     * `while (children.length > wanted.length) lastElementChild.remove()`, which
     * is not a reconcile at all: it deletes from the *end* regardless of which
     * row actually went, so the surviving rows below the gap shuffled up on the
     * same frame with no animation and nothing said which card had gone.
     *
     * Now the row that lost its last copy collapses where it stands, and the
     * rows under it close the gap over the same beat. §3a: everything that
     * appears has an entrance and everything that leaves has an exit.
     */
    const keep = new Set<Element>(wanted);
    for (const node of [...listHost.children]) {
      const row = node as HTMLElement;
      if (keep.has(row)) {
        // it came back while it was still folding away
        landRow(row);
        continue;
      }
      if (!leavingRows.has(row)) departRow(row);
    }

    // patch the children into the wanted order, creating and removing only what
    // actually changed — the whole reason an insert can be animated at all
    let index = 0;
    let arrived = 0;
    for (const node of wanted) {
      // a row on its way out holds its place while it collapses, so it must not
      // be mistaken for the row that belongs at this index
      while (leavingRows.has(listHost.children[index] as HTMLElement)) index += 1;
      const here = listHost.children[index];
      if (here !== node) {
        const fresh = !node.isConnected;
        listHost.insertBefore(node, here ?? null);
        if (fresh && node.classList.contains("deck-row")) enterRow(node, arrived++);
      }
      index += 1;
    }

    for (const [id, row] of rows) {
      if (!row.root.isConnected) {
        row.stopDrag();
        rows.delete(id);
      }
    }

    // the row that just changed lights, so an add is visible in the list as well
    // as in the counter
    if (lastTouched) {
      const row = rows.get(lastTouched);
      if (row && motionEnabled()) {
        row.root.classList.remove("is-touched");
        void row.root.offsetWidth;
        row.root.classList.add("is-touched");
      }
      lastTouched = null;
    }

    if (listCount) {
      listCount.textContent = `${entries.length} row${entries.length === 1 ? "" : "s"} · ${deck.cards.length} cards`;
    }

    if (legendHost && legendHost.childElementCount === 0) {
      legendHost.innerHTML =
        `<span>${rarityTag("common")} Common</span>` +
        `<span>${rarityTag("rare")} Rare</span>` +
        `<span>${rarityTag("epic")} Epic</span>` +
        `<span>${rarityTag("legendary")} Legendary</span>`;
    }
  }

  // ---- stats and the curve -------------------------------------------------

  interface CurveBar {
    root: HTMLElement;
    fill: HTMLElement;
    count: HTMLElement;
    /** The target for *this* bucket, drawn as a dashed lid over the column. */
    step: HTMLElement;
  }
  let curveBars: CurveBar[] = [];
  let curveNote: HTMLElement | null = null;
  let curveBarsHost: HTMLElement | null = null;

  /**
   * The chart frame, built once.
   *
   * `.curve-fill` declared `transition: height` and never ran it, because
   * `renderStats` replaced the whole `innerHTML` on every keystroke — a
   * transition on an element that is destroyed before the next frame is dead
   * code. Building the frame once and mutating the bars is what makes the
   * declared transition real, and it is also why the bars can stagger.
   *
   * ## The target is per bucket, because the caption always said it was
   *
   * There used to be one dashed rule across all eight columns, at the mean of
   * the target curve — while the note under it read "Thinnest at 3 Hype — 2
   * short of the target curve", which promises a shape the chart was not
   * drawing. A flat line cannot be short at 3 and fine at 2. Each column now
   * carries its own dashed lid at its own target, so the sentence is a caption
   * for something the eye can already see rather than a claim it has to take on
   * trust.
   */
  function buildCurve(): void {
    if (!curveHost || curveBars.length > 0) return;
    const frame = document.createElement("div");
    frame.className = "curve-frame";
    const bars = document.createElement("div");
    bars.className = "curve-bars";
    curveBarsHost = bars;

    for (let cost = 0; cost <= 7; cost += 1) {
      const bar = document.createElement("div");
      bar.className = "curve-bar";
      const fill = document.createElement("div");
      fill.className = "curve-fill";
      const count = document.createElement("div");
      count.className = "curve-count";
      const step = document.createElement("div");
      step.className = "curve-step";
      step.setAttribute("aria-hidden", "true");
      bar.append(fill, step, count);
      bar.style.setProperty("--bar-delay", `${cost * 34}ms`);
      bars.appendChild(bar);
      curveBars.push({ root: bar, fill, count, step });
    }

    frame.appendChild(bars);

    const axis = document.createElement("div");
    axis.className = "curve-axis";
    axis.innerHTML = [0, 1, 2, 3, 4, 5, 6, "7+"].map((label) => `<span>${label}</span>`).join("");

    curveNote = document.createElement("p");
    curveNote.className = "muted curve-note";
    curveNote.id = "db-curve-note";

    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Hype Curve";
    curveHost.append(eyebrow, frame, axis, curveNote);
  }

  function renderStats(): void {
    if (!statsHost || !curveHost) return;
    const size = content.balance.deck.size;

    const typeCounts = new Map<string, number>();
    let totalCost = 0;
    for (const id of deck.cards) {
      const card = content.cards[id];
      if (!card) continue;
      typeCounts.set(card.type, (typeCounts.get(card.type) ?? 0) + 1);
      totalCost += card.cost;
    }
    const avgCost = deck.cards.length > 0 ? (totalCost / deck.cards.length).toFixed(1) : "0.0";

    statsHost.innerHTML = `
      <div class="deck-count ${deck.cards.length === size ? "complete" : ""}">
        <span class="deck-count-value num">${deck.cards.length}</span><span class="deck-count-max num">/${size}</span>
      </div>
      <div class="deck-meta">
        <div class="muted">Average cost <b class="num">${avgCost}</b></div>
        <div class="deck-types">${[...typeCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => `<span class="type-pill">${TYPE_PLURAL[type] ?? type} <b class="num">${count}</b></span>`)
          .join("")}</div>
      </div>`;

    buildCurve();

    const buckets = new Array(8).fill(0) as number[];
    for (const id of deck.cards) {
      const card = content.cards[id];
      if (!card) continue;
      const at = Math.min(card.cost, 7);
      buckets[at] = (buckets[at] ?? 0) + 1;
    }

    /**
     * Bars show what the curve *is*; the ghost line and the note say where it is
     * furthest from what it should be, which is the question somebody looking at
     * a histogram is actually asking.
     */
    const need = deckNeeds(content, deck);
    const targetPeak = Math.max(...Object.values(TARGET_CURVE));
    const peak = Math.max(targetPeak, ...buckets);

    /**
     * One layout read for the whole chart, and then nothing but transforms.
     *
     * The bars used to grow on `height` and the labels to ride up on `bottom`,
     * which §3a's non-negotiables name outright: "Animate transform, opacity and
     * filter. Never width, top, or box-shadow on a large surface." Containment
     * fenced the invalidation inside the chart, which made it affordable rather
     * than correct — a layout animation still runs on the main thread and still
     * cannot be handed to the compositor. Sixteen elements moving on `transform`
     * cost the same as one.
     *
     * The pixel height is what makes that possible: a `translateY` percentage
     * resolves against the *label's* own box, not the column's, so the label has
     * to be told where to go in real units.
     */
    const track = curveBarsHost?.clientHeight ?? 62;
    /** An empty column still draws a rail, so the axis reads as continuous. */
    const EMPTY_RAIL = 2;

    for (const [cost, bar] of curveBars.entries()) {
      const count = buckets[cost] ?? 0;
      const filled = count === 0 ? EMPTY_RAIL : Math.max(3, (count / peak) * track);
      bar.fill.style.transform = `scaleY(${(filled / track).toFixed(4)})`;
      bar.count.style.transform = `translate(-50%, ${-Math.round(filled + 3)}px)`;
      bar.root.classList.toggle("is-zero", count === 0);
      bar.root.classList.toggle("is-empty", count === 0);
      bar.root.classList.toggle("is-thin", cost === need.worstBucket);
      /*
       * A zero prints twice otherwise: once as the count label and once as the
       * axis tick 20px below it, with nothing in between, so the chart appeared
       * to start at 1.
       */
      bar.count.hidden = count === 0;
      if (bar.count.textContent !== String(count)) bar.count.textContent = String(count);
      const target = TARGET_CURVE[cost] ?? 0;
      bar.step.style.transform = `translateY(${-Math.round((target / peak) * track)}px)`;
      bar.step.hidden = target <= 0;
      bar.root.classList.toggle("is-short", target > 0 && count < target);
      bar.root.title = `${cost === 7 ? "7+" : cost} Hype — ${count} card${count === 1 ? "" : "s"}${
        target ? `, target ${target}` : ""
      }`;
    }

    if (curveNote) {
      curveNote.textContent =
        need.worstBucket !== null
          ? `Thinnest at ${need.worstBucket === 7 ? "7+" : need.worstBucket} Hype — ${
              need.curve[need.worstBucket] ?? 0
            } short of the target curve.`
          : "The curve is where it wants to be.";
    }
  }

  function renderValidation(): void {
    if (!validationHost) return;
    const problems = validateDeck(content, deck);
    if (problems.length === 0) {
      validationHost.innerHTML = `<div class="validation-ok">${icon("check", { size: 15 })}<span>Legal deck — ready to play</span></div>`;
      return;
    }
    validationHost.innerHTML = `<div class="validation-problems">${problems
      .map((p) => `<div class="validation-problem">${icon("warning", { size: 15 })}<span>${p.message}</span></div>`)
      .join("")}</div>`;
  }

  function renderActions(): void {
    if (!actionsHost || !headerActions) return;
    actionsHost.innerHTML = "";
    headerActions.innerHTML = "";

    /**
     * The last gate before a deck leaves this screen.
     *
     * `validateDeck` deliberately says nothing about ownership — six systems deal
     * decks of cards you do not own — so the builder has to. Without this,
     * pasting a deck code was a way straight past the pool's one `if`.
     */
    const unowned = (): string | null => {
      const missing = replacementsFor(content, deck, getProfile().collection);
      if (missing.length === 0) return null;
      const first = missing[0]!;
      return (
        `You do not own enough copies of ${first.name}${
          missing.length > 1 ? ` (and ${missing.length - 1} other card${missing.length === 2 ? "" : "s"})` : ""
        }. Swap ${missing.length === 1 ? "it" : "them"} out below, or craft what is missing.`
      );
    };

    /**
     * A label and, optionally, a note that is allowed to go away.
     *
     * The five actions share one footer row on a 720px window, and
     * "Compare — saved" wrapped to two lines inside its button there — which is
     * the sort of thing that reads as unfinished long before anybody works out
     * why. The state half of that label is secondary by construction (the deck
     * counter and the validation line above it say the same thing), so it is
     * marked as such and the stylesheet drops it when the row is tight, leaving
     * a clean "Compare" rather than a wrapped one.
     */
    const makeButton = (
      label: string,
      className: string,
      handler: () => void,
      note?: string
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.className = `btn ${className}`;
      button.append(label);
      if (note) {
        const tail = document.createElement("span");
        tail.className = "btn-note";
        tail.textContent = ` ${note}`;
        button.appendChild(tail);
        button.title = `${label} ${note}`;
      }
      button.addEventListener("click", handler);
      return button;
    };

    actionsHost.append(
      makeButton("Save Deck", "btn-primary", () => {
        const problems = validateDeck(content, deck);
        if (problems.length > 0) {
          renderValidation();
          return;
        }
        const cannotField = unowned();
        if (cannotField) {
          if (validationHost) {
            validationHost.innerHTML = `<div class="validation-problem" id="db-unowned">${cannotField}</div>`;
          }
          return;
        }
        /**
         * `saveDeck` returns −1 when every slot is full. Unhandled, the player
         * pressed Save on a full account, nothing was written, and the screen
         * said "Saved and set as your active deck".
         */
        const saved = saveDeck(structuredClone(deck), getProfile().decks[deckIndex] ? deckIndex : undefined);
        if (saved < 0) {
          if (validationHost) {
            validationHost.innerHTML = `<div class="validation-problem" id="db-slots-full">All ${
              content.balance.deck.slots
            } deck slots are in use. Delete one from Decks to make room — nothing has been overwritten.</div>`;
          }
          return;
        }
        deckIndex = saved;
        setActiveDeck(deckIndex);
        audio.play("sfx.ui.click");
        /**
         * Re-render everything. The Compare button's label is the
         * unsaved-changes indicator, so it has to be recomputed the moment there
         * is something new to compare against.
         */
        renderAll();
        if (validationHost) {
          validationHost.innerHTML = `<div class="validation-ok">${icon("check", { size: 15 })}<span>Saved and set as your active deck</span></div>`;
        }
      }),
      makeButton("Auto-Complete", "btn-ghost", () => {
        // fills from the collection and keeps what you already chose; it stops
        // short rather than adding a card you do not own
        deck = autoCompleteDeck(content, deck, getProfile().collection);
        renderAll();
        const size = content.balance.deck.size;
        if (validationHost && deck.cards.length < size) {
          validationHost.innerHTML = `<div class="validation-problem" id="db-short">Filled to ${deck.cards.length} of ${size} from cards you own. Craft or open Drops for the rest — see “Worth crafting” below.</div>`;
        }
      }),
      /**
       * The button label is also the unsaved-changes indicator: "Compare (+3 −1)"
       * answers *"have I changed anything since I saved?"* without opening
       * anything, which is the question the diff is usually opened to answer.
       */
      makeButton(
        "Compare",
        "btn-ghost",
        () => {
          comparing = !comparing;
          renderAssist();
        },
        (() => {
          const diff = diffDecks(content, savedDeck(), deck);
          if (diff.unsaved) return undefined;
          if (diff.identical) return "— saved";
          if (diff.added === 0 && diff.removed === 0) return "— unsaved";
          return `(+${diff.added} −${diff.removed})`;
        })()
      ),
      makeButton("Test vs AI", "btn-ghost", () => {
        const problems = validateDeck(content, deck);
        if (problems.length > 0) {
          renderValidation();
          return;
        }
        const cannotField = unowned();
        if (cannotField) {
          if (validationHost) {
            validationHost.innerHTML = `<div class="validation-problem" id="db-unowned">${cannotField}</div>`;
          }
          return;
        }
        audio.play("sfx.ui.click");
        callbacks.onTestDeck?.(structuredClone(deck));
      }),
      makeButton("Clear", "btn-ghost", () => {
        deck.cards = [];
        renderAll();
      })
    );

    headerActions.append(
      makeButton("Export", "btn-ghost", () => {
        const code = encodeDeck(deck);
        void navigator.clipboard?.writeText(code);
        if (validationHost) {
          validationHost.innerHTML = `<div class="validation-ok">Deck code copied to clipboard</div>
            <textarea class="deck-code" readonly rows="3">${code}</textarea>`;
        }
      }),
      makeButton("Import", "btn-ghost", () => {
        const code = window.prompt("Paste a deck code:");
        if (!code) return;
        const imported = decodeDeck(code, content);
        if (!imported) {
          if (validationHost) validationHost.innerHTML = '<div class="validation-problem">That deck code could not be read.</div>';
          return;
        }
        deck = imported;
        if (leaderSelect) leaderSelect.value = deck.leaderCardId;
        resetPool();
        renderAll();
      }),
      makeButton("Delete", "btn-ghost", () => {
        /**
         * `getProfile()`, not the mount-time snapshot. `Store.update` replaces
         * its cache with a fresh clone, so `profile` captured when the screen was
         * built never sees anything saved since.
         */
        if (getProfile().decks[deckIndex]) {
          deleteDeck(deckIndex);
          callbacks.onBack();
        }
      })
    );
  }

  // ---- assistance (§4.3.2) -------------------------------------------------

  /** The saved version of the slot being edited, or null if it has never been saved. */
  const savedDeck = (): DeckList | null => getProfile().decks[deckIndex] ?? null;

  const esc = (value: string): string =>
    value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  /** true while the Compare panel is open; it replaces the suggestions panel. */
  let comparing = false;

  /**
   * The suggestions panel, and the Compare-versions panel that replaces it.
   * Both read the account's real collection, which is the whole point.
   */
  function renderAssist(): void {
    if (!assistHost) return;
    const collection = getProfile().collection;

    if (comparing) {
      const diff = diffDecks(content, savedDeck(), deck);
      assistHost.innerHTML = renderDiff(diff);
      assistHost.querySelector("#db-diff-close")?.addEventListener("click", () => {
        comparing = false;
        renderAssist();
      });
      return;
    }

    const suggestions = suggestCards(content, deck, collection);
    const missing = replacementsFor(content, deck, collection);
    const craft = craftTargets(content, deck, collection);

    if (suggestions.length === 0 && missing.length === 0 && craft.length === 0) {
      assistHost.innerHTML = "";
      return;
    }

    const rowsOf = (title: string, id: string, body: string): string =>
      body ? `<div class="assist-block" id="${id}"><div class="eyebrow">${title}</div>${body}</div>` : "";

    assistHost.innerHTML = [
      rowsOf(
        "Suggested next",
        "db-suggestions",
        /**
         * The strength bar reads `Suggestion.score`, drawn relative to the best
         * row rather than on an absolute scale: the number has no units, and
         * what a player can use is "the top one is far better than the rest"
         * versus "these five are much of a muchness".
         */
        ((best) =>
          suggestions
            .map(
              (suggestion) => `
              <button class="assist-row" data-add="${esc(suggestion.cardId)}" data-reason="${
                suggestion.reason
              }" data-score="${suggestion.score}">
                <span class="assist-cost num">${suggestion.cost}</span>
                <span class="assist-name">${esc(suggestion.name)}</span>
                <span class="assist-strength" aria-hidden="true"><i style="width:${Math.round(
                  (suggestion.score / best) * 100
                )}%"></i></span>
                <span class="assist-why muted">${esc(suggestion.why)}</span>
              </button>`
            )
            .join(""))(Math.max(1, ...suggestions.map((s) => s.score)))
      ),
      rowsOf(
        "You cannot field these",
        "db-replacements",
        missing
          .map(
            (entry) => `
              <div class="assist-row assist-missing" data-missing="${esc(entry.cardId)}">
                <span class="assist-name">${esc(entry.name)} ×${entry.excess}</span>
                <span class="assist-why muted">${
                  entry.with
                    ? `you do not own enough — try ${esc(entry.with.name)}`
                    : "you do not own enough, and there is nothing to swap in"
                }</span>
                ${
                  entry.with
                    ? `<button class="btn btn-ghost btn-sm" data-swap="${esc(entry.cardId)}" data-with="${esc(
                        entry.with.cardId
                      )}">Swap</button>`
                    : ""
                }
              </div>`
          )
          .join("")
      ),
      rowsOf(
        "Worth crafting",
        "db-craft",
        craft
          .map(
            (target) => `
              <div class="assist-row assist-craft" data-craft="${esc(target.cardId)}">
                <span class="assist-cost num">${target.cost}</span>
                <span class="assist-name">${esc(target.name)}</span>
                <span class="assist-why muted">${esc(target.why)} — you own ${
                  (collection[target.cardId] ?? 0)
                }</span>
              </div>`
          )
          .join("")
      ),
    ].join("");

    for (const button of assistHost.querySelectorAll<HTMLButtonElement>("[data-add]")) {
      button.addEventListener("click", () => {
        const card = content.cards[button.dataset["add"] ?? ""];
        if (card) addCard(card);
      });
    }
    for (const button of assistHost.querySelectorAll<HTMLButtonElement>("[data-swap]")) {
      button.addEventListener("click", () => {
        const out = button.dataset["swap"] ?? "";
        const into = content.cards[button.dataset["with"] ?? ""];
        // one copy at a time, so a two-of becomes a one-of plus one of something
        // else rather than silently rewriting the list
        const at = deck.cards.indexOf(out);
        if (at >= 0 && into) {
          deck.cards.splice(at, 1);
          deck.cards.push(into.id);
          renderAll();
        }
      });
    }
  }

  function renderDiff(diff: ReturnType<typeof diffDecks>): string {
    if (diff.unsaved) {
      return `<div class="assist-block" id="db-diff">
        <div class="eyebrow">Compare versions</div>
        <p class="muted">Nothing is saved in this slot yet, so there is no earlier version to compare against.</p>
        <button class="btn btn-ghost btn-sm" id="db-diff-close">Close</button>
      </div>`;
    }
    if (diff.identical) {
      return `<div class="assist-block" id="db-diff">
        <div class="eyebrow">Compare versions</div>
        <p class="muted">Unchanged since you last saved.</p>
        <button class="btn btn-ghost btn-sm" id="db-diff-close">Close</button>
      </div>`;
    }

    const line = (row: (typeof diff.rows)[number]): string => `
      <div class="assist-row diff-row ${row.delta > 0 ? "diff-added" : "diff-removed"}" data-diff="${esc(row.cardId)}">
        <span class="assist-cost num">${row.cost}</span>
        <span class="assist-name">${esc(row.name)}</span>
        <span class="diff-counts num">${row.before} → ${row.after}</span>
      </div>`;

    return `<div class="assist-block" id="db-diff">
      <div class="eyebrow">Compare versions</div>
      <p class="muted" id="db-diff-summary">
        ${diff.added} added, ${diff.removed} cut · ${diff.beforeSize} → ${diff.afterSize} cards${
          diff.leaderChanged ? " · leader changed" : ""
        }${diff.nameChanged ? " · renamed" : ""}${diff.coverChanged ? " · new cover" : ""}${
          diff.cardBackChanged ? " · new card back" : ""
        }
      </p>
      ${diff.rows.map(line).join("")}
      <button class="btn btn-ghost btn-sm" id="db-diff-close">Close</button>
    </div>`;
  }

  // ---- identity: Current split, cover, card back (§4.3.2) ------------------

  /** Which identity picker is open, if any. Both are lists, so only one at a time. */
  let picking: "cover" | "cardBack" | null = null;

  /**
   * §4.3.2's *"Current split donut with Resonance/Confluence indicator"*.
   *
   * The donut is a conic gradient rather than an SVG or a canvas: one element,
   * scales with the interface size for free, nothing to redraw when a card is
   * added. The **verdict line under it** is the part that matters — a picture
   * says what the split is, and the sentence says what it buys you.
   */
  function renderIdentity(): void {
    if (!identityHost) return;
    const split = currentSplit(content, deck);
    const profileNow = getProfile();
    const record = deckRecord(content, profileNow.history, deck.name);

    let angle = 0;
    const stops = split.slices
      .map((slice) => {
        const from = angle;
        angle += slice.share * 360;
        return `${CURRENT_PALETTE[slice.current as CurrentId]?.key ?? "#8f8aa8"} ${from}deg ${angle}deg`;
      })
      .join(", ");

    const back = deck.cardBackId ? cosmeticById(content, deck.cardBackId) : null;
    const cover = coverCard(content, deck);

    identityHost.innerHTML = `
      <div class="identity-row">
        <div class="current-donut" id="db-donut" style="${
          stops ? `background: conic-gradient(${stops})` : "background: var(--glass)"
        }" role="img" aria-label="${esc(split.verdict)}"><span class="current-donut-hole"></span></div>
        <div class="identity-copy">
          <div class="muted" id="db-verdict">${esc(split.verdict)}</div>
          <div class="identity-legend">${split.slices
            .map(
              (slice) =>
                `<span class="identity-swatch" data-current="${esc(slice.current)}"><i style="background:${
                  CURRENT_PALETTE[slice.current as CurrentId]?.key ?? "#8f8aa8"
                }"></i>${esc(slice.name)} ${slice.count}</span>`
            )
            .join("")}${
              split.prism > 0 ? `<span class="identity-swatch"><i style="background:${CURRENT_PALETTE.prism.key}"></i>Prism ${split.prism}</span>` : ""
            }</div>
        </div>
      </div>
      <div class="identity-row identity-picks">
        <button class="btn btn-ghost btn-sm" id="db-pick-cover">Cover: ${esc(cover?.name ?? "none")}</button>
        <button class="btn btn-ghost btn-sm" id="db-pick-back">Card back: ${esc(back?.name ?? "default")}</button>
      </div>
      <div class="muted identity-record" id="db-record">${
        record.played === 0
          ? "No matches played with this deck yet."
          : record.thin
            ? `${record.played} match${record.played === 1 ? "" : "es"} played — too few to report a win rate.`
            : `${record.played} matches · ${Math.round(record.winRate * 100)}% won · ${record.averageTurns.toFixed(
                1
              )} turns on average`
      }</div>
      <div class="identity-picker" id="db-picker"></div>`;

    identityHost.querySelector("#db-pick-cover")?.addEventListener("click", () => {
      picking = picking === "cover" ? null : "cover";
      renderIdentity();
    });
    identityHost.querySelector("#db-pick-back")?.addEventListener("click", () => {
      picking = picking === "cardBack" ? null : "cardBack";
      renderIdentity();
    });

    const picker = identityHost.querySelector<HTMLElement>("#db-picker");
    if (!picker || picking === null) return;

    if (picking === "cover") {
      const options = coverOptions(content, deck);
      if (options.length === 0) {
        picker.innerHTML = `<p class="muted">Add a card and it can be the cover.</p>`;
        return;
      }
      for (const card of options) {
        const button = document.createElement("button");
        button.className = `identity-option ${deck.coverCardId === card.id ? "is-chosen" : ""}`;
        button.type = "button";
        button.dataset["cover"] = card.id;
        button.title = card.name;
        button.appendChild(renderCardToCanvas(card, 92));
        button.addEventListener("click", () => {
          deck.coverCardId = card.id;
          picking = null;
          audio.play("sfx.ui.click");
          renderAll();
        });
        picker.appendChild(button);
      }
      return;
    }

    /**
     * Card backs you **own**, plus the house default. `myCosmetics` already
     * filters to owned ids, so an unearned back is not on the list rather than
     * shown and refused.
     */
    const owned = myCosmetics(content).filter((cosmetic) => cosmetic.kind === "cardBack");
    const choices: { id: string | null; name: string; color: string; emblem: string | null }[] = [
      { id: null, name: "Default", color: "#8f8aa8", emblem: null },
      ...owned.map((cosmetic) => ({
        id: cosmetic.id,
        name: cosmetic.name,
        color: cosmetic.color,
        emblem: cosmetic.emblem ?? null,
      })),
    ];

    for (const choice of choices) {
      const button = document.createElement("button");
      button.className = `identity-option identity-back ${
        (deck.cardBackId ?? null) === choice.id ? "is-chosen" : ""
      }`;
      button.type = "button";
      button.dataset["back"] = choice.id ?? "default";
      button.title = choice.name;

      const swatch = document.createElement("canvas");
      swatch.width = 92;
      swatch.height = 128;
      const ctx = swatch.getContext("2d");
      if (ctx) {
        ctx.fillStyle = choice.color;
        ctx.fillRect(0, 0, swatch.width, swatch.height);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.save();
        ctx.scale(0.28, 0.28);
        drawEmblem(ctx, (choice.emblem ?? "diamond") as never, swatch.width / 2 / 0.28, swatch.height / 2 / 0.28);
        ctx.restore();
      }
      button.appendChild(swatch);
      const label = document.createElement("span");
      label.className = "identity-option-name";
      label.textContent = choice.name;
      button.appendChild(label);

      button.addEventListener("click", () => {
        if (choice.id === null) delete deck.cardBackId;
        else deck.cardBackId = choice.id;
        picking = null;
        audio.play("sfx.ui.click");
        renderAll();
      });
      picker.appendChild(button);
    }
  }

  function renderAll(): void {
    if (nameInput) nameInput.value = deck.name;
    renderPool();
    renderList();
    renderStats();
    renderValidation();
    renderIdentity();
    renderAssist();
    renderActions();
  }

  root.querySelector("#db-back")?.addEventListener("click", () => callbacks.onBack());
  const unbindRetile = poolHost
    ? retileOnResize(poolHost, () => poolHost.querySelector(".pool-cell")?.clientWidth ?? 0, retilePool)
    : () => {};
  renderAll();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundBuilder?: unknown }).hypeboundBuilder = {
    deck: () => structuredClone(deck),
    slot: () => deckIndex,
    split: () => currentSplit(content, deck),
    suggestions: () => suggestCards(content, deck, getProfile().collection),
    refresh: renderAll,
  };

  return {
    root,
    dispose: () => {
      painter.stop();
      unbindPoolFades();
      unbindSideFades();
      unbindRetile();
      for (const cell of poolCells.values()) cell.stopDrag();
      for (const row of rows.values()) row.stopDrag();
      for (const timer of leavingRows.values()) window.clearTimeout(timer);
      leavingRows.clear();
      delete (window as unknown as { hypeboundBuilder?: unknown }).hypeboundBuilder;
    },
  };
}
