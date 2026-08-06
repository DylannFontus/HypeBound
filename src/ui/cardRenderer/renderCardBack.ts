/**
 * The other side of the card.
 *
 * The card back is the game's headline sellable cosmetic — season tier one,
 * banner rewards, monthly check-in — and it is the one surface a player sees
 * more often than any card face, because half of every board is face-down. In
 * Hearthstone a back is an individually sculpted object and the most-collected
 * thing in the game; in Gwent it is embossed leather over metal. Whatever this
 * one is, it has to be the *same object* as the front, seen from the other side.
 *
 * ## What the previous two passes got wrong, in order
 *
 * The first was a 256×358 canvas with a three-stop gradient, four stroked
 * diamonds and a `strokeRect` at `lineWidth: 6` with square corners. The second
 * fixed the size, added a vignette and *said* it was built from the shared
 * primitives — and then photographed as a Material Design card in four hues:
 * `roundRect(26)` against fronts that cut their corners at forty-five degrees, a
 * rim whose gradient had nowhere near the range to read as a section, a
 * medallion that was a flat disc with a wire glyph on it, and a guilloche laid
 * at 7.5% *over a field so dark that nothing at 7.5% could be seen on it*.
 * Calling `bandFace` is not the same as looking like metal.
 *
 * So the third pass is about value range and hardware rather than about which
 * functions get called:
 *
 * - **The silhouette is chamfered**, through `frameShapes::neutralPlate`, which
 *   is now the octagon six of the eight Current cuts have in common instead of
 *   the rounded rectangle none of them is.
 * - **The band is a legendary's**, 31px, with four rail bosses on the mid-edges
 *   — the same `drawRailBoss` the front's top tier wears, moved into
 *   `material.ts` for exactly this reason. A back is the most valuable-looking
 *   object in the game or it is not worth selling.
 * - **It carries a specular.** `specularBand` puts one narrow near-white streak
 *   across the metal along the 315° axis, which is the difference between an
 *   alloy and a coloured stripe and the thing the flat rim was missing.
 * - **The field is a lit surface**, not a black hole: a slate that runs roughly
 *   22–58/255 across the 315° ramp, which is dark enough for the emblem to be
 *   the brightest thing on the card and light enough for an engraving to exist.
 * - **The medallion is struck hardware** — a milled collar casting a real shadow
 *   onto the engraving, a sunken well with a lip, and the emblem embossed into
 *   the floor of it in three passes.
 * - **It has a top crest and a collector footer**, because the front has a top
 *   band and a collector line, and an object with furniture at both ends beside
 *   an object with none is two objects.
 *
 * ## One design, tinted — which is what the data already assumed
 *
 * A `CardBackStyle` is a colour and an emblem id, so the cosmetic layer has
 * always described a *single* back with two variables. The colour now drives the
 * rim metal, the bosses' stones, the engraving and the emblem, and the field
 * takes only a fifth of it — so the four variants read as one product line in
 * four trims rather than as four different cards, which is what a cosmetic line
 * is supposed to look like.
 *
 * The outline stays Current-*neutral*: a face-down card must not leak which
 * Current it is, and a back wearing Cinder's flame notches would do exactly that.
 */

import {
  bandFace,
  bandShelf,
  castShadow,
  edgeGradient,
  drawGem,
  drawLabel,
  drawRailBoss,
  fadedRule,
  grainOver,
  innerCast,
  litGradient,
  raisedPlate,
  specularBand,
  sunkenPlate,
  TO_LIGHT,
  type Metal,
  type Rail,
  type Rect,
} from "./material";
import { CARD_H, CARD_W, LAYOUT, RARITY_STYLE, hexToRgba, mix, saturate } from "./palette";
import { neutralBandPaths, neutralPath } from "./frameShapes";
import { drawEmblem, type CardBackStyle } from "../cosmetics/emblem";

/**
 * The band the back wears: a legendary front's, to the pixel.
 *
 * It used to be a common's, on the argument that the back should match the most
 * ordinary card in the deck. That is the wrong end of the argument. A back is
 * bought, earned or granted; it is the object a player chose, and the frame it
 * deserves is the frame the game reserves for its best cards. 31px of band and
 * four bosses is also what makes a face-down card read as *hardware* at hand
 * size, where a 21px rim is four device pixels of colour.
 */
