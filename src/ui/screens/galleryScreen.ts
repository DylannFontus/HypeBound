/**
 * The character gallery — `03-screens-and-navigation.md` §4.3.3.
 *
 * *"The cast browser: leaders and named characters as characters, not cards."*
 * The collection screen already shows every card; this shows the people, which
 * is a different question — who they are, what you have done with them, and what
 * has been written about them.
 *
 * ## What this screen was, and why it is a room now
 *
 * It was the only route in the game the material census scored at **zero**: 294
 * elements over 120×60 and not one of them wearing one of the foundation's four
 * materials. What it had instead was a hand-rolled bevel copied onto a photo
 * tile, and eight columns of those tiles running edge to edge with nothing
 * around them — a contact sheet, one click from a Collection whose cards carry
 * rarity frames, bevels, shelves and contact shadows. Measured with
 * `_w7gal_env.mjs`: sixteen of the gallery's seventeen running idle animations
 * belonged to `atmosphere.ts` — i.e. to the layer *every* route gets for free —
 * and the screen itself contributed one. The lobby contributes nineteen. A
 * screen with no materials has no specular crawl, because the crawl lives on the
 * material, so "mat = 0" and "the deadest screen in the product" were the same
 * fact stated twice.
 *
 * Three changes answer it, and they are all composition rather than skin:
 *
 *  - **The portraits are framed.** A tile is a `.mat-panel` with a `.mat-well`
 *    mount cut into it and the name on a plate *below* the picture, the way a
 *    gallery labels a painting — not scrimmed over the sitter's chin. The
 *    faction colour is the lit edge of that label rather than a stripe across
 *    the photograph.
 *  - **The wall is shelved.** One shelf per faction, each with its own crest,
 *    rule and count, on a lit plane the tiles stand on. Ninety faces in one
 *    undifferentiated grid is a contact sheet whatever material the tiles wear;
 *    eleven named groups is a cast. It also retires the old "Showing 90 of 138 —
 *    pick a faction to see the rest", which was an apology for the missing
 *    composition rather than a feature.
 *  - **There are two columns and a room behind them.** A roster rail on the left
 *    carries the factions, their counts and how much of the cast you have met;
 *    the shelves take the rest. `.ambient-bg` is gone — it painted an *opaque*
 *    plate at `z-index: -1` directly in front of `atmosphere.ts`'s persistent
 *    world, so the gallery had two depth planes where §2 asks for four. What
 *    replaced it is `.gal-room`: faction-tinted light and a vignette, all
 *    translucent, so the drifting grid, the motes and the specular crawl of the
 *    world show through. The lobby made exactly this trade and it is why the
 *    lobby reads as a place.
 *
 * ## Why the styling lives in this file
 *
 * The gallery's rules used to be a `.gal-v2` block inside `collectionKit.ts`,
 * which belongs to another owner. There is no way to restyle a screen you own
 * from a stylesheet you do not, so the scope moved to `.gal-v3` and the rules
 * came with it. The kit's *primitives* are still imported and still shared — the
 * lazy painter, the portrait crop, the scroll fades, the escaping — because
 * those are behaviour rather than appearance. The stale `.gal-v2` gallery block
 * in the kit no longer matches anything and can be deleted by whoever owns that
 * file next.
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
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { DUR, motionEnabled, tickerTo } from "../motion";
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

/** The portrait box. 3:4, so every row's baselines agree whatever the name does. */
const TILE_W = 168;
const TILE_H = 224;

/**
 * Run `then` on the frame the shell's cover leaves — or now, if there is none.
 *
 * The gallery is the most expensive route in the game to build and it has one
 * scheduling question: when may it start rasterising portraits? Too early and it
 * steals the frames `shell.ts` is watching for before it lifts its cover; too
 * late and the player looks at a wall of empty frames for two seconds. Both of
 * those have been measured on this screen, in that order.
 *
 * The answer is not a duration, because the event is visible: `.nav-curtain` is
 * the cover, `shell.ts` puts it in the document and takes it out again, and a
 * `MutationObserver` on the body's child list sees it go for the cost of one
 * callback per navigation. The caller keeps its own long hold as the ceiling, so
 * a route that arrives with no cover at all — a reload straight onto #gallery,
 * or a build where the cover is skipped — is never left waiting on an event that
 * is not coming.
 */
