/**
 * Collection browser: search, filters, grid, detail inspection, crafting and
 * dismantling, favourites and locks, and missing-card indicators.
 */

import type { CardDef, ContentIndex, CurrentId, FactionId, KeywordId, Rarity, CardType } from "../../engine/types";
import type { Screen } from "../shell";
import { collectibleCards } from "../../engine/content";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { CURRENT_PALETTE, FACTION_COLOR, RARITY_STYLE, hexToRgba } from "../cardRenderer/palette";
import { craftCard, dismantleCard, getProfile, profileStore, toggleFavorite, toggleLock } from "../../save/profile";
import { loreFor } from "../../game/cardLore";
import { audio } from "../../audio/audio";

/** Card text and lore are author-written, so nothing reaches innerHTML unescaped. */
const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

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
      <button class="btn btn-ghost" id="col-back">← Lobby</button>
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

  function render(): void {
    if (!grid) return;
    const profile = getProfile();
    const visible = allCards.filter(matches);

    grid.innerHTML = "";
    for (const card of visible) {
      const owned = profile.collection[card.id] ?? 0;
      const maxCopies = card.rarity === "legendary" ? content.balance.deck.maxCopiesLegendary : content.balance.deck.maxCopies;

      const cell = document.createElement("div");
      cell.className = `card-cell ${owned <= 0 ? "unowned" : ""}`;
      cell.appendChild(renderCardToCanvas(card, 168, { dimmed: owned <= 0 }));

      const badge = document.createElement("div");
      badge.className = "card-count";
      badge.textContent = owned > 0 ? `${owned}/${maxCopies}` : "Missing";
      cell.appendChild(badge);

      if (profile.favorites.includes(card.id)) {
        const star = document.createElement("div");
        star.className = "card-fav";
        star.textContent = "★";
        cell.appendChild(star);
      }
      if (profile.locked.includes(card.id)) {
        const lock = document.createElement("div");
        lock.className = "card-lock";
        lock.textContent = "🔒";
        cell.appendChild(lock);
      }

      cell.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        openDetail(card);
      });
      grid.appendChild(cell);
    }

    const ownedTotal = allCards.filter((c) => (profile.collection[c.id] ?? 0) > 0).length;
    if (summary) {
      summary.textContent = `${visible.length} shown · ${ownedTotal}/${allCards.length} collected · ✦ ${profile.shards.toLocaleString()} shards`;
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

  function openDetail(card: CardDef): void {
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
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
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

    const step = (delta: number): void => {
      const next = siblings[index + delta];
      if (!next) return;
      audio.play("sfx.ui.click");
      openDetail(next);
    };
    for (const [delta, glyph, label] of [
      [-1, "‹", "Previous card"],
      [1, "›", "Next card"],
    ] as const) {
      const arrow = document.createElement("button");
      arrow.className = `cd-arrow cd-arrow-${delta < 0 ? "prev" : "next"}`;
      arrow.type = "button";
      arrow.textContent = glyph;
      arrow.setAttribute("aria-label", label);
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
        <p class="cd-effect">${card.text ? esc(card.text) : `<span class="muted">No rules text.</span>`}</p>
        ${keywordList ? `<div class="eyebrow">Keywords</div><ul class="cd-keywords">${keywordList}</ul>` : ""}
        <div class="eyebrow">Current interactions</div>
        <p class="muted cd-currents">
          Deals +1 damage to: ${beats.length ? esc(beats.join(", ")) : "nothing (neutral)"}<br />
          Takes +1 damage from: ${beatenBy.length ? esc(beatenBy.join(", ")) : "nothing (neutral)"}
        </p>
        <div class="eyebrow">Collection</div>
        <p class="muted">You own <strong>${owned}</strong>. Craft for ✦${craftCost}, dismantle for ✦${dustValue}.</p>`;
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
    craftBtn.textContent = `Craft (✦${craftCost})`;
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
    dismantleBtn.textContent = `Dismantle (✦${dustValue})`;
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
    favBtn.textContent = profile.favorites.includes(card.id) ? "★ Favourited" : "☆ Favourite";
    favBtn.addEventListener("click", () => {
      toggleFavorite(card.id);
      render();
      openDetail(card);
    });

    const lockBtn = document.createElement("button");
    lockBtn.className = "btn btn-ghost";
    lockBtn.textContent = profile.locked.includes(card.id) ? "🔒 Locked" : "🔓 Lock";
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