const BAND = RARITY_STYLE.legendary.band;
const BOSS_REACH = RARITY_STYLE.legendary.ornament;

/** Where the emblem medallion sits, and how big it is. */
const EMBLEM_CY = 314;
const EMBLEM_R = 108;

/** The crest at the top and the collector cartouche at the bottom. */
const CREST: Rect = { x: CARD_W / 2 - 86, y: 68, w: 172, h: 54 };
const FOOTER: Rect = { x: 96, y: 566, w: CARD_W - 192, h: 44 };

function backMetal(colour: string): Metal {
  return {
    hi: saturate(colour, 0.9, 0.26),
    key: saturate(colour, 1, 0.02),
    lo: saturate(colour, 0.86, -0.3),
    /**
     * Deep, and the number is measured rather than chosen. The band's ray-cast
     * ratio between its lit and its shadowed arc came out 5.3:1 against the card
     * face's 61:1 on the same probe — both correctly lit at 133° and 129°, but
     * the back's shadow end never got dark enough to read as a section. Taking
     * the abyss two thirds of the way to the card's own near-black closes most
     * of that gap without touching the direction.
     */
    abyss: mix(saturate(colour, 0.66, -0.4), "#05030c", 0.72),
  };
}

/**
 * The field the engraving is cut into.
 *
 * Slate rather than black, and that is the whole of the fix to a guilloche that
 * "was barely visible". The previous field ran to `#05030c` — three values off
 * pure black — so a 7.5% engraving on it had, arithmetically, two values to work
 * with. The tooling was there; there was no surface for it to be tooling *in*.
 * A fifth of the cosmetic hue keeps the four variants distinguishable at a
 * glance without the field competing with the rim, which is the only thing the
 * colour is supposed to be doing.
 */
