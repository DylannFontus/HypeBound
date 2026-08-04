/**
 * The pieces every reward screen is built out of.
 *
 * ## The problem this solves, measured
 *
 * A review of the shop, the banner, the Hype Wave, missions and achievements
 * counted **six** independently invented progress bars — 2px, 4px, 5px and three
 * more, each with its own track colour and none of them visible at 0% — **six**
 * reward states signalled with nothing but `opacity`, and **four** different
 * ways of writing a quantity inside a single ten-cell row (`◈50`, `20 Signal`,
 * `2 reroll tokens`, and a two-line wrap). Five screens, none of which had
 * looked at the other four.
 *
 * Every one of those is a *shared* object rendered five times, so it is declared
 * once here and composed by class name. The rule for anything added later is the
 * same: if two of the five screens draw it, it lives in this file.
 *
 * ## The three that are not obvious
 *
 * **`syncWallets` remembers the previous value.** The bar asks for currency to
 * count up rather than be printed, and the honest way to do that is to render
 * the number the player last *saw* and animate to the number they now have. It
 * cannot come from the caller, because every claim path in this domain rebuilds
 * its whole screen — the old value is gone before anybody could pass it. So the
 * module holds it, keyed by currency, and any screen that renders a wallet gets
 * a counting one for free, whether the change came from a claim on that screen
 * or from a pack opened two screens ago.
 *
 * **`flyReward` lives on `document.body`.** The recon's diagnosis of why no
 * reward in this game has ever been celebrated is exactly right: every claim
 * handler calls `render()`, which does `root.innerHTML = …`, so anything
 * animating inside the screen is destroyed on the frame it starts. A flight
 * attached to the body outlives the re-render underneath it, which is the only
 * reason this one works.
 *
 * **A quantity is always tabular.** `.num` is module A's numeric type role and
 * it reserves a fixed slot, so a wallet going from 999 to 1,000 does not shove
 * the header sideways. That was a real defect — `.currency-value` had no
 * `font-variant-numeric` at all — and it is the single most-read number in the
 * domain.
 */

import type { ContentIndex } from "../../../engine/types";
import type { CardBackStyle, EmblemShape } from "../../cosmetics/emblem";
import { cosmeticById } from "../../../game/cosmetics";
import { renderCardBackToCanvas } from "../../cardRenderer/renderCardBack";
import { icon, type IconId } from "../../art/uiIcons";
import { DUR, EASE, cssEase, motionEnabled, scaledDuration, tickerTo } from "../../motion";
import { num as formatNumber } from "../../format";

/* -------------------------------------------------------------------------
   escaping
   ------------------------------------------------------------------------- */

/**
 * The same five-character escape the five screens each declared privately.
 *
 * It is here rather than imported from one of them because a screen importing
 * another screen to borrow a helper is how two screens become one screen.
 */
export const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* -------------------------------------------------------------------------
   currencies
   ------------------------------------------------------------------------- */

export type CoinKind = "clout" | "shards" | "glimmer" | "token" | "xp" | "reroll";

interface CoinMeta {
  icon: IconId;
  label: string;
  /** the chip's own accent, so four currencies are four objects and not one */
  ink: string;
}

/**
 * What each currency looks like, in one place.
 *
 * `shards` is the profile field; the player-facing word is **Signal**, and the
 * two have been out of step in the copy on three of these screens. The label
 * here is the one the player reads.
 */
export const COIN: Readonly<Record<CoinKind, CoinMeta>> = Object.freeze({
  clout: { icon: "clout", label: "Clout", ink: "var(--accent-hot)" },
  shards: { icon: "shards", label: "Signal", ink: "var(--accent)" },
  glimmer: { icon: "glimmer", label: "Glimmer", ink: "var(--accent-gold)" },
  token: { icon: "backstage-token", label: "Backstage Tokens", ink: "var(--accent-cool)" },
  xp: { icon: "hype-wave", label: "XP", ink: "var(--accent-bright)" },
  reroll: { icon: "refresh", label: "Reroll tokens", ink: "var(--accent-cool)" },
});

