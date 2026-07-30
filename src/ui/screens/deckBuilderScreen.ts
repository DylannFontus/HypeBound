/**
 * Deck builder: leader selection, legal card pool, live validation, resource
 * curve, type distribution, auto-build, import/export codes and saved slots.
 */

import type { CardDef, ContentIndex, DeckList, LeaderCardDef } from "../../engine/types";
import type { Screen } from "../shell";
import { legalCardPool, validateDeck } from "../../engine/deck";
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
import { CURRENT_PALETTE, FACTION_COLOR, RARITY_STYLE } from "../cardRenderer/palette";
import type { CurrentId } from "../../engine/types";
import { deleteDeck, getProfile, myCosmetics, saveDeck, setActiveDeck } from "../../save/profile";
import { cosmeticById } from "../../game/cosmetics";
import { drawEmblem } from "../cosmetics/emblem";
import { audio } from "../../audio/audio";

/** 03 §4.3.2: "deck name (16 chars)". */
const NAME_LIMIT = 16;

export interface DeckBuilderCallbacks {
  deckIndex?: number;
  onBack: () => void;
  /**
   * §4.3.2's *"Test vs AI"* — launch a practice match with the **draft**,
   * without saving it first.
   *
   * The draft is handed over rather than read back from a slot, because the
   * whole point is trying a list you have not committed to. Saving it first
   * would overwrite the deck you are experimenting on.
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
  const profile = getProfile();
  let deckIndex = callbacks.deckIndex ?? profile.activeDeckIndex;
  /**
   * A brand-new slot starts **empty**.
   *
   * It used to open on an `autoBuildDeck` result, which builds from every
   * printed card in the game — so a new account's first visit to the deck
   * builder presented thirty cards it did not own, in a list the pool beside it
   * would have refused to let that player assemble one card at a time.
   * Auto-Complete fills from the collection, on request, and says what it could
   * not find.
   */
  let deck: DeckList = structuredClone(
    profile.decks[deckIndex] ?? {
      name: "New Deck",
      leaderCardId: selectableLeaders(content)[0]?.id ?? "",
      cards: [],
    }
  );

  const root = document.createElement("div");
  root.className = "screen builder-screen";
  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="sub-header">
      <button class="btn btn-ghost" id="db-back">← Decks</button>
      <input class="deck-name-input" id="db-name" aria-label="Deck name" maxlength="16" placeholder="Deck name" />
      <div class="row" id="db-header-actions"></div>
    </header>

    <div class="builder-body">
      <section class="builder-pool">
        <div class="builder-pool-head">
          <select class="leader-select" id="db-leader" aria-label="Leader"></select>
          <input class="search-input" id="db-search" type="search" placeholder="Search legal cards…" aria-label="Search cards" />
        </div>
        <div class="pool-grid scroll" id="db-pool"></div>
      </section>

