/**
 * The reward moment.
 *
 * This file exists because the domain review scored these five screens 3/10 —
 * the lowest in the game — and named one cause: *the reward moment does not
 * exist as a moment.* Opening a five-card Merch Drop was a 180ms opacity
 * cross-fade of five 150px thumbnails inside a small dialog floating in a dimmed
 * void, over in about 1.2 seconds, with **no player input at all**. A ten-pull
 * on the gacha banner — the single most celebrated interaction in the genre —
 * rendered as a wrapped row of 24px text chips below the fold, in which a
 * Legendary was the same size as the nine commons beside it.
 *
 * What the reference games do, and what this rebuilds:
 *
 * - **Hearthstone** hands you a physical pack, you tear it, five illustrated
 *   backs fan onto the table, each one flips on *your* click, a rarity gem
 *   cracks and a legendary flashes the room.
 * - **MTG Arena** rotates each card in on a Y axis behind a specular sweep.
 * - **Gwent's** keg shatters.
 *
 * ## The beats, and their budget
 *
 * §3 puts a set-piece at 500–900ms *per beat*, which is the number this is built
 * against. A pack opening is allowed to take its time; each beat is not.
 *
 * | beat | what happens | ms |
 * |------|--------------|----|
 * | 0 anticipation | the pack floats, breathes and catches the light; nothing advances until the player acts | until input |
 * | 1 tear | the pack flares and blows apart; the cards deal out from where it was, face down, 55ms apart | 560 + 55n |
 * | 2 reveal | one card at a time turns on a real 3D rotateY, rarity escalating: aura, burst, rays, room flash | 480 each |
 * | 3 summary | the footer rises, the counts ticker, the actions arm | 260 |
 *
 * ## Two decisions worth defending
 *
 * **The face-down card is identical for every rarity.** The old screen put the
 * gold glow on `.reveal-back` and then set `opacity: 0` on it the instant the
 * card turned — so the game told you what you had before you flipped, and gave
 * the revealed Legendary nothing at all. That is exactly backwards, and it
 * deletes the only tension the mechanic has. Every rarity treatment in here
 * lands on `.reveal-slot.shown` and not one pixel of it before.
 *
 * **The best card is held for last.** Sorted ascending by rarity, so a pull
 * escalates rather than peaking at card two and then showing you four commons.
 * Every gacha in the genre does this and it costs one comparator.
 *
 * ## The legacy hooks are load-bearing
 *
 * `.shop-reveal`, `.reveal-cards`, `.reveal-slot`, `.reveal-slot.shown`,
 * `.reveal-front canvas`, `.reveal-tag` and `#reveal-done` are what
 * `scripts/verify-shop.mjs` drives in a real browser, and that check is part of
 * the contract. They are kept on the rebuilt elements deliberately: the browser
 * check should be able to prove that a *rebuilt* screen still charges the right
 * price and delivers the right cards, which is the whole point of having it.
 *
 * One consequence shapes the markup: the check clicks the centre of
 * `.reveal-cards`, so the pack has to be a **descendant** of that element rather
 * than a sibling floating over it, or the click is intercepted and a rebuild
 * that works perfectly fails its own verification.
 */

import type { CardDef, ContentIndex, Rarity } from "../../../engine/types";
import type { CardBackStyle } from "../../cosmetics/emblem";
import { renderCardToCanvas } from "../../cardRenderer/renderCard";
import { audio } from "../../../audio/audio";
import { icon, type IconId } from "../../art/uiIcons";
import { DUR, motionEnabled, scaledDuration, tickerTo } from "../../motion";
import { num as formatNumber } from "../../format";
import {
  COIN,
  HOUSE_BACK,
  cardBackThumb,
  esc,
  syncWallets,
  type CoinKind,
} from "./rewardKit";
import { installRewardsTheme } from "./rewardsTheme";

/* -------------------------------------------------------------------------
   the room the reveal happens in
   ------------------------------------------------------------------------- */