/**
 * A currency chip that the wallet syncer can find and count up.
 *
 * `id` lands on the numeral rather than the chip because that is what the
 * browser checks read: `#missions-clout` has been the missions header's Clout
 * *value* since the screen was written, and a rebuild that moves the id onto a
 * wrapper quietly breaks a check that is asserting on the economy.
 */
export function coinChip(kind: CoinKind, value: number, options: { slot?: number; id?: string } = {}): string {
  const meta = COIN[kind];
  const slot = options.slot ?? Math.max(3, String(Math.round(value)).length + 1);
  return (
    `<div class="rw-coin mat-chip" data-wallet="${kind}" data-value="${value}" ` +
    `style="--coin-slot:${slot}ch" title="${esc(meta.label)}">` +
    `${icon(meta.icon, { label: meta.label })}` +
    `<span class="num"${options.id ? ` id="${options.id}"` : ""}>${formatNumber(value)}</span></div>`
  );
}

/** An inline currency mark for use inside a sentence — icon plus tabular value. */
export function coinInline(kind: CoinKind, value: number | string): string {
  const meta = COIN[kind];
  const text = typeof value === "number" ? formatNumber(value) : value;
  return (
    `<span class="rw-row" style="gap:4px;color:${meta.ink}">` +
    `${icon(meta.icon, { label: meta.label, size: 15 })}` +
    `<span class="num" style="min-width:0;color:var(--text)">${esc(text)}</span></span>`
  );
}

/**
 * The last value each currency was rendered at, so the next render can count.
 *
 * Deliberately module-level and never cleared: the point is continuity *across*
 * screens. Claim a mission, walk to the shop, and the shop's wallet counts up
 * from what the missions screen was showing, because that is the last number the
 * player actually saw.
 */
const seenWallet = new Map<string, number>();

/**
 * How long a wallet takes to reach its new value.
 *
 * Short — a ratchet rather than a spin. Two reasons, and the second is the one
 * worth writing down. A currency counter that takes most of a second to settle
 * stops being feedback and becomes a wait, especially on the missions screen
 * where a player claims three in a row. And `verify-banner.mjs` reads
 * `#missions-clout` two hundred milliseconds after a claim and asserts the
 * delta is exactly the fifty Clout the economy doc promises — a counter still
 * in flight at that point reports a partial number and fails a check that is
 * about the economy rather than about the animation. The celebration is carried
 * by the arc, the landing pulse and the chip's flare, all of which run longer.
 */
const WALLET_TICK_MS = 150;

/**
 * Count every wallet chip under `root` from its previous value to its current.
 *
 * Call it after every render. The first render of a session prints rather than
 * counts — there is nothing to count *from*, and a lobby that spends 700ms
 * spinning up to your balance on arrival is an affectation, not a reward.
 */
export function syncWallets(root: ParentNode): void {
  for (const chip of root.querySelectorAll<HTMLElement>("[data-wallet]")) {
    const kind = chip.dataset["wallet"];
    if (!kind) continue;
    const target = Number(chip.dataset["value"] ?? "0");
    const slot = chip.querySelector<HTMLElement>(".num");
    const previous = seenWallet.get(kind);
    seenWallet.set(kind, target);
    if (!slot) continue;
    if (previous === undefined || previous === target || !Number.isFinite(target)) {
      slot.textContent = formatNumber(target);
      continue;
    }
    slot.textContent = formatNumber(previous);
    tickerTo(slot, target, WALLET_TICK_MS);
  }
}

/* -------------------------------------------------------------------------
   the reward flight
   ------------------------------------------------------------------------- */

/**
 * Throw a reward from where it was claimed to the wallet chip that holds it.
 *
 * 480ms on an arc, because a straight line between two points on a screen reads
 * as a slide and an arc reads as a throw — and the thing being thrown is the
 * only feedback distinguishing "you claimed a reward" from "you pressed Back".
 * The arc's apex is above the straight line by a third of the horizontal
 * distance, which keeps a short throw shallow and a long one dramatic without a
 * second parameter.
 *
 * The destination pulses on the frame the flyer lands, not when it starts, so
 * the two halves of the event are one event.
 */