      <aside class="builder-side panel">
        <div class="deck-stats" id="db-stats"></div>
        <div class="deck-curve" id="db-curve"></div>
        <div class="deck-identity" id="db-identity"></div>
        <div class="deck-list scroll" id="db-list"></div>
        <div class="deck-validation" id="db-validation"></div>
        <div class="deck-assist" id="db-assist"></div>
        <div class="builder-actions" id="db-actions"></div>
      </aside>
    </div>`;

  const nameInput = root.querySelector<HTMLInputElement>("#db-name");
  const leaderSelect = root.querySelector<HTMLSelectElement>("#db-leader");
  const poolHost = root.querySelector<HTMLElement>("#db-pool");
  const listHost = root.querySelector<HTMLElement>("#db-list");
  const statsHost = root.querySelector<HTMLElement>("#db-stats");
  const curveHost = root.querySelector<HTMLElement>("#db-curve");
  const validationHost = root.querySelector<HTMLElement>("#db-validation");
  const identityHost = root.querySelector<HTMLElement>("#db-identity");
  const assistHost = root.querySelector<HTMLElement>("#db-assist");
  const actionsHost = root.querySelector<HTMLElement>("#db-actions");
  const headerActions = root.querySelector<HTMLElement>("#db-header-actions");

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
    renderAll();
  });

  nameInput?.addEventListener("input", () => {
    /**
     * §4.3.2 caps a deck name at 16 characters. The `maxlength` attribute
     * handles typing; this handles a paste, and keeps the truncation in one
     * place rather than trusting every engine to agree about `value`.
     */
    deck.name = nameInput.value.slice(0, NAME_LIMIT);
    if (nameInput.value !== deck.name) nameInput.value = deck.name;
    renderActions();
  });

  root.querySelector<HTMLInputElement>("#db-search")?.addEventListener("input", (event) => {
    search = (event.target as HTMLInputElement).value.toLowerCase();
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

  function addCard(card: CardDef): void {
    if (deck.cards.length >= content.balance.deck.size) return;
    if (countOf(card.id) >= maxCopies(card)) return;
    const owned = getProfile().collection[card.id] ?? 0;
    if (countOf(card.id) >= owned) return; // cannot run more copies than you own
    deck.cards.push(card.id);
    audio.play("sfx.ui.click");
    renderAll();
  }

  function removeCard(cardId: string): void {
    const index = deck.cards.lastIndexOf(cardId);
    if (index >= 0) {
      deck.cards.splice(index, 1);
      audio.play("sfx.ui.back");
      renderAll();
    }
  }

  // ---- rendering -----------------------------------------------------------

  function renderPool(): void {
    if (!poolHost) return;
    const leader = content.leaders[deck.leaderCardId] as LeaderCardDef | undefined;
    if (!leader) return;

    const profileNow = getProfile();
    const pool = legalCardPool(content, leader)
      .filter((card) => {
        if (!search) return true;
        return `${card.name} ${card.text} ${card.tags.join(" ")}`.toLowerCase().includes(search);
      })
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

    poolHost.innerHTML = "";
    for (const card of pool) {
      const owned = profileNow.collection[card.id] ?? 0;
      const inDeck = countOf(card.id);
      const atLimit = inDeck >= Math.min(maxCopies(card), owned);

      const cell = document.createElement("button");
      cell.className = `pool-cell ${owned <= 0 ? "unowned" : ""} ${atLimit ? "at-limit" : ""}`;
      cell.type = "button";
      // the card id on the element, so a browser check can name what it clicked
      cell.dataset["card"] = card.id;
      cell.appendChild(renderCardToCanvas(card, 150, { dimmed: owned <= 0 || atLimit }));

      const badge = document.createElement("div");
      badge.className = "pool-badge";
      badge.textContent = owned <= 0 ? "Not owned" : `${inDeck}/${Math.min(maxCopies(card), owned)}`;
      cell.appendChild(badge);

      cell.addEventListener("click", () => addCard(card));

      /**
       * §4.3.2's *"build around this card"*.
       *
       * A corner button rather than a modifier click: a shortcut nobody can see
       * is a feature nobody uses, and a modifier is unreachable on touch. It
       * picks the leader whose pool pays this card's tags off hardest and
       * completes from the collection, so what comes back is a deck the account
       * can actually field.
       */
      /**
       * Only on a card you own. Building around a card you do not have would
       * either seed an uncollected copy or quietly leave it out — and both are
       * worse than the control not being there.
       */
      if (owned > 0) {
      const around = document.createElement("button");
      around.className = "pool-build-around";
      around.type = "button";
      around.dataset["around"] = card.id;
      around.textContent = "⌖";
      around.title = `Build a deck around ${card.name}`;
      around.setAttribute("aria-label", `Build a deck around ${card.name}`);
      around.addEventListener("click", (event) => {
        event.stopPropagation();
        const built = buildAround(content, card.id, getProfile().collection, "Around");
        if (!built) return;
        deck = built;
        if (leaderSelect) leaderSelect.value = deck.leaderCardId;
        audio.play("sfx.ui.click");
        renderAll();
      });
      cell.appendChild(around);
      }

      poolHost.appendChild(cell);
    }
  }

  function renderList(): void {
    if (!listHost) return;
    const counts = new Map<string, number>();
    for (const id of deck.cards) counts.set(id, (counts.get(id) ?? 0) + 1);

    const rows = [...counts.entries()]
      .map(([id, count]) => ({ card: content.cards[id], count }))
      .filter((row): row is { card: CardDef; count: number } => row.card !== undefined)
      .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name));

    listHost.innerHTML = "";
    for (const row of rows) {
      const palette = CURRENT_PALETTE[row.card.current];
      const entry = document.createElement("button");
      entry.className = "deck-row";
      entry.type = "button";
      entry.dataset["card"] = row.card.id;
      entry.style.setProperty("--row-color", palette.key);
      entry.innerHTML = `
        <span class="deck-row-cost">${row.card.cost}</span>
        <span class="deck-row-name">${row.card.name}</span>
        <span class="deck-row-current" title="${palette.label}">${palette.label.charAt(0)}</span>
        <span class="deck-row-rarity" style="color:${RARITY_STYLE[row.card.rarity].color}">◆</span>
        <span class="deck-row-count">×${row.count}</span>`;
      entry.title = `${row.card.name} — ${row.card.text}`;
      entry.addEventListener("click", () => removeCard(row.card.id));
      listHost.appendChild(entry);
    }
  }

  function renderStats(): void {
    if (!statsHost || !curveHost) return;
    const size = content.balance.deck.size;
    const leader = content.leaders[deck.leaderCardId];
    const faction = leader ? content.factions[leader.faction] : null;

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
        <span class="deck-count-value">${deck.cards.length}</span><span class="deck-count-max">/${size}</span>
      </div>
      <div class="deck-meta">
        <div style="color:${FACTION_COLOR[leader?.faction ?? "neutral"]}">${faction?.name ?? ""}</div>
        <div class="muted">Avg cost ${avgCost}</div>
        <div class="deck-types">${[...typeCounts.entries()]
          .map(([type, count]) => `<span class="type-pill">${type.slice(0, 4)} ${count}</span>`)
          .join("")}</div>
      </div>`;

