/**
 * Procedural card-frame silhouettes — one per Current.
 *
 * Each function traces a closed path on the 2D context. The silhouette is the
 * primary non-colour way a player identifies a card's Current at a glance
 * (canon §8: colour must never be the only differentiator), so the shapes are
 * deliberately distinct in outline, not just in trim.
 *
 * ## Every shape takes an amplitude, and that is the whole of the redesign
 *
 * The outline used to carry its signature entirely in features that stuck *out*
 * of the card rectangle — Cinder's peaks 15px above it, Pulse's steps 12px past
 * the right edge, Tide's bulges 9px — on a canvas that was exactly the card's
 * size with an 8px margin. So the identity was either clipped flat or, on the
 * shapes that survived, a 28px rise across a 496px edge, which is a 1:18 ratio
 * and invisible the moment the card is drawn at grid size.
 *
 * Both problems have one fix. The features are now scaled by `amp`, and the card
 * is drawn as a *band*: the outer contour at amp 1, where nothing reaches more
 * than 9px past the rectangle and everything fits inside the bleed with room for
 * the rim glow to fade, and the inner contour at roughly amp 2, where the same
 * signature bites deep enough into a twenty-pixel band to be read at 168px.
 * Cinder's flames lick through the metal, Halo's dome arcs across the top of the
 * window, Pulse's steps notch the side rails. The identity is now in the part of
 * the frame there is room for it in, rather than in the part that got cut off.
 */

import type { FrameShape } from "./palette";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type PathTarget = CanvasRenderingContext2D | Path2D;
type PathFn = (ctx: PathTarget, r: Rect, amp: number) => void;

const lineTo = (ctx: PathTarget, x: number, y: number): void => ctx.lineTo(x, y);
const moveTo = (ctx: PathTarget, x: number, y: number): void => ctx.moveTo(x, y);