function whenRevealed(then: () => void): void {
  if (typeof MutationObserver !== "function" || typeof document === "undefined") {
    then();
    return;
  }
  if (!document.querySelector(".nav-curtain")) {
    then();
    return;
  }
  const observer = new MutationObserver(() => {
    if (document.querySelector(".nav-curtain")) return;
    observer.disconnect();
    then();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * How many tiles share one phase of the specular crawl before it repeats.
 *
 * The band's period is `--dur-sheen-panel`, 8.6s. Fourteen phases at 260ms of
 * offset each covers 3.6s of that, which is enough that no two tiles in a row
 * are ever lit together and small enough that a shelf is never entirely dark.
 */
const PHASES = 14;

/** A faction's worth of the cast, which is what a shelf holds. */
interface Shelf {
  id: string;
  name: string;
  colour: string;
  cards: CardDef[];
  seen: number;
}

export function createGalleryScreen(content: ContentIndex, callbacks: GalleryCallbacks): Screen {
  installKitStyles();
  installGalleryStyles();

  const root = document.createElement("div");
  root.className = "screen gallery-screen gal-v3";

  /** "all", or a faction id */
  let filter = "all";
  /** the character whose page is open, or null for the grid */
  let openId: string | null = null;
  /**
   * A hundred and thirty-eight portraits is a hundred and thirty-eight canvases,
   * and at most about twenty-eight are on screen. They are painted as they come
   * near the fold and never again.
   */
  let painter: ReturnType<typeof lazyPaint> | null = null;
  let unbindFades: () => void = () => {};
  /**
   * Which tiles are close enough to the fold to be worth animating.
   *
   * The specular crawl is what makes a material alive at rest, and it is also a
   * promoted compositor layer per plate. A hundred and thirty-eight of them on a
   * screen that shows twenty-eight is a hundred and ten layers of light nobody
   * can see, which is the sort of thing that costs the 30fps floor on the low
   * tier and buys nothing anywhere. So the crawl is granted by an observer on
   * the scroller and withdrawn when a tile leaves it.
   */
  let alive: IntersectionObserver | null = null;
  /** The measured tile width, reset whenever the grid is rebuilt. */
  let portraitW = 0;
  /** The cast tally counts up once, on arrival, not on every filter change. */
  let counted = false;
  /** Torn down with the screen: the decoder warmer and the swap watcher. */
  let unwatchArt: () => void = () => {};

  /**
   * Get a shelf's paintings decoding *before* anything asks to draw one.
   *
   * This is the whole of the fix for the fold sitting empty, and the reason is
   * that a PNG costs twice. `artLoader` starts the download and sets
   * `decoding = "async"`, which means the bitmap is **not** decoded when `load`
   * fires — it is decoded the first time somebody calls `drawImage` with it, on
   * whichever thread that call is on, which is the main one. So the first paint
   * of every tile was a download's worth of latency followed by a full decode
   * inside `lazyPaint`'s six-millisecond budget, and the budget's response to a
   * card that overran was to rest two frames before trying the next one.
   *
   * `HTMLImageElement.decode()` is the browser's own answer to exactly this: it
   * resolves once a decoded frame exists, and it does the work off the main
   * thread. Called here, at the moment a shelf is built and long before its
   * tiles come near the fold, every subsequent `drawImage` is a blit.
   *
   * Per shelf rather than for the whole cast, because the cast is 138 paintings
   * and firing all of them at once puts the fold's eleven behind a hundred and
   * twenty-seven others in the connection queue — the same ordering mistake
   * `lazyPaint` documents about FIFO, one layer down.
   */
  const warmShelf = (shelf: Shelf): void => {
    for (const card of shelf.cards) {
      const art = getCardArt(card);
      /* Already loaded: decode it now. Not yet: `onArtLoaded` below catches it
         when it lands, which is the same call a beat later. */
      void art?.decode?.().catch(() => {});
    }
  };

  /** Every tile on the wall right now, by card id, for the swap watcher below. */
  const tiles = new Map<string, { tile: HTMLElement; card: CardDef }>();

  /**
   * A painting that arrives *after* its tile was drawn, and how it arrives.
   *
   * `portraitCanvas` draws the renderer's procedural placeholder when the PNG is
   * not loaded yet, registers for `onArtLoaded`, and then repaints **the same
   * canvas in place** when it lands. That repaint is a hard cut: measured on the
   * gallery's own fold, one of nineteen tiles went from an "art pending" field
   * to a finished painting between two frames with nothing between them. §7 does
   * not have an exemption for a picture.
   *
   * Two things happen here, on one listener:
   *
   * 1. **The decode is warmed.** `load` fires before a `decoding: "async"` image
   *    has a decoded frame, so this is the same call `warmShelf` makes, for the
   *    cards that were still in flight when their shelf was built.
   * 2. **The swap gets an entrance**, on the *next* frame rather than this one.
   *    The ordering is deliberate and it is the only subtle part: this listener
   *    is registered when the screen is built and `portraitCanvas`'s is
   *    registered when a tile is painted, so this one runs first — before the
   *    repaint it is meant to be introducing. A frame later the new pixels are
   *    on the canvas and the animation plays over them.
   *
   * It never fades from zero. There is a recess behind the canvas, so a fade
   * from nothing would show the empty mount in the middle of a swap and read as
   * the picture leaving and a different one arriving. It dissolves from just
   * under half instead, which is a picture changing its mind.
   */
  unwatchArt = onArtLoaded((cardId) => {
    const entry = tiles.get(cardId);
    if (!entry) return;
    void getCardArt(entry.card)?.decode?.().catch(() => {});
    if (!motionEnabled()) return;
    requestAnimationFrame(() => {
      const canvas = entry.tile.querySelector<HTMLCanvasElement>("canvas");
      if (!canvas?.isConnected) return;
      canvas.classList.remove("gal-art-swap");
      /* Two frames, not one: removing and re-adding a class inside a single
         frame is coalesced by the style engine and the animation never
         restarts. */
      requestAnimationFrame(() => canvas.classList.add("gal-art-swap"));
    });
  });

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

  /** A leader is always known; anything else has to be in the collection. */
  const isSeen = (card: CardDef): boolean =>
    leaderIds.has(card.id) || (getProfile().collection[card.id] ?? 0) > 0;

  /**
   * The cast, cut into shelves.
   *
   * Faction order comes from the content index rather than from the sort, so the
   * rail and the shelves agree; anything whose faction is not a listed one — the
   * neutral pool — falls into a trailing shelf rather than vanishing, which is
   * the failure a `filter()` here would have hidden.
   */
  const shelves = (everyone: CardDef[]): Shelf[] => {
    const out: Shelf[] = [];
    const placed = new Set<string>();
    for (const faction of factions) {
      const cards = everyone.filter((card) => card.faction === faction.id);
      if (cards.length === 0) continue;
      for (const card of cards) placed.add(card.id);
      out.push({
        id: faction.id,
        name: faction.name,
        colour: colorOf(faction.id),
        cards,
        seen: cards.filter(isSeen).length,
      });
    }
    const rest = everyone.filter((card) => !placed.has(card.id));
    if (rest.length > 0) {
      out.push({
        id: "neutral",
        name: content.factions["neutral" as FactionId]?.name ?? "Unaligned",
        colour: colorOf("neutral"),
        cards: rest,
        seen: rest.filter(isSeen).length,
      });
    }
    return out;
  };

  /**
   * A cast tile: a framed portrait with its name on the frame.
   *
   * It used to be a coloured capital letter in a near-black rectangle with a 1px
   * border and a 3px stripe — the Gmail-contacts convention, which is an admin
   * dashboard pattern and not a character gallery. Then it became an unframed
   * photograph with the name scrimmed across the sitter's chin, which is a
   * contact sheet. It is a framed object now: `.mat-panel` for the frame,
   * `.mat-well` for the mount the picture is recessed into, `.act` for the six
   * interaction states, and a label plate along the bottom whose top edge is lit
   * in the faction's colour. Composition, per the foundation contract — a
   * builder who hand-rolls their own bevel has broken it even if the bevel is
   * prettier, and the bevel this replaces was hand-rolled.
   */
  const buildTile = (card: CardDef, phase: number): HTMLElement => {
    const seen = isSeen(card);
    const isLeader = leaderIds.has(card.id);

    const item = document.createElement("li");
    item.className = "gallery-cell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `gal-tile mat-panel act r-tile${seen ? "" : " unseen"}`;
    button.dataset["id"] = card.id;
    button.style.setProperty("--c", colorOf(card.faction));
    button.style.setProperty("--gal-phase", String(phase % PHASES));
    button.setAttribute(
      "aria-label",
      `${card.name}, ${isLeader ? "leader" : content.currents[card.current]?.name ?? card.current}, ${
        content.factions[card.faction as FactionId]?.name ?? card.faction
      }${seen ? "" : " — not yet seen"}`
    );

    /*
     * The mount is the containing block for everything that sits *on* the
     * picture — the crest, the pending mark, the padlock — so those marks travel
     * with the recess rather than with the frame, and none of them can end up
     * over the label.
     */
    const mount = document.createElement("span");
    mount.className = "gal-mount mat-well";
    /*
     * There is no sleeve element under the picture. The mount *is* the sleeve —
     * a recess with a shaded floor is exactly what an empty frame looks like —
     * and one span per tile is a hundred and thirty-eight nodes on a screen whose
     * mount cost is already the longest task on any menu route.
     */
    mount.insertAdjacentHTML(
      "beforeend",
      `<span class="gal-tile-crest">${icon(CURRENT_SIGIL[card.current], { size: 13 })}</span>` +
        `<span class="gal-tile-pending" aria-hidden="true">Art pending</span>` +
        (seen ? "" : `<span class="gal-tile-locked">${icon("lock", { size: 12, label: "Not yet seen" })}</span>`)
    );
    button.appendChild(mount);

    button.insertAdjacentHTML(
      "beforeend",
      `<span class="gal-tile-body">` +
        `<span class="gal-tile-name">${esc(card.name)}</span>` +
        `<span class="gal-tile-role">${isLeader ? "Leader" : esc(content.currents[card.current]?.name ?? card.current)}</span>` +
        `</span>`
    );

    button.addEventListener("click", () => {
      openId = card.id;
      audio.play("sfx.ui.click");
      render();
    });
    button.addEventListener("pointerenter", () => audio.play("sfx.ui.hover"));

    tiles.set(card.id, { tile: button, card });

    painter?.watch(button, () => {
      /*
       * Measured once per grid, not once per tile: reading `clientWidth` from
       * inside the paint loop is a forced reflow of the whole grid for every
       * face. The mount is what is measured, not the button, because the frame
       * has padding and a picture drawn at the frame's width would be six pixels
       * too wide and cropped by the mount's own overflow.
       */
      if (portraitW === 0) portraitW = Math.max(64, Math.round(mount.clientWidth) || TILE_W);
      const canvas = portraitCanvas(card, portraitW, Math.round((portraitW * TILE_H) / TILE_W), {
        /*
         * No painted scrim. The name is on the frame now, so the gradient that
         * used to sit under it is a quarter of the picture darkened for a label
         * that is no longer there.
         */
        scrim: false,
        /**
         * A face nobody has painted yet says so, in the screen's own type.
         *
         * §10 is explicit that the art gap is a schedule and not a defect, and
         * that the *worse* mistake is hiding it: a tile that quietly shows an
         * abstract field reads as "this one is broken", while a tile that names
         * the state reads as "this one is coming". The card renderer already
         * stamps its own watermark above 300px of render width and a 168px
         * gallery tile is well under it, so without this the gallery is the one
         * place in the game where the state has no name.
         */
        onArt: (painted) => button.classList.toggle("no-art", !painted),
      });
      /*
       * The bitmap keeps its device-pixel size and gives up its CSS one. The
       * renderer writes an inline `width` in pixels, which beats any stylesheet,
       * so a column that changed width after the paint left a hairline of mount
       * showing down one side of every portrait in the row.
       */
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      /* First child, so the crest, the pending mark and the padlock — which are
         positioned and therefore paint above it whatever the source order —
         stay on top of the picture rather than under it. */
      mount.prepend(canvas);
    });

    item.appendChild(button);
    return item;
  };

  /** One faction's shelf: a header that names it, and the plane its cast stands on. */
  const buildShelf = (shelf: Shelf): HTMLElement => {
    const section = document.createElement("section");
    section.className = "gal-shelf";
    section.dataset["faction"] = shelf.id;
    section.style.setProperty("--c", shelf.colour);
    section.setAttribute("aria-label", shelf.name);

    section.innerHTML =
      `<div class="gal-shelf-head">` +
      `<span class="gal-shelf-gem" aria-hidden="true"></span>` +
      `<span class="gal-shelf-title t-label">${esc(shelf.name)}</span>` +
      `<span class="gal-shelf-rule" aria-hidden="true"></span>` +
      `<span class="gal-shelf-count num">${shelf.seen}/${shelf.cards.length}</span>` +
      `</div>`;

    const grid = document.createElement("ul");
    grid.className = "gallery-grid mat-panel";
    section.appendChild(grid);

    /* The diagonal wave the collection uses, so the two grids in the same domain
       arrive the same way — and per shelf rather than per screen, or the eleventh
       faction would be four seconds late to its own entrance. */
    const columns = 6;
    for (const [index, card] of shelf.cards.entries()) {
      const item = buildTile(card, index);
      const tile = item.firstElementChild as HTMLElement | null;
      if (tile) {
        const wave = Math.floor(index / columns) + (index % columns);
        tile.style.setProperty("--enter-delay", motionEnabled() ? `${Math.min(420, wave * 34)}ms` : "0ms");
      }
      grid.appendChild(item);
    }
    return section;
  };

  /** Put one shelf on the wall and hand its tiles to the two observers. */
  const appendShelf = (scroll: HTMLElement, shelf: Shelf, index: number): void => {
    warmShelf(shelf);
    const section = buildShelf(shelf);
    /* the shelves arrive in reading order, and the same index de-phases each
       shelf's own specular crawl from its neighbour's */
    section.style.setProperty("--cascade-i", String(Math.min(7, index)));
    scroll.appendChild(section);
    for (const tile of section.querySelectorAll<HTMLElement>(".gal-tile")) alive?.observe(tile);
  };

  /**
   * The rest of the wall, one shelf per frame — and not until the room is calm.
   *
   * ## The measurement this shape came out of
   *
   * `shell.ts` veils every navigation into a `heavy` route and parts the veil on
   * the first **two consecutive rAF frames inside 34ms**, giving up after 1,100ms.
   * Measured with `_w7gal_heavy.mjs`, which watches `.nav-curtain` directly:
   *
   *     #deckbuilder   cover 529ms
   *     #uikit         cover 570ms
   *     #collection    cover 517ms
   *     #gallery       cover 1,683ms      ← the ceiling, not a reveal
   *
   * The gallery was the only heavy route that never went calm, so it was the only
   * one whose cover was a timeout rather than a decision. Two things it was *not*:
   * holding the lazy painter for a full two seconds moved the number by 200ms, and
   * spreading the build over more frames made it worse. What it was is the sheer
   * count — with ten of the eleven shelves left unbuilt the same probe read
   * **723ms**, so a hundred and twenty-seven extra `.mat-panel` tiles, each with a
   * `.mat-well` mount inside it, is about a second of style and paint that the
   * shell was politely waiting through.
   *
   * ## So the wall waits for the same signal the shell does
   *
   * The fold holds one shelf. That one is built in the factory; the other ten
   * start only once the page has produced two on-time frames of its own, by the
   * same 34ms rule and with the same kind of ceiling, so the reveal happens on a
   * cheap screen and the rest of the cast arrives underneath it while the player
   * is reading the first faction. Nothing they are looking at moves — a scroller
   * grows downwards — and §3a gets what it actually asked for, which is contents
   * arriving in reading order rather than a screen that was finished before the
   * curtain went up.
   *
   * `flushBuild` exists because the automation hook is synchronous: `show()`
   * returns a tile count, and a caller that got eleven because the other hundred
   * and twenty-seven had not been built yet would be reading a stopwatch rather
   * than a roster. Anything that needs the whole wall asks for it and pays the
   * cost it was avoiding.
   */
  const QUIET_MS = 34;
  const QUIET_CEILING_MS = 1200;
  let buildQueue: Array<() => void> = [];
  let buildHandle = 0;
  const stopBuild = (): void => {
    if (buildHandle) cancelAnimationFrame(buildHandle);
    buildHandle = 0;
    buildQueue = [];
  };
  const pumpBuild = (): void => {
    if (buildQueue.length === 0) {
      buildHandle = 0;
      return;
    }
    buildHandle = requestAnimationFrame(() => {
      buildQueue.shift()?.();
      pumpBuild();
    });
  };
  /**
   * Five on-time frames in a row, or the ceiling — then start pumping.
   *
   * Five rather than the shell's two, and the difference is the whole point: both
   * are watching the same signal and only one of them can be allowed to act on it
   * first. At two, the wall started building on the same frame the shell decided
   * to reveal, took the thread back, and the cover measured 935ms — better than
   * the 1,683 it was, and still three hundred over the other heavy routes. Three
   * more frames of patience is fifty milliseconds and it hands the race to the
   * reveal every time.
   */
  const buildWhenCalm = (): void => {
    const clock = (): number => (typeof performance === "object" ? performance.now() : Date.now());
    const deadline = clock() + QUIET_CEILING_MS;
    let previous = clock();
    let calm = 0;
    const step = (): void => {
      const stamp = clock();
      calm = stamp - previous <= QUIET_MS ? calm + 1 : 0;
      previous = stamp;
      if (calm >= 5 || stamp >= deadline) {
        pumpBuild();
        return;
      }
      buildHandle = requestAnimationFrame(step);
    };
    buildHandle = requestAnimationFrame(step);
  };
  const flushBuild = (): void => {
    if (buildHandle) cancelAnimationFrame(buildHandle);
    buildHandle = 0;
    while (buildQueue.length) buildQueue.shift()?.();
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
      <section class="gallery-page mat-panel" data-character="${esc(card.id)}" style="--c:${esc(colorOf(card.faction))}">
        <div class="gallery-page-head">
          <button class="btn btn-ghost" id="gallery-close">${icon("arrow-left")}<span>All characters</span></button>
          <h2 class="gallery-page-title">${esc(card.name)}</h2>
          <span class="muted">${esc(faction?.name ?? card.faction)} · ${esc(content.currents[card.current]?.name ?? card.current)}</span>
        </div>

        <div class="gallery-page-body">
          <!--
            The card stands in a recess rather than floating in a flex row. It is
            the one object on this page the player already knows by sight, so it
            gets a plinth: .mat-well is the foundation's recess and the badges
            share it, which is what makes the left column read as one exhibit
            instead of as a picture with three pills under it.
          -->
          <div class="gal-plinth mat-well">
            <div class="gallery-portrait" id="gallery-portrait"></div>
            <div class="gal-badges">
              <span class="gal-badge mat-chip chip-static" style="--c:${esc(colorOf(card.faction))}">${esc(faction?.name ?? card.faction)}</span>
              <span class="gal-badge mat-chip chip-static">${esc(content.currents[card.current]?.name ?? card.current)}</span>
              <span class="gal-badge mat-chip chip-static">${isLeader ? "Leader" : esc(card.rarity)}</span>
            </div>
          </div>

          <!--
            The story reads at a measure and stops. Everything a paragraph is not
            — the tracks, the cards, the actions — belongs in the dossier beside
            it, because 74ch of prose in a 1,100px column leaves 500px of empty
            plate, which is the exact shape the integration review named.
          -->
          <div class="gallery-page-text hb-scroll">
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
              chapter && chapter.written
                ? `<h3 class="profile-section-title">${esc(chapter.title)}</h3>${chapter.body
                    .map((p) => `<p class="gallery-prose">${esc(p)}</p>`)
                    .join("")}`
                : ""
            }
          </div>

          <div class="gal-dossier hb-scroll">
            ${
              track
                ? `<div class="gallery-track gal-card mat-panel r-tile">
                     <h4>Leader Mastery — level ${track.rank}</h4>
                     <div class="gal-track-bar mat-well"><span class="well-fill" style="width:${track.maxed ? 100 : Math.min(100, (track.intoRank / Math.max(1, track.toNext)) * 100)}%"></span></div>
                     <p class="muted">${track.maxed ? "Mastered." : `${track.toNext - track.intoRank} XP to level ${track.rank + 1}.`}</p>
                   </div>`
                : ""
            }
            ${
              affinity
                ? `<div class="gallery-track gal-card mat-panel r-tile">
                     <h4>Affinity — ${affinity.ap} AP${affinity.tierName ? ` · ${esc(affinity.tierName)}` : ""}</h4>
                     <div class="gal-track-bar mat-well"><span class="well-fill" style="width:${affinity.nextAt > 0 ? Math.min(100, (affinity.ap / affinity.nextAt) * 100) : 100}%"></span></div>
                     <p class="muted">${affinity.nextAt > 0 ? `${affinity.nextAt - affinity.ap} AP to the next tier.` : "Parasocial — the top tier."}</p>
                   </div>`
                : ""
            }

            <div class="gallery-featuring gal-card mat-panel r-tile">
              <h4>Cards${featuring.length > 1 ? ` (${featuring.length})` : ""}</h4>
              <div class="gallery-card-strip" id="gallery-strip"></div>
            </div>

            <div class="stats-actions">
              <button class="btn btn-ghost" id="gallery-collection"><span>Find in Collection</span>${icon("chevron-right", { size: 15 })}</button>
              ${isLeader ? `<button class="btn btn-ghost" id="gallery-mastery"><span>Mastery track</span>${icon("chevron-right", { size: 15 })}</button>` : ""}
            </div>

            <p class="muted gallery-missing">
              Alternate art, skins and voice lines are not here: card art is procedural and keyed by
              card id, and every audio slot is still empty. They will appear when those systems do.
            </p>
          </div>
        </div>
      </section>`;
  };

  /**
   * One line of the roster: a crest, a name, a count, and how much of that
   * faction you have actually met.
   *
   * The meter is not decoration and it is not there to fill the rail either —
   * "who have I met" is the question this whole screen exists to answer, and
   * before it existed the rail could only answer it for the cast as a whole.
   * It also gives twelve rows a reason to be 44px rather than 30, which is the
   * touch floor anyway and which is what makes the column read as a roster
   * rather than as a list of links.
   */
  const rosterRow = (id: string, name: string, colour: string, seen: number, total: number): string => {
    const pct = total > 0 ? Math.round((seen / total) * 100) : 0;
    return `<button class="gal-fac${filter === id ? " active" : ""}" data-faction="${esc(id)}"
              style="--c:${esc(colour)}" aria-pressed="${filter === id}">
              <span class="gal-fac-gem" aria-hidden="true"></span>
              <span class="gal-fac-body">
                <span class="gal-fac-line">
                  <span class="gal-fac-name">${esc(name)}</span>
                  <span class="gal-fac-count num">${seen}<span class="gal-fac-of">/${total}</span></span>
                </span>
                <span class="gal-fac-track mat-well"><span class="well-fill" style="width:${pct}%"></span></span>
              </span>
            </button>`;
  };

  const render = (): void => {
    const everyone = cast();
    const open = openId ? everyone.find((card) => card.id === openId) : undefined;
    const racks = shelves(everyone);
    const met = racks.reduce((sum, shelf) => sum + shelf.seen, 0);
    const shown = open ? [] : filter === "all" ? racks : racks.filter((shelf) => shelf.id === filter);

    stopBuild();
    painter?.stop();
    unbindFades();
    unbindFades = () => {};
    painter = null;
    alive?.disconnect();
    alive = null;
    portraitW = 0;
    /* The wall is about to be rebuilt from scratch, so every entry in here is a
       reference to a detached button. The swap watcher keys off this map, which
       is what stops it animating a tile nobody can see. */
    tiles.clear();

    /*
     * Each faction is a different room in one continuous place. The accent is a
     * single custom property and every tinted surface on the screen reads it —
     * the room's own light, the rail's active row, the shelf gem — so §6's "one
     * hero accent per screen" survives a filter change rather than being eleven
     * accents at once.
     */
    root.style.setProperty(
      "--gal-accent",
      filter === "all" || open ? "var(--accent)" : colorOf(filter)
    );

    root.innerHTML = `
      <div class="gal-room" aria-hidden="true"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="gallery-back">${icon("arrow-left")}<span>Back</span></button>
        <h1 class="title">Characters</h1>
        <div class="gal-tally">
          ${icon("profile", { size: 14 })}
          <span class="num" id="gal-met">${met}</span>
          <span class="gal-tally-sep">of</span>
          <span class="num">${everyone.length}</span>
          <span class="gal-tally-word">met</span>
        </div>
      </header>

      <main class="gallery-body${open ? " is-open" : ""}">
        ${
          open
            ? page(open)
            : `<aside class="gal-rail mat-panel">
                 <div class="gal-rail-head">
                   ${icon("collection", { size: 15 })}
                   <span class="t-label">The cast</span>
                   <span class="gal-rail-count mat-chip chip-static num">${everyone.length}</span>
                 </div>
                 <div class="hb-scrollwrap hb-fade-top" id="gal-rail-wrap">
                   <nav class="gal-rail-scroll hb-scroll" id="gal-rail-scroll" aria-label="Filter the cast by faction">
                     ${rosterRow("all", "Everyone", "var(--accent)", met, everyone.length)}
                     ${racks
                       .map((shelf) => rosterRow(shelf.id, shelf.name, shelf.colour, shelf.seen, shelf.cards.length))
                       .join("")}
                   </nav>
                 </div>
                 <div class="gal-rail-foot">
                   <span class="t-label">Met</span>
                   <div class="gal-met-track mat-well">
                     <span class="well-fill" style="width:${everyone.length ? Math.round((met / everyone.length) * 100) : 0}%"></span>
                   </div>
                   <span class="num gal-met-pct">${everyone.length ? Math.round((met / everyone.length) * 100) : 0}%</span>
                 </div>
               </aside>

               <div class="gal-main">
                 <div class="hb-scrollwrap hb-fade-top" id="gallery-wrap">
                   <div class="gal-scroll hb-scroll" id="gallery-scroll"></div>
                 </div>
               </div>`
        }
      </main>`;

    if (!open) {
      const scroll = root.querySelector<HTMLElement>("#gallery-scroll");
      const wrap = root.querySelector<HTMLElement>("#gallery-wrap");
      if (scroll) {
        painter = lazyPaint(scroll, "500px 0px");
        /*
         * Nothing is rasterised until the screen has arrived.
         *
         * `shell.ts` holds its cover until the main thread produces two calm
         * frames, and gives up after `REVEAL_PATIENCE_MS` — 1,100ms. A hundred
         * and thirty-eight portraits queued from the moment the tree is inserted
         * never let it go calm, so the cover was reaching its ceiling and the
         * player spent a second and a half on a title card. Measured on film:
         * still veiled at 1,189ms, against the collection's reveal at about 600.
         *
         * ## Why the hold is now 420ms and not 1,800
         *
         * Because it bought the cover's freedom with the fold's. Measured with
         * `_w8rw_probe.mjs gallery`, which counts drawn canvases every 200ms
         * against the tiles actually in the viewport: **nineteen empty mounts
         * until 2,193ms**, the first picture at 2,193 and the last at 2,870. The
         * hold was `DUR.ui + 1800` = 2,060, and the fold filling at 2,193 is that
         * number plus one drain. A designed empty state is the right thing to
         * show for a beat; it is not the right thing to show for two seconds,
         * and §3a's "nothing appears without an entrance" is not satisfied by
         * making the wait long enough that the arrival counts as a separate
         * event.
         *
         * The reason the hold had to be that long was the cost of a first paint,
         * and `warmShelf` above has taken the decode out of it.
         *
         * ## And why the number is not a number
         *
         * The obvious replacement was a shorter constant, and it was measured
         * and rejected: at `DUR.ui + 420` the fold filled by 1,177ms — but
         * `_w7gal_heavy.mjs` put the cover at 511, 558, 655, 967 and 1,000ms
         * across five runs, against a steady 539 before. That is the same trade
         * the long hold made, paid the other way round. Nothing had gone wrong
         * with the paints; they had simply moved inside the window where the
         * shell is watching for two calm frames, and every run where a
         * placeholder card landed in that window lost the race.
         *
         * A guess cannot win here because the thing being waited for is
         * observable. `.nav-curtain` is the cover, it is in the document, and it
         * is removed when the reveal happens — so the hold is long, and
         * `whenRevealed` cancels it on the frame the cover actually leaves. The
         * long constant stays as the ceiling for the case where there is no
         * cover to watch.
         */
        painter.hold(DUR.ui + 1800);
        whenRevealed(() => painter?.hold(0));
        alive = grantIdleLight(scroll, root);
        /*
         * The first shelf is built now; the other ten are built one per frame.
         *
         * Measured with `_w3nav_cost.mjs`: building all eleven in the factory put
         * a **417ms long task** on `lobby → gallery` and left the page eleven rAF
         * frames in the following 1.6 seconds, which the shell then covered with
         * a title card for a whole second — over the 260–420ms §3a allows for
         * routine navigation, and the worst mount on any menu route. A shelf is
         * about 150ms of that; the fold holds one and a half of them.
         *
         * Chunking is not only cheaper, it is what §3a asks for anyway: the
         * contents arrive in reading order instead of all at once, each shelf
         * running its own diagonal wave as it lands. The player is at the top of
         * a scroller that grows below them, so nothing they are looking at moves.
         */
        const first = shown[0];
        if (first) appendShelf(scroll, first, 0);
        buildQueue = shown.slice(1).map((shelf, i) => () => appendShelf(scroll, shelf, i + 1));
        buildWhenCalm();
        if (wrap) unbindFades = bindScrollFades(wrap, scroll);
      }
      /* §3a: numbers count up rather than print — but once, on arrival, not
         every time somebody picks a faction. */
      const tally = root.querySelector<HTMLElement>("#gal-met");
      if (tally && !counted && motionEnabled()) {
        counted = true;
        tally.textContent = "0";
        tickerTo(tally, met);
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
    for (const button of root.querySelectorAll<HTMLElement>(".gal-fac")) {
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
      /* same reason as `show()`: a caller that goes back to the wall and counts
         it must see the wall, not the first frame of it */
      flushBuild();
    },
    show: (factionId: string) => {
      filter = factionId;
      openId = null;
      render();
      /* the wall is built a shelf a frame; a caller asking for the count is
         asking for the whole wall, so it gets built now rather than counted early */
      flushBuild();
      return root.querySelectorAll(".gal-tile").length;
    },
  };

  return {
    root,
    dispose: () => {
      stopBuild();
      painter?.stop();
      unbindFades();
      unwatchArt();
      tiles.clear();
      alive?.disconnect();
      alive = null;
      delete (window as unknown as { hypeboundGallery?: unknown }).hypeboundGallery;
    },
  };
}

/**
 * Hand the specular crawl to the tiles that are actually on screen.
 *
 * `.is-alive` is the switch; the CSS below gates the animation on it *and* on
 * the two settings that must always be able to turn it off. Reduced motion and
 * the low graphics tier are checked here as well as in the stylesheet, because a
 * class that is never added is cheaper than a rule that is never matched — with
 * a hundred and thirty-eight tiles, that is a hundred and thirty-eight
 * observations that never have to happen.
 */
function grantIdleLight(scroller: HTMLElement, root: HTMLElement): IntersectionObserver | null {
  if (typeof IntersectionObserver !== "function") return null;
  if (!motionEnabled()) return null;
  const doc = root.ownerDocument?.documentElement;
  if (doc?.dataset["gfxTier"] === "low") return null;
  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) entry.target.classList.toggle("is-alive", entry.isIntersecting);
    },
    { root: scroller, rootMargin: "120px 0px" }
  );
}

// ---------------------------------------------------------------------------
// the stylesheet
// ---------------------------------------------------------------------------

const STYLE_ID = "hb-gallery-room";

function installGalleryStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = GALLERY_CSS;
  document.head.appendChild(style);
}

/**
 * Scoped to `.gal-v3`, which is one class more than the legacy `.gallery-*`
 * rules in `theme/screens.css` carry and therefore beats them on specificity
 * rather than on source order. That matters: `screens.css` caps `.gallery-body`
 * at 1,180px and centres it, which is the "~1100px column of full-width slabs on
 * 240–360px of empty background" the integration review named. Nothing here may
 * rely on being injected last.
 */
const GALLERY_CSS = String.raw`
.gal-v3 {
  /* Sized in rem so it grows with --ui-scale, clamped so 1.6 does not eat the
     wall it is a rail beside. */
  --gal-rail-w: clamp(196px, 15rem, 288px);
  --gal-accent: var(--accent);
}

/* =======================================================================
   THE ROOM — plane 1, and the reason .ambient-bg is gone
   =======================================================================
   An absolutely-positioned layer paints above static in-flow siblings whatever
   the source order says, so everything standing in the room has to be
   positioned too. The lobby learned this the hard way: its identity chip and
   both currency chips vanished behind their own header.
   ======================================================================= */

.gal-v3 > .screen-header,
.gal-v3 > .gallery-body { position: relative; z-index: 1; }

.gal-room { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }

/* Faction-tinted light, a floor glow and a vignette — translucent, so
   atmosphere.ts's drifting grid, motes and specular crawl show through and the
   gallery has four planes rather than two. Squint and it resolves: light mass
   top-left where the key is, dark mass down both edges and across the corners. */
.gal-room::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(58% 56% at 20% 6%, color-mix(in srgb, var(--gal-accent) 26%, transparent), transparent 70%),
    radial-gradient(50% 44% at 84% 14%, rgb(82 200 255 / 0.09), transparent 72%),
    radial-gradient(96% 50% at 50% 108%, rgb(26 16 54 / 0.76), transparent 72%),
    radial-gradient(126% 94% at 44% 42%, transparent 40%, rgb(2 1 6 / 0.74) 100%);
  animation: gal-room-breathe 13s var(--ease-in-out) infinite;
}

@keyframes gal-room-breathe {
  0%, 100% { opacity: 0.76; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.045); }
}

/* Two slow bars of light raking the room, both on the rig axis. They are
   separated by where they sit and how fast they travel, never by pointing
   different ways — the key light is at 315 degrees and a second angle here would
   be a second sun on a screen whose every rim obeys the first. */
.gal-room::after {
  content: "";
  position: absolute;
  inset: -22% -32%;
  background:
    linear-gradient(var(--light-sweep), transparent 27%, color-mix(in srgb, var(--gal-accent) 12%, transparent) 33%, transparent 39%),
    linear-gradient(var(--light-sweep), transparent 61%, rgb(255 255 255 / 0.032) 65%, transparent 70%);
  animation: gal-room-rake 23s var(--ease-in-out) infinite alternate;
}

@keyframes gal-room-rake {
  from { transform: translateX(-4%); }
  to { transform: translateX(6%); }
}

:root[data-reduced-motion="true"] .gal-room::before,
:root[data-reduced-motion="true"] .gal-room::after { animation: none; }

/* =======================================================================
   THE HEADER TALLY
   ======================================================================= */

.gal-v3 .gal-tally {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  white-space: nowrap;
}
.gal-v3 .gal-tally .hb-icon { width: 14px; height: 14px; align-self: center; color: var(--gal-accent); }
.gal-v3 .gal-tally .num { color: var(--text); font-weight: 600; }
.gal-v3 .gal-tally-sep { color: var(--text-faint); }

/* =======================================================================
   THE BODY — two columns, which is the whole complaint
   ======================================================================= */

.gal-v3 .gallery-body {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: var(--gal-rail-w) minmax(0, 1fr);
  gap: var(--sp-4);
  /* screens.css caps this at 1180px and centres it; that cap *is* the document
     look, so it is written out rather than nudged. */
  max-width: none;
  width: 100%;
  margin: 0;
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
  min-height: 0;
  overflow: hidden;
}
/* A character's page is one exhibit and takes the whole room's width. */
.gal-v3 .gallery-body.is-open { grid-template-columns: minmax(0, 1fr); align-items: start; }

/* =======================================================================
   THE ROSTER RAIL
   ======================================================================= */

/* Translucent for the same reason the shelf is: the roster is a fifth of the
   frame and at the material default it was a lid on that fifth of the room. */
.gal-v3 .gal-rail {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(56 41 94 / 0.62) 0%, rgb(16 10 32 / 0.72) 100%);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
.gal-v3 .gal-rail-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-bottom: 1px solid rgb(0 0 0 / 0.5);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.05);
}
.gal-v3 .gal-rail-head .hb-icon { width: 15px; height: 15px; color: var(--text-dim); }
.gal-v3 .gal-rail-head .t-label { flex: 1 1 auto; }
.gal-v3 .gal-rail-count { padding: 1px 8px; font-size: var(--fs-micro); }
.gal-v3 .gal-rail-scroll {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2) var(--sp-2) var(--sp-3);
}

