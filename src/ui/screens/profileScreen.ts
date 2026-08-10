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
 *
 * ## The name, and why it was not a sync bug
 *
 * The owner reported *"can't edit profile name and it should be linked to the
 * account"*, which reads as two faults. It was one. `displayName` had **no
 * writer anywhere in the source** — `defaults()` stamped "New Creator", the
 * lobby and this header drew it, and nothing in forty-nine screens ever assigned
 * it. The account half needed no mechanism at all: `displayName` is a field of
 * `PlayerProfile`, `profileStore` is the `profile` section of `cloudSaves.ts`,
 * and that section already makes the checksum-verified, `If-Match`-guarded round
 * trip. The name could not travel because it could not change.
 *
 * So this screen adds the writer and nothing else. It does not invent a name
 * endpoint, and it does not keep a second record of which account a name belongs
 * to — the save it lives in *is* the account's copy, and a second record of that
 * fact would be free to disagree with the first.
 *
 * Two decisions in here are worth reading off the code rather than inferring:
 *
 * **The Save button's loading state is real work, not a flourish.** A6 asks for
 * six interaction states and `loading` is the one nobody can honestly fake: the
 * write itself is synchronous localStorage. When there *is* an account, the
 * button holds `data-state="loading"` across an actual `syncNow()` — so the
 * state means "your name is going up right now" and the sentence underneath it
 * afterwards is a report rather than a promise. Signed out, no import happens,
 * no request is made and the button never enters the state, because the privacy
 * screen promises offline play transmits nothing and a rename is not an
 * exception to it.
 *
 * **The header repaints when the store changes, and not while you are typing.**
 * A name pulled down from the account on this screen has to appear on it; a
 * re-render mid-keystroke would eat the caret. The subscription therefore checks
 * `editing` first and compares the name before doing anything, so an unrelated
 * profile write — a match landing, a mission claimed — never repaints the
 * screen at all.
 *
 * The layout of the editor is inline rather than in `data/rooms.css` because
 * this pass owns the screen and not the domain's stylesheet. Everything visual
 * comes from the shared kit — `.field-group`, `.field`, `.field-note`, `.act`
 * and the three materials — and the inline rules are only where the pieces sit.
 */

import type { CardDef, ContentIndex, FactionId } from "../../engine/types";
import type { Screen } from "../shell";
import type { Cosmetic, CosmeticKind } from "../../game/cosmetics";
import { WEARABLE_KINDS } from "../../game/cosmetics";
import {
  achievementBoard,
  achievementsUnclaimed,
  checkDisplayName,
  DEFAULT_DISPLAY_NAME,
  DISPLAY_NAME_MAX,
  displayNameLength,
  equipCosmetic,
  emoteWheel,
  factionMastery,
  getProfile,
  myCosmetics,
  profileStore,
  setDisplayName,
  wearing,
  xpForLevel,
} from "../../save/profile";
import { currentAccount } from "../../auth/account";
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
  railCard,
  rankMark,
  room,
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

/**
 * Where the editor's pieces sit — and only that.
 *
 * Grouped and named so it is obvious this is placement rather than decoration,
 * and so the next pass can lift the four of them into `data/rooms.css`
 * unchanged. Not one of them declares a colour, a border, a radius or a shadow:
 * those all arrive from `.field`, `.field-group`, `.field-note` and the three
 * materials, which is what stops this control from being a fifth opinion about
 * what an input looks like.
 *
 * `min-width: 0` on the input is the one that is not obvious. It is a flex item
 * inside a `min-width: 0` column, and without it a long name sets the input's
 * intrinsic width and pushes Save and Cancel off the right-hand edge of a 390px
 * viewport — the fourth unreachable control this effort would have shipped.
 */
const NAME_ROW = "display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;min-width:0";
const NAME_FORM = "margin:0;max-width:34rem";
const NAME_LABEL_ROW = "display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-2);min-width:0";
const NAME_CONTROLS = "display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;min-width:0";
const NAME_INPUT = "flex:1 1 9rem;min-width:0";

