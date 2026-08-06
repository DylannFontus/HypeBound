/**
 * The art-pending treatment.
 *
 * Roughly 176 of 296 cards wear this today and some will wear it for months, so
 * it is not a fallback — it is a long-lived, heavily-seen state, and §5 of the
 * AAA bar applies to it in full. The one thing it has to achieve is that a
 * player looking at an unpainted card thinks *"that is the art-pending
 * treatment"* and never *"that one is broken"*.
 *
 * ## What it used to be, and the two bugs that made it read as a failed load
 *
 * A two-stop vertical gradient, three 30%-alpha spotlight cones, and a
 * silhouetted figure — torso from 0.96h up to 0.58h with a head circle above it.
 * The figure was composed against the full 512×680 card while the card's bottom
 * scrim covers everything from 0.52h down and is 93% opaque by 0.55h, so the
 * torso was buried and only the head survived: a disembodied black ball floating
 * in the middle of three cards in five. Inside `renderLeader`'s circular clip
 * the same silhouette turned every unpainted leader into a keyhole. And the
 * honest "ART PENDING" disclosure — the one element that would have told a
 * player this was deliberate — was drawn at `rect.h - 6`, underneath the rules
 * box and the stat gems, where nothing has ever seen it.
 *
 * A humanoid silhouette is the single thing that cannot survive a scrim, so it
 * is gone. What replaced it is composed entirely in the band the scrim leaves
 * visible and is *rotationally* organised rather than figuratively, which is
 * what lets the same routine fill a 512×680 rectangle and a 252px circle without
 * either one looking cropped:
 *
 * - a lit backdrop, keyed to the 315° rig rather than running straight down;
 * - a **Current-specific etched guilloche**, engraved rather than drawn — every
 *   stroke is laid twice, dark down-right and light up-left, so it reads as
 *   tooling in a surface instead of ink on one;
 * - an **embossed faction crest** at watermark strength, taken from the painted
 *   crest where one exists and from the procedural emblem where it does not;
 * - grain, from the same generator every other surface in the game uses;
 * - a corner vignette;
 * - and the disclosure, at a position the *caller* chooses, because only the
 *   caller knows where its own furniture is going to land.
 *
 * Every mark is derived from a hash of the card's name, so a card's placeholder
 * is the same picture on every machine and in every session and two screenshots
 * of the collection differ only where something actually changed.
 */

import type { CurrentId, FactionId } from "../../engine/types";
import { CURRENT_PALETTE, FACTION_INDEX, hexToRgba, mix } from "./palette";
import type { Rect } from "./frameShapes";
import { drawFactionCrest } from "./icons";
import { TO_LIGHT, fadedRule, grainOver, cardFont, isTileDetail } from "./material";

export interface PlaceholderOptions {
  /** Which crest to emboss. Omitted falls back to the neutral emblem. */
  faction?: FactionId;
  /**
   * Where to print the honest "ART PENDING" line, in the caller's coordinates,
   * or `null` to leave it to the caller. There is no sensible default: on a card
   * the only unoccluded band is above the bottom scrim, and on a leader
   * medallion it is the middle of a circle.
   */
  disclosure?: { cx: number; y: number; width: number } | null;
}

/** Deterministic hash so a card's placeholder never changes between runs. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Engraving
// ---------------------------------------------------------------------------

/**
 * Run a drawing twice to make it look cut into the surface rather than drawn on
 * it: once in shadow, offset away from the key light, and once in highlight,
 * offset toward it. One pixel of offset at 512px is all it takes, and it is the
 * difference between a guilloche and a doodle.
 */