/* A roster row: rest is quiet, active is raised out of the rail. §5's states as
   material changes rather than as a background swap. */
.gal-v3 .gal-fac {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--r-field);
  --r-self: var(--r-field);
  --c: var(--accent);
  transition:
    color var(--dur-micro) var(--ease-arrive),
    transform var(--dur-micro) var(--ease-overshoot),
    box-shadow var(--dur-micro) var(--ease-arrive);
}
.gal-v3 .gal-fac-gem {
  flex: 0 0 auto;
  margin-top: 5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--c) 70%, white), var(--c) 62%, color-mix(in srgb, var(--c) 45%, black));
  box-shadow: 0 0 6px color-mix(in srgb, var(--c) 60%, transparent), inset 0 -1px 0 rgb(0 0 0 / 0.45);
}
.gal-v3 .gal-fac-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.gal-v3 .gal-fac-line { display: flex; align-items: baseline; gap: var(--sp-2); min-width: 0; }
.gal-v3 .gal-fac-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gal-v3 .gal-fac-count { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-dim); }
.gal-v3 .gal-fac-of { color: var(--text-faint); }
/* how much of this faction you have met, as a groove with something in it */
.gal-v3 .gal-fac-track {
  display: block;
  height: 3px;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  overflow: hidden;
}
.gal-v3 .gal-fac-track > .well-fill {
  display: block;
  height: 100%;
  --fill-meter: linear-gradient(90deg, color-mix(in srgb, var(--c) 74%, black), var(--c));
  transition: width var(--dur-setpiece) var(--ease-arrive);
}
.gal-v3 .gal-fac.active .gal-fac-count { color: rgb(255 255 255 / 0.9); }

