/**
 * The player profile — identity, and where cosmetics are worn.
 *
 * `03-screens-and-navigation.md` §4.5.4: *"Avatar portrait + profile frame +
 * equipped title (all editable via cosmetic picker); account level and XP;
 * faction mastery bars; lifetime headline stats."*
 *
 * ## What was here, and why it was the domain's worst screen
 *
 * The avatar was `displayName.charAt(0).toUpperCase()` at 2rem on a flat grey
 * disc with a single `ctx.arc` stroke round it. The recon named it defect 1 and
 * it deserved the slot: this is the identity screen — the one a player opens to
 * find out who the game thinks they are — and it was styled like a contact chip
 * in a mail client. Hearthstone frames your hero portrait in a carved medallion
 * with the rank badge pinned to the rim; MTGA gives you an avatar, a tier crest
 * and pips. HYPEBOUND shipped a letter.
 *
 * Four things changed and they are all the same change:
 *
 * **The avatar is a portrait.** `paintLeaderPortrait` already existed, is
 * already used by the lobby, the queue and the sign-in screen, and already
 * handles the case that matters here — a card whose painting has not been made
 * yet falls through to the card renderer's own deliberate placeholder. It draws
 * the leader the player has actually played most, which makes the profile
 * *theirs* rather than generic, and the monogram survives as the honest fallback
 * for an account with no matches and no deck.
 *
 * **The ring is a struck crest**, not a stroked circle: the faction's own
 * emblem, hexagonal, lit from 315° like every other object in the game.
 *
 * **The level is a rank object.** A shield with a tier gem, the same crest that
 * goes on Leaderboards and in the match-history header, so the domain has one
 * thing it is recognised by rather than nine unrelated panels.
 *
 * **Cosmetics show the item.** "None earned" appeared four times and "Default"
 * four times — eight strings and no picture of what a title, a frame or a badge
 * even is. Every slot now draws the object: a struck nameplate, a ring, a pinned
 * shield, a card back, each carrying the player's own faction mark, and each in
 * house steel until a real one is earned, with what earns it beside it. That is
 * what the locker looks like in all three reference games.
 *
 * The parts of §4.5.4 that need the server (profile visibility, other players'
 * profiles, add friend / challenge / block) are absent rather than stubbed, in
 * keeping with how every other online feature is treated.
 */

