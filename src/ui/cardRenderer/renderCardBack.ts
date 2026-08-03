/**
 * The other side of the card.
 *
 * Until now this was the only part of a card that had not been rebuilt, and the
 * gap was visible in a single photograph: a 380px front beside the back showed
 * a printed object next to a wireframe. The back was a 256×358 canvas with a
 * three-stop vertical gradient, four concentric stroked diamonds and one
 * `strokeRect(10, 10, …)` at `lineWidth: 6` with square corners. No texture, no
 * bevel, no rim light, no vignette, no emblem plate, and — most tellingly — a
 * hard-cornered rectangular silhouette against fronts whose outlines are cut per
 * Current. A face-down card was not the same object as a face-up one.
 *
 * That matters commercially as well as visually. The card back is the game's
 * headline sellable cosmetic: season tier one, banner rewards, monthly check-in.
 * A stroked rectangle in a different hue cannot be sold eleven times.
 *
 * ## One design, tinted — which is what the data already assumed
 *
 * A `CardBackStyle` is a colour and an emblem id, so the cosmetic layer has
 * always described a *single* back with two variables. This draws that: one
 * printed object at the front's own 512×680, built from the same `material.ts`
 * primitives the face uses, with the cosmetic's colour driving the rim metal and
 * the emblem and nothing else. Every back is therefore lit at 315° like every
 * other surface in the game, carries the same grain, has the same section
 * through its border, and casts the same contact shadow.
 *
 * The silhouette is deliberately Current-*neutral* — a plain superellipse-ish
 * rounded rectangle rather than any of the eight cut outlines. A face-down card
 * must not leak which Current it is, and a back wearing Cinder's flame notches
 * would do exactly that.
 */

import {
  bandFace,
  bandShelf,
  castShadow,
  edgeGradient,
  drawLabel,
  grainOver,
  innerCast,
  litGradient,
  roundRectPath,
  sunkenPlate,
  TO_LIGHT,
  type Metal,
  type Rect,
} from "./material";
import { CARD_H, CARD_W, LAYOUT, hexToRgba, mix, saturate } from "./palette";
import { drawEmblem, type CardBackStyle } from "../cosmetics/emblem";

/** The one radius on the back, matching the front's corner feel without copying a cut. */
const CORNER = 26;

/** Where the emblem medallion sits, and how big it is. */
const EMBLEM_R = 118;

function backMetal(colour: string): Metal {
  return {
    hi: saturate(colour, 0.9, 0.24),
    key: saturate(colour, 1, 0.02),
    lo: saturate(colour, 0.86, -0.26),
    abyss: mix(saturate(colour, 0.7, -0.36), "#05030c", 0.55),
  };
}

/**
 * The guilloche: a diagonal moiré, engraved rather than printed.
 *
 * Two families of lines at ±58° with slightly different pitches, so where they
 * cross they beat against each other the way an engine-turned banknote ground
 * does. Each is laid twice — dark away from the light, pale toward it — which is
 * the same trick the art-pending treatment uses and the reason the result reads
 * as tooling in a surface rather than as a hatch drawn on one.
 *
 * Six per cent is the whole budget. A card back is a repeated object seen
 * hundreds of times in a match; anything you can consciously read on it becomes
 * noise by turn four.
 */