@media (hover: hover) {
  .gal-v3 .gal-fac:hover:not(.active) {
    color: var(--text);
    transform: translateX(2px);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.07), inset 0 1px 0 rgb(255 255 255 / 0.06);
  }
}
.gal-v3 .gal-fac.active {
  color: #fff;
  background:
    linear-gradient(var(--light-sweep),
      color-mix(in srgb, var(--c) 42%, transparent),
      color-mix(in srgb, var(--c) 13%, transparent)),
    linear-gradient(var(--light-sweep), rgb(58 44 96 / 0.9), rgb(24 16 46 / 0.9));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.2),
    inset 0 -1px 0 rgb(0 0 0 / 0.5),
    0 3px 8px rgb(0 0 0 / 0.45),
    0 1px 2px rgb(0 0 0 / 0.55);
}
/* the room you are standing in breathes; the ten you are not do not */
.gal-v3 .gal-fac.active .gal-fac-gem { animation: gal-gem-breathe 3.6s var(--ease-in-out) infinite; }
@keyframes gal-gem-breathe {
  0%, 100% { box-shadow: 0 0 6px color-mix(in srgb, var(--c) 55%, transparent), inset 0 -1px 0 rgb(0 0 0 / 0.45); }
  50% { box-shadow: 0 0 12px color-mix(in srgb, var(--c) 85%, transparent), inset 0 -1px 0 rgb(0 0 0 / 0.45); }
}
:root[data-reduced-motion="true"] .gal-v3 .gal-fac.active .gal-fac-gem { animation: none; }