export function flyReward(from: HTMLElement | DOMRect, kind: CoinKind, root: ParentNode = document): void {
  const find = (): HTMLElement | null => root.querySelector<HTMLElement>(`[data-wallet="${kind}"]`);
  /*
   * The chip is looked up *again* when the flyer lands, and that is the whole
   * reason the pulse works.
   *
   * Every claim path in this domain calls `render()`, which replaces the
   * screen's `innerHTML` — including the wallet. The flight takes 480ms and the
   * rebuild happens on the next frame, so an element captured when the throw
   * started has been detached for four hundred milliseconds by the time it
   * arrives. Measured with a mutation observer: the flyer was created and
   * animated correctly on every claim, and `rw-hit` was then added to a node
   * that was no longer in the document, so the destination never once pulsed.
   * The geometry can safely come from the old chip — the new one is in the same
   * place — but the class has to go on whatever is there when it lands.
   */
  const land = (): void => {
    const target = find();
    if (!target) return;
    target.classList.remove("rw-hit");
    // force a reflow so the class can be re-applied on a claim that repeats
    void target.offsetWidth;
    target.classList.add("rw-hit");
    globalThis.setTimeout(() => target.classList.remove("rw-hit"), 460);
  };

  const target = find();
  if (!target || !motionEnabled() || typeof document === "undefined") {
    land();
    return;
  }

  const start = from instanceof HTMLElement ? from.getBoundingClientRect() : from;
  const end = target.getBoundingClientRect();
  if (start.width === 0 && start.height === 0) {
    land();
    return;
  }

  const x0 = start.left + start.width / 2;
  const y0 = start.top + start.height / 2;
  const x1 = end.left + end.width / 2;
  const y1 = end.top + end.height / 2;

  const flyer = document.createElement("div");
  flyer.className = "rw-flyer";
  flyer.style.setProperty("--coin-ink", COIN[kind].ink);
  flyer.innerHTML = icon(COIN[kind].icon);
  flyer.style.left = `${x0 - 17}px`;
  flyer.style.top = `${y0 - 17}px`;
  document.body.append(flyer);

  const ms = scaledDuration(480);
  if (ms <= 0 || typeof flyer.animate !== "function") {
    flyer.remove();
    land();
    return;
  }

  const lift = Math.min(180, Math.abs(x1 - x0) / 3 + 40);
  const animation = flyer.animate(
    [
      { transform: "translate3d(0,0,0) scale(0.7)", opacity: 0 },
      { transform: `translate3d(${(x1 - x0) * 0.36}px, ${(y1 - y0) * 0.2 - lift}px, 0) scale(1.15)`, opacity: 1, offset: 0.42 },
      { transform: `translate3d(${x1 - x0}px, ${y1 - y0}px, 0) scale(0.42)`, opacity: 0.15 },
    ],
    { duration: ms, easing: cssEase(EASE.arrive), fill: "forwards" },
  );
  animation.onfinish = () => {
    flyer.remove();
    land();
  };
  animation.oncancel = () => flyer.remove();
}

/* -------------------------------------------------------------------------
   the one progress rail
   ------------------------------------------------------------------------- */

export interface RailTick {
  /** 0–1 along the rail */
  at: number;
  /** `promise` is a guarantee the economy has made — pity, hard pity, the pace line */
  kind?: "step" | "promise";
  title?: string;
}

export interface RailOptions {
  value: number;
  max: number;
  ticks?: readonly RailTick[];
  /** rail height in px; the default is the one every rail in the domain uses */
  height?: number;
  label?: string;
  /** the ramp the fill is painted with; defaults to the hero ramp */
  fill?: string;
  id?: string;
}

