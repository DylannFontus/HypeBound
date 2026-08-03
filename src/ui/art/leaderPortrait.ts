/**
 * A leader, painted as a portrait, and a venue, painted as a backdrop.
 *
 * This file exists because the same defect was fixed once and left standing
 * three screens away. Audit defect 15 said the lobby was using
 * `renderCardToCanvas(leader, 300)` as its hero — a shrunken trading card, cost
 * pip, LEADER type line, four rarity diamonds and body copy at roughly 8px,
 * where a face belongs. The lobby grew a private `paintPortrait()` and stopped
 * doing it. The starter picker, which is the *first screen a new account ever
 * sees*, kept calling `renderCardToCanvas(leader, 210)` into a panel 1172px
 * wide, and the sign-in screen and the queue had no leader at all. One domain,
 * one defect, two contradictory states — which is precisely the drift the
 * foundation contract exists to stop, so the painter is shared and the private
 * copy is gone.
 *
 * ## What a portrait is, as opposed to a card
 *
 * Art only. No frame furniture, no numbers, no rules box. The crop is 3:4 and
 * biased *upward*, because every painting in this set puts the head in the top
 * third and a centred cover crop reliably decapitates it. On top of the art sit
 * three things and nothing else: the Current as an overlay wash so the identity
 * survives the art being any colour at all, one 315° key gradient so the plate
 * is lit by the same sun as every surface around it, and a floor scrim so the
 * name standing underneath has something to stand on rather than a face.
 *
 * Cards with no painting get `drawPlaceholderArt`, the same procedural fill the
 * card renderer uses. That state is long-lived and deliberate — roughly half the
 * set wears it and some will wear it for months — and nothing here invents art
 * to cover it up.
 *
 * ## Why the canvas repaints itself
 *
 * `getCardArt` answers `null` until the PNG has decoded, so a portrait built on
 * the first frame is a placeholder for the first frame. Every canvas subscribes
 * to `onArtLoaded` for its own card id and repaints once when its painting
 * arrives; the subscription cancels itself on the first hit, so a lobby left
 * open for an hour is not holding eleven live listeners.
 */

import type { CardDef, FactionId } from "../../engine/types";
import { CURRENT_PALETTE } from "../cardRenderer/palette";
import { drawPlaceholderArt } from "../cardRenderer/placeholderArt";
import { getCardArt, onArtLoaded } from "./artLoader";
import { boardPath, BOARD_EXTENSIONS } from "./iconAssets";
import { getAsset, onAssetLoaded } from "./assetLoader";

export interface PortraitOptions {
  /** Logical width in CSS pixels. Height follows `aspect`. */
  width?: number;
  /** Height ÷ width. 4/3 is the portrait default; the play hero wants 3/2. */
  aspect?: number;
  /**
   * How far up the crop is pushed, as a fraction of the drawn height. 0 centres
   * it, which is the setting that cuts heads off.
   */
  bias?: number;
  /** Strength of the floor scrim, 0–1. 0 leaves the bottom of the art alone. */
  scrim?: number;
  /**
   * Fade the right-hand edge to nothing over this fraction of the width, so the
   * art can bleed into a plate instead of ending at a rectangle. §7 asks for
   * dividers that fade; the same rule is what stops a cropped photograph
   * reading as a photograph pasted on.
   */
  fadeRight?: number;
  /** The same on the left, for art bled off the opposite edge. */
  fadeLeft?: number;
  /** Fade the bottom edge, for a portrait standing on a floor rather than in a box. */
  fadeBottom?: number;
  /** Overall darkening, for art used as a backdrop behind type. */
  dim?: number;
  className?: string;
}

/** Device pixels per CSS pixel, capped: a 3x phone does not need a 3x portrait. */
function ratio(): number {
  return Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
}

/**
 * Cover-fit with an upward bias, shared by both painters.
 *
 * `Math.min(0, …)` and `Math.max(H - dh, …)` between them guarantee the drawn
 * image still covers the box after the bias is applied — a bias larger than the
 * available slack would otherwise pull the bottom edge of the art up into the
 * frame and leave a transparent strip along the floor.
 */
function coverInto(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageW: number,
  imageH: number,
  W: number,
  H: number,
  bias: number
): void {
  const scale = Math.max(W / imageW, H / imageH);
  const dw = imageW * scale;
  const dh = imageH * scale;
  const dy = Math.min(0, Math.max(H - dh, -bias * dh));
  ctx.drawImage(image, (W - dw) / 2, dy, dw, dh);
}

