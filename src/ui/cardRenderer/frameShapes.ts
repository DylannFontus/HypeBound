/**
 * Procedural card-frame silhouettes — one per Current.
 *
 * Each function traces a closed path on the 2D context. The silhouette is the
 * primary non-colour way a player identifies a card's Current at a glance
 * (canon §8: colour must never be the only differentiator), so the shapes are
 * deliberately distinct in outline, not just in trim.
 */

import type { FrameShape } from "./palette";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type PathFn = (ctx: CanvasRenderingContext2D | Path2D, r: Rect) => void;

const lineTo = (ctx: CanvasRenderingContext2D | Path2D, x: number, y: number): void => ctx.lineTo(x, y);
const moveTo = (ctx: CanvasRenderingContext2D | Path2D, x: number, y: number): void => ctx.moveTo(x, y);

/** Rounded rectangle used as the base for several shapes. */
function roundedRect(ctx: CanvasRenderingContext2D | Path2D, r: Rect, radius: number): void {
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

/** CINDER — flame notches bite into the top and bottom edges. */
const flameNotch: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const rad = 16;
  const notches = 5;
  const notchW = w / (notches * 2 + 1);
  const notchH = 15;

  moveTo(ctx, x + rad, y);
  // top edge with upward flame peaks
  for (let i = 0; i < notches; i++) {
    const bx = x + notchW * (i * 2 + 1);
    lineTo(ctx, bx, y);
    lineTo(ctx, bx + notchW * 0.5, y - notchH * (i % 2 === 0 ? 1 : 0.6));
    lineTo(ctx, bx + notchW, y);
  }
  lineTo(ctx, x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  lineTo(ctx, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  // bottom edge with a single wide ember flare
  lineTo(ctx, x + w * 0.62, y + h);
  lineTo(ctx, x + w * 0.5, y + h + 12);
  lineTo(ctx, x + w * 0.38, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  lineTo(ctx, x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
};

/** TIDE — soft rounded body with wave crests along the vertical edges. */
const waveRound: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const rad = 34;
  moveTo(ctx, x + rad, y);
  lineTo(ctx, x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  // right edge: three wave bulges
  for (let i = 0; i < 3; i++) {
    const y0 = y + rad + ((h - rad * 2) / 3) * i;
    const y1 = y + rad + ((h - rad * 2) / 3) * (i + 1);
    const mid = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x + w + 9, mid, x + w, y1);
  }
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  // left edge: mirrored waves
  for (let i = 2; i >= 0; i--) {
    const y0 = y + rad + ((h - rad * 2) / 3) * (i + 1);
    const y1 = y + rad + ((h - rad * 2) / 3) * i;
    const mid = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x - 9, mid, x, y1);
  }
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
};

/** ROOT — heavy hexagonal stone with deep chamfered corners. */
const hexStone: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const c = 40;
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
const ribbonSweep: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const long = 62;
  const short = 14;
  moveTo(ctx, x + short, y);
  lineTo(ctx, x + w - long, y);
  ctx.quadraticCurveTo(x + w - long * 0.35, y + 3, x + w, y + long * 0.55);
  lineTo(ctx, x + w, y + h - short);
  ctx.quadraticCurveTo(x + w, y + h, x + w - short, y + h);
  lineTo(ctx, x + long, y + h);
  ctx.quadraticCurveTo(x + long * 0.35, y + h - 3, x, y + h - long * 0.55);
  lineTo(ctx, x, y + short);
  ctx.quadraticCurveTo(x, y, x + short, y);
  ctx.closePath();
};

/** PULSE — chamfered corners with stepped circuit notches on the sides. */
const circuitAngle: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const c = 26;
  const step = 12;
  moveTo(ctx, x + c, y);
  lineTo(ctx, x + w - c, y);
  lineTo(ctx, x + w, y + c);
  // right edge with two outward steps
  lineTo(ctx, x + w, y + h * 0.3);
  lineTo(ctx, x + w + step, y + h * 0.3);
  lineTo(ctx, x + w + step, y + h * 0.42);
  lineTo(ctx, x + w, y + h * 0.42);
  lineTo(ctx, x + w, y + h - c);
  lineTo(ctx, x + w - c, y + h);
  lineTo(ctx, x + c, y + h);
  lineTo(ctx, x, y + h - c);
  // left edge with mirrored steps
  lineTo(ctx, x, y + h * 0.58);
  lineTo(ctx, x - step, y + h * 0.58);
  lineTo(ctx, x - step, y + h * 0.7);
  lineTo(ctx, x, y + h * 0.7);
  lineTo(ctx, x, y + c);
  ctx.closePath();
};