/**
 * A groove with a lit object in it, at one height, in all five screens.
 *
 * `.mat-well` is the groove — module A already inverted its bevel so the recess
 * reads as a recess — and `.well-fill` is the object, which carries its own top
 * crown so a filled rail is a bar *inside* a channel rather than a stripe
 * painted onto one. 12px, because the six it replaces ranged from 2px to 5px and
 * every one of them was thinner than the panel border beside it.
 *
 * `min-width` on the fill is the fix for the invisible-at-0% problem, but only
 * once there is something to show: exactly zero stays exactly empty, and one
 * pull out of fifty is a visible sliver rather than a sub-pixel nothing.
 */
export function railHtml(options: RailOptions): string {
  const max = options.max > 0 ? options.max : 1;
  const value = Math.max(0, Math.min(options.value, max));
  const pct = (value / max) * 100;
  const ticks = (options.ticks ?? [])
    .map(
      (tick) =>
        `<span class="rw-rail-tick" data-kind="${tick.kind ?? "step"}" style="left:${(tick.at * 100).toFixed(3)}%"` +
        `${tick.title ? ` title="${esc(tick.title)}"` : ""}></span>`,
    )
    .join("");
  return (
    `<div class="rw-rail mat-well"${options.id ? ` id="${options.id}"` : ""} role="progressbar" ` +
    `aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="${Math.round(max)}"` +
    `${options.label ? ` aria-label="${esc(options.label)}"` : ""}` +
    `${options.height ? ` style="--rail-h:${options.height}px"` : ""}>` +
    `<div class="rw-rail-fill well-fill" style="--rw-fill:${pct.toFixed(3)}%;` +
    `--rw-fill-min:${value > 0 ? 10 : 0}px${options.fill ? `;--fill-meter:${options.fill}` : ""}"></div>` +
    `${ticks}</div>`
  );
}

/** A rail with a heading and a tabular readout above it. */
export function meterHtml(
  options: RailOptions & { title: string; readout?: string },
): string {
  return (
    `<div class="rw-meter">` +
    `<div class="rw-meter-head"><span class="t-label">${esc(options.title)}</span>` +
    `<span class="num">${esc(options.readout ?? `${formatNumber(options.value)} / ${formatNumber(options.max)}`)}</span></div>` +
    railHtml(options) +
    `</div>`
  );
}

/* -------------------------------------------------------------------------
   the four-state reward token
   ------------------------------------------------------------------------- */

export type TokenState = "locked" | "available" | "claimable" | "claimed";

const TOKEN_ICON: Readonly<Record<TokenState, IconId>> = Object.freeze({
  locked: "lock",
  available: "dot",
  claimable: "sparkle",
  claimed: "check",
});

const TOKEN_WORD: Readonly<Record<TokenState, string>> = Object.freeze({
  locked: "Locked",
  available: "Not yet",
  claimable: "Ready",
  claimed: "Claimed",
});

/**
 * The state of a reward, said four ways at once: fill, border, icon and word.
 *
 * Never by alpha. Six places in this domain used `opacity: 0.42` on text that
 * was already `--text-dim`, which measures far under 4.5:1 — so the locked
 * rewards on the Hype Wave, the ones a player is deciding whether to chase, were
 * the least readable thing on the screen. Every state here holds its contrast at
 * full opacity, and the word is present for a screen reader whether or not the
 * colour is perceived.
 */
export function tokenHtml(state: TokenState, label?: string): string {
  return (
    `<span class="rw-tok mat-chip" data-state="${state}">` +
    `${icon(TOKEN_ICON[state])}<span>${esc(label ?? TOKEN_WORD[state])}</span></span>`
  );
}

/* -------------------------------------------------------------------------
   rewards, described once
   ------------------------------------------------------------------------- */

/** Every reward shape the five screens hand out, in one union. */
export type AnyReward =
  | { kind: "clout"; amount: number }
  | { kind: "fragments"; amount: number }
  | { kind: "glimmer"; amount: number }
  | { kind: "rerollTokens"; amount: number }
  | { kind: "pack" }
  | { kind: "pick"; rarity: string; choices: number; copies: number }
  | { kind: "cosmetic"; name: string; ref?: string | undefined };