/**
 * A reveal is a set-piece, and a set-piece owns the screen.
 *
 * Photographed over the shop with five cards turning, the screen behind this
 * overlay was still being read: "The Second Funeral", "Full probability
 * disclosures" and "Open a free Drop — 5 left" were all legible through it.
 * Measured off the capture, the shop's headings came back at a luminance of
 * 4.4–11.2 against a veil of 23.0 — small in absolute terms and *plainly* visible,
 * because near black is where the eye's contrast sensitivity is highest and
 * every one of those shapes was still sharp.
 *
 * Two things were wrong and only one of them was the number.
 *
 * 1. **The veil was 97.2% opaque, not opaque.** `rgb(3 1 8 / 0.972)` lets 2.8%
 *    of a 232-luminance heading through, which is a value of about six — and six
 *    on three reads as text. There is nothing behind a pack opening that anybody
 *    needs, so there is no argument for the remaining 2.8%.
 * 2. **`backdrop-filter: blur(26px)` was not blurring anything.** If it were,
 *    the bleed-through would be a smear rather than words; it is words. `.rw-open`
 *    animates its own opacity, which makes it a backdrop root in Blink, and a
 *    backdrop root is exactly the thing that empties a descendant's backdrop. So
 *    the sheet was paying for a full-screen blur every frame of the set-piece and
 *    getting a no-op for it. It is switched off here rather than fixed, because an
 *    opaque field has no backdrop worth filtering.
 *
 * What replaces it is a *room* rather than a darker sheet: a wall lit on the
 * 315° vector like every other surface in the game, a floor the cards stand on,
 * a pool of the pull's own accent under them, a vignette and module B's grain.
 * §1 bans a flat fill on anything larger than an icon, and "the reveal now owns
 * the screen" would be a poor trade if what it owned were a rectangle of black.
 *
 * ## Why this sheet lives here and not in `rewardsTheme.ts`
 *
 * That file is the domain's stylesheet and is the right long-term home for these
 * eleven rules. It is also being edited by somebody else this wave. Installing
 * from here is a no-merge-conflict way to land the fix; it goes into the head
 * *after* `installRewardsTheme()`, so the two low-tier and high-contrast rules
 * that out-specify a bare `.rw-open-veil` are answered at their own specificity
 * rather than by `!important`. Fold it into the sheet whenever the two files are
 * next in one pair of hands.
 */
const ROOM_STYLE_ID = "hb-reveal-room";

const ROOM_CSS = `
/* Opaque. Written at three specificities because the theme sheet lowers the
   alpha again for the low tier, and that rule is (0,3,0). */
.rw-open-veil,
:root .rw-open-veil,
:root[data-gfx-tier="low"] .rw-open-veil {
  background-color: var(--bg-void);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* The room: wall, floor, vignette. Behind the accent pool and the glow, in
   front of nothing at all, which is the point. */
.rw-open-room {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(128% 92% at 50% 44%, transparent 38%, rgb(0 0 0 / 0.66) 100%),
    linear-gradient(180deg, rgb(4 2 10 / 0) 52%, rgb(15 9 30 / 0.85) 79%, rgb(3 1 8 / 0.98) 100%),
    linear-gradient(var(--light-sweep, 135deg), rgb(30 20 56 / 0.5), rgb(5 3 11 / 0) 58%);
}

/* The pool the cards stand in, in whatever the best card so far is worth. It
   reads --rw-accent, which \`flip\` re-points at the rarity ink, so a legendary
   lights the floor as well as the room. */
.rw-open-room::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    48% 32% at 50% 70%,
    color-mix(in srgb, var(--rw-accent, #b56cff) 20%, transparent),
    transparent 74%
  );
  transition: background 620ms var(--ease-arrive, ease-out);
}

/* Module B's tile, not a second grain generator. §1: 2–6% so the field is not
   mathematically smooth. */
.rw-open-room::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--tex-grain-hero, none);
  background-size: var(--tex-grain-hero-size, auto);
  opacity: 0.5;
}

:root[data-contrast="high"] .rw-open-room::after { opacity: 0; }
`;

/**
 * Idempotent by id and not by a module-level flag, for the same reason
 * `installRewardsTheme` is: a hot reload replaces the module and not the
 * document, and two copies of a sheet is two copies of everything in it.
 */
