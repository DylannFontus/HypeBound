/**
 * The card face.
 *
 * This is the most-looked-at art in the game — 296 of them in the collection,
 * seven in a hand, six on a board — and until now it was not really a card. It
 * was a photograph with some chips on it: three concentric strokes for a frame,
 * a rounded rectangle with a left-to-right gradient for a name plate, a flat
 * fill for the rules box, and nothing anywhere casting onto anything else. The
 * test the AAA bar sets for this domain is blunt and it is the right one:
 * **black out the portrait and there must still be an object there.** Do that to
 * a Hearthstone card and you still have carved metal, a banner, a textbox and a
 * set symbol. Do it to the old version of this file and you had a gradient.
 *
 * So the card is now built as a printed object, in this order:
 *
 * 1. a contact shadow, so the card sits on the page rather than floating;
 * 2. full-bleed art (or the art-pending treatment) clipped to the Current's
 *    silhouette, with scrims that keep the overlaid furniture readable;
 * 3. a **frame band** — a real twenty-pixel ring of metal with a lit outer edge,
 *    a shadowed inner edge, its own grain, and the Current's signature cut
 *    through it deeply enough to read at grid size;
 * 4. the rarity ladder, which changes the metal, the keyline, the corner
 *    ornaments, the glow and the mark in the name plate's cap — five channels,
 *    of which colour is one;
 * 5. furniture: a raised name plate with a sunken medallion at each end, a
 *    sunken rules box, a collector line, an engraved Current cartouche;
 * 6. hardware: cost, attack and health as one family of faceted gems, seated in
 *    sockets, lit from 315° like everything else.
 *
 * Everything with a surface comes from `material.ts` and everything with a
 * silhouette from `frameShapes.ts`, so there is one light in this file and no
 * way to add a second by accident.
 */

import type { CardDef, CharacterCardDef, CurrentId, EquipmentCardDef, LeaderCardDef, LocationCardDef } from "../../engine/types";
import {
  CARD_W,
  CARD_H,
  CURRENT_PALETTE,
  FACTION_CODE,
  FACTION_COLOR,
  FACTION_INDEX,
  GILD,
  LAYOUT,
  RARITY_STYLE,
  hexToRgba,
  mix,
  saturate,
} from "./palette";
import { bandPaths, framePath } from "./frameShapes";
import { drawCurrentIcon, drawFactionCrest } from "./icons";
import { onAssetLoaded } from "../art/assetLoader";
import { drawHatch, patternsOn } from "./hatch";
import { drawPlaceholderArt, resetCrestStamps } from "./placeholderArt";
import { getCardArt, onArtLoaded } from "../art/artLoader";
import { registerCardSurface, setCardHover } from "./cardClock";
import { settingsStore } from "../../save/settings";
import {
  TILE_DETAIL_BELOW,
  TO_LIGHT,
  TYPE,
  bandFace,
  bandShelf,
  cardFont,
  cardHighContrast,
  crossfadeIn,
  castShadow,
  drawGem,
  drawLabel,
  drawNumber,
  edgeGradient,
  fadedRule,
  grainOver,
  innerCast,
  isTileDetail,
  litGradient,
  onCardTextureReady,
  raisedPlate,
  refreshCardStyle,
  roundRectPath,
  setCardDetail,
  sunkenPlate,
  type Metal,
  type Rect,
} from "./material";

export interface RenderCardOptions {
  /** loaded art image; omit for the procedural placeholder */
  art?: HTMLImageElement | ImageBitmap | null;
  /** premium foil sheen; `phase` animates it (0..1) */
  premium?: boolean;
  phase?: number;
  /** render at a smaller size (collection grid) with simplified detail */
  compact?: boolean;
  /** dim the card (unowned / unplayable) */
  dimmed?: boolean;
  /** highlight ring (playable / targetable) */
  highlight?: "none" | "playable" | "target" | "selected";
  /** live stat overrides so a buffed board character shows its real numbers */
  liveAttack?: number;
  liveHealth?: number;
  liveMaxHealth?: number;
  /**
   * Enlarge attack and health for a card being read at board size, where the
   * numbers matter more than the rules text and the normal chips are too small
   * to count at a glance. It also strips the type line, the collector band and
   * the rarity mark: at ~121px those three are grey smear, and a designed-looking
   * block of noise is worse than an empty band.
   */
  statEmphasis?: boolean;
  /**
   * 0–1 position of the specular band crawling the frame. Driven by the shared
   * clock for cards drawn large enough to see it, parked at a constant for the
   * rest — see `renderCardToCanvas`.
   */
  sheen?: number;
  /**
   * 0–1 how hard the card is being looked at.
   *
   * §5 asks a hover to move the element, light it *and* scale it, all three
   * inside 120ms. A CSS wrapper can do two of those; the light has to happen on
   * the bitmap, because the bitmap is where the metal is. At 1 the frame's rim
   * glow roughly doubles, the specular band brightens and the whole band takes a
   * few points of lift — the card catches the light as it comes up off the grid,
   * rather than simply arriving somewhere else at the same brightness.
   */
  hover?: number;
  /**
   * The width the result will be displayed at, if the caller knows it.
   *
   * Not used to size anything — the card is always drawn in card space — but to
   * pick the finish. See `material.ts::CardDetail`.
   */
  renderWidth?: number;
  /**
   * Draw the static card only, leaving the specular, the hover light and the
   * foil to `drawCardMotion`. See that function for why the two are separate.
   */
  motion?: boolean;
}

// ---------------------------------------------------------------------------
// Rich text layout (bold keywords, italic reminder text)
// ---------------------------------------------------------------------------

interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Parse the card-text mini-markup: **bold** and *italic*. */
export function parseCardText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), bold: false, italic: false });
    const token = match[0];
    if (token.startsWith("**")) segments.push({ text: token.slice(2, -2), bold: true, italic: false });
    else segments.push({ text: token.slice(1, -1), bold: false, italic: true });
    last = match.index + token.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false, italic: false });
  return segments;
}

interface LaidWord {
  text: string;
  bold: boolean;
  italic: boolean;
  width: number;
}

function bodyFont(size: number, bold: boolean, italic: boolean): string {
  return cardFont(size, bold ? 700 : 500, italic);
}

/**
 * Word-wrap rich text into a box, choosing from a **fixed set of sizes**.
 *
 * The old version stepped down one pixel at a time from 20 to 11, which meant
 * two cards side by side in the same grid printed their rules at 20px and 12px
 * and neither of them was a decision anybody made. Three steps is a hierarchy;
 * ten is the absence of one. The last step is used whether or not it fits,
 * because the alternative — carrying on shrinking — is how a card ends up with
 * nine-pixel text nobody can read.
 */
function drawRichText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Rect,
  options: { steps: readonly number[]; color: string; align?: "center" | "left" }
): void {
  const segments = parseCardText(text);
  if (segments.length === 0) return;

  for (let step = 0; step < options.steps.length; step++) {
    const size = options.steps[step]!;
    const lineHeight = size * 1.3;
    const words: LaidWord[] = [];
    for (const segment of segments) {
      ctx.font = bodyFont(size, segment.bold, segment.italic);
      const parts = segment.text.split(/(\s+)/).filter((p) => p.length > 0);
      for (const part of parts) {
        words.push({ text: part, bold: segment.bold, italic: segment.italic, width: ctx.measureText(part).width });
      }
    }

    // greedy wrap
    const lines: LaidWord[][] = [[]];
    let lineWidth = 0;
    for (const word of words) {
      const isSpace = /^\s+$/.test(word.text);
      if (lineWidth + word.width > box.w && !isSpace && lines[lines.length - 1]!.length > 0) {
        lines.push([]);
        lineWidth = 0;
      }
      if (isSpace && lineWidth === 0) continue;
      lines[lines.length - 1]!.push(word);
      lineWidth += word.width;
    }

    const totalHeight = lines.length * lineHeight;
    if (totalHeight > box.h && step < options.steps.length - 1) continue;

    ctx.save();
    ctx.fillStyle = options.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 2;
    const startY = box.y + (box.h - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, index) => {
      const width = line.reduce((sum, w) => sum + w.width, 0);
      let x = options.align === "left" ? box.x : box.x + (box.w - width) / 2;
      const y = startY + index * lineHeight;
      for (const word of line) {
        ctx.font = bodyFont(size, word.bold, word.italic);
        ctx.fillText(word.text, x, y);
        x += word.width;
      }
    });
    ctx.restore();
    return;
  }
}