export interface RewardVisual {
  icon: IconId;
  ink: string;
  name: string;
  qty?: number;
  /** a real picture of the thing, where one can be drawn */
  art?: string;
  /** which wallet a claim of this should fly into, if any */
  coin?: CoinKind;
}

/**
 * Which drawing stands in for a cosmetic we cannot picture directly.
 *
 * A card back can be *rendered* — it is the same object the board draws — so it
 * is. A title, a frame, a badge and an emote cannot, and the honest answer is a
 * distinct mark per kind rather than one generic star, because "you are working
 * toward a thing" is only a reward if you can tell which thing.
 */
const COSMETIC_ICON: Readonly<Record<string, IconId>> = Object.freeze({
  cardBack: "deck",
  frame: "profile",
  title: "star-filled",
  badge: "achievement",
  emote: "emote",
});

/** Guess a cosmetic's kind from its name, for the ones with no resolvable ref. */
function guessCosmeticKind(name: string): IconId {
  const lower = name.toLowerCase();
  if (lower.includes("card back") || lower.includes("card-back") || lower.includes("tint")) return "deck";
  if (lower.includes("frame")) return "profile";
  if (lower.includes("title")) return "star-filled";
  if (lower.includes("emote")) return "emote";
  if (lower.includes("portrait") || lower.includes("skin") || lower.includes("avatar")) return "profile";
  if (lower.includes("board") || lower.includes("mat")) return "collection";
  return "sparkle";
}

/**
 * A reward, as a thing you can look at.
 *
 * The old rendering of these was a text string per reward, which is how a fifty
 * tier pass ended up as a spreadsheet: "Seasonal card back", "Card-back tint
 * II", "Animated profile portrait" — three cosmetics you are being asked to
 * grind for, described in words, in a grey box. The reference games all show you
 * the object.
 */
export function describeReward(
  reward: AnyReward,
  content?: ContentIndex,
  seasonId?: string,
): RewardVisual {
  switch (reward.kind) {
    case "clout":
      return { icon: COIN.clout.icon, ink: COIN.clout.ink, name: "Clout", qty: reward.amount, coin: "clout" };
    case "fragments":
      return { icon: COIN.shards.icon, ink: COIN.shards.ink, name: "Signal", qty: reward.amount, coin: "shards" };
    case "glimmer":
      return { icon: COIN.glimmer.icon, ink: COIN.glimmer.ink, name: "Glimmer", qty: reward.amount, coin: "glimmer" };
    case "rerollTokens":
      return { icon: "refresh", ink: "var(--accent-cool)", name: "Rerolls", qty: reward.amount };
    case "pack":
      return { icon: "merch-drop", ink: "var(--accent-hot)", name: "Merch Drop", qty: 1 };
    case "pick":
      return {
        icon: "rarity",
        ink: `var(--rarity-${reward.rarity})`,
        name: `Pick a ${reward.rarity}`,
        qty: reward.copies > 1 ? reward.copies : undefined,
      };
    case "cosmetic": {
      const ref = reward.ref && seasonId ? reward.ref.replace("{season}", seasonId) : reward.ref;
      const cosmetic = ref && content ? cosmeticById(content, ref) : null;
      if (cosmetic?.kind === "cardBack") {
        return {
          icon: "deck",
          ink: cosmetic.color,
          name: reward.name,
          art: cardBackThumb({ color: cosmetic.color, emblem: cosmetic.emblem ?? "diamond" }),
        };
      }
      if (cosmetic) {
        return { icon: COSMETIC_ICON[cosmetic.kind] ?? "sparkle", ink: cosmetic.color, name: reward.name };
      }
      return { icon: guessCosmeticKind(reward.name), ink: "var(--accent-bright)", name: reward.name };
    }
  }
}

/* -------------------------------------------------------------------------
   the reward tile
   ------------------------------------------------------------------------- */