function installRevealRoom(doc: Document | undefined = globalThis.document): void {
  if (!doc || doc.getElementById(ROOM_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ROOM_STYLE_ID;
  style.textContent = ROOM_CSS;
  doc.head.append(style);
}

/* -------------------------------------------------------------------------
   the shape of a reveal
   ------------------------------------------------------------------------- */

export interface RevealEntry {
  cardId: string;
  rarity: Rarity;
  isNew?: boolean | undefined;
  convertedToSignal?: number | undefined;
  featured?: boolean | undefined;
  wishlisted?: boolean | undefined;
  /** the pity guarantee fired for this card */
  guaranteed?: boolean | undefined;
}

export interface PackSummaryItem {
  label: string;
  value?: number | undefined;
  coin?: CoinKind | undefined;
  icon?: IconId | undefined;
}

export interface PackOpeningOptions {
  content: ContentIndex;
  cards: readonly RevealEntry[];
  /** the small caps line above the title */
  eyebrow: string;
  /** the display line: "Five cards", "Ten pulls" */
  title: string;
  /** what the pack is called on its hint, in the imperative */
  tearLabel?: string;
  /** the room's light, as a hex; the banner passes its own palette */
  accent?: string;
  /** the object the player tears, and the back every card wears */
  back?: CardBackStyle;
  summary?: readonly PackSummaryItem[];
  /** a sentence under the summary — cosmetics granted, conversions explained */
  note?: string;
  onCollection?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** wallet chips to count up once the reveal is over */
  walletHost?: ParentNode | undefined;
}

export interface PackOpening {
  /** turn everything face up now */
  revealAll: () => void;
  close: () => void;
  readonly element: HTMLElement;
}

/* -------------------------------------------------------------------------
   rarity
   ------------------------------------------------------------------------- */

const RARITY_RANK: Readonly<Record<Rarity, number>> = { common: 0, rare: 1, epic: 2, legendary: 3 };

const RARITY_INK: Readonly<Record<Rarity, string>> = {
  common: "#c9c3dc",
  rare: "#4d9fff",
  epic: "#c168ff",
  legendary: "#ffb43d",
};

/** How hard the room reacts to a card of each rarity, 0–1. */
const RARITY_GLOW: Readonly<Record<Rarity, number>> = { common: 0, rare: 0.22, epic: 0.55, legendary: 1 };

/**
 * The sting, per rarity, on the frame the face becomes visible.
 *
 * There are exactly two pack sounds in the manifest and there is no budget for
 * more, so the tiering is done with gain and playback rate rather than with four
 * files: a Legendary is the same cue slowed to 0.82 and played at full, which
 * lands lower and longer than the Rare's 1.12. A chime on every common would
 * make the rare reveal mean nothing, which is the opposite of what the sound is
 * for — so a common gets the UI tick and not the pack cue at all.
 */
function sting(rarity: Rarity): void {
  switch (rarity) {
    case "common":
      audio.play("sfx.ui.click", { volume: 0.3 });
      return;
    case "rare":
      audio.play("sfx.pack.rareReveal", { volume: 0.55, rate: 1.12 });
      return;
    case "epic":
      audio.play("sfx.pack.rareReveal", { volume: 0.8, rate: 0.98 });
      return;
    case "legendary":
      audio.play("sfx.pack.rareReveal", { volume: 1, rate: 0.82 });
  }
}

/* -------------------------------------------------------------------------
   timing
   ------------------------------------------------------------------------- */

const DEAL_STEP = 55;
const DEAL_MS = 560;
const FLIP_MS = 480;
/** How long the player is given before the reveal starts playing itself. */
const IDLE_BEFORE_AUTO = 1800;
/** And how fast it goes once it has: overlapping, never a queue. */
const AUTO_STEP = 620;
/** A "reveal all" cascade is faster than the auto one — it was asked for. */
const RUSH_STEP = 110;

/* -------------------------------------------------------------------------
   the component
   ------------------------------------------------------------------------- */

let openInstance: PackOpening | null = null;

/**
 * Open a pack. One at a time, always on `document.body`.
 *
 * On the body rather than inside the screen because every claim and purchase
 * path in this domain re-renders its screen with `innerHTML`, and an overlay
 * inside that tree is destroyed mid-animation. It is also the honest home for
 * §2's overlay plane: this is the only thing on screen, and everything behind it
 * is blurred and darkened rather than merely covered.
 */
export function openPack(options: PackOpeningOptions): PackOpening {
  installRewardsTheme();
  // ...and then the room, which has to land after the sheet it out-specifies.
  installRevealRoom();
  openInstance?.close();

  const cards = orderForDrama(options.cards);
  const accent = options.accent ?? "#b56cff";
  const back = options.back ?? HOUSE_BACK;
  const backArt = cardBackThumb(back, 0.55);
  const columns = Math.min(5, Math.max(1, cards.length));
  const rows = Math.ceil(cards.length / columns);

  const overlay = document.createElement("div");
  overlay.className = "rw-open shop-reveal";
  overlay.id = "shop-reveal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${options.eyebrow} — ${options.title}`);
  overlay.style.setProperty("--rw-accent", accent);

  overlay.innerHTML =
    `<div class="rw-open-veil"></div>` +
    `<div class="rw-open-room" aria-hidden="true"></div>` +
    `<div class="rw-open-glow"></div>` +
    `<header class="rw-open-head">` +
    `<div class="rw-open-title">` +
    `<span class="t-label">${esc(options.eyebrow)}</span>` +
    `<h2 class="t-display" style="font-size:var(--fs-xl)">${esc(options.title)}</h2>` +
    `</div>` +
    `<div class="rw-open-count" aria-hidden="true">` +
    cards.map(() => `<span class="rw-pip"></span>`).join("") +
    `</div>` +
    `</header>` +
    `<div class="rw-stage">` +
    `<div class="reveal-cards" style="--rw-cols:${columns}">` +
    cards.map((entry, index) => slotMarkup(options.content, entry, index, cards.length, backArt)).join("") +
    packMarkup(backArt, options.tearLabel ?? "Tear it open") +
    `</div>` +
    hintMarkup(options.tearLabel ?? "Tear it open") +
    `</div>` +
    `<footer class="rw-open-foot mat-panel">` +
    `<div class="rw-open-summary">${summaryMarkup(options)}</div>` +
    `<div class="rw-open-actions">` +
    `<button class="mat-panel act rw-back" id="reveal-all" type="button">${icon("skip-end")}<span>Reveal all</span></button>` +
    (options.onCollection
      ? `<button class="mat-panel act rw-back" id="reveal-collection" type="button">${icon("collection")}<span>Collection</span></button>`
      : "") +
    `<button class="mat-hero act rw-back" id="reveal-done" type="button" disabled>${icon("check")}<span>Done</span></button>` +
    `</div>` +
    `</footer>`;

  document.body.append(overlay);

  const stage = overlay.querySelector<HTMLElement>(".rw-stage")!;
  const grid = overlay.querySelector<HTMLElement>(".reveal-cards")!;
  const glow = overlay.querySelector<HTMLElement>(".rw-open-glow")!;
  const foot = overlay.querySelector<HTMLElement>(".rw-open-foot")!;
  const pack = overlay.querySelector<HTMLElement>(".rw-pack");
  const hint = overlay.querySelector<HTMLElement>(".rw-pack-hint");
  const pips = [...overlay.querySelectorAll<HTMLElement>(".rw-pip")];
  const slots = [...overlay.querySelectorAll<HTMLElement>(".reveal-slot")];
  const doneButton = overlay.querySelector<HTMLButtonElement>("#reveal-done")!;
  const allButton = overlay.querySelector<HTMLButtonElement>("#reveal-all")!;

  const returnFocus = document.activeElement as HTMLElement | null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): void => {
    const id = globalThis.setTimeout(() => {
      timers.delete(id);
      fn();
    }, Math.max(0, ms));
    timers.add(id);
  };

  let torn = false;
  let closed = false;
  let best = -1;
  const shown = new Set<number>();
  let autoTimer: ReturnType<typeof setTimeout> | null = null;

  /* --- layout ----------------------------------------------------------- */

  /**
   * How big a card can be here.
   *
   * Both axes, because the height is what actually binds: at 844×390 — a phone
   * in landscape, which every screen has to work at — five cards across is
   * limited by 390px of viewport minus the header, the footer and the room the
   * captions need under each card, not by width. Sizing on width alone produces
   * a grid that is beautiful at 1600×900 and clipped on a phone.
   */
  const fit = (): void => {
    const gap = 14;
    const width = stage.clientWidth || overlay.clientWidth || 1280;
    /*
     * The hint is a row of the stage, not an overlay on it, so the grid gets the
     * stage minus whatever the hint is currently occupying — measured rather
     * than assumed, because it is two lines while the pack is closed and two
     * different lines afterwards, and it is removed entirely at the summary.
     */
    const hintBox = hint?.isConnected ? hint.getBoundingClientRect().height : 0;
    const height = (stage.clientHeight || 420) - hintBox;
    const byWidth = (width - gap * (columns - 1) - 24) / columns;
    const byHeight = ((height - gap * (rows - 1) - 34 * rows) / rows) * (512 / 680);
    const size = Math.max(66, Math.min(212, Math.floor(Math.min(byWidth, byHeight))));
    grid.style.setProperty("--rw-card-w", `${size}px`);
  };

  fit();
  const onResize = (): void => fit();
  globalThis.addEventListener("resize", onResize);

  /* --- the faces, drawn once -------------------------------------------- */

  /*
   * Every face is rendered up front, while the pack is still closed and the
   * player is looking at it. The previous implementation rewrote the overlay's
   * `innerHTML` on each of the five steps, which re-rendered every
   * already-revealed card from scratch — fifteen `renderCardToCanvas` passes for
   * a five-card pack — and, worse, structurally prevented per-card animation,
   * because each tick destroyed and recreated the DOM of every card that had
   * already turned. Nothing here is ever rebuilt; the only thing that changes on
   * a flip is one class.
   */
  const cardWidth = Number.parseInt(grid.style.getPropertyValue("--rw-card-w"), 10) || 168;

  const paintFace = (index: number): void => {
    const entry = cards[index];
    const card = entry ? (options.content.cards[entry.cardId] as CardDef | undefined) : undefined;
    const face = slots[index]?.querySelector<HTMLElement>(".reveal-front");
    if (!entry || !card || !face || face.childElementCount > 0) return;
    const canvas = renderCardToCanvas(card, Math.round(cardWidth * 1.15), {
      premium: entry.rarity === "legendary",
    });
    /*
     * `renderCardToCanvas` writes an inline `style.width` and `style.height`,
     * and an inline style beats a stylesheet rule — so `.reveal-front > canvas
     * { width: 100% }` was silently losing and every card was drawn 15% larger
     * than the slot holding it, overflowing its own caption. Overriding the
     * inline value is the only fix that does not involve `!important`.
     */
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    face.append(canvas);
  };

  /*
   * One card per frame, not five in one go.
   *
   * Measured with a `longtask` observer: rendering all five faces inside the
   * click handler produced a **440ms** task — a visible freeze on the frame the
   * player pressed Buy, which is the worst possible frame to drop. Split across
   * animation frames it is five tasks of about ninety milliseconds, spent during
   * the anticipation beat while the player is looking at a pack that has not
   * moved yet. The first face is painted synchronously so a reveal that is
   * skipped immediately still has something behind it.
   */
  /*
   * Not even the first face is drawn on the click frame.
   *
   * It used to be, with the reasoning that a reveal skipped immediately needs
   * something behind the back — but `flip` already paints on demand for exactly
   * that case, so the synchronous call was insurance against a thing that cannot
   * happen. Measured with a longtask observer, it cost **254ms** on the frame the
   * player pressed Buy, which is the single worst frame in the sequence to drop:
   * the button has depressed, the sound has fired and the screen has not moved.
   * Deferred, the same click costs about ninety, and the face is ready long
   * before the pack has been torn.
   */
  let painting = 0;
  /*
   * Measured: one face at this size costs 150–250ms of main thread, and five in
   * one task came to 440ms. A frame-per-card chain was no better — it simply
   * moved five long tasks into the deal, which is the one beat that must not
   * stutter. So the queue is *slower than the animation*: a card every 260ms,
   * always at least one ahead of the reveal, and `flip` paints on demand for the
   * case where the player skips to the end faster than the queue can run.
   */
  const paintQueue = (): void => {
    if (closed || painting >= cards.length) return;
    paintFace(painting);
    painting += 1;
    later(paintQueue, 260);
  };
  /*
   * 300ms, not 30. The overlay fades in over DUR.ui, and a 200ms card render
   * landing inside that window is a long task on the entrance itself — measured
   * at 211ms starting 66ms after the click, which is the fade. Nothing needs a
   * face until the pack is torn, and the pack cannot be torn until the player
   * acts, so the queue waits for the entrance to finish and then runs through
   * the anticipation beat where there is no deadline at all.
   */
  later(paintQueue, 300);

  /* --- beat 1: the tear -------------------------------------------------- */

  const tear = (): void => {
    if (torn || closed) return;
    torn = true;
    audio.play("sfx.pack.open");
    /*
     * The hint changes job rather than vanishing. Between the deal landing and
     * the first auto-flip there is about a second of stillness that is there on
     * purpose — it is the player's turn — and a stage with nothing on it saying
     * so reads as a hang rather than as an invitation.
     */
    if (hint) hint.innerHTML = `<span class="t-label">Turn them over</span><span class="rw-quiet" style="font-size:var(--fs-xs)">Click a card, or wait and they turn themselves</span>`;

    if (pack) {
      const from = pack.getBoundingClientRect();
      pack.classList.add("rw-torn");
      later(() => pack.remove(), scaledDuration(480) + 40);
      flash(0.14);
      dealFrom(from);
    } else {
      dealFrom(grid.getBoundingClientRect());
    }
    queueAuto(IDLE_BEFORE_AUTO);
  };

  /** Hand every slot the vector from the pack to its own resting place. */
  const dealFrom = (origin: DOMRect): void => {
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    for (const [index, slot] of slots.entries()) {
      const box = slot.getBoundingClientRect();
      const dx = cx - (box.left + box.width / 2);
      const dy = cy - (box.top + box.height / 2);
      slot.style.setProperty("--rw-from-x", `${Math.round(dx)}px`);
      slot.style.setProperty("--rw-from-y", `${Math.round(dy)}px`);
      slot.style.setProperty("--rw-from-r", `${(index - (slots.length - 1) / 2) * 5}deg`);
      slot.style.setProperty("--rw-deal-delay", `${index * DEAL_STEP}ms`);
      slot.classList.remove("rw-pending");
      slot.classList.add("rw-dealing");
    }
    later(() => {
      for (const slot of slots) slot.classList.remove("rw-dealing");
    }, scaledDuration(DEAL_MS) + DEAL_STEP * slots.length + 60);
  };

  /* --- beat 2: the reveal ------------------------------------------------ */

  const flip = (index: number, manual: boolean): void => {
    if (closed || !torn || shown.has(index)) return;
    paintFace(index);
    const slot = slots[index];
    const entry = cards[index];
    if (!slot || !entry) return;
    shown.add(index);
    slot.classList.add("shown");
    const flipper = slot.querySelector<HTMLElement>(".rw-flip");
    flipper?.setAttribute("aria-pressed", "true");
    flipper?.setAttribute("tabindex", "-1");

    /*
     * The sound and the light land on the frame the face becomes visible, which
     * is the halfway point of the rotation and not its start. §7: "sound and
     * visual land on the same frame" — a sting fired at the beginning of a
     * 480ms rotation is a sting for a card the player cannot see yet.
     */
    const half = Math.round(scaledDuration(FLIP_MS) / 2);
    later(() => {
      if (closed) return;
      sting(entry.rarity);
      burst(slot, entry.rarity);
      const rank = RARITY_RANK[entry.rarity];
      if (rank >= 2) flash(entry.rarity === "legendary" ? 0.32 : 0.18);
      const pip = pips[index];
      if (pip) {
        pip.style.setProperty("--rar-key", RARITY_INK[entry.rarity]);
        pip.dataset["on"] = "1";
      }
      if (rank > best) {
        best = rank;
        overlay.style.setProperty("--rw-accent", RARITY_INK[entry.rarity]);
        glow.style.setProperty("--rw-glow", String(RARITY_GLOW[entry.rarity]));
      }
    }, half);

    if (shown.size === slots.length) {
      later(finish, half + 260);
      return;
    }
    queueAuto(manual ? IDLE_BEFORE_AUTO : AUTO_STEP);
  };

  const nextHidden = (): number => slots.findIndex((_, index) => !shown.has(index));

  const queueAuto = (ms: number): void => {
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    if (closed) return;
    autoTimer = globalThis.setTimeout(() => {
      autoTimer = null;
      const index = nextHidden();
      if (index >= 0) flip(index, false);
    }, Math.max(60, scaledDuration(ms) || 60));
  };

  /**
   * Turn everything still face down, fast.
   *
   * A cascade rather than one frame, because ten cards appearing simultaneously
   * is the failure this whole file exists to correct — even when the player has
   * asked to skip, the escalation is what makes the last card the best one.
   */
  const revealAll = (): void => {
    if (!torn) tear();
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    autoTimer = null;
    let step = 0;
    for (const [index] of slots.entries()) {
      if (shown.has(index)) continue;
      later(() => flip(index, false), scaledDuration(RUSH_STEP) * step);
      step += 1;
    }
  };

  /* --- beat 3: the summary ----------------------------------------------- */

  const finish = (): void => {
    if (closed) return;
    hint?.remove();
    foot.classList.add("rw-ready");
    doneButton.disabled = false;
    allButton.disabled = true;
    for (const counter of overlay.querySelectorAll<HTMLElement>("[data-count]")) {
      tickerTo(counter, Number(counter.dataset["count"] ?? "0"), DUR.setpiece);
    }
    if (document.activeElement === document.body || overlay.contains(document.activeElement)) {
      doneButton.focus({ preventScroll: true });
    }
  };

  /* --- effects ----------------------------------------------------------- */

  const burst = (slot: HTMLElement, rarity: Rarity): void => {
    if (!motionEnabled() || rarity === "common") return;
    const spark = document.createElement("div");
    spark.className = "rw-burst";
    if (RARITY_RANK[rarity] >= 2) spark.dataset["rays"] = "1";
    slot.append(spark);
    later(() => spark.remove(), 780);
  };

  const flash = (alpha: number): void => {
    if (!motionEnabled()) return;
    const sheet = document.createElement("div");
    sheet.className = "rw-flash";
    sheet.style.setProperty("--rw-flash-a", String(alpha));
    overlay.append(sheet);
    later(() => sheet.remove(), 260);
  };

  /* --- input ------------------------------------------------------------- */

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (autoTimer) globalThis.clearTimeout(autoTimer);
    for (const id of timers) globalThis.clearTimeout(id);
    timers.clear();
    globalThis.removeEventListener("resize", onResize);
    document.removeEventListener("focusin", onFocusIn, true);
    overlay.classList.add("rw-closing");
    globalThis.setTimeout(() => overlay.remove(), 220);
    if (openInstance?.element === overlay) openInstance = null;
    if (options.walletHost) syncWallets(options.walletHost);
    returnFocus?.focus?.({ preventScroll: true });
    options.onClose?.();
  };

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".rw-open-actions")) return;
    if (!torn) {
      tear();
      return;
    }
    const slot = target.closest<HTMLElement>(".reveal-slot");
    if (slot) {
      flip(slots.indexOf(slot), true);
      return;
    }
    /*
     * Anywhere else means "get on with it" — and once there is nothing left to
     * get on with, it means "done".
     *
     * This used to be `revealAll()` unconditionally, which is a no-op after the
     * last card has turned. Measured at 844x390, the footer was 1,057px wide
     * inside an 844px viewport and both `Done` and `Collection` sat entirely
     * off-screen: with the veil inert, a touch player who opened a pack on a
     * phone had **no pointer route out of the modal at all**. The footer is
     * fixed below, and this is the second lock on the same door — a modal whose
     * only exit is one button is one layout bug away from being a trap.
     */
    if (shown.size === slots.length) {
      close();
      return;
    }
    revealAll();
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (shown.size === slots.length) close();
      else revealAll();
      return;
    }
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return; // a real button handles its own keys
    event.preventDefault();
    if (!torn) {
      tear();
      return;
    }
    const slot = target.closest<HTMLElement>(".reveal-slot");
    flip(slot ? slots.indexOf(slot) : nextHidden(), true);
  });

  /**
   * A focus trap, and the smallest one that is honest.
   *
   * This is a modal over the whole game; tabbing out of it lands the keyboard on
   * a screen the player cannot see. Rather than enumerate focusable descendants
   * and wrap them — which goes wrong the moment the markup changes — it watches
   * for focus arriving anywhere outside and sends it back to the first control
   * inside. Same guarantee, no list to maintain.
   */
  function onFocusIn(event: FocusEvent): void {
    if (closed) return;
    const target = event.target as Node | null;
    if (target && overlay.contains(target)) return;
    const first = overlay.querySelector<HTMLElement>("button:not([disabled]), [tabindex='0']");
    first?.focus({ preventScroll: true });
  }
  document.addEventListener("focusin", onFocusIn, true);

  allButton.addEventListener("click", () => revealAll());
  doneButton.addEventListener("click", () => close());
  overlay.querySelector("#reveal-collection")?.addEventListener("click", () => {
    close();
    options.onCollection?.();
  });

  /*
   * Reduced motion still opens a pack — it simply stops being a performance.
   * The player keeps the input that starts it and the summary that ends it; what
   * goes is the float, the deal, the bursts and the pauses between cards.
   */
  if (!motionEnabled()) {
    later(() => {
      tear();
      revealAll();
    }, 30);
  }

  (pack ?? overlay).focus?.({ preventScroll: true });

  const instance: PackOpening = { revealAll, close, element: overlay };
  openInstance = instance;
  return instance;
}

