/**
 * The deck slot rack — `03-screens-and-navigation.md` §4.3.2's first key
 * element: *"Deck slot list (12 save slots) with covers and validity badges"*.
 *
 * It did not exist. The game has always supported more than one deck —
 * `profile.decks` is an array, `saveDeck` appends to it, `setActiveDeck` picks
 * one — and there was **no way anywhere in the interface to see them or switch
 * between them**.
 *
 * ## Why it renders twelve slots and not one
 *
 * The first version drew only the decks you had, plus a dashed box. With one
 * saved deck that is a 980×270 island in the top-left of a 1600×900 screen and
 * about 1.1 million pixels of flat near-black — a room, not a rack. The dashed
 * box was the literal version of the same mistake: `border: 1px dashed` with no
 * fill is a wireframe placeholder shipped as final art.
 *
 * So the rack is always full. Eleven of the twelve sockets are empty for a new
 * player, and an empty socket is a *designed* object: recessed, lit from the
 * same 315° key as everything else, with its slot number engraved into the back
 * of the well. The screen tells you your capacity at a glance instead of leaving
 * you to work it out from a counter in the corner.
 */

import type { ContentIndex, DeckList } from "../../engine/types";
import type { Screen } from "../shell";
import { validateDeck } from "../../engine/deck";
import { coverCard, currentSplit, deckRecord } from "../../game/decks";
import { CURRENT_PALETTE, FACTION_COLOR } from "../cardRenderer/palette";
import { deleteDeck, getProfile, saveDeck, setActiveDeck } from "../../save/profile";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { motionEnabled } from "../motion";
import { decodeDeck } from "./deckBuilderScreen";
import { esc, installKitStyles, portraitCanvas } from "./collectionKit";
/**
 * The rack keeps its own layout and takes only the room.
 *
 * Of the eleven screens this wave owns, this is the one that was already a place
 * — a full-bleed rack with a hero slot, a grid and a footer rail, not a column
 * of slabs. What it shared with the other ten was the plate: `.ambient-bg` at
 * 0.8 opacity in front of `atmosphere.ts`, which is why it measured 0.124 on the
 * idle probe against a lobby at 0.891. It gets `.d-room` and nothing else.
 */
import { room } from "./data/kit";

export interface DeckSlotsCallbacks {
  onBack: () => void;
  onEdit: (index: number) => void;
  onNew: () => void;
}

/**
 * The cover art's raster size.
 *
 * It was a 112×166 portrait strip down the left of the tile, which is the right
 * idea at a tenth of the scale it needed: with one deck saved, the screen was
 * eleven grey sockets and one small picture, and squinting at it resolved into
 * twelve equal rectangles. Hearthstone's deck manager is a shelf of *painted
 * spines* and the paint is the whole reason the shelf reads. So the art is now
 * the tile — full-bleed behind the text, cropped to the right so the face
 * clears the copy — and the sockets recede because there is something in front
 * of them to recede behind. Rastered once at this size and `object-fit: cover`
 * from there, since the tile's own width moves with the grid.
 */
const COVER_W = 440;
const COVER_H = 240;

