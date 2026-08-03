/**
 * The card's substance: lit plates, sockets, faceted gems, grain and numerals.
 *
 * Every surface on a card used to be drawn by hand where it was needed, and the
 * result was the defect the AAA bar names first. The name plate ran a gradient
 * left-to-right, the frame rim ran one top-left to bottom-right, and the rules
 * box ran none at all — three surfaces, three suns, on an object four hundred
 * pixels wide. Nothing cast onto anything. Nothing had a lip. Black out the
 * portrait and there was no card left, only chips on a gradient.
 *
 * So this file is the one answer to "what is a surface made of", and every piece
 * of furniture on a card is built from it. There are exactly two kinds of
 * surface — {@link raisedPlate}, which sits proud of what it is on, and
 * {@link sunkenPlate}, which is cut into it — and one kind of hard part,
 * {@link drawGem}, which is a polygon shaded facet by facet. All three take
 * their light from `LIGHT_RIG` rather than from an argument, because the moment
 * the direction is a parameter somebody passes a different one.
 *
 * ## Why the shading is per-facet rather than a gradient with a highlight on it
 *
 * A radial gradient with a white blob at the top-left is what a gem looks like
 * in a vector editor. A real cut stone is a set of flat faces, each one a
 * different brightness depending on which way it points, and the eye reads the
 * *discontinuity* between two faces as evidence of a cut. So `drawGem` walks the
 * polygon, takes each edge's outward normal, dots it against the light and fills
 * the wedge from the centre to that edge at the resulting brightness. Twelve
 * faces of a twelve-gon come out as twelve values with hard boundaries between
 * them, which is a gem; the same shape under a radial gradient is a sticker.
 *
 * ## The grain is drawn in device pixels, deliberately
 *
 * A card is rendered into card-space (512×680) and then scaled — to 168px in the
 * collection, to 420px in the detail view, to 1.6× on the board. A texture
 * painted in card-space is therefore resampled by a different factor on every
 * screen, so a grain tuned to look like dirt in the detail view is invisible in
 * the grid and shimmering on the board. {@link grainOver} sets its clip in
 * card-space and then resets the transform, so the tile always lands one cell to
 * one device pixel whatever the card is being drawn at. The bitmap itself comes
 * from `texture.ts`, so it is literally the same grain the DOM panels wear.
 *
 * It arrives as a PNG data URI, which means an `Image` and one asynchronous
 * decode. Cards drawn in the handful of milliseconds before it lands simply have
 * no grain; {@link onCardTextureReady} lets the canvas repaint itself when it
 * does, which is the same trick the art loader already uses.
 */

import { LIGHT_RIG, grainDataUri, shadowOffset } from "../art/texture";
import { DUR, EASE, bezier, motionEnabled, onMotionFrame } from "../motion";
import { hexToRgba, mix } from "./palette";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anything with a key colour and a light and a dark shade of it. */
export interface Metal {
  hi: string;
  key: string;
  lo: string;
  abyss?: string;
}

/**
 * The unit vector pointing at the key light, in canvas coordinates.
 *
 * `LIGHT_RIG.screen` is already in CSS coordinates (y grows downward), which is
 * what a 2D canvas uses, so this is a re-export with a shorter name rather than
 * a conversion. For 315° it is (−0.707, −0.707): left and up.
 */
export const TO_LIGHT = LIGHT_RIG.screen;

// ---------------------------------------------------------------------------
// 0. How much of the card is worth drawing
// ---------------------------------------------------------------------------