/** Whether a pack is on screen right now — the screens use it to stay quiet. */
export const packIsOpen = (): boolean => openInstance !== null;

/* -------------------------------------------------------------------------
   markup
   ------------------------------------------------------------------------- */

/**
 * Commons first, the best card last.
 *
 * `sort` is stable in every engine this ships to, so cards of equal rarity keep
 * the order the roll produced them in — which matters because the pity
 * guarantee's card should still be where the algorithm put it among its peers.
 */
function orderForDrama(cards: readonly RevealEntry[]): RevealEntry[] {
  return [...cards].sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
}

function slotMarkup(
  content: ContentIndex,
  entry: RevealEntry,
  index: number,
  total: number,
  backArt: string,
): string {
  const name = content.cards[entry.cardId]?.name ?? entry.cardId;
  const tags: string[] = [];
  if (entry.convertedToSignal !== undefined) {
    /*
     * "+15 Signal", not "Converted · +15 Signal".
     *
     * The tag is centred under a card and does not wrap, so its width is set by
     * its longest word rather than by the slot. At 844x390 — a phone in
     * landscape, which every screen has to work at — five cards are 100px wide
     * and the long form measured 150, so five tags overlapped into one
     * unreadable band across the bottom of the reveal. The word the player
     * needs is the number; "converted" is what the summary line under it and
     * the tooltip both say.
     */
    tags.push(
      `<span class="reveal-converted mat-chip" title="Converted to Signal — you were already at the cap">` +
        /*
         * The word survives for a screen reader — and for verify-shop.mjs, which
         * reads `.reveal-tag`'s textContent and asserts on /Converted/ to prove
         * the duplicate rule fired. A rebuild that quietly deletes the word a
         * browser check is asserting on has broken the check rather than passed
         * it.
         */
        `<span class="rw-sr">Converted · </span>` +
        `+${formatNumber(entry.convertedToSignal)} Signal</span>`,
    );
  } else if (entry.isNew) {
    tags.push(`<span class="reveal-new mat-chip">New</span>`);
  } else {
    tags.push(`<span class="reveal-dupe mat-chip">Second copy</span>`);
  }
  if (entry.guaranteed) tags.push(`<span class="reveal-converted mat-chip">Encore</span>`);
  else if (entry.wishlisted) tags.push(`<span class="reveal-converted mat-chip">Wishlist</span>`);

  return (
    /*
     * The rarity is a data- attribute and **never a class**.
     *
     * screens.css still carries `.reveal-slot.legendary .reveal-back { box-shadow:
     * 0 0 26px gold }` — the old screen's spoiler, which lit the *face-down* card
     * gold and then deleted the glow at the moment of the flip. Putting the rarity
     * on as a class brought it straight back, and a ten-pull photographed with one
     * back haloed in gold before anything had been turned over. Everything rarity
     * does in this component keys off `[data-rarity]` together with `.shown`.
     */
    `<div class="reveal-slot rw-pending" data-index="${index}" data-rarity="${entry.rarity}">` +
    `<div class="rw-flip" role="button" tabindex="0" aria-pressed="false" ` +
    `aria-label="Turn over card ${index + 1} of ${total}: ${esc(name)}">` +
    `<div class="reveal-back">${backArt ? `<img src="${backArt}" alt="" draggable="false">` : ""}</div>` +
    `<div class="reveal-front" data-card="${esc(entry.cardId)}"></div>` +
    `</div>` +
    `<div class="reveal-tag">${tags.join("")}</div>` +
    `</div>`
  );
}