function etch(
  ctx: CanvasRenderingContext2D,
  light: string,
  strength: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /**
   * At tile finish the two passes land on the same pixel, so only one is drawn.
   *
   * The offsets are 1.5px and 1px in card space. A 512px card in a 168px cell is
   * a 3:1 downsample, which puts both passes inside half a destination pixel of
   * each other: the emboss cannot survive, and the guilloche is several hundred
   * strokes, so drawing it twice is the single most expensive thing on an
   * unpainted tile. One pass, at the alpha the pair averaged to.
   */
  if (isTileDetail()) {
    ctx.strokeStyle = hexToRgba(light, 0.4 * strength);
    ctx.fillStyle = hexToRgba(light, 0.4 * strength);
    draw(ctx);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(-TO_LIGHT.x * 1.5, -TO_LIGHT.y * 1.5);
  ctx.strokeStyle = `rgba(0,0,0,${0.5 * strength})`;
  ctx.fillStyle = `rgba(0,0,0,${0.5 * strength})`;
  draw(ctx);
  ctx.restore();

  ctx.save();
  ctx.translate(TO_LIGHT.x * 1, TO_LIGHT.y * 1);
  ctx.strokeStyle = hexToRgba(light, 0.44 * strength);
  ctx.fillStyle = hexToRgba(light, 0.44 * strength);
  draw(ctx);
  ctx.restore();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// The eight guilloches
// ---------------------------------------------------------------------------

interface Field {
  cx: number;
  cy: number;
  /** the reach of the pattern from its centre */
  R: number;
  rect: Rect;
  rand: () => number;
}

const TAU = Math.PI * 2;

/** HALO — a rayed sunburst inside two engine-turned rings. */
function ridgeHalo(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 36; i++) {
    const a = (TAU * i) / 36;
    const inner = f.R * (i % 3 === 0 ? 0.2 : 0.34);
    const outer = f.R * (i % 3 === 0 ? 1.02 : 0.78);
    ctx.beginPath();
    ctx.moveTo(f.cx + Math.cos(a) * inner, f.cy + Math.sin(a) * inner);
    ctx.lineTo(f.cx + Math.cos(a) * outer, f.cy + Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.lineWidth = 2.6;
  for (const k of [0.32, 0.5, 0.82]) {
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, f.R * k, 0, TAU);
    ctx.stroke();
  }
}

/** TIDE — nested rosettes: circles that breathe in and out around their radius. */
function ridgeTide(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 7; ring++) {
    const base = f.R * (0.2 + ring * 0.13);
    const lobes = 5 + (ring % 3);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (TAU * i) / 96;
      const r = base * (1 + 0.08 * Math.sin(lobes * a + ring * 0.8));
      const x = f.cx + Math.cos(a) * r;
      const y = f.cy + Math.sin(a) * r * 0.92;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** ROOT — a hexagonal lattice, tightened toward the centre. */
function ridgeRoot(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2;
  const cell = f.R * 0.19;
  const rows = Math.ceil((f.R * 2.4) / (cell * 1.5)) + 2;
  const cols = Math.ceil((f.R * 2.4) / (cell * Math.sqrt(3))) + 2;
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const x = f.cx + col * cell * Math.sqrt(3) + (row % 2 ? (cell * Math.sqrt(3)) / 2 : 0);
      const y = f.cy + row * cell * 1.5;
      if (Math.hypot(x - f.cx, y - f.cy) > f.R * 1.05) continue;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + Math.cos(a) * cell * 0.9;
        const py = y + Math.sin(a) * cell * 0.9;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/** CINDER — plumes: nested arcs peeling away from a hot core. */
function ridgeCinder(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 9; i++) {
    const spread = 0.16 + i * 0.05;
    const lift = f.R * (0.28 + i * 0.09);
    ctx.beginPath();
    ctx.moveTo(f.cx - f.R * spread, f.cy + f.R * 0.62);
    ctx.bezierCurveTo(
      f.cx - f.R * spread * 1.7,
      f.cy + f.R * 0.1,
      f.cx - f.R * spread * 0.3,
      f.cy - lift * 0.6,
      f.cx,
      f.cy - lift
    );
    ctx.bezierCurveTo(
      f.cx + f.R * spread * 0.3,
      f.cy - lift * 0.6,
      f.cx + f.R * spread * 1.7,
      f.cy + f.R * 0.1,
      f.cx + f.R * spread,
      f.cy + f.R * 0.62
    );
    ctx.stroke();
  }
  for (let i = 0; i < 34; i++) {
    const a = TAU * f.rand();
    const d = f.R * (0.3 + f.rand() * 0.75);
    ctx.beginPath();
    ctx.arc(f.cx + Math.cos(a) * d * 0.7, f.cy + Math.sin(a) * d, 1.4 + f.rand() * 2.4, 0, TAU);
    ctx.fill();
  }
}

/** GALE — swept chevrons riding a common curve. */
function ridgeGale(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 13; i++) {
    const t = i / 12;
    const y = f.cy + (t - 0.5) * f.R * 1.9;
    const reach = f.R * (0.42 + 0.62 * Math.sin(Math.PI * t));
    ctx.beginPath();
    ctx.moveTo(f.cx - reach, y + reach * 0.22);
    ctx.quadraticCurveTo(f.cx - reach * 0.1, y - reach * 0.2, f.cx + reach * 0.5, y - reach * 0.05);
    ctx.quadraticCurveTo(f.cx + reach * 0.95, y + 0.04 * reach, f.cx + reach, y + reach * 0.3);
    ctx.stroke();
  }
}

/** PULSE — a circuit plate: orthogonal runs terminating in pads. */
function ridgePulse(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2.2;
  const step = f.R * 0.17;
  for (let i = 0; i < 16; i++) {
    let x = f.cx + (Math.round(f.rand() * 6) - 3) * step;
    let y = f.cy + (Math.round(f.rand() * 8) - 4) * step;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      if (s % 2 === 0) x += (f.rand() > 0.5 ? 1 : -1) * step * (1 + Math.round(f.rand() * 2));
      else y += (f.rand() > 0.5 ? 1 : -1) * step * (1 + Math.round(f.rand() * 2));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, step * 0.2, 0, TAU);
    ctx.fill();
  }
  ctx.lineWidth = 1.4;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(f.cx - f.R, f.cy + i * step * 1.6);
    ctx.lineTo(f.cx + f.R, f.cy + i * step * 1.6);
    ctx.stroke();
  }
}

