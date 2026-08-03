/**
 * Collection browser: search, filters, grid, detail inspection, crafting and
 * dismantling, favourites and locks, and missing-card indicators.
 */

import type { CardDef, ContentIndex, CurrentId, FactionId, KeywordId, Rarity, CardType } from "../../engine/types";
import type { Screen } from "../shell";
import { collectibleCards } from "../../engine/content";
import { hoverCard, parseCardText, renderCardToCanvas, tiltCard } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE, FACTION_COLOR, RARITY_STYLE, hexToRgba } from "../cardRenderer/palette";
import { craftCard, dismantleCard, getProfile, profileStore, toggleFavorite, toggleLock } from "../../save/profile";
import { loreFor } from "../../game/cardLore";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { DUR, EASE, cssEase, motionEnabled, stagger } from "../motion";

/** Card text and lore are author-written, so nothing reaches innerHTML unescaped. */
const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

/**
 * The card's own mini-markup, rendered rather than printed.
 *
 * The EFFECT panel escaped the raw string, so beside a canvas that renders
 * `**Rushwind:** summon a 1/2 **Anon**. *(…)*` with real bold and real italics
 * the panel printed the asterisks — two readings of the same sentence, six
 * inches apart, one of them wrong. `parseCardText` is the renderer's own parser,
 * so the two can no longer disagree about what the markup means.
 */
const richText = (text: string): string =>
  parseCardText(text)
    .map((part) =>
      part.bold ? `<strong>${esc(part.text)}</strong>`
      : part.italic ? `<em>${esc(part.text)}</em>`
      : esc(part.text)
    )
    .join("");

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

