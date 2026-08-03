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
 * ## Four edges, and a floor
 *
 * The cut used to be available on three sides. There was `fadeRight`,
 * `fadeLeft` and `fadeBottom` and no `fadeTop`, so every screen that used this
 * painter drew its leader with a razor line across the top of the frame —
 * measured on the queue at 1280×720, luminance went 20.3 → 168.8 across two
 * pixels at y=88, which is a head removed by a straight edge on the longest
 * wait screen in the game. Both callers had tried to compensate with a CSS
 * `mask-image` on the element, which cannot work: the canvas is `object-fit:
 * cover`, so the mask ramps over the *box* while the art scrolls underneath it.
 * The cut has to happen in the space the art is drawn in.
 *
 * `reflect` is the other half of the same complaint. A figure that casts
 * nothing is standing in front of the room rather than in it, and a wireframe
 * floor with an unaffected cut-out on top of it is the clearest possible
 * statement that the two layers have never met. Hearthstone frame 60 has no
 * object anywhere that touches the mat without darkening it.
 *
 * ## Why the plate is kept and the element is not
 *
 * Downscaling a 4K painting into a 1120×1680 backing store is the most
 * expensive thing any front-door screen does, and until now every screen did it
 * from scratch — the same leader is the play screen's hero, the lobby's face,
 * the figure on the queue and the person beside the sign-in form. The finished
 * plate is therefore memoised by everything that changes a pixel, and a caller
 * gets a fresh element with that plate blitted into it. See `plates` for the
 * measurement that made this worth doing.
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
  /**
   * And the same on the top — which did not exist, and was the whole defect.
   *
   * Three edges feathered and the fourth did not, so every caller of this
   * function painted its leader with a razor line across the top of the frame.
   * On the queue that line landed mid-figure: measured at 1280×720, luminance
   * went 20.3 → 168.8 across two pixels at y=88, which is a head cut off by a
   * straight edge on the game's longest wait screen. Callers were compensating
   * with a CSS `mask-image` on the element, which cannot work — the canvas is
   * `object-fit: cover`, so the mask ramps over the *box* while the art scrolls
   * underneath it, and the ramp lands wherever the crop happens to have put the
   * hairline. Cutting in the same space the art is drawn in is the only version
   * that follows the figure.
   */
  fadeTop?: number;
  /**
   * A mirror of the lower edge, cast below the figure, as a fraction of the
   * total height.
   *
   * The queue's leader was standing *in front of* a wireframe floor rather than
   * on it, because nothing she did affected the ground: no reflection, no
   * contact. Hearthstone frame 60 has no object anywhere that touches the mat
   * without darkening it. The mirror is drawn from the already-finished plate,
   * so it inherits the key light, the Current wash and the side cuts for free,
   * and it is capped low enough (12% is the value the callers use) to read as a
   * damp floor rather than as a second copy of the art.
   */
  reflect?: number;
  /** Overall darkening, for art used as a backdrop behind type. */
  dim?: number;
  className?: string;
}

/** Device pixels per CSS pixel, capped: a 3x phone does not need a 3x portrait. */
function ratio(): number {
  return Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
}

/**
 * One halved copy of a painting, kept, so the second crop of it is cheap.
 *
 * The card art is authored large — 2048 to 4096 pixels square — and a single
 * `drawImage` from that straight down to a 560px plate is the most expensive
 * call in the front door: measured 38.1ms for one leader on an RTX 2060, inside
 * a screen factory that runs on the main thread between the seal and the exit
 * animation. Halving in steps is both faster and better looking than one big
 * minification (the browser samples four texels per step instead of missing
 * most of them), and the halved copy is worth keeping because the *same*
 * painting is cropped four different ways across this domain — the lobby's
 * portrait, the play screen's hero, the queue's figure, the sign-in leader.
 * Whichever screen paints first pays; the rest read.
 *
 * Keyed by card and by the size bucket asked for, so a 456px portrait and a
 * 560px hero share one mip and a thumbnail somewhere else does not force them
 * both through a smaller one.
 */
const MIP_LIMIT = 8;
const mips = new Map<string, HTMLCanvasElement>();