/** VEIL — a knapped surface: straight chords crossing a broken disc. */
function ridgeVeil(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2.2;
  const points: [number, number][] = [];
  for (let i = 0; i < 11; i++) {
    const a = TAU * (i / 11) + f.rand() * 0.3;
    const d = f.R * (0.42 + f.rand() * 0.6);
    points.push([f.cx + Math.cos(a) * d, f.cy + Math.sin(a) * d * 0.94]);
  }
  for (let i = 0; i < points.length; i++) {
    for (let k = i + 1; k < points.length; k++) {
      if ((i * 7 + k * 3) % 4 !== 0) continue;
      ctx.beginPath();
      ctx.moveTo(points[i]![0], points[i]![1]);
      ctx.lineTo(points[k]![0], points[k]![1]);
      ctx.stroke();
    }
  }
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.stroke();
}

/** PRISM — a caustic: a triangular lattice refracted about the centre. */
function ridgePrism(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 2;
  for (let ring = 1; ring <= 5; ring++) {
    const r = f.R * (ring / 5) * 1.02;
    for (const spin of [0, Math.PI / 3]) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (TAU * i) / 3 - Math.PI / 2 + spin + ring * 0.12;
        const x = f.cx + Math.cos(a) * r;
        const y = f.cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 6; i++) {
    const a = (TAU * i) / 6 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy);
    ctx.lineTo(f.cx + Math.cos(a) * f.R * 1.02, f.cy + Math.sin(a) * f.R * 1.02);
    ctx.stroke();
  }
}

/**
 * The ground the Current's figure is cut into.
 *
 * Real engine-turning is two patterns at different scales, and a banknote reads
 * as valuable partly because of that layering: a fine repeating ground with a
 * bolder device over it. One ground shared by all eight Currents also does
 * something the per-Current figures cannot — it makes every art-pending card
 * recognisably the same treatment, so a grid of them reads as one deliberate
 * state rather than eight different accidents.
 */