/** The three finishing layers every plate in this file wears, in paint order. */
function finish(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  options: PortraitOptions,
  currentKey?: { hi: string; abyss: string }
): void {
  if (currentKey) {
    // The Current as a wash rather than as a border, so the identity survives
    // the art being any colour at all.
    ctx.globalCompositeOperation = "overlay";
    const tint = ctx.createLinearGradient(0, 0, W, H);
    tint.addColorStop(0, `${currentKey.hi}22`);
    tint.addColorStop(1, `${currentKey.abyss}55`);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  // Key light at 315°: a lift in the top-left, a fall-off into the bottom-right,
  // matching every other surface in the game.
  const key = ctx.createLinearGradient(0, 0, W, H);
  key.addColorStop(0, "rgba(255,255,255,0.13)");
  key.addColorStop(0.42, "rgba(255,255,255,0)");
  key.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, W, H);

  const dim = options.dim ?? 0;
  if (dim > 0) {
    ctx.fillStyle = `rgba(6,3,14,${dim})`;
    ctx.fillRect(0, 0, W, H);
  }

  const scrim = options.scrim ?? 0.88;
  if (scrim > 0) {
    const floor = ctx.createLinearGradient(0, H * 0.52, 0, H);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, `rgba(4,2,10,${scrim})`);
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * The bleed edges, cut rather than painted.
   *
   * `destination-out` removes alpha, so the plate underneath shows through
   * instead of the art being faded towards a guessed background colour — which
   * is the difference between a crop that belongs to the panel and one that has
   * a grey ghost of a rectangle along its edge.
   */
  const cut = (gradient: CanvasGradient): void => {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  };
  if (options.fadeRight) {
    const g = ctx.createLinearGradient(W * (1 - options.fadeRight), 0, W, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    cut(g);
  }
  if (options.fadeLeft) {
    const g = ctx.createLinearGradient(W * options.fadeLeft, 0, 0, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    cut(g);
  }
  if (options.fadeBottom) {
    const g = ctx.createLinearGradient(0, H * (1 - options.fadeBottom), 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    cut(g);
  }
}

/**
 * The leader, art only, in a 3:4 crop.
 *
 * Returns a canvas that repaints itself once when the painting arrives. Every
 * front-door screen that shows a leader calls this and nothing else.
 */
export function paintLeaderPortrait(card: CardDef, options: PortraitOptions = {}): HTMLCanvasElement {
  const W = Math.round(options.width ?? 456);
  const H = Math.round(W * (options.aspect ?? 4 / 3));
  const bias = options.bias ?? 0.16;

  const canvas = document.createElement("canvas");
  canvas.className = options.className ?? "leader-portrait-art";
  const dpr = ratio();
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const palette = CURRENT_PALETTE[card.current];

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const art = getCardArt(card);
    if (art) coverInto(ctx, art, art.width, art.height, W, H, bias);
    else drawPlaceholderArt(ctx, { x: 0, y: 0, w: W, h: H }, card.current, card.name);

    finish(ctx, W, H, options, palette);
  };

  paint();
  const stop = onArtLoaded((cardId) => {
    if (cardId !== card.id) return;
    paint();
    stop();
  });
  return canvas;
}

/**
 * The venue, as a backdrop.
 *
 * `public/assets/boards/<faction>` already holds a painted room per faction —
 * the same art the battle board stands on. Using it behind a mode tile or a
 * sign-in form is the cheapest possible answer to §2's "the space behind the UI
 * is continuous": the room you are about to play in is the room you are looking
 * at. Falls back to the neutral board, and then to nothing at all, so a missing
 * asset is an empty plate rather than a broken one.
 */
export function paintVenue(factionId: FactionId | string, options: PortraitOptions = {}): HTMLCanvasElement {
  const W = Math.round(options.width ?? 640);
  const H = Math.round(W * (options.aspect ?? 2 / 3));

  const canvas = document.createElement("canvas");
  canvas.className = options.className ?? "venue-art";
  const dpr = ratio();
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  /**
   * A 4K board takes a second or two to decode, so the venue always arrives
   * after the first frame. Fading it in is the difference between a room the
   * lights come up in and a photograph appearing out of nowhere a beat after the
   * screen has settled — §7's "nothing ever pops in", applied to an asset rather
   * than to a component.
   */
  canvas.style.opacity = "0";
  canvas.style.transition = "opacity var(--dur-setpiece, 700ms) var(--ease-arrive, ease-out)";

  const paint = (): boolean => {
    const art =
      getAsset(boardPath(String(factionId)), BOARD_EXTENSIONS) ?? getAsset(boardPath("default"), BOARD_EXTENSIONS);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (!art || !art.naturalWidth) return false;
    coverInto(ctx, art, art.naturalWidth, art.naturalHeight, W, H, options.bias ?? 0.08);
    finish(ctx, W, H, options);
    canvas.style.opacity = "1";
    return true;
  };

  if (!paint()) {
    const stop = onAssetLoaded(() => {
      if (paint()) stop();
    });
  }
  return canvas;
}
