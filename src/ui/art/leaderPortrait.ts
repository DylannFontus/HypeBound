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
import { awaitAsset, getAsset } from "./assetLoader";
import { scaledAsset } from "./texture";

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
  /**
   * Device pixels per CSS pixel of plate, overriding the display's own.
   *
   * The one number that decides what a navigation costs. A plate that is about
   * to be displayed behind `blur(14px)` does not need a 2× backing store — it
   * does not need a 1× one — and the front door was building two of them per
   * screen at full retina resolution and then asking the compositor to blur
   * 2800×1568 pixels inside the first frame of a transition. Measured on
   * `#signin → #queue`, that first frame ran 118–191ms with **no script in it
   * at all**: pure raster. Anything that is going to be soft on screen should be
   * soft in memory, and this is how a caller says so.
   */
  resolution?: number;
  /**
   * Defocus baked into the plate, in plate pixels, instead of `filter: blur()`
   * on the element.
   *
   * The same picture either way and not remotely the same cost. A CSS blur is a
   * full-size GPU pass over the element's rendered box every time that layer is
   * rasterised — 1856×1026 for the queue's room — while a blur baked into a
   * 900px plate that is then stretched over the viewport is done once, at a
   * ninth of the area, and cached with the plate. The stretch does the rest of
   * the softening for free.
   */
  softness?: number;
  /**
   * Cut the plate to an ellipse rather than to a feathered rectangle.
   *
   * `fadeTop`/`fadeLeft`/`fadeRight`/`fadeBottom` soften four straight edges and
   * leave four right angles, and four right angles is a rectangle however soft
   * its sides are — measured on the queue at 2.4× exposure, the blurred far copy
   * of the leader was a translucent rectangular column whose left and right
   * boundaries changed the value of every floor line that crossed them. This is
   * the superellipse falloff `texture.ts` describes, applied in the space the
   * art is drawn in: the number is the exponent, 2 for a plain ellipse and 4 for
   * a squircle, and the ramp runs over the outer third of the radius.
   */
  oval?: number;
  /**
   * Hang a lighting rig in the room before the blur goes on.
   *
   * Venues only, and it is a composition fix rather than a decoration. Measured
   * against `hearthstone_frames/frame_00060` the queue reads 52.0 mean / 37.5 sd
   * against 86.9 / 51.7 — 40% darker and 27% flatter — and the worst of it is
   * the top fifth of the screen, y=80–240, which measures **sd 16.6**. That band
   * is a fifth of the picture and it is a smear: the painted board behind it has
   * no large shapes near the ceiling, so at `blur(14px)` there is nothing left
   * to see. Gwent's backdrop survives its own depth because it has silhouettes —
   * a truss, a rail, a lamp housing, a crowd edge — and a gradient does not.
   *
   * So the rig is drawn *into the plate, before the softening*, which is the only
   * place it can go and still be at the room's focal depth rather than in front
   * of it. Nothing here is card art and nothing here is invented for a card: it
   * is stage furniture in a nightclub, which is what this game says it is set in.
   */
  rig?: boolean;
  className?: string;
}

/** Device pixels per CSS pixel, capped: a 3x phone does not need a 3x portrait. */
function ratio(): number {
  return Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
}

/** The backing-store scale a caller asked for, or the display's, clamped sane. */
function plateRatio(options: PortraitOptions): number {
  const asked = options.resolution;
  if (typeof asked !== "number" || !Number.isFinite(asked) || asked <= 0) return ratio();
  return Math.min(2, Math.max(0.2, asked));
}

/**
 * Blur without a dark rim, which is the whole difficulty.
 *
 * `ctx.filter = "blur(n)"` samples outside the source, and outside a canvas is
 * transparent black — so a blurred full-bleed image comes back with a shadow
 * around all four edges, which on a backdrop reads as a vignette nobody asked
 * for. Painting into a canvas that is `3σ` larger on every side and then
 * drawing it back at a negative offset means every sample the blur takes is
 * real picture.
 */