    // curve histogram
    const buckets = new Array(8).fill(0) as number[];
    for (const id of deck.cards) {
      const card = content.cards[id];
      if (!card) continue;
      buckets[Math.min(card.cost, 7)] = (buckets[Math.min(card.cost, 7)] ?? 0) + 1;
    }
    /**
     * The histogram, plus the one sentence it cannot draw.
     *
     * Bars show what the curve *is*; `worstBucket` says where it is furthest
     * from what it *should be*, which is the question somebody looking at a
     * histogram is actually asking. The field was computed and returned by
     * `deckNeeds` and read by nothing — the same inert-field bug this block has
     * found five times elsewhere, sitting in code written to fix it.
     */
    const need = deckNeeds(content, deck);
    const peak = Math.max(1, ...buckets);
    const thin =
      need.worstBucket !== null
        ? `<p class="muted curve-note" id="db-curve-note">Thinnest at ${
            need.worstBucket === 7 ? "7+" : need.worstBucket
          } Hype — ${need.curve[need.worstBucket] ?? 0} short of the target curve.</p>`
        : `<p class="muted curve-note" id="db-curve-note">The curve is where it wants to be.</p>`;
    curveHost.innerHTML = `<div class="eyebrow">Hype Curve</div><div class="curve-bars">${buckets
      .map(
        (count, cost) =>
          `<div class="curve-bar ${cost === need.worstBucket ? "is-thin" : ""}"><div class="curve-fill" style="height:${
            (count / peak) * 100
          }%"></div>
           <div class="curve-count">${count}</div><div class="curve-label">${cost === 7 ? "7+" : cost}</div></div>`
      )
      .join("")}</div>${thin}`;
  }

  function renderValidation(): void {
    if (!validationHost) return;
    const problems = validateDeck(content, deck);
    if (problems.length === 0) {
      validationHost.innerHTML = '<div class="validation-ok">✓ Legal deck — ready to play</div>';
      return;
    }
    validationHost.innerHTML = `<div class="validation-problems">${problems
      .map((p) => `<div class="validation-problem">• ${p.message}</div>`)
      .join("")}</div>`;
  }

  function renderActions(): void {
    if (!actionsHost || !headerActions) return;
    actionsHost.innerHTML = "";
    headerActions.innerHTML = "";

    /**
     * The last gate before a deck leaves this screen.
     *
     * `validateDeck` deliberately says nothing about ownership — six systems
     * deal decks of cards you do not own — so the builder has to. Without this,
     * **pasting a deck code was a way straight past the pool's one `if`**: a
     * borrowed thirty-card list validates perfectly, saves, becomes the active
     * deck and is dealt in a real match. That is the same bug this screen's
     * Auto-Build had, in a third corner, and it reaches the same place.
     *
     * A deck saved before its cards were dismantled lands here too, which is why
     * the message points at the "You cannot field these" panel rather than just
     * refusing.
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

    const makeButton = (label: string, className: string, handler: () => void): HTMLButtonElement => {
      const button = document.createElement("button");
      button.className = `btn ${className}`;
      button.textContent = label;
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
         * `saveDeck` returns −1 when every slot is full.
         *
         * Unhandled, the player pressed Save on a full account, nothing was
         * written, the screen said *"✓ Saved and set as your active deck"*, and
         * the local `deckIndex` became −1 — so the next Save would try to append
         * again rather than overwrite. `setActiveDeck` clamps, so the account's
         * pointer survives; the lie on screen is the part that does not.
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
         * Re-render everything, not just the validation line.
         *
         * The Compare button's label is the unsaved-changes indicator, so it has
         * to be recomputed the moment there is something new to compare against
         * — otherwise it keeps reading "Compare" over a deck that has just been
         * saved, which is the one moment it is guaranteed to be wrong.
         */
        renderAll();
        if (validationHost) {
          validationHost.innerHTML = '<div class="validation-ok">✓ Saved and set as your active deck</div>';
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
       * The button label is also the unsaved-changes indicator.
       *
       * "Compare (+3 −1)" answers *"have I changed anything since I saved?"*
       * without opening anything, which is the question the diff is usually
       * being opened to answer.
       */
      makeButton(
        (() => {
          const diff = diffDecks(content, savedDeck(), deck);
          if (diff.unsaved) return "Compare";
          if (diff.identical) return "Compare — saved";
          // a rename, a new cover or a new card back changes no counts, and
          // "(+0 −0)" would read as "nothing changed" on a deck with unsaved work
          if (diff.added === 0 && diff.removed === 0) return "Compare — unsaved";
          return `Compare (+${diff.added} −${diff.removed})`;
        })(),
        "btn-ghost",
        () => {
          comparing = !comparing;
          renderAssist();
        }
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
        renderAll();
      }),
      makeButton("Delete", "btn-ghost", () => {
        /**
         * `getProfile()`, not the mount-time snapshot.
         *
         * `Store.update` replaces its cache with a fresh clone, so `profile`
         * captured when the screen was built never sees anything saved since —
         * and after saving into a new slot this guard read `undefined` and
         * **Delete silently did nothing**. The snapshot is fine for the two
         * places that read it before anything can have changed; everywhere else
         * has to ask.
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
   *
   * Both read the account's real collection, which is the whole point: §14
   * requires the builder's assistance to run from what you own, and the button
   * this replaces did not.
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

    const rows = (title: string, id: string, body: string): string =>
      body ? `<div class="assist-block" id="${id}"><div class="eyebrow">${title}</div>${body}</div>` : "";

    assistHost.innerHTML = [
      rows(
        "Suggested next",
        "db-suggestions",
        /**
         * The strength bar reads `Suggestion.score`, which was returned and
         * never looked at.
         *
         * It is drawn relative to the best row rather than on an absolute scale,
         * because the number has no units — what a player can use is *"the top
         * one is far better than the rest"* versus *"these five are much of a
         * muchness"*, and the list order alone cannot tell those apart.
         */
        ((best) =>
          suggestions
            .map(
              (suggestion) => `
              <button class="assist-row" data-add="${esc(suggestion.cardId)}" data-reason="${
                suggestion.reason
              }" data-score="${suggestion.score}">
                <span class="assist-cost">${suggestion.cost}</span>
                <span class="assist-name">${esc(suggestion.name)}</span>
                <span class="assist-strength" aria-hidden="true"><i style="width:${Math.round(
                  (suggestion.score / best) * 100
                )}%"></i></span>
                <span class="assist-why muted">${esc(suggestion.why)}</span>
              </button>`
            )
            .join(""))(Math.max(1, ...suggestions.map((s) => s.score)))
      ),
      rows(
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
      rows(
        "Worth crafting",
        "db-craft",
        craft
          .map(
            (target) => `
              <div class="assist-row assist-craft" data-craft="${esc(target.cardId)}">
                <span class="assist-cost">${target.cost}</span>
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
        <span class="assist-cost">${row.cost}</span>
        <span class="assist-name">${esc(row.name)}</span>
        <span class="diff-counts">${row.before} → ${row.after}</span>
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
   * The donut is a conic gradient rather than an SVG or a canvas: it is one
   * element, it scales with the interface size for free, and there is nothing to
   * redraw when a card is added. The **verdict line under it** is the part that
   * matters — a picture says what the split is, and the sentence says what it
   * buys you.
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
     * Card backs you **own**, plus the house default.
     *
     * The same rule as everything else on this screen: the picker offers what
     * the account has. `myCosmetics` already filters to owned ids, so an
     * unearned back is not on the list rather than shown and refused.
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
      delete (window as unknown as { hypeboundBuilder?: unknown }).hypeboundBuilder;
    },
  };
}