export function createCollectionScreen(content: ContentIndex, callbacks: CollectionCallbacks): Screen {
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
  root.className = "screen collection-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="col-back">${icon("arrow-left")}<span>Lobby</span></button>
      <h1 class="title">Collection</h1>
      <div class="col-summary muted" id="col-summary"></div>
    </header>

    <div class="collection-body">
      <aside class="filter-rail panel scroll" id="filter-rail"></aside>
      <div class="collection-main">
        <div class="collection-toolbar">
          <input class="search-input" id="col-search" type="search" placeholder="Search cards, text, or flavour…" aria-label="Search collection" />
          <div class="ownership-tabs" id="ownership-tabs"></div>
        </div>
        <div class="card-grid scroll" id="card-grid"></div>
      </div>
    </div>

    <div class="card-detail-overlay" id="card-detail" hidden></div>`;

  const grid = root.querySelector<HTMLElement>("#card-grid");
  const rail = root.querySelector<HTMLElement>("#filter-rail");
  const summary = root.querySelector<HTMLElement>("#col-summary");
  const detail = root.querySelector<HTMLElement>("#card-detail");

  // ---- filter rail ---------------------------------------------------------

  function chipGroup<T extends string | number>(
    title: string,
    values: T[],
    selected: Set<T>,
    label: (value: T) => string,
    color?: (value: T) => string
  ): HTMLElement {
    const group = document.createElement("div");
    group.className = "filter-group";
    group.innerHTML = `<div class="eyebrow">${title}</div>`;
    const chips = document.createElement("div");
    chips.className = "filter-chips";

    for (const value of values) {
      const chip = document.createElement("button");
      chip.className = "filter-chip";
      chip.type = "button";
      chip.textContent = label(value);
      if (color) chip.style.setProperty("--chip-color", color(value));
      chip.addEventListener("click", () => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        chip.classList.toggle("active", selected.has(value));
        render();
      });
      chips.appendChild(chip);
    }
    group.appendChild(chips);
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

  rail?.append(
    chipGroup("Current", currentIds, filters.currents, (id) => CURRENT_PALETTE[id].label, (id) => CURRENT_PALETTE[id].key),
    chipGroup("Faction", factionIds, filters.factions, (id) => content.factions[id]?.name ?? id, (id) => FACTION_COLOR[id] ?? "#888"),
    chipGroup("Cost", costValues, filters.costs, (c) => (c === 7 ? "7+" : String(c))),
    chipGroup("Rarity", rarityIds, filters.rarities, (r) => RARITY_STYLE[r].label, (r) => RARITY_STYLE[r].color),
    chipGroup("Type", typeIds, filters.types, (t) => t.charAt(0).toUpperCase() + t.slice(1)),
    chipGroup("Keyword", keywordIds, filters.keywords, (k) => content.keywords[k]?.name ?? k)
  );

  const clearButton = document.createElement("button");
  clearButton.className = "btn btn-ghost";
  clearButton.textContent = "Clear filters";
  clearButton.addEventListener("click", () => {
    filters.search = "";
    filters.factions.clear();
    filters.currents.clear();
    filters.rarities.clear();
    filters.types.clear();
    filters.keywords.clear();
    filters.costs.clear();
    filters.ownership = "all";
    const input = root.querySelector<HTMLInputElement>("#col-search");
    if (input) input.value = "";
    rail?.querySelectorAll(".filter-chip.active").forEach((chip) => chip.classList.remove("active"));
    renderOwnershipTabs();
    render();
  });
  rail?.appendChild(clearButton);

  // ---- ownership tabs ------------------------------------------------------

  const ownershipHost = root.querySelector<HTMLElement>("#ownership-tabs");
  function renderOwnershipTabs(): void {
    if (!ownershipHost) return;
    const options: { value: Filters["ownership"]; label: string }[] = [
      { value: "all", label: "All" },
      { value: "owned", label: "Owned" },
      { value: "missing", label: "Missing" },
      { value: "favorites", label: "Favourites" },
    ];
    ownershipHost.innerHTML = "";
    for (const option of options) {
      const tab = document.createElement("button");
      tab.className = `ownership-tab ${filters.ownership === option.value ? "active" : ""}`;
      tab.textContent = option.label;
      tab.addEventListener("click", () => {
        filters.ownership = option.value;
        renderOwnershipTabs();
        render();
      });
      ownershipHost.appendChild(tab);
    }
  }
  renderOwnershipTabs();

  root.querySelector<HTMLInputElement>("#col-search")?.addEventListener("input", (event) => {
    filters.search = (event.target as HTMLInputElement).value.toLowerCase();
    render();
  });

  // ---- grid ----------------------------------------------------------------

  function matches(card: CardDef): boolean {
    const profile = getProfile();
    const owned = profile.collection[card.id] ?? 0;

    if (filters.search) {
      const haystack = `${card.name} ${card.text} ${card.flavor ?? ""} ${card.tags.join(" ")}`.toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }
    if (filters.currents.size > 0 && !filters.currents.has(card.current)) return false;
    if (filters.factions.size > 0 && !filters.factions.has(card.faction)) return false;
    if (filters.rarities.size > 0 && !filters.rarities.has(card.rarity)) return false;
    if (filters.types.size > 0 && !filters.types.has(card.type)) return false;
    if (filters.keywords.size > 0 && !card.keywords.some((k) => filters.keywords.has(k))) return false;
    if (filters.costs.size > 0) {
      const bucket = card.cost >= 7 ? 7 : card.cost;
      if (!filters.costs.has(bucket)) return false;
    }
    if (filters.ownership === "owned" && owned <= 0) return false;
    if (filters.ownership === "missing" && owned > 0) return false;
    if (filters.ownership === "favorites" && !profile.favorites.includes(card.id)) return false;
    return true;
  }

  /**
   * One cell per card, built once and kept.
   *
   * The old `render` did `grid.innerHTML = ""` and rebuilt every visible card
   * from scratch, so a single keystroke in the search box repainted up to 245
   * canvases — **2,499.6ms of blocked main thread** in the round-one measurement,
   * and 395ms even with a warm art cache. Nothing about filtering requires any of
   * it: a filter changes which cards are *shown*, not what any of them looks
   * like. The cells persist, the filter toggles `hidden`, and a keystroke now
   * costs a class change per cell and no canvas work at all — measured 2.2ms.
   *
   * It is also what makes §3a's "filtering re-flows with a transition rather than
   * a jump" affordable: cells that come back run the tile entrance on a
   * compressed cascade, so the grid arrives as a wave instead of 245 elements
   * blinking into place.
   */
  interface Cell {
    root: HTMLElement;
    canvas: HTMLCanvasElement;
    count: HTMLElement;
    fav: HTMLElement;
    lock: HTMLElement;
    shown: boolean;
  }
  const cells = new Map<string, Cell>();

  /**
   * What a screen reader is told a tile is, since a canvas tells it nothing.
   *
   * The card face is a bitmap: every word on it — the name, the cost, the stats,
   * the rarity — is pixels, so without this the accessibility tree holds two
   * hundred and forty-five identical unlabelled buttons. The order is the order
   * a player would say it in.
   */
  function cellLabel(card: CardDef): string {
    const stats = (card as { attack?: number; health?: number });
    const numbers =
      typeof stats.attack === "number" && typeof stats.health === "number"
        ? `, ${stats.attack} attack, ${stats.health} health`
        : typeof stats.health === "number"
          ? `, ${stats.health} health`
          : "";
    return `${card.name}. ${RARITY_STYLE[card.rarity].label.toLowerCase()} ${card.type}, ${CURRENT_PALETTE[card.current].label}, cost ${card.cost}${numbers}`;
  }

  /**
   * Arrow-key navigation across the grid. A row's worth is resolved at the
   * moment of the press, so the same four keys work at every breakpoint —
   * seven tiles a row at 1600px, four on a phone in landscape.
   */
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
    return [...grid.querySelectorAll<HTMLElement>(".card-cell:not([hidden])")];
  }

  function walk(from: HTMLElement, step: number): void {
    const cells = shownCells();
    const at = cells.indexOf(from);
    if (at < 0) return;
    const delta = Number.isFinite(step) ? step : Math.sign(step) * gridColumns();
    const target = cells[Math.max(0, Math.min(cells.length - 1, at + delta))];
    if (!target || target === from) return;
    setRoving(target);
    target.focus();
    target.scrollIntoView({ block: "nearest", behavior: motionEnabled() ? "smooth" : "auto" });
  }

  function buildCell(card: CardDef): Cell {
    /**
     * A `div` with a role rather than a `button`, and the reason is the canvas.
     *
     * A tile is a 168px card bitmap with three absolutely-positioned overlays on
     * it; a real `<button>` brings a UA stylesheet, a baseline, a default
     * `overflow`, and `display: inline-block` semantics that all have to be
     * fought back to `position: relative` before the layout works again. The
     * accessibility contract is the same either way — a role, a tab stop, a
     * label and the two keys that activate it — and before this, measured, a
     * hundred and twenty Tab presses from a cold load never landed on a card at
     * all, because `.card-cell` was a bare `div` with no `tabindex` and no role.
     */
    const root = document.createElement("div");
    root.className = "card-cell";
    root.setAttribute("role", "button");
    /**
     * A roving tab stop, not two hundred and forty-five of them.
     *
     * Giving every tile `tabindex="0"` makes the grid reachable and then makes
     * everything *after* the grid unreachable in practice: a player who wants
     * the filter's Clear button below it would press Tab two hundred and
     * forty-five times to get there, and one who wants the two-hundredth card
     * would press it two hundred times. The grid is one stop; the arrow keys
     * walk it, which is what the ARIA grid pattern says and what a card game
     * played on a pad does anyway.
     */
    root.tabIndex = -1;
    root.setAttribute("aria-label", cellLabel(card));
    const canvas = renderCardToCanvas(card, 168, {});
    root.appendChild(canvas);

    const count = document.createElement("div");
    count.className = "card-count mat-chip chip-static t-label";
    root.appendChild(count);

    // lock before star in the DOM, because the star steps aside for it in CSS
    const lock = document.createElement("div");
    lock.className = "card-lock";
    lock.innerHTML = icon("lock", { label: "Locked" });
    root.appendChild(lock);

    const fav = document.createElement("div");
    fav.className = "card-fav";
    fav.innerHTML = icon("star-filled", { label: "Favourite" });
    root.appendChild(fav);

    /**
     * The hover lights the *card*, not just the wrapper.
     *
     * §5 wants move, light and scale together inside 120ms. The CSS does move
     * and scale; this does light — the canvas brightens its own rim and kicks
     * its specular, because the metal is on the bitmap and no amount of
     * `filter: drop-shadow` on a wrapper is a rim highlight.
     */
    root.addEventListener("pointerenter", () => hoverCard(canvas, true));
    root.addEventListener("pointerleave", () => hoverCard(canvas, false));
    /**
     * Keyboard focus lights the card exactly as the pointer does. §5 asks for
     * every state to be designed, and a keyboard player who can reach a tile but
     * gets a ring around a card that has not woken up is being shown the cheaper
     * half of the interaction.
     */
    root.addEventListener("focus", () => {
      hoverCard(canvas, true);
      setRoving(root);
    });
    root.addEventListener("blur", () => hoverCard(canvas, false));

    const open = (): void => {
      audio.play("sfx.ui.click");
      // the canvas, not the cell: the cell reserves 18px under the card for the
      // count pill, and a FLIP measured against that lands the detail card low
      openDetail(card, canvas);
    };
    root.addEventListener("click", open);
    root.addEventListener("keydown", (event) => {
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
      walk(root, step);
    });
    return { root, canvas, count, fav, lock, shown: true };
  }

  /**
   * The entrance cascade, keyed off the grid rather than off the array index.
   *
   * `stagger(arriving, { step: 12, max: 280 })` divided its 280ms ceiling across
   * every arriving tile, and a full collection has 245 of them — so the measured
   * `--enter-delay` on the first ten cells came out 0, 1, 2, 3, 5, 6, 7, 8, 9,
   * 10ms and the entire visible grid landed inside about twenty-one
   * milliseconds. That is one pop, not a cascade, and §3a names the 30–60ms
   * cascade as the single biggest perceived-quality gap between a hobby menu and
   * a shipped one. The ceiling was not too low; dividing it by the wrong number
   * was the bug. Tiles below the fold are not on screen, so spending the budget
   * on them buys nothing and starves the ones that are.
   *
   * So the delay is a *diagonal* wave: `(row + column) × step`. Three things
   * fall out of that and all three are wanted. It is a true 30–60ms cascade in
   * reading order for anything the player can see. It completes in
   * `(rows + columns) × step` rather than `count × step`, so a 7-wide viewport
   * showing three rows finishes in about a third of a second whether the
   * collection holds twenty cards or two hundred and forty-five. And the wave
   * travels from the top-left, which is where the key light is — the grid
   * arrives lit-corner-first, the same direction every rim highlight in the game
   * runs.
   *
   * The column count comes from the resolved `grid-template-columns`, which is a
   * list of pixel values once layout has run; the fallback matters only on the
   * very first paint of a cold mount, where seven is the desktop count.
   */
  const CASCADE_STEP = 38;
  const CASCADE_MAX = 460;

  function gridColumns(): number {
    if (!grid || typeof getComputedStyle !== "function") return 7;
    const template = getComputedStyle(grid).gridTemplateColumns;
    const count = template.split(" ").filter((part) => part.trim().length > 0).length;
    return count > 0 ? count : 7;
  }

  function cascade(arriving: HTMLElement[]): void {
    if (!motionEnabled()) {
      stagger(arriving, { step: 0, max: 0 });
      return;
    }
    const columns = gridColumns();
    for (const [index, node] of arriving.entries()) {
      const wave = Math.floor(index / columns) + (index % columns);
      node.style.setProperty("--enter-delay", `${Math.min(CASCADE_MAX, wave * CASCADE_STEP)}ms`);
    }
  }

  function render(): void {
    if (!grid) return;
    const profile = getProfile();
    const visible = allCards.filter(matches);
    const wanted = new Set(visible.map((card) => card.id));

    const arriving: HTMLElement[] = [];
    let index = 0;
    for (const card of allCards) {
      let cell = cells.get(card.id);
      const show = wanted.has(card.id);
      if (!cell) {
        if (!show) continue;
        cell = buildCell(card);
        cells.set(card.id, cell);
        cell.shown = false;
      }

      if (show) {
        const owned = profile.collection[card.id] ?? 0;
        const maxCopies =
          card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;
        cell.root.classList.toggle("unowned", owned <= 0);
        cell.count.textContent = owned > 0 ? `${owned}/${maxCopies}` : "Missing";
        cell.fav.hidden = !profile.favorites.includes(card.id);
        cell.lock.hidden = !profile.locked.includes(card.id);
        // reading order is DOM order, so a re-shown cell goes back where it
        // belongs rather than on the end
        const at = grid.children[index];
        if (at !== cell.root) grid.insertBefore(cell.root, at ?? null);
        if (!cell.shown) {
          cell.root.hidden = false;
          arriving.push(cell.root);
        }
        cell.shown = true;
        index += 1;
      } else if (cell.shown) {
        cell.root.hidden = true;
        cell.shown = false;
      }
    }

    if (arriving.length > 0) cascade(arriving);

    // the grid's single tab stop has to be a tile that is actually on it
    if (!roving || roving.hidden || !roving.isConnected) setRoving(shownCells()[0] ?? null);

    const ownedTotal = allCards.filter((c) => (profile.collection[c.id] ?? 0) > 0).length;
    if (summary) {
      summary.innerHTML =
        `${visible.length} shown · ${ownedTotal}/${allCards.length} collected · ` +
        `${icon("shards")}<span class="num">${profile.shards.toLocaleString("en-GB")}</span> shards`;
    }
  }

  // ---- detail --------------------------------------------------------------

  /**
   * The card detail view.
   *
   * Two panes: the card itself, large and tilted, and a panel that switches
   * between what the card DOES and what it IS. The split exists because those
   * two readings never want each other's room — rules text wants to be scanned,
   * lore wants to be read, and in one column one of them was always in the way.
   */
  type DetailTab = "effect" | "story";
  let detailTab: DetailTab = "effect";

  /**
   * The detail leaves the way it arrived, which it previously did not.
   *
   * Opening runs a FLIP out of the tile the player pressed — measured, 178ms of
   * real travel with never a second card on screen. Closing was
   * `detail.hidden = true`: a hard cut, on the one surface in the screen with
   * the most elaborate entrance in it. §3a is explicit that everything that
   * appears has an entrance *and* everything that leaves has an exit, and a cut
   * after a shared-element grow is worse than a cut after nothing, because the
   * player has just been taught that this object moves.
   *
   * The exit is the entrance's own vocabulary reversed rather than a second
   * idea: the overlay drops back through the scale it rose from, on the leave
   * easing, which is sharper than the arrival — things go faster than they come,
   * §3. `hidden` still lands, just at the end; the class is cleared first so a
   * re-open never inherits a half-run animation.
   */
  let closing = 0;

  function closeDetail(): void {
    if (!detail || detail.hidden) return;
    window.clearTimeout(closing);
    if (!motionEnabled()) {
      detail.hidden = true;
      return;
    }
    detail.classList.add("cd-leaving");
    closing = window.setTimeout(() => {
      detail.classList.remove("cd-leaving");
      detail.hidden = true;
    }, DUR.ui - 40);
  }

  function openDetail(card: CardDef, from?: HTMLElement): void {
    if (!detail) return;
    const profile = getProfile();
    const owned = profile.collection[card.id] ?? 0;
    const palette = CURRENT_PALETTE[card.current];
    const craftCost = content.balance.economy.craftCost[card.rarity];
    const dustValue = content.balance.economy.dustValue[card.rarity];
    const lore = loreFor(card);

    /** The cards currently on screen, so the arrows walk the list you filtered. */
    const siblings = allCards.filter(matches);
    const index = siblings.findIndex((entry) => entry.id === card.id);

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
    head.innerHTML = `
      <h2 class="cd-name">${esc(card.name)}</h2>
      <span class="cd-subtitle">/ ${esc(subtitle)}</span>`;

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
     * No `phase` here.
     *
     * The literal `0.3` this used to pass was the tell the audit named for a
     * dead foil: nothing advanced it, so no card in HYPEBOUND ever shimmered.
     * `cardClock` has driven the phase since, which made the argument harmless
     * and left it lying in the file to mislead the next reader — a constant that
     * looks like it sets something and is overwritten before the first paint.
     */
    const cardCanvas = renderCardToCanvas(card, 420, { premium: card.rarity === "legendary" });
    tilt.appendChild(cardCanvas);
    artWrap.appendChild(tilt);

    /**
     * The tilt follows the pointer and returns to a resting angle that is
     * deliberately not square-on. A card lying flat reads as a picture of a
     * card; the whole point of this screen is that it is the object.
     *
     * The same two numbers go to the renderer as well as to the transform. A
     * card that turns while its sheen keeps its own schedule reads as a light
     * playing over a picture; a card whose sheen moves *because* it turned reads
     * as a surface catching the light, and it is the same dx and dy either way —
     * they were being computed and half-used.
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
     * landed, transformed back onto the tile the player pressed, and then
     * released. There is never a second card on screen and never a frame where
     * the object the player is following is not drawn, which is the whole point
     * of shared-element continuity.
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

    const step = (delta: number): void => {
      const next = siblings[index + delta];
      if (!next) return;
      /**
       * `navigate`, not `click`. Stepping through the filtered grid is the one
       * genuinely lateral movement in the interface, and the sound was written
       * for it — a short sideways swish rather than a button press. Everywhere
       * else that a button changes screen, `click` is still right.
       */
      audio.play("sfx.ui.navigate");
      openDetail(next);
    };
    for (const [delta, glyph, label] of [
      [-1, "chevron-left", "Previous card"],
      [1, "chevron-right", "Next card"],
    ] as const) {
      const arrow = document.createElement("button");
      arrow.className = `cd-arrow cd-arrow-${delta < 0 ? "prev" : "next"}`;
      arrow.type = "button";
      arrow.innerHTML = icon(glyph, { label });
      arrow.disabled = !siblings[index + delta];
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
    body.className = "cd-tab-body scroll";

    const keywordList = card.keywords
      .map((id) => {
        const keyword = content.keywords[id];
        return keyword ? `<li><strong>${esc(keyword.name)}</strong> — ${esc(keyword.reminderText)}</li>` : "";
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
        <div class="eyebrow">Collection</div>
        <p class="muted">You own <strong class="num">${owned}</strong>. Craft for ${icon("shards")}<span class="num">${craftCost}</span>, dismantle for ${icon("shards")}<span class="num">${dustValue}</span>.</p>`;
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
    craftBtn.innerHTML = `${icon("plus")}<span>Craft</span>${icon("shards")}<span class="num">${craftCost}</span>`;
    craftBtn.disabled = profile.shards < craftCost;
    craftBtn.addEventListener("click", () => {
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

    /** Arrow keys walk the grid, Escape closes. */
    const onKey = (event: KeyboardEvent): void => {
      if (detail.hidden) {
        window.removeEventListener("keydown", onKey);
        return;
      }
      if (event.key === "Escape") closeDetail();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);

    detail.addEventListener(
      "click",
      (event) => {
        if (event.target === detail) closeDetail();
      },
      { once: true }
    );
  }

  root.querySelector("#col-back")?.addEventListener("click", () => callbacks.onBack());

  const unsubscribe = profileStore.subscribe(() => render());
  render();

  return { root, dispose: () => unsubscribe() };
}