function softDraw(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  radius: number,
  draw: (pen: CanvasRenderingContext2D) => void
): void {
  if (radius <= 0.2) {
    draw(ctx);
    return;
  }
  const pad = Math.ceil(radius * 3);
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.round(W + pad * 2));
  scratch.height = Math.max(1, Math.round(H + pad * 2));
  const pen = scratch.getContext("2d");
  if (!pen) {
    draw(ctx);
    return;
  }
  pen.translate(pad, pad);
  draw(pen);
  ctx.save();
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(scratch, -pad, -pad);
  ctx.restore();
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

  /**
   * ...and then the corners, which the four edges cannot reach.
   *
   * A superellipse of exponent *n* evaluated per pixel would be a per-pixel loop
   * on a plate up to a megapixel. `scale()` around the centre turns the ellipse
   * into a circle, at which point a radial gradient *is* the falloff — exact for
   * `oval: 2`, and for higher exponents the ramp is pushed outward so the
   * straights stay full for longer, which is what a squircle looks like. The
   * whole thing is one `fillRect` through `destination-out`.
   */
  if (options.oval && options.oval > 0) {
    const exponent = Math.max(2, options.oval);
    // Where the ramp begins, as a fraction of the radius. 2 → 0.66, 4 → 0.83.
    const hold = 1 - 0.68 / exponent;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.translate(W / 2, H / 2);
    ctx.scale(W / 2, H / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(hold, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(-1.45, -1.45, 2.9, 2.9);
    ctx.restore();
  }
}

/**
 * A truss, a rail and a crowd, in that order, because that is the order they are
 * from the camera.
 *
 * Three masses and a set of practicals, sized as fractions of the plate so the
 * rig is the same rig at every venue size. The lamps are the part that does the
 * measurable work: a dark shape on a dark ceiling raises the mean and leaves the
 * standard deviation where it was, and the band this exists to fix is failing on
 * *variance*. A hot 6px core inside a dark housing survives a heavy blur as a
 * bright blob against a dark bar, which is two values in a band that had one.
 *
 * Deliberately not symmetrical and deliberately not centred: the truss hangs a
 * little left of centre and the lamps are unevenly spaced, because an evenly
 * spaced row of identical lamps is the same "twelve identical 4px squares"
 * failure the call board's marquee was pulled up for.
 */
function drawRig(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();

  // 1. The truss. A dark bar across the ceiling with its own lit top edge, so it
  //    is an object under the house lights rather than a band of black.
  const trussY = H * 0.115;
  const trussH = Math.max(3, H * 0.036);
  const bar = ctx.createLinearGradient(0, trussY, 0, trussY + trussH);
  bar.addColorStop(0, "rgba(196,170,246,0.30)");
  bar.addColorStop(0.22, "rgba(10,6,22,0.86)");
  bar.addColorStop(1, "rgba(4,2,10,0.72)");
  ctx.fillStyle = bar;
  ctx.fillRect(-W * 0.04, trussY, W * 1.08, trussH);

  // The diagonal web inside it, which is what makes a bar read as a truss.
  ctx.strokeStyle = "rgba(6,3,14,0.6)";
  ctx.lineWidth = Math.max(1, H * 0.006);
  ctx.beginPath();
  for (let x = -W * 0.04; x < W * 1.06; x += W * 0.055) {
    ctx.moveTo(x, trussY + trussH);
    ctx.lineTo(x + W * 0.028, trussY);
    ctx.lineTo(x + W * 0.055, trussY + trussH);
  }
  ctx.stroke();

  // 2. The lamps hanging off it. Housing, socket, core — an unlit one would
  //    still be an object, which is the note the call board's marquee got.
  const lamps: readonly number[] = [0.11, 0.205, 0.325, 0.47, 0.585, 0.7, 0.845, 0.93];
  const drop = trussY + trussH;
  const r = Math.max(3, H * 0.026);
  for (let i = 0; i < lamps.length; i += 1) {
    const x = W * (lamps[i] ?? 0);
    const y = drop + r * (i % 3 === 1 ? 1.5 : 1.05);
    // the yoke
    ctx.strokeStyle = "rgba(6,3,14,0.8)";
    ctx.lineWidth = Math.max(1, H * 0.005);
    ctx.beginPath();
    ctx.moveTo(x, drop - trussH * 0.2);
    ctx.lineTo(x, y - r * 0.7);
    ctx.stroke();
    // the housing
    ctx.fillStyle = "rgba(7,4,16,0.9)";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.92, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // the lit face, and the spill it throws down the wall
    const warm = i % 3 === 0;
    const core = ctx.createRadialGradient(x, y + r * 0.28, 0, x, y + r * 0.28, r * 2.6);
    core.addColorStop(0, warm ? "rgba(255,246,228,0.95)" : "rgba(228,232,255,0.9)");
    core.addColorStop(0.16, warm ? "rgba(255,214,150,0.6)" : "rgba(178,206,255,0.55)");
    core.addColorStop(0.5, warm ? "rgba(226,148,96,0.16)" : "rgba(126,150,255,0.15)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.fillRect(x - r * 3, y - r * 2, r * 6, r * 6);
  }

  // 3. The rail of a balcony on the right, catching the light along its top.
  const railY = H * 0.42;
  const railH = Math.max(2, H * 0.055);
  ctx.fillStyle = "rgba(5,3,12,0.62)";
  ctx.fillRect(W * 0.58, railY, W * 0.46, railH);
  const lip = ctx.createLinearGradient(0, railY, 0, railY + railH * 0.34);
  lip.addColorStop(0, "rgba(214,186,255,0.34)");
  lip.addColorStop(1, "rgba(214,186,255,0)");
  ctx.fillStyle = lip;
  ctx.fillRect(W * 0.58, railY, W * 0.46, railH * 0.34);

  // 4. The crowd, as one silhouette rather than as people. A ragged dark edge
  //    along the bottom third is what tells the eye the room is occupied, and it
  //    is the last thing a heavy blur destroys because it is the biggest shape.
  ctx.fillStyle = "rgba(4,2,10,0.66)";
  ctx.beginPath();
  ctx.moveTo(-W * 0.05, H);
  const heads = 13;
  for (let i = 0; i <= heads; i += 1) {
    const x = -W * 0.05 + (W * 1.1 * i) / heads;
    const bob = 0.5 + 0.5 * Math.sin(i * 2.399);
    const y = H * (0.845 - 0.055 * bob);
    ctx.lineTo(x, y);
    ctx.quadraticCurveTo(x + (W * 1.1) / heads / 2, y - H * 0.03 * bob, x + (W * 1.1) / heads, y + H * 0.012);
  }
  ctx.lineTo(W * 1.05, H);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
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
  const dpr = plateRatio(options);
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
      options.softness ?? 0,
      options.oval ?? 0,
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
    softDraw(pen, W, figureH, options.softness ?? 0, (inner) => {
      if (art) {
        const source = mipFor(card.id, art, Math.max(canvas.width, canvas.height));
        const sw = typeof source === "object" && "width" in source ? Number(source.width) : art.width;
        const sh = typeof source === "object" && "height" in source ? Number(source.height) : art.height;
        coverInto(inner, source, sw, sh, W, figureH, bias);
      } else {
        drawPlaceholderArt(inner, { x: 0, y: 0, w: W, h: figureH }, card.current, card.name);
      }
    });
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
  const dpr = plateRatio(options);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  /**
   * A 4K board takes a second or two to decode, so the venue arrives after the
   * first frame — the *first* time. Fading it in is the difference between a
   * room the lights come up in and a photograph appearing out of nowhere a beat
   * after the screen has settled: §7's "nothing ever pops in", applied to an
   * asset rather than to a component.
   *
   * The second time, the asset is decoded and `paint()` below succeeds
   * synchronously, before this element has ever been in the document — and then
   * the fade is 700ms of a finished picture being withheld. It is measurable on
   * exactly the navigation §3a budgets: sign-in and the queue both put the venue
   * behind everything, so a warm room arriving over 700ms means the first third
   * of a second on the new screen is darker than the screen is. So the fade is
   * armed only when there is genuinely nothing to show yet.
   */
  const arm = (): void => {
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity var(--dur-setpiece, 700ms) var(--ease-arrive, ease-out)";
  };

  const preferred = boardPath(String(factionId));

  /**
   * The source, already the right size, and kept.
   *
   * The boards are 3840×2160. Every venue in the front door was reading all
   * 8.3 million of those pixels on every paint — twice per navigation into the
   * queue, once more on sign-in — and Chrome defers that work out of the calling
   * script and into the next raster, which is why `paintVenue` timed at 0.5ms
   * while the frame it ran in took 190. `scaledAsset` is module B's memoised mip
   * chain: the halving is paid once per session per size bucket and every later
   * caller reads a small cached canvas.
   */
  const sourceFor = (path: string): HTMLCanvasElement | HTMLImageElement | null => {
    const need = Math.max(canvas.width, canvas.height);
    return scaledAsset(path, need, BOARD_EXTENSIONS) ?? getAsset(path, BOARD_EXTENSIONS);
  };

  const soft = options.softness ?? 0;

  /**
   * The finished room, kept, exactly as the portrait's is.
   *
   * Sign-in and the queue put the same venue behind everything, and this
   * function memoised nothing at all — so walking `#signin → #queue` built the
   * whole backdrop twice from the source PNG inside a 380ms transition. The key
   * is everything that changes a pixel and, at the end, whether the room this
   * caller actually asked for has decoded yet: without that term the repaint
   * `awaitAsset` schedules would look up the plate it had just cached with the
   * fallback board in it and blit the wrong room back over itself.
   */
  const keyNow = (): string =>
    [
      "venue",
      preferred,
      canvas.width,
      canvas.height,
      options.bias ?? 0.08,
      options.scrim ?? 0.88,
      options.dim ?? 0,
      soft,
      options.rig ? "rig" : "bare",
      options.oval ?? 0,
      getAsset(preferred, BOARD_EXTENSIONS) ? "room" : "fallback",
    ].join("|");

  const render = (art: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement => {
    const plate = document.createElement("canvas");
    plate.width = canvas.width;
    plate.height = canvas.height;
    const pen = plate.getContext("2d");
    if (!pen) return plate;
    pen.scale(dpr, dpr);
    softDraw(pen, W, H, soft, (inner) => {
      coverInto(inner, art, sw, sh, W, H, options.bias ?? 0.08);
      if (options.rig) drawRig(inner, W, H);
    });
    finish(pen, W, H, options);
    return plate;
  };

  const paint = (): boolean => {
    const art = sourceFor(preferred) ?? sourceFor(boardPath("default"));
    const sw = art ? Number((art as { width?: number; naturalWidth?: number }).naturalWidth ?? art.width) : 0;
    const sh = art ? Number((art as { height?: number; naturalHeight?: number }).naturalHeight ?? art.height) : 0;
    if (!art || !sw || !sh) return false;
    const key = keyNow();
    let plate = plates.get(key);
    if (!plate) plate = render(art, sw, sh);
    keepPlate(key, plate);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plate, 0, 0);
    canvas.style.opacity = "1";
    return true;
  };

  const drawn = paint();
  if (!drawn) arm();
  /** Whether that first paint was already the room it should be. */
  const settled = drawn && getAsset(preferred, BOARD_EXTENSIONS) !== null;

  /**
   * Wait for *this faction's* room, not for whichever room decodes first.
   *
   * The old version repainted on the next asset — any asset — and stopped the
   * moment one produced a picture. Both boards are requested on the same frame,
   * so which of them won was a race, and the neutral board usually won: it is
   * smaller. The visible result was the same screen showing two different rooms
   * on two consecutive loads — measured on the queue at 1600×900 as a
   * 95th-percentile pixel of 100 on one run and 80 on the next, with the top
   * sixth of the frame going from 22% dark-and-flat to 51% purely on which PNG
   * arrived first. A backdrop that is a coin toss is worse than either outcome.
   *
   * `awaitAsset` answers `null` for a faction with no painted room, which is
   * both the honest state and the reason this is bounded: the fallback is then
   * waited on once and nothing is left listening.
   */
  if (!settled) {
    void awaitAsset(preferred, BOARD_EXTENSIONS).then((art) => {
      if (art) {
        paint();
        return;
      }
      void awaitAsset(boardPath("default"), BOARD_EXTENSIONS).then(() => paint());
    });
  }
  return canvas;
}