/**
 * The pack itself, and it is a *descendant of the grid*.
 *
 * `scripts/verify-shop.mjs` clicks the centre of `.reveal-cards`; if the pack
 * were a sibling floating over it, Playwright would report the click as
 * intercepted and a rebuild that works perfectly would fail its own check.
 */
function packMarkup(backArt: string, tearLabel: string): string {
  return (
    `<button class="rw-pack" type="button" aria-label="${esc(tearLabel)}">` +
    (backArt ? `<img src="${backArt}" alt="" draggable="false">` : "") +
    `</button>`
  );
}

/** The hint belongs to the stage, so it can sit clear of the card grid. */
function hintMarkup(tearLabel: string): string {
  return (
    `<div class="rw-pack-hint">` +
    `<span class="t-label">${esc(tearLabel)}</span>` +
    `<span class="rw-quiet" style="font-size:var(--fs-xs)">Click the pack, or press Space</span>` +
    `</div>`
  );
}

function summaryMarkup(options: PackOpeningOptions): string {
  const items = options.summary ?? [];
  const parts = items.map((item) => {
    const mark = item.coin ? COIN[item.coin].icon : (item.icon ?? "sparkle");
    const ink = item.coin ? COIN[item.coin].ink : "var(--accent-bright)";
    const value =
      item.value === undefined
        ? ""
        : `<span class="num" data-count="${item.value}" style="min-width:0">0</span>`;
    return (
      `<span class="rw-sum"><span style="color:${ink};display:inline-flex">${icon(mark, { size: 17 })}</span>` +
      `${value}<span>${esc(item.label)}</span></span>`
    );
  });
  if (options.note) parts.push(`<span class="rw-sum rw-quiet">${esc(options.note)}</span>`);
  return parts.join("");
}