/**
 * Two levels of finish, and why a renderer needs to know which one it is at.
 *
 * A card costs almost exactly the same to draw at 92px as at 420px — measured,
 * 1.58ms against 3.03ms — because nearly all of it is fixed work: something like
 * thirty blurred fills for the inner shadows, the cast shadows and the gem
 * sockets, none of which cares how big the destination is. Two hundred and
 * forty-five of those on the collection grid is 900ms of main thread, and every
 * keystroke in the search box paid it again.
 *
 * The honest response is not to draw the card faster. It is to notice that at
 * 168px an eleven-pixel collector line is three pixels tall, a 13px inner shadow
 * is four, and the second pass of an etched guilloche lands on the same pixel as
 * the first — so the expensive half of the work is being thrown away by the
 * downsample before anybody sees it. `tile` draws what survives 168px and skips
 * what does not; `full` is the card as designed.
 *
 * It is a module-level switch rather than an argument for the same reason the
 * font stack is: it has to reach `drawGem`, `sunkenPlate` and the guilloche
 * without every intermediate signature growing a parameter that only one of its
 * callers has an opinion about.
 */
export type CardDetail = "full" | "tile";

let detail: CardDetail = "full";

/** Below this rendered width a card is drawn at `tile` finish. */
export const TILE_DETAIL_BELOW = 200;

export function setCardDetail(level: CardDetail): void {
  detail = level;
}

export const cardDetail = (): CardDetail => detail;
export const isTileDetail = (): boolean => detail === "tile";

// ---------------------------------------------------------------------------
// 1. Gradients along the light
// ---------------------------------------------------------------------------

/**
 * A gradient across `rect` running from the shadowed corner to the lit one.
 *
 * The gradient line is projected so both extreme corners land exactly on the
 * ends, which is what stops a tall plate and a wide one from carrying visibly
 * different amounts of light — the same construction `rimGradient` uses, exposed
 * here because most of the card's surfaces want plain colours rather than a
 * Current's palette.
 */
export function litGradient(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  stops: readonly (readonly [number, string])[]
): CanvasGradient {
  const span = Math.abs(rect.w * TO_LIGHT.x) + Math.abs(rect.h * TO_LIGHT.y);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const gradient = ctx.createLinearGradient(
    cx - (TO_LIGHT.x * span) / 2,
    cy - (TO_LIGHT.y * span) / 2,
    cx + (TO_LIGHT.x * span) / 2,
    cy + (TO_LIGHT.y * span) / 2
  );
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  return gradient;
}

/**
 * The face of a raised metal band, and the recessed shelf cut into it.
 *
 * These two gradients are the card frame's moulding, and they live here rather
 * than in `renderCard.ts` for one reason: the leader coin used to roll its own.
 * `renderLeader::metalGradient` built a conic starting at 2.356 rad and a linear
 * from (94,40) to (346,292), and its own doc comment described the result out
 * loud — "shadowed upper-left, specular lower-right". Measured on a 460px coin
 * with the gems suppressed, Cinder came out 3.7:1 brighter at the bottom-right
 * and Tide 28:1, against a card frame that is 31.8:1 brighter at the top-left.
 * The two objects sit one above the other for the whole of every match: the game
 * had two suns, and both of them were in one domain.
 *
 * A shared pair of functions is the only fix that holds, because the failure was
 * never a disagreement about the light — it was a second implementation nobody
 * had to look at. Both take their direction from `litGradient`, which takes it
 * from `TO_LIGHT`, which is `LIGHT_RIG.screen`.
 */
export function bandFace(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  metal: Metal,
  amplitude = 1
): CanvasGradient {
  const abyss = metal.abyss ?? "#000000";
  return litGradient(ctx, rect, [
    [0, mix(metal.lo, abyss, 0.62)],
    [0.34, metal.lo],
    [0.68, metal.key],
    [0.88, mix(metal.key, metal.hi, 0.45 * amplitude)],
    [1, mix(metal.key, metal.hi, 0.88 * amplitude)],
  ]);
}

/** The inner shelf: the same metal one step down, so the band has a section. */
export function bandShelf(ctx: CanvasRenderingContext2D, rect: Rect, metal: Metal): CanvasGradient {
  const abyss = metal.abyss ?? "#000000";
  return litGradient(ctx, rect, [
    [0, mix(abyss, "#000000", 0.4)],
    [0.45, mix(metal.lo, abyss, 0.4)],
    [0.85, mix(metal.lo, metal.key, 0.55)],
    [1, metal.key],
  ]);
}