function ridgeGround(ctx: CanvasRenderingContext2D, f: Field): void {
  ctx.lineWidth = 1;
  const span = Math.hypot(f.rect.w, f.rect.h);
  const step = Math.max(9, span * 0.026);
  for (const lean of [0.42, -0.42]) {
    for (let i = -span; i < span * 1.2; i += step) {
      ctx.beginPath();
      for (let t = 0; t <= 10; t++) {
        const v = t / 10;
        const y = f.rect.y + v * f.rect.h;
        const wobble = Math.sin(v * 7 + i * 0.02) * step * 0.5;
        const x = f.rect.x + i + lean * v * f.rect.h + wobble;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

const RIDGES: Record<CurrentId, (ctx: CanvasRenderingContext2D, f: Field) => void> = {
  cinder: ridgeCinder,
  tide: ridgeTide,
  root: ridgeRoot,
  gale: ridgeGale,
  pulse: ridgePulse,
  halo: ridgeHalo,
  veil: ridgeVeil,
  prism: ridgePrism,
};

// ---------------------------------------------------------------------------
// The crest stamp
// ---------------------------------------------------------------------------

const stamps = new Map<string, HTMLCanvasElement | null>();

/**
 * The faction emblem as a flat silhouette in one colour.
 *
 * `drawFactionCrest` paints a full-colour crest, which is exactly wrong for a
 * watermark — a watermark is one value, and a coloured one at 8% alpha reads as
 * a smudge. Drawing it white into an offscreen and then flooding with
 * `source-in` keeps only its alpha, which works identically for the painted
 * crests and for the procedural emblem behind them, so a faction whose crest has
 * not been drawn yet still gets an emboss rather than nothing.
 */
function crestStamp(faction: FactionId | undefined, size: number, colour: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${faction ?? "neutral"}|${Math.round(size)}|${colour}`;
  // callers quantise, but a stray size would otherwise mint a bitmap per pixel
  const cached = stamps.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(size));
  canvas.height = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    stamps.set(key, null);
    return null;
  }
  const half = canvas.width / 2;
  drawFactionCrest(ctx, FACTION_INDEX[faction ?? "neutral"] ?? 10, half, half, half * 0.94, "#ffffff", faction);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  stamps.set(key, canvas);
  return canvas;
}

/**
 * The lit and shadowed crescents of an emblem, for a true emboss.
 *
 * Drawing a silhouette twice at two offsets and two tones is the cheap version
 * of an emboss, and on a crest whose artwork happens to be a filled disc — which
 * several of them are — the cheap version is a pale ball floating in the middle
 * of the card. Which is *exactly* the defect the old humanoid silhouette
 * produced, arrived at from a different direction.
 *
 * A real emboss is only the rim. Drawing the shape at an offset and then cutting
 * the un-offset shape out of it leaves a crescent on that side and nothing in
 * the middle, so the result is a raised edge whatever the emblem's interior
 * looks like.
 */
function crescent(source: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, dx, dy);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(source, 0, 0);
  return canvas;
}

const embossed = new Map<string, { lit: HTMLCanvasElement; shade: HTMLCanvasElement; body: HTMLCanvasElement } | null>();

function crestEmboss(
  faction: FactionId | undefined,
  wanted: number
): { lit: HTMLCanvasElement; shade: HTMLCanvasElement; body: HTMLCanvasElement } | null {
  /**
   * Quantised, and capped at 192.
   *
   * Building the emboss costs four canvases and a 512px decode per faction per
   * size, and the first collection paint would otherwise ask for a different
   * size for the card face and the leader medallion and again for every scale in
   * between. It is a watermark at 5% alpha behind a guilloche: 192 pixels is
   * more resolution than it can possibly show, and rounding to 64 means eleven
   * factions share at most a couple of bitmaps each for the life of the page.
   */
  const size = Math.min(192, Math.max(64, Math.round(wanted / 64) * 64));
  const key = `${faction ?? "neutral"}|${size}`;
  const cached = embossed.get(key);
  if (cached !== undefined) return cached;

  const white = crestStamp(faction, size, "#ffffff");
  const black = crestStamp(faction, size, "#000000");
  const depth = Math.max(2, size * 0.014);
  const lit = white ? crescent(white, TO_LIGHT.x * depth, TO_LIGHT.y * depth) : null;
  const shade = black ? crescent(black, -TO_LIGHT.x * depth, -TO_LIGHT.y * depth) : null;
  const made = white && lit && shade ? { lit, shade, body: white } : null;
  embossed.set(key, made);
  return made;
}

/** Drop the cache when the painted crests finish loading. */
export function resetCrestStamps(): void {
  stamps.clear();
  embossed.clear();
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

export function drawPlaceholderArt(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  current: CurrentId,
  name: string,
  options: PlaceholderOptions = {}
): void {
  const palette = CURRENT_PALETTE[current];
  const rand = makeRandom(hashString(name + current));
  /**
   * The composition wanders a little per card.
   *
   * Without it, every Tide card that is waiting for art is the *same* picture,
   * and a grid of them reads as one image repeated rather than as a treatment
   * applied. A few per cent of drift in the centre and the reach is enough for
   * the eye to stop matching them up, and it is derived from the card's name so
   * it is the same drift on every machine.
   */
  const cx = rect.x + rect.w * (0.5 + (rand() - 0.5) * 0.1);
  const cy = rect.y + rect.h * (0.37 + (rand() - 0.5) * 0.07);
  const R = Math.max(rect.w, rect.h) * (0.42 + (rand() - 0.5) * 0.12);

  // --- lit backdrop --------------------------------------------------------
  const back = ctx.createLinearGradient(
    cx - TO_LIGHT.x * rect.w * 0.7,
    cy - TO_LIGHT.y * rect.h * 0.7,
    cx + TO_LIGHT.x * rect.w * 0.7,
    cy + TO_LIGHT.y * rect.h * 0.7
  );
  back.addColorStop(0, palette.abyss);
  back.addColorStop(0.45, mix(palette.lo, palette.abyss, 0.4));
  back.addColorStop(1, mix(palette.lo, palette.key, 0.32));
  ctx.fillStyle = back;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // a soft pool of the Current's own light, up and left, on the rig
  const pool = ctx.createRadialGradient(
    cx + TO_LIGHT.x * R * 0.6,
    cy + TO_LIGHT.y * R * 0.6,
    R * 0.05,
    cx,
    cy,
    R * 1.5
  );
  pool.addColorStop(0, hexToRgba(palette.hi, 0.34));
  pool.addColorStop(0.35, hexToRgba(palette.key, 0.2));
  pool.addColorStop(0.7, hexToRgba(palette.key, 0.05));
  pool.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // --- the embossed faction crest, under the guilloche ---------------------
  const stampSize = Math.min(rect.w, rect.h) * 0.58;
  const emboss = crestEmboss(options.faction, stampSize);
  if (emboss) {
    const x = cx - stampSize / 2;
    const y = cy - stampSize / 2;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(emboss.shade, x, y, stampSize, stampSize);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(emboss.lit, x, y, stampSize, stampSize);
    ctx.globalAlpha = 0.035;
    ctx.drawImage(emboss.body, x, y, stampSize, stampSize);
    ctx.restore();
  }

  // --- the guilloche: a fine ground, then the Current's own device ---------
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const field = (): Field => ({ cx, cy, R, rect, rand: makeRandom(hashString(name)) });
  etch(ctx, palette.hi, 0.5, (target) => ridgeGround(target, field()));
  etch(ctx, palette.hi, 1, (target) => RIDGES[current](target, field()));
  ctx.restore();

  // --- grain, at one cell per device pixel ---------------------------------
  const area = new Path2D();
  area.rect(rect.x, rect.y, rect.w, rect.h);
  grainOver(ctx, area, 0.85);

  // --- vignette ------------------------------------------------------------
  const vignette = ctx.createRadialGradient(cx, cy, R * 0.42, cx, cy, Math.max(rect.w, rect.h) * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.6, hexToRgba(mix(palette.abyss, "#000000", 0.5), 0.36));
  vignette.addColorStop(1, hexToRgba(mix(palette.abyss, "#000000", 0.72), 0.94));
  ctx.fillStyle = vignette;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // --- the honest disclosure, where the caller says it will be seen --------
  const spot = options.disclosure;
  if (spot) drawArtPending(ctx, spot.cx, spot.y, spot.width, palette.hi);
}

/**
 * "— ART PENDING —", set as a caption rather than hidden as a watermark.
 *
 * It is the one element that turns "this card failed to load" into "this card is
 * waiting for its painting", so it is printed at a size a player can read, in
 * the type language of the collector line, with a rule running out to either
 * side that fades before it touches anything (§7).
 */
export function drawArtPending(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  width: number,
  colour: string
): void {
  const size = Math.max(8, Math.min(12, width * 0.045));
  ctx.save();
  ctx.font = cardFont(size, 700);
  ctx.letterSpacing = `${size * 0.26}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = "ART PENDING";
  const half = ctx.measureText(text).width / 2;
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = hexToRgba(colour, 0.72);
  ctx.fillText(text, cx, y);
  ctx.letterSpacing = "0px";
  ctx.restore();

  const gap = size * 1.1;
  fadedRule(ctx, cx - width / 2, cx - half - gap, y, colour, 0.4, 1.2);
  fadedRule(ctx, cx + half + gap, cx + width / 2, y, colour, 0.4, 1.2);
}