/** A card name, at one of three sizes and never between them. */
function drawCardName(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  steps: readonly number[]
): void {
  let size = steps[steps.length - 1]!;
  for (const step of steps) {
    ctx.font = cardFont(step, 700);
    if (ctx.measureText(text).width <= maxWidth) {
      size = step;
      break;
    }
  }
  ctx.save();
  ctx.font = cardFont(size, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${-size * 0.012}px`;
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy, maxWidth);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame construction
// ---------------------------------------------------------------------------

/** The card silhouette, used both to clip the art and to build the band. */
function frameRect(): Rect {
  return { x: LAYOUT.bleed, y: LAYOUT.bleed, w: CARD_W - LAYOUT.bleed * 2, h: CARD_H - LAYOUT.bleed * 2 };
}

/**
 * The metal the frame band is made of: the Current, ranked by rarity.
 *
 * Every tier is the Current's own hue at a different chroma and value, so the
 * ladder can only climb — see the note over `RARITY_STYLE` for what happened
 * when it was a hue mix instead. The gild is legendary's alone and is weighted
 * toward the lit end: gilding the shadows as hard as the highlights turns a deep
 * Veil frame into brown sludge, because there is no light down there for a warm
 * metal to be warm *in*.
 */
function bandMetal(current: CurrentId, rarity: CardDef["rarity"]): Metal {
  const palette = CURRENT_PALETTE[current];
  const style = RARITY_STYLE[rarity];
  const rank = (hex: string, extraLift: number, gild: number): string =>
    mix(saturate(hex, style.chroma, style.lift + extraLift), GILD, style.gild * gild);
  return {
    hi: rank(palette.hi, 0.02, 1),
    key: rank(palette.key, 0, 0.9),
    lo: rank(palette.lo, -0.01, 0.42),
    abyss: mix(rank(palette.abyss, -0.02, 0.2), "#000000", 0.35),
  };
}

/** The metal a rarity's own furniture — keyline, corner caps, mark — is cut from. */
function rarityMetal(current: CurrentId, rarity: CardDef["rarity"]): Metal {
  const style = RARITY_STYLE[rarity];
  const palette = CURRENT_PALETTE[current];
  return {
    hi: mix(style.metal.hi, palette.hi, 0.18),
    key: style.color,
    lo: mix(style.metal.lo, palette.lo, 0.3),
    abyss: mix(style.metal.lo, "#000000", 0.6),
  };
}

/**
 * Full-bleed art: the artwork fills the entire card, clipped to the Current's
 * silhouette. Scrims at the top and bottom keep the overlaid UI readable no
 * matter what the art looks like underneath.
 */
function drawArt(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId,
  art: RenderCardOptions["art"],
  outer: Path2D,
  boardFace: boolean
): void {
  const palette = CURRENT_PALETTE[current];

  ctx.save();
  ctx.clip(outer);

  if (art) {
    // cover-fit so the art always fills the frame with no letterboxing
    const iw = "width" in art ? art.width : CARD_W;
    const ih = "height" in art ? art.height : CARD_H;
    const scale = Math.max(CARD_W / iw, CARD_H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(art as CanvasImageSource, (CARD_W - dw) / 2, (CARD_H - dh) / 2, dw, dh);
  } else {
    drawPlaceholderArt(
      ctx,
      { x: 0, y: 0, w: CARD_W, h: CARD_H },
      current,
      card.name,
      /**
       * The disclosure goes at 0.49h, which is the last row the bottom scrim
       * leaves alone. It used to be drawn at `h - 6`, underneath the rules box
       * and between the two stat gems, where it has never once been visible.
       */
      { faction: card.faction, disclosure: boardFace ? null : { cx: CARD_W / 2, y: 332, width: 300 } }
    );
  }

  // top scrim — carries the cost gem and the Current cartouche
  const top = LAYOUT.topScrim;
  const hard = cardHighContrast();
  const topGrad = ctx.createLinearGradient(0, top.y, 0, top.y + top.h);
  topGrad.addColorStop(0, hexToRgba(palette.abyss, hard ? 1 : 0.82));
  topGrad.addColorStop(0.46, hexToRgba(palette.abyss, hard ? 0.66 : 0.3));
  topGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(top.x, top.y, top.w, top.h);

  // bottom scrim — carries the name, rules text, collector line and stat gems
  const scrimY = boardFace ? LAYOUT.boardScrimY : LAYOUT.bottomScrim.y;
  const bottom = { x: 0, y: scrimY, w: CARD_W, h: CARD_H - scrimY };
  const bottomGrad = ctx.createLinearGradient(0, bottom.y, 0, bottom.y + bottom.h);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  bottomGrad.addColorStop(0.24, hexToRgba(palette.abyss, hard ? 0.85 : 0.6));
  bottomGrad.addColorStop(0.46, hexToRgba("#05030c", hard ? 1 : 0.9));
  bottomGrad.addColorStop(1, hexToRgba("#04020a", hard ? 1 : 0.97));
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(bottom.x, bottom.y, bottom.w, bottom.h);

  // subtle Current wash over the whole card ties art to element
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = hexToRgba(palette.key, 0.1);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.globalCompositeOperation = "source-over";

  ctx.restore();
}

/**
 * A rarity inlay: a length of the frame band cut out and replaced with the
 * rarity's own metal, with a gem set into the middle of it.
 *
 * ## Why it is on the rails and not in the corners
 *
 * It used to be a corner bracket, and the reason a Tide rare and a Tide common
 * photographed identically is that **all four brackets were underneath the
 * hardware**. The cost gem's collar covers card-space x 33–123, y 21–111; the
 * Current cartouche runs x 318–462, y 47–85; the two stat gems cover the bottom
 * corners out to a 47px radius. Every one of the four corners a "corner cap"
 * could occupy is occupied. The ornaments were being drawn correctly, in the
 * right colour, at the right size, and then painted over — which is worse than
 * not drawing them, because it looks like the ladder was designed and rejected.
 *
 * The mid-edges are the only long stretches of frame with nothing on them: the
 * left and right rails are clear for four hundred pixels, and the top and bottom
 * are clear between the cost gem and the cartouche and below the collector line.
 * So that is where the tier goes.
 *
 * ## Clipped to the band, which is what makes it work on eight silhouettes
 *
 * The inlay is a plain capsule intersected with the frame band, so it is by
 * construction a *segment of the frame* rather than a shape sitting on one.
 * Cinder's notches bite through it, Halo's dome curves it, Prism's facets cut
 * its ends — no per-shape geometry, and no way for it to spill onto the art.
 */
type Rail = "left" | "right" | "top" | "bottom";

function drawRailInlay(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  band: Path2D,
  side: Rail,
  reach: number,
  thickness: number,
  metal: Metal
): void {
  const vertical = side === "left" || side === "right";
  const cx = side === "left" ? rect.x + thickness / 2 : side === "right" ? rect.x + rect.w - thickness / 2 : rect.x + rect.w / 2;
  const cy = side === "top" ? rect.y + thickness / 2 : side === "bottom" ? rect.y + rect.h - thickness / 2 : rect.y + rect.h / 2;
  const length = reach * 2;
  const box: Rect = vertical
    ? { x: cx - thickness / 2, y: cy - length / 2, w: thickness, h: length }
    : { x: cx - length / 2, y: cy - thickness / 2, w: length, h: thickness };
  const capsule = roundRectPath(box, thickness * 0.44);

  ctx.save();
  ctx.clip(band, "evenodd");

  // seated in a shadowed groove, so it reads as let into the metal
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fill(capsule);
  ctx.restore();

  /**
   * The highlight stops at 0.55 of the way to `hi`, not 0.85.
   *
   * At 0.85 every tier's inlay came out the same pale near-white lozenge — a
   * lump on the rail rather than a piece of blue steel, violet or gold — which
   * defeats the one job it has. Rarity is carried by the *hue* of this object, so
   * the lit end has to stay recognisably that hue.
   */
  ctx.fillStyle = litGradient(ctx, box, [
    [0, mix(metal.lo, metal.abyss ?? "#000000", 0.35)],
    [0.45, metal.key],
    [1, mix(metal.key, metal.hi, 0.55)],
  ]);
  ctx.fill(capsule);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = edgeGradient(ctx, box, 0.5, 0.7);
  ctx.stroke(capsule);

  drawGem(ctx, {
    shape: "diamond",
    cx,
    cy,
    r: Math.max(5, thickness * 0.36),
    metal: { hi: mix(metal.hi, "#ffffff", 0.3), key: metal.key, lo: metal.lo, abyss: metal.abyss },
    socket: false,
    lift: 2,
  });
  ctx.restore();
}

/** Which rails a tier decorates. More rails is more valuable, at any size. */
function railsFor(rarity: CardDef["rarity"]): Rail[] {
  switch (rarity) {
    case "rare":
      return ["left", "right"];
    case "epic":
      return ["left", "right", "top"];
    case "legendary":
      return ["left", "right", "top", "bottom"];
    default:
      return [];
  }
}

/**
 * The frame band, and everything the rarity ladder does to it.
 *
 * The band is filled even-odd between the two contours and the whole group is
 * clipped to the outer one, which is the safety net that turns a mis-tuned inner
 * amplitude into a thin frame rather than a hole punched through the metal.
 */
function drawFrameBand(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId,
  paths: { outer: Path2D; inner: Path2D; band: Path2D }
): void {
  const palette = CURRENT_PALETTE[current];
  const style = RARITY_STYLE[card.rarity];
  const rect = frameRect();
  const metal = bandMetal(current, card.rarity);

  ctx.save();
  ctx.clip(paths.outer);

  ctx.fillStyle = bandFace(ctx, rect, metal);
  ctx.fill(paths.band, "evenodd");

  /**
   * The moulding, and the single change that turns a coloured stripe into
   * metal.
   *
   * A flat band with a gradient across it is a flat band; what the eye reads as
   * *machined* is a narrow, high-contrast specular where a profile changes
   * angle. So the band is cut into two steps — an outer lip and a recessed
   * inner shelf — and the wall between them is stroked with a highlight that is
   * white where it faces the light and black where it turns away. Three
   * strokes, no extra fills, and it is the difference between the frame reading
   * as a border and reading as an object with a section.
   */
  const shelfInset = style.band * 0.42;
  const shelf = framePath(palette.shape, {
    x: rect.x + shelfInset,
    y: rect.y + shelfInset,
    w: rect.w - shelfInset * 2,
    h: rect.h - shelfInset * 2,
  });
  const inner = new Path2D();
  inner.addPath(shelf);
  inner.addPath(paths.inner);
  ctx.fillStyle = bandShelf(ctx, rect, metal);
  ctx.fill(inner, "evenodd");

  grainOver(ctx, paths.band, 0.95, "evenodd");

  // the wall of the step, lit
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.5, 0.58);
  ctx.stroke(shelf);

  /**
   * The second keyline: an inlaid rule on the outer lip, from rare up.
   *
   * It carries the rarity's *colour*, which is the channel the frame metal gave
   * up when the ladder stopped being a hue mix. A blue hairline on a Tide rare
   * and a violet one on a Tide epic sit over the same Current metal, so the
   * tiers separate by accent rather than by turning the frame grey — and a
   * legendary's is gold on gold, which is what a gild is.
   *
   * Laid as three strokes rather than one: a dark groove, the colour, and a lit
   * shoulder offset toward the light. That is what stops it reading as a border
   * drawn on top of the metal rather than a line cut into it.
   */
  if (style.innerRim > 0) {
    const keylineRect = { x: rect.x + 6, y: rect.y + 6, w: rect.w - 12, h: rect.h - 12 };
    const keyline = framePath(palette.shape, keylineRect);
    ctx.save();
    ctx.lineWidth = style.innerRim + 2.4;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke(keyline);
    ctx.lineWidth = style.innerRim;
    ctx.strokeStyle = hexToRgba(mix(style.color, "#ffffff", 0.12), 0.94);
    ctx.stroke(keyline);
    ctx.lineWidth = Math.max(1, style.innerRim * 0.34);
    ctx.translate(TO_LIGHT.x * 1.2, TO_LIGHT.y * 1.2);
    ctx.strokeStyle = hexToRgba(mix(style.color, "#ffffff", 0.7), 0.55);
    ctx.stroke(keyline);
    ctx.restore();
  }

  /**
   * The rail inlays, cut from the rarity's own metal rather than the frame's.
   *
   * An ornament in the Current's metal on a frame made of the Current's metal is
   * a lump, not an ornament — it disappears at exactly the size the tier most
   * needs reading. Blue steel on a Tide rare, violet on an epic, gold on a
   * legendary: the inlay is the one place on the frame where rarity outranks
   * Current, and the *count* of them is a second, colourless channel that
   * survives a greyscale monitor and a 3:1 downsample alike.
   */
  if (style.ornament > 0) {
    const inlay = rarityMetal(current, card.rarity);
    for (const side of railsFor(card.rarity)) {
      drawRailInlay(ctx, rect, paths.band, side, style.ornament, style.band * 0.66, inlay);
    }
  }

  // the two walls of the band, lit from opposite sides because they face
  // opposite ways — this is what makes it a raised ring rather than an outline
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.46, 0.72);
  ctx.stroke(paths.outer);
  ctx.lineWidth = 2;
  ctx.strokeStyle = edgeGradient(ctx, rect, 0.32, 0.78, true);
  ctx.stroke(paths.inner);

  ctx.restore();

  // the frame's own shadow, falling across the artwork it sits over
  innerCast(ctx, paths.inner, rect, { blur: 13, alpha: 0.5, lift: 5, tone: "dark", away: true });
}

/**
 * Everything on a card that changes between one frame and the next, and nothing
 * that does not.
 *
 * This split is a frame-rate fix, and the measurement that forced it is the
 * detail view: repainting a whole 420px card costs about 30ms, so the twelve
 * repaints a second the idle clock asks for took the p95 frame time to **42.5ms
 * and the worst frame to 69.5ms** on a screen showing one static card. §9 calls
 * that a bug rather than a feature, and it is — for a highlight crawling across
 * a border.
 *
 * So the expensive half is drawn once into an offscreen and the cheap half is
 * composited over it every tick: a blit, two gradient fills and a stroke. The
 * card's art, frame, plates, gems and type do not move, and now they are not
 * redrawn as though they did. It is also what makes the attention-driven clock
 * affordable — eight animated cards cost what one used to.
 *
 * Everything here is deliberately drawn *over* the finished card rather than
 * inside the frame band's own pass. A specular sweeping across a card lights its
 * hardware too, which is what it would do in the world.
 */
export function drawCardMotion(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  options: { sheen?: number; phase?: number; premium?: boolean; hover?: number } = {}
): void {
  const current: CurrentId = card.current;
  const palette = CURRENT_PALETTE[current];
  const style = RARITY_STYLE[card.rarity];
  const rect = frameRect();
  const metal = bandMetal(current, card.rarity);
  const paths = bandPaths(palette.shape, rect, style.band);
  const sheen = options.sheen ?? 0.28;
  const hover = options.hover ?? 0;

  ctx.save();
  ctx.clip(paths.band, "evenodd");
  const lit = 1 + hover;
  const travel = (sheen % 1) * (CARD_W + CARD_H) * 1.5 - CARD_H * 0.5;
  const sweep = ctx.createLinearGradient(travel - CARD_H * 0.55, 0, travel, CARD_H);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.46, hexToRgba(metal.hi, (0.1 + 0.2 * style.glow) * lit));
  sweep.addColorStop(0.52, hexToRgba("#ffffff", (0.12 + 0.3 * style.glow) * lit));
  sweep.addColorStop(0.58, hexToRgba(metal.hi, (0.1 + 0.2 * style.glow) * lit));
  sweep.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // the hovered card's metal comes up a few points across the whole band, so
  // the lift the wrapper does is a lift *into the light* rather than a slide
  if (hover > 0) {
    ctx.fillStyle = hexToRgba(mix(metal.hi, "#ffffff", 0.4), 0.09 * hover);
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.restore();

  // a tight coloured rim glow — the big bloom belongs to the host, not the bitmap
  ctx.save();
  ctx.shadowColor = hexToRgba(palette.key, Math.min(0.95, (0.34 + 0.36 * style.glow) * (1 + 0.8 * hover)));
  ctx.shadowBlur = 10 + 9 * hover;
  ctx.lineWidth = 2 + 1.4 * hover;
  ctx.strokeStyle = hexToRgba(
    mix(palette.key, palette.hi, 0.35 + 0.4 * hover),
    Math.min(1, (0.5 + 0.3 * style.glow) * (1 + 0.5 * hover))
  );
  ctx.stroke(paths.outer);
  ctx.restore();

  if (options.premium) drawFoil(ctx, paths.outer, options.phase ?? 0);
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

/**
 * The Hype cost, as mounted hardware rather than a sticker.
 *
 * Hype is a universal resource, so the crystal stays cyan on all 296 cards — but
 * it used to be *the* most saturated object on a Cinder card and invisible on a
 * Tide one, and it crossed the frame rim with no collar or cast. It is now
 * seated in a collar mixed toward the Current, desaturated a notch so it stops
 * outranking the artwork, and it casts onto the frame it is set into.
 */
function drawCostGem(ctx: CanvasRenderingContext2D, cost: number, current: CurrentId): void {
  const { cx, cy, r } = LAYOUT.costGem;
  const palette = CURRENT_PALETTE[current];

  // the collar: a ring of the Current's own metal, so the gem harmonises
  const collarPath = new Path2D();
  const outerRing = { x: cx - r * 1.24, y: cy - r * 1.24, w: r * 2.48, h: r * 2.48 };
  collarPath.arc(cx, cy, r * 1.24, 0, Math.PI * 2);
  castShadow(ctx, collarPath, 4, 0.5);
  ctx.save();
  ctx.fillStyle = litGradient(ctx, outerRing, [
    [0, mix(palette.abyss, "#000000", 0.4)],
    [0.6, mix(palette.lo, palette.key, 0.35)],
    [1, mix(palette.key, palette.hi, 0.5)],
  ]);
  ctx.fill(collarPath);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = edgeGradient(ctx, outerRing, 0.42, 0.7);
  ctx.stroke(collarPath);
  ctx.restore();
  innerCast(ctx, collarPath, outerRing, { blur: 8, alpha: 0.6, lift: 4, tone: "dark", away: true });

  drawGem(ctx, {
    shape: "hex",
    cx,
    cy,
    r,
    // 15% off the old saturation: it was outranking the painting on warm Currents
    metal: { hi: "#cfeaff", key: "#3f93d8", lo: "#123b6b", abyss: "#08203c" },
    socket: false,
    glow: 0.3,
    lift: 4,
  });

  drawNumber(ctx, cost, cx, cy + 1, { size: 36, maxWidth: r * 1.5, colour: "#ffffff", outline: 5 });
}

/**
 * The Current cartouche: engraved into the frame's language, not a web pill.
 *
 * It was a 190×52 rounded-full chip — 37% of the card's width, with a 2px
 * uniform stroke — carrying a gold glyph on a gold plate at about 1.3:1. It is
 * now 144×38, sunken rather than raised, with the glyph on its own dark
 * medallion so it separates from a same-hue plate whatever the Current is.
 */
function drawCurrentCartouche(ctx: CanvasRenderingContext2D, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  const b = LAYOUT.badge;
  const path = roundRectPath(b, 9);

  sunkenPlate(ctx, path, b, {
    metal: { hi: palette.hi, key: mix(palette.key, "#000000", 0.35), lo: mix(palette.lo, "#000000", 0.4), abyss: palette.abyss },
    amplitude: 0.7,
    opacity: 0.94,
  });

  if (patternsOn()) {
    ctx.save();
    ctx.clip(path);
    ctx.globalAlpha = 0.5;
    drawHatch(ctx, palette.hatch, b, hexToRgba(palette.hi, 0.42));
    ctx.restore();
  }

  // the glyph sits on its own recessed medallion, never raw on the plate
  const gx = b.x + 21;
  const gy = b.y + b.h / 2;
  const medallion = new Path2D();
  medallion.arc(gx, gy, 13.5, 0, Math.PI * 2);
  ctx.save();
  ctx.fillStyle = "rgba(4,2,10,0.72)";
  ctx.fill(medallion);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = edgeGradient(ctx, { x: gx - 14, y: gy - 14, w: 28, h: 28 }, 0.24, 0.5, true);
  ctx.stroke(medallion);
  ctx.restore();
  drawCurrentIcon(ctx, current, gx, gy, 11, palette.hi);

  drawLabel(ctx, palette.label, b.x + 41, gy + 1, {
    size: 13,
    colour: "#ffffff",
    tracking: 2.2,
    align: "left",
  });
}

/**
 * The name plate: a raised banner with a sunken medallion at each end.
 *
 * The caps are the fix for two separate defects at once. The rarity mark used to
 * be a row of 11px pips on the card's bottom edge, directly underneath the
 * collection grid's own count pill, so on the one screen where a player compares
 * rarities it was completely occluded; the faction crest used to be a 512px PNG
 * downsampled to 44px and dropped straight onto the character's hair with no
 * plate and no shadow. Both now sit in hardware, on the card's strongest
 * horizontal, where nothing can cover them and nothing has to compete with the
 * artwork behind them.
 */
function drawNamePlate(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId,
  boardFace: boolean
): void {
  const metal = bandMetal(current, card.rarity);
  const r = boardFace ? LAYOUT.boardNamePlate : LAYOUT.namePlate;
  const path = roundRectPath(r, 10);

  raisedPlate(ctx, path, r, {
    metal: {
      hi: mix(metal.hi, "#ffffff", 0.1),
      key: mix(metal.key, "#000000", 0.45),
      lo: mix(metal.lo, "#000000", 0.5),
      abyss: "#05030c",
    },
    amplitude: 0.62,
    opacity: 0.96,
    lift: 5,
  });

  if (boardFace) {
    drawCardName(ctx, card.name, r.x + r.w / 2, r.y + r.h / 2 + 1, r.w - 28, [40, 33, 27]);
    return;
  }

  // --- the two medallions --------------------------------------------------
  const cap = LAYOUT.plateCap;
  for (const side of [-1, 1] as const) {
    const cx = side < 0 ? r.x + cap / 2 : r.x + r.w - cap / 2;
    const well = new Path2D();
    well.arc(cx, r.y + r.h / 2, cap / 2 - 6, 0, Math.PI * 2);
    sunkenPlate(ctx, well, { x: cx - cap / 2, y: r.y, w: cap, h: cap }, {
      metal: { hi: metal.hi, key: mix(metal.lo, "#000000", 0.3), lo: "#0a0714", abyss: "#04020a" },
      amplitude: 0.8,
      grain: 0,
    });
  }

  const mark = LAYOUT.rarityGem;
  drawRarityMark(ctx, card.rarity, mark.cx, mark.cy, mark.r);

  const crest = LAYOUT.crest;
  drawFactionCrest(
    ctx,
    FACTION_INDEX[card.faction] ?? 10,
    crest.cx,
    crest.cy,
    crest.r * 0.82,
    hexToRgba(FACTION_COLOR[card.faction] ?? "#8f8aa8", 0.95),
    card.faction
  );

  drawCardName(ctx, card.name, r.x + r.w / 2, r.y + r.h / 2 + 1, r.w - cap * 2 - 16, TYPE.name);
}

/**
 * The rarity mark: one shape per tier, not one colour per tier.
 *
 * A count of pips is a second channel only if the pips are big enough to count,
 * which four 11px diamonds on a 168px tile are not. One gem, a pair, a cluster
 * and a star are four different silhouettes at any size — and the word itself is
 * printed in the collector line below, which is the channel that survives a
 * greyscale monitor.
 */
function drawRarityMark(
  ctx: CanvasRenderingContext2D,
  rarity: CardDef["rarity"],
  cx: number,
  cy: number,
  r: number
): void {
  const style = RARITY_STYLE[rarity];
  const metal: Metal = {
    hi: mix(style.metal.hi, "#ffffff", 0.25),
    key: style.color,
    lo: mix(style.color, "#000000", 0.62),
    abyss: mix(style.color, "#000000", 0.82),
  };

  switch (rarity) {
    case "common":
      drawGem(ctx, { shape: "diamond", cx, cy, r: r * 0.62, metal, socket: false, lift: 2 });
      break;
    case "rare":
      for (const dx of [-1, 1]) {
        drawGem(ctx, { shape: "diamond", cx: cx + dx * r * 0.44, cy, r: r * 0.46, metal, socket: false, lift: 2 });
      }
      break;
    case "epic":
      drawGem(ctx, { shape: "diamond", cx, cy: cy - r * 0.4, r: r * 0.42, metal, socket: false, lift: 2 });
      for (const dx of [-1, 1]) {
        drawGem(ctx, {
          shape: "diamond",
          cx: cx + dx * r * 0.44,
          cy: cy + r * 0.34,
          r: r * 0.42,
          metal,
          socket: false,
          lift: 2,
        });
      }
      break;
    case "legendary":
      drawGem(ctx, { shape: "star", cx, cy, r: r * 0.95, metal, socket: false, glow: 0.5, lift: 3 });
      break;
  }
}

function drawTypeLine(ctx: CanvasRenderingContext2D, card: CardDef, current: CurrentId): void {
  const palette = CURRENT_PALETTE[current];
  drawLabel(ctx, cardTypeLabel(card), CARD_W / 2, LAYOUT.typeLineY, {
    size: TYPE.label,
    colour: cardHighContrast() ? "#ffffff" : hexToRgba(palette.hi, 0.95),
    tracking: 2.6,
  });
}

/**
 * Keyword reminders, for the Rules Lens.
 *
 * A module-level map rather than a parameter, for the reason the hatch flag is
 * one: `renderCardToCanvas` is called from a dozen places that have no business
 * knowing about the keyword table, and `main.ts` already loads the content index
 * exactly once. Empty until it is set, which makes the lens a no-op rather than
 * a crash anywhere the renderer runs headless.
 */
let keywordReminders: Record<string, string> = {};
let lensOn = false;

export function setRulesLens(on: boolean, reminders?: Record<string, string>): void {
  lensOn = on;
  if (reminders) keywordReminders = reminders;
}

export const rulesLensOn = (): boolean => lensOn;

/** The italic reminder tail appended to a card's own text when the lens is on. */
export function lensText(card: CardDef): string {
  if (!lensOn || card.keywords.length === 0) return "";
  const lines = card.keywords
    .map((id) => (keywordReminders[id] ? `${keywordReminders[id]}` : ""))
    .filter(Boolean);
  return lines.length > 0 ? `*${lines.join(" ")}*` : "";
}

/**
 * What a board unit says instead of its rules text: its keywords, in caps, on
 * the scrim.
 *
 * Two at most and no plate, because the plate is what made the old version read
 * as a designed block of noise. At 121px this is a short row of capitals about
 * seven pixels tall — the same size as the name, which the reference proves is
 * readable at board scale — and it tells a player the one thing they actually
 * need mid-trade: does this thing have Spotlight.
 */
function drawBoardKeywords(ctx: CanvasRenderingContext2D, card: CardDef, current: CurrentId): void {
  if (card.keywords.length === 0) return;
  const palette = CURRENT_PALETTE[current];
  const text = card.keywords
    .slice(0, 2)
    .map((id) => id.replace(/-/g, " "))
    .join("  ·  ");
  drawLabel(ctx, text, CARD_W / 2, LAYOUT.boardKeywordY, {
    size: 28,
    colour: hexToRgba(mix(palette.hi, "#ffffff", 0.4), 0.96),
    tracking: 3,
  });
}

function drawTextBox(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  current: CurrentId
): void {
  const palette = CURRENT_PALETTE[current];
  const r = LAYOUT.textBox;
  /**
   * §17's Rules Lens.
   *
   * Every keyword's reminder text, on the face, at every rarity — overriding the
   * templating rule that omits it on Epics and Legendaries on the grounds that
   * anybody playing those knows what the words mean. That grounds is a guess
   * about the reader, and this is the switch for the readers it guesses wrong
   * about.
   *
   * The board face has no rules box at all, so there is nowhere for it to go
   * there and nothing to guard against.
   */
  const body = [card.text?.trim() ?? "", lensText(card)].filter(Boolean).join(" ");
  const hasBody = body.length > 0;

  const path = roundRectPath(r, 11);
  sunkenPlate(ctx, path, r, {
    metal: { hi: mix(palette.hi, "#ffffff", 0.3), key: "#16112a", lo: "#0a0716", abyss: "#04020c" },
    amplitude: 0.75,
    opacity: cardHighContrast() ? 1 : hasBody || card.flavor ? 0.95 : 0.62,
  });

  // a hairline of the Current on the recess lip, so the box belongs to the card
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(palette.key, 0.34);
  ctx.stroke(path);
  ctx.restore();

  const textArea = { x: r.x + 16, y: r.y + 11, w: r.w - 32, h: r.h - 22 };

  if (hasBody) {
    drawRichText(ctx, body, textArea, { steps: TYPE.body, color: cardHighContrast() ? "#ffffff" : "#efeaff" });
  } else if (card.flavor) {
    drawRichText(ctx, `*${card.flavor}*`, textArea, { steps: TYPE.body, color: hexToRgba("#efeaff", 0.7) });
  }
}

/**
 * The collector line.
 *
 * Both MTG Arena and Gwent carry one, and it is a large part of why their cards
 * read as printed objects rather than as interface. It also fills a band that
 * was dead on every Action and Reaction in the game — those have no stat gems,
 * so the whole bottom sixth of the card was empty except for two 11px pips.
 *
 * The art credit is the honest one: `HYPEBOUND` where a painting exists, `ART
 * PENDING` where it does not, which is the second place a player is told that an
 * unpainted card is waiting rather than broken.
 */
function drawFooter(ctx: CanvasRenderingContext2D, card: CardDef, current: CurrentId, hasArt: boolean): void {
  const palette = CURRENT_PALETTE[current];
  const y = LAYOUT.footerY;
  const parts = [
    FACTION_CODE[card.faction] ?? "NTL",
    collectorNumber(card.id),
    RARITY_STYLE[card.rarity].label,
    hasArt ? "HYPEBOUND" : "ART PENDING",
  ];
  const colour = cardHighContrast() ? "#ffffff" : hexToRgba(mix(palette.hi, "#ffffff", 0.25), 0.82);

  /**
   * The band between the two stat gems is 260px wide and the line has to live
   * inside it — a collector line disappearing under a health gem is worse than
   * no collector line. Fields are dropped from the least load-bearing end: the
   * art credit first, then the set code, so the rarity *word* — the channel that
   * survives a greyscale monitor — is the last thing to go.
   */
  const room = LAYOUT.healthChip.cx - LAYOUT.healthChip.r - 12 - (LAYOUT.attackChip.cx + LAYOUT.attackChip.r + 12);
  ctx.save();
  ctx.font = cardFont(TYPE.footer, 700);
  ctx.letterSpacing = "1.4px";
  const shed = [3, 0];
  let text = parts.join(" · ");
  for (const index of shed) {
    if (ctx.measureText(text).width <= room) break;
    parts[index] = "";
    text = parts.filter(Boolean).join(" · ");
  }
  const width = ctx.measureText(text).width;
  ctx.restore();

  fadedRule(ctx, CARD_W / 2 - width / 2 - 34, CARD_W / 2 + width / 2 + 34, y - 13, palette.key, 0.4);
  drawLabel(ctx, text, CARD_W / 2, y, { size: TYPE.footer, colour, tracking: 1.4 });
}

/** A stable three-digit number per card, so the collector line means something. */
function collectorNumber(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String((hash % 296) + 1).padStart(3, "0");
}

function cardTypeLabel(card: CardDef): string {
  switch (card.type) {
    case "character":
      return card.tags[0] ? `Character — ${card.tags[0]}` : "Character";
    case "action":
      return "Action";
    case "reaction":
      return "Reaction";
    case "equipment":
      return "Equipment";
    case "location":
      return "Location";
    case "transformation":
      return "Transformation";
    case "event":
      return "Event";
    case "leader":
      return "Leader";
    default:
      return "";
  }
}

/**
 * Attack and health, from one gem primitive.
 *
 * They were an eight-point star with alternating radii — a lumpy octagon at any
 * real size — and a plain circle with a radial gradient, neither of them seated
 * in anything and neither casting. They are now two cuts of the same stone: a
 * blade-pointed shield and a rounded brilliant, one bevel, one rim thickness,
 * one light, both set into a socket that reads as part of the frame's bottom
 * corners.
 */
function drawStatGem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  value: number,
  kind: "attack" | "health",
  buffed: boolean,
  damaged: boolean,
  emphasis: boolean
): void {
  const metal: Metal =
    kind === "attack"
      ? { hi: "#ffe4a8", key: "#e08a25", lo: "#6e3405", abyss: "#3a1a02" }
      : { hi: "#ffc2c2", key: "#d8394c", lo: "#66101c", abyss: "#33070e" };

  drawGem(ctx, {
    shape: kind === "attack" ? "shield" : "round",
    cx,
    cy,
    r,
    metal,
    socket: true,
    glow: emphasis ? 0.34 : 0.22,
    lift: emphasis ? 5 : 3.5,
  });

  const colour = buffed ? "#a6ffbc" : damaged ? "#ffb4b4" : "#ffffff";
  drawNumber(ctx, value, cx, cy + (kind === "attack" ? r * 0.06 : 1), {
    size: emphasis ? r * 1.55 : r * 0.95,
    maxWidth: r * 1.45,
    colour,
    outline: emphasis ? 8 : 5,
  });
}

/**
 * The premium foil: a diffraction layer plus a specular sweep.
 *
 * The old one was a single band at `screen` with a 0.26 peak over an
 * already-bright card, and a three-up A/B at 300px was indistinguishable from
 * having no foil at all. Worse, its `phase` was dead: the only caller in the
 * game passed the literal 0.3 and nothing ever advanced it, so no card in
 * HYPEBOUND had ever shimmered. This is seven hue-rotated bands in
 * `color-dodge`, which is the mode that makes a diffraction grating read as
 * metal rather than as fog, plus one hard specular running the other way.
 */
function drawFoil(ctx: CanvasRenderingContext2D, outer: Path2D, phase: number): void {
  ctx.save();
  ctx.clip(outer);

  /**
   * `overlay`, not `color-dodge`.
   *
   * Dodge over a card whose rules box is deliberately near-black lifts that box
   * to a green haze and takes the rules text with it — a cosmetic that makes the
   * card harder to read is a bug however pretty it is. Overlay leaves the darks
   * alone and only spreads the grating across the mid-tones and the metal, which
   * is also physically what a diffraction foil does: you see it on the ink, not
   * in the shadows.
   */
  ctx.globalCompositeOperation = "overlay";
  const drift = (phase % 1) * 260;
  const bands = ctx.createLinearGradient(-drift, 0, CARD_W * 1.2 - drift, CARD_H);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const hue = (t * 300 + phase * 360) % 360;
    bands.addColorStop(t, `hsla(${hue}, 95%, 60%, ${i % 2 === 0 ? 0.34 : 0.14})`);
  }
  ctx.fillStyle = bands;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.globalCompositeOperation = "screen";
  const travel = ((phase * 1.4) % 1) * (CARD_W + CARD_H) - CARD_H * 0.4;
  const sweep = ctx.createLinearGradient(travel - CARD_H * 0.8, 0, travel, CARD_H);
  sweep.addColorStop(0, "rgba(0,0,0,0)");
  sweep.addColorStop(0.44, hexToRgba("#7df9ff", 0.1));
  sweep.addColorStop(0.5, hexToRgba("#ffffff", 0.24));
  sweep.addColorStop(0.56, hexToRgba("#ff8fd8", 0.1));
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a card at its canonical 512×680 size into the given context.
 * The caller sets up scaling/DPR; this always draws in card-space.
 */
export function renderCard(
  ctx: CanvasRenderingContext2D,
  card: CardDef,
  options: RenderCardOptions = {}
): void {
  const current: CurrentId = card.current;
  const palette = CURRENT_PALETTE[current];
  const boardFace = options.statEmphasis === true;
  const rect = frameRect();

  /**
   * The finish this card is being drawn at, decided once and read by everything
   * downstream — see `material.ts::CardDetail` for what it costs and buys.
   *
   * `renderWidth` is a promise about the destination, so a caller that does not
   * make one gets the full card. That is the right default: `cardMesh` renders a
   * board face at 819px and the detail view at 420, and both of those want every
   * pass.
   */
  const tile = options.renderWidth !== undefined && options.renderWidth < TILE_DETAIL_BELOW;
  setCardDetail(tile ? "tile" : "full");

  refreshCardStyle();
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  if (options.dimmed) ctx.globalAlpha = 0.45;

  const paths = bandPaths(palette.shape, rect, RARITY_STYLE[card.rarity].band);

  // the card is an object sitting on the page, so it casts before it is drawn
  castShadow(ctx, paths.outer, 8, 0.5);

  drawArt(ctx, card, current, options.art ?? null, paths.outer, boardFace);
  drawFrameBand(ctx, card, current, paths);
  drawNamePlate(ctx, card, current, boardFace);
  if (boardFace) {
    drawBoardKeywords(ctx, card, current);
  } else {
    /**
     * The two lines that are below one device pixel of cap height on a tile.
     *
     * The type line sets at 13px and the collector line at 11px in card space;
     * on a 168px cell those land at 4.3 and 3.6 CSS pixels. They are not small
     * text at that size, they are two grey smudges — the same "designed-looking
     * block of noise" the board face already strips — and each one costs a text
     * measure, a shrink loop and a faded rule. They come back the moment the
     * card is drawn at a size that can hold them.
     */
    if (!tile) drawTypeLine(ctx, card, current);
    drawTextBox(ctx, card, current);
    if (!tile) drawFooter(ctx, card, current, Boolean(options.art));
  }
  // leaders are never played from hand, so they carry no Hype cost gem
  if (card.type !== "leader") drawCostGem(ctx, card.cost, current);
  drawCurrentCartouche(ctx, current);

  // stat gems — board cards read theirs at ~121px wide, so they enlarge
  const atkChip = boardFace ? LAYOUT.boardAttackChip : LAYOUT.attackChip;
  const hpChip = boardFace ? LAYOUT.boardHealthChip : LAYOUT.healthChip;
  if (card.type === "character" || card.type === "leader") {
    const def = card as CharacterCardDef | LeaderCardDef;
    const baseAttack = "attack" in def ? def.attack : 0;
    const baseHealth = "health" in def ? def.health : 0;
    const attack = options.liveAttack ?? baseAttack;
    const health = options.liveHealth ?? baseHealth;
    if (card.type === "character") {
      drawStatGem(ctx, atkChip.cx, atkChip.cy, atkChip.r, attack, "attack", attack > baseAttack, false, boardFace);
      const maxHealth = options.liveMaxHealth ?? baseHealth;
      drawStatGem(ctx, hpChip.cx, hpChip.cy, hpChip.r, health, "health", maxHealth > baseHealth, health < maxHealth, boardFace);
    } else {
      drawStatGem(ctx, hpChip.cx, hpChip.cy, hpChip.r, health, "health", false, false, boardFace);
    }
  } else if (card.type === "equipment") {
    const equip = card as EquipmentCardDef;
    if (equip.equipAttack) drawStatGem(ctx, atkChip.cx, atkChip.cy, atkChip.r, equip.equipAttack, "attack", false, false, boardFace);
    if (equip.equipHealth) drawStatGem(ctx, hpChip.cx, hpChip.cy, hpChip.r, equip.equipHealth, "health", false, false, boardFace);
  } else if (card.type === "location") {
    const location = card as LocationCardDef;
    if (location.durability) {
      drawStatGem(ctx, hpChip.cx, hpChip.cy, hpChip.r, location.durability, "health", false, false, boardFace);
    }
  }

  /**
   * The moving half, unless the caller is going to composite it separately.
   *
   * `renderCardToCanvas` renders the static card once into an offscreen and
   * layers the motion over it on every tick, so it asks for `motion: false`
   * here. Every other caller — the board's texture cache, a one-shot preview —
   * wants the whole card in one pass and gets it by default.
   */
  if (options.motion !== false) {
    drawCardMotion(ctx, card, {
      sheen: options.sheen ?? 0.28,
      phase: options.phase ?? 0,
      premium: options.premium === true,
      hover: options.hover ?? 0,
    });
  }

  // interaction rings
  if (options.highlight && options.highlight !== "none") {
    const ringColor =
      options.highlight === "playable" ? "#7dffb0" : options.highlight === "target" ? "#ff5f7a" : "#ffd86b";
    const ring = framePath(palette.shape, { x: rect.x - 4, y: rect.y - 4, w: rect.w + 8, h: rect.h + 8 });
    ctx.save();
    ctx.shadowColor = ringColor;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3.5;
    ctx.stroke(ring);
    ctx.restore();
  }

  ctx.restore();
  setCardDetail("full");
}

// ---------------------------------------------------------------------------
// The canvas wrapper: art crossfade, the tile cache, and the shared clock
// ---------------------------------------------------------------------------

/**
 * Every card canvas on screen, so a settings change reaches all of them.
 *
 * Four settings change what a card looks like — colour-blind mode, high
 * contrast, the dyslexia font and written labels — and until now not one of them
 * did. `applyColorblindMode` mutates `CURRENT_PALETTE` in place and every card
 * already drawn kept the old hues until something else happened to repaint it,
 * which on the collection screen may be never. A player turning on the setting
 * that exists for them saw half a screen change.
 *
 * The registry is pruned on every settings change rather than on teardown: a
 * canvas that has left the document is garbage and its entry goes with it, which
 * is one line and cannot leak, where an unsubscribe returned to twenty call
 * sites would be forgotten by at least one of them.
 *
 * The repaint is deferred a task because `updateSettings` notifies the store
 * *before* it calls `applySettings` — so reading the root element's attributes
 * inside the listener would read the values the change is about to replace.
 */
interface LiveCard {
  canvas: HTMLCanvasElement;
  paint: () => void;
}
const liveCards = new Set<LiveCard>();
let settingsBound = false;

function watchSettings(entry: LiveCard): void {
  liveCards.add(entry);
  if (settingsBound) return;
  settingsBound = true;
  settingsStore.subscribe(() => {
    setTimeout(() => {
      dropTileCache();
      for (const live of [...liveCards]) {
        if (!live.canvas.isConnected) {
          liveCards.delete(live);
          continue;
        }
        live.paint();
      }
    }, 0);
  });
}

// ---------------------------------------------------------------------------
// The tile cache
// ---------------------------------------------------------------------------

/**
 * Rendered tiles, kept so a re-filter is a blit rather than a repaint.
 *
 * A card costs the same to draw whatever size it is asked for — 3.68ms at 168px
 * against 3.03ms at 420px, measured — because the expense is a fixed set of
 * blurred fills rather than pixels. Two hundred and forty-five of them is 900ms,
 * and the collection paid it again on every keystroke in the search box, inside
 * a 2,499ms blocked main thread. The `tile` finish took most of that out; this
 * takes out the rest, because the fastest repaint is the one that does not
 * happen.
 *
 * Only tiles are cached, and this is the whole memory argument: a tile's backing
 * store is 336×446×4 bytes at DPR 2, so forty-eight of them is roughly 29MB and
 * the cap is what makes that a number rather than a hope. A detail card at 420px
 * is 6.4× the area and there is only ever one of it on screen, so caching it
 * would spend megabytes to save a paint that happens once.
 *
 * The key names every input that changes a pixel. `sheen`, `hover` and the live
 * stat overrides are deliberately *not* cacheable inputs — a card carrying any
 * of them is animating or is showing board state, and both want a real paint.
 */
const TILE_CACHE_MAX = 48;
const tileCache = new Map<string, HTMLCanvasElement>();

function dropTileCache(): void {
  tileCache.clear();
  tileSeen.clear();
}

/** Forget one card's tiles — used when its painting finishes decoding. */
function dropTileCacheFor(cardId: string): void {
  for (const key of [...tileCache.keys()]) {
    if (key.startsWith(`${cardId}|`)) tileCache.delete(key);
  }
}

function tileCacheKey(card: CardDef, width: number, dpr: number, options: RenderCardOptions): string | null {
  if (width >= TILE_DETAIL_BELOW) return null;
  if (options.liveAttack !== undefined || options.liveHealth !== undefined || options.liveMaxHealth !== undefined) {
    return null;
  }
  if (options.hover || options.art) return null;
  return [
    card.id,
    width,
    dpr,
    options.dimmed ? "d" : "",
    options.premium ? "p" : "",
    options.highlight ?? "",
    options.statEmphasis ? "s" : "",
    rulesLensOn() ? "l" : "",
    getCardArt(card) ? "a" : "",
  ].join("|");
}

/**
 * Keys that have been asked for once, so only the *second* sighting is stored.
 *
 * A cache that fills on first sight is a tax on the case it cannot help. The
 * collection asks for 245 distinct tiles in one pass and never asks for any of
 * them again — with an eager cache that is 245 extra canvas allocations and 245
 * `drawImage`s for a 48-entry store that has evicted 197 of them before the
 * screen is on. Measured, it cost about 180ms of the mount and returned nothing.
 *
 * A repeat request is different in kind: it means a screen is rebuilding a list
 * it has built before — the deck builder filtering, the shop re-rolling, a route
 * revisited — and *that* is what the cache exists for. Remembering a key costs a
 * string in a Set; remembering a bitmap costs 600KB, so the first sighting pays
 * the cheap one.
 */
const tileSeen = new Set<string>();

function rememberTile(key: string, source: HTMLCanvasElement): void {
  if (typeof document === "undefined") return;
  if (!tileSeen.has(key)) {
    if (tileSeen.size > 600) tileSeen.clear();
    tileSeen.add(key);
    return;
  }
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const ctx = copy.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  // Map iteration is insertion-ordered, so the first key is the oldest: an LRU
  // with no bookkeeping beyond a delete-and-reinsert on a hit.
  if (tileCache.size >= TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(key, copy);
}

/**
 * Render a card into a fresh canvas at the requested pixel width.
 *
 * Art loads asynchronously, so the first paint uses the art-pending treatment
 * and the canvas repaints itself when the real image arrives — that is what
 * makes "drop a PNG in public/assets/art" work with no reload. It used to do
 * that as a hard swap in a single frame, so every card in the collection
 * visibly popped from placeholder to painting and two grid captures a second
 * apart showed a different set of cards. It now crossfades over one UI beat.
 */
export function renderCardToCanvas(card: CardDef, width: number, options: RenderCardOptions = {}): HTMLCanvasElement {
  const scale = width / CARD_W;
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD_W * scale * dpr);
  canvas.height = Math.round(CARD_H * scale * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${width * (CARD_H / CARD_W)}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  let sheen = 0.28;
  let foil = options.phase ?? 0.3;
  let hover = 0;

  const draw = (target: CanvasRenderingContext2D): void => {
    target.scale(scale * dpr, scale * dpr);
    renderCard(target, card, {
      ...options,
      art: options.art ?? getCardArt(card),
      sheen,
      phase: foil,
      hover,
      renderWidth: width,
    });
  };

  /**
   * The static card, kept, so a moving highlight does not redraw a still one.
   *
   * Built lazily on the first animated frame: a card that never moves — which is
   * most of a two-hundred-tile grid — never allocates it, and one that does pays
   * for it once. See `drawCardMotion` for the frame times that made this
   * necessary.
   */
  let base: HTMLCanvasElement | null = null;

  const paint = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw(ctx);
    base = null; // the picture underneath has changed; the cached one is stale
  };

  const compose = (): void => {
    if (!base) {
      const offscreen = document.createElement("canvas");
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offctx = offscreen.getContext("2d");
      if (!offctx) {
        paint();
        return;
      }
      offctx.scale(scale * dpr, scale * dpr);
      renderCard(offctx, card, {
        ...options,
        art: options.art ?? getCardArt(card),
        renderWidth: width,
        motion: false,
      });
      base = offscreen;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.scale(scale * dpr, scale * dpr);
    drawCardMotion(ctx, card, { sheen, phase: foil, premium: options.premium === true, hover });
  };

  /**
   * The cache is consulted exactly once, on the first paint, and written on the
   * same pass. Every repaint after that — art arriving, a hover, the clock — is
   * a card whose inputs have changed, which is the one case a cache must not
   * answer.
   */
  const cacheKey = tileCacheKey(card, width, dpr, options);
  const cached = cacheKey ? tileCache.get(cacheKey) : undefined;
  if (cacheKey && cached) {
    tileCache.delete(cacheKey);
    tileCache.set(cacheKey, cached);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cached, 0, 0);
  } else {
    paint();
    if (cacheKey) rememberTile(cacheKey, canvas);
  }

  /**
   * The crossfade, on the shared clock and on one offscreen — see
   * `material.ts::crossfadeIn` for why the second one had to go.
   */
  const repaint = (): void => {
    crossfadeIn(canvas, draw, paint);
  };

  const unsubscribeArt = onArtLoaded((cardId) => {
    if (cardId !== card.id) return;
    dropTileCacheFor(cardId);
    repaint();
    unsubscribeArt();
  });

  /**
   * The same treatment for the Current and crest icons, and for the shared
   * grain.
   *
   * They are preloaded at boot, so this almost never fires — but "almost" is
   * doing real work on a first visit, where a card can be drawn in the
   * milliseconds before nineteen small PNGs finish decoding. One shot, then it
   * lets go: a screen can hold hundreds of card canvases and each listener that
   * outlived its canvas would be a leak.
   */
  const unsubscribeIcons = onAssetLoaded(() => {
    resetCrestStamps();
    dropTileCache();
    paint();
    unsubscribeIcons();
  });
  const unsubscribeGrain = onCardTextureReady(() => {
    dropTileCache();
    paint();
    unsubscribeGrain();
  });

  watchSettings({ canvas, paint });

  /**
   * Idle is never dead (§3) — and it is now dead in the *right* places only.
   *
   * The old rule was `width >= 220`, which is why nothing on the collection
   * grid, the deck builder, the shop or the grand tour has ever moved: those
   * four screens draw at 120–168px, so the game's headline cosmetic rendered as
   * a static band everywhere except the one screen you reach after buying it.
   * The cap on simultaneous repaints was the part worth keeping; the size test
   * was not. `cardClock` hands the eight slots out by *attention* — hovered
   * first, then premium, then nearest the pointer — so a foil in the shop
   * shimmers, a hovered tile lights, and the two hundred tiles nobody is looking
   * at cost nothing.
   */
  registerCardSurface({
    canvas,
    premium: options.premium === true,
    width,
    paint: (state) => {
      sheen = state.sheen;
      if (options.premium) foil = state.foil;
      hover = state.hover;
      compose();
    },
  });

  return canvas;
}

/**
 * Light a card because the pointer is on it.
 *
 * Exported rather than bound to `pointerenter` here, because a card canvas is
 * almost never the element a screen actually wants to treat as hoverable — the
 * collection hovers a cell that also holds a count chip and a lock, and binding
 * to the canvas would drop the hover every time the pointer crossed one of them.
 */
export function hoverCard(canvas: HTMLCanvasElement, on: boolean): void {
  setCardHover(canvas, on);
}

export { CARD_W, CARD_H };