import type { CardDef, ContentIndex, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import type { Cosmetic, CosmeticKind } from "../../game/cosmetics";
import { WEARABLE_KINDS } from "../../game/cosmetics";
import {
  achievementBoard,
  achievementsUnclaimed,
  equipCosmetic,
  emoteWheel,
  factionMastery,
  getProfile,
  myCosmetics,
  wearing,
  xpForLevel,
} from "../../save/profile";
import { drawEmblem, hexToRgb } from "../cosmetics/emblem";
import { paintLeaderPortrait } from "../art/leaderPortrait";
import { WIN_RATE_QUALIFIER, winRate } from "../../game/stats/dashboard";
import { audio } from "../../audio/audio";
import {
  colourFor,
  count,
  countUp,
  crestMark,
  disposeBag,
  emblemFor,
  enter,
  esc,
  icon,
  meter,
  rankMark,
  rovingList,
  swatchMark,
} from "./data/kit";

export interface ProfileCallbacks {
  onBack: () => void;
  onMastery: () => void;
  onCollection: () => void;
  onAchievements: () => void;
  onHistory: () => void;
  onStats: () => void;
  onGallery: () => void;
  onLeaderboards: () => void;
}

const SLOT_LABEL: Record<CosmeticKind, string> = {
  cardBack: "Card back",
  title: "Title",
  frame: "Profile frame",
  badge: "Badge",
  emote: "Emotes",
};

/**
 * What the slot is wearing when it is wearing nothing.
 *
 * The word "Default" appeared four times down one column, which tells a player
 * neither what they have on nor that they have anything on at all. Each slot has
 * a real house item and it can be named: the ring around the avatar *is* the
 * house ring, the cards *do* show the house back. Naming them is the difference
 * between a locker with four empty rows and a locker with four starting items.
 */
const SLOT_DEFAULT: Record<CosmeticKind, string> = {
  cardBack: "House back",
  title: "Plain nameplate",
  frame: "House ring",
  badge: "No badge pinned",
  emote: "The six you start with",
};

/** What earns the slot, said once, so an empty locker is informative. */
const SLOT_SOURCE: Record<CosmeticKind, string> = {
  cardBack: "Faction Mastery rank 10",
  title: "Leader Mastery, rank 3",
  frame: "Faction Mastery rank 15",
  badge: "The Bias Board, at Parasocial",
  emote: "Faction and Leader Mastery",
};

/**
 * The leader whose portrait this account wears.
 *
 * Most-played first, because a profile should be a picture of what somebody has
 * actually done; the active deck's leader second, so a brand-new account that
 * has chosen a starter is still somebody; and null last, which is the genuine
 * "no identity yet" case the monogram is for.
 */
function faceOf(content: ContentIndex): CardDef | null {
  const profile = getProfile();
  const tally = new Map<string, number>();
  for (const entry of profile.history) {
    tally.set(entry.leaderCardId, (tally.get(entry.leaderCardId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, played] of tally) {
    if (played > bestCount) {
      best = id;
      bestCount = played;
    }
  }
  const fallback = profile.decks[profile.activeDeckIndex]?.leaderCardId ?? profile.decks[0]?.leaderCardId ?? null;
  const chosen = best ?? fallback;
  return chosen ? (content.leaders[chosen] ?? null) : null;
}

/**
 * The ring around the portrait, painted rather than stroked.
 *
 * Two passes, which is the difference between a border and a bevel: a dark outer
 * stroke for the whole circumference, then a lit arc from 200° to 340° — the
 * top-left, where the key light is — so the ring is a metal object catching a
 * lamp rather than a coloured outline. The frame's own emblem is struck into the
 * band at eight points, which is what the ring is *for* on a screen where the
 * frame cosmetic is otherwise invisible.
 */
function paintFrame(canvas: HTMLCanvasElement, frame: Cosmetic | null, factionId: string | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  const colour = frame?.color ?? (factionId ? colourFor(factionId) : "#8f8aa8");
  const [r, g, b] = hexToRgb(colour);
  const mid = size / 2;
  const radius = size * 0.445;
  const band = size * 0.05;

  // the unlit body of the ring
  ctx.strokeStyle = `rgba(${Math.round(r * 0.32)}, ${Math.round(g * 0.28)}, ${Math.round(b * 0.4)}, 0.95)`;
  ctx.lineWidth = band;
  ctx.beginPath();
  ctx.arc(mid, mid, radius, 0, Math.PI * 2);
  ctx.stroke();

  // the lit arc: 200°–340°, i.e. the top-left quadrant and its neighbours
  ctx.strokeStyle = `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 55)}, ${Math.min(255, b + 60)}, 0.95)`;
  ctx.lineWidth = band * 0.42;
  ctx.beginPath();
  ctx.arc(mid, mid, radius - band * 0.28, (200 * Math.PI) / 180, (340 * Math.PI) / 180);
  ctx.stroke();

  // the cut on the shadow side
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = band * 0.3;
  ctx.beginPath();
  ctx.arc(mid, mid, radius + band * 0.34, (10 * Math.PI) / 180, (150 * Math.PI) / 180);
  ctx.stroke();

  // the emblem, struck into the band at eight points
  const emblem = frame?.emblem ?? (factionId ? emblemFor(factionId) : "diamond");
  ctx.lineWidth = Math.max(1, size * 0.006);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const x = mid + Math.cos(angle) * radius;
    const y = mid + Math.sin(angle) * radius;
    const lit = Math.cos(angle + (3 * Math.PI) / 4) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + lit * 0.55})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
    drawEmblem(ctx, emblem, x, y, size / 2600);
  }
}