export function createDeckSlotsScreen(content: ContentIndex, callbacks: DeckSlotsCallbacks): Screen {
  installKitStyles();

  const root = document.createElement("div");
  root.className = "screen deck-slots-screen ds-v2";

  const render = (): void => {
    const profile = getProfile();
    const slots = content.balance.deck.slots;
    const decks = profile.decks.slice(0, slots);

    root.innerHTML = `
      ${room({ accent: "#6f7dff", lit: 0.8 })}
      <header class="screen-header">
        <button class="btn btn-ghost" id="slots-back">${icon("arrow-left")}<span>Lobby</span></button>
        <h1 class="title">Your Decks</h1>
        <div class="mastery-wallet">
          <div class="currency" title="Deck slots used">
            ${icon("deck", { size: 16 })}
            <span class="currency-value num" id="slots-count">${decks.length} / ${slots}</span>
          </div>
        </div>
      </header>
      <main class="deck-slots-body hb-scroll" id="slots-body"></main>`;

    const body = root.querySelector<HTMLElement>("#slots-body")!;
    root.querySelector("#slots-back")?.addEventListener("click", () => callbacks.onBack());

    /**
     * A midground rail across the top of the rack (§2). Without it the tiles
     * float on the atmosphere with nothing between them and the backdrop, which
     * is three depth planes short of the four the bar asks for.
     */
    const rail = document.createElement("div");
    rail.className = "deck-rack-rail";
    rail.innerHTML =
      icon("deck", { size: 16 }) +
      `<span class="t-label">The rack</span>` +
      `<span class="deck-rack-rule" aria-hidden="true"></span>` +
      `<span class="muted num">${decks.length} of ${slots} slots in use</span>`;
    body.appendChild(rail);

    /** Entrance in reading order, on the shared 34ms cascade. */
    let step = 0;
    const stagger = (node: HTMLElement): HTMLElement => {
      node.style.setProperty("--enter-delay", motionEnabled() ? `${Math.min(400, step++ * 38)}ms` : "0ms");
      return node;
    };

    for (const [index, deck] of decks.entries()) {
      body.appendChild(stagger(slotCard(deck, index, index === profile.activeDeckIndex)));
    }

    for (let index = decks.length; index < slots; index += 1) {
      body.appendChild(stagger(socket(index, index === decks.length, decks.length)));
    }

    if (decks.length >= slots) {
      const note = document.createElement("p");
      note.className = "muted deck-slots-full";
      note.id = "slots-full";
      note.textContent = `All ${slots} slots are in use. Delete one to make room.`;
      body.appendChild(note);
    }

    body.appendChild(rackFoot(profile, decks));
  };

  /**
   * The rack stands on a shelf, and the shelf has furniture on it.
   *
   * Measured at 1600×900 there was a 140px band of featureless near-black under
   * the bottom row — the rack ended in mid-air with the atmosphere showing
   * through, which is §1's flat fill and §2's missing midground in the same
   * hundred and forty pixels. Two things fix it, and they are the same thing:
   * a lit front edge under the last row so the sockets are standing on
   * something, and a footer carrying the three facts a deck manager is asked for
   * and had nowhere to put — how big the library behind these decks is, how the
   * active one is actually doing, and the way in for a deck somebody sent you.
   */
  function rackFoot(profile: ReturnType<typeof getProfile>, decks: DeckList[]): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "deck-rack-foot";

    const owned = Object.values(profile.collection).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
    const distinct = Object.values(profile.collection).filter((count) => count > 0).length;
    const active = decks[profile.activeDeckIndex];
    const record = active ? deckRecord(content, profile.history, active.name) : null;
    const rate =
      record === null || record.played === 0
        ? "no matches yet"
        : record.thin
          ? `${record.played} played — too few to call`
          : `${Math.round(record.winRate * 100)}% won over ${record.played}`;

    const fact = (glyph: Parameters<typeof icon>[0], label: string, value: string): string =>
      `<div class="deck-rack-fact">${icon(glyph, { size: 15 })}` +
      `<span class="t-label">${esc(label)}</span>` +
      `<b class="num">${esc(value)}</b></div>`;

    foot.innerHTML =
      fact("collection", "Cards owned", `${owned}`) +
      `<span class="deck-rack-foot-sep" aria-hidden="true"></span>` +
      fact("rarity", "Different cards", `${distinct}`) +
      `<span class="deck-rack-foot-sep" aria-hidden="true"></span>` +
      fact("achievement", "Active deck", rate);

    const importBtn = document.createElement("button");
    importBtn.className = "btn btn-ghost deck-rack-import";
    importBtn.type = "button";
    importBtn.id = "slots-import";
    importBtn.innerHTML = `${icon("plus", { size: 14 })}<span>Import deck code</span>`;
    importBtn.disabled = decks.length >= content.balance.deck.slots;
    importBtn.title = importBtn.disabled ? "Every slot is in use." : "Paste a deck code into a free slot";
    importBtn.addEventListener("click", () => {
      const code = window.prompt("Paste a deck code:");
      if (!code) return;
      const imported = decodeDeck(code, content);
      if (!imported) {
        foot.classList.add("is-refused");
        window.setTimeout(() => foot.classList.remove("is-refused"), 900);
        audio.play("sfx.ui.back");
        return;
      }
      saveDeck(imported);
      audio.play("sfx.ui.click");
      render();
    });
    foot.appendChild(importBtn);
    return foot;
  }

  /**
   * An empty slot, as a recessed socket with an engraved number.
   *
   * Only the first free socket is the live "new deck" control; the rest are
   * inert. Twelve identical buttons all meaning "make a deck" would be twelve
   * ways to do one thing, and the number is the point — it says how much room
   * is left without anybody having to count.
   */
  function socket(index: number, live: boolean, from: number): HTMLElement {
    const button = document.createElement("button");
    button.className = `deck-socket${live ? " is-live" : ""}`;
    button.type = "button";
    /**
     * Each socket further from the live one is cut a little deeper.
     *
     * Eleven identical recesses squint down to a wall of grey rectangles — the
     * repetition failure the recon named on the collection contact sheet,
     * relocated. A rack does not look like that: the slot you are about to use
     * is the shallow, lit one at the front and the empty ones behind it fall
     * away. `--depth` runs 0 at the live socket to 1 at the last, and the
     * stylesheet spends it on the shadow and on the numeral's weight, so the eye
     * reads a sequence rather than a repeat.
     */
    button.style.setProperty("--depth", (Math.min(1, (index - from) / 7)).toFixed(3));
    button.dataset["socket"] = String(index);
    if (live) button.id = "slots-new";
    button.disabled = !live;
    button.setAttribute("aria-label", live ? "Build a new deck" : `Empty deck slot ${index + 1}`);
    button.innerHTML = live
      ? `<span class="deck-socket-plus">${icon("plus", { size: 18 })}</span>` +
        `<span class="deck-socket-label">New deck</span>` +
        `<span class="deck-socket-number num" aria-hidden="true">${index + 1}</span>`
      : `<span class="deck-socket-number num" aria-hidden="true">${index + 1}</span>` +
        `<span class="deck-socket-label">Empty</span>`;
    if (live) {
      button.addEventListener("click", () => {
        audio.play("sfx.ui.click");
        callbacks.onNew();
      });
    }
    return button;
  }

  function slotCard(deck: DeckList, index: number, active: boolean): HTMLElement {
    const problems = validateDeck(content, deck);
    const leader = content.leaders[deck.leaderCardId];
    const split = currentSplit(content, deck);
    const record = deckRecord(content, getProfile().history, deck.name);
    const cover = coverCard(content, deck);

    const card = document.createElement("div");
    card.className = `deck-slot mat-panel ${active ? "is-active" : ""} ${problems.length > 0 ? "is-invalid" : ""}`;
    card.dataset["slot"] = String(index);
    card.style.setProperty("--slot-color", FACTION_COLOR[leader?.faction ?? "neutral"] ?? "#8f8aa8");

    /**
     * The cover is a **crop of the art**, not a 132px miniature of a whole card.
     *
     * At that size a card is an illegible postage stamp: the frame furniture,
     * the collector line and the rules text all render and none of them can be
     * read, so the one thing a deck spine has to do — be recognisable at a
     * glance — is the one thing it could not. A portrait crop is the same pixels
     * with the unreadable 80% removed.
     *
     * The bias to the right of the frame — where the copy is not — is done by
     * the stylesheet's `object-position` rather than here, because the tile is
     * cropped twice: once into this fixed raster and once again into whatever
     * width the rack has given it. Two shifts in the same direction compound and
     * walk the character out of frame; one shift, applied at the end, does not.
     */
    const art = document.createElement("div");
    art.className = "deck-slot-cover";
    if (cover) {
      const canvas = portraitCanvas(cover, COVER_W, COVER_H, { focusY: 0.02, scrim: false });
      // the raster size is fixed; the box is not, so CSS does the fitting
      canvas.style.width = "";
      canvas.style.height = "";
      art.appendChild(canvas);
    }
    card.appendChild(art);
    card.insertAdjacentHTML("beforeend", `<span class="deck-slot-index num">Slot ${index + 1}</span>`);

    const meta = document.createElement("div");
    meta.className = "deck-slot-meta";
    meta.innerHTML = `
      <div class="deck-slot-head">
        <span class="deck-slot-name">${esc(deck.name)}</span>
        ${active ? '<span class="deck-slot-badge mat-chip chip-static is-active-badge">Active</span>' : ""}
        <span class="deck-slot-badge mat-chip chip-static ${problems.length > 0 ? "is-invalid-badge" : "is-valid-badge"}"
              data-validity="${problems.length > 0 ? "invalid" : "valid"}">
          ${problems.length > 0 ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "Legal"}
        </span>
      </div>
      <div class="muted deck-slot-leader">${esc(leader?.name ?? deck.leaderCardId)} · <span class="num">${
        deck.cards.length
      }/${content.balance.deck.size}</span> cards</div>
      <div class="deck-slot-bar" role="img" aria-label="${esc(split.verdict)}">${split.slices
        .map(
          (slice) =>
            `<i style="width:${(slice.share * 100).toFixed(1)}%;background:${
              CURRENT_PALETTE[slice.current as keyof typeof CURRENT_PALETTE]?.key ?? "#8f8aa8"
            }"></i>`
        )
        .join("")}</div>
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
    edit.innerHTML = `${icon("edit", { size: 14 })}<span>Edit</span>`;
    edit.dataset["edit"] = String(index);
    edit.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onEdit(index);
    });
    actions.appendChild(edit);

    if (!active) {
      const use = document.createElement("button");
      use.className = "btn btn-ghost btn-sm";
      use.innerHTML = `${icon("play", { size: 14 })}<span>Play with this</span>`;
      use.dataset["use"] = String(index);
      /**
       * An illegal deck cannot become the active one. The active deck is what
       * every mode reaches for, so letting a 24-card list take that slot would
       * hand somebody a match they cannot start.
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
    remove.innerHTML = `${icon("trash", { size: 14 })}<span>Delete</span>`;
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
