/**
 * Collection browser: search, filters, the grid, detail inspection, crafting
 * and dismantling, favourites and locks, and missing-card indicators.
 *
 * ## The two things this screen exists to get right
 *
 * **It has to be typeable.** The grid is 245 cards and the search box is the
 * primary way anybody finds one. A round-one measurement had a single keystroke
 * blocking the main thread for 2,499.6ms because `render` rebuilt every canvas;
 * persisting the cells cut that to a handful of milliseconds of script, and then
 * the cost simply moved — 206ms of *paint* per keystroke, because 245 live
 * canvases were being re-laid whether or not their pixels changed, and 1,476ms
 * to the first tile on mount because all 245 were rasterised before anything was
 * on screen. Only about twenty-one are ever visible. So the cells are built once
 * and kept, their bitmaps are painted when they come near the fold and never
 * again, and the filter is debounced so one word is one pass rather than
 * eighteen.
 *
 * **It has to read as a library rather than a spreadsheet.** An 8,381px
 * undifferentiated seven-column contact sheet is the same information with none
 * of the rhythm: nothing to navigate by, nowhere for the eye to rest, no sense
 * of how far through you are. The grid is now shelves — one per Hype cost, with
 * a sticky header, a lit plane behind the cards and a contact shadow under each
 * one — so scrolling passes landmarks and the collection has a shape.
 */

import type { CardDef, ContentIndex, CurrentId, FactionId, KeywordId, Rarity, CardType } from "../../engine/types";
import type { Screen } from "../shell";
import { collectibleCards } from "../../engine/content";
import { hoverCard, renderCardToCanvas, tiltCard } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE, FACTION_COLOR, RARITY_STYLE, hexToRgba } from "../cardRenderer/palette";
import { craftCard, dismantleCard, getProfile, profileStore, toggleFavorite, toggleLock } from "../../save/profile";
import { loreFor } from "../../game/cardLore";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { DUR, EASE, cssEase, motionEnabled, stagger, tickerTo } from "../motion";
import {
  CURRENT_SIGIL,
  bindScrollFades,
  debounce,
  emptyState,
  esc,
  installKitStyles,
  lazyPaint,
  rarityTag,
  retileOnResize,
  richText,
  tileWidth,
} from "./collectionKit";

export interface CollectionCallbacks {
  onBack: () => void;
}

interface Filters {
  search: string;
  factions: Set<FactionId>;
  currents: Set<CurrentId>;
  rarities: Set<Rarity>;
  types: Set<CardType>;
  keywords: Set<KeywordId>;
  costs: Set<number>;
  ownership: "all" | "owned" | "missing" | "favorites";
}

/** Cost buckets, 0–6 and one 7+ shelf, which is how the curve already buckets. */
const BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const bucketOf = (cost: number): number => (cost >= 7 ? 7 : cost);
const bucketLabel = (bucket: number): string => (bucket === 7 ? "7+" : String(bucket));