.gal-v3 .gal-rail-foot {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-top: 1px solid rgb(0 0 0 / 0.55);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.05);
}
.gal-v3 .gal-met-track {
  height: 8px;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  overflow: hidden;
}
.gal-v3 .gal-met-track > .well-fill {
  display: block;
  height: 100%;
  --fill-meter: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--gal-accent) 82%, white) 0%, var(--gal-accent) 58%, color-mix(in srgb, var(--gal-accent) 62%, black) 100%);
  transition: width var(--dur-setpiece) var(--ease-arrive);
}
.gal-v3 .gal-met-pct { font-size: var(--fs-micro); color: var(--text-dim); }

/* =======================================================================
   THE WALL — shelves, not a contact sheet
   ======================================================================= */

.gal-v3 .gal-main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }

/*
 * The light on the wall, which is the one piece of idle motion a gallery
 * actually has.
 *
 * Everything else on this screen breathes at the scale of an object: each tile
 * carries the material's own 8.6-second specular band, which is light you only
 * notice when it stops. This is the other half — a lamp raking the wall, at the
 * scale of the room, crossing the pictures rather than sitting on one of them.
 * Measured: the tile bands alone took the idle floor from 0.037 to 0.120 median
 * delta per 200ms, and the wall light is what takes it past the lobby's 0.55,
 * because the quantity a frame-difference probe measures is *area* and a
 * hundred and fifty pixel plate is not area.
 *
 * One element, 'translate' only, so it is a compositor layer and repaints
 * nothing. Both bars lie on the rig axis — a second angle here would be a second
 * sun over a wall of objects that are all lit from 315 degrees — and they are
 * separated by speed and position instead. The mask keeps the light off the
 * scrollbar gutter and off the very top of the column, where the sticky shelf
 * header would otherwise be crossed by a bar every nine seconds.
 */