function fieldMetal(colour: string): Metal {
  const tint = mix("#161226", saturate(colour, 0.7, -0.28), 0.2);
  return {
    hi: mix(tint, "#ffffff", 0.16),
    key: tint,
    lo: mix(tint, "#07050e", 0.55),
    abyss: "#05030c",
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
 * The pale pass is now at 17% of the *cosmetic hue*, on a field that is no
 * longer black, which lands the engraving at roughly 7% of the field's own value
 * — visible, and still quiet enough that a repeated object seen hundreds of
 * times in a match does not become noise by turn four.
 */
function guilloche(ctx: CanvasRenderingContext2D, area: Path2D, colour: string): void {
  ctx.save();
  ctx.clip(area);
  ctx.lineWidth = 1.7;

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
    [-TO_LIGHT.x * 1.5, -TO_LIGHT.y * 1.5, "#000000", 0.55],
    [TO_LIGHT.x, TO_LIGHT.y, colour, 0.17],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = hexToRgba(tone, alpha);
    pass((58 * Math.PI) / 180, 19);
    pass((-58 * Math.PI) / 180, 23);
    ctx.restore();
  }

  /**
   * A rosette centred where the medallion will land, so the engraving has a
   * focus rather than being a uniform screen. Concentric rings at the same two
   * offsets as the diagonals, which is what makes the whole ground read as one
   * tool path rather than as two overlaid textures.
   */
  for (const [dx, dy, tone, alpha] of [
    [-TO_LIGHT.x * 1.5, -TO_LIGHT.y * 1.5, "#000000", 0.5],
    [TO_LIGHT.x, TO_LIGHT.y, colour, 0.15],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = hexToRgba(tone, alpha);
    for (let r = EMBLEM_R + 34; r < 330; r += 21) {
      ctx.beginPath();
      ctx.arc(CARD_W / 2, EMBLEM_CY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The milling on the collar: short radial cuts around its rim, embossed.
 *
 * A struck coin is knurled at its edge and the eye knows it without being able
 * to name it. Two strokes per tick — dark away from the key, pale toward it — at
 * the same offsets everything else on this card is embossed at, so the milling
 * belongs to the same light as the metal it is cut into.
 */
function milling(ctx: CanvasRenderingContext2D, cx: number, cy: number, inner: number, outer: number, metal: Metal): void {
  const ticks = 72;
  ctx.save();
  ctx.lineWidth = 2;
  for (const [dx, dy, tone, alpha] of [
    [-TO_LIGHT.x * 1.2, -TO_LIGHT.y * 1.2, "#000000", 0.5],
    [TO_LIGHT.x * 0.9, TO_LIGHT.y * 0.9, metal.hi, 0.4],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.strokeStyle = hexToRgba(tone, alpha);
    ctx.beginPath();
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      ctx.moveTo(cx + c * inner, cy + s * inner);
      ctx.lineTo(cx + c * outer, cy + s * outer);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The emblem, struck into a recessed medallion.
 *
 * Three objects, not one: a milled collar sitting proud of the field and casting
 * onto the engraving, a well cut into the collar, and the mark embossed into the
 * floor of the well. The version this replaces drew the disc a couple of values
 * darker than its surroundings with a wire glyph on it — no lip, no join, and
 * nothing to say whether it was above the surface or below it.
 *
 * `drawEmblem` takes its colours from the context, so the emboss is three passes
 * of the same call: a shadow cast away from the key light, the body, and a
 * highlight toward it. One extra pixel of offset in each direction is all it
 * takes at this size, and it is the difference between a mark stamped into metal
 * and a mark drawn on top of it.
 */
function emblem(ctx: CanvasRenderingContext2D, style: CardBackStyle, metal: Metal): void {
  const cx = CARD_W / 2;
  const cy = EMBLEM_CY;
  const plate = new Path2D();
  plate.arc(cx, cy, EMBLEM_R, 0, Math.PI * 2);
  const bounds: Rect = { x: cx - EMBLEM_R, y: cy - EMBLEM_R, w: EMBLEM_R * 2, h: EMBLEM_R * 2 };

  const collarR = EMBLEM_R + 21;
  const collarOuter = new Path2D();
  collarOuter.arc(cx, cy, collarR, 0, Math.PI * 2);
  const collar = new Path2D();
  collar.addPath(collarOuter);
  collar.addPath(plate);
  const collarBounds: Rect = { x: cx - collarR, y: cy - collarR, w: collarR * 2, h: collarR * 2 };

  // the collar stands off the field, so it throws a real shadow onto the engraving
  castShadow(ctx, collarOuter, 11, 0.62);
  ctx.save();
  ctx.fillStyle = bandFace(ctx, collarBounds, metal, 1.15);
  ctx.fill(collar, "evenodd");
  ctx.restore();
  grainOver(ctx, collar, 0.9, "evenodd");
  milling(ctx, cx, cy, collarR - 13, collarR - 3, metal);
  specularBand(ctx, collar, collarBounds, {
    strength: 0.46,
    tint: mix(metal.hi, "#ffffff", 0.55),
    width: 0.07,
    rule: "evenodd",
  });
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, collarBounds, 0.55, 0.75);
  ctx.stroke(collarOuter);
  ctx.restore();

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
    metal: {
      hi: metal.hi,
      key: mix(metal.lo, "#1a1526", 0.42),
      lo: mix(metal.lo, "#0c0818", 0.52),
      abyss: "#07040f",
    },
    amplitude: 0.95,
    grain: 0.5,
  });

  ctx.save();
  ctx.clip(plate);
  const scale = 1.02;
  for (const [dx, dy, stroke, fill, width] of [
    [-TO_LIGHT.x * 2.4, -TO_LIGHT.y * 2.4, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.4)", 5.4],
    [TO_LIGHT.x * 1.9, TO_LIGHT.y * 1.9, hexToRgba(mix(metal.hi, "#ffffff", 0.4), 0.8), hexToRgba(metal.hi, 0.24), 4.2],
    [0, 0, hexToRgba(metal.key, 0.9), hexToRgba(metal.key, 0.26), 4.6],
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
  ctx.lineWidth = 3;
  ctx.strokeStyle = edgeGradient(ctx, bounds, 0.34, 0.8, true);
  ctx.stroke(plate);
  ctx.restore();
  innerCast(ctx, plate, bounds, { blur: 12, alpha: 0.55, lift: 5, tone: "dark", away: true });
}

/**
 * The crest at the top, which is the front's cost gem and cartouche band read as
 * one centred object.
 *
 * A front carries hardware at the top of the frame and printed matter at the
 * bottom of it, and an object with furniture at both ends beside an object with
 * none does not read as the same object flipped, however well the rim is lit.
 * The back cannot borrow the cost gem — a face-down card has no cost — so it
 * takes the *shape* of that band instead: a raised cartouche with a set stone in
 * it, on the same horizontal the front's top band sits on.
 */
function crest(ctx: CanvasRenderingContext2D, metal: Metal): void {
  const cx = CREST.x + CREST.w / 2;
  const cy = CREST.y + CREST.h / 2;
  const half = CREST.h / 2;

  // a tapered cartouche: flat face, ends raked back into the field
  const path = new Path2D();
  path.moveTo(CREST.x + 16, CREST.y);
  path.lineTo(CREST.x + CREST.w - 16, CREST.y);
  path.lineTo(CREST.x + CREST.w, cy);
  path.lineTo(CREST.x + CREST.w - 16, CREST.y + CREST.h);
  path.lineTo(CREST.x + 16, CREST.y + CREST.h);
  path.lineTo(CREST.x, cy);
  path.closePath();

  raisedPlate(ctx, path, CREST, {
    metal: {
      hi: mix(metal.hi, "#ffffff", 0.2),
      key: mix(metal.key, "#000000", 0.18),
      lo: mix(metal.lo, "#000000", 0.3),
      abyss: "#0a0714",
    },
    amplitude: 0.95,
    lift: 6,
  });
  specularBand(ctx, path, CREST, { strength: 0.42, tint: mix(metal.hi, "#ffffff", 0.6), width: 0.1 });

  /**
   * A hex stone, because the front's cost gem is a hex stone.
   *
   * The first pass set a diamond here flanked by two pips and it read as a belt
   * buckle: three identical rivets on a strap. The one piece of hardware a
   * player has learned to look for at the top of a HYPEBOUND card is a
   * six-sided crystal in a collar, so the back's crest is that stone in the
   * house colour, and the flanking pips are gone.
   */
  drawGem(ctx, {
    shape: "hex",
    cx,
    cy,
    r: half * 0.74,
    metal: {
      hi: mix(metal.hi, "#ffffff", 0.55),
      key: metal.key,
      lo: metal.lo,
      abyss: metal.abyss ?? "#05030c",
    },
    socket: true,
    glow: 0.5,
    lift: 4,
  });
}

/**
 * The collector footer, which is the front's collector line without the data.
 *
 * A front prints `AFT · 124 · COMMON · HYPEBOUND` in a tracked 11px display face
 * over a faded rule. The back has no set, no number and no rarity to print, so
 * it prints the one field they all share, in the same face, at the same tracking
 * and over the same rule — which is what makes the two objects look as though
 * they came out of the same press.
 */
function footer(ctx: CanvasRenderingContext2D, metal: Metal): void {
  const cy = FOOTER.y + FOOTER.h / 2;
  const plate = neutralPath({ x: FOOTER.x, y: FOOTER.y, w: FOOTER.w, h: FOOTER.h }, 0);

  sunkenPlate(ctx, plate, FOOTER, {
    metal: { hi: metal.hi, key: mix(metal.lo, "#0d0918", 0.5), lo: "#0a0714", abyss: "#04020a" },
    amplitude: 0.85,
    grain: 0.4,
  });

  fadedRule(ctx, FOOTER.x + 18, FOOTER.x + FOOTER.w - 18, cy - 15, mix(metal.hi, "#ffffff", 0.3), 0.4);
  fadedRule(ctx, FOOTER.x + 18, FOOTER.x + FOOTER.w - 18, cy + 15, mix(metal.hi, "#ffffff", 0.3), 0.4);
  drawLabel(ctx, "HYPEBOUND", CARD_W / 2, cy + 1, {
    size: 15,
    colour: hexToRgba(mix(metal.hi, "#ffffff", 0.45), 0.88),
    tracking: 7,
  });
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
  const field = fieldMetal(style.color);
  const rect: Rect = {
    x: LAYOUT.bleed,
    y: LAYOUT.bleed,
    w: CARD_W - LAYOUT.bleed * 2,
    h: CARD_H - LAYOUT.bleed * 2,
  };
  const paths = neutralBandPaths(rect, BAND);
  const { outer, inner } = paths;

  ctx.clearRect(0, 0, CARD_W, CARD_H);

  // the card is an object sitting on the mat, and it casts before it is drawn —
  // six of lift, matching the face; see the note there about the asymmetric throw
  castShadow(ctx, outer, 6, 0.5);

  // --- the field, as a lit slate rather than a hole ------------------------
  ctx.save();
  ctx.clip(outer);
  ctx.fillStyle = litGradient(ctx, rect, [
    [0, field.abyss ?? "#05030c"],
    [0.34, field.lo],
    [0.74, field.key],
    [1, field.hi],
  ]);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  guilloche(ctx, inner, metal.hi);
  grainOver(ctx, inner, 0.85);

  crest(ctx, metal);
  emblem(ctx, style, metal);
  footer(ctx, metal);

  /**
   * The frame band, drawn by the face's recipe in the face's order: the lip
   * filled with `bandFace`, the shelf one step down filled with `bandShelf`, the
   * shared grain over both, the specular laid across the metal, then the step
   * wall and the two band walls stroked with the edge gradient — lit on the
   * outer, inverted on the inner, because they face opposite ways.
   */
  ctx.save();
  ctx.clip(outer);
  ctx.fillStyle = bandFace(ctx, rect, metal);
  ctx.fill(paths.band, "evenodd");

  const shelfPath = neutralPath(rect, BAND * 0.42);
  const shelf = new Path2D();
  shelf.addPath(shelfPath);
  shelf.addPath(inner);
  ctx.fillStyle = bandShelf(ctx, rect, metal);
  ctx.fill(shelf, "evenodd");

  grainOver(ctx, paths.band, 0.95, "evenodd");
  specularBand(ctx, paths.band, rect, {
    strength: 0.46,
    tint: mix(metal.hi, "#ffffff", 0.62),
    width: 0.083,
    rule: "evenodd",
  });

  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.5, 0.58);
  ctx.stroke(shelfPath);

  /**
   * The keyline: the same three-stroke inlaid rule a rare and up wears on the
   * front — a dark groove, the colour, and a lit shoulder offset toward the key.
   */
  const keyline = neutralPath(rect, 8);
  ctx.lineWidth = RARITY_STYLE.legendary.innerRim + 2.4;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke(keyline);
  ctx.lineWidth = RARITY_STYLE.legendary.innerRim;
  ctx.strokeStyle = hexToRgba(mix(metal.hi, "#ffffff", 0.12), 0.9);
  ctx.stroke(keyline);
  ctx.save();
  ctx.lineWidth = Math.max(1, RARITY_STYLE.legendary.innerRim * 0.34);
  ctx.translate(TO_LIGHT.x * 1.2, TO_LIGHT.y * 1.2);
  ctx.strokeStyle = hexToRgba(mix(metal.hi, "#ffffff", 0.7), 0.55);
  ctx.stroke(keyline);
  ctx.restore();

  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.46, 0.72);
  ctx.stroke(outer);
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.32, 0.78, true);
  ctx.stroke(inner);
  ctx.restore();

  /**
   * The four bosses, outside the clip for the reason the front's are: a boss
   * changes the outline, and a shape that changes an outline cannot be drawn
   * under a clip to the outline it is changing.
   */
  const bossMetal: Metal = {
    hi: mix(metal.hi, "#ffffff", 0.3),
    key: mix(metal.key, metal.hi, 0.32),
    lo: metal.lo,
    abyss: metal.abyss,
  };
  for (const side of ["left", "right", "top", "bottom"] as Rail[]) {
    drawRailBoss(ctx, rect, side, BOSS_REACH, BAND * 0.8, bossMetal, metal.key);
  }

  innerCast(ctx, inner, rect, { blur: 13, alpha: 0.5, lift: 5, tone: "dark", away: true });

  // --- grain over the whole face, then a corner vignette -------------------
  grainOver(ctx, outer, 0.7);

  ctx.save();
  ctx.clip(inner);
  const vignette = ctx.createRadialGradient(
    CARD_W / 2,
    EMBLEM_CY,
    CARD_W * 0.2,
    CARD_W / 2,
    EMBLEM_CY,
    CARD_H * 0.6
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.62, "rgba(0,0,0,0.24)");
  vignette.addColorStop(1, "rgba(0,0,0,0.62)");
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