export function createCollectionScreen(content: ContentIndex, callbacks: CollectionCallbacks): Screen {
  installKitStyles();

  const allCards = collectibleCards(content).sort(
    (a, b) => a.cost - b.cost || a.name.localeCompare(b.name)
  );

  const filters: Filters = {
    search: "",
    factions: new Set(),
    currents: new Set(),
    rarities: new Set(),
    types: new Set(),
    keywords: new Set(),
    costs: new Set(),
    ownership: "all",
  };

  const root = document.createElement("div");
  root.className = "screen collection-screen col-v2";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="col-back">${icon("arrow-left")}<span>Lobby</span></button>
      <h1 class="title">Collection</h1>
      <div class="col-summary muted" id="col-summary">
        <span class="num" id="col-owned">0</span><span> of ${allCards.length} collected</span>
        <span class="col-summary-sep">·</span>
        ${icon("shards")}<span class="num" id="col-shards">0</span><span> shards</span>
      </div>
    </header>

    <div class="collection-body">
      <aside class="filter-rail panel" id="filter-rail">
        <div class="filter-rail-head">
          ${icon("filter", { size: 15 })}
          <span class="t-label">Filters</span>
          <span class="filter-active-count mat-chip chip-static num" id="filter-count" hidden>0</span>
        </div>
        <div class="hb-scrollwrap hb-fade-top" id="filter-rail-wrap">
          <div class="filter-rail-scroll hb-scroll" id="filter-rail-scroll"></div>
        </div>
        <div class="filter-rail-foot" id="filter-rail-foot"></div>
      </aside>

      <div class="filter-scrim" id="filter-scrim" hidden></div>

      <div class="collection-main">
        <div class="collection-toolbar">
          <button class="btn btn-ghost filter-disclose" id="col-filter-open" type="button"
                  aria-expanded="false" aria-controls="filter-rail">
            ${icon("filter", { size: 15 })}<span>Filters</span>
            <span class="filter-active-count mat-chip chip-static num" id="filter-count-compact" hidden>0</span>
          </button>
          <div class="search-field">
            ${icon("search", { size: 17 })}
            <input class="search-input" id="col-search" type="search" autocomplete="off"
                   placeholder="Search cards, text, or flavour…" aria-label="Search collection" />
            <span class="search-count num" id="col-count" aria-live="polite"></span>
            <button class="search-clear" id="col-clear" type="button" hidden>${icon("close", { size: 13, label: "Clear search" })}</button>
          </div>
          <div class="ownership-tabs" id="ownership-tabs" role="tablist" aria-label="Ownership"></div>
        </div>
        <div class="hb-scrollwrap hb-fade-top" id="grid-wrap">
          <div class="card-grid hb-scroll" id="card-grid"></div>
        </div>
      </div>
    </div>

    <div class="card-detail-overlay" id="card-detail" hidden></div>`;

  const grid = root.querySelector<HTMLElement>("#card-grid");
  const gridWrap = root.querySelector<HTMLElement>("#grid-wrap");
  const railScroll = root.querySelector<HTMLElement>("#filter-rail-scroll");
  const railWrap = root.querySelector<HTMLElement>("#filter-rail-wrap");
  const railFoot = root.querySelector<HTMLElement>("#filter-rail-foot");
  const detail = root.querySelector<HTMLElement>("#card-detail");
  const searchInput = root.querySelector<HTMLInputElement>("#col-search");
  const searchClear = root.querySelector<HTMLElement>("#col-clear");
  const searchCount = root.querySelector<HTMLElement>("#col-count");
  const filterCount = root.querySelector<HTMLElement>("#filter-count");
  const filterCountCompact = root.querySelector<HTMLElement>("#filter-count-compact");
  const filterOpen = root.querySelector<HTMLElement>("#col-filter-open");
  const filterScrim = root.querySelector<HTMLElement>("#filter-scrim");
  const ownedOut = root.querySelector<HTMLElement>("#col-owned");
  const shardsOut = root.querySelector<HTMLElement>("#col-shards");

  /**
   * How far past the fold a card is drawn before it is needed.
   *
   * Two rows of lead. It was 320px — one row — on the reasoning that every row
   * not drawn is a quarter of a second of blocked main thread, and that was the
   * right instinct pointed at the wrong control: the cost of a row is paid by
   * *when* it is drawn, not by whether it is queued. The painter now orders its
   * queue by distance from the fold and paints lead at a quarter of the pace it
   * paints content, so the margin can be generous again — which is what stops a
   * wheel scroll landing on a row of empty sleeves.
   */
  const painter = lazyPaint(grid ?? root, "520px 0px");

  /**
   * Nothing is rasterised until the screen has arrived *and been revealed*.
   *
   * Measured on the real navigation, lobby → collection at 1280×720: the
   * curtain sat at full opacity for 2,332ms, of which about 250ms was the
   * atmosphere changing rooms and essentially all of the rest was card
   * rasterisation — because `shell.ts` parts the veil on two consecutive frames
   * that came in under 34ms and the grid never gave it two. A card is about
   * 45ms, so a painter that starts before the reveal guarantees the reveal
   * cannot happen.
   *
   * So the hold covers the whole exchange: the transition's own 260ms, plus the
   * frames the shell needs to see calm, plus the entrance cascade's tail. The
   * sleeves are drawn (see `.card-slot` in the kit), so what the player sees in
   * that window is a rack whose cards are being slid in, arriving on the screen
   * they can already read and click — which is what §3a means by loading being
   * part of the world rather than a cover over it.
   */
  painter.hold(DUR.ui + 160);

  /**
   * And the hold is extended for exactly as long as a veil is up.
   *
   * A fixed duration is a guess about how long the shell will take, and the two
   * numbers are coupled in the worst possible direction: the veil parts on two
   * consecutive frames under 34ms, a card is 45ms, so a painter that wakes up
   * one frame early keeps the veil closed for another whole card — and the
   * measured 110ms reveal timer then lands inside that card and slips again.
   * That is how a 2,332ms blackout is built out of parts none of which is
   * longer than 250ms.
   *
   * Reading `.nav-curtain` from here is deliberate and is the narrowest possible
   * coupling: one class name, read-only, and if the shell ever stops drawing one
   * this degrades to the fixed hold above. The four clear frames afterwards
   * cover the reveal's own 210ms so the first card does not land on top of the
   * panels opening.
   */
  (function holdWhileVeiled(): void {
    if (typeof requestAnimationFrame !== "function") return;
    const deadline = performance.now() + 2600;
    let clear = 0;
    let wasVeiled = false;
    const tick = (): void => {
      if (performance.now() > deadline) return;
      if (document.querySelector(".nav-curtain") !== null) {
        wasVeiled = true;
        painter.hold(220);
        clear = 0;
        requestAnimationFrame(tick);
        return;
      }
      clear += 1;
      /**
       * The cascade is replayed onto the reveal, if there was one.
       *
       * `shell.ts::rewindEntrance` takes the destination's own `nav-*`
       * animations back to frame zero so the curtain opens on a screen arriving
       * rather than a screen that has arrived — and it can only see animations
       * named `nav-*`, which the tile cascade is deliberately not. So the grid's
       * own 34ms diagonal wave, the single change §3a calls "the biggest
       * perceived-quality gap between a hobby menu and a shipped one", ran
       * underneath an opaque veil on every veiled entry and no player has seen
       * it. Re-arming it on the frame the veil clears costs one class toggle per
       * visible tile.
       */
      if (clear === 1 && wasVeiled && motionEnabled()) cascade(shownCells());
      if (clear >= 4) return;
      painter.hold(150);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  // ---- filter rail ---------------------------------------------------------

  /**
   * Six groups, and each one is a *different kind* of control.
   *
   * The rail used to be six stacks of the same lozenge — thirty-eight identical
   * grey pills, which is a wall rather than a set of choices. Now a Current
   * carries its own lit gem, a Cost is a numeric gem the same shape as the one
   * printed on the card, a Rarity carries the rarity silhouette, and the two
   * long lists collapse. The eye can find the row it wants without reading.
   */
  function chipGroup<T extends string | number>(
    title: string,
    values: T[],
    selected: Set<T>,
    label: (value: T) => string,
    options: { color?: (value: T) => string; kind?: string; shut?: boolean; mark?: (value: T) => string } = {}
  ): HTMLElement {
    const group = document.createElement("div");
    group.className = `filter-group${options.shut ? " is-shut" : ""}`;

    const head = document.createElement("button");
    head.type = "button";
    head.className = "filter-head";
    head.innerHTML =
      `<span class="eyebrow">${esc(title)}</span>` +
      `<span class="filter-group-count num" hidden></span>` +
      icon("chevron-down", { size: 13 });
    head.setAttribute("aria-expanded", String(!options.shut));

    const chips = document.createElement("div");
    chips.className = `filter-chips${options.kind ? ` is-${options.kind}` : ""}`;

    const countOut = head.querySelector<HTMLElement>(".filter-group-count");
    const syncCount = (): void => {
      if (!countOut) return;
      countOut.textContent = String(selected.size);
      countOut.hidden = selected.size === 0;
    };

    head.addEventListener("click", () => {
      const shut = group.classList.toggle("is-shut");
      head.setAttribute("aria-expanded", String(!shut));
      audio.play("sfx.ui.hover");
    });

    for (const value of values) {
      const chip = document.createElement("button");
      chip.className = "filter-chip";
      chip.type = "button";
      chip.setAttribute("aria-pressed", "false");
      const mark = options.mark?.(value) ?? (options.color ? `<span class="chip-dot"></span>` : "");
      chip.innerHTML = `${mark}<span>${esc(label(value))}</span>`;
      if (options.color) chip.style.setProperty("--chip-color", options.color(value));
      chip.addEventListener("click", () => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        const on = selected.has(value);
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-pressed", String(on));
        audio.play("sfx.ui.hover");
        syncCount();
        syncFilterCount();
        refilter();
      });
      chips.appendChild(chip);
    }
    group.append(head, chips);
    return group;
  }

  const currentIds = Object.keys(content.currents) as CurrentId[];
  const factionIds = (Object.keys(content.factions) as FactionId[]).filter((id) =>
    allCards.some((c) => c.faction === id)
  );
  const keywordIds = (Object.keys(content.keywords) as KeywordId[]).filter((id) =>
    allCards.some((c) => c.keywords.includes(id))
  );
  const typeIds: CardType[] = ["character", "action", "reaction", "equipment", "location", "transformation", "event"];
  const rarityIds: Rarity[] = ["common", "rare", "epic", "legendary"];
  const costValues = [0, 1, 2, 3, 4, 5, 6, 7];

  railScroll?.append(
    chipGroup("Current", currentIds, filters.currents, (id) => CURRENT_PALETTE[id].label, {
      color: (id) => CURRENT_PALETTE[id].key,
      mark: (id) => icon(CURRENT_SIGIL[id], { size: 12 }),
    }),
    chipGroup("Cost", costValues, filters.costs, (c) => (c === 7 ? "7+" : String(c)), { kind: "cost" }),
    chipGroup("Rarity", rarityIds, filters.rarities, (r) => RARITY_STYLE[r].label, {
      color: (r) => RARITY_STYLE[r].color,
      mark: (r) => rarityTag(r),
    }),
    chipGroup("Type", typeIds, filters.types, (t) => t.charAt(0).toUpperCase() + t.slice(1)),
    chipGroup("Faction", factionIds, filters.factions, (id) => content.factions[id]?.name ?? id, {
      color: (id) => FACTION_COLOR[id] ?? "#888",
      shut: true,
    }),
    chipGroup("Keyword", keywordIds, filters.keywords, (k) => content.keywords[k]?.name ?? k, { shut: true })
  );

  function activeFilterCount(): number {
    return (
      filters.currents.size +
      filters.factions.size +
      filters.rarities.size +
      filters.types.size +
      filters.keywords.size +
      filters.costs.size +
      (filters.ownership === "all" ? 0 : 1) +
      (filters.search ? 1 : 0)
    );
  }

  function syncFilterCount(): void {
    const count = activeFilterCount();
    for (const out of [filterCount, filterCountCompact]) {
      if (!out) continue;
      out.textContent = String(count);
      out.hidden = count === 0;
    }
  }

  /**
   * Below the breakpoint the rail is a sheet, and it is the *same* rail.
   *
   * Measured at 844×390 the whole filter system — six groups, fifty-four chips —
   * was `display: none` with no replacement control, so the only way to narrow a
   * 245-card collection on a phone in landscape was the search box. §9 makes
   * "every screen still has to work on a phone in landscape" a hard constraint
   * that overrides aesthetics, and a screen missing its primary control is not
   * the screen working.
   *
   * Nothing is rebuilt: the rail is the element it always was, moved off-canvas
   * by a transform at narrow widths and slid back on. A second, compact
   * implementation of fifty-four chips is two implementations to keep in step,
   * and the one nobody looks at is the one that rots.
   */
  let railOpen = false;
  function setRail(open: boolean): void {
    railOpen = open;
    root.classList.toggle("rail-open", open);
    filterOpen?.setAttribute("aria-expanded", String(open));
    if (filterScrim) filterScrim.hidden = !open;
    if (open) railScroll?.querySelector<HTMLElement>(".filter-head")?.focus({ preventScroll: true });
    else if (railOpen === false) filterOpen?.focus({ preventScroll: true });
  }
  filterOpen?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    setRail(!railOpen);
  });
  filterScrim?.addEventListener("click", () => setRail(false));

  /**
   * Clear lives in a rail footer that does not scroll.
   *
   * It used to be the last child of the scrolling rail, 324px below the fold on
   * a 900px window: the control for undoing a mistake was only reachable by
   * scrolling past every filter you had set.
   */
  function clearFilters(): void {
    filters.search = "";
    filters.factions.clear();
    filters.currents.clear();
    filters.rarities.clear();
    filters.types.clear();
    filters.keywords.clear();
    filters.costs.clear();
    filters.ownership = "all";
    if (searchInput) searchInput.value = "";
    for (const chip of railScroll?.querySelectorAll(".filter-chip.active") ?? []) {
      chip.classList.remove("active");
      chip.setAttribute("aria-pressed", "false");
    }
    for (const count of railScroll?.querySelectorAll<HTMLElement>(".filter-group-count") ?? []) {
      count.textContent = "0";
      count.hidden = true;
    }
    syncFilterCount();
    renderOwnershipTabs();
    refilter();
  }

  /**
   * Every filter change gets the same beat of quiet the search box gets.
   *
   * Measured: one click on a Current chip produced a **688ms** long task and
   * six frames in a second. The reconcile is not what costs that — it is the
   * fifty tiles the new result brings up into the viewport, each of them a 45ms
   * rasterisation, all queued on the same frame as the reflow. The search box
   * already held the painter for exactly this reason and the chips did not, so
   * the two halves of the same filter behaved completely differently. Two
   * hundred milliseconds is long enough for the FLIP to finish moving the
   * survivors before anything competes with it, and short enough that a player
   * who clicks a chip and stops sees the new cards land immediately after.
   */
  function refilter(): void {
    painter.hold(DUR.ui + 60);
    render();
  }

  const clearButton = document.createElement("button");
  clearButton.className = "btn btn-ghost";
  clearButton.type = "button";
  clearButton.innerHTML = `${icon("refresh", { size: 14 })}<span>Clear filters</span>`;
  clearButton.addEventListener("click", () => {
    audio.play("sfx.ui.back");
    clearFilters();
  });
  railFoot?.appendChild(clearButton);

  // ---- ownership tabs ------------------------------------------------------

  const ownershipHost = root.querySelector<HTMLElement>("#ownership-tabs");
  function renderOwnershipTabs(): void {
    if (!ownershipHost) return;
    const options: { value: Filters["ownership"]; label: string; glyph: Parameters<typeof icon>[0] }[] = [
      { value: "all", label: "All", glyph: "collection" },
      { value: "owned", label: "Owned", glyph: "check" },
      { value: "missing", label: "Missing", glyph: "missing" },
      { value: "favorites", label: "Favourites", glyph: "star-filled" },
    ];
    ownershipHost.innerHTML = "";
    for (const option of options) {
      const tab = document.createElement("button");
      tab.className = `ownership-tab ${filters.ownership === option.value ? "active" : ""}`;
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(filters.ownership === option.value));
      tab.innerHTML = `${icon(option.glyph, { size: 14 })}<span>${option.label}</span>`;
      tab.addEventListener("click", () => {
        filters.ownership = option.value;
        audio.play("sfx.ui.click");
        renderOwnershipTabs();
        syncFilterCount();
        refilter();
      });
      ownershipHost.appendChild(tab);
    }
  }
  renderOwnershipTabs();

  /**
   * One pass per word, not one per letter.
   *
   * The filter pass is cheap now, but it is not free: it touches 245 cells and
   * the browser then re-lays whichever shelves changed. At a typing speed of
   * eight characters a second that is eight re-layouts for one query, and the
   * eighth is the only one anybody wanted. A micro-beat of coalescing is under
   * the threshold at which a search box feels laggy and removes seven of them.
   */
  const runFilter = debounce(DUR.micro, () => render());

  searchInput?.addEventListener("input", (event) => {
    filters.search = (event.target as HTMLInputElement).value.trim().toLowerCase();
    if (searchClear) searchClear.hidden = filters.search.length === 0;
    syncFilterCount();
    // nothing is rasterised while the query is still moving; see `hold`
    painter.hold(200);
    runFilter();
  });

  searchClear?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    filters.search = "";
    searchClear.hidden = true;
    searchInput?.focus();
    syncFilterCount();
    refilter();
  });

  // ---- grid ----------------------------------------------------------------

  /** A snapshot of the account, taken once per pass rather than once per card. */
  interface Account {
    collection: Record<string, number>;
    favorites: string[];
    locked: string[];
  }

  function matches(card: CardDef, account: Account): boolean {
    const owned = account.collection[card.id] ?? 0;

    if (filters.search) {
      const haystack = `${card.name} ${card.text} ${card.flavor ?? ""} ${card.tags.join(" ")}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    if (filters.currents.size > 0 && !filters.currents.has(card.current)) return false;
    if (filters.factions.size > 0 && !filters.factions.has(card.faction)) return false;
    if (filters.rarities.size > 0 && !filters.rarities.has(card.rarity)) return false;
    if (filters.types.size > 0 && !filters.types.has(card.type)) return false;
    if (filters.keywords.size > 0 && !card.keywords.some((k) => filters.keywords.has(k))) return false;
    if (filters.costs.size > 0 && !filters.costs.has(bucketOf(card.cost))) return false;
    if (filters.ownership === "owned" && owned <= 0) return false;
    if (filters.ownership === "missing" && owned > 0) return false;
    if (filters.ownership === "favorites" && !account.favorites.includes(card.id)) return false;
    return true;
  }

  const account = (): Account => {
    const profile = getProfile();
    return { collection: profile.collection, favorites: profile.favorites, locked: profile.locked };
  };

  interface Cell {
    card: CardDef;
    root: HTMLElement;
    slot: HTMLElement;
    canvas: HTMLCanvasElement | null;
    count: HTMLElement;
    fav: HTMLElement;
    lock: HTMLElement;
    shown: boolean;
  }
  const cells = new Map<string, Cell>();

  /** One shelf per cost bucket: header, count, and the plane the cards stand on. */
  interface Shelf {
    root: HTMLElement;
    grid: HTMLElement;
    count: HTMLElement;
    cards: CardDef[];
  }
  const shelves = new Map<number, Shelf>();

  function buildShelf(bucket: number, cards: CardDef[]): Shelf {
    const section = document.createElement("section");
    section.className = "col-shelf";
    section.dataset["bucket"] = String(bucket);

    const head = document.createElement("div");
    head.className = "col-shelf-head";
    head.innerHTML =
      `<span class="col-shelf-gem num">${bucketLabel(bucket)}</span>` +
      `<span class="col-shelf-title t-label">${bucket === 7 ? "Seven or more" : "Hype"}</span>` +
      `<span class="col-shelf-rule" aria-hidden="true"></span>` +
      `<span class="col-shelf-count num"></span>`;

    const shelfGrid = document.createElement("div");
    shelfGrid.className = "col-shelf-grid";

    section.append(head, shelfGrid);
    return { root: section, grid: shelfGrid, count: head.querySelector<HTMLElement>(".col-shelf-count")!, cards };
  }

  /**
   * The shelves are built once, in cost order, from the whole collection.
   *
   * Building them lazily as cards first matched a filter meant re-deriving the
   * order every pass and inserting sections in the middle of a live scroller.
   * The buckets are a property of the collection, not of the query.
   */
  for (const bucket of BUCKETS) {
    const cards = allCards.filter((card) => bucketOf(card.cost) === bucket);
    if (cards.length === 0) continue;
    const shelf = buildShelf(bucket, cards);
    shelves.set(bucket, shelf);
    grid?.appendChild(shelf.root);
  }

  /**
   * What a screen reader is told a tile is, since a canvas tells it nothing.
   *
   * The card face is a bitmap: the name, the cost, the stats and the rarity are
   * all pixels, so without this the accessibility tree holds two hundred and
   * forty-five identical unlabelled buttons.
   */
  function cellLabel(card: CardDef): string {
    const stats = card as { attack?: number; health?: number };
    const numbers =
      typeof stats.attack === "number" && typeof stats.health === "number"
        ? `, ${stats.attack} attack, ${stats.health} health`
        : typeof stats.health === "number"
          ? `, ${stats.health} health`
          : "";
    return `${card.name}. ${RARITY_STYLE[card.rarity].label.toLowerCase()} ${card.type}, ${CURRENT_PALETTE[card.current].label}, cost ${card.cost}${numbers}`;
  }

  const ARROW_STEP: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -Infinity,
    ArrowDown: Infinity,
  };

  let roving: HTMLElement | null = null;

  function setRoving(next: HTMLElement | null): void {
    if (roving === next) return;
    if (roving) roving.tabIndex = -1;
    roving = next;
    if (roving) roving.tabIndex = 0;
  }

  function shownCells(): HTMLElement[] {
    if (!grid) return [];
    return [...grid.querySelectorAll<HTMLElement>(".card-cell")];
  }

  function gridColumns(): number {
    const first = grid?.querySelector<HTMLElement>(".col-shelf:not([hidden]) .col-shelf-grid");
    if (!first || typeof getComputedStyle !== "function") return 7;
    const template = getComputedStyle(first).gridTemplateColumns;
    const count = template.split(" ").filter((part) => part.trim().length > 0).length;
    return count > 0 ? count : 7;
  }

  function walk(from: HTMLElement, step: number): void {
    const list = shownCells();
    const at = list.indexOf(from);
    if (at < 0) return;
    const delta = Number.isFinite(step) ? step : Math.sign(step) * gridColumns();
    const target = list[Math.max(0, Math.min(list.length - 1, at + delta))];
    if (!target || target === from) return;
    setRoving(target);
    target.focus();
    target.scrollIntoView({ block: "nearest", behavior: motionEnabled() ? "smooth" : "auto" });
  }

  function buildCell(card: CardDef): Cell {
    /**
     * A `div` with a role rather than a `button`, and the reason is the canvas.
     *
     * A tile is a card bitmap with three absolutely-positioned overlays on it; a
     * real `<button>` brings a UA stylesheet, a baseline, a default `overflow`
     * and inline-block semantics that all have to be fought back before the
     * layout works. The accessibility contract is identical either way — a role,
     * a tab stop, a label and the two keys that activate it.
     */
    const cell = document.createElement("div");
    cell.className = "card-cell";
    cell.setAttribute("role", "button");
    /**
     * A roving tab stop, not two hundred and forty-five of them. The grid is one
     * stop and the arrow keys walk it, which is what the ARIA grid pattern says.
     */
    cell.tabIndex = -1;
    cell.setAttribute("aria-label", cellLabel(card));

    /**
     * The tile reserves its own box before it has a bitmap.
     *
     * Without a placeholder at the card's aspect ratio, painting a canvas later
     * changes the cell's height and re-flows the whole shelf under the player's
     * cursor. The slot is the exact 512:680 the renderer produces, so the canvas
     * lands in a hole of precisely its own size.
     */
    const slot = document.createElement("div");
    slot.className = "card-slot";
    /**
     * The sleeve is the card's own sleeve, not a grey rectangle.
     *
     * Two attributes and no elements: the Current's key colour, so a shelf of
     * unpainted tiles already has the value and hue structure the painted grid
     * will have, and the Hype cost, drawn by the stylesheet as the same gem the
     * card and the shelf header carry. Measured before this, a wheel scroll
     * showed 4 of 25 tiles painted at +200ms and the other twenty-one as
     * identical holes; the information a player is actually scanning for at that
     * moment — what it costs and what Current it is — is two numbers that need
     * no rasterisation at all.
     */
    slot.dataset["cost"] = String(card.cost);
    cell.style.setProperty("--tile-key", CURRENT_PALETTE[card.current].key);
    cell.appendChild(slot);

    const count = document.createElement("div");
    count.className = "card-count mat-chip chip-static t-label";
    cell.appendChild(count);

    /**
     * The padlock and the star exist as boxes but not as drawings until they are
     * needed.
     *
     * Two `icon()` calls per cell is 490 inline SVG parses through `innerHTML`
     * during the mount pass, for two marks that between them appear on a handful
     * of cards. Measured, that pass was a 482ms long task; deferring the artwork
     * to the first card that is actually locked or starred takes it out of the
     * mount entirely and costs nothing afterwards, because a cell that has drawn
     * its star keeps it.
     */
    const lock = document.createElement("div");
    lock.className = "card-lock";
    lock.hidden = true;
    cell.appendChild(lock);

    const fav = document.createElement("div");
    fav.className = "card-fav";
    fav.hidden = true;
    cell.appendChild(fav);

    // built detached; `render` attaches it in reading order on the same pass
    const entry: Cell = { card, root: cell, slot, canvas: null, count, fav, lock, shown: false };

    const open = (): void => {
      audio.play("sfx.ui.click");
      // the canvas, not the cell: the cell reserves room under the card for the
      // count pill, and a FLIP measured against that lands the detail card low
      openDetail(card, entry.canvas ?? cell, cell);
    };

    /**
     * The hover lights the *card*, not just the wrapper. §5 wants move, light
     * and scale together inside 120ms; the CSS does move and scale, and this
     * does light — the rim highlight is on the bitmap, and no amount of
     * `drop-shadow` on a wrapper is a rim highlight.
     */
    cell.addEventListener("pointerenter", () => {
      if (entry.canvas) hoverCard(entry.canvas, true);
      audio.play("sfx.ui.hover");
    });
    cell.addEventListener("pointerleave", () => {
      if (entry.canvas) hoverCard(entry.canvas, false);
    });
    cell.addEventListener("focus", () => {
      if (entry.canvas) hoverCard(entry.canvas, true);
      setRoving(cell);
    });
    cell.addEventListener("blur", () => {
      if (entry.canvas) hoverCard(entry.canvas, false);
    });
    cell.addEventListener("click", open);
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        // Space scrolls a grid by default, which is the last thing a player
        // pressing it on a focused tile means by it
        event.preventDefault();
        open();
        return;
      }
      const step = ARROW_STEP[event.key];
      if (step === undefined) return;
      event.preventDefault();
      walk(cell, step);
    });

    painter.watch(cell, () => paint(entry));

    return entry;
  }

  /**
   * The shelf track, measured once and then remembered.
   *
   * Reading `clientWidth` is a synchronous layout flush, and the painter calls
   * this from a loop that has just inserted a canvas — so measuring per tile
   * made every single card re-lay the whole eight-thousand-pixel grid before it
   * could be drawn. Measured, that alone put 500–900ms back onto a mount this
   * work exists to shorten. Every tile on a shelf is the same width by
   * construction; the only thing that changes it is a resize, and `retile`
   * already knows when one of those has happened.
   */
  let trackWidth = 0;

  /** Draw the card at whatever width the shelf has actually given the tile. */
  function paint(entry: Cell): void {
    if (entry.canvas) return;
    if (trackWidth === 0) trackWidth = tileWidth(entry.root, 168);
    const __t0 = performance.now();
    const canvas = renderCardToCanvas(entry.card, trackWidth, {});
    const __w = window as unknown as { __cardMs?: number[] };
    (__w.__cardMs ??= []).push(Math.round(performance.now() - __t0));
    entry.canvas = canvas;
    entry.slot.replaceWith(canvas);
  }

  /**
   * A resize past a breakpoint is a new tile size, and a stale bitmap is soft.
   *
   * Every painted card is thrown away and re-queued rather than redrawn on the
   * spot: only the ones the player can actually see are worth rasterising again,
   * and the lazy painter already knows which those are.
   */
  function retile(): void {
    trackWidth = 0;
    for (const entry of cells.values()) {
      if (!entry.canvas) continue;
      entry.canvas.replaceWith(entry.slot);
      entry.canvas = null;
      painter.watch(entry.root, () => paint(entry));
    }
  }

  /**
   * The entrance cascade, as a diagonal wave rather than a queue.
   *
   * `stagger`'s even division across 245 tiles produced delays of 0, 1, 2, 3, 5
   * … milliseconds — one pop, not a cascade, and §3a names the 30–60ms cascade
   * as the single biggest perceived-quality gap between a hobby menu and a
   * shipped one. `(row + column) × step` completes in `(rows + columns) × step`
   * however many tiles there are, and it travels out of the top-left, which is
   * where the key light is: the grid arrives lit-corner-first.
   */
  const CASCADE_STEP = 34;
  const CASCADE_MAX = 420;
  /**
   * How many tiles are allowed to run the entrance at all.
   *
   * Measured: giving all 245 the keyframe produced 245 concurrent CSS
   * animations on mount and a 506ms long task, for a cascade whose last two
   * hundred elements were eight screens below the fold and had finished before
   * anybody scrolled to them. Seventy-two is four rows of the widest layout plus
   * a row of margin — everything a player can see while the wave is playing.
   */
  const CASCADE_LIMIT = 72;
  let entering: HTMLElement[] = [];
  let enteringTimer = 0;

  function cascade(arriving: HTMLElement[]): void {
    for (const node of entering) node.classList.remove("is-entering");
    entering = [];
    window.clearTimeout(enteringTimer);

    if (!motionEnabled()) {
      stagger(arriving, { step: 0, max: 0 });
      return;
    }
    const columns = gridColumns();
    for (const [index, node] of arriving.entries()) {
      if (index >= CASCADE_LIMIT) break;
      const wave = Math.floor(index / columns) + (index % columns);
      node.style.setProperty("--enter-delay", `${Math.min(CASCADE_MAX, wave * CASCADE_STEP)}ms`);
      node.classList.add("is-entering");
      entering.push(node);
    }
    // one timer for the whole wave rather than one per tile; the class has to go
    // or a returning cell inherits an animation that has already played
    enteringTimer = window.setTimeout(() => {
      for (const node of entering) node.classList.remove("is-entering");
      entering = [];
    }, CASCADE_MAX + 420);
  }

  let empty: HTMLElement | null = null;

  /**
   * Reconcile each shelf against the filter, keyed by card.
   *
   * Cells are built once and kept in `cells` forever — that is what makes a
   * keystroke cheap, because a filter changes which cards are *shown*, never
   * what any of them looks like. What changes is which of them are in the
   * document: a filtered-out card is detached rather than given `hidden`, so
   * `document.querySelectorAll('.card-cell')` answers the question everything
   * else in the codebase asks it — how many cards are on screen — and a card
   * nobody can see is not in the accessibility tree, the hit-test tree or the
   * layout. The cell, its listeners and its bitmap survive the round trip, so
   * coming back costs one `insertBefore`.
   */
  /** Draw a corner mark the first time it is actually wanted, then keep it. */
  function badge(host: HTMLElement, on: boolean, glyph: Parameters<typeof icon>[0], label: string): void {
    if (on && host.childElementCount === 0) host.innerHTML = icon(glyph, { label });
    if (host.hidden !== !on) host.hidden = !on;
  }

  /**
   * The survivors of a filter slide to their new places (§3a).
   *
   * "Filtering re-flows with a transition rather than a jump" is one of the
   * named requirements, and every card that stayed on screen used to teleport:
   * clear one Current chip and forty cards appear instantly two columns to the
   * left, which reads as a page reload rather than a rack being re-sorted.
   *
   * This is a FLIP and it is deliberately cheap. Two batched reads — one before
   * the reconcile, one after, each a single layout flush because nothing is
   * written in between — then an inverse `transform` on the tiles that actually
   * moved, released on the next frame. Only tiles the player can see are
   * animated, and no more than a screenful of those, so a filter that reshuffles
   * two hundred cards costs the same as one that reshuffles twenty.
   */
  const FLIP_MAX = 64;
  type Spot = { cell: Cell; left: number; top: number; width: number; height: number };

  /**
   * Only the painted tiles are measured, and that is the whole optimisation.
   *
   * A tile has a bitmap because it came within a screen and a bit of the fold at
   * some point; a tile that has never been painted is, by construction, one
   * nobody has looked at. Measuring all 245 put a 91ms layout flush inside the
   * keystroke handler — the layout was going to happen anyway, but doing it
   * synchronously in the input event is what turns it into a long task. Twenty
   * to sixty rects is the same information for the tiles the animation can
   * actually reach.
   */
  function measureShown(): Spot[] {
    const spots: Spot[] = [];
    for (const cell of cells.values()) {
      if (!cell.shown || !cell.canvas) continue;
      const box = cell.root.getBoundingClientRect();
      spots.push({ cell, left: box.left, top: box.top, width: box.width, height: box.height });
    }
    return spots;
  }

  /**
   * The cards a filter removes leave, rather than being deleted.
   *
   * §3a: "everything that appears has an entrance; everything that leaves has an
   * exit." The survivors already FLIP to their new places, which made the
   * asymmetry worse rather than better — a hundred and eighty tiles blinked out
   * of existence on the same frame that the remaining sixty slid smoothly
   * across, so the one motion the eye could follow was the one that was not
   * telling it anything.
   *
   * The leaving tile is moved out of the shelf immediately, so the reflow behind
   * it is exactly the reflow it would have had, and re-parented into a layer
   * pinned over the scroller at the box it was last measured in. It then falls
   * away on `--ease-leave`. Only tiles on screen leave visibly, and only a
   * screenful of those: clearing a filter that hides two hundred cards costs the
   * same as one that hides twenty, and the hundred and eighty below the fold are
   * simply gone, which is what they were anyway.
   */
  const LEAVE_MAX = 28;
  let leaveLayer: HTMLElement | null = null;
  const leaving = new Map<HTMLElement, number>();

  function layer(): HTMLElement | null {
    if (!gridWrap) return null;
    if (!leaveLayer) {
      leaveLayer = document.createElement("div");
      leaveLayer.className = "col-leave-layer";
      leaveLayer.setAttribute("aria-hidden", "true");
      gridWrap.appendChild(leaveLayer);
    }
    return leaveLayer;
  }

  /** Take a tile out of a leave in progress, whichever way it ended. */
  function land(node: HTMLElement): void {
    const timer = leaving.get(node);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    leaving.delete(node);
    node.classList.remove("is-leaving");
    node.style.position = "";
    node.style.left = "";
    node.style.top = "";
    node.style.width = "";
    node.style.height = "";
    node.remove();
  }

  function depart(cell: Cell, spot: Spot | undefined, frame: DOMRect | null): void {
    const node = cell.root;
    node.remove();
    if (!spot || !frame || !motionEnabled() || leaving.size >= LEAVE_MAX) return;
    // above or below the scroller: there is nobody to show the exit to
    if (spot.top + spot.height < frame.top - 40 || spot.top > frame.bottom + 40) return;
    const host = layer();
    if (!host) return;
    node.style.position = "absolute";
    node.style.left = `${Math.round(spot.left - frame.left)}px`;
    node.style.top = `${Math.round(spot.top - frame.top)}px`;
    node.style.width = `${Math.round(spot.width)}px`;
    node.style.height = `${Math.round(spot.height)}px`;
    node.classList.add("is-leaving");
    host.appendChild(node);
    leaving.set(
      node,
      window.setTimeout(() => land(node), DUR.micro + 120)
    );
  }

  function flip(before: Spot[], arrived: Set<HTMLElement>): void {
    const moved: { node: HTMLElement; dx: number; dy: number }[] = [];
    const height = window.innerHeight;
    for (const spot of before) {
      const node = spot.cell.root;
      if (!spot.cell.shown || !node.isConnected || arrived.has(node)) continue;
      const box = node.getBoundingClientRect();
      // off the bottom or above the top of the window: nobody is watching it move
      if (box.bottom < -80 || box.top > height + 80) continue;
      const dx = spot.left - box.left;
      const dy = spot.top - box.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      moved.push({ node, dx, dy });
      if (moved.length >= FLIP_MAX) break;
    }
    if (moved.length === 0) return;

    for (const { node, dx, dy } of moved) {
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    requestAnimationFrame(() => {
      for (const { node } of moved) {
        node.style.transition = `transform ${DUR.ui}ms ${cssEase(EASE.arrive)}`;
        node.style.transform = "";
      }
      window.setTimeout(() => {
        // the inline transition has to go, or it overrides the hover's own
        for (const { node } of moved) node.style.transition = "";
      }, DUR.ui + 40);
    });
  }

  /**
   * How many tiles a single reconcile may *construct*, and why there is a limit
   * at all now.
   *
   * A cell is six elements, a canvas placeholder and five listeners, and 245 of
   * them is 1,529 nodes handed to the browser in one insertion. The script is
   * not the expensive half — building all of them measures about 90ms — but the
   * style, layout and paint of the tree that follows is, and it lands inside the
   * navigation: measured at 1600×900, warm, `lobby → collection` produced eight
   * long tasks totalling ~860ms and drew **27** animation frames in the second
   * and a half after the click, against 118 for Play and 113 for Missions.
   *
   * Only about twenty-one tiles are ever on screen. The painter has known that
   * for a while — it is why a card's *bitmap* is drawn near the fold and never
   * before — but the cell itself was still built for every card in the game
   * before the screen was allowed to exist. Sixty covers the fold plus a row of
   * lead at every supported viewport, including 844×390, and the rest arrive in
   * idle chunks behind the entrance, into shelves whose counts are already
   * right because the count comes from the card list rather than from how many
   * cells happen to exist.
   *
   * The ordering survives the chunking for free: passes go through the shelves
   * in card order, a cell that is not built yet still advances the position it
   * would have occupied, and `shelf.grid.children[at]` then answers `undefined`
   * — which is the append path. A later pass inserts the missing tile before
   * whichever cell now holds its index. Nothing has to remember where it got to.
   */
  const CELLS_PER_PASS = 60;
  let fillHandle = 0;
  let filling = false;

  /**
   * Ask for the rest of the grid when the page has nothing better to do.
   *
   * An idle callback rather than a frame, and that is the point: while the
   * transition is still running there *is* something better to do, so the queue
   * waits — which is exactly the pacing `lazyPaint` already uses for the
   * bitmaps, applied one level up to the cells that hold them. The timeout is
   * the promise that a page which never goes idle still fills, and the rAF
   * fallback is for engines without the callback at all.
   */
  function scheduleFill(): void {
    if (fillHandle !== 0) return;
    const run = (): void => {
      fillHandle = 0;
      filling = true;
      try {
        render();
      } finally {
        filling = false;
      }
    };
    const idle = (
      globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }
    ).requestIdleCallback;
    fillHandle =
      typeof idle === "function"
        ? idle(run, { timeout: 260 })
        : typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(run)
          : window.setTimeout(run, 32);
  }

  function render(): void {
    if (!grid) return;
    const acct = account();
    const arriving: HTMLElement[] = [];
    const tail: HTMLElement[] = [];
    let visible = 0;
    let budget = CELLS_PER_PASS;
    let starved = false;
    /**
     * A fill pass is not a filter change, so it does not FLIP. `measureShown`
     * is a layout flush over every painted tile and the tiles it would be
     * measuring have not moved — the pass only *adds* cells further down the
     * same shelves.
     */
    const before = motionEnabled() && !filling ? measureShown() : null;
    // one read for the whole pass; the leavers are positioned against it
    const frame = before && gridWrap ? gridWrap.getBoundingClientRect() : null;
    const spots = new Map<Cell, Spot>();
    for (const spot of before ?? []) spots.set(spot.cell, spot);

    for (const shelf of shelves.values()) {
      let at = 0;
      for (const card of shelf.cards) {
        const show = matches(card, acct);
        let cell = cells.get(card.id);

        if (!show) {
          if (cell?.shown === true) {
            depart(cell, spots.get(cell), frame);
            cell.shown = false;
          }
          continue;
        }

        visible += 1;
        if (!cell) {
          if (budget <= 0) {
            // Its place is held all the same: `at` is the card's position on the
            // shelf, not the cell's index in the DOM, so the next pass inserts
            // this tile where it belongs rather than on the end.
            starved = true;
            at += 1;
            continue;
          }
          budget -= 1;
          cell = buildCell(card);
          cells.set(card.id, cell);
        }
        // a tile that came back while it was still falling away belongs to the
        // grid again, at full opacity, in flow
        land(cell.root);

        const owned = acct.collection[card.id] ?? 0;
        const maxCopies =
          card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;
        cell.root.classList.toggle("unowned", owned <= 0);
        /**
         * The badge only shouts when it has something to say.
         *
         * Every tile carrying `2/2` in the same grey pill is two hundred and
         * forty-five identical marks, which is the wall-of-chips problem in
         * miniature: the eye has to read all of them to find the one that
         * differs. A complete set is the resting state and gets the quietest
         * possible mark; a part-set is the thing you would act on and gets the
         * gold; nothing owned gets the word. §6 — saturation is a resource, and
         * it is spent on the tile that wants attention.
         */
        const atMax = owned >= maxCopies;
        const text = owned > 0 ? (atMax ? `×${owned}` : `${owned}/${maxCopies}`) : "Missing";
        if (cell.count.textContent !== text) {
          cell.count.textContent = text;
          cell.count.classList.toggle("is-max", atMax);
          cell.count.classList.toggle("is-partial", owned > 0 && !atMax);
          // the canvas is a bitmap, so the only place a screen reader can learn
          // what the badge says is the tile's own name
          cell.root.setAttribute(
            "aria-label",
            `${cellLabel(card)}. ${owned > 0 ? `${owned} of ${maxCopies} owned` : "not owned"}`
          );
        }
        badge(cell.fav, acct.favorites.includes(card.id), "star-filled", "Favourite");
        badge(cell.lock, acct.locked.includes(card.id), "lock", "Locked");

        // reading order is DOM order, so a returning cell goes back where it
        // belongs rather than on the end
        const here = shelf.grid.children[at];
        if (here !== cell.root) {
          if (here === undefined) tail.push(cell.root);
          else shelf.grid.insertBefore(cell.root, here);
        }
        if (!cell.shown) {
          arriving.push(cell.root);
          cell.shown = true;
        }
        at += 1;
      }

      // everything past the current end of the shelf goes in as one insertion
      // rather than 245 of them, which is what the mount actually is
      if (tail.length > 0) {
        shelf.grid.append(...tail);
        tail.length = 0;
      }

      shelf.root.hidden = at === 0;
      shelf.count.textContent = at === 1 ? "1 card" : `${at} cards`;
    }

    /**
     * A fill pass adds tiles below the fold and must not restage the wave: the
     * cascade is what the player watches the grid arrive on, and replaying it
     * every 60 cards would be four entrances for one navigation.
     */
    if (arriving.length > 0 && !filling) cascade(arriving);
    if (before) flip(before, new Set(arriving));
    if (starved) scheduleFill();

    // the grid's single tab stop has to be a tile that is actually on it
    if (!roving || roving.hidden || !roving.isConnected) setRoving(shownCells()[0] ?? null);

    renderEmpty(visible);

    if (searchCount) searchCount.textContent = visible === allCards.length ? "" : `${visible} shown`;

    const ownedTotal = allCards.filter((c) => (acct.collection[c.id] ?? 0) > 0).length;
    if (ownedOut) tickerTo(ownedOut, ownedTotal, DUR.ui);
    if (shardsOut) tickerTo(shardsOut, getProfile().shards, DUR.setpiece);
  }

  /**
   * §5: "Empty states are designed too."
   *
   * Filtering to nothing used to produce a blank 1300×800 rectangle. This names
   * what is in the way — because "no results" without "of what" is the same
   * blank rectangle with a caption — and offers the one control that fixes it.
   */
  function renderEmpty(visible: number): void {
    if (!gridWrap) return;
    if (visible > 0) {
      empty?.remove();
      empty = null;
      return;
    }
    // rebuilt rather than reused: the copy names the filters that are in the
    // way, so a message left over from the previous query is a message that is
    // wrong about the current one
    empty?.remove();
    const named: string[] = [];
    if (filters.search) named.push(`“${filters.search}”`);
    if (filters.ownership !== "all") named.push(filters.ownership === "favorites" ? "favourites" : filters.ownership);
    const chips = activeFilterCount() - named.length;
    if (chips > 0) named.push(`${chips} filter${chips === 1 ? "" : "s"}`);

    empty = emptyState({
      glyph: "collection",
      title: "Nothing in the racks",
      body: named.length
        ? `Nothing matches ${named.join(" and ")}. The shelves are still there — the filter is not.`
        : "There is nothing here to show yet.",
      action: { label: "Clear filters", onClick: clearFilters },
    });
    grid?.appendChild(empty);
  }

  // ---- detail --------------------------------------------------------------

  /**
   * The card detail view.
   *
   * Two panes: the card itself, large and tilted, and a panel that switches
   * between what the card DOES and what it IS. The split exists because those
   * two readings never want each other's room — rules text is scanned, lore is
   * read, and in one column one of them was always in the way.
   */
  type DetailTab = "effect" | "story";
  let detailTab: DetailTab = "effect";

  /**
   * The overlay's keyboard and backdrop handlers are registered **once**.
   *
   * They used to be registered inside `openDetail`, which meant every arrow
   * press added another `keydown` listener and then fired all of them: ten
   * presses produced hundreds of listeners, each calling `step` → `openDetail` →
   * register another, and the card you landed on was unpredictable. Closing by
   * any route left them all attached. The backdrop's own listener carried
   * `{ once: true }`, so the first click *anywhere inside* the overlay consumed
   * it and clicking the backdrop stopped closing the modal for the rest of the
   * session. One registration, module-scoped state, removed on dispose.
   */
  let openCard: CardDef | null = null;
  let siblings: CardDef[] = [];
  let openIndex = 0;
  let returnFocus: HTMLElement | null = null;
  let closing = 0;

  function closeDetail(): void {
    if (!detail || detail.hidden) return;
    window.clearTimeout(closing);
    openCard = null;
    const back = returnFocus;
    returnFocus = null;
    const done = (): void => {
      detail.classList.remove("cd-leaving");
      detail.hidden = true;
      detail.innerHTML = "";
      // the tile the player came from takes focus back, so a keyboard user is
      // not dropped at the top of the document
      if (back?.isConnected) back.focus();
    };
    if (!motionEnabled()) {
      done();
      return;
    }
    detail.classList.add("cd-leaving");
    closing = window.setTimeout(done, DUR.ui - 40);
  }

  function step(delta: number): void {
    const next = siblings[openIndex + delta];
    if (!next) return;
    /**
     * `navigate`, not `click`. Stepping through the filtered grid is the one
     * genuinely lateral movement in the interface and the sound was written for
     * it — a short sideways swish rather than a button press.
     */
    audio.play("sfx.ui.navigate");
    openDetail(next);
  }

  const onOverlayKey = (event: KeyboardEvent): void => {
    // the sheet is the shallower layer, so it is the one Escape reaches first
    if (railOpen && (!detail || detail.hidden)) {
      if (event.key !== "Escape") return;
      setRail(false);
      event.preventDefault();
      return;
    }
    if (!detail || detail.hidden || !openCard) return;
    if (event.key === "Escape") closeDetail();
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onOverlayKey);

  detail?.addEventListener("click", (event) => {
    if (event.target === detail) closeDetail();
  });

  /** Which of the player's decks run this card — the vertical slack, filled. */
  function decksWith(cardId: string): string[] {
    return getProfile()
      .decks.filter((deck) => deck.cards.includes(cardId))
      .map((deck) => deck.name);
  }

  function openDetail(card: CardDef, from?: HTMLElement, opener?: HTMLElement): void {
    if (!detail) return;
    const profile = getProfile();
    const owned = profile.collection[card.id] ?? 0;
    const maxCopies =
      card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;
    const palette = CURRENT_PALETTE[card.current];
    const craftCost = content.balance.economy.craftCost[card.rarity];
    const dustValue = content.balance.economy.dustValue[card.rarity];
    const lore = loreFor(card);

    /** The cards currently on screen, so the arrows walk the list you filtered. */
    const acct = account();
    siblings = allCards.filter((entry) => matches(entry, acct));
    openIndex = siblings.findIndex((entry) => entry.id === card.id);
    openCard = card;
    if (opener) returnFocus = opener;

    window.clearTimeout(closing);
    detail.classList.remove("cd-leaving");
    detail.hidden = false;
    detail.innerHTML = "";
    detail.style.setProperty("--detail-key", palette.key);
    // the light the card sits in is its own Current, at an alpha CSS cannot
    // reach from a hex on its own without color-mix
    detail.style.setProperty("--detail-glow", hexToRgba(palette.key, 0.45));

    const stage = document.createElement("div");
    stage.className = "cd-stage";

    // -- heading -------------------------------------------------------------
    const leaderTitle = (card as { title?: string }).title;
    const subtitle =
      typeof leaderTitle === "string" && leaderTitle
        ? leaderTitle
        : `${palette.label} · ${content.factions[card.faction]?.name ?? ""}`;

    const head = document.createElement("header");
    head.className = "cd-head";
    head.innerHTML =
      `<h2 class="cd-name">${esc(card.name)}</h2>` +
      `<span class="cd-subtitle">/ ${esc(subtitle)}</span>` +
      (openIndex >= 0
        ? `<span class="cd-position mat-chip chip-static num">${openIndex + 1} of ${siblings.length}</span>`
        : "");

    const closeBtn = document.createElement("button");
    closeBtn.className = "cd-close";
    closeBtn.type = "button";
    closeBtn.innerHTML = icon("close", { label: "Close" });
    closeBtn.addEventListener("click", () => closeDetail());
    head.appendChild(closeBtn);

    // -- the card, tilted ----------------------------------------------------
    const artWrap = document.createElement("div");
    artWrap.className = "cd-art";

    const tilt = document.createElement("div");
    tilt.className = "cd-tilt";
    /**
     * The hero card is rasterised to the room it has, not to a constant.
     *
     * 420 was a constant, and the stylesheet's `max-height: 62vh` was the only
     * thing stopping it running off the bottom — a cap that squashes rather than
     * scales, because the renderer writes an inline width the cap cannot reach.
     * Measured at 844×390 the card was drawn 380px wide and 200px tall: a 3:4
     * object presented at 1.9:1, with its own art stretched. Deriving the width
     * from the height available keeps the aspect exact at every size and, on the
     * small screens, makes the biggest single rasterisation in the domain
     * cheaper at the same time.
     */
    const room = Math.max(200, window.innerHeight - 132);
    const heroWidth = Math.round(Math.min(420, room * (512 / 680), window.innerWidth * 0.42));
    const cardCanvas = renderCardToCanvas(card, heroWidth, { premium: card.rarity === "legendary" });
    tilt.appendChild(cardCanvas);
    artWrap.appendChild(tilt);

    /**
     * The tilt follows the pointer and rests at an angle that is deliberately
     * not square-on: a card lying flat reads as a picture of a card, and the
     * whole point of this screen is that it is the object. The same two numbers
     * go to the renderer, so the sheen moves *because* the card turned.
     */
    const REST_Y = 17;
    const REST_X = 9;
    const setTilt = (y: number, x: number): void => {
      tilt.style.transform = `rotateY(${y}deg) rotateX(${x}deg)`;
    };
    setTilt(REST_Y, REST_X);
    artWrap.addEventListener("pointermove", (event) => {
      const box = artWrap.getBoundingClientRect();
      const dx = (event.clientX - box.left) / box.width - 0.5;
      const dy = (event.clientY - box.top) / box.height - 0.5;
      setTilt(REST_Y + dx * 26, REST_X - dy * 18);
      tiltCard(cardCanvas, dx, dy);
    });
    artWrap.addEventListener("pointerleave", () => {
      setTilt(REST_Y, REST_X);
      tiltCard(cardCanvas, 0, 0);
    });

    /**
     * The clicked tile grows into the detail card — §3a's own worked example.
     *
     * A FLIP rather than a clone: the detail card is measured where it has
     * landed, transformed back onto the tile the player pressed, then released.
     * There is never a second card on screen and never a frame in which the
     * object the player is following is not drawn.
     */
    const growFrom = (source: HTMLElement): void => {
      if (!motionEnabled()) return;
      const a = source.getBoundingClientRect();
      const b = tilt.getBoundingClientRect();
      if (b.width < 1 || a.width < 1) return;
      const scale = a.width / b.width;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      tilt.style.transition = "none";
      tilt.style.transform = `translate(${dx}px, ${dy}px) scale(${scale}) rotateY(0deg) rotateX(0deg)`;
      // one frame at the start pose, then let the transition carry it home
      requestAnimationFrame(() => {
        tilt.style.transition = `transform ${DUR.ui + 80}ms ${cssEase(EASE.arrive)}`;
        setTilt(REST_Y, REST_X);
        window.setTimeout(() => {
          tilt.style.transition = "";
        }, DUR.ui + 120);
      });
    };

    for (const [delta, glyph, label] of [
      [-1, "chevron-left", "Previous card"],
      [1, "chevron-right", "Next card"],
    ] as const) {
      const arrow = document.createElement("button");
      arrow.className = `cd-arrow cd-arrow-${delta < 0 ? "prev" : "next"}`;
      arrow.type = "button";
      arrow.innerHTML = icon(glyph, { label });
      arrow.disabled = !siblings[openIndex + delta];
      arrow.addEventListener("click", () => step(delta));
      artWrap.appendChild(arrow);
    }

    // -- the panel -----------------------------------------------------------
    const panel = document.createElement("div");
    panel.className = "cd-panel";

    const tabs = document.createElement("nav");
    tabs.className = "cd-tabs";
    tabs.setAttribute("role", "tablist");

    const body = document.createElement("div");
    body.className = "cd-tab-body hb-scroll";

    /**
     * Keyword reminders go through the same parser the canvas uses. They are
     * authored in the same mini-markup as the card text, and escaping them alone
     * printed the asterisks — the exact defect this screen was called out for.
     */
    const keywordList = card.keywords
      .map((id) => {
        const keyword = content.keywords[id];
        return keyword
          ? `<li><strong>${esc(keyword.name)}</strong> — ${richText(keyword.reminderText)}</li>`
          : "";
      })
      .filter(Boolean)
      .join("");

    const beats = content.currents[card.current]?.beats.map((c) => content.currents[c]?.name ?? c) ?? [];
    const beatenBy = Object.values(content.currents)
      .filter((c) => c.beats.includes(card.current))
      .map((c) => c.name);

    const statRow = (label: string, value: string): string =>
      `<div class="cd-stat"><span>${label}</span><strong>${esc(value)}</strong></div>`;

    /** Only characters carry both; leaders have health and equipment neither. */
    const numeric = (key: "attack" | "health"): number | null => {
      const value = (card as { attack?: number; health?: number })[key];
      return typeof value === "number" ? value : null;
    };

    const stats =
      statRow("Cost", String(card.cost)) +
      (numeric("attack") !== null ? statRow("Attack", String(numeric("attack"))) : "") +
      (numeric("health") !== null ? statRow("Health", String(numeric("health"))) : "") +
      statRow("Current", palette.label) +
      statRow("Rarity", RARITY_STYLE[card.rarity].label) +
      statRow("Type", card.type[0]!.toUpperCase() + card.type.slice(1));

    const inDecks = decksWith(card.id);

    const renderBody = (): void => {
      if (detailTab === "story") {
        body.innerHTML = `
          <h3 class="cd-lore-title">${esc(lore.title)}</h3>
          ${lore.body
            .map((p) => `<p class="cd-lore-body${lore.written ? "" : " cd-lore-empty"}">${esc(p)}</p>`)
            .join("")}
          ${lore.quote ? `<p class="cd-lore-quote">“${esc(lore.quote)}”</p>` : ""}
          ${
            lore.written
              ? ""
              : `<p class="cd-lore-hint muted">Write it in <code>data/cards/lore.txt</code>, under <code>=== ${esc(
                  card.id
                )}</code>.</p>`
          }`;
        return;
      }
      body.innerHTML = `
        <div class="cd-stats">${stats}</div>
        <div class="eyebrow">Effect</div>
        <p class="cd-effect">${card.text ? richText(card.text) : `<span class="muted">No rules text.</span>`}</p>
        ${keywordList ? `<div class="eyebrow">Keywords</div><ul class="cd-keywords">${keywordList}</ul>` : ""}
        <div class="eyebrow">Current interactions</div>
        <p class="muted cd-currents">
          Deals +1 damage to: ${beats.length ? esc(beats.join(", ")) : "nothing (neutral)"}<br />
          Takes +1 damage from: ${beatenBy.length ? esc(beatenBy.join(", ")) : "nothing (neutral)"}
        </p>
        <div class="eyebrow">In your decks</div>
        ${
          inDecks.length
            ? `<div class="cd-decks">${inDecks
                .map((name) => `<span class="cd-deck-chip mat-chip chip-static">${esc(name)}</span>`)
                .join("")}</div>`
            : `<p class="muted">Not in any saved deck.</p>`
        }
        <div class="eyebrow">Collection</div>
        <p class="muted">You own <strong class="num">${owned}</strong> of ${maxCopies}. Craft for ${icon("shards")}<span class="num">${craftCost}</span>, dismantle for ${icon("shards")}<span class="num">${dustValue}</span>.</p>`;
    };

    for (const [id, label] of [
      ["story", "Story"],
      ["effect", "Effect"],
    ] as const) {
      const tab = document.createElement("button");
      tab.className = `cd-tab${detailTab === id ? " active" : ""}`;
      tab.type = "button";
      tab.textContent = label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(detailTab === id));
      tab.addEventListener("click", () => {
        if (detailTab === id) return;
        detailTab = id;
        audio.play("sfx.ui.click");
        for (const other of tabs.querySelectorAll(".cd-tab")) {
          other.classList.remove("active");
          other.setAttribute("aria-selected", "false");
        }
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        renderBody();
      });
      tabs.appendChild(tab);
    }
    renderBody();

    // -- actions -------------------------------------------------------------
    const actions = document.createElement("div");
    actions.className = "cd-actions";

    const craftBtn = document.createElement("button");
    craftBtn.className = "btn btn-primary";
    /**
     * At the copy limit the button says so rather than spending forty shards on
     * a third copy of a two-max common. The badge on the tile already presents
     * `2/2` as a cap; a button that ignores it is a missing disabled state with
     * a real currency cost attached.
     */
    const atLimit = owned >= maxCopies;
    craftBtn.innerHTML = atLimit
      ? `${icon("check")}<span>Maximum copies</span>`
      : `${icon("plus")}<span>Craft</span>${icon("shards")}<span class="num">${craftCost}</span>`;
    craftBtn.disabled = atLimit || profile.shards < craftCost;
    craftBtn.title = atLimit ? `You already own the maximum ${maxCopies}.` : "";
    craftBtn.addEventListener("click", () => {
      if (owned >= maxCopies) return;
      if (craftCard(content, card.id)) {
        audio.play("sfx.ui.click");
        render();
        openDetail(card);
      }
    });

    const dismantleBtn = document.createElement("button");
    dismantleBtn.className = "btn btn-ghost";
    dismantleBtn.innerHTML = `${icon("trash")}<span>Dismantle</span>${icon("shards")}<span class="num">${dustValue}</span>`;
    dismantleBtn.disabled = owned <= 0 || profile.locked.includes(card.id);
    dismantleBtn.addEventListener("click", () => {
      if (dismantleCard(content, card.id)) {
        audio.play("sfx.ui.back");
        render();
        openDetail(card);
      }
    });

    const favBtn = document.createElement("button");
    favBtn.className = "btn btn-ghost";
    const favourited = profile.favorites.includes(card.id);
    favBtn.classList.toggle("is-on", favourited);
    favBtn.innerHTML = `${icon(favourited ? "star-filled" : "star")}<span>${favourited ? "Favourited" : "Favourite"}</span>`;
    favBtn.addEventListener("click", () => {
      toggleFavorite(card.id);
      render();
      openDetail(card);
    });

    const lockBtn = document.createElement("button");
    lockBtn.className = "btn btn-ghost";
    const locked = profile.locked.includes(card.id);
    lockBtn.classList.toggle("is-on", locked);
    lockBtn.innerHTML = `${icon(locked ? "lock" : "unlock")}<span>${locked ? "Locked" : "Lock"}</span>`;
    lockBtn.addEventListener("click", () => {
      toggleLock(card.id);
      render();
      openDetail(card);
    });

    actions.append(craftBtn, dismantleBtn, favBtn, lockBtn);
    panel.append(tabs, body, actions);

    const layout = document.createElement("div");
    layout.className = "cd-body";
    layout.append(artWrap, panel);
    stage.append(head, layout);
    detail.appendChild(stage);
    if (from) growFrom(from);
    // On the first open, focus lands inside the overlay so the next Tab stays
    // in it. Stepping between siblings does not steal it back, because a player
    // holding Right does not want the ring jumping every 200ms.
    if (opener) closeBtn.focus({ preventScroll: true });
  }

  root.querySelector("#col-back")?.addEventListener("click", () => callbacks.onBack());

  syncFilterCount();
  const unsubscribe = profileStore.subscribe(() => render());
  const unbindFades = gridWrap && grid ? bindScrollFades(gridWrap, grid) : () => {};
  /**
   * The rail ends in air too.
   *
   * At 1280×720 the six filter groups are 320px taller than the rail, and the
   * scroller butted straight into the pinned Clear-filters footer: the word
   * "Faction" was sliced through the middle of its own glyphs. §7 asks for an
   * end fade on every edge like this one and the rail was the last one without.
   */
  const unbindRailFades = railWrap && railScroll ? bindScrollFades(railWrap, railScroll) : () => {};
  const unbindRetile = grid
    ? retileOnResize(grid, () => shownCells()[0]?.clientWidth ?? 0, retile)
    : () => {};
  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundCollection?: unknown }).hypeboundCollection = {
    shown: () => shownCells().length,
    open: (id: string) => {
      const card = allCards.find((entry) => entry.id === id);
      if (card) openDetail(card);
      return Boolean(card);
    },
    close: closeDetail,
  };

  return {
    root,
    dispose: () => {
      unsubscribe();
      unbindFades();
      unbindRailFades();
      unbindRetile();
      painter.stop();
      /**
       * The grid may still be filling itself in. Cancelling by handle covers
       * both schedulers, because `requestIdleCallback` and
       * `requestAnimationFrame` hand out ids from the same space as far as this
       * is concerned: whichever one armed it, `filling` is checked again inside
       * `render`, and a pass that runs against a disposed screen would rebuild
       * cells into a detached tree and leak the listeners on them.
       */
      if (fillHandle !== 0) {
        const cancelIdle = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cancelIdle === "function") cancelIdle(fillHandle);
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(fillHandle);
        window.clearTimeout(fillHandle);
        fillHandle = 0;
      }
      window.removeEventListener("keydown", onOverlayKey);
      window.clearTimeout(closing);
      window.clearTimeout(enteringTimer);
      for (const timer of leaving.values()) window.clearTimeout(timer);
      leaving.clear();
      delete (window as unknown as { hypeboundCollection?: unknown }).hypeboundCollection;
    },
  };
}