/**
 * A stroke colour that is a highlight where the edge faces the light and a
 * shadow where it turns away, in one pass.
 *
 * Stroking a closed path with this is the cheapest correct edge treatment there
 * is: the top-left arc comes out white, the bottom-right arc comes out black,
 * and the two blend through the corners instead of switching at 45° the way four
 * separate inset shadows do. `invert` swaps them, which is what the *inner*
 * boundary of a raised band wants — the wall on the inside of a frame faces the
 * opposite way from the wall on the outside, and getting that backwards is what
 * makes a bevel look inflated.
 */
export function edgeGradient(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lit: number,
  dark: number,
  invert = false
): CanvasGradient {
  const light = invert ? `rgba(0,0,0,${dark})` : `rgba(255,255,255,${lit})`;
  const shade = invert ? `rgba(255,255,255,${lit})` : `rgba(0,0,0,${dark})`;
  return litGradient(ctx, rect, [
    [0, shade],
    [0.42, invert ? `rgba(255,255,255,${lit * 0.18})` : `rgba(0,0,0,${dark * 0.28})`],
    [0.58, invert ? `rgba(0,0,0,${dark * 0.28})` : `rgba(255,255,255,${lit * 0.18})`],
    [1, light],
  ]);
}

// ---------------------------------------------------------------------------
// 2. Shadows
// ---------------------------------------------------------------------------

/**
 * The soft drop plus the tight contact, cast by `path` onto whatever is under it.
 *
 * Two shadows rather than one, for the reason §1 of the bar gives: the soft one
 * says how far above the backing the object is and the tight one says it is
 * touching. Painted by filling the silhouette in black behind the object, so
 * every caller must draw its own opaque fill immediately afterwards.
 */
export function castShadow(ctx: CanvasRenderingContext2D, path: Path2D, lift = 5, opacity = 0.5): void {
  const offset = shadowOffset(lift);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.shadowColor = `rgba(0,0,0,${opacity})`;
  ctx.shadowBlur = lift * 2.6;
  ctx.shadowOffsetX = offset.x;
  ctx.shadowOffsetY = offset.y;
  ctx.fill(path);
  /**
   * The tight contact goes at tile finish and nothing else does.
   *
   * It is a two-pixel band in card space, which is two thirds of a pixel once a
   * 512px card lands in a 168px cell — under the resample it is not a contact
   * shadow, it is a rounding error, and it costs a second blurred fill of the
   * whole silhouette to produce.
   */
  if (detail === "full") {
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = offset.x * 0.3;
    ctx.shadowOffsetY = 1;
    ctx.shadowColor = `rgba(0,0,0,${Math.min(0.85, opacity * 1.4)})`;
    ctx.fill(path);
  }
  ctx.restore();
}

/**
 * A shadow cast by the *rim* of a shape onto its own interior.
 *
 * The technique is the only one that works on a canvas: clip to the shape, then
 * fill everything *outside* it with an offset shadow. The fill itself is
 * entirely clipped away and only its shadow survives, which lands inside the
 * shape and falls away from the light exactly as the wall of a recess would.
 * Filling the shape and blurring it would darken the middle too.
 *
 * `tone` is white for the light catching the inside of a raised band's far wall
 * and black for the shadow inside a recess; `away` flips which way it falls.
 */