function guilloche(ctx: CanvasRenderingContext2D, area: Path2D, colour: string): void {
  ctx.save();
  ctx.clip(area);
  ctx.lineWidth = 1.6;

  const pass = (angle: number, pitch: number): void => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const span = CARD_W + CARD_H;
    for (let d = -span; d < span; d += pitch) {
      ctx.beginPath();
      ctx.moveTo(CARD_W / 2 + cos * d - sin * span, CARD_H / 2 + sin * d + cos * span);
      ctx.lineTo(CARD_W / 2 + cos * d + sin * span, CARD_H / 2 + sin * d - cos * span);
      ctx.stroke();
    }
  };

  for (const [dx, dy, tone, alpha] of [
    [-TO_LIGHT.x * 1.4, -TO_LIGHT.y * 1.4, "#000000", 0.5],
    [TO_LIGHT.x, TO_LIGHT.y, colour, 0.075],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = hexToRgba(tone, alpha);
    pass((58 * Math.PI) / 180, 19);
    pass((-58 * Math.PI) / 180, 23);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The emblem, struck into a recessed medallion.
 *
 * `drawEmblem` takes its colours from the context, so the emboss is three passes
 * of the same call: a shadow cast away from the key light, the body, and a
 * highlight toward it. One extra pixel of offset in each direction is all it
 * takes at this size, and it is the difference between a mark stamped into metal
 * and a mark drawn on top of it.
 */
function emblem(ctx: CanvasRenderingContext2D, style: CardBackStyle, metal: Metal): void {
  const cx = CARD_W / 2;
  const cy = CARD_H / 2 - 14;
  const plate = new Path2D();
  plate.arc(cx, cy, EMBLEM_R, 0, Math.PI * 2);
  const bounds: Rect = { x: cx - EMBLEM_R, y: cy - EMBLEM_R, w: EMBLEM_R * 2, h: EMBLEM_R * 2 };

  /**
   * A well, not a disc — which is a statement about the direction of the
   * gradient and nothing else.
   *
   * The first version filled it lighter toward the light, which is the recipe for
   * a surface standing *proud*: the emblem came out as a pale coin lying on the
   * card rather than a mark struck into it. `sunkenPlate` is the primitive that
   * gets this right by construction — darker toward the light, the near wall's
   * shadow thrown across the inside, a faint rim where the far wall turns up —
   * and using it means the back's medallion is the same recess as the name
   * plate's rarity cap on the front.
   */
  sunkenPlate(ctx, plate, bounds, {
    metal: { hi: metal.hi, key: mix(metal.lo, "#000000", 0.35), lo: mix(metal.abyss ?? "#05030c", metal.lo, 0.3), abyss: "#04020a" },
    amplitude: 0.85,
    grain: 0.5,
  });

  ctx.save();
  ctx.clip(plate);
  const scale = 1.05;
  for (const [dx, dy, stroke, fill, width] of [
    [-TO_LIGHT.x * 2, -TO_LIGHT.y * 2, "rgba(0,0,0,0.8)", "rgba(0,0,0,0.34)", 5],
    [TO_LIGHT.x * 1.6, TO_LIGHT.y * 1.6, hexToRgba(metal.hi, 0.72), hexToRgba(metal.hi, 0.2), 4],
    [0, 0, hexToRgba(metal.key, 0.85), hexToRgba(metal.key, 0.22), 4.4],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.lineWidth = width;
    drawEmblem(ctx, style.emblem, cx, cy, scale);
    ctx.restore();
  }
  ctx.restore();

  // the lip of the well, lit
  ctx.save();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.3, 0.72, true);
  ctx.stroke(plate);
  ctx.restore();
}

/**
 * Draw a card back at the canonical 512×680, in card space.
 *
 * Exported separately from the texture builder so a DOM screen — a cosmetics
 * preview, a shop tile — can put the same object on a 2D canvas without going
 * anywhere near three.js.
 */
export function renderCardBack(ctx: CanvasRenderingContext2D, style: CardBackStyle): void {
  const metal = backMetal(style.color);
  const rect: Rect = {
    x: LAYOUT.bleed,
    y: LAYOUT.bleed,
    w: CARD_W - LAYOUT.bleed * 2,
    h: CARD_H - LAYOUT.bleed * 2,
  };
  const outer = roundRectPath(rect, CORNER);
  const innerRect: Rect = {
    x: rect.x + LAYOUT.frame,
    y: rect.y + LAYOUT.frame,
    w: rect.w - LAYOUT.frame * 2,
    h: rect.h - LAYOUT.frame * 2,
  };
  const inner = roundRectPath(innerRect, CORNER - LAYOUT.frame * 0.55);

  ctx.clearRect(0, 0, CARD_W, CARD_H);

  // the card is an object sitting on the mat, and it casts before it is drawn
  castShadow(ctx, outer, 8, 0.5);

  // --- the ground ----------------------------------------------------------
  ctx.save();
  ctx.clip(outer);
  ctx.fillStyle = litGradient(ctx, rect, [
    [0, mix(metal.abyss ?? "#05030c", metal.lo, 0.5)],
    [0.5, mix(metal.abyss ?? "#05030c", "#05030c", 0.45)],
    [1, "#05030c"],
  ]);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  guilloche(ctx, inner, metal.hi);
  emblem(ctx, style, metal);

  // the house mark, in the collector line's own type language
  drawLabel(ctx, "HYPEBOUND", CARD_W / 2, CARD_H / 2 + EMBLEM_R + 46, {
    size: 15,
    colour: hexToRgba(mix(metal.hi, "#ffffff", 0.3), 0.62),
    tracking: 7,
  });

  // --- the frame band, the same section the face carries -------------------
  const band = new Path2D();
  band.addPath(outer);
  band.addPath(inner);

  ctx.save();
  ctx.clip(outer);
  ctx.fillStyle = bandFace(ctx, rect, metal);
  ctx.fill(band, "evenodd");

  const shelfInset = LAYOUT.frame * 0.42;
  const shelfPath = roundRectPath(
    { x: rect.x + shelfInset, y: rect.y + shelfInset, w: rect.w - shelfInset * 2, h: rect.h - shelfInset * 2 },
    CORNER - shelfInset * 0.6
  );
  const shelf = new Path2D();
  shelf.addPath(shelfPath);
  shelf.addPath(inner);
  ctx.fillStyle = bandShelf(ctx, rect, metal);
  ctx.fill(shelf, "evenodd");

  grainOver(ctx, band, 0.95, "evenodd");

  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.5, 0.58);
  ctx.stroke(shelfPath);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.46, 0.72);
  ctx.stroke(outer);
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.32, 0.78, true);
  ctx.stroke(inner);
  ctx.restore();

  innerCast(ctx, inner, rect, { blur: 13, alpha: 0.5, lift: 5, tone: "dark", away: true });

  // --- grain over the whole face, then a corner vignette -------------------
  grainOver(ctx, outer, 0.7);

  ctx.save();
  ctx.clip(inner);
  const vignette = ctx.createRadialGradient(
    CARD_W / 2,
    CARD_H / 2,
    CARD_W * 0.22,
    CARD_W / 2,
    CARD_H / 2,
    CARD_H * 0.62
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.62, "rgba(0,0,0,0.28)");
  vignette.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  // and the tight coloured rim the face wears, so the two glow alike
  ctx.save();
  ctx.shadowColor = hexToRgba(metal.key, 0.5);
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  ctx.strokeStyle = hexToRgba(mix(metal.key, metal.hi, 0.35), 0.6);
  ctx.stroke(outer);
  ctx.restore();
}

/** The back on its own canvas, at the face's resolution. */
export function renderCardBackToCanvas(style: CardBackStyle, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD_W * scale);
  canvas.height = Math.round(CARD_H * scale);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(scale, scale);
    renderCardBack(ctx, style);
  }
  return canvas;
}
