/**
 * The character gallery — `03-screens-and-navigation.md` §4.3.3.
 *
 * *"The cast browser: leaders and named characters as characters, not cards."*
 * The collection screen already shows every card; this shows the people, which
 * is a different question — who they are, what you have done with them, and what
 * has been written about them.
 *
 * ## What it draws on, and what it does not
 *
 * Everything here already exists somewhere: the art comes from the card
 * renderer, the biography from `data/cards/lore.txt`, the affinity track from
 * the Bias Board and the leader levels from Leader Mastery. Nothing new was
 * authored for this screen — which is the point. A gallery that needed its own
 * copy of a character's biography would be a second biography to keep in sync.
 *
 * Three parts of §4.3.3 are **deliberately absent** rather than faked:
 *
 * - **Skins and alt-art carousel.** There is no alternate-art system; card art
 *   is procedural and keyed by card id alone. Same blocker as the portrait
 *   entries in `DEFERRED_COSMETICS`, and the panel says so.
 * - **Voice-line jukebox.** The audio manifest is wired and every slot is empty.
 * - **Relationships ("Rivals: …").** No card carries relationship data, and
 *   inventing it here would be authoring lore in a UI file.
 *
 * The "cards featuring this character" strip *is* built, because it is real:
 * a character's own card, its Premium variants, and — for a leader — the cards
 * of their faction and Current that they can actually be built around.
 */