/** HALO — the top edge arcs into a radiant dome. */
const radiantCircle: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const rad = 18;
  const dome = 26;
  moveTo(ctx, x, y + dome + rad);
  ctx.quadraticCurveTo(x, y + dome, x + rad, y + dome - rad * 0.4);
  // dome across the top
  ctx.bezierCurveTo(x + w * 0.22, y - dome * 0.75, x + w * 0.78, y - dome * 0.75, x + w - rad, y + dome - rad * 0.4);
  ctx.quadraticCurveTo(x + w, y + dome, x + w, y + dome + rad);
  lineTo(ctx, x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  lineTo(ctx, x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.closePath();
};

/** VEIL — a fractured mirror: jagged shard cuts along every edge. */
const shardMirror: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  // deterministic jitter so the shape is identical on every render
  const j = (i: number, amp: number): number => (Math.sin(i * 12.9898) * 43758.5453 % 1) * amp;
  moveTo(ctx, x + 18, y + 6);
  lineTo(ctx, x + w * 0.34, y - 4);
  lineTo(ctx, x + w * 0.52, y + 8);
  lineTo(ctx, x + w * 0.74, y - 3);
  lineTo(ctx, x + w - 12, y + 10);
  lineTo(ctx, x + w + 6, y + h * 0.22);
  lineTo(ctx, x + w - 6, y + h * 0.41);
  lineTo(ctx, x + w + 7, y + h * 0.63);
  lineTo(ctx, x + w - 9, y + h - 16);
  lineTo(ctx, x + w * 0.7, y + h + 5);
  lineTo(ctx, x + w * 0.46, y + h - 7);
  lineTo(ctx, x + w * 0.24, y + h + 4);
  lineTo(ctx, x + 12, y + h - 14);
  lineTo(ctx, x - 6, y + h * 0.66);
  lineTo(ctx, x + 8, y + h * 0.45 + j(3, 3));
  lineTo(ctx, x - 5, y + h * 0.24);
  ctx.closePath();
};

/** PRISM — many small facet cuts, like a cut gemstone. */
const crystalFacet: PathFn = (ctx, r) => {
  const { x, y, w, h } = r;
  const c = 22;
  const m = 13;
  moveTo(ctx, x + c, y);
  lineTo(ctx, x + w * 0.5 - m, y - 6);
  lineTo(ctx, x + w * 0.5 + m, y - 6);
  lineTo(ctx, x + w - c, y);
  lineTo(ctx, x + w, y + c);
  lineTo(ctx, x + w + 6, y + h * 0.5 - m);
  lineTo(ctx, x + w + 6, y + h * 0.5 + m);
  lineTo(ctx, x + w, y + h - c);
  lineTo(ctx, x + w - c, y + h);
  lineTo(ctx, x + w * 0.5 + m, y + h + 6);
  lineTo(ctx, x + w * 0.5 - m, y + h + 6);
  lineTo(ctx, x + c, y + h);
  lineTo(ctx, x, y + h - c);
  lineTo(ctx, x - 6, y + h * 0.5 + m);
  lineTo(ctx, x - 6, y + h * 0.5 - m);
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

/** Trace the silhouette for a Current's frame shape. */
export function traceFrame(ctx: CanvasRenderingContext2D | Path2D, shape: FrameShape, rect: Rect): void {
  SHAPES[shape](ctx, rect);
}

/** A softened inner version of the silhouette, used for the frame's inner bevel. */
export function traceInner(ctx: CanvasRenderingContext2D | Path2D, shape: FrameShape, rect: Rect, inset: number): void {
  traceFrame(ctx, shape, { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 });
}

export { roundedRect };