export function innerCast(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  bounds: Rect,
  options: { blur: number; alpha: number; lift: number; tone?: "dark" | "light"; away?: boolean }
): void {
  const offset = shadowOffset(options.lift);
  const sign = options.away === false ? -1 : 1;
  const colour = options.tone === "light" ? "255,255,255" : "0,0,0";

  /**
   * A light-tone inner cast is a two-alpha-point lift on the far wall of a
   * raised plate. At tile finish it survives the downsample as nothing at all,
   * and it is a full blurred fill, so it is the first thing to go.
   */
  if (detail === "tile" && options.tone === "light") return;

  const outside = new Path2D();
  /**
   * The padding is the shadow's reach, not the object's size.
   *
   * This used to be `max(w, h) + blur * 4 + 64`, which for the frame band's
   * 512×680 bounds meant filling a 2104×2272 rectangle and asking the
   * rasteriser to blur every pixel of it — to produce a thirteen-pixel shadow
   * inside a path that is clipped to 512×680. The fill is a donut: only the part
   * of it within the shadow's reach of the path can possibly land inside the
   * clip, and the outer edge's own shadow falls outside the rectangle entirely.
   * So the pad only has to exceed blur plus the offset, and the same picture
   * comes out of a fifteenth of the area.
   */
  const pad = options.blur * 3 + Math.abs(offset.x) + Math.abs(offset.y) + 8;
  outside.rect(bounds.x - pad, bounds.y - pad, bounds.w + pad * 2, bounds.h + pad * 2);
  outside.addPath(path);

  ctx.save();
  ctx.clip(path);
  ctx.shadowColor = `rgba(${colour},${options.alpha})`;
  ctx.shadowBlur = options.blur;
  ctx.shadowOffsetX = offset.x * sign;
  ctx.shadowOffsetY = offset.y * sign;
  ctx.fillStyle = "#000";
  ctx.fill(outside, "evenodd");
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3. Grain
// ---------------------------------------------------------------------------

const GRAIN_TILE = 128;
const GRAIN_AMOUNT = 0.11;
const readyListeners = new Set<() => void>();
let grainImage: HTMLImageElement | null = null;
let grainPattern: CanvasPattern | null = null;

/**
 * Called once when the shared grain finishes decoding.
 *
 * A card drawn before then is correct in every way except that its surfaces are
 * mathematically smooth, which is precisely the thing §1 bans — so the canvas
 * wrapper repaints rather than living with it. One shot: after the first decode
 * there is nothing further to wait for, for the life of the page.
 */
export function onCardTextureReady(listener: () => void): () => void {
  if (grainImage) return () => {};
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

function startGrainLoad(): void {
  if (typeof Image === "undefined" || typeof document === "undefined") return;
  const uri = grainDataUri(GRAIN_TILE, GRAIN_AMOUNT, 0x48594245 ^ 0x0ca2d, 0.55);
  if (!uri) return;
  const image = new Image();
  image.onload = () => {
    grainImage = image;
    const listeners = [...readyListeners];
    readyListeners.clear();
    for (const listener of listeners) listener();
  };
  image.src = uri;
}
startGrainLoad();

/**
 * Lay the shared grain over everything inside `path`, at one tile cell per
 * device pixel whatever scale the card is being drawn at.
 *
 * The transform reset is the whole trick and it is safe: a clip set before the
 * reset stays where it was put, because a canvas resolves a clip into device
 * space the moment it is applied.
 */
export function grainOver(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  alpha: number,
  rule: CanvasFillRule = "nonzero"
): void {
  if (!grainImage || highContrast) return;
  grainPattern ??= ctx.createPattern(grainImage, "repeat");
  if (!grainPattern) return;
  const canvas = ctx.canvas;
  ctx.save();
  ctx.clip(path, rule);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 4. Plates
// ---------------------------------------------------------------------------

export interface PlateOptions {
  /** Face colours, darkest first. Defaults to a neutral card-furniture metal. */
  metal?: Metal;
  /** How much light the surface carries, 0–1. Matches the material ranks. */
  amplitude?: number;
  /** Alpha of the face; plates over artwork need to be near-opaque. */
  opacity?: number;
  /** Height above the backing. 0 skips the cast shadow. */
  lift?: number;
  grain?: number;
}

const FURNITURE: Metal = { hi: "#8e86ad", key: "#3b3352", lo: "#140f22", abyss: "#08050f" };

/**
 * A surface that sits proud of what it is on: gradient lighter toward the light,
 * a bright rim on the top-left, a dark lip on the bottom-right, and a cast
 * shadow underneath.
 */
export function raisedPlate(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  rect: Rect,
  options: PlateOptions = {}
): void {
  const metal = options.metal ?? FURNITURE;
  const amp = options.amplitude ?? 0.55;
  const opacity = options.opacity ?? 1;
  const lift = options.lift ?? 4;

  if (lift > 0) castShadow(ctx, path, lift, 0.42 + 0.2 * amp);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = litGradient(ctx, rect, [
    [0, mix(metal.lo, metal.abyss ?? "#000000", 0.45)],
    [0.4, metal.lo],
    [0.78, metal.key],
    [1, mix(metal.key, metal.hi, 0.55 * amp + 0.2)],
  ]);
  ctx.fill(path);
  ctx.restore();

  // the far inner wall catches light; the near one does not
  innerCast(ctx, path, rect, { blur: 7, alpha: 0.16 * amp + 0.06, lift: 3, tone: "light", away: true });
  innerCast(ctx, path, rect, { blur: 9, alpha: 0.3, lift: 3, tone: "dark", away: false });

  if (options.grain !== 0) grainOver(ctx, path, options.grain ?? 0.5);

  ctx.save();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.3 + 0.28 * amp, 0.62);
  ctx.stroke(path);
  ctx.restore();
}

/**
 * A surface cut into what it is on: gradient darker toward the light, the shadow
 * of the near wall falling across the inside, and a faint rim light where the
 * far wall turns up into the light. Casts nothing, because it is a hole.
 */
export function sunkenPlate(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  rect: Rect,
  options: PlateOptions = {}
): void {
  const metal = options.metal ?? FURNITURE;
  const amp = options.amplitude ?? 0.7;
  const opacity = options.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = litGradient(ctx, rect, [
    [0, mix(metal.lo, metal.key, 0.35)],
    [0.5, metal.lo],
    [1, mix(metal.lo, metal.abyss ?? "#000000", 0.55)],
  ]);
  ctx.fill(path);
  ctx.restore();

  innerCast(ctx, path, rect, { blur: 12 + 8 * amp, alpha: 0.55 * amp + 0.2, lift: 5, tone: "dark", away: true });
  innerCast(ctx, path, rect, { blur: 6, alpha: 0.1 * amp, lift: 3, tone: "light", away: false });

  if (options.grain !== 0) grainOver(ctx, path, options.grain ?? 0.42);

  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.22, 0.66, true);
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 5. Gems
// ---------------------------------------------------------------------------

export type GemShape = "hex" | "shield" | "round" | "diamond" | "star";

/** The vertices of a gem, in draw order. One family, five cuts. */
export function gemPoints(shape: GemShape, cx: number, cy: number, r: number): [number, number][] {
  const points: [number, number][] = [];
  const at = (angle: number, radius: number): [number, number] => [
    cx + Math.cos(angle) * radius,
    cy + Math.sin(angle) * radius,
  ];
  switch (shape) {
    case "hex":
      for (let i = 0; i < 6; i++) points.push(at((Math.PI / 3) * i - Math.PI / 2, r));
      break;
    case "shield":
      // a hexagon with its lower half drawn to a blade point
      points.push(at(-Math.PI / 2, r * 0.92));
      points.push(at(-Math.PI / 6, r * 0.98));
      points.push(at(Math.PI / 6, r * 0.82));
      points.push([cx, cy + r * 1.06]);
      points.push(at((Math.PI * 5) / 6, r * 0.82));
      points.push(at((Math.PI * 7) / 6, r * 0.98));
      break;
    case "round":
      for (let i = 0; i < 14; i++) points.push(at((Math.PI * 2 * i) / 14 - Math.PI / 2, r));
      break;
    case "diamond":
      points.push([cx, cy - r], [cx + r * 0.74, cy], [cx, cy + r], [cx - r * 0.74, cy]);
      break;
    case "star":
      for (let i = 0; i < 10; i++) {
        points.push(at((Math.PI / 5) * i - Math.PI / 2, i % 2 === 0 ? r : r * 0.46));
      }
      break;
  }
  return points;
}

export function gemPath(shape: GemShape, cx: number, cy: number, r: number): Path2D {
  const path = new Path2D();
  const points = gemPoints(shape, cx, cy, r);
  points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
}

export interface GemOptions {
  shape: GemShape;
  cx: number;
  cy: number;
  r: number;
  metal: Metal;
  /** A dark mount cut into whatever is beneath, so the gem is set rather than stuck on. */
  socket?: boolean;
  /** Coloured halo. Kept small: a gem is hardware, not a light source. */
  glow?: number;
  lift?: number;
}

/**
 * A cut stone: one polygon, shaded face by face against the key light, seated in
 * a socket and casting onto whatever it is mounted in.
 */
export function drawGem(ctx: CanvasRenderingContext2D, options: GemOptions): void {
  const { shape, cx, cy, r, metal } = options;
  const path = gemPath(shape, cx, cy, r);

  if (options.socket !== false) {
    const mount = gemPath(shape, cx, cy, r * 1.17);
    ctx.save();
    ctx.fillStyle = "rgba(4,2,10,0.82)";
    ctx.fill(mount);
    ctx.lineWidth = 2;
    ctx.strokeStyle = edgeGradient(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, 0.2, 0.5, true);
    ctx.stroke(mount);
    ctx.restore();
  }

  // a halo around an 13px gem in a 168px cell is one pixel of haze for a
  // blurred fill of the whole stone; the facets are what read at that size
  if (options.glow && detail === "full") {
    ctx.save();
    ctx.shadowColor = hexToRgba(metal.key, Math.min(0.9, options.glow));
    ctx.shadowBlur = r * 0.5;
    ctx.fillStyle = hexToRgba(metal.key, 0.9);
    ctx.fill(path);
    ctx.restore();
  }

  castShadow(ctx, path, options.lift ?? 3, 0.55);

  // per-facet shading: each wedge takes the brightness of the face it belongs to
  const points = gemPoints(shape, cx, cy, r);
  ctx.save();
  ctx.clip(path);
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const mx = (a[0] + b[0]) / 2 - cx;
    const my = (a[1] + b[1]) / 2 - cy;
    const length = Math.hypot(mx, my) || 1;
    const lambert = (mx / length) * TO_LIGHT.x + (my / length) * TO_LIGHT.y;
    const t = (lambert + 1) / 2;
    const face = t > 0.5 ? mix(metal.key, metal.hi, (t - 0.5) * 1.7) : mix(metal.lo, metal.key, t * 2);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.closePath();
    ctx.fillStyle = face;
    ctx.fill();
  }
  // a table across the middle, so the wedges read as facets around a flat top
  const table = gemPath(shape, cx, cy, r * 0.5);
  ctx.fillStyle = litGradient(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, [
    [0, mix(metal.lo, metal.key, 0.5)],
    [1, mix(metal.key, metal.hi, 0.62)],
  ]);
  ctx.fill(table);
  ctx.restore();

  // specular pip on the lit shoulder, and the rim
  if (detail === "full") {
    ctx.save();
    ctx.clip(path);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(cx + TO_LIGHT.x * r * 0.5, cy + TO_LIGHT.y * r * 0.5, r * 0.26, r * 0.16, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.lineWidth = Math.max(1.4, r * 0.06);
  ctx.strokeStyle = edgeGradient(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, 0.72, 0.7);
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 6. Type
// ---------------------------------------------------------------------------

const DEFAULT_STACK = '"Segoe UI", system-ui, sans-serif';
const DYSLEXIA_STACK = '"Atkinson Hyperlegible", "Comic Sans MS", Verdana, Tahoma, system-ui, sans-serif';

let stack = DEFAULT_STACK;
let highContrast = false;

/**
 * Keep the card face in step with the two accessibility settings it can honour.
 *
 * The dyslexia setting swaps the family on `body` and `.screen`, which meant the
 * single most text-dense surface in the game — the rules text on every card —
 * was the one surface that ignored the accessibility switch it most needed. High
 * contrast is the same story from the other end: `foundation.css` sets
 * `--tex-grain: none` because 4% decoration is exactly what that setting exists
 * to remove, and a canvas laying its own grain over the top would quietly
 * undo it.
 *
 * The root element's attributes are the authority rather than the settings
 * store, for the same reason `motion.ts` reads them: they are what the rest of
 * the page is actually obeying this frame. Two dataset reads per card paint, no
 * layout.
 */
export function refreshCardStyle(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  stack = root.dataset["font"] === "dyslexia" ? DYSLEXIA_STACK : DEFAULT_STACK;
  highContrast = root.dataset["contrast"] === "high";
}

/** Whether the player has asked for maximum contrast — decoration comes off. */
export const cardHighContrast = (): boolean => highContrast;

export function cardFont(size: number, weight: number, italic = false): string {
  return `${italic ? "italic " : ""}${weight} ${size}px ${stack}`;
}

/**
 * The five canvas type roles, mirroring module A's DOM roles.
 *
 * Fixed steps, not a continuous shrink. The old renderer fitted a name anywhere
 * between 30px and 15px and a body anywhere between 20px and 11px, so two cards
 * side by side in one grid printed their names at exactly double each other's
 * size and their rules text at anything at all. A hierarchy is a small set of
 * sizes used consistently; four hundred sizes is the absence of one.
 */
export const TYPE = {
  name: [33, 25, 19] as const,
  body: [19, 16.5, 14] as const,
  boardBody: [20, 17.5, 15.5] as const,
  label: 13,
  footer: 11,
} as const;

/** Small caps, tracked out, with a shadow that keeps it off the artwork. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: { size?: number; colour: string; tracking?: number; align?: CanvasTextAlign; shadow?: number }
): void {
  ctx.save();
  ctx.font = cardFont(options.size ?? TYPE.label, 700);
  ctx.textAlign = options.align ?? "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${options.tracking ?? 2.4}px`;
  if (options.shadow !== 0) {
    ctx.shadowColor = `rgba(0,0,0,${options.shadow ?? 0.9})`;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
  }
  ctx.fillStyle = options.colour;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

/**
 * A number laid out on fixed-width digit cells.
 *
 * `font-variant-numeric: tabular-nums` has no canvas equivalent, and a
 * proportional 1 is narrower than a 0 — so a health gem counting 10 → 9 → 8
 * visibly shuffles its glyphs inside a mount that has not moved. Measuring the
 * widest digit once and centring every glyph in a cell of that width is the same
 * guarantee by hand, and it also means a two-digit value is always exactly twice
 * as wide as a one-digit one, which is what lets the shrink-to-fit below be
 * deterministic.
 */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: number | string,
  cx: number,
  cy: number,
  options: { size: number; minSize?: number; maxWidth: number; colour: string; outline?: number; weight?: number }
): void {
  const text = String(value);
  const weight = options.weight ?? 800;
  let size = options.size;
  const minSize = options.minSize ?? Math.round(options.size * 0.55);

  const cellWidth = (at: number): number => {
    ctx.font = cardFont(at, weight);
    let widest = 0;
    for (let d = 0; d <= 9; d++) widest = Math.max(widest, ctx.measureText(String(d)).width);
    return widest;
  };

  let cell = cellWidth(size);
  while (cell * text.length > options.maxWidth && size > minSize) {
    size -= 1;
    cell = cellWidth(size);
  }

  ctx.save();
  ctx.font = cardFont(size, weight);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const total = cell * text.length;
  let x = cx - total / 2 + cell / 2;
  for (const glyph of text) {
    if (options.outline) {
      ctx.lineWidth = options.outline;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(glyph, x, cy);
    }
    ctx.fillStyle = options.colour;
    ctx.fillText(glyph, x, cy);
    x += cell;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 7. Rules
// ---------------------------------------------------------------------------

/**
 * A divider whose alpha ramps to nothing at both ends.
 *
 * §7 makes end-fading a rule: a hairline that butts hard into a plate edge is
 * the tell that a layout engine placed it rather than somebody drawing it.
 */
export function fadedRule(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  colour: string,
  alpha: number,
  weight = 1
): void {
  const gradient = ctx.createLinearGradient(x1, y, x2, y);
  gradient.addColorStop(0, hexToRgba(colour, 0));
  gradient.addColorStop(0.18, hexToRgba(colour, alpha * 0.7));
  gradient.addColorStop(0.5, hexToRgba(colour, alpha));
  gradient.addColorStop(0.82, hexToRgba(colour, alpha * 0.7));
  gradient.addColorStop(1, hexToRgba(colour, 0));
  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 8. Arriving artwork
// ---------------------------------------------------------------------------

/**
 * Above this many at once, art swaps in hard.
 *
 * A crossfade needs the incoming frame rendered somewhere before it can be
 * blended, and the collection holds 245 canvases whose art can all finish
 * decoding inside the same few hundred milliseconds on a warm cache. One
 * offscreen each, at 336×446 device pixels, is 19MB; the obvious two-offscreen
 * implementation — copy the old frame out, render the new one, blend between
 * them — is 40MB, and if the cap were removed it would be nearly 300MB, which is
 * a crash on a phone rather than a polish item. So: one offscreen, and a bound.
 */
const MAX_CROSSFADES = 32;
let crossfades = 0;

/**
 * Blend a freshly rendered frame in over whatever the canvas is already
 * showing.
 *
 * The single-offscreen trick is the incremental alpha. Painting the new frame at
 * the eased progress every frame *without clearing* would compound — after ten
 * frames at 0.3 the old image is at 0.7¹⁰ rather than 0.7 — so each frame asks
 * for the alpha that takes the accumulated coverage from where it is to where
 * the curve says it should be. The result is an exact eased crossfade with no
 * copy of the outgoing frame anywhere.
 *
 * Under reduced motion it is a straight repaint, which is the correct reading of
 * the setting: the art still arrives, it just does not travel to get there.
 */
export function crossfadeIn(
  canvas: HTMLCanvasElement,
  render: (target: CanvasRenderingContext2D) => void,
  repaint: () => void
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !motionEnabled() || crossfades >= MAX_CROSSFADES || typeof document === "undefined") {
    repaint();
    return;
  }
  const next = document.createElement("canvas");
  next.width = canvas.width;
  next.height = canvas.height;
  const nextCtx = next.getContext("2d");
  if (!nextCtx) {
    repaint();
    return;
  }
  render(nextCtx);

  crossfades += 1;
  const curve = bezier(EASE.arrive);
  let elapsed = 0;
  let covered = 0;
  const stop = onMotionFrame((dt) => {
    elapsed += dt;
    const t = Math.min(1, elapsed / DUR.ui);
    const target = curve(t);
    const step = covered >= 1 ? 1 : (target - covered) / (1 - covered);
    covered = target;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, step));
    ctx.drawImage(next, 0, 0);
    ctx.restore();
    if (t >= 1) {
      stop();
      crossfades -= 1;
      repaint();
    }
  });
}

/** A rounded rectangle as a `Path2D`, for everything that is not a Current shape. */
export function roundRectPath(rect: Rect, radius: number): Path2D {
  const path = new Path2D();
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  path.moveTo(rect.x + r, rect.y);
  path.lineTo(rect.x + rect.w - r, rect.y);
  path.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r);
  path.lineTo(rect.x + rect.w, rect.y + rect.h - r);
  path.quadraticCurveTo(rect.x + rect.w, rect.y + rect.h, rect.x + rect.w - r, rect.y + rect.h);
  path.lineTo(rect.x + r, rect.y + rect.h);
  path.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - r);
  path.lineTo(rect.x, rect.y + r);
  path.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  path.closePath();
  return path;
}