/** How long to wait for the upload before saying so, rather than spinning forever. */
const NAME_PUSH_TIMEOUT_MS = 6000;

/** The status line under the name: what it says, and whether it is a fault. */
interface NameStatus {
  text: string;
  tone: "hint" | "error" | "done";
}

/**
 * Where this name currently lives, said without overclaiming.
 *
 * The distinction the copy has to hold is between "on your account" and "on its
 * way to your account", because the upload is a 30-second debounce on a network
 * that may not be there. Signed out it is neither, and saying so is the honest
 * version of the privacy screen's promise rather than a nag.
 *
 * It deliberately does **not** print the email, even though `signInScreen.ts`
 * does and the account object is right here. This is the screen a player
 * screenshots and streams; "which account am I in" is a question the sign-in
 * screen already answers, and the question this line exists to answer is where
 * the name is stored. One address on a stream overlay is not worth it.
 *
 * The untouched-default case gets its own sentence, because `"New Creator"` is
 * not a name somebody chose — it is the placeholder `defaults()` stamps, and
 * until today it was the only name the game could hold. Saying so once, on the
 * screen with the control on it, is the difference between a player discovering
 * the feature and a player assuming it still does not exist.
 */
function whereTheNameLives(current: string): NameStatus {
  if (current === DEFAULT_DISPLAY_NAME) {
    return {
      text: currentAccount()
        ? "New Creator is the name the game gave you. Pick your own and it travels with your account."
        : "New Creator is the name the game gave you. Pick your own — and sign in, and it travels with your account.",
      tone: "hint",
    };
  }
  return currentAccount()
    ? {
        text: "Signed in — your name is part of the save your account carries, so it shows on any device you sign in on.",
        tone: "hint",
      }
    : {
        text: "Saved on this device. Sign in and the name moves onto your account, so every device you play on shows it.",
        tone: "hint",
      };
}