/** Rounded rectangle used as the base for several shapes. */
function roundedRect(ctx: PathTarget, r: Rect, radius: number): void {
  const { x, y, w, h } = r;
  const rad = Math.min(radius, w / 2, h / 2);
  moveTo(ctx, x + rad, y);
  lineTo(ctx, x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  lineTo(ctx, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  lineTo(ctx, x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/** CINDER — flame notches lick up off the top edge and down off the bottom. */
const flameNotch: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const rad = 14;
  const notches = 5;
  const notchW = w / (notches * 2 + 1);
  const notchH = 9 * amp;

  moveTo(ctx, x + rad, y);
  for (let i = 0; i < notches; i++) {
    const bx = x + notchW * (i * 2 + 1);
    lineTo(ctx, bx, y);
    // alternating heights, and a curl on the tall ones so they read as flame
    const tall = i % 2 === 0;
    const peak = notchH * (tall ? 1 : 0.62);
    ctx.quadraticCurveTo(bx + notchW * 0.2, y - peak * 0.55, bx + notchW * 0.52, y - peak);
    ctx.quadraticCurveTo(bx + notchW * 0.78, y - peak * 0.5, bx + notchW, y);
    lineTo(ctx, bx + notchW, y);
  }
  lineTo(ctx, x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  lineTo(ctx, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  // bottom edge with a single wide ember flare
  lineTo(ctx, x + w * 0.62, y + h);
  ctx.quadraticCurveTo(x + w * 0.56, y + h + 8 * amp * 0.9, x + w * 0.5, y + h + 8 * amp);
  ctx.quadraticCurveTo(x + w * 0.44, y + h + 8 * amp * 0.9, x + w * 0.38, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  lineTo(ctx, x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
};

/** TIDE — soft rounded body with wave crests along the vertical edges. */
const waveRound: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const rad = 30;
  const bulge = 6 * amp;
  moveTo(ctx, x + rad, y);
  lineTo(ctx, x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  for (let i = 0; i < 3; i++) {
    const y0 = y + rad + ((h - rad * 2) / 3) * i;
    const y1 = y + rad + ((h - rad * 2) / 3) * (i + 1);
    ctx.quadraticCurveTo(x + w + bulge, (y0 + y1) / 2, x + w, y1);
  }
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  for (let i = 2; i >= 0; i--) {
    const y0 = y + rad + ((h - rad * 2) / 3) * (i + 1);
    const y1 = y + rad + ((h - rad * 2) / 3) * i;
    ctx.quadraticCurveTo(x - bulge, (y0 + y1) / 2, x, y1);
  }
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
};

/** ROOT — heavy hexagonal stone with deep chamfered corners. */
const hexStone: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const c = 34 + 13 * (amp - 1);
  moveTo(ctx, x + c, y);
  lineTo(ctx, x + w - c, y);
  lineTo(ctx, x + w, y + c);
  lineTo(ctx, x + w, y + h - c);
  lineTo(ctx, x + w - c, y + h);
  lineTo(ctx, x + c, y + h);
  lineTo(ctx, x, y + h - c);
  lineTo(ctx, x, y + c);
  ctx.closePath();
};

/** GALE — asymmetric sweep: two opposite corners cut long and low. */
const ribbonSweep: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const long = 58 + 34 * (amp - 1);
  const short = 12;
  moveTo(ctx, x + short, y);
  lineTo(ctx, x + w - long, y);
  ctx.quadraticCurveTo(x + w - long * 0.3, y + 4, x + w, y + long * 0.62);
  lineTo(ctx, x + w, y + h - short);
  ctx.quadraticCurveTo(x + w, y + h, x + w - short, y + h);
  lineTo(ctx, x + long, y + h);
  ctx.quadraticCurveTo(x + long * 0.3, y + h - 4, x, y + h - long * 0.62);
  lineTo(ctx, x, y + short);
  ctx.quadraticCurveTo(x, y, x + short, y);
  ctx.closePath();
};

/** PULSE — chamfered corners with stepped circuit notches on the sides. */
const circuitAngle: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  // the chamfer only ever grows; only the steps change direction
  const c = 24 + 9 * (Math.abs(amp) - 1);
  const step = 7 * amp;
  moveTo(ctx, x + c, y);
  lineTo(ctx, x + w - c, y);
  lineTo(ctx, x + w, y + c);
  lineTo(ctx, x + w, y + h * 0.26);
  lineTo(ctx, x + w + step, y + h * 0.29);
  lineTo(ctx, x + w + step, y + h * 0.45);
  lineTo(ctx, x + w, y + h * 0.48);
  lineTo(ctx, x + w, y + h - c);
  lineTo(ctx, x + w - c, y + h);
  lineTo(ctx, x + c, y + h);
  lineTo(ctx, x, y + h - c);
  lineTo(ctx, x, y + h * 0.74);
  lineTo(ctx, x - step, y + h * 0.71);
  lineTo(ctx, x - step, y + h * 0.55);
  lineTo(ctx, x, y + h * 0.52);
  lineTo(ctx, x, y + c);
  ctx.closePath();
};

/**
 * HALO — the top edge arcs into a radiant dome.
 *
 * The dome used to rise 26px over 496 and was, correctly, called invisible. It
 * still rises only 9px on the outer contour, because that is all the bleed can
 * hold — but the inner contour runs at amp 2, where the same curve drops 34px
 * below the shoulders and the art window is unmistakably domed.
 */
const radiantCircle: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const rad = 16;
  const crown = 9 * amp; // how far the arc's apex rises above the rectangle
  const drop = 17 * amp; // ...and how far the shoulders sit below it
  const shoulder = y + drop;
  const springs = shoulder - rad * 0.35;
  /**
   * A symmetric cubic sits at (P0 + 3·P1)/4 halfway along, so solving for the
   * control that puts the apex exactly `crown` above the rectangle is one line —
   * and worth doing, because an eyeballed control point makes the arc's height a
   * function of the shoulder drop, and then Halo's dome changes shape whenever
   * the band thickness is retuned.
   */
  const apexControl = (4 * (y - crown) - springs) / 3;
  moveTo(ctx, x, shoulder + rad);
  ctx.quadraticCurveTo(x, shoulder, x + rad, springs);
  ctx.bezierCurveTo(x + w * 0.2, apexControl, x + w * 0.8, apexControl, x + w - rad, springs);
  ctx.quadraticCurveTo(x + w, shoulder, x + w, shoulder + rad);
  lineTo(ctx, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.closePath();
};

/** VEIL — a fractured mirror: jagged shard cuts along every edge. */
const shardMirror: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const a = 5 * amp;
  const b = 9 * amp;
  moveTo(ctx, x + 16, y + b * 0.7);
  lineTo(ctx, x + w * 0.34, y - a * 0.8);
  lineTo(ctx, x + w * 0.52, y + b);
  lineTo(ctx, x + w * 0.74, y - a * 0.6);
  lineTo(ctx, x + w - 10, y + b * 1.1);
  lineTo(ctx, x + w + a, y + h * 0.22);
  lineTo(ctx, x + w - b * 0.7, y + h * 0.41);
  lineTo(ctx, x + w + a, y + h * 0.63);
  lineTo(ctx, x + w - b, y + h - 14);
  lineTo(ctx, x + w * 0.7, y + h + a * 0.9);
  lineTo(ctx, x + w * 0.46, y + h - b * 0.8);
  lineTo(ctx, x + w * 0.24, y + h + a * 0.8);
  lineTo(ctx, x + 10, y + h - b * 1.5);
  lineTo(ctx, x - a, y + h * 0.66);
  lineTo(ctx, x + b * 0.9, y + h * 0.45);
  lineTo(ctx, x - a, y + h * 0.24);
  ctx.closePath();
};

/** PRISM — many small facet cuts, like a cut gemstone. */
const crystalFacet: PathFn = (ctx, r, amp) => {
  const { x, y, w, h } = r;
  const c = 20 + 8 * (Math.abs(amp) - 1);
  const m = 13;
  const out = 5 * amp;
  moveTo(ctx, x + c, y);
  lineTo(ctx, x + w * 0.5 - m, y - out);
  lineTo(ctx, x + w * 0.5 + m, y - out);
  lineTo(ctx, x + w - c, y);
  lineTo(ctx, x + w, y + c);
  lineTo(ctx, x + w + out, y + h * 0.5 - m);
  lineTo(ctx, x + w + out, y + h * 0.5 + m);
  lineTo(ctx, x + w, y + h - c);
  lineTo(ctx, x + w - c, y + h);
  lineTo(ctx, x + w * 0.5 + m, y + h + out);
  lineTo(ctx, x + w * 0.5 - m, y + h + out);
  lineTo(ctx, x + c, y + h);
  lineTo(ctx, x, y + h - c);
  lineTo(ctx, x - out, y + h * 0.5 + m);
  lineTo(ctx, x - out, y + h * 0.5 - m);
  lineTo(ctx, x, y + c);
  ctx.closePath();
};

const SHAPES: Record<FrameShape, PathFn> = {
  "flame-notch": flameNotch,
  "wave-round": waveRound,
  "hex-stone": hexStone,
  "ribbon-sweep": ribbonSweep,
  "circuit-angle": circuitAngle,
  "radiant-circle": radiantCircle,
  "shard-mirror": shardMirror,
  "crystal-facet": crystalFacet,
};

/** How far past `rect` a shape reaches at amp 1 — the bleed must exceed this. */
export const MAX_OVERHANG = 9;

/**
 * The amplitude the *inner* contour of the frame band runs at, per shape.
 *
 * A negative value turns a feature that protrudes into a feature that bites: at
 * −1.9 Cinder's five flame peaks point down through the metal into the art
 * window instead of up off the card, which is the only way a notch can be made
 * three times deeper without either leaving the canvas or crossing the outer
 * contour and punching a hole in the frame. Shapes whose signature is a chamfer
 * or a shear rather than a spike simply grow, so they stay positive.
 *
 * Every value here is chosen so the inner contour stays strictly inside the
 * outer one at every angle; the band is additionally drawn under a clip to the
 * outer path, which makes a mistake here a thin frame rather than a hole.
 */
const INNER_AMP: Record<FrameShape, number> = {
  "flame-notch": -1.9,
  "wave-round": -1.7,
  "hex-stone": 2.4,
  "ribbon-sweep": 2.3,
  "circuit-angle": -1.8,
  "radiant-circle": 1.8,
  "shard-mirror": 1.9,
  "crystal-facet": 1.9,
};

/** Trace the silhouette for a Current's frame shape. */
export function traceFrame(ctx: PathTarget, shape: FrameShape, rect: Rect, amp = 1): void {
  SHAPES[shape](ctx, rect, amp);
}

/** The same silhouette as a reusable `Path2D`. */
export function framePath(shape: FrameShape, rect: Rect, amp = 1): Path2D {
  const path = new Path2D();
  SHAPES[shape](path, rect, amp);
  return path;
}

/**
 * The inner boundary of the frame band.
 *
 * Inset *and* exaggerated: the band is where the Current's signature actually
 * gets read, because at grid size a 9px feature on the outline is a pixel and a
 * half while the same feature cut through a twenty-pixel band is a hole in the
 * metal you cannot miss.
 */
export function traceInner(ctx: PathTarget, shape: FrameShape, rect: Rect, inset: number, amp?: number): void {
  SHAPES[shape](
    ctx,
    { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 },
    amp ?? INNER_AMP[shape]
  );
}

export function innerPath(shape: FrameShape, rect: Rect, inset: number, amp?: number): Path2D {
  const path = new Path2D();
  traceInner(path, shape, rect, inset, amp);
  return path;
}

/** Both boundaries of the frame band, ready to fill even-odd. */
export function bandPaths(
  shape: FrameShape,
  rect: Rect,
  inset: number
): { outer: Path2D; inner: Path2D; band: Path2D } {
  const outer = framePath(shape, rect, 1);
  const inner = innerPath(shape, rect, inset);
  const band = new Path2D();
  band.addPath(outer);
  band.addPath(inner);
  return { outer, inner, band };
}

/**
 * Rarity furniture does not live in the corners, and this note is why the
 * lookup that used to say where it did has gone.
 *
 * Every corner of a HYPEBOUND card is already occupied: the cost gem's collar
 * covers card-space x 33–123 / y 21–111, the Current cartouche runs x 318–462 /
 * y 47–85, and the two stat gems reach a 47px radius into the bottom corners. A
 * corner ornament was drawn correctly and then painted over by hardware on all
 * four sides, which is why the rare tier measured as frame-identical to common.
 * The tier now runs along the mid-edges — see `renderCard::drawRailInlay`, which
 * intersects a plain capsule with `bandPaths().band` and therefore needs nothing
 * per-shape from this file.
 */

export { roundedRect };