export interface TileOptions {
  state?: TokenState | "none";
  /**
   * Art box size. A number is pixels; a string is any CSS length, which is how
   * a caller opts into growing with `--ui-scale`. The Hype Wave's lanes are
   * sized in em, so a 40px tile inside them shrank to a quarter of its lane at
   * scale 1.4 and the track read as a row of mostly-empty plates.
   */
  art?: number | string;
  /** hide the caption, for dense rows */
  bare?: boolean;
  title?: string;
  className?: string;
}

/** One reward, drawn: a picture, then a tabular quantity, then its name. */
export function rewardTileHtml(visual: RewardVisual, options: TileOptions = {}): string {
  const state = options.state ?? "none";
  const artSize = options.art ?? 46;
  const art = typeof artSize === "number" ? `${artSize}px` : artSize;
  const picture = visual.art
    ? `<img src="${visual.art}" alt="" loading="lazy" decoding="async">`
    : icon(visual.icon);
  return (
    `<div class="rw-tile ${options.className ?? ""}"${state === "none" ? "" : ` data-state="${state}"`}` +
    `${options.title ? ` title="${esc(options.title)}"` : ""}>` +
    `<div class="rw-tile-art" style="--tile-ink:${visual.ink};--tile-art:${art}">${picture}` +
    (visual.qty !== undefined && visual.qty > 1
      ? `<span class="rw-tile-qty mat-chip num">${formatNumber(visual.qty)}</span>`
      : "") +
    `</div>` +
    (options.bare ? "" : `<span class="rw-tile-name">${esc(tileCaption(visual))}</span>`) +
    `</div>`
  );
}

/** The caption under a tile: a quantity where there is one, the name otherwise. */
function tileCaption(visual: RewardVisual): string {
  if (visual.qty !== undefined && visual.coin) return `${formatNumber(visual.qty)} ${visual.name}`;
  return visual.name;
}

/* -------------------------------------------------------------------------
   card backs, as pictures
   ------------------------------------------------------------------------- */

const backThumbs = new Map<string, string>();

/**
 * A card back as a `data:` URI, rendered once per style and reused everywhere.
 *
 * The pass alone shows a card back on four tiers, the check-in track on one, the
 * banner on its first-ten reward and the shop uses one as the pack — so a naive
 * "render a canvas per tile" is fifty 512×680 rasterisations for one screen.
 * Rendering the real object once and referencing the bitmap is the difference
 * between a preview that is worth having and a frame budget that is not.
 *
 * 0.32 of card space is 164×218, which is sharp at the 96px the biggest consumer
 * draws it at on a 2× display and costs about 18KB of texture.
 */
export function cardBackThumb(style: CardBackStyle, scale = 0.32): string {
  const key = `${style.color}|${style.emblem}|${scale}`;
  const cached = backThumbs.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return "";
  let uri = "";
  try {
    uri = renderCardBackToCanvas(style, scale).toDataURL("image/png");
  } catch {
    // A canvas that will not export is a missing preview, never a broken screen.
    uri = "";
  }
  backThumbs.set(key, uri);
  return uri;
}

/** The house card back, for a pack that has no cosmetic of its own to wear. */
export const HOUSE_BACK: CardBackStyle = { color: "#b56cff", emblem: "diamond" as EmblemShape };

/* -------------------------------------------------------------------------
   small shared markup
   ------------------------------------------------------------------------- */

/** The back button every one of these screens has, with a drawn arrow. */
export function backButton(id: string, label = "Back"): string {
  return `<button class="rw-back mat-panel act" id="${id}">${icon("arrow-left")}<span>${esc(label)}</span></button>`;
}

/** A screen's translucent room wash — see the note at the top of the theme. */
export const WASH = `<div class="rw-wash" aria-hidden="true"></div>`;

/**
 * Set an element's transition to a token pair, for the few places that animate
 * from script. Exported so nobody writes `cubic-bezier(0.2, 0.8, 0.2, 1)` by
 * hand and transposes two digits into a curve that is *nearly* right.
 */
export function transitionTo(element: HTMLElement, property: string, ms: number, ease = EASE.arrive): void {
  element.style.transition = `${property} ${scaledDuration(ms)}ms ${cssEase(ease)}`;
}