export function createProfileScreen(content: ContentIndex, callbacks: ProfileCallbacks): Screen {
  const root = document.createElement("div");
  /**
   * `d-hall` re-cuts this screen from a column into a room.
   *
   * See the long note at the top of `data/hall.css`. What changes here is only
   * where things go: the five record links and the emote wheel move out of the
   * scrolling stack and onto the right-hand wall, where they are a persistent
   * navigation column rather than the third and fifth slabs of a document. The
   * locker and the mastery tracks — the two things a player came here to *read* —
   * keep the main column and finally have it to themselves.
   */
  root.className = "screen profile-screen d-hall";

  /** which slot's picker is open, or null */
  let picking: CosmeticKind | null = null;
  /** true while the name editor is open, which suppresses the store repaint */
  let editing = false;
  /** the last name this screen painted, so an unrelated profile write is a no-op */
  let painted = getProfile().displayName;
  /** what the line under the name currently says, or null for "where it lives" */
  let status: NameStatus | null = null;
  /** set on the way out, so a sync that lands after the screen has gone stays quiet */
  let gone = false;
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

    /**
     * The name: a heading with a way in, or the way in opened.
     *
     * The heading keeps its class and its markup exactly, because
     * `rooms.css`'s `clamp(1.7rem, 3.4vw, 2.4rem)` on `.profile-name` is what
     * makes it the largest type on the screen and this is not the pass that
     * relitigates that. What is new is the row around it and a chip that reads
     * as an action, in the same material the four cosmetic slots use for
     * "Change" — because renaming yourself is the same kind of act as changing
     * your card back, and giving it a louder control would rank it above the
     * PLAY button on the lobby.
     *
     * The status line is present in **both** states, always, and never
     * conditionally rendered. It is the `aria-live` region the validator writes
     * into, and a live region that is inserted at the moment it first has
     * something to say is a live region screen readers are entitled to ignore.
     */
    const nameBlock = (name: string): string => {
      const line = status ?? whereTheNameLives(name);
      const note = `<p class="field-note" id="profile-name-status" role="status" aria-live="polite"
                       ${line.tone === "error" ? 'data-tone="error" style="color:var(--danger)"' : ""}>${esc(
                         line.text
                       )}</p>`;

      if (!editing) {
        return `
          <div class="profile-name-row" style="${NAME_ROW}">
            <h2 class="profile-name t-display" id="profile-name">${esc(name)}</h2>
            <button type="button" class="mat-chip act r-chip" id="profile-rename"
                    aria-label="Change your display name">
              ${icon("edit", 14)} Rename
            </button>
          </div>
          ${note}`;
      }

      return `
        <form class="field-group profile-name-form" id="profile-name-form" novalidate style="${NAME_FORM}">
          <div style="${NAME_LABEL_ROW}">
            <label class="t-label" for="profile-name-input">Display name</label>
            <span class="t-label num" id="profile-name-count" aria-hidden="true">${displayNameLength(
              name
            )}/${DISPLAY_NAME_MAX}</span>
          </div>
          <div style="${NAME_CONTROLS}">
            <input class="field" type="text" id="profile-name-input" name="display-name"
                   value="${esc(name)}"
                   maxlength="${DISPLAY_NAME_MAX * 2}"
                   autocomplete="nickname" autocapitalize="words" spellcheck="false"
                   enterkeyhint="done" aria-describedby="profile-name-status"
                   style="${NAME_INPUT}">
            <button type="submit" class="mat-hero act r-chip" id="profile-name-save">
              ${icon("check", 14)} Save
            </button>
            <button type="button" class="mat-panel act r-chip" id="profile-name-cancel">
              ${icon("close", 14)} Cancel
            </button>
          </div>
          ${note}
        </form>`;
    };

    const link = (id: string, label: string, iconId: Parameters<typeof icon>[0], badgeCount = 0): string => `
      <button type="button" class="mat-panel act r-tile profile-link d-enter" id="${id}">
        ${icon(iconId, 20)}
        <span>${esc(label)}</span>
        ${badgeCount > 0 ? `<span class="d-badge">${icon("chest", 12)}<span class="num">${count(badgeCount)}</span></span>` : ""}
        ${icon("chevron-right", 16, "profile-link-go")}
      </button>`;

    root.innerHTML = `
      ${room({ accent, lit: 0.85 })}
      <header class="screen-header">
        <button class="btn btn-ghost" id="profile-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Profile</h1>
      </header>

      <main class="profile-body data-body">
        <section class="mat-panel d-hero profile-identity" style="--profile-accent:${esc(accent)};--hall-accent:${esc(
          accent
        )}">
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
            ${nameBlock(profile.displayName)}
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

        <section class="mat-panel profile-cosmetics">
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

        <section class="mat-panel profile-mastery">
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
      </main>

      <section class="d-rail" aria-label="Your records">
        ${railCard({
          label: "Your records",
          className: "profile-rail-links",
          body: `<nav class="profile-links" aria-label="Your records">
              ${link("profile-achievements", "Achievements", "achievement", unclaimed)}
              ${link("profile-history", "Match history", "mode-replays")}
              ${link("profile-stats", "Statistics", "log")}
              ${link("profile-gallery", "Characters", "collection")}
              ${link("profile-leaderboards", "Leaderboards", "mode-ranked")}
            </nav>`,
        })}
        ${railCard({
          label: `Emote wheel · ${count(emotes.length)}`,
          className: "profile-emotes",
          body: `<p class="t-body profile-hint">
              The six you start with are never taken away. Mastery adds to the wheel rather than replacing it.
            </p>
            <ul class="profile-emote-list">
              ${emotes
                .map(
                  (phrase) =>
                    `<li class="profile-emote mat-chip d-enter">${icon("emote", 14)}<span>${esc(phrase)}</span></li>`
                )
                .join("")}
            </ul>`,
        })}
      </section>`;

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

    wireName();

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".profile-links"), ".profile-link"));
  };

  /** Put a sentence under the name without rebuilding the screen around it. */
  const say = (line: NameStatus): void => {
    status = line;
    const node = root.querySelector<HTMLElement>("#profile-name-status");
    if (!node) return;
    node.textContent = line.text;
    if (line.tone === "error") {
      node.dataset["tone"] = "error";
      node.style.color = "var(--danger)";
    } else {
      delete node.dataset["tone"];
      node.style.removeProperty("color");
    }
  };

  /**
   * Close the editor and hand focus back to the control that opened it.
   *
   * Without the second half, saving or cancelling drops focus onto `<body>` and
   * a keyboard player is returned to the top of a screen that is 2,000px tall on
   * a phone. It is the cheapest half of this whole feature and the one most
   * often left out.
   */
  const closeEditor = (line: NameStatus | null): void => {
    editing = false;
    status = line;
    render();
    root.querySelector<HTMLElement>("#profile-rename")?.focus();
  };

  /**
   * Send the account's save up now, rather than in thirty seconds.
   *
   * `cloudSaves.ts` already subscribes to this store and debounces uploads by
   * `SYNC_DEBOUNCE_MS`, which is right for a deck being rearranged and wrong for
   * the one write a player makes and then immediately goes to check on another
   * device. So this is a nudge at the existing mechanism, not a second one: the
   * same `syncNow`, the same checksum gate, the same `If-Match`. If it has
   * nothing to send it sends nothing.
   *
   * Three things it deliberately does:
   *
   * - **Imported dynamically, and only when signed in.** A signed-out profile
   *   screen must not so much as pull the network module into its graph, which
   *   is what `scripts/verify-fairness.mjs` checks by recording every request
   *   the page makes.
   * - **Raced against a deadline.** `fetch` has no timeout, and a captive portal
   *   answers neither way. A button stuck in `loading` forever is worse than a
   *   sentence saying the upload has not happened yet.
   * - **Reports rather than promises.** `awaitingChoice` is not a failure — it
   *   means the account is holding a save this device has not reconciled with,
   *   and the only honest thing to say is which screen resolves that.
   */
  const pushToAccount = async (): Promise<NameStatus> => {
    const later: NameStatus = {
      text: "Saved. It will reach your account the next time this device syncs.",
      tone: "done",
    };
    try {
      const { syncNow } = await import("../../save/cloudSaves");
      const report = await Promise.race([
        syncNow(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), NAME_PUSH_TIMEOUT_MS)),
      ]);
      if (!report) return later;
      if (report.awaitingChoice.length > 0) {
        return {
          text: "Saved here. Your account is holding a different save — open Cloud saves to choose which one wins.",
          tone: "error",
        };
      }
      if (report.pushed.includes("profile")) {
        return {
          text: "Saved to your account. Your other devices pick it up the next time they load.",
          tone: "done",
        };
      }
      if (report.problems.length > 0) return later;
      // Nothing to push means the account already agrees with this device.
      return { text: "Saved to your account.", tone: "done" };
    } catch {
      return later;
    }
  };

  /**
   * The whole interaction, attached fresh after every render.
   *
   * Validation runs on **every keystroke and on submit**, from the one pure
   * function in `save/profile.ts`, so the sentence a player reads while typing
   * and the sentence they read when refused cannot drift apart. Save is never
   * disabled for an invalid value: a dead button is a refusal with no reason
   * attached, which is exactly what the owner reported about the old screen.
   */
  function wireName(): void {
    root.querySelector<HTMLElement>("#profile-rename")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      editing = true;
      status = { text: `Letters, numbers, spaces and emoji, up to ${DISPLAY_NAME_MAX} characters.`, tone: "hint" };
      render();
      const input = root.querySelector<HTMLInputElement>("#profile-name-input");
      input?.focus();
      input?.select();
    });

    const form = root.querySelector<HTMLFormElement>("#profile-name-form");
    if (!form) return;

    const input = root.querySelector<HTMLInputElement>("#profile-name-input");
    const counter = root.querySelector<HTMLElement>("#profile-name-count");
    const save = root.querySelector<HTMLButtonElement>("#profile-name-save");
    const cancel = root.querySelector<HTMLButtonElement>("#profile-name-cancel");
    if (!input || !save) return;

    /** Returns the verdict so submit can reuse exactly what the keystroke saw. */
    const review = (announce: boolean): ReturnType<typeof checkDisplayName> => {
      const verdict = checkDisplayName(input.value);
      const length = displayNameLength(verdict.name);
      if (counter) {
        counter.textContent = `${length}/${DISPLAY_NAME_MAX}`;
        /*
         * The counter turns only on **length**, not on validity. A name that is
         * refused for having no letters in it is not a name that is too long,
         * and a count that goes red for it is a second signal pointing at the
         * wrong thing — which is how a player ends up deleting characters to fix
         * a fault that had nothing to do with how many there were.
         */
        counter.style.color = length > DISPLAY_NAME_MAX ? "var(--danger)" : "";
      }
      input.setAttribute("aria-invalid", String(!verdict.ok));
      if (!verdict.ok) say({ text: verdict.reason, tone: "error" });
      else if (announce) {
        say({
          text: verdict.cleaned
            ? "Invisible characters and extra spaces were removed. Save to keep it."
            : `Letters, numbers, spaces and emoji, up to ${DISPLAY_NAME_MAX} characters.`,
          tone: "hint",
        });
      }
      return verdict;
    };

    input.addEventListener("input", () => review(true));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeEditor(null);
    });
    cancel?.addEventListener("click", () => closeEditor(null));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const verdict = review(false);
      if (!verdict.ok) {
        // Said, not merely refused: the reason is already under the field and
        // the caret goes back to the thing that has to change.
        say({ text: verdict.reason, tone: "error" });
        input.focus();
        return;
      }

      setDisplayName(input.value);
      painted = getProfile().displayName;
      audio.play("sfx.ui.click");

      if (!currentAccount()) {
        closeEditor({ text: "Saved on this device.", tone: "done" });
        return;
      }

      /**
       * The sixth state, and the only place in this control where it is true.
       * The field goes with it — an input a player can still type into while its
       * value is being uploaded is an input that will disagree with what landed.
       */
      save.dataset["state"] = "loading";
      save.disabled = true;
      input.disabled = true;
      if (cancel) cancel.disabled = true;
      say({ text: "Sending it to your account…", tone: "hint" });

      void pushToAccount().then((line) => {
        // The screen may have been navigated away from while that was in the
        // air. Repainting a detached tree is harmless; stealing focus is not.
        if (gone || !root.isConnected) return;
        closeEditor(line);
      });
    });
  }

  render();

  /**
   * A name that arrives from the account has to show up here.
   *
   * This is the half of "linked to the account" a player actually sees: device B
   * pulls the profile section and the header is already open. Three guards, and
   * each one is a bug that would otherwise be reported as something else — never
   * while the editor is open (it would eat the caret mid-word), never when the
   * name did not change (a match landing would restart every counter on the
   * screen), and never after dispose.
   */
  const stopWatchingName = profileStore.subscribe((profile) => {
    if (gone || editing) return;
    if (profile.displayName === painted) return;
    painted = profile.displayName;
    status = null;
    render();
  });

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
    /**
     * The name half of the hook.
     *
     * `rename` deliberately goes through **`setDisplayName`**, the same function
     * the form does, rather than writing the store — a probe that bypasses the
     * validator measures a code path no player can take, which is how an
     * instrument in this project comes to report a pass for something broken.
     * `type` is the one that goes through the DOM, so an automated check can
     * assert on the live validation without knowing the markup.
     */
    name: () => getProfile().displayName,
    editing: () => editing,
    check: (value: string) => checkDisplayName(value),
    rename: (value: string) => setDisplayName(value),
    open: () => root.querySelector<HTMLElement>("#profile-rename")?.click(),
    type: (value: string) => {
      const input = root.querySelector<HTMLInputElement>("#profile-name-input");
      if (!input) return false;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    submit: () => root.querySelector<HTMLFormElement>("#profile-name-form")?.requestSubmit(),
    status: () => root.querySelector<HTMLElement>("#profile-name-status")?.textContent?.trim() ?? "",
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      gone = true;
      stopWatchingName();
      bag.run();
      delete (window as unknown as { hypeboundProfile?: unknown }).hypeboundProfile;
    },
  };
}
