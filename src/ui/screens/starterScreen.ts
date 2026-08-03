/**
 * Pick a faction, get its deck.
 *
 * The first screen a new account sees, and the reason it exists is worth stating:
 * accounts used to be created holding **every card in the game**. That made the
 * collection meaningless to grow and Merch Drops incapable of granting anything,
 * so the economy model's own answer applies instead — one faction's 30-card
 * starter deck now, the rest earned (`07-economy-and-monetization.md` §3.4).
 *
 * The choice is presented as a choice, not a formality: each faction shows its
 * Leader, its Currents and what the deck actually plays like, because picking
 * one and finding out later that it is the control deck is a bad first hour.
 *
 * ## What was wrong with it, because two of the three were behavioural
 *
 * **It rewrote `root.innerHTML` on every click.** Picking a faction therefore
 * destroyed and rebuilt the entire screen: the change was a hard cut with no
 * transition, the background's drift animation restarted from zero, the card
 * canvas was re-rendered from scratch, and the list scrolled back to the top —
 * so choosing the tenth faction jumped you back to the first. Nothing is rebuilt
 * now. The plates keep their state, and only the detail panel's text nodes and
 * the portrait change, which is what makes a cross-fade possible at all.
 *
 * **Eleven identical dark rectangles with a 10px coloured dot is a listbox, not
 * a choice.** Hearthstone's class pick is ten illustrated hero portraits that
 * light when you hover; Arena's colour pick is five painted mana plates. The
 * plates here carry the faction's colour as a real gradient, the leader's art
 * cropped behind it, and the crest — so the eleven differ from each other by
 * more than a dot.
 *
 * **The list overflowed the viewport at 1600×900 *and* at 1280×720**, in a
 * container with a bare `overflow-y: auto` and therefore the OS scrollbar. The
 * list is a bounded scroller with the game's own scrollbar now, and the layout
 * is clamped against `vh` like everything else in the front door.
 *
 * ## And then the stage was still a shrunken trading card
 *
 * The three fixes above were real and the panel they left behind was not. It
 * measured 1172×720 — fifty-nine per cent of the viewport — and held a 210px
 * `renderCardToCanvas`: a *card*, with a cost pip, a LEADER type line, a 30
 * health pip, a rules box at roughly seven pixels and a collector line under
 * six, centred in a field of flat fill. Ninety-three per cent of the largest
 * surface in the front door was empty, and the seven per cent that was not was
 * the exact defect the lobby had already fixed and this screen had not.
 *
 * What is here now is the composition the audit asked for: the leader painted at
 * portrait scale, bled off the panel's left edge behind a soft mask, the faction
 * colour behind it as a real two-stop wash, and the name, the title, the
 * identity line and what the deck actually *does* set as a column standing on
 * top of it. The confirm button is the widest thing in that column, because it
 * is the most consequential button in the game.
 *
 * The eleven rows carry the faction **crest** as their constant. Nine of them
 * used to show a 40px crop of the leader's painting and two showed a flat colour
 * swatch, because those two leaders have not been painted yet — which is not a
 * defect and never will be, but it did mean the row set spoke two visual
 * languages. The crest is on every plate at the same optical size, with whatever
 * painting exists sitting behind it, so the set reads as one and a painting
 * arriving improves a row rather than completing it.
 */

import type { CardDef, ContentIndex, FactionId, LeaderCardDef } from "../../engine/types";
import type { Screen } from "../shell";
import { starterDecks } from "../../game/progression/data";
import { grantStarterDeck, STARTER_DROPS } from "../../save/profile";
import { CURRENT_PALETTE, FACTION_COLOR } from "../cardRenderer/palette";
import { paintLeaderPortrait } from "../art/leaderPortrait";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { getAsset, onAssetLoaded } from "../art/assetLoader";
import { iconPath } from "../art/iconAssets";
import { icon } from "../art/uiIcons";
import { count, num } from "../format";
import { stagger } from "../motion";
import { audio } from "../../audio/audio";