.gal-v3 .gal-main::after {
  content: "";
  position: absolute;
  z-index: 5;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(var(--light-sweep), transparent 28%, rgb(255 255 255 / 0.085) 39%, transparent 51%),
    linear-gradient(var(--light-sweep), transparent 57%, color-mix(in srgb, var(--gal-accent) 26%, transparent) 66%, transparent 77%);
  background-size: 260% 260%, 260% 260%;
  background-position: 0 0, 0 0;
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 34px);
  mask-image: linear-gradient(180deg, transparent, #000 34px);
  animation: gal-wall-light 11s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite alternate;
}

@keyframes gal-wall-light {
  from { translate: -30% -8%; }
  to { translate: 26% 8%; }
}

:root[data-reduced-motion="true"] .gal-v3 .gal-main::after { animation: none; }
.gal-v3 .gal-main > .hb-scrollwrap { flex: 1 1 auto; min-height: 0; }
.gal-v3 .gal-scroll { padding: 0 var(--sp-2) var(--sp-5) 0; overscroll-behavior: contain; }

.gal-v3 .gal-shelf { margin-bottom: var(--sp-4); }
.gal-v3 .gal-shelf-head {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: 6px;
  border-radius: var(--r-field);
  background: linear-gradient(var(--light-sweep), rgb(30 20 56 / 0.97), rgb(11 6 24 / 0.97));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.09),
    inset 0 -1px 0 rgb(0 0 0 / 0.6),
    0 6px 14px rgb(0 0 0 / 0.5);
  backdrop-filter: blur(6px);
}
.gal-v3 .gal-shelf-gem {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--c) 76%, white), var(--c) 56%, color-mix(in srgb, var(--c) 42%, black));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    inset 0 -2px 3px rgb(0 0 0 / 0.4),
    0 2px 5px rgb(0 0 0 / 0.55),
    0 0 10px color-mix(in srgb, var(--c) 40%, transparent);
}
.gal-v3 .gal-shelf-title { font-size: 0.72rem; color: var(--text); }
/* §7: a divider fades at its ends rather than butting into the panel edge */
.gal-v3 .gal-shelf-rule {
  flex: 1 1 auto;
  height: 2px;
  background-image:
    linear-gradient(90deg, var(--hairline-dark), transparent 88%),
    linear-gradient(90deg, var(--hairline-lit), transparent 88%);
  background-repeat: no-repeat;
  background-size: 100% 1px, 100% 1px;
  background-position: 0 0, 0 100%;
}
.gal-v3 .gal-shelf-count { font-size: var(--fs-micro); color: var(--text-faint); }
/* every shelf gem breathes, on its own phase, so eleven headers are eleven
   lamps rather than eleven printed dots */
.gal-v3 .gal-shelf-gem { animation: gal-gem-breathe 4.2s var(--ease-in-out) infinite; animation-delay: calc(var(--cascade-i, 0) * -370ms); }
:root[data-reduced-motion="true"] .gal-v3 .gal-shelf-gem { animation: none; }

/*
 * The plane the faces stand on.
 *
 * It is a '.mat-panel' with one knob turned rather than a hand-rolled shelf: the
 * fill is made translucent so the room behind it stays visible, which is the
 * difference between a plane inside a place and a slab dropped on a photograph.
 * Everything else — the 315-degree gradient, the lit rim, the dark lip, the
 * grain, the drop and the contact shadow — arrives with the class.
 */
.gal-v3 .gallery-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
  gap: var(--sp-3);
  align-content: start;
  list-style: none;
  margin: 0;
  padding: var(--sp-3);
  contain: layout style;
  /* Translucent on purpose, and this is a depth decision rather than a colour
     one: the shelf is the only thing between the room and the wall, and at 0.56
     it was a lid on it. The room breathes and rakes behind every one of these,
     and that motion is a third of what the idle probe reads on this screen. */
  --mat-fill: linear-gradient(var(--light-sweep),
    rgb(78 58 128 / 0.4) 0%,
    rgb(26 16 52 / 0.44) 46%,
    rgb(5 3 12 / 0.6) 100%);
  --rim-a: 0.1;
  /* the shadow that gathers under a row of standing objects, and the only thing
     that separates a shelf from a tinted rectangle when the row is short */
  box-shadow: var(--mat-cast), inset 0 -46px 52px -46px rgb(0 0 0 / 0.95);
}
/*
 * ...and the shelf does not sweep. A specular band is 40% of the plate wide, so
 * on a nine-hundred-pixel plane it is a three-hundred-and-sixty-pixel bar of
 * light crossing a whole wall on an 8.6-second cycle — light you notice, which
 * is the opposite of what §3's idle layer is for. It is also one promoted
 * compositor layer per shelf at the size of the shelf. The tiles standing on it
 * carry the crawl instead, which is where the eye already is.
 */
.gal-v3 .gallery-grid::after { animation: none; opacity: 0; }
/* the shelf's front lip: the thin lit band that turns a tinted rectangle into a
   ledge. '::before' because foundation.css owns every raised material's ::after. */
.gal-v3 .gallery-grid::before {
  content: "";
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: 0;
  height: 2px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.12), transparent);
}

/* =======================================================================
   A FRAMED PORTRAIT
   ======================================================================= */

.gal-v3 .gallery-cell { min-width: 0; }

.gal-v3 .gal-tile {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 7px;
  text-align: left;
  font: inherit;
  /* A frame is brighter than the wall it hangs on, and catches more light. */
  --mat-fill: linear-gradient(var(--light-sweep), rgb(72 54 116 / 0.97) 0%, rgb(24 15 43 / 0.98) 100%);
  --rim-a: 0.085;
  /* Above the panel default of 0.03, because a framed picture is the one plate
     in the game with no small type on its face: the label is on the frame below
     it and the only ink the band crosses is a display-weight name at 0.8rem. */
  --sheen-alpha: 0.07;
  --sheen-hover: 0.12;
  animation: card-tile-in 320ms var(--ease-arrive) var(--enter-delay, 0ms) backwards;
}
:root[data-reduced-motion="true"] .gal-v3 .gal-tile {
  animation-duration: 90ms;
  animation-name: card-tile-fade;
}

