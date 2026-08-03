/**
 * Collection browser: search, filters, grid, detail inspection, crafting and
 * dismantling, favourites and locks, and missing-card indicators.
 */

import type { CardDef, ContentIndex, CurrentId, FactionId, KeywordId, Rarity, CardType } from "../../engine/types";
import type { Screen } from "../shell";
import { collectibleCards } from "../../engine/content";
import { hoverCard, parseCardText, renderCardToCanvas } from "../cardRenderer/renderCard";
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

  function buildCell(card: CardDef): Cell {
    const root = document.createElement("div");
    root.className = "card-cell";
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

    root.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      openDetail(card, canvas);
    });
    return { root, canvas, count, fav, lock, shown: true };
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

    /**
     * 12ms rather than the default 45.
     *
     * A cascade is a wave when it lands inside a set-piece and a queue when it
     * does not; 245 tiles at 45ms would be an eleven-second entrance. `stagger`
     * compresses to fit the ceiling on its own, and 280ms is the ceiling that
     * keeps a filter feeling like a re-flow rather than a load.
     */
    if (arriving.length > 0) stagger(arriving, { step: 12, max: 280 });

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
    closeBtn.addEventListener("click", () => {
      detail.hidden = true;
    });
    head.appendChild(closeBtn);

    // -- the card, tilted ----------------------------------------------------
    const artWrap = document.createElement("div");
    artWrap.className = "cd-art";

    const tilt = document.createElement("div");
    tilt.className = "cd-tilt";
    tilt.appendChild(renderCardToCanvas(card, 420, { premium: card.rarity === "legendary", phase: 0.3 }));
    artWrap.appendChild(tilt);

    /**
     * The tilt follows the pointer and returns to a resting angle that is
     * deliberately not square-on. A card lying flat reads as a picture of a
     * card; the whole point of this screen is that it is the object.
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
    });
    artWrap.addEventListener("pointerleave", () => setTilt(REST_Y, REST_X));

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
      if (event.key === "Escape") detail.hidden = true;
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);

    detail.addEventListener(
      "click",
      (event) => {
        if (event.target === detail) detail.hidden = true;
      },
      { once: true }
    );
  }

  root.querySelector("#col-back")?.addEventListener("click", () => callbacks.onBack());

  const unsubscribe = profileStore.subscribe(() => render());
  render();

  return { root, dispose: () => unsubscribe() };
}