function mipFor(cardId: string, art: HTMLImageElement, needPx: number): CanvasImageSource {
  // Nothing to gain until the source is at least four times the target: below
  // that a single minification is already sampling most of the pixels.
  if (art.width < needPx * 4) return art;
  const bucket = 2 ** Math.ceil(Math.log2(needPx * 2));
  const key = `${cardId}|${bucket}`;
  const hit = mips.get(key);
  if (hit) {
    mips.delete(key);
    mips.set(key, hit);
    return hit;
  }

  let source: CanvasImageSource = art;
  let w = art.width;
  let h = art.height;
  let made: HTMLCanvasElement | null = null;
  while (w > bucket * 2) {
    const step = document.createElement("canvas");
    step.width = Math.max(1, Math.round(w / 2));
    step.height = Math.max(1, Math.round(h / 2));
    const pen = step.getContext("2d");
    if (!pen) break;
    pen.imageSmoothingQuality = "high";
    pen.drawImage(source, 0, 0, step.width, step.height);
    source = step;
    made = step;
    w = step.width;
    h = step.height;
  }
  if (!made) return art;

  mips.set(key, made);
  if (mips.size > MIP_LIMIT) {
    const oldest = mips.keys().next().value;
    if (oldest !== undefined) mips.delete(oldest);
  }
  return made;
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
  if (options.fadeTop) {
    const g = ctx.createLinearGradient(0, H * options.fadeTop, 0, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    cut(g);
  }
}

/**
 * The floor the figure is standing on, drawn from the figure.
 *
 * Two marks, in this order. A soft ellipse where the feet meet the ground —
 * §1's "anything sitting on top of anything else casts", and the cheapest thing
 * that turns a cut-out into an object — and then the lower band of the plate
 * mirrored below it and taken down to a dozen per cent, so the ground has the
 * figure's own colour in it rather than a generic smudge.
 *
 * The mirror is a self-copy: `drawImage` reads the canvas it is writing to,
 * which is legal and is the only way to get a reflection that already carries
 * the key light, the Current wash and the side cuts applied above. It is cut
 * with the same `destination-out` ramp the edges use, so the reflection ends in
 * transparency rather than in a guessed background colour.
 */
function ground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  W: number,
  footY: number,
  bandH: number,
  dpr: number
): void {
  const H = footY + bandH;
  if (bandH < 2) return;

  // The cast, first, so the reflection lies over its near edge the way a wet
  // floor does rather than sitting on top of the shadow like a decal.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const cast = ctx.createRadialGradient(W / 2, footY, 0, W / 2, footY, W * 0.42);
  cast.addColorStop(0, "rgba(2,1,6,0.85)");
  cast.addColorStop(0.55, "rgba(2,1,6,0.34)");
  cast.addColorStop(1, "rgba(2,1,6,0)");
  ctx.translate(W / 2, footY);
  ctx.scale(1, 0.26);
  ctx.translate(-W / 2, -footY);
  ctx.fillStyle = cast;
  ctx.fillRect(0, footY - W * 0.5, W, W);
  ctx.restore();

  // The mirror. Source is the band immediately above the contact line, in
  // device pixels because that is what the backing store is measured in.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.5;
  ctx.translate(0, (footY + bandH) * dpr);
  ctx.scale(1, -1);
  ctx.drawImage(
    canvas,
    0,
    (footY - bandH) * dpr,
    W * dpr,
    bandH * dpr,
    0,
    0,
    W * dpr,
    bandH * dpr
  );
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const fade = ctx.createLinearGradient(0, footY, 0, H);
  fade.addColorStop(0, "rgba(0,0,0,0.42)");
  fade.addColorStop(0.5, "rgba(0,0,0,0.86)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, footY, W, bandH);
  ctx.restore();
}

/**
 * Painted plates, kept, so the second visit is a blit.
 *
 * The play screen builds its hero portrait at 560×840 logical — 1120×1680 in
 * device pixels — inside the screen factory, and the screen factory runs between
 * the moment the outgoing screen is sealed and the moment the exit animation
 * starts. Measured on a real click of PLAY on an RTX 2060: one 87ms long task
 * 39ms after the click, first visible change at +447ms, screens swapped at
 * +533ms, and three of the navigation's 93 frames over 33ms. §3a budgets
 * 260–420ms for a routine navigation and calls anything over 500ms an obstacle.
 *
 * Downscaling a 4K painting is the expensive part of that, and it is exactly the
 * kind of work that should be paid once: the same leader is the hero of the play
 * screen, the face on the lobby, the figure on the queue and the person on the
 * sign-in form, and every one of those was repainting from the source PNG. The
 * map holds the finished plate keyed by everything that changes what is drawn;
 * a caller gets a fresh element with the plate blitted into it, which is one
 * `drawImage` between two same-sized canvases.
 *
 * Bounded, because a deck builder that previews eleven leaders at four sizes
 * would otherwise hold forty-four full-resolution plates for the life of the
 * tab. Least-recently-used, same policy as `texture.ts`.
 */
const PLATE_LIMIT = 12;
const plates = new Map<string, HTMLCanvasElement>();

function keepPlate(key: string, plate: HTMLCanvasElement): void {
  plates.delete(key);
  plates.set(key, plate);
  if (plates.size > PLATE_LIMIT) {
    const oldest = plates.keys().next().value;
    if (oldest !== undefined) plates.delete(oldest);
  }
}

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

  /**
   * The figure gets the canvas minus the floor.
   *
   * `reflect` does not shrink the art; it reserves a band at the bottom of the
   * plate for what the art throws onto the ground, so the crop the caller asked
   * for still frames the same part of the painting and the reflection is extra
   * room rather than a bite out of the subject.
   */
  const bandH = Math.round(H * (options.reflect ?? 0));
  const figureH = H - bandH;

  /**
   * Everything that changes a pixel, and nothing that does not.
   *
   * Read fresh on every paint, never hoisted. The last term is whether the
   * painting has decoded yet, and that flips from false to true partway through
   * this canvas's life — `getCardArt` answers `null` until the PNG is ready, and
   * `onArtLoaded` repaints. Computing the key once at construction captures
   * "placeholder" forever, so the repaint looks up the plate it just drew and
   * blits the placeholder back over itself. Measured as a leader that never
   * stopped being procedural on a screen whose art was sitting decoded in the
   * cache.
   */
  const keyNow = (): string =>
    [
      card.id,
      canvas.width,
      canvas.height,
      bias,
      options.scrim ?? 0.88,
      options.dim ?? 0,
      options.fadeTop ?? 0,
      options.fadeLeft ?? 0,
      options.fadeRight ?? 0,
      options.fadeBottom ?? 0,
      options.reflect ?? 0,
      getCardArt(card) ? "art" : "placeholder",
    ].join("|");

  const render = (): HTMLCanvasElement => {
    const plate = document.createElement("canvas");
    plate.width = canvas.width;
    plate.height = canvas.height;
    const pen = plate.getContext("2d");
    if (!pen) return plate;
    pen.scale(dpr, dpr);

    const art = getCardArt(card);
    /**
     * Clipped, because cover-fit overflows by design. `coverInto` scales the
     * painting until it covers the box, which means it is taller than the box
     * unless the aspects happen to agree — without a clip the overflow lands in
     * the reflection band and the floor is a second unfaded copy of the art.
     */
    pen.save();
    pen.beginPath();
    pen.rect(0, 0, W, figureH);
    pen.clip();
    if (art) {
      const source = mipFor(card.id, art, Math.max(canvas.width, canvas.height));
      const sw = typeof source === "object" && "width" in source ? Number(source.width) : art.width;
      const sh = typeof source === "object" && "height" in source ? Number(source.height) : art.height;
      coverInto(pen, source, sw, sh, W, figureH, bias);
    } else {
      drawPlaceholderArt(pen, { x: 0, y: 0, w: W, h: figureH }, card.current, card.name);
    }
    finish(pen, W, figureH, options, palette);
    pen.restore();

    if (bandH > 0) ground(pen, plate, W, figureH, bandH, dpr);
    return plate;
  };

  const paint = (): void => {
    const key = keyNow();
    let plate = plates.get(key);
    if (!plate) plate = render();
    // Set either way, so the LRU order reflects use rather than creation.
    keepPlate(key, plate);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plate, 0, 0);
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