/* the mount: a recess cut into the frame, with the picture sitting in it. Its
   rim and lip run a little hotter than the material's default, because at 150px
   a 1px bevel at 0.085 is the difference between a frame and a border. */
.gal-v3 .gal-mount {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 8px;
  --r-self: 8px;
  --rim-a: 0.13;
  --lip-a: 0.92;
}
/*
 * The picture arriving in the frame — an entrance, not an appearance.
 *
 * It was \`hb-tile-lit\`: a bare 200ms fade from zero, fired the instant the
 * canvas was inserted, with no relationship to any other tile. Nineteen of those
 * firing in whatever order \`lazyPaint\` happened to drain the queue in is
 * nineteen unrelated events, which is exactly what §3a means by contents that do
 * not arrive in reading order.
 *
 * \`--enter-delay\` is inherited from the tile, where \`buildShelf\` has already
 * written the collection's diagonal wave — \`min(420, (row + column) * 34)\` —
 * so the pictures land on the same cascade the frames did, one step behind. A
 * custom property crossing from the button to a canvas two levels down is free;
 * a second scheduler to do the same job would not have been.
 *
 * It settles rather than only fading: 1.03 down to 1, inside a mount that clips,
 * so the painting eases into the recess. Transform and opacity only — there are
 * a hundred and thirty-eight of these.
 */
.gal-v3 .gal-mount canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: filter var(--dur-ui) var(--ease-arrive);
  animation: gal-portrait-in 260ms var(--ease-arrive) var(--enter-delay, 0ms) both;
}

@keyframes gal-portrait-in {
  from { opacity: 0; transform: scale(1.03); }
  to   { opacity: 1; transform: scale(1); }
}

/*
 * And the second arrival: a placeholder that turns into a painting.
 *
 * See the note on the \`onArtLoaded\` watcher in this file for why it starts at
 * 0.45 rather than at zero — there is a recess behind the canvas, and a swap
 * that goes through transparent shows it.
 */
.gal-art-swap { animation: gal-art-swap 240ms var(--ease-arrive) both; }

@keyframes gal-art-swap {
  from { opacity: 0.45; transform: scale(1.02); }
  to   { opacity: 1; transform: scale(1); }
}

:root[data-reduced-motion="true"] .gal-v3 .gal-mount canvas {
  animation: hb-tile-lit 90ms linear both;
}
:root[data-reduced-motion="true"] .gal-art-swap { animation: none; }
/* the sleeve the picture arrives into, so a lazy paint never shows a hole */
.gal-v3 .gal-tile-slot { display: block; width: 100%; height: 100%; }

/*
 * The glass, and the mount's own shade falling across the picture.
 *
 * 'box-shadow: inset' paints below an element's children, so a '.mat-well' that
 * is *occupied* stops looking like a recess — which on a tile whose entire area
 * is occupied means the recess never existed. This is the same repair
 * '.well-fill' makes for a progress rail, on the one surface where the thing in
 * the hole is a photograph. '.mat-well' is deliberately not in foundation's
 * ::after list, so this pseudo-element is free.
 */
.gal-v3 .gal-mount::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(var(--light-sweep),
    rgb(255 255 255 / 0.10) 0%,
    rgb(255 255 255 / 0) 26%,
    rgb(0 0 0 / 0) 60%,
    rgb(0 0 0 / 0.26) 100%);
  box-shadow:
    inset 0 2px 5px rgb(0 0 0 / 0.5),
    inset 2px 0 5px -3px rgb(0 0 0 / 0.45),
    inset 0 -1px 0 rgb(255 255 255 / 0.06);
}

/* the label, on the frame — a gallery captions a painting below it, not across
   the sitter's chin. Its top edge is the faction's colour, lit. */
.gal-v3 .gal-tile-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 6px;
  padding: 6px 6px 5px;
  border-radius: 6px;
  background-image:
    linear-gradient(90deg, color-mix(in srgb, var(--c) 92%, transparent), color-mix(in srgb, var(--c) 12%, transparent) 70%, transparent),
    linear-gradient(var(--light-sweep), rgb(255 255 255 / 0.055) 0%, rgb(0 0 0 / 0.2) 100%);
  background-repeat: no-repeat, no-repeat;
  background-size: 100% 2px, 100% 100%;
  background-position: 0 0, 0 0;
  box-shadow: inset 0 -1px 0 rgb(0 0 0 / 0.4);
}
.gal-v3 .gal-tile-name {
  font-family: var(--font-display);
  font-size: 0.8rem;
  line-height: 1.18;
  /* two lines are reserved whether or not the name needs them, so one row never
     carries three different baselines */
  min-height: 2.36em;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color var(--dur-micro) var(--ease-arrive);
}
/* §6: saturation is a resource, and a hundred and thirty-eight fully-saturated
   role labels would spend all of it on the least important word on the tile. */
.gal-v3 .gal-tile-role {
  font-size: var(--fs-micro);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--c) 46%, var(--text-dim));
}

/* the marks that belong on the picture rather than on the frame */
.gal-v3 .gal-tile-crest {
  position: absolute;
  z-index: 3;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  color: var(--c);
  background: rgb(4 2 10 / 0.62);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.12), 0 1px 3px rgb(0 0 0 / 0.6);
}
.gal-v3 .gal-tile-crest .hb-icon { width: 13px; height: 13px; }
/*
 * "Art pending", named rather than implied.
 *
 * The renderer stamps its own watermark on a card above 300px of render width; a
 * 168px gallery tile is far under that, so this was the one surface in the game
 * where an unpainted character showed an abstract field with nothing saying why.
 * §10 asks for exactly this: the state is long-lived and heavily seen, so it
 * gets designed rather than hidden.
 */
.gal-v3 .gal-tile-pending {
  position: absolute;
  z-index: 3;
  top: 7px;
  left: 7px;
  padding: 1px 6px;
  font-size: var(--fs-micro);
  font-weight: 600;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.5);
  background: rgb(4 2 10 / 0.55);
  border-radius: var(--r-chip);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0;
  transition: opacity var(--dur-ui) var(--ease-arrive);
  pointer-events: none;
}
.gal-v3 .gal-tile.no-art .gal-tile-pending { opacity: 1; }
/*
 * The not-yet-seen padlock lives in the same corner; the mark steps aside for it
 * rather than stacking on top of it.
 *
 * Keyed on the tile's own '.unseen' — which is the *same condition*, decided in
 * script where it is already known — rather than on ':has(.gal-tile-locked)'.
 * A relational selector over a hundred and thirty-eight mounts is re-evaluated
 * every time one of them gains a child, and the lazy painter gives every one of
 * them a child: measured with '_w3nav_cost.mjs', the ':has()' version put three
 * long tasks of 323ms, 336ms and 375ms into the first two seconds of
 * 'lobby → gallery' and held the shell's cover the full 1,100ms of its reveal
 * patience. This is the same rule with no invalidation set.
 */
.gal-v3 .gal-tile.unseen .gal-tile-pending { left: 33px; }
.gal-v3 .gal-tile-locked {
  position: absolute;
  z-index: 3;
  top: 6px;
  left: 6px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  color: var(--text-faint);
  background: rgb(4 2 10 / 0.72);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
}
.gal-v3 .gal-tile-locked .hb-icon { width: 12px; height: 12px; }

/* Not yet seen is a change of *material*, never opacity alone (§5). The frame
   loses its chroma with the picture, so an unmet character reads as a covered
   painting rather than as a faded one. */
.gal-v3 .gal-tile.unseen {
  --mat-fill: linear-gradient(var(--light-sweep), rgb(38 32 54 / 0.94) 0%, rgb(15 12 24 / 0.96) 100%);
}
.gal-v3 .gal-tile.unseen canvas { filter: saturate(0.08) brightness(0.5) contrast(1.05); }
.gal-v3 .gal-tile.unseen .gal-tile-name { color: var(--text-dim); }
.gal-v3 .gal-tile.unseen .gal-tile-role { color: var(--text-faint); }
.gal-v3 .gal-tile.unseen .gal-tile-crest { color: var(--text-faint); }

/*
 * Hover: '.act' supplies the lift, the doubled rim, the tightened contact
 * shadow and the specular catch. What is added here is the part that belongs to
 * *this* object — the picture brightens as the light reaches it, the name comes
 * up to white, and the frame gains a faction-coloured halo.
 */
