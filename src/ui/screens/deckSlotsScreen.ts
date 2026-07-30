/**
 * The deck slot list — `03-screens-and-navigation.md` §4.3.2's first key
 * element: *"Deck slot list (12 save slots) with covers and validity badges"*.
 *
 * It did not exist. The game has always supported more than one deck —
 * `profile.decks` is an array, `saveDeck` appends to it, `setActiveDeck` picks
 * one — and there was **no way anywhere in the interface to see them or switch
 * between them**. Saving a second deck silently made it active and made the
 * first unreachable except by typing `#deckbuilder?deck=1` into the address bar.
 *
 * So this is a screen about something the save layer could already do and the
 * player could not.
 */

import type { ContentIndex, DeckList } from "../../engine/types";
import type { Screen } from "../shell";
import { validateDeck } from "../../engine/deck";
import { coverCard, currentSplit, deckRecord } from "../../game/decks";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { deleteDeck, getProfile, setActiveDeck } from "../../save/profile";
import { audio } from "../../audio/audio";

export interface DeckSlotsCallbacks {
  onBack: () => void;
  onEdit: (index: number) => void;
  onNew: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createDeckSlotsScreen(content: ContentIndex, callbacks: DeckSlotsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen deck-slots-screen";

  const render = (): void => {
    const profile = getProfile();
    const slots = content.balance.deck.slots;
    const decks = profile.decks.slice(0, slots);

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="slots-back">← Lobby</button>
        <h1 class="title">Your Decks</h1>
        <div class="mastery-wallet">
          <div class="currency" title="Deck slots used">
            <span class="currency-icon">▤</span>
            <span class="currency-value" id="slots-count">${decks.length} / ${slots}</span>
          </div>
        </div>
      </header>
      <main class="deck-slots-body scroll" id="slots-body"></main>`;

    const body = root.querySelector<HTMLElement>("#slots-body")!;
    root.querySelector("#slots-back")?.addEventListener("click", () => callbacks.onBack());

    for (const [index, deck] of decks.entries()) {
      body.appendChild(slotCard(deck, index, index === profile.activeDeckIndex));
    }

    /**
     * The empty slot is a real tile rather than a button in a corner, because
     * §4.3.2's list is twelve slots and a player should be able to see how many
     * they have left. It disappears at the cap rather than failing on click.
     */
    if (decks.length < slots) {
      const empty = document.createElement("button");
      empty.className = "deck-slot deck-slot-empty";
      empty.type = "button";
      empty.id = "slots-new";
      empty.innerHTML = `
        <div class="deck-slot-plus">+</div>
        <div class="deck-slot-name">New deck</div>
        <div class="muted">${slots - decks.length} slot${slots - decks.length === 1 ? "" : "s"} free</div>`;
      empty.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onNew();
      });
      body.appendChild(empty);
    } else {
      const note = document.createElement("p");
      note.className = "muted deck-slots-full";
      note.id = "slots-full";
      note.textContent = `All ${slots} slots are in use. Delete one to make room.`;
      body.appendChild(note);
    }
  };

  function slotCard(deck: DeckList, index: number, active: boolean): HTMLElement {
    const problems = validateDeck(content, deck);
    const leader = content.leaders[deck.leaderCardId];
    const split = currentSplit(content, deck);
    const record = deckRecord(content, getProfile().history, deck.name);
    const cover = coverCard(content, deck);

    const card = document.createElement("div");
    card.className = `deck-slot panel panel-chrome ${active ? "is-active" : ""} ${problems.length > 0 ? "is-invalid" : ""}`;
    card.dataset["slot"] = String(index);
    card.style.setProperty("--slot-color", FACTION_COLOR[leader?.faction ?? "neutral"] ?? "#8f8aa8");

    const art = document.createElement("div");
    art.className = "deck-slot-cover";
    if (cover) art.appendChild(renderCardToCanvas(cover, 132));
    card.appendChild(art);

    const meta = document.createElement("div");
    meta.className = "deck-slot-meta";
    meta.innerHTML = `
      <div class="deck-slot-head">
        <span class="deck-slot-name">${esc(deck.name)}</span>
        ${active ? '<span class="deck-slot-badge is-active-badge">Active</span>' : ""}
        <span class="deck-slot-badge ${problems.length > 0 ? "is-invalid-badge" : "is-valid-badge"}"
              data-validity="${problems.length > 0 ? "invalid" : "valid"}">
          ${problems.length > 0 ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "Legal"}
        </span>
      </div>
      <div class="muted deck-slot-leader">${esc(leader?.name ?? deck.leaderCardId)} · ${deck.cards.length}/${
        content.balance.deck.size
      } cards</div>
      <div class="muted deck-slot-split">${esc(split.verdict)}</div>
      <div class="muted deck-slot-record" data-record="${index}">${
        record.played === 0
          ? "No matches yet."
          : record.thin
            ? `${record.played} match${record.played === 1 ? "" : "es"} — too few to call a win rate.`
            : `${record.played} matches · ${Math.round(record.winRate * 100)}% won`
      }</div>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "deck-slot-actions";

    const edit = document.createElement("button");
    edit.className = "btn btn-primary btn-sm";
    edit.textContent = "Edit";
    edit.dataset["edit"] = String(index);
    edit.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onEdit(index);
    });
    actions.appendChild(edit);

    if (!active) {
      const use = document.createElement("button");
      use.className = "btn btn-ghost btn-sm";
      use.textContent = "Play with this";
      use.dataset["use"] = String(index);
      /**
       * An illegal deck cannot become the active one. The active deck is what
       * every mode reaches for, so letting a 24-card list take that slot would
       * hand somebody a match they cannot start, from a screen that told them
       * the deck had problems.
       */
      use.disabled = problems.length > 0;
      use.title = problems.length > 0 ? problems[0]!.message : "Make this your active deck";
      use.addEventListener("click", () => {
        setActiveDeck(index);
        audio.play("sfx.ui.click");
        render();
      });
      actions.appendChild(use);
    }

    const remove = document.createElement("button");
    remove.className = "btn btn-ghost btn-sm";
    remove.textContent = "Delete";
    remove.dataset["delete"] = String(index);
    remove.addEventListener("click", () => {
      deleteDeck(index);
      audio.play("sfx.ui.back");
      render();
    });
    actions.appendChild(remove);

    card.appendChild(actions);
    return card;
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundDecks?: unknown }).hypeboundDecks = {
    slots: () =>
      getProfile().decks.map((deck, index) => ({
        index,
        name: deck.name,
        size: deck.cards.length,
        problems: validateDeck(content, deck).length,
        active: index === getProfile().activeDeckIndex,
        verdict: currentSplit(content, deck).verdict,
      })),
    cap: () => content.balance.deck.slots,
    refresh: render,
  };

  return {
    root,
    resume: render,
    dispose: () => {
      delete (window as unknown as { hypeboundDecks?: unknown }).hypeboundDecks;
    },
  };
}