import type { CardDef, ContentIndex, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import { selectableLeaders } from "../../engine/content";
import { loreFor } from "../../game/cardLore";
import { masteryLore } from "../../game/progression/masteryLore";
import { biasBoard, getProfile, leaderMastery } from "../../save/profile";
import { renderCardToCanvas } from "../cardRenderer/renderCard";
import { FACTION_COLOR } from "../cardRenderer/palette";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { motionEnabled } from "../motion";
import {
  CURRENT_SIGIL,
  bindScrollFades,
  esc,
  installKitStyles,
  lazyPaint,
  portraitCanvas,
} from "./collectionKit";

export interface GalleryCallbacks {
  onBack: () => void;
  onCollection: () => void;
  onMastery: () => void;
}

/** How many characters a faction shows before the list asks you to filter. */
const SHOWN = 90;

/** The portrait box. 3:4, so every row's baselines agree whatever the name does. */
const TILE_W = 168;
const TILE_H = 224;

export function createGalleryScreen(content: ContentIndex, callbacks: GalleryCallbacks): Screen {
  installKitStyles();

  const root = document.createElement("div");
  root.className = "screen gallery-screen gal-v2";

  /** "all", or a faction id */
  let filter = "all";
  /** the character whose page is open, or null for the grid */
  let openId: string | null = null;
  /**
   * Ninety portraits is ninety canvases, and at most about twenty-eight are on
   * screen. They are painted as they come near the fold and never again.
   */
  let painter: ReturnType<typeof lazyPaint> | null = null;
  let unbindFades: () => void = () => {};

  const factions = Object.values(content.factions).filter((faction) => faction.id !== "neutral");
  const leaderIds = new Set(selectableLeaders(content).map((leader) => leader.id));

  /**
   * The cast: every leader, then every collectible character.
   *
   * Tokens are excluded because a Follower is not a member of the cast, and
   * Premium variants fold into the card they are a variant of — a gallery that
   * listed somebody twice because you were granted a shiny copy of them would be
   * saying something false about the roster.
   */
  const cast = (): CardDef[] => {
    const leaders = selectableLeaders(content) as unknown as CardDef[];
    const characters = Object.values(content.cards).filter(
      (card) => card.type === "character" && !card.token && !card.variantOf
    );
    return [...leaders, ...characters].sort((a, b) => {
      if (a.faction !== b.faction) return a.faction < b.faction ? -1 : 1;
      const aLeader = leaderIds.has(a.id) ? 0 : 1;
      const bLeader = leaderIds.has(b.id) ? 0 : 1;
      if (aLeader !== bLeader) return aLeader - bLeader;
      return a.name < b.name ? -1 : 1;
    });
  };

  const colorOf = (factionId: string): string => FACTION_COLOR[factionId as FactionId] ?? FACTION_COLOR.neutral;

  /**
   * A cast tile: a face, a scrim and a name.
   *
   * It used to be a coloured capital letter in a near-black rectangle with a 1px
   * border and a 3px stripe — the Gmail-contacts convention, which is an admin
   * dashboard pattern and not a character gallery. It also had no fixed height,
   * so a two-line name pushed its role label 34px below its neighbours' and one
   * row carried three different baselines.
   *
   * Every character in the game already has a painting or the renderer's own
   * placeholder, and the top of a card's art window is a portrait crop by
   * construction. Fixed 3:4, name on a scrim, faction crest at the top-right,
   * faction colour as a lit gradient along the bottom edge rather than as a hard
   * border on the left.
   */
  const buildTile = (card: CardDef): HTMLElement => {
    const owned = (getProfile().collection[card.id] ?? 0) > 0;
    const isLeader = leaderIds.has(card.id);
    const seen = owned || isLeader;

    const item = document.createElement("li");
    item.className = "gallery-cell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `gallery-tile${seen ? "" : " unseen"}`;
    button.dataset["id"] = card.id;
    button.style.setProperty("--c", colorOf(card.faction));
    button.setAttribute(
      "aria-label",
      `${card.name}, ${isLeader ? "leader" : content.currents[card.current]?.name ?? card.current}, ${
        content.factions[card.faction as FactionId]?.name ?? card.faction
      }${seen ? "" : " — not yet seen"}`
    );

    const slot = document.createElement("div");
    slot.className = "card-slot gallery-tile-slot";
    button.appendChild(slot);

    button.insertAdjacentHTML(
      "beforeend",
      `<span class="gallery-tile-crest">${icon(CURRENT_SIGIL[card.current], { size: 13 })}</span>` +
        (seen ? "" : `<span class="gallery-tile-locked">${icon("lock", { size: 12, label: "Not yet seen" })}</span>`) +
        `<span class="gallery-tile-body">` +
        `<span class="gallery-tile-name">${esc(card.name)}</span>` +
        `<span class="gallery-tile-role">${isLeader ? "Leader" : esc(content.currents[card.current]?.name ?? card.current)}</span>` +
        `</span>`
    );

    button.addEventListener("click", () => {
      openId = card.id;
      audio.play("sfx.ui.click");
      render();
    });
    button.addEventListener("pointerenter", () => audio.play("sfx.ui.hover"));

    painter?.watch(button, () => {
      slot.replaceWith(portraitCanvas(card, TILE_W, TILE_H));
    });

    item.appendChild(button);
    return item;
  };

  const page = (card: CardDef): string => {
    const isLeader = leaderIds.has(card.id);
    const lore = loreFor(card);
    const faction = content.factions[card.faction as FactionId];
    const affinity = biasBoard(content).find((view) => view.cardId === card.id);
    const track = isLeader ? leaderMastery(content).find((view) => view.id === card.id) : undefined;
    const chapter = isLeader ? masteryLore("leader", card.id, 1, card.name) : null;

    /**
     * Cards this character shows up on. Their own card first, then anything that
     * is a variant of it — the honest reading of "featuring", which is why it is
     * not a guess based on names.
     */
    const featuring = [card, ...Object.values(content.cards).filter((entry) => entry.variantOf === card.id)];

    return `
      <section class="panel panel-chrome gallery-page" data-character="${esc(card.id)}">
        <div class="gallery-page-head">
          <button class="btn btn-ghost" id="gallery-close">← All characters</button>
          <h2 class="gallery-page-title">${esc(card.name)}</h2>
          <span class="muted">${esc(faction?.name ?? card.faction)} · ${esc(content.currents[card.current]?.name ?? card.current)}</span>
        </div>

        <div class="gallery-page-body">
          <div class="gallery-portrait" id="gallery-portrait"></div>

          <div class="gallery-page-text">
            <div class="gallery-badges">
              <span class="gallery-badge" style="--c:${esc(colorOf(card.faction))}">${esc(faction?.name ?? card.faction)}</span>
              <span class="gallery-badge">${esc(content.currents[card.current]?.name ?? card.current)}</span>
              <span class="gallery-badge">${isLeader ? "Leader" : esc(card.rarity)}</span>
            </div>

            <h3 class="profile-section-title">${esc(lore.title)}</h3>
            ${
              // the stand-in body and the "not written yet" note say the same
              // thing, so only one of them is ever shown
              lore.written
                ? lore.body.map((paragraph) => `<p class="gallery-prose">${esc(paragraph)}</p>`).join("")
                : `<p class="muted">Nobody has written this one up yet. It will appear here when they do.</p>`
            }
            ${lore.quote ? `<p class="gallery-quote">${esc(lore.quote)}</p>` : ""}

            ${
              track
                ? `<div class="gallery-track">
                     <h4>Leader Mastery — level ${track.rank}</h4>
                     <div class="mastery-bar"><span style="width:${track.maxed ? 100 : Math.min(100, (track.intoRank / Math.max(1, track.toNext)) * 100)}%"></span></div>
                     <p class="muted">${track.maxed ? "Mastered." : `${track.toNext - track.intoRank} XP to level ${track.rank + 1}.`}</p>
                     ${
                       chapter && chapter.written
                         ? `<h4>${esc(chapter.title)}</h4>${chapter.body.map((p) => `<p class="gallery-prose">${esc(p)}</p>`).join("")}`
                         : ""
                     }
                   </div>`
                : ""
            }

            ${
              affinity
                ? `<div class="gallery-track">
                     <h4>Affinity — ${affinity.ap} AP${affinity.tierName ? ` · ${esc(affinity.tierName)}` : ""}</h4>
                     <div class="mastery-bar"><span style="width:${affinity.nextAt > 0 ? Math.min(100, (affinity.ap / affinity.nextAt) * 100) : 100}%"></span></div>
                     <p class="muted">${affinity.nextAt > 0 ? `${affinity.nextAt - affinity.ap} AP to the next tier.` : "Parasocial — the top tier."}</p>
                   </div>`
                : ""
            }

            <div class="gallery-featuring">
              <h4>Cards${featuring.length > 1 ? ` (${featuring.length})` : ""}</h4>
              <div class="gallery-card-strip" id="gallery-strip"></div>
            </div>

            <p class="muted gallery-missing">
              Alternate art, skins and voice lines are not here: card art is procedural and keyed by
              card id, and every audio slot is still empty. They will appear when those systems do.
            </p>

            <div class="stats-actions">
              <button class="btn btn-ghost" id="gallery-collection">Find in Collection →</button>
              ${isLeader ? `<button class="btn btn-ghost" id="gallery-mastery">Mastery track →</button>` : ""}
            </div>
          </div>
        </div>
      </section>`;
  };

  const render = (): void => {
    const everyone = cast();
    const open = openId ? everyone.find((card) => card.id === openId) : undefined;
    const shown = open
      ? []
      : everyone.filter((card) => filter === "all" || card.faction === filter).slice(0, SHOWN);
    const total = open ? 0 : everyone.filter((card) => filter === "all" || card.faction === filter).length;

    painter?.stop();
    unbindFades();
    unbindFades = () => {};
    painter = null;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="gallery-back">${icon("arrow-left")}<span>Back</span></button>
        <h1 class="title">Characters</h1>
      </header>

      <main class="gallery-body">
        ${
          open
            ? page(open)
            : `<nav class="mastery-tabs gallery-filters">
                 <button class="btn mastery-tab ${filter === "all" ? "active" : ""}" data-faction="all">Everyone</button>
                 ${factions
                   .map(
                     (faction) =>
                       `<button class="btn mastery-tab ${filter === faction.id ? "active" : ""}" data-faction="${esc(faction.id)}">
                          ${esc(faction.name)}
                        </button>`
                   )
                   .join("")}
               </nav>
               <div class="hb-scrollwrap hb-fade-top" id="gallery-wrap">
                 <ul class="gallery-grid hb-scroll" id="gallery-grid"></ul>
               </div>
               ${total > shown.length ? `<p class="muted gallery-note">Showing ${shown.length} of ${total} — pick a faction to see the rest.</p>` : ""}`
        }
      </main>`;

    if (!open) {
      const grid = root.querySelector<HTMLElement>("#gallery-grid");
      const wrap = root.querySelector<HTMLElement>("#gallery-wrap");
      if (grid) {
        painter = lazyPaint(grid, "500px 0px");
        const columns = 7;
        for (const [index, card] of shown.entries()) {
          const item = buildTile(card);
          /* the diagonal wave the collection uses, so the two grids in the same
             domain arrive the same way */
          const tile = item.firstElementChild as HTMLElement | null;
          if (tile) {
            const wave = Math.floor(index / columns) + (index % columns);
            tile.style.setProperty(
              "--enter-delay",
              motionEnabled() ? `${Math.min(420, wave * 34)}ms` : "0ms"
            );
          }
          grid.appendChild(item);
        }
        if (wrap) unbindFades = bindScrollFades(wrap, grid);
      }
    }

    if (open) {
      // the portrait and the card strip are canvases, so they are drawn rather
      // than templated — the same renderer the board and the collection use
      const portrait = root.querySelector("#gallery-portrait");
      if (portrait) portrait.appendChild(renderCardToCanvas(open, 260));
      const strip = root.querySelector("#gallery-strip");
      if (strip) {
        const featuring = [open, ...Object.values(content.cards).filter((entry) => entry.variantOf === open.id)];
        for (const card of featuring) strip.appendChild(renderCardToCanvas(card, 150));
      }
      root.querySelector("#gallery-close")?.addEventListener("click", () => {
        openId = null;
        audio.play("sfx.ui.click");
        render();
      });
      root.querySelector("#gallery-collection")?.addEventListener("click", () => callbacks.onCollection());
      root.querySelector("#gallery-mastery")?.addEventListener("click", () => callbacks.onMastery());
    }

    root.querySelector("#gallery-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    for (const button of root.querySelectorAll<HTMLElement>(".gallery-filters .mastery-tab")) {
      button.addEventListener("click", () => {
        filter = button.dataset["faction"] ?? "all";
        audio.play("sfx.ui.hover");
        render();
      });
    }
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundGallery?: unknown }).hypeboundGallery = {
    count: () => cast().length,
    open: (id: string) => {
      openId = id;
      render();
      return Boolean(root.querySelector(".gallery-page"));
    },
    close: () => {
      openId = null;
      render();
    },
    show: (factionId: string) => {
      filter = factionId;
      openId = null;
      render();
      return root.querySelectorAll(".gallery-tile").length;
    },
  };

  return {
    root,
    dispose: () => {
      painter?.stop();
      unbindFades();
      delete (window as unknown as { hypeboundGallery?: unknown }).hypeboundGallery;
    },
  };
}