.gal-v3 .gal-tile::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--c) 52%, transparent),
    0 0 24px color-mix(in srgb, var(--c) 42%, transparent);
  transition: opacity var(--dur-micro) var(--ease-arrive);
}
@media (hover: hover) {
  .gal-v3 .gal-tile:hover::before { opacity: 1; }
  .gal-v3 .gal-tile:hover canvas { filter: saturate(1.1) brightness(1.09); }
  .gal-v3 .gal-tile:hover .gal-tile-name { color: #fff; }
  .gal-v3 .gal-tile.unseen:hover canvas { filter: saturate(0.3) brightness(0.72) contrast(1.05); }
  /* §3a: the neighbour gives way. A next-sibling combinator rather than ':has()'
     — a relational selector evaluated against a hundred and thirty-eight grid
     items on every pointer move is not a 2px nudge's worth of style
     recalculation. */
  .gal-v3 .gallery-cell:hover + .gallery-cell .gal-tile { transform: translateX(3px); }
}

/*
 * Idle light, granted per tile by the observer in this file.
 *
 * The rule has to out-specify foundation.css's own '.mat-panel::after'
 * animation *and* its reduced-motion override, because this sheet is injected
 * into <head> at runtime and would otherwise win a tie it must lose. Both
 * settings are therefore named here rather than left to source order.
 */
.gal-v3 .gal-tile::after { animation: none; }
:root:not([data-reduced-motion="true"]):not([data-gfx-tier="low"]) .gal-v3 .gal-tile.is-alive::after {
  animation: hb-sheen-pass var(--dur-sheen-panel) var(--ease-sweep)
    calc((var(--enter-delay, 0ms) + var(--gal-phase, 0) * 260ms) * -2.7) infinite;
}

/* =======================================================================
   ONE CHARACTER'S PAGE
   ======================================================================= */

/* The exhibit is an object standing in the room, not a wall. It hugs its own
   content and stops; what is under it is the gallery, lit, which is the whole
   argument for having replaced the opaque backdrop with one. */
.gal-v3 .gallery-page {
  align-self: start;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5) var(--sp-5);
  overflow: hidden;
  animation: card-tile-in var(--dur-ui) var(--ease-arrive) backwards;
}
:root[data-reduced-motion="true"] .gal-v3 .gallery-page { animation-name: card-tile-fade; }
.gal-v3 .gallery-page-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.gal-v3 .gallery-page-title { margin: 0; font-family: var(--font-display); font-size: var(--fs-xl); }
/*
 * Three regions, because the page has three kinds of content: the object, the
 * story about it, and the record of what you have done with it. One column of
 * everything was 74ch of prose with five hundred pixels of empty plate to its
 * right and a progress rail eleven hundred pixels wide.
 */
.gal-v3 .gallery-page-body {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(240px, 21rem);
  gap: var(--sp-5);
  align-items: stretch;
  min-height: 0;
  flex: 1 1 auto;
}
.gal-v3 .gal-dossier {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  min-height: 0;
  padding-right: var(--sp-2);
}
.gal-v3 .gal-card { padding: var(--sp-3); }
.gal-v3 .gal-card h4 { color: var(--text); }
.gal-v3 .gal-plinth {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  --r-self: var(--r-panel);
  border-radius: var(--r-panel);
}
.gal-v3 .gallery-portrait canvas { display: block; border-radius: var(--r-tile); }
.gal-v3 .gal-badges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.gal-v3 .gal-badge {
  font-size: var(--fs-micro);
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--c, var(--text-dim)) 60%, white);
}
.gal-v3 .gallery-page-text {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  padding-right: var(--sp-3);
}
.gal-v3 .gallery-prose { margin: 0; max-width: 74ch; }
.gal-v3 .gallery-quote { margin: 0; font-style: italic; color: var(--text-faint); max-width: 74ch; }
.gal-v3 .gallery-track { display: flex; flex-direction: column; gap: var(--sp-2); }
.gal-v3 .gallery-track h4 { margin: 0; font-family: var(--font-display); font-size: var(--fs-md); }
.gal-v3 .gallery-track p { margin: 0; font-size: var(--fs-sm); }
/* the tracks are grooves with something in them, not coloured stripes lying on
   a flat rail — see foundation.css's note on why '.well-fill' has to exist */
.gal-v3 .gal-track-bar {
  height: 8px;
  border-radius: var(--r-chip);
  --r-self: var(--r-chip);
  overflow: hidden;
  background-color: transparent;
}
.gal-v3 .gal-track-bar > .well-fill {
  display: block;
  height: 100%;
  --fill-meter: linear-gradient(var(--light-sweep), color-mix(in srgb, var(--c, var(--accent)) 80%, white) 0%, var(--c, var(--accent)) 58%, color-mix(in srgb, var(--c, var(--accent)) 60%, black) 100%);
  transition: width var(--dur-setpiece) var(--ease-arrive);
}
.gal-v3 .gallery-featuring h4 { margin: 0 0 var(--sp-2); font-family: var(--font-display); font-size: var(--fs-md); }
.gal-v3 .gallery-card-strip { display: flex; gap: var(--sp-3); flex-wrap: wrap; }
.gal-v3 .gallery-missing { margin: 0; font-size: var(--fs-sm); max-width: 74ch; }

/* =======================================================================
   SMALL ROOMS
   =======================================================================
   Below 1000px there is not enough width for a rail beside a wall, so the rail
   becomes the strip along the top it used to be — one row that scrolls
   sideways, ending in air rather than at a cut. Nothing is hidden: 'display:
   none' on the roster would delete the counts and the progress with it.
   ======================================================================= */

@media (max-width: 1000px) {
  .gal-v3 .gallery-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
  }
  .gal-v3 .gal-rail {
    grid-template-rows: none;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
  }
  .gal-v3 .gal-rail-head {
    border-bottom: 0;
    border-right: 1px solid rgb(0 0 0 / 0.5);
    box-shadow: 1px 0 0 rgb(255 255 255 / 0.05);
    padding: var(--sp-2) var(--sp-3);
  }
  .gal-v3 .gal-rail-head .t-label { display: none; }
  .gal-v3 .gal-rail-scroll {
    flex-direction: row;
    align-items: center;
    gap: 5px;
    padding: var(--sp-2);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 22px), transparent);
  }
  .gal-v3 .gal-rail-scroll::-webkit-scrollbar { height: 0; }
  .gal-v3 .gal-fac {
    flex: 0 0 auto;
    align-items: center;
    width: auto;
    border-radius: var(--r-chip);
    --r-self: var(--r-chip);
    padding: 5px 11px;
  }
  /* the per-faction meter is a rail affordance; in the strip it is 3px of noise
     inside a pill, and the count beside the name already says the same thing */
  .gal-v3 .gal-fac-body { flex-direction: row; align-items: baseline; gap: 7px; }
  .gal-v3 .gal-fac-track { display: none; }
  .gal-v3 .gal-fac-gem { margin-top: 0; }
  .gal-v3 .gal-rail-foot {
    border-top: 0;
    border-left: 1px solid rgb(0 0 0 / 0.55);
    box-shadow: inset 1px 0 0 rgb(255 255 255 / 0.05);
    grid-template-columns: auto 72px auto;
    padding: var(--sp-2) var(--sp-3);
  }
  .gal-v3 .gal-rail-foot .t-label { display: none; }
  .gal-v3 .gal-rail-wrap { min-width: 0; }
  .gal-v3 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: var(--sp-2); padding: var(--sp-2); }
  /* One column, and the page itself becomes the scroller. Three nested
     scrollers stacked vertically is three thumbs and no way to read past the
     first one. */
  .gal-v3 .gallery-page { overflow-y: auto; overflow-x: hidden; }
  .gal-v3 .gallery-page-body { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .gal-v3 .gallery-page-text,
  .gal-v3 .gal-dossier { overflow: visible; max-height: none; }
  .gal-v3 .gal-plinth { flex-direction: row; align-items: center; justify-content: center; flex-wrap: wrap; }
}

/* A phone in landscape has 390px of height and most of it is chrome. */
@media (max-height: 520px) {
  .gal-v3 .gallery-body { gap: var(--sp-2); padding: var(--sp-2) var(--sp-3) var(--sp-2); }
  .gal-v3 .gallery-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 7px; padding: 8px; }
  .gal-v3 .gal-shelf { margin-bottom: var(--sp-3); }
  .gal-v3 .gal-shelf-head { padding: 3px 8px; gap: var(--sp-2); }
  .gal-v3 .gal-shelf-gem { width: 16px; height: 16px; }
  .gal-v3 .gal-tile { padding: 4px 4px 0; }
  .gal-v3 .gal-tile-body { padding: 5px 2px 6px; }
  .gal-v3 .gal-tile-name { font-size: 0.7rem; }
  .gal-v3 .gallery-page { padding: var(--sp-3); gap: var(--sp-3); }
}
`;