/** A card back, drawn small for the preview. `null` draws the house design. */
function paintBack(canvas: HTMLCanvasElement, back: Cosmetic | null, color: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const emblem = back?.emblem ?? "diamond";
  const [r, g, b] = hexToRgb(color);
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, `rgb(${Math.round(r * 0.42)}, ${Math.round(g * 0.4)}, ${Math.round(b * 0.5)})`);
  grad.addColorStop(1, "#0b0518");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.18)`;
  ctx.lineWidth = 1.5;
  drawEmblem(ctx, emblem, canvas.width / 2, canvas.height / 2, canvas.width / 200);
  // a lit top-left edge and a cut bottom-right one, like every other plate
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1.5, canvas.height - 2);
  ctx.lineTo(1.5, 1.5);
  ctx.lineTo(canvas.width - 2, 1.5);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.4)`;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
}

export function createProfileScreen(content: ContentIndex, callbacks: ProfileCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen profile-screen";

  /** which slot's picker is open, or null */
  let picking: CosmeticKind | null = null;
  const bag = disposeBag();

  const render = (): void => {
    bag.run();
    const profile = getProfile();
    const owned = myCosmetics(content);
    const title = wearing(content, "title");
    const frame = wearing(content, "frame");
    const badge = wearing(content, "badge");
    const back = wearing(content, "cardBack");
    const emotes = emoteWheel(content);
    const tracks = factionMastery(content).filter((track) => track.xp > 0);

    const board = achievementBoard(content);
    const points = board.points;
    const unclaimed = achievementsUnclaimed(content);

    const face = faceOf(content);
    const factionId = (face?.faction as string | undefined) ?? profile.starterFaction ?? null;
    const accent = frame?.color ?? (factionId ? colourFor(factionId) : "#b56cff");
    /** The mark struck into an unworn swatch: the player's own faction, not a generic. */
    const houseEmblem = factionId ? emblemFor(factionId) : "diamond";

    const xpNeeded = xpForLevel(profile.accountLevel);
    /*
     * One definition, imported rather than re-derived — see the long note on
     * `winRate` in `dashboard.ts`. This screen used `wins / matchesPlayed`,
     * which on a record with draws in it disagrees with Statistics one click
     * away by up to seventeen points.
     */
    const decided = profile.stats.wins + profile.stats.losses;
    const winRatePct = Math.round(winRate({ won: profile.stats.wins, lost: profile.stats.losses }) * 100);

    /**
     * A cosmetic slot, showing the thing rather than the word "Default".
     *
     * Worn, owned-but-not-worn and not-yet-earned are three visibly different
     * states: worn draws the swatch lit and names it; owned collapses to a
     * picker; unearned draws the swatch at a quarter and says what earns it.
     */
    const slotRow = (kind: CosmeticKind, worn: Cosmetic | null): string => {
      const mine = owned.filter((cosmetic) => cosmetic.kind === kind);
      /*
       * The swatch is the item, not an icon standing for its category.
       *
       * It used to be one of four glyphs on a tinted square, which meant the
       * locker's four rows were four grey squares and the picker inside them was
       * the same square repeated — no preview of what a title, a frame, a badge
       * or a card back actually looks like when it is worn. The generator draws
       * five distinct objects and strikes the wearer's own emblem into each, so
       * a player scanning the list is looking at their cabinet.
       *
       * The unworn slot is *not* blank and it is *not* dimmed either: the house
       * default is a thing the player is currently wearing, so it is drawn lit,
       * in steel rather than in a faction colour, carrying their own faction
       * mark. Dead metal is reserved for the state that genuinely means "not
       * yours", which is a locked option inside the picker.
       */
      const HOUSE = "#8d86a8";
      const swatch = (cosmetic: Cosmetic | null, lit: boolean, size = 44): string =>
        swatchMark(kind, cosmetic?.color ?? HOUSE, cosmetic?.emblem ?? houseEmblem, size, lit);

      return `
        <li class="profile-slot ${picking === kind ? "open" : ""}" data-slot="${kind}">
          <div class="profile-slot-head">
            ${swatch(worn, true)}
            <span class="profile-slot-text">
              <span class="profile-slot-label t-label">${SLOT_LABEL[kind]}</span>
              <span class="profile-slot-worn">${worn ? esc(worn.name) : SLOT_DEFAULT[kind]}</span>
            </span>
            ${
              mine.length === 0
                ? `<span class="profile-slot-locked">${icon("lock", 14)} ${esc(SLOT_SOURCE[kind])}</span>`
                : `<button type="button" class="mat-chip act r-chip profile-slot-toggle" data-slot="${kind}"
                           aria-expanded="${picking === kind}">
                     ${picking === kind ? "Close" : `Change`}
                     <span class="num" data-digits="2">${count(mine.length)}</span>
                   </button>`
            }
          </div>
          ${
            picking === kind
              ? `<div class="profile-picker">
                   <button type="button" class="mat-panel act r-tile profile-option ${worn === null ? "active" : ""}"
                           data-slot="${kind}" data-id="">
                     ${swatch(null, true, 34)} ${SLOT_DEFAULT[kind]}
                   </button>
                   ${mine
                     .map(
                       (cosmetic) => `
                         <button type="button" class="mat-panel act r-tile profile-option ${worn?.id === cosmetic.id ? "active" : ""}"
                                 data-slot="${kind}" data-id="${esc(cosmetic.id)}" title="${esc(cosmetic.source)}">
                           ${swatch(cosmetic, true, 34)}
                           <span class="profile-option-text">
                             <span>${esc(cosmetic.name)}</span>
                             <span class="t-label">${esc(cosmetic.source)}</span>
                           </span>
                         </button>`
                     )
                     .join("")}
                 </div>`
              : ""
          }
        </li>`;
    };

    const link = (id: string, label: string, iconId: Parameters<typeof icon>[0], badgeCount = 0): string => `
      <button type="button" class="mat-panel act r-tile profile-link d-enter" id="${id}">
        ${icon(iconId, 20)}
        <span>${esc(label)}</span>
        ${badgeCount > 0 ? `<span class="d-badge">${icon("chest", 12)}<span class="num">${count(badgeCount)}</span></span>` : ""}
        ${icon("chevron-right", 16, "profile-link-go")}
      </button>`;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="profile-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Profile</h1>
      </header>

      <main class="profile-body data-body">
        <section class="panel panel-chrome profile-identity" style="--profile-accent:${esc(accent)}">
          <div class="profile-avatar-wrap">
            <canvas class="profile-frame-canvas" id="profile-frame" width="240" height="240"></canvas>
            <div class="profile-avatar" style="--c:${esc(accent)}">
              ${
                face
                  ? `<div class="profile-face-slot" id="profile-face" aria-hidden="true"></div>`
                  : `<span class="profile-monogram">${esc(profile.displayName.charAt(0).toUpperCase())}</span>`
              }
            </div>
            ${
              badge
                ? `<span class="profile-badge" style="--c:${esc(badge.color)}" title="${esc(badge.source)}">
                     ${icon("achievement", 15)}
                   </span>`
                : ""
            }
          </div>

          <div class="profile-identity-text">
            <p class="t-label profile-eyebrow">${
              face ? esc(content.factions[face.faction as FactionId]?.name ?? "") : "Unaffiliated"
            }</p>
            <h2 class="profile-name t-display">${esc(profile.displayName)}</h2>
            <p class="profile-title ${title ? "" : "muted"}" id="profile-title">
              ${title ? esc(title.name) : "No title equipped"}
            </p>
            <div class="profile-level">
              <span class="profile-level-label t-label">Level ${profile.accountLevel}</span>
              ${meter({
                value: xpNeeded > 0 ? profile.accountXp / xpNeeded : 1,
                steps: 0,
                colour: accent,
                animate: true,
                className: "profile-xp-meter",
              })}
              <span class="profile-level-xp">
                <span class="num" data-count="${profile.accountXp}" data-digits="5">${count(profile.accountXp)}</span>
                <span class="muted"> / ${count(xpNeeded)} XP</span>
              </span>
            </div>
          </div>

          <div class="profile-rank">
            ${rankMark(
              { tier: profile.accountLevel, tiers: 50, colour: accent },
              96,
              `<span class="d-rank-value">${count(profile.accountLevel)}</span>`
            )}
            <span class="t-label">Account level</span>
          </div>

          <dl class="d-stats profile-stats">
            <div class="d-stat"><dt>Matches</dt><dd class="num" data-count="${profile.stats.matchesPlayed}" data-digits="4">0</dd></div>
            <div class="d-stat"><dt>Wins</dt><dd class="num" data-count="${profile.stats.wins}" data-digits="4">0</dd></div>
            <div class="d-stat"><dt>Win rate <span class="d-stat-qual">${WIN_RATE_QUALIFIER}</span></dt><dd class="num">${winRatePct}%<span class="d-stat-of">${count(
              decided
            )} decided</span></dd></div>
            <div class="d-stat"><dt>Cards</dt><dd class="num" data-count="${Object.keys(profile.collection).length}" data-digits="4">0</dd></div>
            <div class="d-stat"><dt>Points</dt><dd class="num" data-count="${points}" data-digits="4">0</dd></div>
          </dl>
        </section>

        <nav class="profile-links" aria-label="Your records">
          ${link("profile-achievements", "Achievements", "achievement", unclaimed)}
          ${link("profile-history", "Match history", "mode-replays")}
          ${link("profile-stats", "Statistics", "log")}
          ${link("profile-gallery", "Characters", "collection")}
          ${link("profile-leaderboards", "Leaderboards", "mode-ranked")}
        </nav>

        <section class="panel panel-chrome profile-cosmetics">
          <h3 class="t-heading profile-section-title">Cosmetics</h3>
          <p class="t-body profile-hint">
            Earned by playing — Faction and Leader Mastery, and the Bias Board. Nothing here can be bought.
          </p>
          <ul class="profile-slots">
            ${slotRow("title", title)}
            ${slotRow("frame", frame)}
            ${slotRow("badge", badge)}
            ${slotRow("cardBack", back)}
          </ul>
          <div class="profile-back-preview">
            <canvas id="profile-back-canvas" width="132" height="184"></canvas>
            <p class="t-body">${back ? `Your cards show the ${esc(back.name)}.` : "Your cards show the house back."}</p>
          </div>
        </section>

        <section class="panel panel-chrome profile-emotes">
          <h3 class="t-heading profile-section-title">
            Emote wheel <span class="num profile-count">${count(emotes.length)}</span>
          </h3>
          <p class="t-body profile-hint">
            The six you start with are never taken away. Mastery adds to the wheel rather than replacing it.
          </p>
          <ul class="profile-emote-list">
            ${emotes
              .map(
                (phrase) =>
                  `<li class="profile-emote mat-chip d-enter">${icon("emote", 14)}<span>${esc(phrase)}</span></li>`
              )
              .join("")}
          </ul>
        </section>

        <section class="panel panel-chrome profile-mastery">
          <div class="profile-mastery-head">
            <h3 class="t-heading profile-section-title">Faction Mastery</h3>
            <button type="button" class="mat-chip act r-chip" id="profile-mastery">
              Open Mastery ${icon("chevron-right", 14)}
            </button>
          </div>
          ${
            tracks.length === 0
              ? `<div class="empty d-enter">
                   ${icon("mastery", 40)}
                   <h3 class="t-heading">No track has started yet</h3>
                   <p class="t-body">Every match pays XP into the faction you played it with — win or lose. Play one and the ten tracks below start filling.</p>
                 </div>`
              : `<ul class="profile-tracks" id="profile-tracks">
                   ${tracks
                     .map((track) => {
                       const colour = colourFor(track.factionId);
                       return `
                         <li class="profile-track d-enter">
                           ${crestMark(track.factionId, 34)}
                           <span class="profile-track-name">${esc(track.name)}</span>
                           ${meter({
                             value: track.maxed ? 1 : track.toNext > 0 ? track.intoRank / track.toNext : 0,
                             steps: 0,
                             colour,
                             animate: true,
                           })}
                           <span class="profile-track-rank t-label">${
                             track.maxed ? "Mastered" : `Rank ${count(track.rank)}`
                           }</span>
                         </li>`;
                     })
                     .join("")}
                 </ul>`
          }
        </section>
      </main>`;

    const frameCanvas = root.querySelector<HTMLCanvasElement>("#profile-frame");
    if (frameCanvas) paintFrame(frameCanvas, frame, factionId);

    /**
     * The portrait itself — the painter's own canvas, **mounted, not copied.**
     *
     * A 4:4 crop with the bias the painter already applies upward, because every
     * painting in the set puts the head in the top third and a centred cover
     * crop reliably decapitates it — which is the whole reason that option
     * exists.
     *
     * The mount is the load-bearing half and this used to be a `drawImage` into
     * a canvas of our own. `paintLeaderPortrait` returns a canvas that is *alive*:
     * card paintings decode asynchronously, so the first paint is the renderer's
     * deliberate placeholder and the canvas re-paints itself once `onArtLoaded`
     * fires for its card. Blitting it captured that first frame and threw the
     * subscription away, so the profile showed the procedural stand-in forever.
     *
     * Measured on a seeded account whose most-played leader is `idols-dj-kilowatt`
     * — a card with a painting sitting in `public/assets/art` — the avatar
     * sampled a flat mean of 185 across the disc, which is the placeholder's
     * hatching and not a face. Every other consumer in the game (the lobby, the
     * queue, sign-in, the starter picker) appends the canvas; this was the only
     * one that copied out of it, and it was the only one showing a placeholder.
     */
    const faceSlot = root.querySelector<HTMLElement>("#profile-face");
    if (faceSlot && face) {
      faceSlot.replaceChildren(
        paintLeaderPortrait(face, { width: 200, aspect: 1, bias: 0.16, scrim: 0.25, className: "profile-face-art" })
      );
    }

    const backCanvas = root.querySelector<HTMLCanvasElement>("#profile-back-canvas");
    // the preview shows the house design when nothing is worn, so the panel is
    // never an empty rectangle captioned "your cards show the house back"
    if (backCanvas) paintBack(backCanvas, back, back?.color ?? accent);

    root.querySelector("#profile-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#profile-mastery")?.addEventListener("click", () => callbacks.onMastery());
    root.querySelector("#profile-achievements")?.addEventListener("click", () => callbacks.onAchievements());
    root.querySelector("#profile-history")?.addEventListener("click", () => callbacks.onHistory());
    root.querySelector("#profile-stats")?.addEventListener("click", () => callbacks.onStats());
    root.querySelector("#profile-gallery")?.addEventListener("click", () => callbacks.onGallery());
    root.querySelector("#profile-leaderboards")?.addEventListener("click", () => callbacks.onLeaderboards());

    for (const button of root.querySelectorAll<HTMLElement>(".profile-slot-toggle")) {
      button.addEventListener("click", () => {
        const kind = button.dataset["slot"] as CosmeticKind;
        picking = picking === kind ? null : kind;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const option of root.querySelectorAll<HTMLElement>(".profile-option")) {
      option.addEventListener("click", () => {
        const kind = option.dataset["slot"] as CosmeticKind;
        const id = option.dataset["id"] ?? "";
        if (equipCosmetic(content, kind, id === "" ? null : id)) audio.play("sfx.ui.click");
        picking = null;
        render();
      });
    }

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".profile-links"), ".profile-link"));
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundProfile?: unknown }).hypeboundProfile = {
    owned: () => myCosmetics(content).map((cosmetic) => ({ id: cosmetic.id, kind: cosmetic.kind, name: cosmetic.name })),
    wearing: () =>
      Object.fromEntries(
        WEARABLE_KINDS.map((kind) => [kind, wearing(content, kind)?.id ?? null])
      ),
    equip: (kind: CosmeticKind, id: string | null) => {
      const ok = equipCosmetic(content, kind, id);
      render();
      return ok;
    },
    emotes: () => emoteWheel(content),
    face: () => faceOf(content)?.id ?? null,
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      bag.run();
      delete (window as unknown as { hypeboundProfile?: unknown }).hypeboundProfile;
    },
  };
}