export interface StarterCallbacks {
  onChosen: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createStarterScreen(content: ContentIndex, callbacks: StarterCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen starter-screen";

  const decks = starterDecks().filter((deck) => content.factions[deck.factionId]);
  let selected: FactionId | null = decks[0]?.factionId ?? null;

  /**
   * The whole screen, built once.
   *
   * Everything that changes with the selection is addressed by id below and
   * mutated in place. That is the entire fix for the innerHTML rewrite: a
   * screen you never rebuild is a screen whose scroll position, running
   * animations and focus survive a click.
   */
  root.innerHTML = `
    <header class="starter-head">
      <div class="t-label">Welcome</div>
      <h1 class="title t-display">Pick the deck you start with</h1>
      <p class="starter-sub">
        A complete 30-card deck and its Leader, free and yours to keep, plus
        ${num(STARTER_DROPS)} Merch Drops. You can unlock the other
        ${num(Math.max(0, decks.length - 1))} by playing them.
      </p>
    </header>

    <main class="starter-body">
      <div class="starter-list-wrap">
        <ul class="starter-list" role="listbox" aria-label="Starter decks" id="starter-list">
          ${decks
            .map((deck) => {
              const deckLeader = content.leaders[deck.leaderCardId];
              const deckFaction = content.factions[deck.factionId];
              const current = deckLeader ? CURRENT_PALETTE[deckLeader.primaryCurrent] : CURRENT_PALETTE.prism;
              const hue = FACTION_COLOR[deck.factionId] ?? current.key;
              return `
                <li>
                  <button class="starter-option mat-panel act ${deck.factionId === selected ? "selected" : ""}"
                          data-faction="${esc(deck.factionId)}" role="option" type="button"
                          style="--c:${current.key};--f:${hue}"
                          aria-selected="${deck.factionId === selected}">
                    <span class="starter-plate" aria-hidden="true"
                          data-card="${esc(deck.leaderCardId)}" data-faction-art="${esc(deck.factionId)}"></span>
                    <span class="starter-option-text">
                      <span class="starter-option-name">${esc(deckFaction?.name ?? deck.factionId)}</span>
                      <span class="starter-option-leader">${esc(deckLeader?.name ?? "")}</span>
                    </span>
                    <span class="starter-current t-label">${esc(current.label)}</span>
                    <span class="starter-tick" aria-hidden="true">${icon("check")}</span>
                  </button>
                </li>`;
            })
            .join("")}
        </ul>
      </div>

      <section class="starter-detail mat-panel" id="starter-detail">
        <div class="starter-detail-wash" aria-hidden="true"></div>
        <div class="starter-stage" id="starter-card" aria-hidden="true"></div>
        <div class="starter-detail-body">
          <span class="starter-detail-crest" id="starter-crest" aria-hidden="true"></span>
          <div class="t-label starter-detail-faction" id="starter-faction"></div>
          <h2 class="starter-leader-name t-display" id="starter-leader"></h2>
          <div class="starter-leader-title" id="starter-title"></div>
          <p class="starter-identity" id="starter-tagline"></p>
          <dl class="starter-facts">
            <div class="starter-fact">
              <dt class="t-label">The deck</dt>
              <dd id="starter-fact-deck"></dd>
            </div>
            <div class="starter-fact">
              <dt class="t-label">Currents</dt>
              <dd id="starter-fact-currents"></dd>
            </div>
            <div class="starter-fact starter-fact-wide">
              <dt class="t-label" id="starter-fact-power-name"></dt>
              <dd id="starter-fact-power"></dd>
            </div>
          </dl>
          <div class="starter-actions">
            <button class="starter-confirm mat-hero act" id="starter-confirm" type="button">
              ${icon("play")}<span id="starter-confirm-label">Start</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  `;

  /**
   * The crest on every plate, and the painting behind it where one exists.
   *
   * The crest is the constant, and it is an element rather than a background so
   * it can carry its own shadow and sit at one optical size on all eleven rows
   * whatever is behind it. That ordering is the point: nine painted leaders and
   * two unpainted ones used to produce two different kinds of thumbnail, and a
   * set of eleven objects that disagree about what they *are* is worse than
   * eleven that agree and differ only in how rich they are. A painting arriving
   * now improves a row instead of completing it.
   *
   * Both images are read off the loaded `HTMLImageElement` rather than from a
   * guessed path, because the loaders try several extensions and only they know
   * which one answered — a hard-coded `.png` would 404 loudly for every asset
   * that happens to be a `.webp`.
   */
  const dressPlates = (): void => {
    for (const plate of root.querySelectorAll<HTMLElement>(".starter-plate")) {
      const card = content.leaders[plate.dataset["card"] ?? ""];
      const art = card ? getCardArt(card) : null;
      if (art && !plate.classList.contains("has-art")) {
        plate.style.backgroundImage = `url("${art.src}")`;
        plate.classList.add("has-art");
      }
      const crest = getAsset(iconPath("crest", plate.dataset["factionArt"] ?? "neutral"));
      if (crest && !plate.querySelector(".starter-plate-crest")) {
        const mark = document.createElement("img");
        mark.className = "starter-plate-crest";
        mark.src = crest.src;
        mark.alt = "";
        plate.appendChild(mark);
      }
    }
  };
  dressPlates();
  const stopArtWatch = onArtLoaded(() => dressPlates());
  /**
   * Assets decode after the first frame, so the stage has to be told twice.
   *
   * `getAsset` answers `null` until the PNG is in, and the first `paintDetail`
   * runs on the same tick as the mount — so without this the detail crest is
   * simply absent on the one screen where it is the faction's whole identity.
   * `dressPlates` is idempotent and `repaintStage` is set below, after the
   * painter exists.
   */
  let repaintStage: () => void = () => {};
  const stopAssetWatch = onAssetLoaded(() => {
    dressPlates();
    repaintStage();
  });

  const detail = root.querySelector<HTMLElement>("#starter-detail");
  const factionEl = root.querySelector<HTMLElement>("#starter-faction");
  const leaderEl = root.querySelector<HTMLElement>("#starter-leader");
  const titleEl = root.querySelector<HTMLElement>("#starter-title");
  const cardHost = root.querySelector<HTMLElement>("#starter-card");
  const crestHost = root.querySelector<HTMLElement>("#starter-crest");
  const taglineEl = root.querySelector<HTMLElement>("#starter-tagline");
  const confirmLabel = root.querySelector<HTMLElement>("#starter-confirm-label");
  const deckFactEl = root.querySelector<HTMLElement>("#starter-fact-deck");
  const currentsFactEl = root.querySelector<HTMLElement>("#starter-fact-currents");
  const powerNameEl = root.querySelector<HTMLElement>("#starter-fact-power-name");
  const powerTextEl = root.querySelector<HTMLElement>("#starter-fact-power");

  const isLeader = (card: CardDef | undefined): card is LeaderCardDef => card?.type === "leader";

  /**
   * The stage's crest, refreshed on its own rather than with the whole panel.
   *
   * Repainting the detail when an asset lands would restart the cross-fade every
   * time a PNG decoded, so the panel would flicker its way through boot. This
   * touches one element and leaves the animation alone.
   */
  const dressCrest = (): void => {
    if (!crestHost) return;
    const crest = getAsset(iconPath("crest", selected ?? "neutral"));
    const existing = crestHost.querySelector("img");
    if (!crest) {
      crestHost.replaceChildren();
      return;
    }
    if (existing) {
      existing.src = crest.src;
      return;
    }
    const mark = document.createElement("img");
    mark.src = crest.src;
    mark.alt = "";
    crestHost.appendChild(mark);
  };

  /**
   * Repaint the detail panel for the current selection.
   *
   * Text nodes and one portrait, cross-faded. The `is-swapping` class is removed
   * on the next frame rather than by a timer: an animation restarted inside the
   * same frame it was cancelled does not restart at all, and a forced style
   * read is the cheapest way to be sure the browser has seen the intermediate
   * state.
   *
   * **The whole body is inside a `try`, and that is not defensive programming
   * for its own sake.** Three separate captures of this screen caught
   * `ReferenceError: bandFace is not defined` and `saturate is not defined`
   * thrown out of the card renderer while somebody else was editing it over HMR.
   * The errors were transient; what was not transient is that an exception in a
   * painter took down the *entire first-run screen* — the eleven plates, the
   * heading and the confirm button with it — because the mount threw. A new
   * player would have seen a blank page. One panel degrading is a bad frame; a
   * blank first screen is a lost account.
   */
  const paintDetail = (): void => {
    const chosen = decks.find((deck) => deck.factionId === selected);
    const card = chosen ? content.leaders[chosen.leaderCardId] : undefined;
    const leader = isLeader(card) ? card : undefined;
    const palette = leader ? CURRENT_PALETTE[leader.primaryCurrent] : CURRENT_PALETTE.prism;
    const faction = chosen ? content.factions[chosen.factionId] : undefined;
    const hue = FACTION_COLOR[chosen?.factionId ?? "neutral"] ?? palette.key;

    detail?.style.setProperty("--c", palette.key);
    detail?.style.setProperty("--f", hue);
    if (factionEl) {
      factionEl.textContent = faction?.name ?? "";
      factionEl.style.color = palette.key;
    }
    if (leaderEl) leaderEl.textContent = leader?.name ?? "";
    if (titleEl) titleEl.textContent = leader?.title ?? "";
    if (taglineEl) taglineEl.textContent = faction?.tagline ?? "";
    if (confirmLabel) confirmLabel.textContent = `Start with ${faction?.name ?? "this deck"}`;

    /**
     * What the deck is, in three facts rather than in a shrunken rules box.
     *
     * The header of this file promises the choice is presented as a choice —
     * "picking one and finding out later that it is the control deck is a bad
     * first hour" — and until now the only thing on the stage that said anything
     * about *play* was seven-pixel body copy inside a 210px card. The Fixation is
     * the honest answer: it is the button this leader presses every turn, so it
     * is the closest single sentence to what the deck feels like.
     */
    if (deckFactEl) {
      deckFactEl.textContent = `${count(chosen?.cards.length ?? 0)} cards, complete and yours to keep`;
    }
    if (currentsFactEl) {
      const currents = [leader?.primaryCurrent, leader?.secondaryCurrent]
        .filter((id): id is NonNullable<typeof id> => Boolean(id))
        .map((id) => CURRENT_PALETTE[id].label);
      currentsFactEl.textContent = currents.join(" · ") || "—";
    }
    if (powerNameEl) powerNameEl.textContent = leader ? leader.fixation.name : "Leader power";
    if (powerTextEl) powerTextEl.textContent = leader?.fixation.text ?? "";

    dressCrest();

    /**
     * The portrait, bled off the panel's left edge.
     *
     * 3:4 at 560 logical pixels wide, faded to nothing across the right 34% and
     * the bottom 18%, so the art dissolves into the plate rather than ending at
     * an edge — §7's fading-divider rule applied to a photograph. The same
     * `paintLeaderPortrait` the lobby's hero calls, which is the entire reason
     * that function is not a private helper in `lobbyScreen.ts` any more.
     */
    if (cardHost) {
      cardHost.replaceChildren();
      if (leader) {
        cardHost.appendChild(
          paintLeaderPortrait(leader, {
            width: 560,
            aspect: 4 / 3,
            bias: 0.1,
            scrim: 0.42,
            fadeRight: 0.34,
            fadeBottom: 0.18,
            className: "starter-portrait-art",
          })
        );
      }
    }

    if (detail) {
      detail.classList.remove("is-swapping");
      void detail.offsetWidth;
      detail.classList.add("is-swapping");
    }
  };

  repaintStage = dressCrest;

  /** See the note on `paintDetail`: a throw in a painter must cost one panel. */
  const paintDetailSafely = (): void => {
    try {
      paintDetail();
    } catch (error) {
      console.error("starter: the detail panel failed to paint", error);
      detail?.setAttribute("data-degraded", "true");
    }
  };

  for (const button of root.querySelectorAll<HTMLElement>(".starter-option")) {
    button.addEventListener("pointerenter", () => audio.play("sfx.ui.hover"));
    button.addEventListener("click", () => {
      const next = (button.dataset["faction"] ?? null) as FactionId | null;
      if (next === selected) return;
      selected = next;
      audio.play("sfx.ui.click");
      for (const other of root.querySelectorAll<HTMLElement>(".starter-option")) {
        const isSelected = other.dataset["faction"] === selected;
        other.classList.toggle("selected", isSelected);
        other.setAttribute("aria-selected", String(isSelected));
      }
      paintDetailSafely();
    });
  }

  root.querySelector("#starter-confirm")?.addEventListener("click", () => {
    if (!selected) return;
    audio.play("sfx.ui.confirm");
    grantStarterDeck(content, selected);
    callbacks.onChosen();
  });

  paintDetailSafely();
  stagger(root.querySelectorAll(".starter-option"), { step: 34, from: 120 });

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundStarter?: unknown }).hypeboundStarter = {
    options: () => decks.map((deck) => deck.factionId),
    choose: (factionId: FactionId) => {
      grantStarterDeck(content, factionId);
      callbacks.onChosen();
    },
  };

  return {
    root,
    dispose: () => {
      stopArtWatch();
      stopAssetWatch();
      delete (window as unknown as { hypeboundStarter?: unknown }).hypeboundStarter;
    },
  };
}
